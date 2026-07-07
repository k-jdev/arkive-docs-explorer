// Dashboard aggregation endpoint. Inspired by ashpool's portfolioService:
//   - overview block with totalUsd / pnlPct / pnlDayUtcUsd / etc
//   - activeHoldings + closedPositions arrays (per-token detail)
//   - allocation %s
//   - balanceTimeline (step-function reconstruction from trade notionals, anchored to today)
//   - per-chain stats + trading windows
//   - GitHub-style arkive activity heatmap
//
// All filterable by walletId.

import { NextResponse } from "next/server";
import type { Address } from "viem";
import { listWallets } from "@/lib/keystore";
import { computePnlSummary, computePositions, listTrades, type Trade, type Position } from "@/lib/trades";

export async function GET(req: Request) {
  try {
    return await handle(req);
  } catch (e) {
    // Top-level safety net — guarantees the client always gets parseable JSON
    // instead of an empty body / HTML 500 page (which would surface as the
    // dreaded "Unexpected end of JSON input" on the dashboard).
    console.error("/api/dashboard failed:", e);
    return NextResponse.json(
      { error: (e as Error).message ?? "Dashboard failed to load" },
      { status: 500 }
    );
  }
}

async function handle(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const walletIdRaw = searchParams.get("walletId");
  const walletId = walletIdRaw && walletIdRaw !== "__all__" ? walletIdRaw : null;
  const wallets = await listWallets();
  const filtered = walletId ? wallets.filter((w) => w.id === walletId) : wallets;
  const walletAddressForFilter = walletId ? (filtered[0]?.address as Address | undefined) : undefined;

  // The legacy arkive-activity heatmap was sourced from the v1 typed arkive
  // counts (evidence/, recaps/, etc.) which no longer exist. v2 ships its own
  // arkive surface at /arkives; the dashboard only needs trade-derived data.
  const arkiveCounts: Record<string, number> = {};
  const totalEntries = 0;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days: Array<{ date: string; count: number; created: number; updated: number }> = [];
  for (let i = 363; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    days.push({ date: d.toISOString().slice(0, 10), count: 0, created: 0, updated: 0 });
  }
  const activeDays = 0;
  const totalChanges = 0;

  // ---------- positions + pnl ----------
  const positions = await computePositions({ walletAddress: walletAddressForFilter }).catch(() => [] as Position[]);
  const rawPnl = await computePnlSummary({ walletAddress: walletAddressForFilter }).catch(() => null);
  const pnl = rawPnl
    ? {
        ...rawPnl,
        winRatePct:
          rawPnl.winners + rawPnl.losers > 0
            ? Math.round((rawPnl.winners / (rawPnl.winners + rawPnl.losers)) * 1000) / 10
            : null,
        pnlPct:
          rawPnl.totalInvestedUsd > 0
            ? Math.round((rawPnl.totalPnlUsd / rawPnl.totalInvestedUsd) * 10000) / 100
            : null,
      }
    : null;

  // ---------- trades + per-chain + windows ----------
  const allTrades = await listTrades({ walletAddress: walletAddressForFilter }).catch(() => [] as Trade[]);
  const byChain = aggregateByChain(allTrades);
  const windows = buildWindows(allTrades);

  // ---------- active holdings (open) + closed positions ----------
  const activeHoldings = positions
    .filter((p) => p.remainingTokens > 0)
    .map((p) => ({
      symbol: p.token.symbol,
      address: p.token.address,
      chain: p.chain,
      amount: round(p.remainingTokens, 6),
      avgEntryUsd: round(p.avgEntryUsd, 8),
      currentPriceUsd: p.currentPriceUsd !== null ? round(p.currentPriceUsd, 8) : null,
      currentValueUsd: p.currentValueUsd !== null ? round(p.currentValueUsd, 2) : null,
      costBasisUsd: round(p.costBasisUsd, 2),
      unrealizedPnlUsd: p.unrealizedPnlUsd !== null ? round(p.unrealizedPnlUsd, 2) : null,
      unrealizedPnlPct:
        p.currentPriceUsd !== null && p.avgEntryUsd > 0
          ? round(((p.currentPriceUsd - p.avgEntryUsd) / p.avgEntryUsd) * 100, 2)
          : null,
      realizedPnlUsd: round(p.realizedPnlUsd, 2),
      tradesBuy: p.buyTrades,
      tradesSell: p.sellTrades,
      firstTradeAt: new Date(p.firstTradeAt).toISOString(),
      lastTradeAt: new Date(p.lastTradeAt).toISOString(),
      // GoPlus safety verdict — danger-level tokens get currentValueUsd nulled
      // by computePositions, so they're already excluded from heldValue below.
      // We surface the verdict so the UI can render a "scam"/"caution" pill.
      safetyLevel: p.safety?.level ?? "unknown",
      safetyReasons: p.safety?.reasons ?? [],
    }))
    .sort((a, b) => (b.currentValueUsd ?? 0) - (a.currentValueUsd ?? 0));

  const closedPositions = positions
    .filter((p) => p.remainingTokens === 0 && (p.buyTrades + p.sellTrades) > 0)
    .map((p) => ({
      symbol: p.token.symbol,
      address: p.token.address,
      chain: p.chain,
      realizedPnlUsd: round(p.realizedPnlUsd, 2),
      tradesBuy: p.buyTrades,
      tradesSell: p.sellTrades,
      firstTradeAt: new Date(p.firstTradeAt).toISOString(),
      lastTradeAt: new Date(p.lastTradeAt).toISOString(),
    }))
    .sort((a, b) => b.realizedPnlUsd - a.realizedPnlUsd);

  // ---------- allocation ----------
  const heldValue = activeHoldings.reduce((s, h) => s + (h.currentValueUsd ?? 0), 0);
  const allocation = heldValue > 0
    ? activeHoldings
        .filter((h) => (h.currentValueUsd ?? 0) > 0)
        .map((h) => ({ symbol: h.symbol, valueUsd: h.currentValueUsd!, pct: round(((h.currentValueUsd ?? 0) / heldValue) * 100, 1) }))
    : [];

  // ---------- balance timeline (step-function, ashpool style) ----------
  // Each trade is a delta: buy = -tradeUsd (cash out), sell = +tradeUsd (cash in). The line
  // shows cumulative cash flow over time. Anchored so the final point matches the current
  // realized + invested baseline. This is NOT total-portfolio-value over time (we don't have
  // historical token prices) — it's the cash trajectory of the user's wallet.
  const balanceTimeline = buildBalanceTimeline(allTrades, pnl?.totalProceedsUsd ?? 0);

  // ---------- overview (top-line ashpool overview block) ----------
  const overview = pnl
    ? {
        totalRealizedUsd: pnl.totalRealizedUsd,
        totalUnrealizedUsd: pnl.totalUnrealizedUsd,
        totalPnlUsd: pnl.totalPnlUsd,
        pnlPct: pnl.pnlPct,
        totalInvestedUsd: pnl.totalInvestedUsd,
        totalProceedsUsd: pnl.totalProceedsUsd,
        openPositionCount: activeHoldings.length,
        closedPositionCount: closedPositions.length,
        openPositionValueUsd: round(heldValue, 2),
        netCashFlowUsd: round(pnl.totalProceedsUsd - pnl.totalInvestedUsd, 2),
        winRatePct: pnl.winRatePct,
        winners: pnl.winners,
        losers: pnl.losers,
        biggestWinner: pnl.biggestWinner,
        biggestLoser: pnl.biggestLoser,
        // Today's net cash flow (UTC day): sell USD − buy USD for trades executed today.
        // Not strictly "today's PnL" (would need realized matching), but a useful day signal.
        netCashFlowDayUsd: computeDayNetCashFlow(allTrades),
      }
    : null;

  return NextResponse.json({
    selectedWalletId: walletId,
    wallets: wallets.map((w) => ({
      id: w.id,
      address: w.address,
      label: w.label,
      purpose: w.purpose ?? null,
      tags: w.tags ?? [],
    })),
    arkiveActivity: {
      totalEntries,
      totalChanges,
      activeDays,
      longestStreak: computeLongestStreak(days),
      currentStreak: computeCurrentStreak(days),
      perArkive: arkiveCounts,
      days,
    },
    venues: {
      "spot-uniswap": {
        active: true,
        label: "Spot · Uniswap",
        chains: ["ethereum", "base"],
        overview,
        activeHoldings,
        closedPositions,
        allocation,
        balanceTimeline,
        windows,
        byChain,
      },
      "perps-hyperliquid": { active: false, label: "Perps · Hyperliquid", comingSoon: true },
      "spot-solana": { active: false, label: "Spot · Solana", comingSoon: true },
      "perps-solana": { active: false, label: "Perps · Solana", comingSoon: true },
    },
  });
}

