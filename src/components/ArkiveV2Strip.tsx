"use client";

/**
 * Arkive control strip — sits ABOVE the file-tree/graph browser.
 *
 * Always-visible toolbar (Reset / Download), plus conditional sections:
 *   - Migration banner when v2 root files aren't present yet
 *   - Pending insights review queue when there are any
 *
 * Reset wipes EVERY entry the user owns and reseeds v2 fresh — used when
 * the user wants to start over (especially useful if their data still has
 * the old v1 layout because they never ran the migration).
 *
 * Download zips the entire arkive (every path, every body) into a single
 * .zip the user can keep on disk and inspect in any markdown editor.
 */

import { useCallback, useEffect, useState } from "react";

type Entry = { path: string; meta: Record<string, unknown>; body: string };

type Bundle = {
  protocol: { path: string; body: string } | null;
  pending_insights: Entry[];
};

export function ArkiveV2Strip({ onChange }: { onChange?: () => void }) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [expandedInsights, setExpandedInsights] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/arkive-v2/bundle", { cache: "no-store" });
      if (!r.ok) {
        setBundle({ protocol: null, pending_insights: [] });
        return;
      }
      const j = await r.json();
      setBundle({ protocol: j.protocol, pending_insights: j.pending_insights ?? [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function migrate() {
    if (!confirm("Archive every legacy v1 entry under archive_v1/ and seed the v2 root files? Idempotent — safe to run again.")) return;
    setMigrating(true);
    try {
      const r = await fetch("/api/arkive-v2/migrate", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Failed");
      alert(`Migration complete:\n- archived: ${j.archived}\n- skipped: ${j.skipped}\n- already v2: ${j.alreadyV2}\n- seeded: ${(j.seeded ?? []).length} root files`);
      await load();
      onChange?.();
    } catch (e) {
      alert(`Migration failed: ${(e as Error).message}`);
    } finally {
      setMigrating(false);
    }
  }

  async function reset() {
    if (
      !confirm(
        "RESET — this DELETES every arkive entry you own (v2 + any legacy archive_v1) and reseeds a fresh v2 arkive. This cannot be undone. Download a backup first if you want to keep anything. Continue?"
      )
    )
      return;
    if (!confirm("Last chance. All entries will be gone.")) return;
    setResetting(true);
    try {
      const r = await fetch("/api/arkive-v2/reset", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Failed");
      alert(`Reset complete:\n- deleted: ${j.deleted} entries\n- seeded: ${(j.seeded ?? []).length} root files\n- protocol: ${j.protocolVersion}`);
      await load();
      onChange?.();
    } catch (e) {
      alert(`Reset failed: ${(e as Error).message}`);
    } finally {
      setResetting(false);
    }
  }

  async function download() {
    setDownloading(true);
    try {
      const r = await fetch("/api/arkive-v2/export");
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `Download failed: ${r.status}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `arkive-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  async function decide(insight: Entry, decision: "accepted" | "rejected") {
    const comment = prompt(`${decision === "accepted" ? "Accept" : "Reject"} insight. Optional comment:`, "");
    if (comment === null) return;
    try {
      const r = await fetch("/api/arkive-v2/insight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ insightPath: insight.path, decision, userComment: comment }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Failed");
      await load();
      onChange?.();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  if (loading && !bundle) {
    return (
      <div className="mb-6 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        Loading arkive state…
      </div>
    );
  }
  if (!bundle) return null;

  const notMigrated = !bundle.protocol;
  const pendingCount = bundle.pending_insights.length;

  return (
    <div className="mb-6 space-y-3">
      {/* ---------- always-visible toolbar ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="text-xs text-muted-foreground">
          {notMigrated
            ? "Your arkive is on the legacy v1 layout."
            : "v2 substrate active."}{" "}
          {pendingCount > 0 && (
            <span className="text-warning">
              · {pendingCount} insight{pendingCount === 1 ? "" : "s"} pending review
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={download}
            disabled={downloading}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50"
            title="Download every entry as a .zip"
          >
            {downloading ? "Zipping…" : "↓ Download"}
          </button>
          {notMigrated && (
            <button
              onClick={migrate}
              disabled={migrating}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
              title="Archive legacy v1 entries under archive_v1/ and seed v2 root files"
            >
              {migrating ? "Migrating…" : "Run v2 migration"}
            </button>
          )}
          <button
            onClick={reset}
            disabled={resetting}
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50"
            title="Wipe every entry and reseed a fresh v2 arkive — destructive"
          >
            {resetting ? "Resetting…" : "Reset"}
          </button>
        </div>
      </div>

      {/* ---------- pending insights review queue ---------- */}
      {pendingCount > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <button
            type="button"
            onClick={() => setExpandedInsights((e) => !e)}
            className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors duration-120 hover:bg-secondary/50"
          >
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium text-warning">
                {pendingCount}
              </span>
              <span className="text-sm font-medium">Pending insight{pendingCount === 1 ? "" : "s"} to review</span>
            </div>
            <span className="text-xs text-muted-foreground">{expandedInsights ? "Collapse" : "Expand"}</span>
          </button>

          {expandedInsights && (
            <ul className="divide-y divide-border border-t border-border">
              {bundle.pending_insights.map((ins) => (
                <li key={ins.path} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
                          {String(ins.meta.insight_type ?? "insight")}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-medium">{String(ins.meta.target_skill ?? "—")}</span>
                        <span className="text-xs text-muted-foreground">
                          signal {Number(ins.meta.signal_strength ?? 0).toFixed(2)}
                        </span>
                      </div>
                      <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
                        {ins.body.slice(0, 1200)}
                      </pre>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <button
                        onClick={() => decide(ins, "accepted")}
                        className="rounded-lg bg-success px-3 py-1 text-xs font-semibold text-white hover:bg-success/90"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => decide(ins, "rejected")}
                        className="rounded-lg border border-border px-3 py-1 text-xs font-medium hover:bg-secondary"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
