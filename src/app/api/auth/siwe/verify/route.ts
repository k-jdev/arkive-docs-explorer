// Verifies a SIWE message + signature, mints a session if valid.
//
// Request body: { message: string, signature: string, nonceSignature: string }
// The `message` is the full SIWE message text the user signed. We:
//   1. Parse it via the `siwe` lib
//   2. Recompute the HMAC of the nonce in that message → match against nonceSignature
//   3. Verify the signature recovers to the address in the message
//   4. Domain / time / chainId sanity checks
//   5. Upsert user by wallet address, create session, set cookie
//
// Returns { ok: true } on success.

import { NextResponse, type NextRequest } from "next/server";
import { SiweMessage } from "siwe";
import {
  verifyNonce,
  upsertUserByWallet,
  createSession,
  normalizeAddress,
} from "@/lib/session";

type Body = {
  message?: string;
  signature?: string;
  nonceSignature?: string;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  if (!body.message || !body.signature || !body.nonceSignature) {
    return NextResponse.json(
      { error: "Missing message/signature/nonceSignature" },
      { status: 400 }
    );
  }

  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(body.message);
  } catch (e) {
    return NextResponse.json({ error: `Invalid SIWE message: ${(e as Error).message}` }, { status: 400 });
  }

  // Sanity: domain must match request host. Prevents using a signature from another site.
  const requestHost = req.headers.get("host") ?? "";
  // Allow localhost during dev; otherwise require exact match.
  if (siwe.domain !== requestHost && !requestHost.startsWith("localhost")) {
    return NextResponse.json(
      { error: `SIWE domain '${siwe.domain}' doesn't match request host '${requestHost}'` },
      { status: 400 }
    );
  }

  // Nonce must be HMAC-valid (issued by us, not tampered)
  if (!verifyNonce(siwe.nonce, body.nonceSignature)) {
    return NextResponse.json({ error: "Bad nonce — not issued by this server" }, { status: 401 });
  }

  // Verify the signature recovers to siwe.address
  try {
    const result = await siwe.verify({ signature: body.signature });
    if (!result.success) {
      return NextResponse.json(
        { error: "Signature verification failed", data: result.data },
        { status: 401 }
      );
    }
  } catch (e) {
    return NextResponse.json({ error: `Verify error: ${(e as Error).message}` }, { status: 401 });
  }

  // Looks good — upsert user, create session, set cookie.
  const address = normalizeAddress(siwe.address);
  const user = await upsertUserByWallet({ address });
  const userAgent = req.headers.get("user-agent") ?? null;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    null;
  await createSession({ userId: user.id, userAgent, ip });

  return NextResponse.json({ ok: true, userId: user.id, address, isNew: user.isNew });
}