// ============================================================================
// helpers
// ============================================================================

type ChainStats = {
  chain: string;
  trades: number;
  buyTrades: number;
  sellTrades: number;
  volumeUsd: number;
  firstTrade: string | null;
  lastTrade: string | null;
};

function aggregateByChain(trades: Trade[]): ChainStats[] {
  const m = new Map<string, ChainStats>();
  for (const t of trades) {
    const c = t.chain;
    if (!m.has(c)) {
      m.set(c, { chain: c, trades: 0, buyTrades: 0, sellTrades: 0, volumeUsd: 0, firstTrade: null, lastTrade: null });
    }
    const s = m.get(c)!;
    s.trades++;
    if (t.side === "buy") s.buyTrades++; else s.sellTrades++;
    s.volumeUsd += t.tradeUsd;
    const iso = new Date(t.executedAt).toISOString();
    if (!s.firstTrade || iso < s.firstTrade) s.firstTrade = iso;
    if (!s.lastTrade || iso > s.lastTrade) s.lastTrade = iso;
  }
  return [...m.values()].map((s) => ({ ...s, volumeUsd: round(s.volumeUsd, 2) }));
}

function buildWindows(trades: Trade[]) {
  const now = Date.now();
  const wnd = (ms: number) => {
    const cutoff = now - ms;
    const ts = trades.filter((t) => t.executedAt >= cutoff);
    return { trades: ts.length, volumeUsd: round(ts.reduce((s, t) => s + t.tradeUsd, 0), 2) };
  };
  return {
    "24h": wnd(24 * 60 * 60 * 1000),
    "7d": wnd(7 * 24 * 60 * 60 * 1000),
    "30d": wnd(30 * 24 * 60 * 60 * 1000),
    all: { trades: trades.length, volumeUsd: round(trades.reduce((s, t) => s + t.tradeUsd, 0), 2) },
  };
}

