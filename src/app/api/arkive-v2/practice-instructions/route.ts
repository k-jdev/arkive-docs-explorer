// POST /api/arkive-v2/practice-instructions — edit a practice's operational
// playbook from the UI.
//
// Per-practice instructions tell the AI how to act WITHIN that practice
// (defaults, tool sequences, anti-patterns, decisive-execution rules).
// Trading ships a substantive default; user-created practices get a minimal
// template. The user can edit it any time — this endpoint is how.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { storage, currentUserId } from "@/lib/storage";
import { practiceInstructionsPath, slugifyPractice } from "@/lib/arkive-v2/paths";
import { serializeEntry, parseFrontmatter } from "@/lib/arkive-v2/frontmatter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  practice: z.string().min(1).max(64),
  body: z.string().min(1).max(40000),
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

  // Normalize the practice slug — accept the user-typed display name or
  // an exact slug. slugifyPractice is idempotent on already-slugged input.
  const practice = slugifyPractice(payload.practice);
  if (!practice) return NextResponse.json({ error: "invalid practice" }, { status: 400 });

  try {
    const uid = await currentUserId();
    const adapter = storage();
    const path = practiceInstructionsPath(practice);
    const existing = await adapter.readEntry(uid, path);
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
      entity_type: "practice_instructions",
      practice,
      created_at: createdAt,
      last_updated: isoNow,
      version,
    };
    const body = payload.body.trim() + "\n";
    const text = serializeEntry(meta, body);
    await adapter.writeEntry(uid, { path, body: text, meta });
    return NextResponse.json({ ok: true, path });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
