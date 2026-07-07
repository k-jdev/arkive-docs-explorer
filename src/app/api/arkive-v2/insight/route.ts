// POST /api/arkive-v2/insight — accept/reject a pending insight from the UI.
//
// Mirrors the decide_insight MCP tool. Moves the file from insights/pending/
// to insights/accepted/ or insights/rejected/, records the user's resolution,
// and updates the index.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { storage, currentUserId } from "@/lib/storage";
import { parseFrontmatter, serializeEntry } from "@/lib/arkive-v2/frontmatter";
import { readArkiveConfig } from "@/lib/arkive-v2/arkive-config";
import { updateIndexForEntry } from "@/lib/arkive-v2/arkive-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  insightPath: z.string(),
  decision: z.enum(["accepted", "rejected"]),
  userComment: z.string().default(""),
  /** Structured, countable feedback (§5.4) — parity with the MCP decide_insight
   *  tool. Optional; recorded on the resolved insight meta, not acted on by any
   *  durable learner in v1. */
  reason_type: z
    .enum(["useful", "wrong", "not_useful", "too_speculative", "dont_care"])
    .optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  try {
    const uid = await currentUserId();
    const adapter = storage();
    const existing = await adapter.readEntry(uid, body.insightPath);
    if (!existing) {
      return NextResponse.json({ error: `No pending insight at ${body.insightPath}` }, { status: 404 });
    }
    const { meta, body: rawBody } = parseFrontmatter(existing.body);
    const m = meta as Record<string, unknown>;
    const newPath = body.insightPath.replace("/insights/pending/", `/insights/${body.decision}/`);
    const now = new Date();
    const updated: Record<string, unknown> = {
      ...m,
      status: body.decision,
      resolution_date: now.toISOString(),
    };
    if (body.reason_type) updated.reason_type = body.reason_type;
    if (body.decision === "rejected") {
      const cfg = await readArkiveConfig();
      const cooldownDays = Math.max(7, cfg.defaults.rejection_cooldown_threshold * 3);
      const cool = new Date(now);
      cool.setDate(cool.getDate() + cooldownDays);
      updated.cooldown_until = cool.toISOString();
    }
    const newBody = body.userComment
      ? `${rawBody.trim()}\n\n## Resolution\n\n${body.userComment.trim()}\n`
      : rawBody;
    await adapter.writeEntry(uid, {
      path: newPath,
      body: serializeEntry(updated, newBody),
      meta: updated,
    });
    await adapter.deleteEntry(uid, body.insightPath);
    await updateIndexForEntry(newPath);
    return NextResponse.json({ ok: true, moved_to: newPath, status: body.decision });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
