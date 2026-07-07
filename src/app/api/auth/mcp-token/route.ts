// Per-user MCP token management.
//
// All three methods require the browser session cookie (the user must be signed in).
//
//   GET    → list this user's tokens (token strings + labels + last-used)
//   POST   → create a new token. Body: { label?: string }. Returns the new token.
//   DELETE → revoke a token. Query: ?token=<token>.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { createMcpToken, listMcpTokens, revokeMcpToken } from "@/lib/mcp-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireSession() {
  const session = await getSession();
  if (!session) return null;
  return session;
}

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const tokens = await listMcpTokens(session.userId);
    return NextResponse.json({ tokens });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

const PostSchema = z.object({ label: z.string().max(80).optional() });

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
    const token = await createMcpToken({ userId: session.userId, label: body.label ?? null });
    return NextResponse.json({ token });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing ?token= param" }, { status: 400 });

  try {
    const ok = await revokeMcpToken({ userId: session.userId, token });
    if (!ok) return NextResponse.json({ error: "Token not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