/**
 * Step-function cash flow timeline. Each point is the cumulative net cash flow
 * (sell − buy) up to that trade. Anchored so the rightmost point equals the
 * user's actual current net (= proceeds − invested).
 *
 * Returns up to 200 sample points (down-sampled for chart rendering).
 */
function buildBalanceTimeline(trades: Trade[], _proceeds: number): Array<{ at: string; valueUsd: number }> {
  if (trades.length === 0) return [];
  const sorted = [...trades].sort((a, b) => a.executedAt - b.executedAt);
  let cur = 0;
  const all: Array<{ at: string; valueUsd: number }> = [];
  // Anchor at zero at the time of the first trade
  all.push({ at: new Date(sorted[0].executedAt).toISOString(), valueUsd: 0 });
  for (const t of sorted) {
    const delta = t.side === "sell" ? t.tradeUsd : -t.tradeUsd;
    cur += delta;
    all.push({ at: new Date(t.executedAt).toISOString(), valueUsd: round(cur, 2) });
  }
  // Down-sample to ~200 points if huge
  if (all.length <= 200) return all;
  const stride = Math.ceil(all.length / 200);
  const out: typeof all = [];
  for (let i = 0; i < all.length; i += stride) out.push(all[i]);
  if (out[out.length - 1].at !== all[all.length - 1].at) out.push(all[all.length - 1]);
  return out;
}

function computeDayNetCashFlow(trades: Trade[]): number {
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);
  const cutoff = startOfDayUtc.getTime();
  let net = 0;
  for (const t of trades) {
    if (t.executedAt < cutoff) continue;
    net += t.side === "sell" ? t.tradeUsd : -t.tradeUsd;
  }
  return round(net, 2);
}

function round(n: number, digits = 2): number {
  const m = Math.pow(10, digits);
  return Math.round(n * m) / m;
}

function computeLongestStreak(days: Array<{ count: number }>): number {
  let max = 0;
  let cur = 0;
  for (const d of days) {
    if (d.count > 0) {
      cur++;
      max = Math.max(max, cur);
    } else cur = 0;
  }
  return max;
}

function computeCurrentStreak(days: Array<{ count: number }>): number {
  let cur = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) cur++;
    else break;
  }
  return cur;
}
