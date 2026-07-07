// Hyperliquid integration — perpetuals + spot via the official-style
// community SDK (@nktkas/hyperliquid). All EIP-712 signing of orders /
// cancels / leverage updates happens inside the SDK, using the same
// PrivateKeyAccount that already lives in our keystore + unlock flow.
//
// The Hyperliquid account IS an Ethereum address — deposits land via an
// Arbitrum USDC bridge that maps your EVM address to a Hyperliquid sub-
// ledger. So no new wallet type is needed: any "owned" wallet in the
// keystore can trade on Hyperliquid as long as it has deposited funds.
//
// API base: https://api.hyperliquid.xyz  (mainnet — testnet would be a
// separate transport instance pointed at api.hyperliquid-testnet.xyz).
//
// Auth model:
//   info endpoints  — public reads, no signing
//   exchange ops    — signed via EIP-712 (Agent / connectionId envelope)
//
// We deliberately don't expose all 30+ exchange actions the SDK supports.
// First pass: read-everything, place/cancel/close, update leverage. Future
// rounds can add: deposit, withdraw, vault transfers, native Hyperliquid
// TWAP order type, scale orders, sub-account management.

import type { Address } from "viem";
import type { PrivateKeyAccount } from "viem";
import {
  HttpTransport,
  InfoClient,
  ExchangeClient,
} from "@nktkas/hyperliquid";

// ---------------------------------------------------------------------------
// Shared transport — single HttpTransport instance is fine across calls.
// ---------------------------------------------------------------------------

let _transport: HttpTransport | null = null;
function transport(): HttpTransport {
  if (!_transport) _transport = new HttpTransport();
  return _transport;
}

let _info: InfoClient | null = null;
function info(): InfoClient {
  if (!_info) _info = new InfoClient({ transport: transport() });
  return _info;
}

function exchangeFor(account: PrivateKeyAccount): ExchangeClient {
  // ExchangeClient is per-wallet because it signs with the provided
  // wallet's key. Cheap to construct; we don't cache to avoid leaking
  // unlocked accounts between users in the global module state.
  return new ExchangeClient({ transport: transport(), wallet: account });
}

// ---------------------------------------------------------------------------
// Types — surfaced from SDK responses so callers don't need to import the
// SDK directly. Marked `unknown`/loose where the API shape is rich and we
// just pass through to MCP responses.
// ---------------------------------------------------------------------------

export type PerpPosition = {
  /** Coin symbol — BTC, ETH, SOL, etc. */
  coin: string;
  /** Signed position size — negative = short. */
  szi: string;
  /** Average entry price. */
  entryPx?: string;
  /** Current mark price (from accompanying metadata). */
  markPx?: string;
  /** Unrealized PnL in USDC. */
  unrealizedPnl: string;
  /** Liquidation price, if any. */
  liquidationPx?: string;
  /** Leverage info. */
  leverage: { type: "cross" | "isolated"; value: number };
  /** Margin allocated to this position. */
  marginUsed: string;
};

export type PerpAccountState = {
  /** Total account value in USDC. */
  accountValue: string;
  /** Free margin (withdrawable). */
  withdrawable: string;
  /** Total notional of all positions. */
  totalNotional: string;
  /** Total margin currently in use. */
  totalMarginUsed: string;
  /** Open positions. */
  positions: PerpPosition[];
};

export type SpotBalance = {
  coin: string;
  /** Total balance. */
  total: string;
  /** Available (not locked in orders). */
  hold: string;
};

export type OpenOrder = {
  coin: string;
  side: "B" | "A"; // buy / ask (sell)
  px: string;
  sz: string;
  oid: number;
  timestamp: number;
  /** Original size before any fills. */
  origSz?: string;
  /** Reduce-only flag. */
  reduceOnly?: boolean;
};

export type HyperliquidState = {
  user: Address;
  perp: PerpAccountState;
  spot_balances: SpotBalance[];
  open_orders: OpenOrder[];
};

