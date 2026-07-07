// Calibration-matrix harness (one-off, NOT wired into the app).
//
// Generic version of test-fixtures/daydream-real-run/seed-and-run.ts.txt: reads a
// persona's practices + observation stream from SEED_FILE (JSON), wipes the local
// .arkive, seeds two practices + the stream, runs the daydream loop TWICE, and
// dumps everything (daydreams, proposals, metering, practice entry-counts) to
// OUT_FILE for the report. Leaves .arkive intact so the caller can snapshot it.
//
//   set -a; . ./.env.local; set +a; \
//   STORAGE_BACKEND=filesystem SEED_FILE=... OUT_FILE=... node bundle.cjs
//
// DAYDREAM_MODEL drives the model: claude-opus-4-8 (real) or stub (free dry-run).

import { storage, currentUserId } from "@/lib/storage";
import { capture } from "@/lib/arkive-v2/stream";
import {
  writeArkiveConfig, readArkiveConfig,
} from "@/lib/arkive-v2/arkive-config";
import { ARKIVE_CORE_VERSION, DEFAULT_ARKIVE_DEFAULTS } from "@/lib/arkive-v2/schemas";
import { createUserPractice, installPractice } from "@/lib/arkive-v2/practices";
import { isReservedPractice } from "@/lib/arkive-v2/authored";
import { tradingPracticeConfig } from "@/lib/arkive-v2/authored/trading";
import { runDaydreamPass } from "@/lib/arkive-v2/daydream-loop";
import { readArkive } from "@/lib/arkive-v2/read-bundle";
import { listDaydreams } from "@/lib/arkive-v2/daydream";
import { listInternal } from "@/lib/internal-store";
import { METERING_NAMESPACE } from "@/lib/model";
import type { MeteringEntry } from "@/lib/model";
import { parseFrontmatter } from "@/lib/arkive-v2/frontmatter";
import * as fs from "node:fs";

const BASE = "2026-04-01T00:00:00.000Z";
function at(day: number, h: number, m: number): string {
  const d = new Date(BASE);
  d.setUTCDate(d.getUTCDate() + day);
  d.setUTCHours(h, m, 0, 0);
  return d.toISOString();
}

type Obs = { d: number; h: number; m: number; body: string; kind?: string; to?: string; mentions?: string[] };
type PracticeDef = { name: string; description: string; triggers: string[] };
type SeedFile = { persona: string; runIdPrefix: string; practices: PracticeDef[]; obs: Obs[] };

const PRICE: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 }, "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 }, "claude-haiku-4-5": { input: 1, output: 5 },
};
function priceFor(id: string) { const b = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id; return PRICE[b] ?? PRICE["claude-opus-4-8"]; }

