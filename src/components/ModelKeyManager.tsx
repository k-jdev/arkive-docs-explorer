"use client";

import { useEffect, useState } from "react";

// Per-user model-provider API keys. These feed the autonomous Daydream loop —
// it calls the user's active provider with their own credential. Keys are
// encrypted at rest server-side; this UI only ever sees a masked hint.

type ModelKey = {
  provider: string;
  keyHint: string;
  label: string | null;
  isActive: boolean;
  runnable: boolean;
  createdAt: string;
  updatedAt: string;
};

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  openrouter: "OpenRouter (any model)",
  google: "Google (Gemini)",
  xai: "xAI (Grok)",
  deepseek: "DeepSeek",
  mistral: "Mistral",
};

export function ModelKeyManager() {
  const [keys, setKeys] = useState<ModelKey[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [runnable, setRunnable] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState("anthropic");
  const [keyValue, setKeyValue] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/keys/model", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Load failed: ${res.status}`);
      setKeys(body.keys ?? []);
      setProviders(body.providers ?? []);
      setRunnable(body.runnable ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function saveKey() {
    if (!keyValue.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/keys/model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          key: keyValue.trim(),
          label: label.trim() || null,
          // first key auto-activates server-side; explicit when it's a runnable provider
          makeActive: runnable.includes(provider),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Save failed: ${res.status}`);
      setKeyValue("");
      setLabel("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function makeActive(p: string) {
    setError(null);
    try {
      const res = await fetch("/api/keys/model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: p, setActive: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Failed: ${res.status}`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeKey(p: string) {
    if (!confirm(`Remove your ${PROVIDER_LABEL[p] ?? p} key? Daydream loses access to that provider.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/keys/model?provider=${encodeURIComponent(p)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Remove failed: ${res.status}`);
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Add / replace */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
            provider
          </span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors focus:border-primary/60"
          >
            {(providers.length ? providers : ["anthropic", "openai", "openrouter"]).map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p] ?? p}
                {runnable.length && !runnable.includes(p) ? " · stored only" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[180px] flex-1 flex-col gap-1">
          <span className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
            api key
          </span>
          <input
            type="password"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            placeholder="sk-… / sk-ant-… / sk-or-…"
            autoComplete="off"
            className="h-8 rounded-lg border border-border bg-background px-2.5 font-code text-xs text-foreground outline-none transition-colors focus:border-primary/60"
          />
        </label>
        <label className="flex w-[120px] flex-col gap-1">
          <span className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
            label
          </span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="optional"
            maxLength={80}
            className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none transition-colors focus:border-primary/60"
          />
        </label>
        <button
          onClick={saveKey}
          disabled={saving || !keyValue.trim()}
          className="flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save key"}
        </button>
      </div>

      {/* List */}
      <div className="rounded-xl border border-border-subtle bg-background overflow-hidden">
        {loading ? (
          <div className="px-4 py-5 text-center font-mono text-xs text-muted-foreground/70">Loading…</div>
        ) : keys.length === 0 ? (
          <div className="px-4 py-5 text-center text-xs text-muted-foreground">
            No model keys yet. Add one above — the Daydream loop uses your active provider.
          </div>
        ) : (
          <ul>
            {keys.map((k) => (
              <li
                key={k.provider}
                className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs">
                    <span className="font-mono text-foreground">{PROVIDER_LABEL[k.provider] ?? k.provider}</span>
                    {k.isActive && (
                      <span className="rounded-sm bg-agent/15 px-1.5 py-0.5 font-code text-2xs uppercase tracking-wider text-agent">
                        active · daydream
                      </span>
                    )}
                    {!k.runnable && (
                      <span className="font-code text-2xs uppercase tracking-wider text-muted-foreground/50">
                        stored · client soon
                      </span>
                    )}
                    {k.label && <span className="text-2xs text-muted-foreground/60">{k.label}</span>}
                  </div>
                  <div className="mt-1 font-code text-xs text-muted-foreground">
                    key {k.keyHint} · added {new Date(k.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!k.isActive && k.runnable && (
                    <button
                      onClick={() => makeActive(k.provider)}
                      className="flex h-7 items-center rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:border-agent/40 hover:text-agent"
                    >
                      Set active
                    </button>
                  )}
                  <button
                    onClick={() => removeKey(k.provider)}
                    className="flex h-7 items-center rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground/70">
        Keys are encrypted at rest and never shown again after saving. The active provider is the one
        the Daydream loop calls. Anthropic, OpenAI, and OpenRouter run today; others are stored for
        when their client lands.
      </p>
    </div>
  );
}
