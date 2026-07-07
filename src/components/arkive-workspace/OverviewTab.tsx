// Overview tab — compact header + stat strip + the full d3 force-directed
// Arkive graph in an instrument-panel frame + practices as a data table.
//
// The graph hangs off `/api/arkive-v2/index-graph` (derived from
// arkive.index) for typed cross-file edges. Node metadata + bodies come
// from the bundle (only entries actually loaded carry an excerpt; the
// rest fall back to path-derived synthetic details — still hoverable).
//
// Folder colors flow through ArkiveGraph so painting a folder in the
// explorer instantly recolors its constellation in the graph.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Sparkles } from "lucide-react";
import { ArkiveGraph, EDGE_COLOR, type Backlink, type NodeDetail } from "@/components/ArkiveGraph";
import type { Bundle, TreeNode } from "./types";
import type { FolderColors } from "./folder-colors";

type Props = {
  bundle: Bundle;
  root: TreeNode;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  /** Toggle a folder's expansion — shared with the file explorer so a
   *  click in the graph opens the folder in both panels. */
  onToggleFolder: (path: string) => void;
  onReset: () => void;
  onDownload: () => void;
  /** Open the Daydreams tab (Notices + proposals from the autonomous loop). */
  onOpenDaydreams: () => void;
  resetting: boolean;
  downloading: boolean;
  externalHoverPath?: string | null;
  expandedPaths?: Set<string>;
  folderColors: FolderColors;
  onExpandAll: () => void;
  onCollapseAll: () => void;
};

type IndexEdge = { from: string; to: string; type: string };
type IndexNode = { path: string; type: string; title?: string; timestamp?: string };