// ---------------------------------------------------------------------------
// Asset index resolution
// ---------------------------------------------------------------------------
//
// Hyperliquid identifies tradeable perps by INDEX into the universe array,
// not by symbol. We resolve coin → index via the `meta` info call. Result
// is cached for the lifetime of the process (universe changes are rare —
// new listings ~weekly, not per-request).

type AssetIndex = {
  /** Map from upper-case coin symbol (BTC, ETH, ...) to asset index. */
  byCoin: Record<string, number>;
  /** Reverse map. */
  byIndex: Record<number, string>;
  /** Decimal precision per coin — needed when formatting sz / px strings. */
  szDecimals: Record<string, number>;
  loadedAt: number;
};

let _assetIndex: AssetIndex | null = null;

async function loadAssetIndex(force = false): Promise<AssetIndex> {
  if (_assetIndex && !force) return _assetIndex;
  const meta = await info().meta();
  const byCoin: Record<string, number> = {};
  const byIndex: Record<number, string> = {};
  const szDecimals: Record<string, number> = {};
  // meta.universe is an array of {name, szDecimals, ...}; the array INDEX is
  // the asset identifier used in order actions.
  const universe = (meta as { universe: Array<{ name: string; szDecimals: number }> }).universe;
  universe.forEach((asset, idx) => {
    const sym = asset.name.toUpperCase();
    byCoin[sym] = idx;
    byIndex[idx] = sym;
    szDecimals[sym] = asset.szDecimals;
  });
  _assetIndex = { byCoin, byIndex, szDecimals, loadedAt: Date.now() };
  return _assetIndex;
}

/** Coin symbol → Hyperliquid asset index. Throws if unknown (with the
 *  full coin list in the error so the AI can suggest alternatives). */
export async function assetIndexFor(coin: string): Promise<number> {
  const idx = await loadAssetIndex();
  const sym = coin.trim().toUpperCase();
  const i = idx.byCoin[sym];
  if (i === undefined) {
    throw new Error(
      `Unknown Hyperliquid coin '${coin}'. Try one of: ${Object.keys(idx.byCoin).slice(0, 20).join(", ")}…`
    );
  }
  return i;
}

// ---------------------------------------------------------------------------
// READS — info endpoint (no signing)
// ---------------------------------------------------------------------------

/**
 * Full account snapshot — perp state + spot balances + open orders in
 * one call. The canonical "where do I stand on Hyperliquid?" answer.
 */
export async function getState(user: Address): Promise<HyperliquidState> {
  const [perpRaw, spotRaw, openRaw] = await Promise.all([
    info().clearinghouseState({ user }),
    info().spotClearinghouseState({ user }),
    info().openOrders({ user }),
  ]);

  // ---- perp ----
  const p = perpRaw as {
    marginSummary: {
      accountValue: string;
      totalNtlPos: string;
      totalRawUsd: string;
      totalMarginUsed: string;
    };
    withdrawable: string;
    assetPositions: Array<{
      position: {
        coin: string;
        szi: string;
        entryPx?: string;
        unrealizedPnl: string;
        liquidationPx?: string | null;
        marginUsed: string;
        leverage: { type: "cross" | "isolated"; value: number };
      };
    }>;
  };
  const perp: PerpAccountState = {
    accountValue: p.marginSummary.accountValue,
    withdrawable: p.withdrawable,
    totalNotional: p.marginSummary.totalNtlPos,
    totalMarginUsed: p.marginSummary.totalMarginUsed,
    positions: p.assetPositions.map((ap) => ({
      coin: ap.position.coin,
      szi: ap.position.szi,
      entryPx: ap.position.entryPx,
      unrealizedPnl: ap.position.unrealizedPnl,
      liquidationPx: ap.position.liquidationPx ?? undefined,
      leverage: ap.position.leverage,
      marginUsed: ap.position.marginUsed,
    })),
  };

  // ---- spot ----
  const s = spotRaw as { balances: Array<{ coin: string; total: string; hold: string }> };
  const spot_balances: SpotBalance[] = (s.balances ?? []).map((b) => ({
    coin: b.coin,
    total: b.total,
    hold: b.hold,
  }));

  // ---- orders ----
  const o = openRaw as Array<{
    coin: string;
    side: "B" | "A";
    limitPx: string;
    sz: string;
    oid: number;
    timestamp: number;
    origSz?: string;
    reduceOnly?: boolean;
  }>;
  const open_orders: OpenOrder[] = o.map((x) => ({
    coin: x.coin,
    side: x.side,
    px: x.limitPx,
    sz: x.sz,
    oid: x.oid,
    timestamp: x.timestamp,
    origSz: x.origSz,
    reduceOnly: x.reduceOnly,
  }));

  return { user, perp, spot_balances, open_orders };
}

