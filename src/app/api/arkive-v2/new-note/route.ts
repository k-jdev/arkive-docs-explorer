// POST /api/arkive-v2/new-note — create a dated personal note in the stream.
//
// Each call always creates a fresh note: 2026-06-21-1.md, 2026-06-21-2.md, …
// Scans for the next available number so there are no collisions.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { storage, currentUserId } from "@/lib/storage";
import { STREAM_DIR } from "@/lib/arkive-v2/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const monthDir = `${yyyy}-${mm}`;

  try {
    const uid = await currentUserId();
    const adapter = storage();

    // Find next available suffix: 2026-06-21-1.md, -2.md, …
    let n = 1;
    let path = `${STREAM_DIR}/${monthDir}/${dateStr}-${n}.md`;
    while (await adapter.readEntry(uid, path)) {
      n++;
      path = `${STREAM_DIR}/${monthDir}/${dateStr}-${n}.md`;
    }

    await adapter.writeEntry(uid, {
      path,
      body: `---\ntimestamp: ${now.toISOString()}\nentity_type: personal\n---\n\n`,
      meta: { timestamp: now.toISOString(), entity_type: "personal" },
    });

    return NextResponse.json({ path });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
