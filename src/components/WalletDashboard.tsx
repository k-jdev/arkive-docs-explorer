"use client";

import { useEffect, useState, useCallback } from "react";

type WalletKind = "owned" | "watch";

type Wallet = {
  id: string;
  address: `0x${string}`;
  label: string;
  kind: WalletKind;
  createdAt: number;
  purpose?: string | null;
  tags?: string[];
  unlocked: boolean;
  balances: { ethereum: string | null; base: string | null };
};

export function WalletDashboard() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/wallets", { cache: "no-store" });
      const data = await res.json();
      setWallets(data.wallets ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        {loading && wallets.length === 0 ? (
          <div className="rounded-xl border border-border-subtle bg-panel p-6 font-mono text-xs text-muted-foreground/70">
            Loading wallets…
          </div>
        ) : wallets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-panel p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No wallets yet. Create, import, or add a watch-only address.
            </p>
          </div>
        ) : (
          wallets.map((w) => <WalletCard key={w.id} wallet={w} onChange={refresh} />)
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <NewWalletPanel onCreated={refresh} />
    </div>
  );
}

function WalletCard({ wallet, onChange }: { wallet: Wallet; onChange: () => void }) {
  const [unlocking, setUnlocking] = useState(false);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isWatch = wallet.kind === "watch";

  async function unlock() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/wallets/${wallet.id}/unlock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to unlock");
      setUnlocking(false);
      setPassword("");
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    await fetch(`/api/wallets/${wallet.id}/unlock`, { method: "DELETE" });
    onChange();
  }

  async function remove() {
    const msg = isWatch
      ? `Remove watch-only wallet ${wallet.label}? You can re-add the address any time.`
      : `Delete wallet ${wallet.label}?\n\nMake sure you've backed up the private key — this cannot be undone.`;
    if (!confirm(msg)) return;
    await fetch(`/api/wallets/${wallet.id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-panel overflow-hidden">
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-sans text-sm text-foreground">{wallet.label}</h3>
            {isWatch ? (
              <StatusChip tone="neutral" label="watch-only" />
            ) : wallet.unlocked ? (
              <StatusChip tone="active" label="unlocked" />
            ) : (
              <StatusChip tone="neutral" label="locked" />
            )}
          </div>
          <p className="mt-1 truncate font-code text-xs tabular-nums text-muted-foreground/70">
            {wallet.address}
          </p>
          {(wallet.purpose || (wallet.tags && wallet.tags.length > 0)) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {wallet.purpose && (
                <span className="rounded-sm border border-border px-1.5 py-px font-code text-2xs uppercase tracking-wider text-muted-foreground">
                  {wallet.purpose}
                </span>
              )}
              {wallet.tags?.map((t) => (
                <span
                  key={t}
                  className="rounded-sm border border-border-subtle px-1.5 py-px font-code text-2xs uppercase tracking-wider text-muted-foreground/60"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
            Balance
          </div>
          <div className="mt-1 space-y-0.5 font-mono text-xs tabular-nums text-foreground">
            <div>
              <span className="mr-1.5 text-2xs uppercase text-muted-foreground/60">eth</span>
              {wallet.balances.ethereum !== null ? Number(wallet.balances.ethereum).toFixed(5) : "—"}
            </div>
            <div>
              <span className="mr-1.5 text-2xs uppercase text-muted-foreground/60">base</span>
              {wallet.balances.base !== null ? Number(wallet.balances.base).toFixed(5) : "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-2.5">
        {isWatch ? (
          <span className="text-xs text-muted-foreground/70">
            Read-only. Chain reads, portfolio, and arkive sync work; signing is disabled.
          </span>
        ) : wallet.unlocked ? (
          <button
            onClick={lock}
            className="flex h-7 items-center rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors duration-120 hover:bg-secondary hover:text-foreground"
          >
            Lock
          </button>
        ) : unlocking ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
            className="flex flex-1 items-center gap-2"
          >
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Wallet password"
              className="h-7 flex-1 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none transition-colors focus:border-primary/60"
            />
            <button
              type="submit"
              disabled={busy}
              className="flex h-7 items-center rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "…" : "Unlock"}
            </button>
            <button
              type="button"
              onClick={() => {
                setUnlocking(false);
                setPassword("");
                setErr(null);
              }}
              className="text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            onClick={() => setUnlocking(true)}
            className="flex h-7 items-center rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Unlock for Claude
          </button>
        )}
        <div className="ml-auto" />
        <button
          onClick={remove}
          className="flex h-7 items-center rounded-lg border border-transparent px-2.5 text-xs text-muted-foreground/60 transition-colors duration-120 hover:border-destructive/40 hover:text-destructive"
        >
          {isWatch ? "Remove" : "Delete"}
        </button>
      </div>
      {err && <p className="border-t border-border-subtle px-4 py-2 text-xs text-destructive">{err}</p>}
    </div>
  );
}

/** Square status chip — dot + mono micro-label. Teal dot = live/unlocked. */
function StatusChip({ tone, label }: { tone: "active" | "neutral"; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-sm border border-border px-1.5 py-px">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${tone === "active" ? "bg-success" : "bg-muted-foreground/40"}`}
      />
      <span className="font-code text-2xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </span>
  );
}

