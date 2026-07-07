// POST /api/arkive-v2/stream-entry — write (overwrite) a single stream entry.
// Body: { path: "arkive/stream/...", body: "..." }

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { storage, currentUserId } from "@/lib/storage";
import { STREAM_DIR } from "@/lib/arkive-v2/paths";
import { parseFrontmatter, serializeEntry } from "@/lib/arkive-v2/frontmatter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  path: z.string(),
  body: z.string().max(100_000),
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

  if (!payload.path.startsWith(STREAM_DIR + "/")) {
    return NextResponse.json({ error: "path must be under arkive/stream/" }, { status: 400 });
  }

  try {
    const uid = await currentUserId();
    const adapter = storage();

    const existing = await adapter.readEntry(uid, payload.path);
    const { meta: existingMeta } = existing
      ? parseFrontmatter(existing.body)
      : { meta: { timestamp: new Date().toISOString(), entity_type: "personal" } };

    const text = serializeEntry(existingMeta as Record<string, unknown>, payload.body.trim());
    await adapter.writeEntry(uid, { path: payload.path, body: text, meta: existingMeta as Record<string, unknown> });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
