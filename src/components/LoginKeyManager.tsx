"use client";

import { useEffect, useState } from "react";

// Login keys — an alternate way to sign in. A user creates one while signed in
// via wallet; afterward they can sign in with EITHER the wallet OR the key
// string (on /auth/sign-in). The full key is shown ONCE at creation and is
// thereafter unrecoverable (only its hash is stored).

type LoginKey = {
  id: string;
  keyPrefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

export function LoginKeyManager() {
  const [keys, setKeys] = useState<LoginKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login-key", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Load failed: ${res.status}`);
      setKeys(body.keys ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createKey() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Create failed: ${res.status}`);
      setJustCreated(body.key);
      setLabel("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this login key? Anyone using it to sign in will be locked out.")) return;
    setError(null);
    try {
      const res = await fetch(`/api/auth/login-key?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Revoke failed: ${res.status}`);
      }
      setJustCreated(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {justCreated && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3">
          <div className="font-code text-2xs uppercase tracking-wider text-success">
            login key created — copy it now, you won't see it again
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all border border-border-subtle bg-background px-2 py-1 font-code text-xs text-foreground">
              {justCreated}
            </code>
            <button
              onClick={() => copy(justCreated)}
              className="flex h-7 shrink-0 items-center rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Copy
            </button>
          </div>
          <p className="mt-2 text-xs text-success/80">
            Save it somewhere safe. Paste it on the sign-in page to log in without your wallet.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. phone, backup)"
          className="h-8 flex-1 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none transition-colors focus:border-primary/60"
          maxLength={80}
        />
        <button
          onClick={createKey}
          disabled={creating}
          className="flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create login key"}
        </button>
      </div>

      <div className="rounded-xl border border-border-subtle bg-background overflow-hidden">
        {loading ? (
          <div className="px-4 py-5 text-center font-mono text-xs text-muted-foreground/70">Loading…</div>
        ) : keys.length === 0 ? (
          <div className="px-4 py-5 text-center text-xs text-muted-foreground">
            No login keys yet. Create one to sign in without your wallet.
          </div>
        ) : (
          <ul>
            {keys.map((k) => (
              <li
                key={k.id}
                className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs">
                    <span className="font-mono text-foreground">{k.label ?? "(no label)"}</span>
                    <span className="font-mono text-2xs text-muted-foreground/60">
                      created {new Date(k.createdAt).toLocaleDateString()}
                    </span>
                    {k.lastUsedAt && (
                      <span className="font-mono text-2xs text-muted-foreground/60">
                        · last used {new Date(k.lastUsedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <code className="mt-1 block font-code text-xs text-muted-foreground">
                    {k.keyPrefix}…
                  </code>
                </div>
                <button
                  onClick={() => revoke(k.id)}
                  className="flex h-7 shrink-0 items-center rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground/70">
        A login key is like a password — anyone with it can sign in to your account. Store it safely
        and revoke it if it leaks. Your wallet still works as a sign-in method either way.
      </p>
    </div>
  );
}
