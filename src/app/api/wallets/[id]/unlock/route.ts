import { NextResponse } from "next/server";
import { unlockAccount } from "@/lib/keystore";
import { setUnlocked, lock } from "@/lib/state";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const password = body?.password as string | undefined;
  if (!password) return NextResponse.json({ error: "Password required" }, { status: 400 });
  try {
    const account = await unlockAccount(id, password);
    setUnlocked(id, account);
    return NextResponse.json({ ok: true, address: account.address });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  lock(id);
  return NextResponse.json({ ok: true });
}
