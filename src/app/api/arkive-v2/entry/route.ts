// GET /api/arkive-v2/entry?path=<arkive/...> — read a single entry by path.
//
// The bundle only bulk-loads recent journal entries, context, and pending
// insights. The explorer still shows every on-disk file (skills,
// accepted/rejected insights, journal entries outside the recent window).
// When the user opens one of those as a tab, ArkiveWorkspace lazy-fetches
// the body through this endpoint.
//
// Read-only. Path is validated against the V2_ROOT prefix so callers can't
// escape into other users' storage namespaces.

import { NextResponse, type NextRequest } from "next/server";
import { storage, currentUserId } from "@/lib/storage";
import { parseFrontmatter } from "@/lib/arkive-v2/frontmatter";
import { V2_ROOT } from "@/lib/arkive-v2/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {

  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  if (path.includes("..")) return NextResponse.json({ error: "invalid path" }, { status: 400 });
  if (!path.startsWith(V2_ROOT + "/") && path !== V2_ROOT) {
    return NextResponse.json({ error: "path must be under arkive/" }, { status: 400 });
  }

  try {
    const uid = await currentUserId();
    const entry = await storage().readEntry(uid, path);
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { meta, body } = parseFrontmatter(entry.body);
    return NextResponse.json({
      path,
      meta: meta as Record<string, unknown>,
      body,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