/** Current orderbook + mark price for a single coin. Use for quoting
 *  before placing orders. */
export async function getMarket(coin: string): Promise<{
  coin: string;
  asset_index: number;
  mark_px: string;
  best_bid?: { px: string; sz: string };
  best_ask?: { px: string; sz: string };
  bids: Array<{ px: string; sz: string }>;
  asks: Array<{ px: string; sz: string }>;
}> {
  const sym = coin.trim().toUpperCase();
  const [bookRaw, mids, idx] = await Promise.all([
    info().l2Book({ coin: sym }),
    info().allMids(),
    assetIndexFor(sym),
  ]);

  // l2Book returns { coin, time, levels: [bids[], asks[]] } with each level
  // shaped { px, sz, n }.
  const b = bookRaw as {
    coin: string;
    levels: [
      Array<{ px: string; sz: string }>,
      Array<{ px: string; sz: string }>
    ];
  };
  const bids = b.levels[0] ?? [];
  const asks = b.levels[1] ?? [];
  const markPx = (mids as Record<string, string>)[sym] ?? "0";

  return {
    coin: sym,
    asset_index: idx,
    mark_px: markPx,
    best_bid: bids[0],
    best_ask: asks[0],
    bids: bids.slice(0, 10),
    asks: asks.slice(0, 10),
  };
}

/** List all tradeable perps with metadata. Lets the AI surface "what's
 *  available" without hardcoding the universe. */
export async function listMarkets(): Promise<
  Array<{ coin: string; asset_index: number; sz_decimals: number; max_leverage?: number }>
> {
  const meta = (await info().meta()) as {
    universe: Array<{ name: string; szDecimals: number; maxLeverage?: number }>;
  };
  return meta.universe.map((u, i) => ({
    coin: u.name.toUpperCase(),
    asset_index: i,
    sz_decimals: u.szDecimals,
    max_leverage: u.maxLeverage,
  }));
}

// ---------------------------------------------------------------------------
// HISTORY READS — fills, funding, deposits/withdrawals
// ---------------------------------------------------------------------------

export type Fill = {
  coin: string;
  /** Price the fill executed at. */
  px: string;
  /** Size filled. */
  sz: string;
  /** "B" = buy, "A" = sell. */
  side: "B" | "A";
  /** Unix milliseconds. */
  time: number;
  /** Signed size position was at BEFORE this fill. */
  start_position: string;
  /** Human-readable direction: "Open Long", "Close Short", "Buy", etc. */
  dir: string;
  /** Realized PnL ON THIS FILL (string, can be negative). Useful for
   *  reconstructing P&L over a date range. */
  closed_pnl: string;
  /** L1 transaction hash. */
  hash: string;
  /** Order id this fill belongs to. */
  oid: number;
  /** True if this side crossed the book (vs maker). */
  crossed: boolean;
  /** Fee paid (negative = rebate). */
  fee: string;
  /** Trade id. */
  tid: number;
  /** Set if this fill was a liquidation. */
  liquidation?: {
    liquidated_user: string;
    mark_px: string;
    method: "market" | "backstop";
  };
};

