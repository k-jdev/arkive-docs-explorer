"use client";

import { useEffect, useState } from "react";

type Token = {
  token: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

export function McpTokenManager({ mcpUrl }: { mcpUrl: string }) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  // The full token is only ever returned once at creation. Track it locally so the
  // user can copy it before navigating away. After page reload, we only have the
  // stored row from /api/auth/mcp-token GET, which is the same string anyway —
  // so masking is purely a UX hint that "you already saw this once."
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [justCreated, setJustCreated] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/mcp-token", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Load failed: ${res.status}`);
      setTokens(body.tokens ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createToken() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/mcp-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Create failed: ${res.status}`);
      setJustCreated(body.token);
      setRevealed((s) => new Set([...s, body.token]));
      setNewLabel("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(token: string) {
    if (!confirm("Revoke this token? Any Claude client using it will lose access.")) return;
    try {
      const res = await fetch(`/api/auth/mcp-token?token=${encodeURIComponent(token)}`, {
        method: "DELETE",
      });
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

  function maskToken(t: string) {
    return `${t.slice(0, 9)}…${t.slice(-4)}`;
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  const activeToken = justCreated ?? tokens[0]?.token ?? null;

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
            token created — copy it now
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
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Label (e.g. laptop, phone)"
          className="h-8 flex-1 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none transition-colors focus:border-primary/60"
          maxLength={80}
        />
        <button
          onClick={createToken}
          disabled={creating}
          className="flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Generate token"}
        </button>
      </div>

      <div className="rounded-xl border border-border-subtle bg-background overflow-hidden">
        {loading ? (
          <div className="px-4 py-5 text-center font-mono text-xs text-muted-foreground/70">
            Loading tokens…
          </div>
        ) : tokens.length === 0 ? (
          <div className="px-4 py-5 text-center text-xs text-muted-foreground">
            No tokens yet. Generate one above.
          </div>
        ) : (
          <ul>
            {tokens.map((t) => {
              const isRevealed = revealed.has(t.token);
              return (
                <li
                  key={t.token}
                  className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 text-xs">
                      <span className="font-mono text-foreground">{t.label ?? "(no label)"}</span>
                      <span className="font-mono text-2xs text-muted-foreground/60">
                        created {new Date(t.createdAt).toLocaleDateString()}
                      </span>
                      {t.lastUsedAt && (
                        <span className="font-mono text-2xs text-muted-foreground/60">
                          · last used {new Date(t.lastUsedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="font-code text-xs text-muted-foreground">
                        {isRevealed ? t.token : maskToken(t.token)}
                      </code>
                      {isRevealed ? (
                        <button
                          onClick={() => copy(t.token)}
                          className="font-code text-2xs uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-foreground"
                        >
                          copy
                        </button>
                      ) : (
                        <button
                          onClick={() => setRevealed((s) => new Set([...s, t.token]))}
                          className="font-code text-2xs uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-foreground"
                        >
                          reveal
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => revokeToken(t.token)}
                    className="flex h-7 shrink-0 items-center rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors duration-120 hover:border-destructive/40 hover:text-destructive"
                  >
                    Revoke
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {activeToken && (
        <div className="rounded-xl border border-border-subtle bg-background overflow-hidden">
          <div className="flex h-8 items-center justify-between border-b border-border-subtle px-3">
            <span className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
              claude code · cli
            </span>
            <button
              onClick={() =>
                copy(
                  `claude mcp add --transport http arkive ${mcpUrl} --header "x-arkive-token: ${activeToken}"`
                )
              }
              className="font-code text-2xs uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              copy
            </button>
          </div>
          <pre className="overflow-x-auto p-3 font-code text-xs leading-relaxed text-foreground">
            <code>{`claude mcp add --transport http arkive ${mcpUrl} --header "x-arkive-token: ${activeToken}"`}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
