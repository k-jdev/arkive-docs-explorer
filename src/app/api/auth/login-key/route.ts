// Login-key management (session-gated).
//
//   GET    → list this user's login keys (masked — prefix + label + dates).
//   POST   → mint a new login key. Body: { label? }. Returns the full key ONCE.
//   DELETE → revoke a key. Query: ?id=<uuid>.
//
// A login key lets the user sign in with the key string instead of their
// wallet (see /api/auth/login-key/verify). Creating one requires being signed
// in already (so the key is bound to the existing account).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { createLoginKey, listLoginKeys, revokeLoginKey } from "@/lib/login-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const keys = await listLoginKeys(session.userId);
    return NextResponse.json({ keys });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

const PostSchema = z.object({ label: z.string().max(80).optional() });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: z.infer<typeof PostSchema>;
  try {
    body = PostSchema.parse(await req.json().catch(() => ({})));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  try {
    const { key, id } = await createLoginKey({ userId: session.userId, label: body.label ?? null });
    return NextResponse.json({ key, id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing ?id= param" }, { status: 400 });

  try {
    const ok = await revokeLoginKey({ userId: session.userId, id });
    if (!ok) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
