// POST /api/arkive-v2/reset — DESTRUCTIVE.
//
// Wipes every entry the user owns and re-seeds a fresh arkive-core-v1
// substrate: four universal root files + the trading practice as the
// default verified practice.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { storage, currentUserId } from "@/lib/storage";
import {
  PATH_PROTOCOL,
  PATH_IDENTITY,
  PATH_LOADUP,
  PATH_CONFIG,
  practiceConfigPath,
  practiceInstructionsPath,
} from "@/lib/arkive-v2/paths";
import {
  PROTOCOL_MD,
  IDENTITY_MD,
  LOADUP_MD,
} from "@/lib/arkive-v2/seeds";
import {
  TRADING_PRACTICE,
  TRADING_CONTEXT_DIR,
  WATCHLIST_MD,
  POSITIONS_MD,
  RULES_MD,
  INTENTIONS_MD,
  TRADING_INSTRUCTIONS_MD,
  tradingPracticeConfig,
} from "@/lib/arkive-v2/authored/trading";
import {
  defaultArkiveConfig,
  serializeArkiveConfig,
} from "@/lib/arkive-v2/arkive-config";
import { serializePracticeConfig } from "@/lib/arkive-v2/practices";
import { rebuildIndex, writeIndex } from "@/lib/arkive-v2/arkive-index";
import { parseFrontmatter } from "@/lib/arkive-v2/frontmatter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const uid = await currentUserId();
    const adapter = storage();

    // Delete every entry the user owns
    const all = await adapter.listEntries(uid, "");
    let deleted = 0;
    for (const e of all) {
      await adapter.deleteEntry(uid, e.path);
      deleted++;
    }

    // Re-seed the four universal root files + the trading practice
    const seeded: string[] = [];
    const seeds: Array<{ path: string; body: string; isYaml?: boolean }> = [
      { path: PATH_PROTOCOL, body: PROTOCOL_MD },
      { path: PATH_IDENTITY, body: IDENTITY_MD },
      { path: PATH_LOADUP, body: LOADUP_MD },
      { path: PATH_CONFIG, body: serializeArkiveConfig(defaultArkiveConfig()), isYaml: true },
      {
        path: practiceConfigPath(TRADING_PRACTICE),
        body: serializePracticeConfig(tradingPracticeConfig()),
        isYaml: true,
      },
      {
        path: practiceInstructionsPath(TRADING_PRACTICE),
        body: TRADING_INSTRUCTIONS_MD,
      },
      { path: `${TRADING_CONTEXT_DIR}/watchlist.md`, body: WATCHLIST_MD },
      { path: `${TRADING_CONTEXT_DIR}/positions.md`, body: POSITIONS_MD },
      { path: `${TRADING_CONTEXT_DIR}/rules.md`, body: RULES_MD },
      { path: `${TRADING_CONTEXT_DIR}/intentions.md`, body: INTENTIONS_MD },
    ];
    for (const s of seeds) {
      const meta = s.isYaml ? {} : (parseFrontmatter(s.body).meta as Record<string, unknown>);
      await adapter.writeEntry(uid, { path: s.path, body: s.body, meta });
      seeded.push(s.path);
    }

    // Rebuild + write index
    const idx = await rebuildIndex();
    await writeIndex(idx);

    return NextResponse.json({ ok: true, deleted, seeded });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
