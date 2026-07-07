import type { PrivateKeyAccount } from "viem";
import type { ChainId } from "@/lib/chains";

// Module-level singleton for unlocked wallets and the pending-tx queue.
// Survives across requests in the Next.js dev server (single Node process).
// In a multi-process deploy you'd swap this for Redis/DB — out of scope for the MVP.

declare global {
  // eslint-disable-next-line no-var
  var __arkive: ArkiveState | undefined;
}

// ============================================================================
// Pending op union — every queued action waiting for user approval at /pending.
//
// Each variant is a tagged record (`kind: "..."`). Shared lifecycle fields live in
// PendingBase. New op kinds (transfer, approve, wrap, LP add/remove, ...) all
// flow through enqueuePending / getPending / updatePending and dispatch by `kind`
// in src/app/api/pending/[id]/route.ts.
// ============================================================================

export type SwapVenue = "uniswap" | "1inch";

export type TokenRef = { address: `0x${string}`; symbol: string; decimals: number };

export type PendingStatus = "pending" | "approved" | "rejected" | "submitted" | "failed";

type PendingBase = {
  id: string;
  walletId: string;
  walletAddress: `0x${string}`;
  chain: ChainId;
  status: PendingStatus;
  txHash?: `0x${string}`;
  error?: string;
  requestedAt: number;
  resolvedAt?: number;
  /** Optional one-line summary the UI shows in lieu of constructing it from fields. */
  summary?: string;
  // ---- Grouping (multi-step approval flows) ----
  // When the AI is performing a sequence (e.g. "set leverage to 10x, then
  // open the long"), it stamps every member of the sequence with the same
  // groupId so the /pending UI can collapse them into a single titled
  // slideshow the user clicks through one at a time. The FIRST member of
  // the group carries groupTitle; subsequent members can omit it.
  /** Shared across every op in a logical sequence. AI-generated string. */
  groupId?: string;
  /** Human-readable summary of the WHOLE sequence (e.g. "Open 5 ETH long with 10x"). */
  groupTitle?: string;
  /** 0-indexed position of this op within the group (server fills in based on enqueue order). */
  groupIndex?: number;
  /** Total ops in the group (server fills in / updates as more arrive). */
  groupSize?: number;
};

// ---------- swaps (existing) ----------

export type PendingSwap = PendingBase & {
  kind: "swap";
  venue: SwapVenue;
  fromToken: TokenRef;
  toToken: TokenRef;
  fromAmount: string; // human-readable
  fromAmountWei: string; // base units
  estimatedToAmount: string; // human-readable
  slippageBps: number;
  /** For Uniswap: the routing path (addresses, with WETH substituted for ETH). */
  path?: `0x${string}`[];
};

// ---------- transfers ----------

export type PendingTransfer = PendingBase & {
  kind: "transfer";
  /** Resolved address (post-ENS). */
  to: `0x${string}`;
  /** If the user passed an ENS name, keep it for display. */
  toEns?: string;
  /** ETH transfer (native) or ERC-20. */
  asset: { kind: "eth" } | { kind: "erc20"; token: TokenRef };
  amount: string;
  amountWei: string;
};

// ---------- approvals ----------

export type PendingApprove = PendingBase & {
  kind: "approve";
  token: TokenRef;
  spender: `0x${string}`;
  /** "max" or specific human-readable amount. */
  amount: string;
  /** Either MAX_UINT256 or the human amount in base units. */
  amountWei: string;
  /** Optional context the UI surfaces — e.g. "approve USDC for Uniswap V2 router (add liquidity)". */
  purpose?: string;
};

// ---------- wrap / unwrap ----------

export type PendingWrap = PendingBase & {
  /** wrap_eth: ETH -> WETH (deposit). unwrap_weth: WETH -> ETH (withdraw). */
  kind: "wrap_eth" | "unwrap_weth";
  amount: string;
  amountWei: string;
  weth: `0x${string}`;
};

// ---------- Uniswap V2 LP ----------

export type PendingAddLiquidityV2 = PendingBase & {
  kind: "add_liquidity_v2";
  tokenA: TokenRef;
  tokenB: TokenRef;
  amountA: string;
  amountAWei: string;
  amountB: string;
  amountBWei: string;
  slippageBps: number;
  /** Unix seconds; the on-chain deadline param. */
  deadline: number;
};

