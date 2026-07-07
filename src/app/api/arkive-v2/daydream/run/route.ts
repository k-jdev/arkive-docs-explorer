// POST /api/arkive-v2/daydream/run — run ONE autonomous daydream pass.
//
// This is the stable, callable surface for the daydream engine. It is manually
// triggered (the "Think now" button on the Daydreams tab). There is no
// scheduler — a pass runs only when something hits this route.
//
// The response is a STREAM of newline-delimited JSON progress events, emitted as
// the pass actually executes, so the UI can show real status ("how far in") and
// not a fake spinner. Events fire in order:
//   {phase:"reading"} {phase:"context",...} {phase:"thinking",modelId}
//   {phase:"writing",total} {phase:"wrote",index,total,...}
// and the route closes the stream with a terminal envelope:
//   {phase:"done", run_id, summary, cost}   — or   {phase:"error", error}
//
// The slow part is the single model call ("thinking"); "wrote" ticks once per
// daydream written. Cost is read from the metering ledger after the pass, so it
// reflects exactly what the by-construction metering boundary recorded.

import { getSession } from "@/lib/session";
import { runDaydreamPass, type DaydreamProgress } from "@/lib/arkive-v2/daydream-loop";
import { listInternal } from "@/lib/internal-store";
import { METERING_NAMESPACE } from "@/lib/model";
import type { MeteringEntry } from "@/lib/model";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A pass = prep + one model call (Opus, 8k out) + a few writes. That usually
// runs well under a minute, but it can exceed the platform's tiny default, which
// would silently cut a run off. 60s is allowed on every Vercel plan; raise to
// 300 if you're on Pro and ever see a pass truncated.
export const maxDuration = 60;

/** USD per 1M tokens, keyed by bare model id. Turns the metering ledger into a
 *  cost figure. Fallback is the v1 frontier (Opus) pricing. */
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};
const FALLBACK_PRICE = { input: 5, output: 25 };

function priceFor(modelId: string): { input: number; output: number } {
  const bare = modelId.includes(":") ? modelId.slice(modelId.indexOf(":") + 1) : modelId;
  return PRICE_PER_MTOK[bare] ?? FALLBACK_PRICE;
}

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // crypto.randomUUID is available in the Node.js runtime.
  const runId = `dd_${crypto.randomUUID()}`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const result = await runDaydreamPass({
          runId,
          onProgress: (ev: DaydreamProgress) => send(ev),
        });

        // Cost from the metering ledger (the by-construction boundary), not the
        // loop's own count.
        const ledger = await listInternal<MeteringEntry>(METERING_NAMESPACE);
        const thisRun = ledger.filter((e) => e.meta.run_id === runId);
        let inputTokens = 0;
        let outputTokens = 0;
        let costUsd = 0;
        for (const e of thisRun) {
          const inTok = Number(e.meta.input_tokens) || 0;
          const outTok = Number(e.meta.output_tokens) || 0;
          const price = priceFor(String(e.meta.model_id ?? ""));
          inputTokens += inTok;
          outputTokens += outTok;
          costUsd += (inTok / 1_000_000) * price.input + (outTok / 1_000_000) * price.output;
        }

        send({
          phase: "done",
          run_id: runId,
          summary: {
            daydreams_written: result.daydreamsWritten,
            surfaced: result.surfaced,
            proposed: result.proposed,
            recurrences_recorded: result.recurrencesRecorded,
            ...(result.note ? { note: result.note } : {}),
          },
          cost: {
            model_id: result.modelId,
            model_calls: thisRun.length,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            usd: Number(costUsd.toFixed(6)),
          },
        });
      } catch (e) {
        send({ phase: "error", error: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      // Hint proxies (nginx) not to buffer the streamed body.
      "x-accel-buffering": "no",
    },
  });
}
