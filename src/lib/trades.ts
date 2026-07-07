// Trade query layer + FIFO cost-basis math.
//
// Storage lives under the internal-store namespace `_internal/trades/<txHash>`.
// This is infrastructure data the app uses for PnL tracking — NOT part of the
// user-facing arkive substrate (which follows the v2 blueprint at `arkive/*`).
// The arkives UI filters out _internal/* paths so this data stays invisible
// to the user even as it powers the dashboard.

import crypto from "node:crypto";
import type { Address, Hex } from "viem";
import { getChain, type ChainId, ALL_CHAINS } from "@/lib/chains";
import * as uniswap from "@/lib/uniswap";
import { publicClient } from "@/lib/eth";
import { writeInternal, listInternal, type InternalEntry } from "@/lib/internal-store";

// ---------- types ----------

/**
 * One executed swap, normalized into "buy or sell of TOKEN against BASE".
 * - BASE = the side we can USD-price reliably (USDC/USDbC = $1, ETH/WETH/WBTC via Uniswap).
 * - TOKEN = the other side, the asset we're tracking PnL on.
 * - For trades where both sides are bases (e.g. ETH→USDC) we pick stable as base, ETH as token.
 */
export type Trade = {
  id: string;
  walletId: string;
  walletAddress: Address;
  chain: ChainId;
  venue: "uniswap" | "1inch" | "manual" | "chain-sync";
  txHash: Hex;
  executedAt: number;
  side: "buy" | "sell";
  token: { address: Address; symbol: string; decimals: number };
  base: { address: Address; symbol: string; decimals: number };
  /** Human-readable amount of `token` exchanged. */
  tokenAmount: string;
  /** Human-readable amount of `base` exchanged. */
  baseAmount: string;
  /** USD per 1 base at the time of the trade. */
  baseUsdPrice: number;
  /** USD per 1 token at the time of the trade — derived from the trade itself for accuracy. */
  tokenUsdPrice: number;
  /** Notional USD value of the trade (= baseAmount * baseUsdPrice). */
  tradeUsd: number;
};

// ---------- storage (evidence-backed) ----------

// Trades live at evidence/trades/<txHash> (flat). Future multi-venue separation will
// happen via the frontmatter `venue` field, not the path.

function entryToTrade(e: InternalEntry): Trade | null {
  const m = e.meta as Record<string, unknown>;
  try {
    return {
      id: (m.trade_id as string) ?? (m.tx_hash as string) ?? e.path.split("/").pop()!,
      walletId: (m.wallet_id as string) ?? "",
      walletAddress: (m.wallet_address as Address) ?? ("0x" as Address),
      chain: ((m.chain as string) ?? "ethereum") as ChainId,
      venue: (m.origin_venue as Trade["venue"]) ?? "uniswap",
      txHash: (m.tx_hash as Hex) ?? ("0x" as Hex),
      executedAt: m.executed_at ? new Date(m.executed_at as string).getTime() : 0,
      side: (m.side as "buy" | "sell") ?? "buy",
      token: {
        address: m.token_address as Address,
        symbol: (m.token_symbol as string) ?? "",
        decimals: Number(m.token_decimals ?? 18),
      },
      base: {
        address: m.base_address as Address,
        symbol: (m.base_symbol as string) ?? "",
        decimals: Number(m.base_decimals ?? 18),
      },
      tokenAmount: (m.token_amount as string) ?? "0",
      baseAmount: (m.base_amount as string) ?? "0",
      baseUsdPrice: Number(m.base_usd_price ?? 0),
      tokenUsdPrice: Number(m.token_usd_price ?? 0),
      tradeUsd: Number(m.trade_usd ?? 0),
    };
  } catch {
    return null;
  }
}

async function readAll(): Promise<Trade[]> {
  const entries = await listInternal("trades").catch(() => []);
  return entries
    .map(entryToTrade)
    .filter((t): t is Trade => t !== null)
    .sort((a, b) => a.executedAt - b.executedAt);
}

// ---------- side classification ----------

type SidedSide = {
  token: { address: Address; symbol: string; decimals: number };
  base: { address: Address; symbol: string; decimals: number };
  side: "buy" | "sell";
  tokenAmount: string;
  baseAmount: string;
};

/**
 * Decide which side of the swap is "base" (USD-anchored) vs "token" (PnL-tracked).
 * Returns null if neither side is in the chain's base set — we skip recording such trades.
 */