export type PendingRemoveLiquidityV2 = PendingBase & {
  kind: "remove_liquidity_v2";
  tokenA: TokenRef;
  tokenB: TokenRef;
  pair: `0x${string}`;
  lpAmount: string;
  lpAmountWei: string;
  /** Computed from slippage at request time. */
  minAmountA: string;
  minAmountAWei: string;
  minAmountB: string;
  minAmountBWei: string;
  slippageBps: number;
  deadline: number;
};

// ---------- Uniswap V3 LP ----------

export type V3FeeTier = 100 | 500 | 3000 | 10000;

export type PendingAddLiquidityV3 = PendingBase & {
  kind: "add_liquidity_v3";
  /** Sorted lexicographically by address — token0 < token1. */
  token0: TokenRef;
  token1: TokenRef;
  fee: V3FeeTier;
  tickLower: number;
  tickUpper: number;
  amount0Desired: string;
  amount0DesiredWei: string;
  amount1Desired: string;
  amount1DesiredWei: string;
  amount0MinWei: string;
  amount1MinWei: string;
  slippageBps: number;
  deadline: number;
};

export type PendingExitLiquidityV3 = PendingBase & {
  kind: "exit_liquidity_v3";
  tokenId: string;
  token0: TokenRef;
  token1: TokenRef;
  /** Full liquidity of the position at request time. */
  liquidity: string;
  amount0MinWei: string;
  amount1MinWei: string;
  deadline: number;
  /** If true, also burn the NFT after decrease+collect. */
  burnAfter: boolean;
};

// ---------- UniswapX limit orders + TWAP ----------
//
// Both are off-chain orders signed via EIP-712 and submitted to the
// UniswapX Trade API. The "txHash" lifecycle field on PendingBase is
// repurposed for limit/twap orders to mean "we got an orderId back from
// the API" — we don't store the on-chain fill hash here (fillers settle
// independently when the order conditions hit).

export type PendingLimitOrder = PendingBase & {
  kind: "limit_order";
  fromToken: TokenRef;
  toToken: TokenRef;
  /** Human-readable input amount. */
  amountIn: string;
  /** Wei. */
  amountInWei: string;
  /** Human-readable minimum output (the "limit price floor"). */
  minAmountOut: string;
  /** Wei. */
  minAmountOutWei: string;
  /** Unix seconds. UniswapX caps limit-order deadlines at ~30 days. */
  deadline: number;
  /** Populated post-submission. */
  orderId?: string;
  /** What the API picked — DUTCH_V2 / LIMIT_ORDER / PRIORITY etc. */
  routing?: string;
  /** Latest order status from the API. */
  orderStatus?: string;
};

export type PendingTwapOrder = PendingBase & {
  kind: "twap_order";
  fromToken: TokenRef;
  toToken: TokenRef;
  /** Total human-readable input amount split across chunks. */
  totalAmountIn: string;
  /** Wei. */
  totalAmountInWei: string;
  /** Number of child limit orders to submit. */
  chunks: number;
  /** Seconds between each chunk's deadline. */
  intervalSeconds: number;
  /** Deadline of the FIRST chunk; subsequent chunks add intervalSeconds. */
  baseDeadline: number;
  /** Per-chunk minimum output (wei) — sets the floor each chunk auctions against. */
  minAmountOutPerChunkWei: string;
  /** Human-readable per-chunk min for the UI. */
  minAmountOutPerChunk: string;
  /** Populated post-submission — the N child UniswapX orderIds. */
  childOrderIds?: string[];
  /** Per-child statuses (parallel array to childOrderIds). */
  childOrderStatuses?: string[];
};

// ---------- Hyperliquid (perps) ----------
//
// Off-EVM venue: the "chain" field is reused as a venue tag ("hyperliquid"
// isn't actually a ChainId though — we store the user's connected EVM
// chain so the keystore lookup works, since Hyperliquid uses the same
// EVM private key for signing). The txHash slot gets the numeric oid
// hex-encoded so the UI still has a unique identifier.

export type PendingHyperliquidOrder = PendingBase & {
  kind: "hl_order";
  coin: string;            // BTC, ETH, etc.
  isBuy: boolean;          // true = open/add long; false = open/add short
  size: string;            // human-readable position size
  price: string;           // limit price (for IOC market-style, mark ± slippage)
  tif: "Gtc" | "Ioc" | "Alo";
  reduceOnly: boolean;
  /** Populated post-submission with the numeric oid as a hex string. */
  orderId?: string;
  /** API status string post-submission. */
  resultStatus?: string;
};

