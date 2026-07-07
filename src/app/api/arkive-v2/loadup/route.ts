// POST /api/arkive-v2/loadup — direct loadup edit from the UI.
//
// loadup.md is the single source of truth for what the AI surfaces at the
// start of every session. The user controls it; nothing else (not the MCP
// `instructions` field, not the protocol, not any practice config)
// overrides what they put here.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { storage, currentUserId } from "@/lib/storage";
import { PATH_LOADUP, PRACTICES_DIR } from "@/lib/arkive-v2/paths";
import { serializeEntry, parseFrontmatter } from "@/lib/arkive-v2/frontmatter";

/** Paths the pre-v7 "core is a practice" routing bug could have produced
 *  for loadup.md. Any of them get cleaned up on save. */
const MISROUTED_LOADUP_PATHS = [`${PRACTICES_DIR}/core/loadup.md`];

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  body: z.string().min(1).max(20000),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let payload: z.infer<typeof Schema>;
  try {
    payload = Schema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  try {
    const uid = await currentUserId();
    const adapter = storage();
    const existing = await adapter.readEntry(uid, PATH_LOADUP);
    const isoNow = new Date().toISOString();

    let createdAt = isoNow;
    let version = 1;
    if (existing) {
      const { meta } = parseFrontmatter(existing.body);
      const m = (meta ?? {}) as Record<string, unknown>;
      if (typeof m.created_at === "string") createdAt = m.created_at;
      if (typeof m.version === "number") version = m.version + 1;
    }

    const meta: Record<string, unknown> = {
      entity_type: "loadup",
      practice: "core",
      created_at: createdAt,
      last_updated: isoNow,
      version,
    };
    const body = payload.body.trim() + "\n";
    const text = serializeEntry(meta, body);
    await adapter.writeEntry(uid, {
      path: PATH_LOADUP,
      body: text,
      meta,
    });

    // Best-effort cleanup of any misrouted copies.
    let cleaned: string[] = [];
    for (const stale of MISROUTED_LOADUP_PATHS) {
      try {
        if (await adapter.readEntry(uid, stale)) {
          await adapter.deleteEntry(uid, stale);
          cleaned.push(stale);
        }
      } catch {
        // ignore — heal will retry on next read
      }
    }

    return NextResponse.json({
      ok: true,
      path: PATH_LOADUP,
      cleaned_misrouted: cleaned,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
