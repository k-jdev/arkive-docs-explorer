// Sign in with a login key (PUBLIC — this IS a login path).
//
// Body: { key: string }. We HMAC-lookup the key → user_id, then mint the same
// session cookie the SIWE flow does. No wallet signature required: the key was
// created by an already-authenticated wallet session, so presenting it proves
// account ownership the same way a password would.
//
// This route is exempt from the auth middleware (PUBLIC_PATHS) since the user
// is not yet signed in when they call it.

import { NextResponse, type NextRequest } from "next/server";
import { verifyLoginKey } from "@/lib/login-keys";
import { createSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let key: string | undefined;
  try {
    const body = (await req.json()) as { key?: string };
    key = body.key;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (!key || typeof key !== "string") {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  try {
    const resolved = await verifyLoginKey(key.trim());
    if (!resolved) {
      // Generic message — don't reveal whether the key existed.
      return NextResponse.json({ error: "Invalid login key" }, { status: 401 });
    }
    const userAgent = req.headers.get("user-agent") ?? null;
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      null;
    await createSession({ userId: resolved.userId, userAgent, ip });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
