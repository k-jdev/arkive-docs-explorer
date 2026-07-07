// GitHub-style contribution heatmap, dark-themed for the Arkive workspace.
//
// 7 rows (Mon-Sun) × ~53 columns covering the last 52 weeks of arkive
// activity. Each cell = one day; color intensity scales with the count of
// entries committed that day. Tooltip on hover with the count + date.
//
// Intensity ramps through the brand blue (#2E68F4) instead of GitHub's
// green — keeps the whole workspace in one cool hue family (BRAND.md §2).
//   0  #161616   no activity (graphite)
//   1  #1A2A52   1 entry
//   2  #234C9F   2-3 entries
//   3  #2E68F4   4-6 entries
//   4  #83A7F9   7+

"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";

export type HeatmapDay = { date: string; count: number };

const DARK_PALETTE  = ["#161616", "#1A2A52", "#234C9F", "#2E68F4", "#83A7F9"];
const LIGHT_PALETTE = ["#f2f2f2", "#c7d7f8", "#93b0f4", "#2E68F4", "#1a4dc7"];

function bucket(count: number): number {
  if (count === 0) return 0;
  if (count <= 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

const CELL = 11;
const GAP = 3;
const COL = CELL + GAP;
const ROW = CELL + GAP;
const LEFT_GUTTER = 28;
const TOP_GUTTER = 18;
const HEADER_H = TOP_GUTTER + 4;

export function ArkiveHeatmap({ days }: { days: HeatmapDay[] }) {
  const [hover, setHover] = useState<{ x: number; y: number; day: HeatmapDay } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [cellPx, setCellPx] = useState(CELL);
  const theme = useTheme();
  const PALETTE = theme === "light" ? LIGHT_PALETTE : DARK_PALETTE;
  const cellStroke = theme === "light" ? "#ffffff" : "#1f1f1f";

  // Group days into weekly columns, padding the first week so day-of-week
  // aligns to the correct row.
  const grid = useMemo(() => {
    if (days.length === 0) return [] as (HeatmapDay | null)[][];
    const cols: (HeatmapDay | null)[][] = [];
    let week: (HeatmapDay | null)[] = [];
    const firstDow = new Date(days[0].date + "T00:00:00Z").getUTCDay(); // 0 = Sun
    for (let i = 0; i < firstDow; i++) week.push(null);
    for (const d of days) {
      week.push(d);
      if (week.length === 7) {
        cols.push(week);
        week = [];
      }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      cols.push(week);
    }
    return cols;
  }, [days]);

  // Measure the wrapper div and derive a cell size that makes the SVG fill it
  // exactly — no viewBox scaling, so text stays at native SVG pixel size.
  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el || grid.length === 0) return;
    const measure = () => {
      const inner = el.clientWidth - 32; // p-4 = 16px each side
      const c = Math.max(7, Math.floor((inner - LEFT_GUTTER - GAP * grid.length) / grid.length));
      setCellPx(c);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [grid.length]);

  const COL_D = cellPx + GAP;
  const ROW_D = cellPx + GAP;
  const W = grid.length * COL_D + LEFT_GUTTER;
  const H = 7 * ROW_D + HEADER_H + 6;
  const monthLabels = useMemo(() => buildMonthLabels(grid, COL_D), [grid, COL_D]);

  // Total committed entries across the window — useful as a one-liner
  // above the grid, like GitHub's "N contributions in the last year".
  const total = useMemo(() => days.reduce((s, d) => s + d.count, 0), [days]);

  return (
    <div className="relative rounded-xl border border-border-subtle bg-panel overflow-hidden">
      <div className="flex h-9 items-center justify-between border-b border-border-subtle px-3">
        <h2 className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
          activity
        </h2>
        <span className="font-mono text-2xs text-muted-foreground/70">
          {total} {total === 1 ? "commit" : "commits"} · 52 weeks
        </span>
      </div>
      <div className="p-4 pb-2" ref={wrapperRef}>
        <svg width={W} height={H} style={{ maxWidth: "100%", display: "block" }}>
          {/* day-of-week labels — only odd rows labeled to keep the gutter sparse */}
          <g fontSize={9} fill="#525252" fontFamily="ui-monospace, monospace">
            {[
              { label: "Mon", row: 1 },
              { label: "Wed", row: 3 },
              { label: "Fri", row: 5 },
            ].map(({ label, row }) => (
              <text key={label} x={0} y={HEADER_H + row * ROW_D + 8}>
                {label}
              </text>
            ))}
          </g>
          {/* month labels */}
          <g fontSize={9} fill="#525252" fontFamily="ui-monospace, monospace">
            {monthLabels.map((m, i) => (
              <text key={i} x={LEFT_GUTTER + m.x} y={10}>
                {m.label}
              </text>
            ))}
          </g>
          {/* cells */}
          <g transform={`translate(${LEFT_GUTTER}, ${HEADER_H})`}>
            {grid.map((week, wi) =>
              week.map((d, di) => {
                if (!d) return null;
                const b = bucket(d.count);
                const x = wi * COL_D;
                const y = di * ROW_D;
                return (
                  <rect
                    key={d.date}
                    x={x}
                    y={y}
                    width={cellPx}
                    height={cellPx}
                    rx={1}
                    fill={PALETTE[b]}
                    stroke={cellStroke}
                    strokeWidth={0.6}
                    onMouseEnter={(e) =>
                      setHover({
                        x: e.nativeEvent.offsetX,
                        y: e.nativeEvent.offsetY,
                        day: d,
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })
            )}
          </g>
        </svg>
      </div>

      {/* legend */}
      <div className="flex items-center justify-end gap-1.5 px-4 pb-3 font-code text-2xs uppercase tracking-wider text-muted-foreground/60">
        <span>Less</span>
        {PALETTE.map((c) => (
          <span
            key={c}
            className="inline-block h-2 w-2"
            style={{ background: c, border: "1px solid hsl(var(--border-subtle))" }}
          />
        ))}
        <span>More</span>
      </div>

      {/* tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-border bg-popover px-2.5 py-1.5 shadow-xl"
          style={{ left: hover.x + 12, top: hover.y + 24 }}
        >
          <div className="font-mono text-xs text-foreground">{formatDate(hover.day.date)}</div>
          <div className="font-mono text-2xs text-muted-foreground/70">
            {hover.day.count === 0
              ? "no commits"
              : `${hover.day.count} ${hover.day.count === 1 ? "commit" : "commits"}`}
          </div>
        </div>
      )}
    </div>
  );
}

function buildMonthLabels(grid: (HeatmapDay | null)[][], colWidth: number) {
  const labels: { label: string; x: number }[] = [];
  let lastMonth = -1;
  for (let i = 0; i < grid.length; i++) {
    const week = grid[i];
    const firstDay = week.find((d) => d !== null);
    if (!firstDay) continue;
    const month = new Date(firstDay.date + "T00:00:00Z").getUTCMonth();
    if (month !== lastMonth) {
      labels.push({
        label: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month],
        x: i * colWidth,
      });
      lastMonth = month;
    }
  }
  return labels;
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Build a HeatmapDay[] covering the last 52 weeks ending today. Counts entries
 * by their timestamp (or path-embedded date as a fallback).
 *
 * `entries` is just an iterable of objects with { path, meta? } shape — the
 * stats component passes everything from the bundle through this helper.
 */
export function buildDaysFromEntries(
  entries: Array<{ path: string; meta?: Record<string, unknown> | null }>,
  weeks = 52
): HeatmapDay[] {
  // Count entries per date string (YYYY-MM-DD).
  const counts = new Map<string, number>();
  for (const e of entries) {
    const ts = pickTimestamp(e.meta ?? undefined, e.path);
    if (ts === null) continue;
    const d = new Date(ts);
    const key = isoDate(d);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Build the window: 7*weeks days back from today.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 7 * weeks + 1);
  const out: HeatmapDay[] = [];
  for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = isoDate(d);
    out.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

function pickTimestamp(meta: Record<string, unknown> | undefined, path: string): number | null {
  if (meta) {
    for (const k of ["timestamp", "created_at", "updated_at", "last_updated"]) {
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

function isoDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