function classify(
  chain: ChainId,
  input: { address: Address; symbol: string; decimals: number; amount: string },
  output: { address: Address; symbol: string; decimals: number; amount: string }
): SidedSide | null {
  const cfg = getChain(chain);
  // Treat ETH symbol as WETH for matching against the base set
  const inAddr = (input.symbol === "ETH" ? cfg.v2.weth : input.address).toLowerCase();
  const outAddr = (output.symbol === "ETH" ? cfg.v2.weth : output.address).toLowerCase();
  const baseAddrs = new Set(cfg.baseAssets.map((b) => b.address.toLowerCase()));

  const inputIsBase = baseAddrs.has(inAddr);
  const outputIsBase = baseAddrs.has(outAddr);

  // Both are bases → pick stable as base, the other becomes "token"
  if (inputIsBase && outputIsBase) {
    const stables = new Set(cfg.baseAssets.filter((b) => b.symbol.includes("USD")).map((b) => b.address.toLowerCase()));
    if (stables.has(inAddr) && !stables.has(outAddr)) {
      // input is stable, output is ETH-ish → "buying" the ETH-ish with stable
      return { token: output, base: input, side: "buy", tokenAmount: output.amount, baseAmount: input.amount };
    }
    if (!stables.has(inAddr) && stables.has(outAddr)) {
      return { token: input, base: output, side: "sell", tokenAmount: input.amount, baseAmount: output.amount };
    }
    // both stables or both non-stables (rare) — arbitrary: input = base
    return { token: output, base: input, side: "buy", tokenAmount: output.amount, baseAmount: input.amount };
  }

  if (inputIsBase) {
    // base → token = BUY
    return { token: output, base: input, side: "buy", tokenAmount: output.amount, baseAmount: input.amount };
  }
  if (outputIsBase) {
    // token → base = SELL
    return { token: input, base: output, side: "sell", tokenAmount: input.amount, baseAmount: output.amount };
  }
  return null;
}

// ---------- public API ----------

export async function recordTrade(input: {
  walletId: string;
  walletAddress: Address;
  chain: ChainId;
  venue: "uniswap" | "1inch" | "manual" | "chain-sync";
  txHash: Hex;
  inputToken: { address: Address; symbol: string; decimals: number };
  outputToken: { address: Address; symbol: string; decimals: number };
  inputAmount: string;
  outputAmount: string;
  /** UNIX ms. Defaults to Date.now() — pass historical timestamps for backfill. */
  executedAt?: number;
  /** Override for the base-side USD price (used when historical pricing is supplied by the caller). */
  baseUsdPriceOverride?: number;
  /** If true, skip insert when a trade with the same txHash already exists. Default true. */
  dedupeByTxHash?: boolean;
}): Promise<Trade | null> {
  const sided = classify(
    input.chain,
    { ...input.inputToken, amount: input.inputAmount },
    { ...input.outputToken, amount: input.outputAmount }
  );
  if (!sided) return null; // exotic-to-exotic swap, skip

  const baseUsdPrice =
    input.baseUsdPriceOverride !== undefined
      ? input.baseUsdPriceOverride
      : await priceBaseUsd(input.chain, sided.base.address);
  if (baseUsdPrice === null) return null;

  const baseAmtNum = Number(sided.baseAmount);
  const tokenAmtNum = Number(sided.tokenAmount);
  const tradeUsd = baseAmtNum * baseUsdPrice;
  const tokenUsdPrice = tokenAmtNum > 0 ? tradeUsd / tokenAmtNum : 0;

  // Dedup: same txHash + same wallet + same chain → skip
  const dedupe = input.dedupeByTxHash !== false;
  if (dedupe && input.txHash !== "0x" && input.txHash !== "0x0") {
    const all = await readAll();
    const dup = all.find(
      (t) =>
        t.txHash === input.txHash &&
        t.walletAddress.toLowerCase() === input.walletAddress.toLowerCase() &&
        t.chain === input.chain
    );
    if (dup) return null;
  }

  const trade: Trade = {
    id: crypto.randomUUID(),
    walletId: input.walletId,
    walletAddress: input.walletAddress,
    chain: input.chain,
    venue: input.venue,
    txHash: input.txHash,
    executedAt: input.executedAt ?? Date.now(),
    side: sided.side,
    token: sided.token,
    base: sided.base,
    tokenAmount: sided.tokenAmount,
    baseAmount: sided.baseAmount,
    baseUsdPrice,
    tokenUsdPrice,
    tradeUsd,
  };

  // Persist as an internal-store entry. Single source of truth; the arkives UI
  // hides _internal/* paths so this stays out of the user's view.
  await writeInternal({
    namespace: "trades",
    id: trade.txHash,
    meta: {
      trade_id: trade.id,
      chain: trade.chain,
      tx_hash: trade.txHash,
      side: trade.side,
      token_address: trade.token.address,
      token_symbol: trade.token.symbol,
      token_decimals: trade.token.decimals,
      token_amount: trade.tokenAmount,
      base_address: trade.base.address,
      base_symbol: trade.base.symbol,
      base_decimals: trade.base.decimals,
      base_amount: trade.baseAmount,
      base_usd_price: trade.baseUsdPrice,
      token_usd_price: trade.tokenUsdPrice,
      trade_usd: trade.tradeUsd,
      executed_at: new Date(trade.executedAt).toISOString(),
      wallet_address: trade.walletAddress,
      wallet_id: trade.walletId,
      origin_venue: trade.venue,
    },
    body:
      `${trade.side === "buy" ? "Buy" : "Sell"} ${trade.tokenAmount} ${trade.token.symbol} for ` +
      `${trade.baseAmount} ${trade.base.symbol} (~$${trade.tradeUsd.toFixed(2)}). ` +
      `Tx: ${trade.txHash}. Wallet: ${trade.walletAddress}. Chain: ${trade.chain}. Venue: ${trade.venue}.`,
  });
  return trade;
}

