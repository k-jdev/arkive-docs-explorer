// GET /api/arkive-v2/export — download the entire arkive directory as a .zip.
//
// Every entry the user owns becomes a file in the zip at its full path,
// preserving the v2 directory structure (arkive/journal/trades/..., etc.) +
// any legacy archive_v1/* paths. The zip also includes a top-level
// manifest.json with export metadata.

import { NextResponse } from "next/server";
import JSZip from "jszip";
import { getSession } from "@/lib/session";
import { storage, currentUserId } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const uid = await currentUserId();
    const adapter = storage();
    const all = await adapter.listEntries(uid, "");

    const zip = new JSZip();
    for (const e of all) {
      // body is the stored text (frontmatter + markdown); writing as-is keeps
      // the exported file identical to what an external tool would see.
      zip.file(e.path, e.body);
    }
    zip.file(
      "manifest.json",
      JSON.stringify(
        {
          exported_at: new Date().toISOString(),
          wallet_address: session.walletAddress,
          entry_count: all.length,
          format: "arkive-v2",
          notes: "Every file is the raw stored markdown (frontmatter + body). Open .md files in any editor.",
        },
        null,
        2
      )
    );

    const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const dateStr = new Date().toISOString().slice(0, 10);
    // Wrap in a fresh Uint8Array view so the underlying buffer satisfies BodyInit.
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="arkive-${dateStr}.zip"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