async function main() {
  const seedPath = process.env.SEED_FILE;
  const outPath = process.env.OUT_FILE;
  if (!seedPath || !outPath) throw new Error("SEED_FILE and OUT_FILE env vars are required");
  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8")) as SeedFile;
  if (!seed.practices || seed.practices.length !== 2) throw new Error("seed must declare exactly two practices");

  const uid = await currentUserId();
  const a = storage();
  for (const e of await a.listEntries(uid, "")) await a.deleteEntry(uid, e.path);

  // Suppress the core-v1 migration BEFORE seeding. A fresh arkive built through
  // the v2 APIs is already canonical, but migrateToCoreV1IfNeeded() (fired by
  // readArkive at dump-time) is marker-gated and, when it runs, overwrites
  // arkive.config with defaultArkiveConfig() AND force-installs the packaged
  // `trading` practice — which would clobber the persona's practices and inject
  // a phantom trading practice into every (incl. neutral) arkive. Writing the
  // marker first makes the migration a no-op, so the run sees EXACTLY the two
  // persona practices we install below.
  await a.writeEntry(uid, {
    path: "_internal/config/system/migration-marker-core-v1.md",
    body: `---\ntype: migration_marker\nversion: core-v1\nran_at: ${at(0, 0, 0)}\ntouched: 0\n---\n\n# Migration suppressed by the calibration harness (fresh arkive is already canonical).\n`,
    meta: { type: "migration_marker", version: "core-v1", touched: 0 },
  });

  // Fresh config with NO default practices (we create the persona's own two).
  await writeArkiveConfig({
    version: ARKIVE_CORE_VERSION,
    identity_ref: "arkive/identity.md",
    protocol_ref: "arkive/arkive.protocol.md",
    practices: {},
    defaults: { ...DEFAULT_ARKIVE_DEFAULTS },
  });
  // Install the persona's two practices. `trading` is a built-in/authored
  // practice (reserved — createUserPractice refuses it), so the trading persona
  // registers it via installPractice with its canonical config; everyone else
  // gets two user-created practices.
  const declared = new Set(seed.practices.map((p) => p.name));
  for (const pr of seed.practices) {
    if (isReservedPractice(pr.name)) {
      await installPractice({ config: tradingPracticeConfig(), mode: "active" });
    } else {
      await createUserPractice({ name: pr.name, description: pr.description, triggers: pr.triggers });
    }
  }
  // Make declared practices active; explicitly DISABLE the always-injected
  // built-in `trading` in arkives that didn't declare it (the config parser
  // re-seeds trading from defaults on every read, so a neutral arkive must turn
  // it off or the run would see a phantom empty practice).
  const cfg = await readArkiveConfig();
  for (const [name, reg] of Object.entries(cfg.practices)) {
    if (declared.has(name)) { reg.enabled = true; reg.mode = "active"; }
    else { reg.enabled = false; }
  }
  await writeArkiveConfig(cfg);

  for (const o of seed.obs) {
    await capture({ body: o.body, kind: o.kind, mentions: o.mentions, routedTo: o.to || undefined, createdAt: at(o.d, o.h, o.m) });
  }

  const first = seed.obs[0], last = seed.obs[seed.obs.length - 1];
  const span = { from: at(first.d, first.h, first.m).slice(0, 10), to: at(last.d, last.h, last.m).slice(0, 10), count: seed.obs.length };
  console.error(`SEEDED ${span.count} observations ${span.from} → ${span.to}; persona=${seed.persona}; practices: ${seed.practices.map((p) => p.name).join(", ")}`);

  // Two passes.
  console.error(`RUN 1 (${process.env.DAYDREAM_MODEL})…`);
  const r1 = await runDaydreamPass({ runId: `${seed.runIdPrefix}-1` });
  console.error(`  run1: written=${r1.daydreamsWritten} surfaced=${r1.surfaced} proposed=${r1.proposed} failures=${r1.proposeFailures} model=${r1.modelId}`);
  console.error(`RUN 2 (${process.env.DAYDREAM_MODEL})…`);
  const r2 = await runDaydreamPass({ runId: `${seed.runIdPrefix}-2` });
  console.error(`  run2: written=${r2.daydreamsWritten} surfaced=${r2.surfaced} proposed=${r2.proposed} recurrences=${r2.recurrencesRecorded} failures=${r2.proposeFailures}`);

  // Dump everything for the report.
  const daydreams = (await listDaydreams({ withBody: true })).sort((x, y) => (x.path < y.path ? -1 : 1)); // oldest first
  const proposalsRaw = (await a.listEntries(uid, "")).map((e) => e.path).filter((p) => p.includes("/insights/pending/"));
  const proposals: Array<{ path: string; meta: Record<string, unknown>; body: string }> = [];
  for (const p of proposalsRaw) {
    const ent = await a.readEntry(uid, p);
    if (ent) { const { meta, body } = parseFrontmatter(ent.body); proposals.push({ path: p, meta, body: body.trim() }); }
  }
  const ledger = (await listInternal<MeteringEntry>(METERING_NAMESPACE)).map((e) => e.meta);
  let inTok = 0, outTok = 0, usd = 0;
  for (const m of ledger) { const pr = priceFor(String(m.model_id)); const it = Number(m.input_tokens) || 0, ot = Number(m.output_tokens) || 0; inTok += it; outTok += ot; usd += (it / 1e6) * pr.input + (ot / 1e6) * pr.output; }

  const bundle = await readArkive();

  const dump = {
    persona: seed.persona,
    span,
    practices: bundle.practices.map((p) => ({ name: p.name, mode: p.mode, entries: p.entry_count })),
    runs: { run1: r1, run2: r2 },
    cost: { model: r1.modelId, calls: ledger.length, input_tokens: inTok, output_tokens: outTok, usd: Number(usd.toFixed(6)) },
    ledger,
    daydreams: daydreams.map((d) => ({ path: d.path, meta: d.meta, body: d.body })),
    proposals,
    bundle_notice_count: bundle.notices.length,
  };
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2));
  console.error(`\nDUMP → ${outPath}`);
  console.error(`COST: $${dump.cost.usd} (${ledger.length} calls, in ${inTok} / out ${outTok} tok, ${r1.modelId})`);
  console.error(`DAYDREAMS: ${daydreams.length} | PROPOSALS: ${proposals.length} | NOTICES(surfaced): ${bundle.notices.length}`);
}

main().catch((e) => { console.error("CAL-RUN ERR:", (e as Error).message, "\n", (e as Error).stack); process.exit(2); });