async function priceBaseUsd(chain: ChainId, baseAddr: Address): Promise<number | null> {
  const cfg = getChain(chain);
  const lower = baseAddr.toLowerCase();
  // Stables → $1
  if (lower === cfg.v2.usdc.address.toLowerCase()) return 1;
  if (cfg.baseAssets.some((b) => b.address.toLowerCase() === lower && b.symbol.includes("USD"))) return 1;
  // Else: use uniswap.priceUsd
  const meta = cfg.baseAssets.find((b) => b.address.toLowerCase() === lower);
  const t = meta
    ? {
        chainId: cfg.numericId,
        chain,
        address: meta.address,
        symbol: meta.symbol,
        name: meta.symbol,
        decimals: meta.decimals,
      }
    : await uniswap.findToken(baseAddr, chain);
  if (!t) return null;
  return uniswap.priceUsd(t);
}

// ---------- query / compute ----------

export async function listTrades(filter?: {
  walletAddress?: Address;
  chain?: ChainId;
  tokenAddress?: Address;
}): Promise<Trade[]> {
  const all = await readAll();
  return all
    .filter((t) => !filter?.walletAddress || t.walletAddress.toLowerCase() === filter.walletAddress!.toLowerCase())
    .filter((t) => !filter?.chain || t.chain === filter.chain)
    .filter((t) => !filter?.tokenAddress || t.token.address.toLowerCase() === filter.tokenAddress!.toLowerCase())
    .sort((a, b) => a.executedAt - b.executedAt);
}

export type Position = {
  chain: ChainId;
  walletAddress: Address;
  token: { address: Address; symbol: string; decimals: number };
  buyTrades: number;
  sellTrades: number;
  totalBoughtTokens: number;
  totalSoldTokens: number;
  /** Tokens still held from these trades (lots not yet closed). */
  remainingTokens: number;
  /** Weighted-average entry price (USD per token) of the remaining lots. */
  avgEntryUsd: number;
  /** Realized PnL (USD) on portions already sold, FIFO cost basis. */
  realizedPnlUsd: number;
  /** Live USD price right now, fetched from Uniswap V2 (null if no route). */
  currentPriceUsd: number | null;
  /** Unrealized PnL on remaining lots = (current - avgEntry) * remaining. Null if no current price. */
  unrealizedPnlUsd: number | null;
  /** Current USD value of remaining holdings. */
  currentValueUsd: number | null;
  /** USD that's still 'at risk' on the remaining lots (= remaining * avgEntry). */
  costBasisUsd: number;
  firstTradeAt: number;
  lastTradeAt: number;
  /**
   * GoPlus token-safety verdict. `danger`-level tokens are typically airdropped
   * scams with manufactured liquidity pools — the position is kept visible so
   * users can see what was sent to them, but its value is nulled so it can't
   * inflate portfolio totals.
   */
  safety?: {
    level: "safe" | "caution" | "danger" | "unknown";
    reasons: string[];
  };
};

/**
 * FIFO walk over trades for a single (wallet, chain, token) tuple.
 * Each BUY appends a lot {qty, costPerToken}. Each SELL closes lots oldest-first
 * accumulating realized PnL = closeQty * (sellPrice - lotCostPerToken).
 * Mirrors ashpool/positionService FIFO algorithm.
 */
