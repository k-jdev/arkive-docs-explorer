// GET /api/arkive-v2/bundle — the v2 session-start bundle for the UI.
//
// Returns the same shape the MCP read_arkive tool returns, so the dashboard
// page can render directly off it.

import { NextResponse } from "next/server";
import { readArkive } from "@/lib/arkive-v2/read-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const bundle = await readArkive();
    return NextResponse.json(bundle);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