/**
 * Recent fills for a user. Returns up to ~2000 fills, newest first.
 * Optionally filter to a single coin or to fills after a timestamp.
 *
 * Use `since` (ms epoch) when answering "what did I trade today / this
 * week" — without it you get the whole tail back to the start of the
 * account.
 */
export async function getFills(args: {
  user: Address;
  /** Filter to one coin (case-insensitive). Drop other fills. */
  coin?: string;
  /** Unix ms — only return fills at or after this time. */
  since?: number;
  /** Cap on number of fills to return (after filtering). Default 200. */
  limit?: number;
  /** When true, Hyperliquid aggregates partial fills of the same crossing
   *  order into one row — usually what you want for "list my trades." */
  aggregateByTime?: boolean;
}): Promise<{ fills: Fill[]; total_realized_pnl: string; total_fees: string }> {
  let raw: unknown;
  if (args.since !== undefined) {
    // userFillsByTime is the time-bounded variant; cap end at now if not given
    raw = await info().userFillsByTime({
      user: args.user,
      startTime: args.since,
      ...(args.aggregateByTime !== undefined ? { aggregateByTime: args.aggregateByTime } : {}),
    });
  } else {
    raw = await info().userFills({
      user: args.user,
      ...(args.aggregateByTime !== undefined ? { aggregateByTime: args.aggregateByTime } : {}),
    });
  }

  const arr = raw as Array<{
    coin: string;
    px: string;
    sz: string;
    side: "B" | "A";
    time: number;
    startPosition: string;
    dir: string;
    closedPnl: string;
    hash: string;
    oid: number;
    crossed: boolean;
    fee: string;
    tid: number;
    liquidation?: { liquidatedUser: string; markPx: string; method: "market" | "backstop" };
  }>;

  const wantCoin = args.coin?.toUpperCase();
  const filtered = arr.filter((f) => !wantCoin || f.coin.toUpperCase() === wantCoin);
  const limit = args.limit ?? 200;
  const sliced = filtered.slice(0, limit);

  // Roll up PnL + fees across the returned slice — saves the AI from doing
  // the sum itself when the user asks "how am I doing on HL this month."
  const total_realized_pnl = sliced
    .reduce((s, f) => s + parseFloat(f.closedPnl || "0"), 0)
    .toString();
  const total_fees = sliced
    .reduce((s, f) => s + parseFloat(f.fee || "0"), 0)
    .toString();

  return {
    fills: sliced.map((f) => ({
      coin: f.coin,
      px: f.px,
      sz: f.sz,
      side: f.side,
      time: f.time,
      start_position: f.startPosition,
      dir: f.dir,
      closed_pnl: f.closedPnl,
      hash: f.hash,
      oid: f.oid,
      crossed: f.crossed,
      fee: f.fee,
      tid: f.tid,
      ...(f.liquidation
        ? {
            liquidation: {
              liquidated_user: f.liquidation.liquidatedUser,
              mark_px: f.liquidation.markPx,
              method: f.liquidation.method,
            },
          }
        : {}),
    })),
    total_realized_pnl,
    total_fees,
  };
}

export type FundingPayment = {
  /** Coin the funding was paid/received on. */
  coin: string;
  /** Unix ms. */
  time: number;
  /** Funding rate at the payment time. */
  funding_rate: string;
  /** Size of position when funded. */
  szi: string;
  /** USDC paid (positive = user paid; negative = user received). */
  usdc: string;
};

/** Funding payment history. Perp-specific — every funding interval where
 *  the user had a position generates a row here. */