function walkFifo(trades: Trade[]): {
  remaining: number;
  avgEntry: number;
  realized: number;
  costBasis: number;
} {
  const lots: Array<{ qty: number; cost: number }> = [];
  let realized = 0;
  for (const t of trades) {
    const qty = Number(t.tokenAmount);
    if (t.side === "buy") {
      lots.push({ qty, cost: t.tokenUsdPrice });
    } else {
      let toSell = qty;
      while (toSell > 0 && lots.length > 0) {
        const lot = lots[0];
        const take = Math.min(lot.qty, toSell);
        realized += take * (t.tokenUsdPrice - lot.cost);
        lot.qty -= take;
        toSell -= take;
        if (lot.qty <= 0) lots.shift();
      }
      // Overflow (sold > bought via airdrop, etc.) → ignore for cost-basis purposes
    }
  }
  const remaining = lots.reduce((s, l) => s + l.qty, 0);
  const costBasis = lots.reduce((s, l) => s + l.qty * l.cost, 0);
  const avgEntry = remaining > 0 ? costBasis / remaining : 0;
  return { remaining, avgEntry, realized, costBasis };
}

export async function computePositions(filter?: {
  walletAddress?: Address;
  chain?: ChainId;
}): Promise<Position[]> {
  const trades = await listTrades(filter);

  // Skip hidden tokens entirely (scam blocklist). The price + value cascade
  // would already null them out if the pool is dust, but explicit suppression
  // is the more honest behavior — and saves the priceUsd call.
  const { getHiddenTokens, getMinLiquidityUsd } = await import("@/lib/user-profile");
  const [hiddenTokens, minLiquidityUsd] = await Promise.all([getHiddenTokens(), getMinLiquidityUsd()]);
  const isHidden = (chain: string, address: string) =>
    hiddenTokens.some((h) => h.chain === chain && h.address === address.toLowerCase());

  // Group by (wallet, chain, token)
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    if (isHidden(t.chain, t.token.address)) continue;
    const key = `${t.walletAddress.toLowerCase()}|${t.chain}|${t.token.address.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const positions: Position[] = [];
  for (const [, group] of groups) {
    const first = group[0];
    const fifo = walkFifo(group);
    const buyTrades = group.filter((t) => t.side === "buy").length;
    const sellTrades = group.filter((t) => t.side === "sell").length;
    const totalBought = group
      .filter((t) => t.side === "buy")
      .reduce((s, t) => s + Number(t.tokenAmount), 0);
    const totalSold = group
      .filter((t) => t.side === "sell")
      .reduce((s, t) => s + Number(t.tokenAmount), 0);

    // Live price for unrealized math, gated by the user's min-liquidity floor.
    // Any token whose pool is below the floor returns null and cascades into
    // currentValueUsd = null → rendered as "—" by the dashboard, excluded from
    // portfolio totals.
    let currentPriceUsd: number | null = null;
    try {
      const tokenInfo = {
        chainId: getChain(first.chain).numericId,
        chain: first.chain,
        address: first.token.address,
        symbol: first.token.symbol,
        name: first.token.symbol,
        decimals: first.token.decimals,
      };
      currentPriceUsd = await uniswap.priceUsd(tokenInfo, minLiquidityUsd);
    } catch {
      currentPriceUsd = null;
    }

    const unrealizedPnlUsd =
      currentPriceUsd !== null && fifo.remaining > 0
        ? (currentPriceUsd - fifo.avgEntry) * fifo.remaining
        : null;
    const currentValueUsd = currentPriceUsd !== null ? currentPriceUsd * fifo.remaining : null;

    positions.push({
      chain: first.chain,
      walletAddress: first.walletAddress,
      token: first.token,
      buyTrades,
      sellTrades,
      totalBoughtTokens: totalBought,
      totalSoldTokens: totalSold,
      remainingTokens: fifo.remaining,
      avgEntryUsd: fifo.avgEntry,
      realizedPnlUsd: fifo.realized,
      currentPriceUsd,
      unrealizedPnlUsd,
      currentValueUsd,
      costBasisUsd: fifo.costBasis,
      firstTradeAt: group[0].executedAt,
      lastTradeAt: group[group.length - 1].executedAt,
    });
  }

  // ---- Safety augmentation ----------------------------------------------------
  // For every position, look up GoPlus token safety (cached aggressively in
  // src/lib/safety-cache.ts). danger-level tokens have their currentValueUsd /
  // unrealizedPnlUsd nulled so they can't inflate portfolio totals — the row
  // itself remains visible so the user still sees that airdropped tokens exist.
  // This is the permanent fix for scam tokens with manufactured liquid pools
  // (e.g. ETHG, AICC): the liquidity floor alone can't catch them because the
  // scammers bootstrap real-looking pools; only a reputational source like
  // GoPlus reliably flags them.
  const { batchSafety } = await import("@/lib/safety-cache");
  const verdicts = await batchSafety(
    positions.map((p) => ({ chain: p.chain, address: p.token.address }))
  );
  for (let i = 0; i < positions.length; i++) {
    const v = verdicts[i];
    positions[i].safety = { level: v.level, reasons: v.reasons };
    if (v.level === "danger") {
      positions[i].currentValueUsd = null;
      positions[i].unrealizedPnlUsd = null;
      positions[i].currentPriceUsd = null;
    }
  }

  return positions.sort((a, b) => (b.currentValueUsd ?? 0) - (a.currentValueUsd ?? 0));
}

export type PnlSummary = {
  walletFilter: Address | null;
  chainFilter: ChainId | null;
  totalTrades: number;
  buyTrades: number;
  sellTrades: number;
  totalInvestedUsd: number; // sum of buy notionals
  totalProceedsUsd: number; // sum of sell notionals
  totalRealizedUsd: number; // FIFO realized across all positions
  totalUnrealizedUsd: number; // sum of open-position unrealized
  totalPnlUsd: number; // realized + unrealized
  openPositions: number;
  closedPositions: number;
  winners: number;
  losers: number;
  biggestWinner: { token: string; pnlUsd: number } | null;
  biggestLoser: { token: string; pnlUsd: number } | null;
};

export async function computePnlSummary(filter?: {
  walletAddress?: Address;
  chain?: ChainId;
}): Promise<PnlSummary> {
  const trades = await listTrades(filter);
  const positions = await computePositions(filter);

  const buyTrades = trades.filter((t) => t.side === "buy");
  const sellTrades = trades.filter((t) => t.side === "sell");
  const totalInvested = buyTrades.reduce((s, t) => s + t.tradeUsd, 0);
  const totalProceeds = sellTrades.reduce((s, t) => s + t.tradeUsd, 0);

  const totalRealized = positions.reduce((s, p) => s + p.realizedPnlUsd, 0);
  const totalUnrealized = positions.reduce((s, p) => s + (p.unrealizedPnlUsd ?? 0), 0);

  const open = positions.filter((p) => p.remainingTokens > 0);
  const closed = positions.filter((p) => p.remainingTokens === 0);

  // Per-position total PnL (realized + unrealized) for winner/loser
  const positionPnls = positions.map((p) => ({
    symbol: p.token.symbol,
    pnl: p.realizedPnlUsd + (p.unrealizedPnlUsd ?? 0),
  }));
  const sortedByPnl = [...positionPnls].sort((a, b) => b.pnl - a.pnl);

  const winners = positionPnls.filter((p) => p.pnl > 0).length;
  const losers = positionPnls.filter((p) => p.pnl < 0).length;
  const biggestWinner = sortedByPnl[0] && sortedByPnl[0].pnl > 0
    ? { token: sortedByPnl[0].symbol, pnlUsd: sortedByPnl[0].pnl }
    : null;
  const biggestLoser =
    sortedByPnl[sortedByPnl.length - 1] && sortedByPnl[sortedByPnl.length - 1].pnl < 0
      ? { token: sortedByPnl[sortedByPnl.length - 1].symbol, pnlUsd: sortedByPnl[sortedByPnl.length - 1].pnl }
      : null;

  return {
    walletFilter: filter?.walletAddress ?? null,
    chainFilter: filter?.chain ?? null,
    totalTrades: trades.length,
    buyTrades: buyTrades.length,
    sellTrades: sellTrades.length,
    totalInvestedUsd: round2(totalInvested),
    totalProceedsUsd: round2(totalProceeds),
    totalRealizedUsd: round2(totalRealized),
    totalUnrealizedUsd: round2(totalUnrealized),
    totalPnlUsd: round2(totalRealized + totalUnrealized),
    openPositions: open.length,
    closedPositions: closed.length,
    winners,
    losers,
    biggestWinner: biggestWinner
      ? { token: biggestWinner.token, pnlUsd: round2(biggestWinner.pnlUsd) }
      : null,
    biggestLoser: biggestLoser
      ? { token: biggestLoser.token, pnlUsd: round2(biggestLoser.pnlUsd) }
      : null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Re-export for convenience in MCP handlers
export { ALL_CHAINS };
