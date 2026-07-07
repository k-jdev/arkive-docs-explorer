"use client";

import { useEffect, useState, useCallback } from "react";
import { ActivityHeatmap } from "@/components/ActivityHeatmap";

type Wallet = { id: string; address: string; label: string; purpose: string | null; tags: string[] };

type Overview = {
  totalRealizedUsd: number;
  totalUnrealizedUsd: number;
  totalPnlUsd: number;
  pnlPct: number | null;
  totalInvestedUsd: number;
  totalProceedsUsd: number;
  openPositionCount: number;
  closedPositionCount: number;
  openPositionValueUsd: number;
  netCashFlowUsd: number;
  netCashFlowDayUsd: number;
  winRatePct: number | null;
  winners: number;
  losers: number;
  biggestWinner: { token: string; pnlUsd: number } | null;
  biggestLoser: { token: string; pnlUsd: number } | null;
};

type Holding = {
  symbol: string;
  address: string;
  chain: string;
  amount: number;
  avgEntryUsd: number;
  currentPriceUsd: number | null;
  currentValueUsd: number | null;
  costBasisUsd: number;
  unrealizedPnlUsd: number | null;
  unrealizedPnlPct: number | null;
  realizedPnlUsd: number;
  tradesBuy: number;
  tradesSell: number;
  safetyLevel?: "safe" | "caution" | "danger" | "unknown";
  safetyReasons?: string[];
};

type ClosedPos = {
  symbol: string;
  chain: string;
  realizedPnlUsd: number;
  tradesBuy: number;
  tradesSell: number;
  lastTradeAt: string;
};

type Allocation = { symbol: string; valueUsd: number; pct: number };

type ChainStats = {
  chain: string;
  trades: number;
  buyTrades: number;
  sellTrades: number;
  volumeUsd: number;
  firstTrade: string | null;
  lastTrade: string | null;
};

type SpotVenue = {
  active: true;
  label: string;
  chains: string[];
  overview: Overview | null;
  activeHoldings: Holding[];
  closedPositions: ClosedPos[];
  allocation: Allocation[];
  balanceTimeline: Array<{ at: string; valueUsd: number }>;
  windows: {
    "24h": { trades: number; volumeUsd: number };
    "7d": { trades: number; volumeUsd: number };
    "30d": { trades: number; volumeUsd: number };
    all: { trades: number; volumeUsd: number };
  };
  byChain: ChainStats[];
};