export async function getFundingHistory(args: {
  user: Address;
  /** Unix ms. Default = 7 days ago. */
  since?: number;
  /** Unix ms. Default = now. */
  until?: number;
}): Promise<{ payments: FundingPayment[]; total_usdc: string }> {
  const startTime = args.since ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
  const endTime = args.until ?? Date.now();
  const raw = await info().userFunding({
    user: args.user,
    startTime,
    endTime,
  });

  const arr = raw as Array<{
    time: number;
    hash: string;
    delta: {
      type: "funding";
      coin: string;
      usdc: string;
      szi: string;
      fundingRate: string;
    };
  }>;

  const payments: FundingPayment[] = arr
    .filter((r) => r.delta?.type === "funding")
    .map((r) => ({
      coin: r.delta.coin,
      time: r.time,
      funding_rate: r.delta.fundingRate,
      szi: r.delta.szi,
      usdc: r.delta.usdc,
    }));
  const total_usdc = payments
    .reduce((s, p) => s + parseFloat(p.usdc || "0"), 0)
    .toString();

  return { payments, total_usdc };
}

export type LedgerEvent = {
  /** Unix ms. */
  time: number;
  /** Plain-English event kind: "deposit", "withdraw", "internalTransfer", etc. */
  type: string;
  /** USDC amount (signed — positive = into account). */
  usdc?: string;
  /** L1 hash. */
  hash: string;
  /** Full raw delta — kind-specific extra fields the AI can introspect. */
  raw: unknown;
};

/** Non-funding ledger updates — deposits, withdrawals, internal transfers.
 *  Use this to answer "how much have I deposited" or "have I withdrawn." */
export async function getLedger(args: {
  user: Address;
  /** Default = 30 days ago. */
  since?: number;
  until?: number;
}): Promise<{ events: LedgerEvent[]; total_deposits: string; total_withdrawals: string }> {
  const startTime = args.since ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
  const endTime = args.until ?? Date.now();
  const raw = await info().userNonFundingLedgerUpdates({
    user: args.user,
    startTime,
    endTime,
  });

  const arr = raw as Array<{
    time: number;
    hash: string;
    delta: { type: string; usdc?: string; [k: string]: unknown };
  }>;

  const events: LedgerEvent[] = arr.map((r) => ({
    time: r.time,
    type: r.delta?.type ?? "unknown",
    usdc: r.delta?.usdc,
    hash: r.hash,
    raw: r.delta,
  }));

  let dep = 0;
  let wd = 0;
  for (const e of events) {
    if (!e.usdc) continue;
    const v = parseFloat(e.usdc);
    if (!Number.isFinite(v)) continue;
    if (v > 0) dep += v;
    else wd += Math.abs(v);
  }

  return {
    events,
    total_deposits: dep.toString(),
    total_withdrawals: wd.toString(),
  };
}

// ---------------------------------------------------------------------------
// ACTIONS — exchange endpoint (signed via EIP-712 inside the SDK)
// ---------------------------------------------------------------------------

export type OrderTif = "Gtc" | "Ioc" | "Alo";
//   Gtc = Good til cancelled (resting limit)
//   Ioc = Immediate or cancel (market-style)
//   Alo = Add liquidity only (post-only)

/**
 * Place a perpetual order. For a MARKET order, use type="ioc" + a price
 * with generous slippage (e.g. mark * 1.02 for a buy). For a LIMIT,
 * use type="gtc" + the exact price. For POST-ONLY, type="alo".
 */
