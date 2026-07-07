"use client";

/**
 * Arkive v2 browser — the user-facing UI for the substrate defined in BRAND.md
 * + the v2 blueprint.
 *
 * Layout (matches the blueprint's information architecture):
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ Toolbar: state · [Download] [Reset]                                │
 *   ├──────────────────┬─────────────────────────────────────────────────┤
 *   │ Tree (v2 only)   │  Right pane: markdown viewer OR landing summary  │
 *   │ arkive/          │                                                  │
 *   │   protocol.md    │                                                  │
 *   │   identity.md    │                                                  │
 *   │   config         │                                                  │
 *   │   journal/       │                                                  │
 *   │   skills/        │                                                  │
 *   │   insights/      │                                                  │
 *   │   context/       │                                                  │
 *   └──────────────────┴─────────────────────────────────────────────────┘
 *
 * The tree shows ONLY paths under `arkive/`. Anything internal
 * (_internal/* — trade evidence, user profile) is filtered out. There are no
 * v1 arkive types anywhere; this component knows nothing about evidence/,
 * activity/, events/, etc.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { RichMarkdown } from "@/components/RichMarkdown";
import { ArkiveGraph } from "@/components/ArkiveGraph";
import { serializeYaml } from "@/lib/arkive-v2/frontmatter";

type Entry = { path: string; meta: Record<string, unknown>; body: string };

type Bundle = {
  current_date: string;
  protocol: { path: string; body: string } | null;
  identity: Entry | null;
  config: { path: string; raw: string } | null;
  stats: Entry;
  active_skills: Entry[];
  recent_journal: {
    daily: Entry[];
    trades: Entry[];
    conversations: Entry[];
    research_touched: Entry[];
  };
  pending_insights: Entry[];
  context: {
    watchlist: { path: string; body: string } | null;
    rules: { path: string; body: string } | null;
    intentions: { path: string; body: string } | null;
  };
  backlinks: Array<{ from: string; to: string; type: string; reason?: string; broken?: boolean }>;
};

type TreeNode = {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
};

export function ArkiveBrowser() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<{ path: string; meta: Record<string, unknown>; body: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["arkive", "arkive/journal", "arkive/skills", "arkive/insights", "arkive/context"]));

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

  const tree = useMemo(() => (bundle ? buildTree(bundle) : null), [bundle]);

  // Per-path detail map for the graph hover popup. Title + type + a short
  // excerpt from the body so hovering a node previews what's inside without
  // having to open it.
  const nodeDetails = useMemo(() => {
    const map = new Map<string, { title: string; type: string; excerpt: string }>();
    if (!bundle) return map;
    function add(path: string, type: string, body: string, metaTitle?: unknown) {
      const title =
        (typeof metaTitle === "string" && metaTitle) ||
        deriveTitle(body) ||
        path.split("/").pop()?.replace(/\.md$/, "") ||
        path;
      const excerpt = bodyExcerpt(body);
      map.set(path, { title, type, excerpt });
    }
    if (bundle.protocol) add(bundle.protocol.path, "protocol", bundle.protocol.body, "arkive.protocol");
    if (bundle.identity) add(bundle.identity.path, "identity", bundle.identity.body, bundle.identity.meta.title);
    if (bundle.config) add(bundle.config.path, "config", bundle.config.raw, "arkive.config");
    add(bundle.stats.path, "stats", bundle.stats.body, "Trader stats");
    if (bundle.context.watchlist) add(bundle.context.watchlist.path, "watchlist", bundle.context.watchlist.body, "Watchlist");
    if (bundle.context.rules) add(bundle.context.rules.path, "rules", bundle.context.rules.body, "Rules");
    if (bundle.context.intentions) add(bundle.context.intentions.path, "intentions", bundle.context.intentions.body, "Intentions");
    for (const e of bundle.active_skills) add(e.path, "skill", e.body, e.meta.name ?? e.meta.title);
    for (const e of bundle.pending_insights) add(e.path, "insight", e.body, e.meta.target_skill ?? e.meta.title);
    for (const e of bundle.recent_journal.daily) add(e.path, "daily", e.body, e.meta.title);
    for (const e of bundle.recent_journal.trades) add(e.path, "trade", e.body, e.meta.asset ?? e.meta.title);
    for (const e of bundle.recent_journal.conversations) add(e.path, "conversation", e.body, e.meta.title);
    for (const e of bundle.recent_journal.research_touched) add(e.path, "research", e.body, e.meta.asset ?? e.meta.title);
    return map;
  }, [bundle]);

  async function reset() {
    if (!confirm("RESET — deletes EVERY entry you own and reseeds a fresh v2 arkive. Continue?")) return;
    if (!confirm("Last chance. All entries will be gone.")) return;
    setResetting(true);
    try {
      const r = await fetch("/api/arkive-v2/reset", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Failed");
      alert(`Reset complete:\n- deleted: ${j.deleted}\n- seeded: ${(j.seeded ?? []).length} root files`);
      setSelectedPath(null);
      setSelectedEntry(null);
      await load();
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

  async function decideInsight(insight: Entry, decision: "accepted" | "rejected") {
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
    } catch (e) {
      alert((e as Error).message);
    }
  }

  function toggleFolder(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function findEntryByPath(p: string): Entry | null {
    if (!bundle) return null;
    if (bundle.stats.path === p) return bundle.stats;
    if (bundle.identity?.path === p) return bundle.identity;
    if (bundle.protocol?.path === p) return { path: p, meta: {}, body: bundle.protocol.body };
    if (bundle.config?.path === p) return { path: p, meta: {}, body: bundle.config.raw };
    if (bundle.context.watchlist?.path === p) return { path: p, meta: {}, body: bundle.context.watchlist.body };
    if (bundle.context.rules?.path === p) return { path: p, meta: {}, body: bundle.context.rules.body };
    if (bundle.context.intentions?.path === p) return { path: p, meta: {}, body: bundle.context.intentions.body };
    for (const e of bundle.active_skills) if (e.path === p) return e;
    for (const e of bundle.pending_insights) if (e.path === p) return e;
    for (const e of bundle.recent_journal.daily) if (e.path === p) return e;
    for (const e of bundle.recent_journal.trades) if (e.path === p) return e;
    for (const e of bundle.recent_journal.conversations) if (e.path === p) return e;
    for (const e of bundle.recent_journal.research_touched) if (e.path === p) return e;
    return null;
  }

  function selectFile(path: string) {
    setSelectedPath(path);
    const e = findEntryByPath(path);
    if (e) setSelectedEntry({ path, meta: e.meta ?? {}, body: e.body });
    else setSelectedEntry(null);
  }

  if (loading && !bundle) {
    return <div className="rounded-xl border border-border bg-card p-6 text-muted-foreground">Loading Arkive…</div>;
  }
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
        Failed to load Arkive: {error}
      </div>
    );
  }
  if (!bundle || !tree) return null;

  const totalEntries =
    (bundle.protocol ? 1 : 0) +
    (bundle.identity ? 1 : 0) +
    (bundle.config ? 1 : 0) +
    bundle.active_skills.length +
    bundle.pending_insights.length +
    bundle.recent_journal.daily.length +
    bundle.recent_journal.trades.length +
    bundle.recent_journal.conversations.length +
    bundle.recent_journal.research_touched.length +
    (bundle.context.watchlist ? 1 : 0) +
    (bundle.context.rules ? 1 : 0) +
    (bundle.context.intentions ? 1 : 0);
  const notSeeded = !bundle.protocol;
  const pendingCount = bundle.pending_insights.length;

  return (
    <div className="space-y-4">
      {/* ---------- Toolbar ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="text-xs text-muted-foreground">
          {notSeeded ? "v2 arkive not yet seeded — Reset to initialize." : `v2 substrate · ${totalEntries} entries`}
          {pendingCount > 0 && (
            <span className="text-warning"> · {pendingCount} insight{pendingCount === 1 ? "" : "s"} pending</span>
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
          <button
            onClick={reset}
            disabled={resetting}
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50"
            title="Wipe every entry and reseed a fresh v2 arkive"
          >
            {resetting ? "Resetting…" : "Reset"}
          </button>
        </div>
      </div>

      {/* ---------- Pending insights inline review ---------- */}
      {pendingCount > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
          <h3 className="mb-2 text-sm font-semibold">Pending insights ({pendingCount})</h3>
          <ul className="space-y-2">
            {bundle.pending_insights.map((ins) => (
              <li key={ins.path} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-secondary px-2 py-0.5 font-medium">
                        {String(ins.meta.insight_type ?? "insight")}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-medium">{String(ins.meta.target_skill ?? "—")}</span>
                      <span className="text-muted-foreground">
                        signal {Number(ins.meta.signal_strength ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
                      {ins.body.slice(0, 600)}
                    </pre>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      onClick={() => decideInsight(ins, "accepted")}
                      className="rounded-lg bg-success px-3 py-1 text-xs font-semibold text-white hover:bg-success/90"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => decideInsight(ins, "rejected")}
                      className="rounded-lg border border-border px-3 py-1 text-xs font-medium hover:bg-secondary"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------- Tree + viewer ---------- */}
      <div className="grid h-[calc(100vh-340px)] min-h-[480px] grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,1fr)_2fr]">
        {/* Tree */}
        <div className="overflow-auto rounded-xl border border-border bg-card p-2">
          <Tree
            node={tree}
            expanded={expanded}
            onToggle={toggleFolder}
            selectedPath={selectedPath}
            onSelect={selectFile}
            depth={0}
          />
        </div>

        {/* Right pane — markdown viewer when a file is selected, else the graph. */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {selectedEntry ? (
            <FileViewer
              path={selectedEntry.path}
              meta={selectedEntry.meta}
              body={selectedEntry.body}
              backlinks={bundle.backlinks}
              onClose={() => {
                setSelectedPath(null);
                setSelectedEntry(null);
              }}
              onSaved={load}
              onOpenPath={(p) => selectFile(p)}
            />
          ) : (
            <ArkiveGraph
              root={tree}
              backlinks={bundle.backlinks}
              nodeDetails={nodeDetails}
              focusedPath={selectedPath}
              onFocusFolder={(p) => {
                // Expand the focused folder's ancestor chain in the side tree
                if (!p) return;
                const segments = p.split("/");
                setExpanded((prev) => {
                  const next = new Set(prev);
                  for (let i = 1; i <= segments.length; i++) next.add(segments.slice(0, i).join("/"));
                  return next;
                });
                setSelectedPath(p);
              }}
              onSelectFile={selectFile}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * Tree builder + render
 * ========================================================================== */

// Canonical v2 directory layout, per the blueprint. Rendered as empty folders
// when no entries exist yet so the user always sees the full structure.
const CANONICAL_FOLDERS = [
  "arkive/journal",
  "arkive/journal/trades",
  "arkive/journal/conversations",
  "arkive/journal/research",
  "arkive/journal/recaps",
  "arkive/journal/reviews",
  "arkive/skills",
  "arkive/skills/_archive",
  "arkive/insights",
  "arkive/insights/pending",
  "arkive/insights/accepted",
  "arkive/insights/rejected",
  "arkive/context",
];

// Paths to hide from the user-facing tree (still included in download).
// arkive.config is a machine-edited YAML — the user manages it through the
// app UI, not by clicking it in the file tree.
const HIDDEN_FROM_TREE = new Set(["arkive/arkive.config"]);

function buildTree(bundle: Bundle): TreeNode {
  // Collect every v2 path the bundle exposes
  const paths: string[] = [];
  if (bundle.protocol) paths.push(bundle.protocol.path);
  if (bundle.identity) paths.push(bundle.identity.path);
  paths.push(bundle.stats.path);
  if (bundle.context.watchlist) paths.push(bundle.context.watchlist.path);
  if (bundle.context.rules) paths.push(bundle.context.rules.path);
  if (bundle.context.intentions) paths.push(bundle.context.intentions.path);
  for (const e of bundle.active_skills) paths.push(e.path);
  for (const e of bundle.pending_insights) paths.push(e.path);
  for (const e of bundle.recent_journal.daily) paths.push(e.path);
  for (const e of bundle.recent_journal.trades) paths.push(e.path);
  for (const e of bundle.recent_journal.conversations) paths.push(e.path);
  for (const e of bundle.recent_journal.research_touched) paths.push(e.path);

  const root: TreeNode = { name: "arkive", path: "arkive", isFolder: true, children: [] };

  // Seed canonical folders first so they appear even when empty
  for (const folder of CANONICAL_FOLDERS) {
    ensurePath(root, folder, true);
  }

  // Merge in actual entries
  for (const p of paths) {
    if (HIDDEN_FROM_TREE.has(p)) continue;
    if (!p.startsWith("arkive/") && p !== "arkive") continue;
    ensurePath(root, p, false);
  }

  // Sort: folders first, alphabetically
  sortTree(root);
  return root;
}

/** Walk down the tree, creating any missing intermediate nodes. The leaf is a
 * folder if `terminalIsFolder` is true (used for canonical-folder seeding). */
function ensurePath(root: TreeNode, fullPath: string, terminalIsFolder: boolean) {
  const segments = fullPath.split("/").slice(1); // drop the leading "arkive"
  let cursor = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const childPath = ["arkive", ...segments.slice(0, i + 1)].join("/");
    const shouldBeFolder = !isLast || terminalIsFolder;
    let child = cursor.children.find((c) => c.name === seg);
    if (!child) {
      child = { name: seg, path: childPath, isFolder: shouldBeFolder, children: [] };
      cursor.children.push(child);
    } else if (!child.isFolder && shouldBeFolder) {
      // Upgrade a file node to a folder if a deeper entry showed up under it
      child.isFolder = true;
    }
    cursor = child;
  }
}

function sortTree(n: TreeNode) {
  n.children.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of n.children) sortTree(c);
}

function Tree({
  node,
  expanded,
  onToggle,
  selectedPath,
  onSelect,
  depth,
}: {
  node: TreeNode;
  expanded: Set<string>;
  onToggle: (p: string) => void;
  selectedPath: string | null;
  onSelect: (p: string) => void;
  depth: number;
}) {
  const isOpen = depth === 0 || expanded.has(node.path);
  const isSelected = selectedPath === node.path;
  const paddingLeft = depth * 14 + 6;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (node.isFolder) onToggle(node.path);
          else onSelect(node.path);
        }}
        className={
          "flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-sm transition-colors duration-120 " +
          (isSelected ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-secondary")
        }
        style={{ paddingLeft }}
      >
        {node.isFolder ? (
          <Chevron open={isOpen} />
        ) : (
          <span className="inline-block w-3" />
        )}
        <span className="text-muted-foreground">{node.isFolder ? (isOpen ? "▾" : "▸") : "·"}</span>
        <span className={node.isFolder ? "font-medium" : "truncate"} title={node.name}>
          {node.name}
        </span>
      </button>
      {node.isFolder && isOpen && (
        <div>
          {node.children.map((c) => (
            <Tree
              key={c.path}
              node={c}
              expanded={expanded}
              onToggle={onToggle}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * File viewer — renders markdown, with an Edit affordance for identity.md
 * ========================================================================== */

type Edge = { from: string; to: string; type: string; reason?: string; broken?: boolean };

function FileViewer({
  path,
  meta,
  body,
  backlinks,
  onClose,
  onSaved,
  onOpenPath,
}: {
  path: string;
  meta: Record<string, unknown>;
  body: string;
  backlinks: Edge[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onOpenPath: (p: string) => void;
}) {
  const isIdentity = path === "arkive/identity.md";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [showProvenance, setShowProvenance] = useState(false);
  const [provenanceChain, setProvenanceChain] = useState<Array<{
    node: { path: string; type: string; title?: string; timestamp?: string };
    incomingEdge?: { type: string; reason?: string };
  }> | null>(null);
  const [loadingProvenance, setLoadingProvenance] = useState(false);

  const outgoing = useMemo(() => backlinks.filter((e) => e.from === path), [backlinks, path]);
  const incoming = useMemo(() => backlinks.filter((e) => e.to === path), [backlinks, path]);
  const canShowProvenance = outgoing.length > 0 || incoming.length > 0;

  function startEdit() {
    // Strip the seed placeholder block so the user gets a clean canvas if they
    // haven't filled in anything real yet.
    const looksLikePlaceholder = body.includes("Fill this in during onboarding");
    setDraft(looksLikePlaceholder ? "" : body.replace(/^##\s+v1[^\n]*\n+/m, "").trim());
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch("/api/arkive-v2/identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: draft.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `Save failed: ${r.status}`);
      setEditing(false);
      await onSaved();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function loadProvenance() {
    setLoadingProvenance(true);
    try {
      // Walk backward 5 hops via the index endpoint. Build a linear timeline
      // by picking the longest provenance path from the returned subgraph.
      const r = await fetch("/api/arkive-v2/index-graph", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Failed");
      const nodesByPath = new Map<string, { path: string; type: string; title?: string; timestamp?: string }>(
        (j.nodes as Array<{ path: string; type: string; title?: string; timestamp?: string }>).map((n) => [n.path, n])
      );
      const incomingByPath = new Map<string, Array<{ from: string; type: string; reason?: string }>>();
      for (const e of j.edges as Array<{ from: string; to: string; type: string; reason?: string }>) {
        if (!incomingByPath.has(e.to)) incomingByPath.set(e.to, []);
        incomingByPath.get(e.to)!.push({ from: e.from, type: e.type, reason: e.reason });
      }

      // BFS backward, keeping the shortest path back to each visited node;
      // surface the chain ordered current → root.
      const chain: Array<{
        node: { path: string; type: string; title?: string; timestamp?: string };
        incomingEdge?: { type: string; reason?: string };
      }> = [];
      const visited = new Set<string>();
      let cursor: string | null = path;
      let safety = 0;
      while (cursor && !visited.has(cursor) && safety < 8) {
        visited.add(cursor);
        const node = nodesByPath.get(cursor);
        if (!node) break;
        // Find the most-informative inbound edge — pick the one with the
        // richest type ordering (evidence > linked_insights > sources > ...).
        const candidates: Array<{ from: string; type: string; reason?: string }> = incomingByPath.get(cursor) ?? [];
        const ranked = [...candidates].sort((a, b) => edgeRank(a.type) - edgeRank(b.type));
        const pick: { from: string; type: string; reason?: string } | undefined = ranked[0];
        chain.push({
          node,
          incomingEdge: chain.length === 0 ? undefined : pick ? { type: pick.type, reason: pick.reason } : undefined,
        });
        cursor = pick?.from ?? null;
        safety++;
      }
      setProvenanceChain(chain);
      setShowProvenance(true);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoadingProvenance(false);
    }
  }

  return (
    <div className="h-full space-y-3 overflow-auto p-5">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <code className="break-all font-code text-xs text-muted-foreground">{path}</code>
        <div className="flex shrink-0 items-center gap-2">
          {canShowProvenance && !editing && (
            <button
              onClick={loadProvenance}
              disabled={loadingProvenance}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-secondary disabled:opacity-50"
            >
              {loadingProvenance ? "…" : "Provenance"}
            </button>
          )}
          {isIdentity && !editing && (
            <button
              onClick={startEdit}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-secondary"
            >
              Edit
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-secondary"
          >
            Close
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Write a short bio: who you are as a trader, capital range, time horizon, hard limits, communication
            preferences. 5–10 lines is plenty. Markdown OK.
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-72 w-full rounded-lg border border-border bg-background p-3 font-code text-xs text-foreground outline-none focus:border-primary"
            placeholder="I'm a self-directed trader running $X capital, medium-horizon, evenings only. No leverage. Prefer terse responses with numbers, not hedged language."
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !draft.trim()}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save identity"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Frontmatter — rendered as syntax-highlighted YAML so the typed
              fields (title, sources, linked_trades, risk_envelope, etc.) that
              power the backlink graph are visible right next to the body. */}
          {Object.keys(meta).length > 0 && <YamlBlock meta={meta} />}
          <div className="prose max-w-none">
            <RichMarkdown source={body} />
          </div>

          {/* References panel — Obsidian-style backlinks */}
          {(outgoing.length > 0 || incoming.length > 0) && (
            <div className="mt-6 grid gap-4 border-t border-border pt-4 md:grid-cols-2">
              <ReferencePanel title="References" subtitle="What this file points to" edges={outgoing} role="outgoing" onOpenPath={onOpenPath} />
              <ReferencePanel title="Referenced by" subtitle="What points to this file" edges={incoming} role="incoming" onOpenPath={onOpenPath} />
            </div>
          )}
        </>
      )}

      {/* Provenance timeline modal */}
      {showProvenance && provenanceChain && (
        <ProvenanceModal
          chain={provenanceChain}
          onClose={() => setShowProvenance(false)}
          onOpenPath={(p) => {
            setShowProvenance(false);
            onOpenPath(p);
          }}
        />
      )}
    </div>
  );
}

/* ============================================================================
 * YamlBlock — syntax-highlighted view of an entry's frontmatter.
 *
 * The frontmatter is the connective tissue of the arkive: every backlink in
 * the graph is computed from the typed fields in here (sources, linked_trades,
 * evidence, linked_insights, etc.). Showing it inline makes "why are these two
 * files connected?" answerable at a glance.
 *
 * Rendering rules:
 *   - `---` fences in muted grey
 *   - keys in success-teal (matches the YAML mode of most editor themes)
 *   - inline `# comments` (the placeholder annotations we leave in seeds) in
 *     muted grey so they read as supporting documentation, not data
 *   - placeholder values like `<ISO timestamp>` and `<list of …>` in muted
 *     grey (they're spec, not actual data)
 *   - real string/number/boolean values in foreground white
 * ========================================================================== */
function YamlBlock({ meta }: { meta: Record<string, unknown> }) {
  const yaml = serializeYaml(meta).trimEnd();
  const lines = yaml.split("\n");
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-secondary/30 p-4 font-code text-xs leading-relaxed text-foreground">
      <code className="block">
        <div className="text-muted-foreground">---</div>
        {lines.map((line, i) => (
          <YamlLine key={i} line={line} />
        ))}
        <div className="text-muted-foreground">---</div>
      </code>
    </pre>
  );
}

function YamlLine({ line }: { line: string }) {
  // Split off a trailing `# comment` (only when it's clearly a comment, not a
  // hash inside a value). Preserve the leading whitespace so nesting reads.
  const commentIdx = findCommentStart(line);
  const main = commentIdx >= 0 ? line.slice(0, commentIdx).trimEnd() : line;
  const comment = commentIdx >= 0 ? line.slice(commentIdx) : "";

  // Try to split into key + value. Match indent + key + ":" + rest.
  const m = main.match(/^(\s*)([A-Za-z0-9_\-]+):\s?(.*)$/);
  if (m) {
    const [, indent, key, value] = m;
    return (
      <div>
        <span>{indent}</span>
        <span className="text-[#7DD3A8]">{key}</span>
        <span className="text-muted-foreground">:</span>
        {value && <span className={isPlaceholderValue(value) ? "text-muted-foreground" : "text-foreground"}> {value}</span>}
        {comment && <span className="text-muted-foreground">  {comment}</span>}
      </div>
    );
  }

  // List item or other — render as-is, value highlighting based on placeholder
  return (
    <div>
      <span className={isPlaceholderValue(main) ? "text-muted-foreground" : "text-foreground"}>{main}</span>
      {comment && <span className="text-muted-foreground">  {comment}</span>}
    </div>
  );
}

/** Find the index where an inline YAML comment starts, or -1.
 *  A `#` only counts as a comment when it's preceded by whitespace (otherwise
 *  it might be part of a URL fragment or string value). */
function findCommentStart(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "#" && (i === 0 || /\s/.test(line[i - 1]))) return i;
  }
  return -1;
}

/** Heuristic: angle-bracketed placeholder text like `<ISO timestamp>` or
 *  `<list of files>` is template spec, not real data — dim it. */
function isPlaceholderValue(v: string): boolean {
  const t = v.trim();
  return t.startsWith("<") && t.endsWith(">");
}

function edgeRank(t: string): number {
  // Lower rank = picked first as the "most informative" incoming edge
  const order: Record<string, number> = {
    evidence: 0,
    linked_insights: 1,
    sources: 2,
    linked_trades: 3,
    links_to_entry: 4,
    produced: 5,
  };
  return order[t] ?? 10;
}

function ReferencePanel({
  title,
  subtitle,
  edges,
  role,
  onOpenPath,
}: {
  title: string;
  subtitle: string;
  edges: Edge[];
  role: "outgoing" | "incoming";
  onOpenPath: (p: string) => void;
}) {
  if (edges.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        <p className="mt-3 text-xs text-muted-foreground">—</p>
      </div>
    );
  }
  // Group by edge type
  const byType = new Map<string, Edge[]>();
  for (const e of edges) {
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type)!.push(e);
  }
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      <ul className="mt-3 space-y-2">
        {[...byType.entries()].map(([type, list]) => (
          <li key={type}>
            <div className="font-code text-2xs uppercase tracking-[0.06em] text-muted-foreground">{type.replace(/_/g, " ")}</div>
            <ul className="mt-1 space-y-1">
              {list.map((e, i) => {
                const targetPath = role === "outgoing" ? e.to : e.from;
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => !e.broken && onOpenPath(targetPath)}
                      className={
                        "flex w-full items-center gap-2 rounded border border-border px-2 py-1.5 text-left text-xs " +
                        (e.broken ? "cursor-not-allowed opacity-60" : "hover:bg-secondary")
                      }
                      title={e.reason || ""}
                    >
                      <span className="truncate font-code text-xs">{targetPath.replace(/^arkive\//, "")}</span>
                      {e.broken && (
                        <span className="ml-auto rounded-full bg-warning/15 px-1.5 py-0.5 text-2xs uppercase tracking-wider text-warning">
                          broken
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProvenanceModal({
  chain,
  onClose,
  onOpenPath,
}: {
  chain: Array<{
    node: { path: string; type: string; title?: string; timestamp?: string };
    incomingEdge?: { type: string; reason?: string };
  }>;
  onClose: () => void;
  onOpenPath: (p: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-8" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-xl border border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-3">
          <h2 className="font-display text-lg font-semibold">Provenance</h2>
          <button onClick={onClose} className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-secondary">
            Close
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Why this entry exists — walked backward through the typed graph. Each step cites the edge it came from.
        </p>
        <ol className="mt-4 space-y-3">
          {chain.map((step, i) => (
            <li key={step.node.path} className="relative pl-6">
              {i > 0 && step.incomingEdge && (
                <div className="absolute left-2 top-0 -translate-y-3 font-code text-2xs uppercase tracking-[0.06em] text-muted-foreground">
                  ↑ {step.incomingEdge.type.replace(/_/g, " ")}
                  {step.incomingEdge.reason ? <span className="text-muted-foreground">: {step.incomingEdge.reason}</span> : null}
                </div>
              )}
              <button
                type="button"
                onClick={() => onOpenPath(step.node.path)}
                className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors duration-120 hover:bg-secondary"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-2xs uppercase tracking-wider text-muted-foreground">
                    {step.node.type.replace(/_/g, " ")}
                  </span>
                  <span className="truncate font-medium">{step.node.title || step.node.path.split("/").pop()}</span>
                </div>
                <code className="mt-1 block break-all font-code text-2xs text-muted-foreground">{step.node.path}</code>
              </button>
            </li>
          ))}
          {chain.length === 1 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              No upstream provenance found — this entry has no inbound links.
            </li>
          )}
        </ol>
      </div>
    </div>
  );
}

/** First `#`/`##` heading in the body, used to surface a friendly title. */
function deriveTitle(body: string): string | null {
  const m = body.match(/^#{1,2}\s+(.+?)$/m);
  if (!m) return null;
  return m[1].trim().replace(/`/g, "").slice(0, 80);
}

/** Short plain-text excerpt for a hover popup. Strips frontmatter, headings, code fences. */
function bodyExcerpt(body: string, max = 220): string {
  const cleaned = body
    .replace(/^---\n[\s\S]*?\n---\n?/, "")     // frontmatter (shouldn't be here in v2 reads, but safe)
    .replace(/```[\s\S]*?```/g, "")             // code blocks
    .replace(/^#{1,6}\s+.*$/gm, "")             // headings
    .replace(/^\s*[-*]\s+/gm, "")               // bullet markers
    .replace(/[*_`]/g, "")                       // light markdown chars
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      className={"shrink-0 text-muted-foreground transition-transform " + (open ? "rotate-90" : "")}
      aria-hidden
    >
      <path
        d="M3 1.5 L7 5 L3 8.5"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

