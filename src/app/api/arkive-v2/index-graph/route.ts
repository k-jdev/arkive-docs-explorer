// GET /api/arkive-v2/index-graph — returns the full v2 graph index for the UI.
//
// Used by the graph view + backlinks panel. JSON-serializable: drops the
// per-path Maps and ships pure arrays. The client rebuilds whatever lookups
// it needs from the arrays.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { buildIndex } from "@/lib/arkive-v2/arkive-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const idx = await buildIndex();
    return NextResponse.json({
      version: idx.version,
      computedAt: idx.computedAt,
      nodes: idx.nodes,
      edges: idx.edges,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
