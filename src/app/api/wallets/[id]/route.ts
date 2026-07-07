import { NextResponse } from "next/server";
import { deleteWallet } from "@/lib/keystore";
import { lock } from "@/lib/state";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  lock(id);
  await deleteWallet(id);
  return NextResponse.json({ ok: true });
}