function NewWalletPanel({ onCreated }: { onCreated: () => void }) {
  const [mode, setMode] = useState<"create" | "import" | "watch">("create");
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [address, setAddress] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, string> = { mode, label };
      if (mode === "watch") {
        body.address = address;
      } else {
        body.password = password;
        if (mode === "import") body.privateKey = privateKey;
      }
      const res = await fetch("/api/wallets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setLabel("");
      setPassword("");
      setPrivateKey("");
      setAddress("");
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="h-fit rounded-xl border border-border-subtle bg-panel overflow-hidden">
      <div className="flex h-9 items-center border-b border-border-subtle px-3">
        <span className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
          add wallet
        </span>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-3 rounded-lg border border-border-subtle bg-background p-0.5 text-xs">
          <ModeTab active={mode === "create"} onClick={() => setMode("create")}>
            Create
          </ModeTab>
          <ModeTab active={mode === "import"} onClick={() => setMode("import")}>
            Import
          </ModeTab>
          <ModeTab active={mode === "watch"} onClick={() => setMode("watch")}>
            Watch
          </ModeTab>
        </div>

        {mode === "watch" && (
          <p className="mt-3 rounded-lg border border-border-subtle bg-background px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            Adds a wallet by address. Read tools work as usual; signing is disabled and no
            private key is stored.
          </p>
        )}

        <form onSubmit={submit} className="mt-4 space-y-3">
          <Field label="Label">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={mode === "watch" ? "Vault" : "Trading wallet"}
              className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none transition-colors focus:border-primary/60"
            />
          </Field>
          {mode === "import" && (
            <Field label="Private key">
              <input
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="0xabc…"
                className="h-8 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-xs tabular-nums text-foreground outline-none transition-colors focus:border-primary/60"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          )}
          {mode === "watch" && (
            <Field label="Address">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x0000…0000"
                className="h-8 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-xs tabular-nums text-foreground outline-none transition-colors focus:border-primary/60"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </Field>
          )}
          {mode !== "watch" && (
            <Field label="Encryption password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                minLength={8}
                required
                className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none transition-colors focus:border-primary/60"
              />
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground/60">
                Encrypts the key on disk. There is no recovery if you lose it.
              </p>
            </Field>
          )}
          <button
            type="submit"
            disabled={busy}
            className="h-8 w-full rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? "Saving…"
              : mode === "create"
                ? "Create wallet"
                : mode === "import"
                  ? "Import wallet"
                  : "Add watch-only wallet"}
          </button>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </form>
      </div>
    </aside>
  );
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "h-7 rounded-lg transition-colors duration-120 " +
        (active
          ? "bg-secondary font-medium text-foreground"
          : "text-muted-foreground/70 hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
        {label}
      </span>
      {children}
    </label>
  );
}
