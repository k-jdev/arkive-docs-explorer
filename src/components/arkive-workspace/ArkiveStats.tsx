// Dashboard — aggregates over the arkive-core-v1 bundle.
//
// KPI strip → heatmap → composition donut → recent commits.
// ("By practice" was folded into the composition legend — the full table
// lives on the arkives overview.)

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArkiveHeatmap, buildDaysFromEntries } from "./ArkiveHeatmap";
import { PracticeSizeChart } from "./PracticeSizeChart";
import { useFolderColors } from "./folder-colors";
import type { Bundle, Entry } from "./types";

export function ArkiveStats() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Shared with the explorer — painting a practice folder there updates
  // its slice color here on the next render.
  const { colors: folderColors } = useFolderColors();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/arkive-v2/bundle", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Failed");
      setBundle(j);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allEntries = useMemo(() => {
    if (!bundle) return [];
    const out: Array<{ path: string; type: string; meta: Record<string, unknown> }> = [];
    if (bundle.identity) {
      out.push({ path: bundle.identity.path, type: "identity", meta: bundle.identity.meta });
    }
    for (const p of bundle.practices) {
      for (const e of p.context) {
        out.push({ path: e.path, type: (e.meta.entity_type as string) ?? "context", meta: e.meta });
      }
      for (const e of p.recent_journal) {
        out.push({ path: e.path, type: (e.meta.entity_type as string) ?? "journal", meta: e.meta });
      }
      for (const e of p.pending_insights) {
        out.push({ path: e.path, type: "insight", meta: e.meta });
      }
    }
    return out;
  }, [bundle]);

  const totalEntries = useMemo(() => {
    if (!bundle) return 0;
    return bundle.practices.reduce((sum, p) => sum + p.entry_count, 0);
  }, [bundle]);

  const days = useMemo(() => buildDaysFromEntries(allEntries), [allEntries]);

  const recent = useMemo(() => {
    const items = allEntries.map((e) => ({ ...e, ts: pickTimestamp(e.meta, e.path) }));
    items.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    return items.slice(0, 12);
  }, [allEntries]);

  const lastActivity = recent[0]?.ts ?? null;

  if (loading && !bundle)
    return (
      <div className="font-mono text-xs text-muted-foreground/70">Loading stats…</div>
    );
  if (error) return <div className="text-sm text-destructive">Failed to load: {error}</div>;
  if (!bundle) return null;

  const totalPendingInsights = bundle.practices.reduce(
    (sum, p) => sum + p.pending_insights.length,
    0
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 rounded-xl border border-border-subtle bg-panel sm:grid-cols-4">
        <Kpi label="Entries" value={totalEntries} />
        <Kpi
          label="Active practices"
          value={bundle.practices.filter((p) => p.mode === "active").length}
        />
        <Kpi label="Pending insights" value={totalPendingInsights} />
        <Kpi label="Last activity" value={formatRelative(lastActivity)} last />
      </div>

      <ArkiveHeatmap days={days} />

      <PracticeSizeChart
        folderColors={folderColors}
        slices={bundle.practices.map((p) => ({
          name: p.name,
          display_name: p.config?.name ?? p.name,
          count: p.entry_count,
        }))}
      />

      <section className="rounded-xl border border-border-subtle bg-panel overflow-hidden">
        <div className="flex h-9 items-center justify-between border-b border-border-subtle px-3">
          <span className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
            recent commits
          </span>
          <Link
            href="/arkives"
            className="font-code text-2xs uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            open workspace →
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">No recent activity.</p>
        ) : (
          <ul>
            {recent.map((r) => (
              <li key={r.path} className="border-b border-border-subtle last:border-b-0">
                <Link
                  href={`/arkives?file=${encodeURIComponent(r.path)}`}
                  className="grid grid-cols-[96px_1fr_auto] items-center gap-4 px-3 py-2 transition-colors duration-120 hover:bg-secondary/40"
                  title={r.path}
                >
                  <span className="truncate font-code text-2xs uppercase tracking-wider text-muted-foreground/60">
                    {r.type}
                  </span>
                  <span className="truncate font-code text-xs text-foreground/90">
                    {r.path.replace(/^arkive\//, "")}
                  </span>
                  <span className="font-mono text-2xs text-muted-foreground/70">
                    {formatRelative(r.ts)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, last }: { label: string; value: number | string; last?: boolean }) {
  return (
    <div className={`px-4 py-3 ${last ? "" : "sm:border-r sm:border-border-subtle"}`}>
      <div className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg text-foreground">{value}</div>
    </div>
  );
}

function pickTimestamp(meta: Record<string, unknown> | undefined, path: string): number | null {
  if (meta) {
    for (const k of ["created_at", "last_updated", "timestamp"]) {
      const v = meta[k];
      if (typeof v === "string") {
        const t = Date.parse(v);
        if (Number.isFinite(t)) return t;
      }
    }
  }
  const m = path.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) {
    const t = Date.parse(m[1]);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

function formatRelative(ts: number | null): string {
  if (ts === null) return "—";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export type { Entry };