export type PendingHyperliquidCancel = PendingBase & {
  kind: "hl_cancel";
  coin: string;
  /** Numeric Hyperliquid oid. */
  hlOrderId: number;
};

export type PendingHyperliquidClose = PendingBase & {
  kind: "hl_close_position";
  coin: string;
  /** Current size at queue time (so the UI shows what's being closed). */
  positionSize: string;
  slippageBps: number;
  /** Populated post-submission. */
  orderId?: string;
};

export type PendingHyperliquidLeverage = PendingBase & {
  kind: "hl_leverage";
  coin: string;
  leverage: number;
  isCross: boolean;
};

// ---------- union ----------

export type PendingOp =
  | PendingSwap
  | PendingTransfer
  | PendingApprove
  | PendingWrap
  | PendingAddLiquidityV2
  | PendingRemoveLiquidityV2
  | PendingAddLiquidityV3
  | PendingExitLiquidityV3
  | PendingLimitOrder
  | PendingTwapOrder
  | PendingHyperliquidOrder
  | PendingHyperliquidCancel
  | PendingHyperliquidClose
  | PendingHyperliquidLeverage;

export type PendingOpKind = PendingOp["kind"];

type ArkiveState = {
  unlocked: Map<string, { account: PrivateKeyAccount; unlockedAt: number }>;
  pending: Map<string, PendingOp>;
};

function getState(): ArkiveState {
  if (!globalThis.__arkive) {
    globalThis.__arkive = {
      unlocked: new Map(),
      pending: new Map(),
    };
  }
  return globalThis.__arkive;
}

// ---------- unlocked wallet management ----------

export function setUnlocked(walletId: string, account: PrivateKeyAccount) {
  getState().unlocked.set(walletId, { account, unlockedAt: Date.now() });
}

export function getUnlocked(walletId: string): PrivateKeyAccount | undefined {
  return getState().unlocked.get(walletId)?.account;
}

export function lock(walletId: string) {
  getState().unlocked.delete(walletId);
}

export function lockAll() {
  getState().unlocked.clear();
}

export function isUnlocked(walletId: string): boolean {
  return getState().unlocked.has(walletId);
}

export function listUnlockedIds(): string[] {
  return [...getState().unlocked.keys()];
}

// ---------- pending op queue ----------

export function enqueuePending(op: PendingOp) {
  // Group bookkeeping — if this op carries a groupId, stamp it with the
  // next index in the group AND propagate the group title forward (so
  // tools that only know the groupId can omit the title and we still
  // surface the right headline). Also bumps groupSize on every existing
  // sibling so the slideshow renders "1 of 3" → "2 of 3" → "3 of 3"
  // even when ops are enqueued one at a time.
  if (op.groupId) {
    const siblings = [...getState().pending.values()].filter(
      (p) => p.groupId === op.groupId
    );
    op.groupIndex = siblings.length;
    // Inherit title from the first sibling if this op didn't bring its own.
    if (!op.groupTitle) {
      const first = siblings.find((p) => p.groupTitle);
      if (first?.groupTitle) op.groupTitle = first.groupTitle;
    }
    const newSize = siblings.length + 1;
    op.groupSize = newSize;
    for (const s of siblings) {
      s.groupSize = newSize;
      // If this op brought a title and siblings don't have one, backfill.
      if (op.groupTitle && !s.groupTitle) s.groupTitle = op.groupTitle;
    }
  }
  getState().pending.set(op.id, op);
}

export function getPending(id: string): PendingOp | undefined {
  return getState().pending.get(id);
}

export function listPending(filter?: { status?: PendingStatus; kind?: PendingOpKind }): PendingOp[] {
  let all = [...getState().pending.values()].sort((a, b) => b.requestedAt - a.requestedAt);
  if (filter?.status) all = all.filter((p) => p.status === filter.status);
  if (filter?.kind) all = all.filter((p) => p.kind === filter.kind);
  return all;
}

export function updatePending(id: string, patch: Partial<PendingOp>) {
  const cur = getState().pending.get(id);
  if (!cur) return;
  // Cast is safe — patch only updates fields present in the variant `cur` resolves to.
  getState().pending.set(id, { ...cur, ...patch } as PendingOp);
}
