"use client";

// GitHub-style contribution heatmap over the last 52 weeks.
// 7 rows (Sun-Sat) × 53 columns. Each cell = 1 day. Color intensity scales with change count.
// Brand palette: white → light blue → blue → dark blue.

import { useMemo, useState } from "react";

type Day = { date: string; count: number; created: number; updated: number };

const PALETTE = ["#F1F5F9", "#BFDBFE", "#60A5FA", "#2962FF", "#1E3FAA"];

function bucket(count: number): number {
  if (count === 0) return 0;
  if (count <= 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

export function ActivityHeatmap({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<{ x: number; y: number; day: Day } | null>(null);

  // Group into 53 weekly columns. Pad the first week so day-of-week aligns to the row.
  const grid = useMemo(() => {
    if (days.length === 0) return [] as (Day | null)[][];
    const cols: (Day | null)[][] = [];
    let week: (Day | null)[] = [];
    // Pad start so the first day of the array sits in its correct day-of-week row.
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

  const cellSize = 11;
  const cellGap = 3;
  const colWidth = cellSize + cellGap;
  const rowHeight = cellSize + cellGap;
  const W = grid.length * colWidth;
  const H = 7 * rowHeight + 22; // extra for month labels
  const monthLabels = useMemo(() => buildMonthLabels(grid, colWidth), [grid, colWidth]);
  const dayLabels = ["Mon", "Wed", "Fri"];

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <svg width={W + 26} height={H} className="block">
          {/* day-of-week labels */}
          <g fontSize="9" fill="#6B7280">
            {dayLabels.map((d, i) => (
              <text key={d} x={0} y={22 + (i * 2 + 1) * rowHeight + 8}>
                {d}
              </text>
            ))}
          </g>
          {/* month labels */}
          <g fontSize="9" fill="#6B7280">
            {monthLabels.map((m) => (
              <text key={m.label + m.x} x={26 + m.x} y={10}>
                {m.label}
              </text>
            ))}
          </g>
          {/* cells */}
          <g transform="translate(26, 18)">
            {grid.map((week, wi) =>
              week.map((d, di) => {
                if (!d) return null;
                const b = bucket(d.count);
                const x = wi * colWidth;
                const y = di * rowHeight;
                return (
                  <rect
                    key={d.date}
                    x={x}
                    y={y}
                    width={cellSize}
                    height={cellSize}
                    rx={2}
                    fill={PALETTE[b]}
                    stroke="#fff"
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
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>Less</span>
        {PALETTE.map((c) => (
          <span key={c} className="inline-block h-3 w-3 rounded-sm" style={{ background: c }} />
        ))}
        <span>More</span>
      </div>

      {/* tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg bg-background px-2 py-1 text-xs text-white shadow-lg"
          style={{ left: hover.x + 12, top: hover.y - 4 }}
        >
          <div className="font-medium">{formatDate(hover.day.date)}</div>
          <div className="text-muted-foreground">
            {hover.day.count} {hover.day.count === 1 ? "change" : "changes"}
            {hover.day.count > 0 ? ` (${hover.day.created} created · ${hover.day.updated} updated)` : ""}
          </div>
        </div>
      )}
    </div>
  );
}

function buildMonthLabels(grid: (Day | null)[][], colWidth: number) {
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
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
