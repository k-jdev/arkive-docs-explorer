// Per-user hidden tokens — the blocklist for scam/spam tokens.
//
// GET    → list all hidden tokens on this user's profile
// POST   → add a token to the hidden list ({ chain, address, symbol? })
// DELETE → remove a token from the hidden list (?chain=…&address=…)

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { getHiddenTokens, hideToken, unhideToken } from "@/lib/user-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireSession() {
  const s = await getSession();
  return s;
}

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const hidden = await getHiddenTokens();
    return NextResponse.json({ hidden });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

const PostSchema = z.object({
  chain: z.enum(["ethereum", "base"]),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Must be a 0x address (40 hex chars)"),
  symbol: z.string().max(40).optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let body: z.infer<typeof PostSchema>;
  try {
    const json = await req.json().catch(() => ({}));
    body = PostSchema.parse(json);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  try {
    const hidden = await hideToken(body);
    return NextResponse.json({ hidden });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const chain = req.nextUrl.searchParams.get("chain");
  const address = req.nextUrl.searchParams.get("address");
  if (chain !== "ethereum" && chain !== "base") {
    return NextResponse.json({ error: "Missing or invalid chain param" }, { status: 400 });
  }
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "Missing or invalid address param" }, { status: 400 });
  }
  try {
    const hidden = await unhideToken({ chain, address });
    return NextResponse.json({ hidden });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
