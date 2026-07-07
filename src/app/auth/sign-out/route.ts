import { NextResponse, type NextRequest } from "next/server";
import { destroySession } from "@/lib/session";

async function endSession(req: NextRequest) {
  await destroySession();
  return NextResponse.redirect(new URL("/auth/sign-in", req.url));
}

export async function POST(req: NextRequest) {
  return endSession(req);
}
export async function GET(req: NextRequest) {
  return endSession(req);
}
