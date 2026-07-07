// Returns a one-time nonce for SIWE message construction.
// Stateless: nonce is HMAC-signed so verify can validate without a DB lookup.

import { NextResponse } from "next/server";
import { makeNonce } from "@/lib/session";

export async function GET() {
  const { nonce, signature } = makeNonce();
  return NextResponse.json({ nonce, signature });
}