type DashboardData = {
  selectedWalletId: string | null;
  wallets: Wallet[];
  arkiveActivity: {
    totalEntries: number;
    totalChanges: number;
    activeDays: number;
    longestStreak: number;
    currentStreak: number;
    perArkive: Record<string, number>;
    days: Array<{ date: string; count: number; created: number; updated: number }>;
  };
  venues: {
    "spot-uniswap": SpotVenue;
    "perps-hyperliquid": { active: false; label: string; comingSoon: true };
    "spot-solana": { active: false; label: string; comingSoon: true };
    "perps-solana": { active: false; label: string; comingSoon: true };
  };
};

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [walletId, setWalletId] = useState<string>("__all__");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (wid: string) => {
    setLoading(true);
    try {
      const url = wid === "__all__" ? "/api/dashboard" : `/api/dashboard?walletId=${wid}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(walletId);
  }, [walletId, load]);

  if (loading && !data) return <div className="rounded-lg border border-border bg-card p-6 text-muted-foreground">Loading…</div>;
  if (error) return <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-destructive">{error}</div>;
  if (!data) return null;

  const spot = data.venues["spot-uniswap"];
  const o = spot.overview;

  return (
    <div className="space-y-6">
      {/* Wallet selector */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-muted-foreground">Wallet</label>
        <select
          value={walletId}
          onChange={(e) => setWalletId(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
        >
          <option value="__all__">All wallets ({data.wallets.length})</option>
          {data.wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label} {w.purpose ? `· ${w.purpose}` : ""}
            </option>
          ))}
        </select>
        {walletId !== "__all__" && (
          <span className="tabular-nums text-xs text-muted-foreground">
            {data.wallets.find((w) => w.id === walletId)?.address}
          </span>
        )}
      </div>

      {/* SPOT — Uniswap (active venue) */}
      <section>
        <SectionHeader badge="live" title={spot.label} subtitle={`On-chain via Uniswap V2 · ${spot.chains.join(" + ")}`} />

        {o && (
          <>
            {/* Overview hero — ashpool-style headline numbers */}
            <Card className="mt-3">
              <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                {/* Left: big total PnL + breakdown */}
                <div>
                  <div className="font-code text-xs uppercase tracking-wider text-muted-foreground">Total PnL · all-time</div>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className={"tabular-nums text-4xl font-semibold tracking-tight " + colorClass(o.totalPnlUsd)}>
                      {fmtSignedUsd(o.totalPnlUsd)}
                    </span>
                    {o.pnlPct != null && (
                      <span className={"tabular-nums text-sm " + colorClass(o.pnlPct)}>{fmtSignedPct(o.pnlPct)}</span>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    <KV label="Realized" value={fmtSignedUsd(o.totalRealizedUsd)} tone={colorClass(o.totalRealizedUsd)} />
                    <KV label="Unrealized" value={fmtSignedUsd(o.totalUnrealizedUsd)} tone={colorClass(o.totalUnrealizedUsd)} />
                    <KV label="Today's net flow" value={fmtSignedUsd(o.netCashFlowDayUsd)} tone={colorClass(o.netCashFlowDayUsd)} />
                    <KV label="Open value" value={fmtUsd(o.openPositionValueUsd)} />
                    <KV label="Invested" value={fmtUsd(o.totalInvestedUsd)} />
                    <KV label="Proceeds" value={fmtUsd(o.totalProceedsUsd)} />
                  </div>
                </div>
                {/* Right: counts + ratios */}
                <div className="grid grid-cols-2 gap-3">
                  <MiniStat label="Open positions" value={String(o.openPositionCount)} />
                  <MiniStat label="Closed" value={String(o.closedPositionCount)} />
                  <MiniStat
                    label="Win rate"
                    value={o.winRatePct != null ? `${o.winRatePct.toFixed(1)}%` : "—"}
                    sub={o.winRatePct != null ? `${o.winners}W / ${o.losers}L` : undefined}
                  />
                  <MiniStat
                    label="Best"
                    value={o.biggestWinner ? `+${fmtUsd(o.biggestWinner.pnlUsd)}` : "—"}
                    sub={o.biggestWinner?.token}
                    tone="text-emerald-600"
                  />
                </div>
              </div>
            </Card>

            {/* Portfolio timeline + Allocation side by side */}
            <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
              <Card title="Cash flow timeline" subtitle="Cumulative sells − buys, anchored at first trade. Not total portfolio value — that needs historical token prices.">
                <BalanceChart points={spot.balanceTimeline} />
              </Card>
              <Card title="Allocation" subtitle="By current USD value of open positions">
                <AllocationBar allocation={spot.allocation} />
              </Card>
            </div>

            {/* Active holdings table */}
            <Card className="mt-4" title={`Active holdings (${spot.activeHoldings.length})`}>
              <HoldingsTable holdings={spot.activeHoldings} onReload={() => void load(walletId)} />
            </Card>

            {/* Closed positions */}
            {spot.closedPositions.length > 0 && (
              <Card className="mt-4" title={`Closed positions (${spot.closedPositions.length})`}>
                <ClosedTable positions={spot.closedPositions} />
              </Card>
            )}

            {/* Trading activity */}
            <Card className="mt-4" title="Trading activity">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <WindowStat label="Last 24h" w={spot.windows["24h"]} />
                <WindowStat label="Last 7d" w={spot.windows["7d"]} />
                <WindowStat label="Last 30d" w={spot.windows["30d"]} />
                <WindowStat label="All time" w={spot.windows.all} />
              </div>
              {spot.byChain.length > 0 && (
                <div className="mt-4">
                  <h3 className="mb-2 font-code text-xs font-semibold uppercase tracking-wider text-muted-foreground">By chain</h3>
                  <div className="overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-secondary text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Chain</th>
                          <th className="px-3 py-2 text-right font-medium">Trades</th>
                          <th className="px-3 py-2 text-right font-medium">Buys / Sells</th>
                          <th className="px-3 py-2 text-right font-medium">Volume</th>
                          <th className="px-3 py-2 text-right font-medium">Last trade</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {spot.byChain.map((c) => (
                          <tr key={c.chain}>
                            <td className="px-3 py-2 font-medium">{c.chain}</td>
                            <td className="px-3 py-2 text-right">{c.trades}</td>
                            <td className="px-3 py-2 text-right text-muted-foreground">{c.buyTrades} / {c.sellTrades}</td>
                            <td className="px-3 py-2 text-right">{fmtUsd(c.volumeUsd)}</td>
                            <td className="px-3 py-2 text-right text-muted-foreground">{c.lastTrade ? fmtRelDate(c.lastTrade) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Card>
          </>
        )}
      </section>

      {/* Activity tracker — moved below trading */}
      <Card title="Arkive activity" subtitle="Changes across every arkive over the last 52 weeks. Entries created and updated by you, Claude, and the system.">
        <ActivityHeatmap days={data.arkiveActivity.days} />
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span>Entries: <strong className="text-foreground">{data.arkiveActivity.totalEntries.toLocaleString()}</strong></span>
          <span>Total changes: <strong className="text-foreground">{data.arkiveActivity.totalChanges.toLocaleString()}</strong></span>
          <span>Active days: <strong className="text-foreground">{data.arkiveActivity.activeDays}</strong></span>
          <span>Current streak: <strong className="text-foreground">{data.arkiveActivity.currentStreak}d</strong></span>
          <span>Longest: <strong className="text-foreground">{data.arkiveActivity.longestStreak}d</strong></span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-8">
          {Object.entries(data.arkiveActivity.perArkive).map(([slug, count]) => (
            <div key={slug} className="rounded-lg border border-border bg-secondary px-2.5 py-1.5">
              <div className="text-muted-foreground">{slug}</div>
              <div className="font-semibold text-foreground">{count.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Future-venue placeholders */}
      <section>
        <h2 className="mb-2 font-code text-xs font-semibold uppercase tracking-wider text-muted-foreground">Future venues</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <PlaceholderCard label={data.venues["perps-hyperliquid"].label} />
          <PlaceholderCard label={data.venues["spot-solana"].label} />
          <PlaceholderCard label={data.venues["perps-solana"].label} />
        </div>
      </section>
    </div>
  );
}

/* ============================================================================
   building blocks
============================================================================ */

function SectionHeader({ badge, title, subtitle }: { badge?: string; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-3">
      {badge && (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-2xs font-medium uppercase text-success">{badge}</span>
      )}
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
    </div>
  );
}

function Card({ title, subtitle, children, className = "" }: { title?: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={"rounded-lg border border-border bg-card p-5 " + className}>
      {(title || subtitle) && (
        <div className="mb-4">
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

function KV({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={"tabular-nums text-sm " + (tone ?? "text-foreground")}>{value}</span>
    </div>
  );
}

function MiniStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"mt-1 tabular-nums text-lg font-semibold " + (tone ?? "text-foreground")}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function WindowStat({ label, w }: { label: string; w: { trades: number; volumeUsd: number } }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="tabular-nums text-base font-semibold">{w.trades}</span>
        <span className="text-xs text-muted-foreground">trades</span>
      </div>
      <div className="text-xs text-muted-foreground">{fmtUsd(w.volumeUsd)} volume</div>
    </div>
  );
}

function PlaceholderCard({ label }: { label: string }) {
  return (
    <section className="rounded-lg border border-dashed border-border bg-card p-5 text-center">
      <div className="font-code text-xs uppercase tracking-wider text-muted-foreground">Coming soon</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{label}</div>
      <p className="mt-2 text-xs text-muted-foreground">Stats will appear once integrated. Per-venue separation already built in.</p>
    </section>
  );
}

/* ---------- charts ---------- */

function BalanceChart({ points }: { points: Array<{ at: string; valueUsd: number }> }) {
  if (points.length === 0) return <div className="py-8 text-center text-sm text-muted-foreground">No trades yet.</div>;
  const W = 700;
  const H = 200;
  const padL = 38;
  const padR = 8;
  const padT = 8;
  const padB = 24;
  const xs = points.map((p) => new Date(p.at).getTime());
  const ys = points.map((p) => p.valueUsd);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys, 0);
  const yMax = Math.max(...ys, 0);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const proj = (p: { at: string; valueUsd: number }) => ({
    x: padL + ((new Date(p.at).getTime() - xMin) / xRange) * innerW,
    y: padT + innerH - ((p.valueUsd - yMin) / yRange) * innerH,
  });
  const projected = points.map(proj);
  // Build SVG step-function path
  let d = `M${projected[0].x},${projected[0].y}`;
  for (let i = 1; i < projected.length; i++) {
    d += ` L${projected[i].x},${projected[i - 1].y} L${projected[i].x},${projected[i].y}`;
  }
  // Area below the line (for fill)
  const zeroY = padT + innerH - ((0 - yMin) / yRange) * innerH;
  const area = `${d} L${projected[projected.length - 1].x},${zeroY} L${projected[0].x},${zeroY} Z`;

  // Y-axis ticks at min / 0 / max
  const ticks = [yMax, 0, yMin].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="cash-flow timeline">
      {/* zero line */}
      <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="#E5E7EE" strokeDasharray="2 2" />
      {/* area + line */}
      <path d={area} fill="#2962FF" opacity={0.08} />
      <path d={d} fill="none" stroke="#2962FF" strokeWidth={1.5} />
      {/* ticks */}
      {ticks.map((v) => {
        const y = padT + innerH - ((v - yMin) / yRange) * innerH;
        return (
          <g key={v}>
            <text x={padL - 4} y={y + 3} textAnchor="end" fontSize="9" fill="#6B7280">
              {fmtCompactUsd(v)}
            </text>
          </g>
        );
      })}
      {/* date labels */}
      <text x={padL} y={H - 6} fontSize="9" fill="#6B7280">{new Date(xMin).toLocaleDateString()}</text>
      <text x={W - padR} y={H - 6} fontSize="9" fill="#6B7280" textAnchor="end">{new Date(xMax).toLocaleDateString()}</text>
    </svg>
  );
}

function AllocationBar({ allocation }: { allocation: Allocation[] }) {
  if (allocation.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No open positions.</div>;
  }
  const palette = ["#2962FF", "#1E3FAA", "#5B8BFF", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#14B8A6"];
  return (
    <div>
      <div className="flex h-8 w-full overflow-hidden rounded-lg border border-border">
        {allocation.map((a, i) => (
          <div
            key={a.symbol}
            title={`${a.symbol}: ${a.pct}% ($${a.valueUsd.toFixed(2)})`}
            style={{ width: `${a.pct}%`, background: palette[i % palette.length] }}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {allocation.map((a, i) => (
          <li key={a.symbol} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 truncate">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: palette[i % palette.length] }} />
              <span className="truncate font-medium">{a.symbol}</span>
            </span>
            <span className="flex items-center gap-3 tabular-nums text-xs text-muted-foreground">
              <span>{fmtUsd(a.valueUsd)}</span>
              <span className="w-10 text-right">{a.pct}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- tables ---------- */

function HoldingsTable({ holdings, onReload }: { holdings: Holding[]; onReload?: () => void }) {
  const [hiding, setHiding] = useState<string | null>(null);

  async function hide(h: Holding) {
    const label = `${h.symbol} (${h.chain})`;
    if (!confirm(`Hide ${label} permanently from your portfolio?\n\nUse for spam / scam airdrops. You can unhide it later via the MCP tool unhide_token.`)) return;
    const key = h.address + h.chain;
    setHiding(key);
    try {
      const res = await fetch("/api/hidden-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chain: h.chain, address: h.address, symbol: h.symbol }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(`Hide failed: ${body?.error ?? res.status}`);
      } else {
        onReload?.();
      }
    } finally {
      setHiding(null);
    }
  }

  if (holdings.length === 0) return <div className="py-6 text-center text-sm text-muted-foreground">No open positions.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-2 py-2 text-left font-medium">Token</th>
            <th className="px-2 py-2 text-right font-medium">Amount</th>
            <th className="px-2 py-2 text-right font-medium">Avg entry</th>
            <th className="px-2 py-2 text-right font-medium">Current</th>
            <th className="px-2 py-2 text-right font-medium">Value</th>
            <th className="px-2 py-2 text-right font-medium">Unreal %</th>
            <th className="px-2 py-2 text-right font-medium">Unreal $</th>
            <th className="px-2 py-2 text-right font-medium">Real $</th>
            <th className="px-2 py-2 text-right font-medium">B/S</th>
            <th className="px-2 py-2 text-right font-medium">Chain</th>
            <th className="px-2 py-2 text-right font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {holdings.map((h) => {
            const unpriced = h.currentPriceUsd == null;
            const isScam = h.safetyLevel === "danger";
            const isCaution = h.safetyLevel === "caution";
            const safetyTitle = (h.safetyReasons ?? []).join("\n");
            return (
              <tr key={h.address + h.chain} className={isScam ? "text-destructive/80" : unpriced ? "text-muted-foreground" : ""}>
                <td className="px-2 py-2 font-medium">
                  <div className="flex items-center gap-1.5">
                    <span>{h.symbol}</span>
                    {isScam && (
                      <span
                        title={`SCAM detected via GoPlus:\n${safetyTitle}`}
                        className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-2xs uppercase tracking-wider text-destructive"
                      >
                        scam
                      </span>
                    )}
                    {!isScam && isCaution && (
                      <span
                        title={`Caution flags (GoPlus):\n${safetyTitle}`}
                        className="rounded-full bg-warning/15 px-1.5 py-0.5 text-2xs uppercase tracking-wider text-warning"
                      >
                        caution
                      </span>
                    )}
                    {!isScam && unpriced && (
                      <span
                        title="No reliable price — routing pool below your liquidity floor. Likely scam or dust. Click ✕ to hide."
                        className="rounded-full bg-warning/15 px-1.5 py-0.5 text-2xs uppercase tracking-wider text-warning"
                      >
                        unpriced
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtAmount(h.amount)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{fmtUsdSmall(h.avgEntryUsd)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{h.currentPriceUsd != null ? fmtUsdSmall(h.currentPriceUsd) : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{h.currentValueUsd != null ? fmtUsd(h.currentValueUsd) : "—"}</td>
                <td className={"px-2 py-2 text-right tabular-nums " + (h.unrealizedPnlPct != null ? colorClass(h.unrealizedPnlPct) : "text-muted-foreground")}>
                  {h.unrealizedPnlPct != null ? fmtSignedPct(h.unrealizedPnlPct) : "—"}
                </td>
                <td className={"px-2 py-2 text-right tabular-nums " + (h.unrealizedPnlUsd != null ? colorClass(h.unrealizedPnlUsd) : "text-muted-foreground")}>
                  {h.unrealizedPnlUsd != null ? fmtSignedUsd(h.unrealizedPnlUsd) : "—"}
                </td>
                <td className={"px-2 py-2 text-right tabular-nums " + colorClass(h.realizedPnlUsd)}>{fmtSignedUsd(h.realizedPnlUsd)}</td>
                <td className="px-2 py-2 text-right text-muted-foreground">{h.tradesBuy}/{h.tradesSell}</td>
                <td className="px-2 py-2 text-right text-xs text-muted-foreground">{h.chain}</td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => hide(h)}
                    disabled={hiding === h.address + h.chain}
                    title="Hide this token permanently — for scam/spam airdrops"
                    className="rounded-lg px-2 py-0.5 text-xs text-muted-foreground transition-colors duration-120 hover:bg-secondary hover:text-destructive disabled:opacity-50"
                  >
                    {hiding === h.address + h.chain ? "…" : "✕"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ClosedTable({ positions }: { positions: ClosedPos[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-2 py-2 text-left font-medium">Token</th>
            <th className="px-2 py-2 text-right font-medium">Realized PnL</th>
            <th className="px-2 py-2 text-right font-medium">Buys</th>
            <th className="px-2 py-2 text-right font-medium">Sells</th>
            <th className="px-2 py-2 text-right font-medium">Closed</th>
            <th className="px-2 py-2 text-right font-medium">Chain</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {positions.map((p) => (
            <tr key={p.symbol + p.chain + p.lastTradeAt}>
              <td className="px-2 py-2 font-medium">{p.symbol}</td>
              <td className={"px-2 py-2 text-right tabular-nums " + colorClass(p.realizedPnlUsd)}>{fmtSignedUsd(p.realizedPnlUsd)}</td>
              <td className="px-2 py-2 text-right text-muted-foreground">{p.tradesBuy}</td>
              <td className="px-2 py-2 text-right text-muted-foreground">{p.tradesSell}</td>
              <td className="px-2 py-2 text-right text-muted-foreground">{fmtRelDate(p.lastTradeAt)}</td>
              <td className="px-2 py-2 text-right text-xs text-muted-foreground">{p.chain}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- formatters ---------- */

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (Math.abs(n) >= 1 || n === 0) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtUsdSmall(n: number): string {
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  if (Math.abs(n) >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toExponential(2)}`;
}

function fmtCompactUsd(n: number): string {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtSignedUsd(n: number): string {
  const s = fmtUsd(Math.abs(n));
  if (n > 0.005) return `+${s}`;
  if (n < -0.005) return `−${s}`;
  return s;
}

function fmtSignedPct(n: number): string {
  if (n > 0) return `+${n.toFixed(1)}%`;
  if (n < 0) return `${n.toFixed(1)}%`;
  return "0%";
}

function fmtAmount(n: number): string {
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(n) >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function fmtRelDate(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (ms < day) return "today";
  if (ms < 7 * day) return `${Math.floor(ms / day)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function colorClass(n: number): string {
  if (n > 0.005) return "text-emerald-600";
  if (n < -0.005) return "text-destructive";
  return "text-foreground";
}
