// Practice-size donut — what the arkive currently consists of, by weight.
//
// Each slice = one practice. Width is the practice's entry_count as a
// fraction of total. Color comes from the user's painted practice color
// in the explorer (via folder-colors localStorage); if unpainted, falls
// back to a deterministic palette color so the chart still reads.
//
// Self-contained SVG (no d3) — small surface, no extra deps.

"use client";

import { useMemo, useState } from "react";
import { FOLDER_PALETTE, type FolderColors } from "./folder-colors";
import { useTheme } from "@/hooks/useTheme";

export type PracticeSlice = {
  name: string;
  display_name: string;
  count: number;
};

type Props = {
  slices: PracticeSlice[];
  /** localStorage-backed folder paint map; we resolve practice colors from it. */
  folderColors: FolderColors;
};

/**
 * Pick a deterministic palette index from the practice name so a given
 * practice always gets the same fallback color across sessions.
 */
function fallbackColorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return FOLDER_PALETTE[h % FOLDER_PALETTE.length];
}

function colorForPractice(name: string, folderColors: FolderColors): string {
  // Painted directly on the practice root in the explorer takes priority
  const direct = folderColors.get(`arkive/practices/${name}`);
  if (direct) return direct;
  // Then check the parent (practices/), so the user can paint "everything"
  const parent = folderColors.get("arkive/practices");
  if (parent) return parent;
  return fallbackColorFor(name);
}

export function PracticeSizeChart({ slices, folderColors }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const theme = useTheme();

  // Filter zero slices and sort largest-first so the chart reads.
  const real = useMemo(
    () => slices.filter((s) => s.count > 0).sort((a, b) => b.count - a.count),
    [slices]
  );
  const total = useMemo(() => real.reduce((s, x) => s + x.count, 0), [real]);

  const arcs = useMemo(() => {
    if (total === 0 || real.length === 0) return [];
    // Donut math: build SVG arc paths for each slice.
    const cx = 120;
    const cy = 120;
    const rOuter = 100;
    const rInner = 58;
    let angle = -Math.PI / 2; // start at 12 o'clock
    return real.map((s, i) => {
      const frac = s.count / total;
      const start = angle;
      const end = angle + frac * Math.PI * 2;
      angle = end;
      const color = colorForPractice(s.name, folderColors);
      return {
        ...s,
        idx: i,
        color,
        frac,
        pathD: arcPath(cx, cy, rOuter, rInner, start, end),
      };
    });
  }, [real, total, folderColors]);

  if (total === 0) {
    return (
      <div className="rounded-xl border border-border-subtle bg-panel overflow-hidden">
        <div className="flex h-9 items-center border-b border-border-subtle px-3 font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
          composition
        </div>
        <p className="px-3 py-4 text-sm text-muted-foreground">No entries yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-panel overflow-hidden">
      <div className="flex h-9 items-center justify-between border-b border-border-subtle px-3">
        <span className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
          composition
        </span>
        <span className="font-mono text-2xs text-muted-foreground/70">by practice size</span>
      </div>
      <div className="flex flex-col items-center gap-6 p-4 md:flex-row md:items-start md:gap-8">
        <div className="relative shrink-0">
          <svg viewBox="0 0 240 240" width={220} height={220}>
            {arcs.map((a) => {
              const isHover = hoverIdx === a.idx;
              const isDimmed = hoverIdx !== null && !isHover;
              return (
                <path
                  key={a.name}
                  d={a.pathD}
                  fill={a.color}
                  opacity={isDimmed ? 0.3 : 1}
                  stroke={theme === "light" ? "#f0f0f0" : "#121212"}
                  strokeWidth={1}
                  onMouseEnter={() => setHoverIdx(a.idx)}
                  onMouseLeave={() => setHoverIdx(null)}
                  style={{
                    cursor: "pointer",
                    transition: "opacity 120ms ease-out",
                  }}
                />
              );
            })}
            {/* Center label — total or hovered count */}
            <text
              x={120}
              y={114}
              textAnchor="middle"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontSize={11}
              fill={theme === "light" ? "#888888" : "#525252"}
              style={{ letterSpacing: "0.06em", textTransform: "uppercase" }}
            >
              {hoverIdx !== null ? real[hoverIdx].display_name : "Total"}
            </text>
            <text
              x={120}
              y={140}
              textAnchor="middle"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontSize={24}
              fontWeight={400}
              fill="currentColor"
            >
              {hoverIdx !== null ? real[hoverIdx].count : total}
            </text>
          </svg>
        </div>

        <ul className="flex-1 space-y-2 min-w-0 self-stretch">
          {arcs.map((a) => {
            const pct = (a.frac * 100).toFixed(a.frac < 0.1 ? 1 : 0);
            const isHover = hoverIdx === a.idx;
            return (
              <li
                key={a.name}
                onMouseEnter={() => setHoverIdx(a.idx)}
                onMouseLeave={() => setHoverIdx(null)}
                className={`flex items-center gap-3 px-2 py-1.5 transition-colors duration-120 ${
                  isHover ? "bg-secondary/50" : ""
                }`}
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 shrink-0"
                  style={{ background: a.color }}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                  {a.display_name}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {a.count}
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground/60">
                  {pct}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {arcs.some((a) => !a.color || a.color === fallbackColorFor(a.name)) && (
        <p className="border-t border-border-subtle px-3 py-2 font-code text-2xs uppercase tracking-wider text-muted-foreground/50">
          paint a practice folder in the explorer to set its slice color
        </p>
      )}
    </div>
  );
}

/**
 * SVG path for a donut slice from `start` to `end` radians, centered at
 * (cx, cy), with outer radius rOuter and inner radius rInner. Uses the
 * arc command's large-arc flag so slices > 180° render correctly. Handles
 * the full-circle case (a single slice covering everything) with a path
 * that draws two semicircles.
 */
function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number
): string {
  const sweep = end - start;
  const isFull = sweep >= Math.PI * 2 - 1e-6;

  if (isFull) {
    // Full donut — draw outer and inner circles, even-odd fill rule via
    // composing two arcs each.
    const oStart = `${cx + rOuter} ${cy}`;
    const oMid = `${cx - rOuter} ${cy}`;
    const iStart = `${cx + rInner} ${cy}`;
    const iMid = `${cx - rInner} ${cy}`;
    return [
      `M ${oStart}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${oMid}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${oStart}`,
      `M ${iStart}`,
      `A ${rInner} ${rInner} 0 1 0 ${iMid}`,
      `A ${rInner} ${rInner} 0 1 0 ${iStart}`,
      "Z",
    ].join(" ");
  }

  const large = sweep > Math.PI ? 1 : 0;
  const x1 = cx + rOuter * Math.cos(start);
  const y1 = cy + rOuter * Math.sin(start);
  const x2 = cx + rOuter * Math.cos(end);
  const y2 = cy + rOuter * Math.sin(end);
  const x3 = cx + rInner * Math.cos(end);
  const y3 = cy + rInner * Math.sin(end);
  const x4 = cx + rInner * Math.cos(start);
  const y4 = cy + rInner * Math.sin(start);

  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}
