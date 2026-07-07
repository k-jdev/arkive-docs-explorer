import { NextResponse } from "next/server";
import { addWatchWallet, createWallet, importWallet, listWallets } from "@/lib/keystore";
import { listUnlockedIds } from "@/lib/state";
import { getEthBalance } from "@/lib/eth";

export async function GET() {
  const wallets = await listWallets();
  const unlocked = new Set(listUnlockedIds());
  const enriched = await Promise.all(
    wallets.map(async (w) => {
      const [eth, base] = await Promise.all([
        getEthBalance(w.address, "ethereum")
          .then((b) => b.eth)
          .catch(() => null),
        getEthBalance(w.address, "base")
          .then((b) => b.eth)
          .catch(() => null),
      ]);
      return {
        ...w,
        unlocked: unlocked.has(w.id),
        balances: { ethereum: eth, base },
      };
    })
  );
  return NextResponse.json({ wallets: enriched });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { mode, label, password, privateKey, address } = body as {
    mode: "create" | "import" | "watch";
    label?: string;
    password?: string;
    privateKey?: string;
    address?: string;
  };

  try {
    let wallet;
    if (mode === "watch") {
      // No password needed — watch-only stores no key material.
      if (!address) return NextResponse.json({ error: "Address required" }, { status: 400 });
      wallet = await addWatchWallet({ address, label });
    } else {
      if (!password) return NextResponse.json({ error: "Password required" }, { status: 400 });
      wallet =
        mode === "import"
          ? await importWallet(privateKey ?? "", label ?? "", password)
          : await createWallet(label ?? "", password);
    }
    return NextResponse.json({
      wallet: {
        id: wallet.id,
        address: wallet.address,
        label: wallet.label,
        kind: wallet.kind ?? "owned",
        createdAt: wallet.createdAt,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