export function OverviewTab({
  bundle,
  root,
  selectedPath,
  onSelectFile,
  onToggleFolder,
  onReset,
  onDownload,
  onOpenDaydreams,
  resetting,
  downloading,
  externalHoverPath,
  expandedPaths,
  folderColors,
  onExpandAll,
  onCollapseAll,
}: Props) {
  const [allExpanded, setAllExpanded] = useState(false);

  function toggleExpandAll() {
    const next = !allExpanded;
    setAllExpanded(next);
    if (next) onExpandAll();
    else onCollapseAll();
  }
  // Graph folder clicks land here. "" = background click (camera reset only,
  // nothing to toggle); the master node never reaches this since ArkiveGraph
  // only forwards real folder paths.
  const handleFocusFolder = useCallback(
    (path: string) => {
      if (path) onToggleFolder(path);
    },
    [onToggleFolder]
  );

  const totalEntries = bundle.practices.reduce((s, p) => s + p.entry_count, 0);
  const activeCount = bundle.practices.filter((p) => p.mode === "active").length;
  const pendingTotal = bundle.practices.reduce((s, p) => s + p.pending_insights.length, 0);

  // ---- Index graph fetch (typed cross-file edges) ----
  const [edges, setEdges] = useState<IndexEdge[]>([]);
  const [indexNodes, setIndexNodes] = useState<IndexNode[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/arkive-v2/index-graph", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        setEdges(j.edges ?? []);
        setIndexNodes(j.nodes ?? []);
      })
      .catch(() => {
        /* swallow — graph still renders with structural links only */
      });
    return () => {
      cancelled = true;
    };
  }, [bundle.index_last_updated]);

  // Universe of paths the graph can actually render — bundle root files,
  // every practice's all_paths, recent observations, and any path the index
  // knows about (which covers older journal entries the bundle didn't bulk-
  // load). Used to filter out broken backlinks BEFORE they reach the graph —
  // a backlink to a path that doesn't exist anywhere just produces a "line
  // to nowhere" with a ghost dot at the end, which looks like a bug.
  const knownPaths = useMemo(() => {
    const s = new Set<string>();
    if (bundle.protocol) s.add(bundle.protocol.path);
    if (bundle.identity) s.add(bundle.identity.path);
    if (bundle.loadup) s.add(bundle.loadup.path);
    for (const p of bundle.practices) {
      for (const path of p.all_paths ?? []) s.add(path);
    }
    for (const obs of bundle.recent_observations ?? []) s.add(obs.path);
    for (const n of indexNodes) s.add(n.path);
    return s;
  }, [bundle, indexNodes]);

  const backlinks = useMemo<Backlink[]>(
    () =>
      edges
        .filter((e) => knownPaths.has(e.from) && knownPaths.has(e.to))
        .map((e) => ({
          from: e.from,
          to: e.to,
          type: e.type,
        })),
    [edges, knownPaths]
  );

  // Edge types actually present, in EDGE_COLOR declaration order, unknown
  // types last — drives the legend in the graph panel header.
  const presentEdgeTypes = useMemo(() => {
    const present = new Set(backlinks.map((b) => b.type ?? ""));
    present.delete("");
    const known = Object.keys(EDGE_COLOR).filter((t) => present.has(t));
    const unknown = [...present].filter((t) => !(t in EDGE_COLOR)).sort();
    return [...known, ...unknown];
  }, [backlinks]);

  // Derive a hover-popup detail map. Prefer the bundle-loaded body (we have
  // an excerpt); fall back to index metadata (just type) for everything
  // else — popups still render, just without an excerpt.
  const nodeDetails = useMemo(() => {
    const map = new Map<string, NodeDetail>();
    function add(path: string, type: string, body: string | undefined, metaTitle?: unknown) {
      const title =
        (typeof metaTitle === "string" && metaTitle) ||
        deriveTitle(body ?? "") ||
        path.split("/").pop()?.replace(/\.md$/, "") ||
        path;
      map.set(path, { title, type, excerpt: bodyExcerpt(body ?? "") });
    }
    // First pass — bundle-loaded entries (have bodies)
    if (bundle.protocol) add(bundle.protocol.path, "protocol", bundle.protocol.body, "arkive.protocol");
    if (bundle.identity)
      add(bundle.identity.path, "identity", bundle.identity.body, (bundle.identity.meta as Record<string, unknown>).title);
    for (const p of bundle.practices) {
      for (const e of p.context) add(e.path, String(e.meta.entity_type ?? "context"), e.body, e.meta.title);
      for (const e of p.recent_journal)
        add(e.path, String(e.meta.entity_type ?? "journal"), e.body, e.meta.title ?? e.meta.asset);
      for (const e of p.pending_insights)
        add(e.path, "insight", e.body, e.meta.title ?? e.meta.summary);
    }
    // Second pass — index-only entries (no body in bundle, fallback type)
    for (const n of indexNodes) {
      if (!map.has(n.path)) {
        add(n.path, n.type, undefined, n.title);
      }
    }
    return map;
  }, [bundle, indexNodes]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1240px] px-8 pb-12 pt-7">
        {/* ---- Header ---- */}
        <div className="flex items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="font-code text-2xs uppercase tracking-[0.18em] text-muted-foreground/60">
              {bundle.config?.version ?? "arkive-core"}
            </div>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-foreground">
              Arkive
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              User-owned memory. One universal core, plus the practices that plug into it.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onOpenDaydreams}
              className="flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors duration-120 hover:bg-secondary hover:text-foreground"
            >
              <Sparkles size={12} strokeWidth={1.5} />
              <span>Daydreams</span>
              {bundle.daydream_count > 0 && (
                <span className="rounded-full bg-agent/15 px-1.5 py-px font-mono text-2xs text-agent">
                  {bundle.daydream_count}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={onDownload}
              disabled={downloading}
              className="flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors duration-120 hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              <Download size={12} strokeWidth={1.5} />
              <span>{downloading ? "Exporting…" : "Export"}</span>
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={resetting}
              className="flex h-7 items-center rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors duration-120 hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
            >
              {resetting ? "Resetting…" : "Reset"}
            </button>
          </div>
        </div>

        {/* ---- Stat strip ---- */}
        <div className="mt-6 grid grid-cols-2 rounded-xl border border-border-subtle bg-panel sm:grid-cols-4">
          <Stat label="Entries" value={totalEntries} />
          <Stat
            label="Practices"
            value={bundle.practices.length}
            detail={
              activeCount === bundle.practices.length
                ? bundle.practices.length === 1
                  ? "active"
                  : "all active"
                : `${activeCount} active`
            }
          />
          <Stat label="Pending insights" value={pendingTotal} />
          <Stat label="Cross-file edges" value={backlinks.length} last />
        </div>

        {/* ---- Graph panel ---- */}
        <div className="mt-4 rounded-xl border border-border-subtle bg-panel overflow-hidden">
          <div className="flex h-9 items-center justify-between gap-4 border-b border-border-subtle px-3">
            <span className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
              index-graph
            </span>
            {presentEdgeTypes.length > 0 && (
              <div className="flex min-w-0 items-center gap-3 overflow-hidden">
                {presentEdgeTypes.map((t) => (
                  <span key={t} className="flex shrink-0 items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="h-px w-3"
                      style={{ background: EDGE_COLOR[t] ?? "#2E68F4" }}
                    />
                    <span className="font-code text-2xs uppercase tracking-wider text-muted-foreground/60">
                      {t}
                    </span>
                  </span>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={toggleExpandAll}
              className="ml-auto flex items-center gap-2 text-muted-foreground/60 transition-colors hover:text-foreground"
              title={allExpanded ? "Collapse all nodes" : "Expand all nodes"}
            >
              <span className="font-code text-2xs uppercase tracking-wider">
                {allExpanded ? "collapse" : "expand"} all
              </span>
              {/* Toggle track */}
              <span
                className={`relative inline-flex h-3.5 w-6 shrink-0 rounded-full transition-colors duration-200 ${
                  allExpanded ? "bg-primary" : "bg-muted-foreground/20"
                }`}
              >
                <span
                  className={`absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-all duration-200 ${
                    allExpanded ? "left-[13px]" : "left-px"
                  }`}
                />
              </span>
            </button>
          </div>
          <div className="relative h-[560px] w-full">
            {/* Dot-grid canvas + center vignette — sits behind the SVG. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: "radial-gradient(hsl(var(--border) / 0.5) 1px, transparent 1px)",
                backgroundSize: "22px 22px",
                backgroundPosition: "center",
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse 75% 65% at 50% 45%, transparent 35%, hsl(var(--panel)) 100%)",
              }}
            />
            <ArkiveGraph
              root={root}
              backlinks={backlinks}
              nodeDetails={nodeDetails}
              focusedPath={selectedPath}
              externalHoverPath={externalHoverPath}
              expandedPaths={expandedPaths}
              folderColors={folderColors}
              onFocusFolder={handleFocusFolder}
              onSelectFile={onSelectFile}
            />
          </div>
          <div className="flex h-7 items-center justify-between border-t border-border-subtle px-3">
            <span className="font-code text-2xs uppercase tracking-wider text-muted-foreground/50">
              scroll to zoom · drag to move · click a file to open
            </span>
            <span className="font-mono text-2xs tracking-wider text-muted-foreground/50">
              index updated {formatStamp(bundle.index_last_updated)}
            </span>
          </div>
        </div>

        {/* ---- Practices table ---- */}
        <div className="mt-4 rounded-xl border border-border-subtle bg-panel overflow-hidden">
          <div className="flex h-9 items-center justify-between border-b border-border-subtle px-3">
            <span className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
              practices
            </span>
            <span className="font-mono text-2xs text-muted-foreground/60">
              {bundle.practices.length}
            </span>
          </div>
          {bundle.practices.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No practices installed.</p>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border-subtle">
                  <Th>Practice</Th>
                  <Th>Mode</Th>
                  <Th align="right">Entries</Th>
                  <Th align="right">Pending</Th>
                  <Th align="right">Context</Th>
                  <Th align="right">Skills</Th>
                </tr>
              </thead>
              <tbody>
                {bundle.practices.map((p) => (
                  <tr
                    key={p.name}
                    className="border-b border-border-subtle transition-colors duration-120 last:border-b-0 hover:bg-secondary/40"
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-code text-xs text-foreground">
                          {p.config?.name ?? p.name}
                        </span>
                        {p.name === "trading" && (
                          <span className="rounded-sm border border-border px-1 py-px font-code text-2xs uppercase tracking-wider text-muted-foreground/70">
                            verified
                          </span>
                        )}
                      </div>
                      {p.config?.description && (
                        <p className="mt-0.5 max-w-[480px] truncate text-xs text-muted-foreground/70">
                          {p.config.description}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 rounded-full ${
                            p.mode === "active" ? "bg-success" : "bg-muted-foreground/40"
                          }`}
                        />
                        <span className="font-code text-2xs uppercase tracking-wider text-muted-foreground">
                          {p.mode}
                        </span>
                      </span>
                    </td>
                    <Td>{p.entry_count}</Td>
                    <Td>{p.pending_insights.length}</Td>
                    <Td>{p.context.length}</Td>
                    <Td>{p.skill_index.length}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Small presentational pieces
 * -------------------------------------------------------------------------- */

function Stat({
  label,
  value,
  detail,
  last,
}: {
  label: string;
  value: number;
  detail?: string;
  last?: boolean;
}) {
  return (
    <div className={`px-4 py-3 ${last ? "" : "border-r border-border-subtle"}`}>
      <div className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-lg text-foreground">{value}</span>
        {detail && (
          <span className="font-mono text-2xs text-muted-foreground/70">{detail}</span>
        )}
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`px-3 py-2 font-code text-2xs font-normal uppercase tracking-[0.14em] text-muted-foreground/60 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-3 py-2.5 text-right font-mono text-xs text-foreground">{children}</td>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function deriveTitle(body: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "";
}

function bodyExcerpt(body: string): string {
  // Strip frontmatter (if present) + headings, then take the first ~180 chars
  // of prose. Keeps the popup excerpt readable.
  const noFm = body.replace(/^---[\s\S]*?---\s*/, "");
  const noHeading = noFm.replace(/^#+\s+[^\n]+\n+/, "");
  const text = noHeading.replace(/\s+/g, " ").trim();
  return text.length > 180 ? text.slice(0, 180) + "…" : text;
}

function formatStamp(s: string | undefined): string {
  if (!s) return "—";
  // ISO timestamps render as "YYYY-MM-DD HH:MM"; anything else passes through.
  return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 16).replace("T", " ") : s;
}