export async function placeOrder(args: {
  account: PrivateKeyAccount;
  coin: string;
  /** true = buy (long), false = sell (short). */
  isBuy: boolean;
  /** Position size as a decimal string. e.g. "0.1" for 0.1 BTC. */
  size: string;
  /** Limit price as decimal string. For IOC market-style orders, pass a
   *  price with enough slippage room to fill (e.g. mark * 1.02). */
  price: string;
  /** Time-in-force semantics. */
  tif: OrderTif;
  /** Reduce-only — only closes existing position; can't open opposite. */
  reduceOnly?: boolean;
  /** Optional client-supplied order id for tracking. */
  cloid?: string;
}): Promise<{
  status: "ok" | "error";
  order_id?: number;
  raw: unknown;
}> {
  const a = await assetIndexFor(args.coin);
  const exchange = exchangeFor(args.account);

  const result = await exchange.order({
    orders: [
      {
        a,
        b: args.isBuy,
        p: args.price,
        s: args.size,
        r: args.reduceOnly ?? false,
        t: { limit: { tif: args.tif } },
        ...(args.cloid ? { c: args.cloid as `0x${string}` } : {}),
      },
    ],
    grouping: "na",
  });

  // Result shape: { status: 'ok', response: { type: 'order', data: { statuses: [ { resting: { oid }} | { filled: {...} } | { error: '...' } ] } } }
  const r = result as {
    status: "ok" | "err";
    response?: {
      data?: {
        statuses?: Array<
          | { resting: { oid: number } }
          | { filled: { oid: number; totalSz: string; avgPx: string } }
          | { error: string }
        >;
      };
    };
  };

  if (r.status !== "ok") {
    return { status: "error", raw: result };
  }
  const s = r.response?.data?.statuses?.[0];
  if (s && "resting" in s) return { status: "ok", order_id: s.resting.oid, raw: result };
  if (s && "filled" in s) return { status: "ok", order_id: s.filled.oid, raw: result };
  if (s && "error" in s) {
    return { status: "error", raw: result };
  }
  return { status: "ok", raw: result };
}

/** Cancel one open order by (coin, oid). */
export async function cancelOrder(args: {
  account: PrivateKeyAccount;
  coin: string;
  orderId: number;
}): Promise<{ status: "ok" | "error"; raw: unknown }> {
  const a = await assetIndexFor(args.coin);
  const exchange = exchangeFor(args.account);
  const result = await exchange.cancel({
    cancels: [{ a, o: args.orderId }],
  });
  const r = result as { status: "ok" | "err" };
  return { status: r.status === "ok" ? "ok" : "error", raw: result };
}

/** Close a position by market-selling (or buying) the inverse of its current size. */
export async function closePosition(args: {
  account: PrivateKeyAccount;
  coin: string;
  /** Optional slippage in bps for the synthetic IOC price (default 100 = 1%). */
  slippageBps?: number;
}): Promise<{ status: "ok" | "error"; order_id?: number; raw: unknown }> {
  const state = await getState(args.account.address);
  const pos = state.perp.positions.find((p) => p.coin.toUpperCase() === args.coin.toUpperCase());
  if (!pos) throw new Error(`No open position in ${args.coin}.`);
  const szi = parseFloat(pos.szi);
  if (szi === 0) throw new Error(`Position in ${args.coin} is already flat.`);

  // Opposite side: long position (szi > 0) → SELL; short (szi < 0) → BUY.
  const isBuy = szi < 0;
  const size = Math.abs(szi).toString();
  const market = await getMarket(args.coin);
  const mark = parseFloat(market.mark_px);
  const slippage = (args.slippageBps ?? 100) / 10_000;
  const price = isBuy ? (mark * (1 + slippage)).toString() : (mark * (1 - slippage)).toString();

  return placeOrder({
    account: args.account,
    coin: args.coin,
    isBuy,
    size,
    price,
    tif: "Ioc",
    reduceOnly: true,
  });
}

/** Set leverage for a coin. Per-asset on Hyperliquid (not per-position). */
export async function updateLeverage(args: {
  account: PrivateKeyAccount;
  coin: string;
  leverage: number;
  /** Cross margin (true) vs isolated (false). */
  isCross: boolean;
}): Promise<{ status: "ok" | "error"; raw: unknown }> {
  const asset = await assetIndexFor(args.coin);
  const exchange = exchangeFor(args.account);
  const result = await exchange.updateLeverage({
    asset,
    isCross: args.isCross,
    leverage: args.leverage,
  });
  const r = result as { status: "ok" | "err" };
  return { status: r.status === "ok" ? "ok" : "error", raw: result };
}
