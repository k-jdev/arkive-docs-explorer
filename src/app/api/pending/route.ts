import { NextResponse } from "next/server";
import { listPending } from "@/lib/state";

export async function GET() {
  return NextResponse.json({ pending: listPending() });
}
