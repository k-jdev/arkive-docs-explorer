// GET /api/arkive-v2/daydream — list daydreams (the loop's hypotheses).
//
// The bundle carries only the SURFACED subset (the read-only "Notices"). This
// route is the fuller lens: history, non-surfaced thoughts, per-practice
// filtering, paging — anything beyond what the bundle's surfaced slice covers.
// Detail bodies for a single daydream can also be read via the entry route
// (daydream paths pass its V2_ROOT validation).
//
// Read-only. Session-gated like every arkive-v2 route; user-scoping happens
// inside listDaydreams() via the storage adapter (currentUserId), the same way
// the daydream/run route delegates scoping to the lib layer.

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { listDaydreams } from "@/lib/arkive-v2/daydream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const surfacedOnly = q.get("surfacedOnly") === "true";
  const practice = q.get("practice") ?? undefined;
  const since = q.get("since") ?? undefined;
  const limitRaw = q.get("limit");
  // Only a positive integer is a valid cap; anything else (empty, 0, negative,
  // fractional) is ignored rather than passed through to listDaydreams.
  const limitNum = limitRaw !== null ? Number(limitRaw) : NaN;
  const limit = Number.isInteger(limitNum) && limitNum > 0 ? limitNum : undefined;
  // Bodies are included by default (the views render them); pass withBody=false
  // for a lightweight metadata-only list.
  const withBody = q.get("withBody") !== "false";

  try {
    const daydreams = await listDaydreams({ surfacedOnly, practice, since, limit, withBody });
    return NextResponse.json({ daydreams, count: daydreams.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
