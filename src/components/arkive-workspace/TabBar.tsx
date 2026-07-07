"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { GitBranch, FileText, Sparkles, X, RotateCw, BookOpen, Menu, ChevronDown } from "lucide-react";
import type { Tab } from "./types";

const TAB_MIN = 28;
const TAB_MAX = 200;
const COMPACT_THRESHOLD = 90;

type DragState = {
  tabId: string;
  fromIndex: number;
  startX: number;
  currentX: number;
  insertIndex: number;
  tabW: number;
};

export function TabBar({
  tabs,
  activeId,
  onActivate,
  onClose,
  onReorder,
  onRefresh,
  onOpenSidebar,
}: {
  tabs: Tab[];
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onReorder: (fromId: string, toId: string) => void;
  onRefresh: () => void;
  onOpenSidebar?: () => void;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const regularRef = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(800);
  const [tooltip, setTooltip] = useState<{ title: string; left: number } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [listOpen, setListOpen] = useState(false);

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = () => setBarWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const overviewTab = tabs.find((t) => t.kind === "overview") ?? null;
  const landingTab = tabs.find((t) => t.kind === "landing") ?? null;
  const pinnedTab = overviewTab ?? landingTab ?? null;
  const regularTabs = tabs.filter((t) => t.kind !== "overview" && t.kind !== "landing");
  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const tabW = Math.min(TAB_MAX, Math.max(TAB_MIN, barWidth / Math.max(1, tabs.length)));
  const compact = tabW < COMPACT_THRESHOLD;

  function startDrag(e: React.MouseEvent, t: Tab, regIdx: number) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();

    const barLeft = regularRef.current?.getBoundingClientRect().left ?? 0;
    const startX = e.clientX - barLeft;
    let hasMoved = false;
    let state: DragState = { tabId: t.id, fromIndex: regIdx, startX, currentX: startX, insertIndex: regIdx, tabW };

    function computeInsert(mouseX: number): number {
      let insert = regIdx;
      for (let i = 0; i < regularTabs.length; i++) {
        if (i === regIdx) continue;
        if (mouseX > i * tabW + tabW / 2) insert = i;
      }
      return Math.max(0, Math.min(regularTabs.length - 1, insert));
    }

    const onMove = (mv: MouseEvent) => {
      const x = mv.clientX - barLeft;
      if (!hasMoved && Math.abs(x - startX) < 4) return;
      hasMoved = true;
      document.body.style.cursor = "grabbing";
      state = { ...state, currentX: x, insertIndex: computeInsert(x) };
      setDrag({ ...state });
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      if (hasMoved && state.insertIndex !== state.fromIndex) {
        const target = regularTabs[state.insertIndex];
        if (target) onReorder(t.id, target.id);
      } else if (!hasMoved) {
        onActivate(t.id);
      }
      setDrag(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function getRegularTabStyle(regIdx: number): React.CSSProperties {
    if (!drag) return { width: tabW };
    if (regIdx === drag.fromIndex) {
      return { width: tabW, transform: `translateX(${drag.currentX - drag.startX}px)`, transition: "none", zIndex: 50, opacity: 0.85 };
    }
    const { fromIndex, insertIndex } = drag;
    let shift = 0;
    if (insertIndex > fromIndex && regIdx > fromIndex && regIdx <= insertIndex) shift = -tabW;
    else if (insertIndex < fromIndex && regIdx >= insertIndex && regIdx < fromIndex) shift = tabW;
    return { width: tabW, transform: `translateX(${shift}px)`, transition: "transform 150ms ease" };
  }

  function handleMouseEnter(e: React.MouseEvent, t: Tab) {
    const outerRect = outerRef.current?.getBoundingClientRect();
    const tabRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!outerRect) return;
    setTooltip({ title: t.title, left: tabRect.left - outerRect.left + tabRect.width / 2 });
  }

  function tabIcon(t: Tab) {
    if (t.kind === "overview") return <GitBranch size={12} strokeWidth={1.5} className="shrink-0 text-muted-foreground/60" />;
    if (t.kind === "daydreams") return <Sparkles size={12} strokeWidth={1.5} className="shrink-0 text-agent/70" />;
    if (t.kind === "landing") return <BookOpen size={12} strokeWidth={1.5} className="shrink-0 text-primary/70" />;
    return <FileText size={12} strokeWidth={1.5} className="shrink-0 text-muted-foreground/60" />;
  }

  const activeIsPinned = pinnedTab?.id === activeId;
  const activeRegIdx = regularTabs.findIndex((t) => t.id === activeId);
  const eraseLeft = activeIsPinned ? 0 : tabW + activeRegIdx * tabW;
  const eraseWidth = tabW;
  const showErase = activeIsPinned || activeRegIdx >= 0;

  return (
    <>
      {/* ── Mobile tab bar ───────────────────────────────────────────────── */}
      <div className="relative flex h-11 shrink-0 items-center border-b border-border-subtle bg-panel md:hidden">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="flex h-full w-11 shrink-0 items-center justify-center border-r border-border-subtle text-muted-foreground/60 transition-colors hover:text-foreground"
          aria-label="Open navigation"
        >
          <Menu size={16} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={() => setListOpen((o) => !o)}
          className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left"
        >
          {activeTab && tabIcon(activeTab)}
          <span className="min-w-0 flex-1 truncate font-code text-xs text-foreground">
            {activeTab?.title ?? "—"}
          </span>
          <ChevronDown
            size={12}
            strokeWidth={1.5}
            className={`shrink-0 text-muted-foreground/60 transition-transform ${listOpen ? "rotate-180" : ""}`}
          />
        </button>

        {listOpen && (
          <div className="absolute inset-x-0 top-full z-50 border-b border-border-subtle bg-panel shadow-lg">
            {tabs.map((t) => {
              const isActive = t.id === activeId;
              const isPinned = t.kind === "landing" || t.kind === "overview";
              return (
                <div
                  key={t.id}
                  className={`flex h-10 items-center gap-2 px-3 ${isActive ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"}`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => { onActivate(t.id); setListOpen(false); }}
                  >
                    {tabIcon(t)}
                    <span className="min-w-0 flex-1 truncate font-code text-xs">{t.title}</span>
                  </button>
                  {!isPinned && (
                    <button
                      type="button"
                      onClick={() => { onClose(t.id); setListOpen(false); }}
                      className="shrink-0 rounded-sm p-1 text-muted-foreground/40 transition-colors hover:text-foreground"
                    >
                      <X size={12} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Desktop tab bar ──────────────────────────────────────────────── */}
      <div ref={outerRef} className="relative hidden h-9 shrink-0 items-stretch border-b border-border-subtle bg-panel md:flex">

        {pinnedTab && (() => {
          const isActive = pinnedTab.id === activeId;
          return (
            <div
              style={{ width: tabW }}
              onClick={() => onActivate(pinnedTab.id)}
              onMouseEnter={(e) => handleMouseEnter(e, pinnedTab)}
              onMouseLeave={() => setTooltip(null)}
              className={[
                "relative flex shrink-0 cursor-pointer select-none items-center gap-2 border-r border-border-subtle px-3",
                "transition-[background-color,color] duration-120",
                isActive ? "z-10 bg-background text-foreground" : "text-muted-foreground/70 hover:bg-secondary/30 hover:text-muted-foreground",
              ].join(" ")}
            >
              {isActive && <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary" />}
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {tabIcon(pinnedTab)}
                <span
                  className="min-w-0 flex-1 overflow-hidden whitespace-nowrap font-code text-xs"
                  style={{
                    maskImage: "linear-gradient(to right, black 0%, black calc(100% - 16px), transparent 100%)",
                    WebkitMaskImage: "linear-gradient(to right, black 0%, black calc(100% - 16px), transparent 100%)",
                  }}
                >{pinnedTab.title}</span>
              </span>
              {pinnedTab.kind === "overview" && (
                <button
                  type="button"
                  aria-label="Refresh"
                  onClick={(e) => { e.stopPropagation(); onRefresh(); }}
                  className="shrink-0 rounded-sm p-0.5 text-muted-foreground/40 outline-none transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <RotateCw size={11} strokeWidth={1.5} />
                </button>
              )}
            </div>
          );
        })()}

        <div ref={regularRef} className="flex overflow-hidden">
          {regularTabs.map((t, regIdx) => {
            const isActive = t.id === activeId;
            const iconOnly = compact && !isActive;
            return (
              <div
                key={t.id}
                onMouseDown={(e) => startDrag(e, t, regIdx)}
                onMouseEnter={(e) => handleMouseEnter(e, t)}
                onMouseLeave={() => setTooltip(null)}
                style={getRegularTabStyle(regIdx)}
                className={[
                  "relative flex shrink-0 select-none items-center border-r border-border-subtle",
                  "transition-[background-color,color] duration-120",
                  drag ? "cursor-grabbing" : "cursor-pointer",
                  iconOnly ? "justify-center px-2" : "gap-2 px-3",
                  isActive ? "z-10 bg-background text-foreground" : "text-muted-foreground/70 hover:bg-secondary/30 hover:text-muted-foreground",
                ].join(" ")}
              >
                {isActive && <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary" />}
                {iconOnly ? (
                  tabIcon(t)
                ) : (
                  <>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      {tabIcon(t)}
                      <span
                        className="min-w-0 flex-1 overflow-hidden whitespace-nowrap font-code text-xs"
                        style={{
                          maskImage: "linear-gradient(to right, black 0%, black calc(100% - 20px), transparent 100%)",
                          WebkitMaskImage: "linear-gradient(to right, black 0%, black calc(100% - 20px), transparent 100%)",
                        }}
                      >
                        {t.title}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label="Close"
                      onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
                      className="shrink-0 rounded-sm p-0.5 text-muted-foreground/40 outline-none transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <X size={12} strokeWidth={1.5} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {showErase && (
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-px z-20 h-px bg-background"
            style={{ left: eraseLeft, width: eraseWidth }}
          />
        )}

        {tooltip && !drag && (
          <div
            className="pointer-events-none absolute top-full z-50 mt-1.5 -translate-x-1/2 rounded-md border border-border-subtle bg-popover px-2 py-1 font-code text-xs text-foreground shadow-lg"
            style={{ left: tooltip.left }}
          >
            {tooltip.title}
          </div>
        )}
      </div>
    </>
  );
}
