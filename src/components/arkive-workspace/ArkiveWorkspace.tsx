// Arkive workspace — VSCode-style three-region UI for browsing the
// arkive-core-v1 substrate.
//
//   ┌──────┬─────────────────┬──────────────────────────────────┐
//   │ rail │  file explorer  │  tabs + content                  │
//   │ ~56  │  ~280px         │  flex-1                          │
//   └──────┴─────────────────┴──────────────────────────────────┘
//
// State owned here:
//   - bundle (from /api/arkive-v2/bundle — read-bundle.ts shape)
//   - tree (derived from bundle)
//   - expanded folders
//   - tabs + active tab
//   - folder colors (persisted to localStorage via useFolderColors)
//   - lazy-fetched bodies for tabs that aren't in the bundle (skills,
//     accepted/rejected insights, journal entries outside the recent window)

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileExplorer } from "./FileExplorer";
import { TabBar } from "./TabBar";
import { FileTab } from "./FileTab";
import { DocsLanding } from "./DocsLanding";
import { buildTree, findEntryByPath, collectAllFolderPaths } from "./tree-utils";
import type { Bundle, Entry, Tab } from "./types";

export function ArkiveWorkspace() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Default expansion — arkive root + the universal stream + practices/ +
  // the trading practice (the verified default). Stream sits above
  // practices alphabetically because folders sort before files and "stream"
  // < "practices" lexicographically, but it shows up directly under the
  // root which is the right visual prominence — the capture spine first,
  // structured practices second.
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set([
        "arkive/docs",
        "arkive/docs/concepts",
        "arkive/docs/guides",
        "arkive/docs/reference",
        "arkive/docs/architecture",
      ])
  );

  const LANDING_TAB: Tab = { kind: "landing", id: "__landing__", title: "Get Started" };

  const [tabs, setTabs] = useState<Tab[]>(() => {
    if (typeof window === "undefined") return [LANDING_TAB];
    try {
      const saved = JSON.parse(localStorage.getItem("arkive-tabs") ?? "null") as Tab[] | null;
      if (Array.isArray(saved) && saved.length > 0) return [LANDING_TAB, ...saved.filter((t) => t.kind === "file")];
    } catch {}
    return [LANDING_TAB];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    if (typeof window === "undefined") return "__landing__";
    try { return localStorage.getItem("arkive-active-tab") ?? "__landing__"; } catch {}
    return "__landing__";
  });
  const searchParams = useSearchParams();
  const didOpenFileParam = useRef(false);
  const [explorerWidth, setExplorerWidth] = useState(264);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isDragging = useRef(false);

  // Lazy-fetched entry cache for tabs whose path isn't in the bulk-loaded
  // bundle. Keyed by full path. Stale entries are evicted on bundle refresh.
  const [extraEntries, setExtraEntries] = useState<Map<string, Entry>>(() => new Map());

  // Persisted folder→color map. Painting cascades to descendants in both
  // the tree and the graph (most-specific colored ancestor wins).
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/arkive-v2/bundle", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Failed");
      setBundle(j);
      setError(null);
      // Drop stale lazy entries — they'll re-fetch on demand if still open
      setExtraEntries(new Map());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Persist tabs and active tab to localStorage so they survive page refresh.
  useEffect(() => {
    try { localStorage.setItem("arkive-tabs", JSON.stringify(tabs)); } catch {}
  }, [tabs]);
  useEffect(() => {
    try { localStorage.setItem("arkive-active-tab", activeTabId); } catch {}
  }, [activeTabId]);

  // Open a file from the ?file= query param (e.g. dashboard "Recent Commits" links).
  // Runs once after the first bundle load so the tab system is ready.
  useEffect(() => {
    if (didOpenFileParam.current) return;
    const filePath = searchParams.get("file");
    if (!filePath) return;
    didOpenFileParam.current = true;
    selectFile(filePath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const tree = useMemo(() => (bundle ? buildTree(bundle) : null), [bundle]);

  function toggleFolder(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function expandAll() {
    if (!tree) return;
    setExpanded(new Set(collectAllFolderPaths(tree)));
  }

  function collapseAll() {
    setExpanded(new Set(["arkive"]));
  }

  function selectFile(path: string) {
    setTabs((prev) => {
      if (prev.some((t) => t.id === path)) return prev;
      const title = path.split("/").pop()?.replace(/\.md$/, "") || path;
      return [...prev, { kind: "file", id: path, title }];
    });
    setActiveTabId(path);
  }

  function closeTab(id: string) {
    if (id === "__landing__") return; // pinned, not closeable
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) {
        const fallback = next[Math.min(idx, next.length - 1)];
        setActiveTabId(fallback?.id ?? "__landing__");
      }
      return next;
    });
  }

  function reorderTabs(fromId: string, toId: string) {
    setTabs((prev) => {
      const from = prev.findIndex((t) => t.id === fromId);
      const to = prev.findIndex((t) => t.id === toId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function reset() {
    if (!confirm("RESET — deletes EVERY entry you own and reseeds a fresh arkive. Continue?")) return;
    if (!confirm("Last chance. All entries will be gone.")) return;
    setResetting(true);
    try {
      const r = await fetch("/api/arkive-v2/reset", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Failed");
      alert(`Reset complete:\n- deleted: ${j.deleted}\n- seeded: ${(j.seeded ?? []).length} root files`);
      setTabs([]);
      setActiveTabId("");
      try { localStorage.removeItem("arkive-tabs"); localStorage.removeItem("arkive-active-tab"); } catch {}
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

  // Active tab resolution — bundle first, lazy cache second, on-demand fetch
  // for anything else. Effect below performs the fetch.
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;
  const activeFilePath = activeTab?.kind === "file" ? activeTab.id : null;
  const selectedPath = activeFilePath;

  const activeFile: Entry | null = useMemo(() => {
    if (!bundle || !activeFilePath) return null;
    const fromBundle = findEntryByPath(bundle, activeFilePath);
    if (fromBundle) return fromBundle;
    return extraEntries.get(activeFilePath) ?? null;
  }, [bundle, activeFilePath, extraEntries]);

  // Lazy-fetch for active tab if neither bundle nor cache has it.
  useEffect(() => {
    if (!bundle || !activeFilePath) return;
    if (findEntryByPath(bundle, activeFilePath)) return;
    if (extraEntries.has(activeFilePath)) return;
    let cancelled = false;
    fetch(`/api/arkive-v2/entry?path=${encodeURIComponent(activeFilePath)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j || !j.path) return;
        setExtraEntries((prev) => {
          const next = new Map(prev);
          next.set(j.path, { path: j.path, meta: j.meta ?? {}, body: j.body ?? "" });
          return next;
        });
      })
      .catch(() => {
        /* swallow — tab body shows "File not found" message */
      });
    return () => {
      cancelled = true;
    };
  }, [bundle, activeFilePath, extraEntries]);

  if (loading && !bundle) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background font-mono text-xs text-muted-foreground/70">
        Loading Arkive…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background p-6 text-sm text-destructive">
        Failed to load Arkive: {error}
      </div>
    );
  }
  if (!bundle || !tree) return null;

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startW = explorerWidth;
    const onMove = (mv: MouseEvent) => {
      if (!isDragging.current) return;
      const next = Math.min(520, Math.max(160, startW + mv.clientX - startX));
      setExplorerWidth(next);
    };
    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function selectFileAndCloseSidebar(path: string) {
    selectFile(path);
    setSidebarOpen(false);
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <div style={{ width: explorerWidth }} className="hidden shrink-0 md:block">
        <FileExplorer
          root={tree}
          expanded={expanded}
          onToggle={toggleFolder}
          selectedPath={selectedPath}
          onSelectFile={selectFile}
        />
      </div>
      {/* Desktop drag handle */}
      <div
        onMouseDown={startDrag}
        className="hidden w-0.5 shrink-0 cursor-col-resize bg-border-subtle transition-colors hover:bg-primary/50 active:bg-primary/70 md:block"
      />

      {/* Mobile sidebar drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          {/* Drawer */}
          <div className="absolute inset-y-0 left-0 w-72 bg-panel shadow-xl">
            <FileExplorer
              root={tree}
              expanded={expanded}
              onToggle={toggleFolder}
              selectedPath={selectedPath}
              onSelectFile={selectFileAndCloseSidebar}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar
          tabs={tabs}
          activeId={activeTabId}
          onActivate={setActiveTabId}
          onClose={closeTab}
          onReorder={reorderTabs}
          onRefresh={() => void load()}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
        {activeTab?.kind === "landing" && (
          <DocsLanding onSelectFile={selectFile} />
        )}
        {activeTab?.kind === "file" && (
          activeFile ? (
            <FileTab
              path={activeFile.path}
              meta={activeFile.meta ?? {}}
              body={activeFile.body}
              backlinks={[]}
              onOpenPath={selectFile}
              onSaved={load}
              onBack={() => setActiveTabId("__landing__")}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center font-mono text-xs text-muted-foreground/70">
              <span>Loading file…</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
