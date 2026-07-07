"use client";

import { useEffect, useMemo, useState, useCallback } from "react";

/**
 * Pending-op approval surface.
 *
 * Two rendering modes:
 *   - Single ops render as one card (the original behavior).
 *   - Multi-op groups (every op in the group shares a groupId; the AI
 *     stamps this when running a sequence like "set leverage, then open
 *     position") render as ONE titled card with a slideshow inside.
 *     Dot indicators across the top; prev/next + approve/reject inside.
 *
 * Each op renders its chain-correct explorer link:
 *   - HL ops → Hyperliquid portfolio (the numeric oid doesn't map cleanly
 *     to a tx-explorer URL; the portfolio page is the canonical "where did
 *     this go" surface)
 *   - UniswapX limit / TWAP → Uniswap app (the orderId is the API's, not
 *     an L1 tx hash)
 *   - EVM swap/transfer/approve/wrap/LP → chain-specific Etherscan-style
 */

type TokenRef = { address: string; symbol: string; decimals: number };

type PendingStatus = "pending" | "approved" | "rejected" | "submitted" | "failed";

type PendingBase = {
  id: string;
  walletId: string;
  walletAddress: `0x${string}`;
  chain: "ethereum" | "base";
  status: PendingStatus;
  txHash?: string;
  error?: string;
  requestedAt: number;
  summary?: string;
  groupId?: string;
  groupTitle?: string;
  groupIndex?: number;
  groupSize?: number;
};

type PendingSwap = PendingBase & {
  kind: "swap";
  venue: "uniswap" | "1inch";
  fromToken: TokenRef;
  toToken: TokenRef;
  fromAmount: string;
  estimatedToAmount: string;
  slippageBps: number;
};

type PendingTransfer = PendingBase & {
  kind: "transfer";
  to: `0x${string}`;
  toEns?: string;
  asset: { kind: "eth" } | { kind: "erc20"; token: TokenRef };
  amount: string;
};

type PendingApprove = PendingBase & {
  kind: "approve";
  token: TokenRef;
  spender: `0x${string}`;
  amount: string;
  purpose?: string;
};

type PendingWrap = PendingBase & { kind: "wrap_eth" | "unwrap_weth"; amount: string };

type PendingLpV2 = PendingBase & {
  kind: "add_liquidity_v2" | "remove_liquidity_v2";
  tokenA: TokenRef;
  tokenB: TokenRef;
  amountA?: string;
  amountB?: string;
  lpAmount?: string;
  slippageBps: number;
};

type PendingLpV3 =
  | (PendingBase & {
      kind: "add_liquidity_v3";
      token0: TokenRef;
      token1: TokenRef;
      fee: number;
      amount0Desired: string;
      amount1Desired: string;
      tickLower: number;
      tickUpper: number;
      slippageBps: number;
    })
  | (PendingBase & {
      kind: "exit_liquidity_v3";
      token0: TokenRef;
      token1: TokenRef;
      tokenId: string;
      burnAfter: boolean;
    });

type PendingLimitOrder = PendingBase & {
  kind: "limit_order";
  fromToken: TokenRef;
  toToken: TokenRef;
  amountIn: string;
  minAmountOut: string;
  deadline: number;
};

type PendingTwapOrder = PendingBase & {
  kind: "twap_order";
  fromToken: TokenRef;
  toToken: TokenRef;
  totalAmountIn: string;
  chunks: number;
  intervalSeconds: number;
  minAmountOutPerChunk: string;
};

type PendingHlOrder = PendingBase & {
  kind: "hl_order";
  coin: string;
  isBuy: boolean;
  size: string;
  price: string;
  tif: "Gtc" | "Ioc" | "Alo";
  reduceOnly: boolean;
};

type PendingHlCancel = PendingBase & { kind: "hl_cancel"; coin: string; hlOrderId: number };
type PendingHlClose = PendingBase & {
  kind: "hl_close_position";
  coin: string;
  positionSize: string;
  slippageBps: number;
};
type PendingHlLeverage = PendingBase & {
  kind: "hl_leverage";
  coin: string;
  leverage: number;
  isCross: boolean;
};

type PendingOp =
  | PendingSwap
  | PendingTransfer
  | PendingApprove
  | PendingWrap
  | PendingLpV2
  | PendingLpV3
  | PendingLimitOrder
  | PendingTwapOrder
  | PendingHlOrder
  | PendingHlCancel
  | PendingHlClose
  | PendingHlLeverage;

// ---------------------------------------------------------------------------
// Chain-specific explorer link resolution
// ---------------------------------------------------------------------------

function explorerLink(op: PendingOp): { label: string; url: string } | null {
  // Hyperliquid ops never have an EVM-style tx hash. The "txHash" slot
  // carries the numeric oid hex-encoded for UI continuity, but no
  // chainscan recognizes it. Link to the user's portfolio page on the
  // Hyperliquid app where they can see the order in context.
  if (
    op.kind === "hl_order" ||
    op.kind === "hl_cancel" ||
    op.kind === "hl_close_position" ||
    op.kind === "hl_leverage"
  ) {
    return op.status === "submitted" || op.status === "failed"
      ? { label: "View on Hyperliquid ↗", url: "https://app.hyperliquid.xyz/portfolio" }
      : null;
  }

  // UniswapX ops carry an orderId (API-side), not an L1 tx hash. Link
  // to the Uniswap app where the user can see open + filled orders.
  if (op.kind === "limit_order" || op.kind === "twap_order") {
    return op.status === "submitted"
      ? { label: "View order on Uniswap ↗", url: "https://app.uniswap.org/limits" }
      : null;
  }

  // EVM ops — chain-specific Etherscan-style.
  if (!op.txHash) return null;
  const map: Record<PendingBase["chain"], { name: string; base: string }> = {
    ethereum: { name: "Etherscan", base: "https://etherscan.io" },
    base: { name: "Basescan", base: "https://basescan.org" },
  };
  const ex = map[op.chain];
  if (!ex) return null;
  return { label: `View on ${ex.name} ↗`, url: `${ex.base}/tx/${op.txHash}` };
}

function chainLabel(op: PendingOp): string {
  if (
    op.kind === "hl_order" ||
    op.kind === "hl_cancel" ||
    op.kind === "hl_close_position" ||
    op.kind === "hl_leverage"
  ) {
    return "Hyperliquid";
  }
  return op.chain === "base" ? "Base" : "Ethereum";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PendingList() {
  const [items, setItems] = useState<PendingOp[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/pending", { cache: "no-store" });
    const data = await res.json();
    setItems(data.pending ?? []);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  async function act(id: string, action: "approve" | "reject") {
    setBusy(id);
    try {
      await fetch(`/api/pending/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  // Group ops sharing a groupId; preserve enqueue order within a group.
  const blocks = useMemo(() => groupOps(items), [items]);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-panel p-10 text-center">
        <p className="text-sm text-muted-foreground">No pending operations.</p>
        <p className="mt-1 font-code text-2xs uppercase tracking-wider text-muted-foreground/50">
          swaps · transfers · approvals · lp · limit/twap · hyperliquid
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {blocks.map((b) =>
        b.kind === "single" ? (
          <SingleCard key={b.op.id} op={b.op} busy={busy} act={act} />
        ) : (
          <GroupCard key={b.groupId} title={b.title} ops={b.ops} busy={busy} act={act} />
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

type Block =
  | { kind: "single"; op: PendingOp }
  | { kind: "group"; groupId: string; title: string; ops: PendingOp[] };

function groupOps(items: PendingOp[]): Block[] {
  const blocks: Block[] = [];
  const byGroup = new Map<string, PendingOp[]>();
  for (const op of items) {
    if (op.groupId) {
      const arr = byGroup.get(op.groupId) ?? [];
      arr.push(op);
      byGroup.set(op.groupId, arr);
    } else {
      blocks.push({ kind: "single", op });
    }
  }
  for (const [groupId, ops] of byGroup) {
    ops.sort((a, b) => (a.groupIndex ?? 0) - (b.groupIndex ?? 0));
    const title = ops.find((o) => o.groupTitle)?.groupTitle ?? "Multi-step action";
    blocks.push({ kind: "group", groupId, title, ops });
  }
  // Mixed-mode sort: newest-first by the latest requestedAt in the block.
  blocks.sort((x, y) => latestTs(y) - latestTs(x));
  return blocks;
}

function latestTs(b: Block): number {
  if (b.kind === "single") return b.op.requestedAt;
  return Math.max(...b.ops.map((o) => o.requestedAt));
}

// ---------------------------------------------------------------------------
// Single op card
// ---------------------------------------------------------------------------

function SingleCard({
  op,
  busy,
  act,
}: {
  op: PendingOp;
  busy: string | null;
  act: (id: string, action: "approve" | "reject") => void;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-panel p-4">
      <OpRow op={op} busy={busy} act={act} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group slideshow card — titled block, dot indicators, prev/next, one
// approval at a time
// ---------------------------------------------------------------------------

function GroupCard({
  title,
  ops,
  busy,
  act,
}: {
  title: string;
  ops: PendingOp[];
  busy: string | null;
  act: (id: string, action: "approve" | "reject") => void;
}) {
  // Auto-advance to the first still-pending op so the user lands on the
  // step that needs action. If they manually navigate (prev/next), respect
  // their choice.
  const firstPendingIdx = useMemo(
    () => Math.max(0, ops.findIndex((o) => o.status === "pending")),
    [ops]
  );
  const [idx, setIdx] = useState<number>(firstPendingIdx);
  // Re-sync when group composition changes (new sibling enqueued, prior
  // step resolved).
  useEffect(() => {
    setIdx((cur) => {
      if (cur >= ops.length) return ops.length - 1;
      // If current step is no longer pending, drift toward the next one.
      if (ops[cur]?.status !== "pending") {
        const nextPending = ops.findIndex((o) => o.status === "pending");
        return nextPending >= 0 ? nextPending : cur;
      }
      return cur;
    });
  }, [ops]);

  const current = ops[Math.max(0, Math.min(idx, ops.length - 1))];
  if (!current) return null;

  const allDone = ops.every((o) => o.status !== "pending");

  return (
    <div className="rounded-xl border border-border-subtle bg-panel overflow-hidden">
      {/* Group header: title + dots */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-lg border border-agent/30 px-1.5 py-px font-code text-2xs uppercase tracking-wider text-agent">
              multi-step
            </span>
            <h3 className="truncate font-mono text-sm text-foreground">{title}</h3>
          </div>
          <p className="mt-1 font-code text-2xs uppercase tracking-wider text-muted-foreground/60">
            step {idx + 1}/{ops.length}
            {allDone ? " · all resolved" : ""}
          </p>
        </div>
        <Dots
          count={ops.length}
          activeIdx={idx}
          statuses={ops.map((o) => o.status)}
          onPick={setIdx}
        />
      </div>

      {/* Current step row */}
      <div className="p-4">
        <OpRow op={current} busy={busy} act={act} />
      </div>

      {/* Slideshow controls */}
      <div className="flex items-center justify-between border-t border-border-subtle px-4 py-2">
        <button
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          className="flex h-7 items-center rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors duration-120 hover:bg-secondary hover:text-foreground disabled:opacity-30"
        >
          ← Prev
        </button>
        <span className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/50">
          approve each step in order
        </span>
        <button
          onClick={() => setIdx((i) => Math.min(ops.length - 1, i + 1))}
          disabled={idx >= ops.length - 1}
          className="flex h-7 items-center rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors duration-120 hover:bg-secondary hover:text-foreground disabled:opacity-30"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function Dots({
  count,
  activeIdx,
  statuses,
  onPick,
}: {
  count: number;
  activeIdx: number;
  statuses: PendingStatus[];
  onPick: (i: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {Array.from({ length: count }).map((_, i) => {
        const s = statuses[i];
        const active = i === activeIdx;
        // Color encodes status:
        //   submitted → solid green-ish
        //   approved  → solid white
        //   pending   → hollow white
        //   rejected  → hollow muted
        //   failed    → solid red
        const baseClass = "h-2 w-2 rounded-full transition-all";
        const color =
          s === "submitted"
            ? "bg-success"
            : s === "approved"
              ? "bg-foreground"
              : s === "failed"
                ? "bg-destructive"
                : s === "rejected"
                  ? "bg-muted-foreground/40"
                  : "bg-transparent ring-1 ring-foreground/70";
        const ring = active ? "ring-2 ring-primary ring-offset-2 ring-offset-panel" : "";
        return (
          <button
            key={i}
            type="button"
            onClick={() => onPick(i)}
            className={`${baseClass} ${color} ${ring} cursor-pointer`}
            aria-label={`Step ${i + 1}: ${s}`}
            title={`Step ${i + 1}: ${s}`}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared row body — used by both SingleCard and GroupCard.current
// ---------------------------------------------------------------------------

function OpRow({
  op,
  busy,
  act,
}: {
  op: PendingOp;
  busy: string | null;
  act: (id: string, action: "approve" | "reject") => void;
}) {
  const link = explorerLink(op);
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-mono text-sm text-foreground">{headline(op)}</h3>
          <KindPill op={op} />
          <ChainPill label={chainLabel(op)} />
          <StatusPill status={op.status} />
        </div>
        <Subline op={op} />
        {link && (
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block font-mono text-xs text-muted-foreground underline decoration-border underline-offset-2 transition-colors hover:text-foreground"
          >
            {link.label}
          </a>
        )}
        {op.error && <p className="mt-2 text-xs text-destructive">{op.error}</p>}
      </div>
      {op.status === "pending" && (
        <div className="flex gap-2">
          <button
            onClick={() => act(op.id, "reject")}
            disabled={busy === op.id}
            className="flex h-7 items-center rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors duration-120 hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={() => act(op.id, "approve")}
            disabled={busy === op.id}
            className="flex h-7 items-center rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === op.id ? "Signing…" : "Approve & sign"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-op formatting helpers
// ---------------------------------------------------------------------------

function headline(op: PendingOp): string {
  if (op.summary) return op.summary;
  switch (op.kind) {
    case "swap":
      return `${op.fromAmount} ${op.fromToken.symbol} → ~${Number(op.estimatedToAmount).toFixed(6)} ${op.toToken.symbol}`;
    case "transfer": {
      const sym = op.asset.kind === "eth" ? "ETH" : op.asset.token.symbol;
      const dst = op.toEns ?? `${op.to.slice(0, 6)}…${op.to.slice(-4)}`;
      return `Transfer ${op.amount} ${sym} → ${dst}`;
    }
    case "approve":
      return `Approve ${op.amount === "max" ? "unlimited" : op.amount} ${op.token.symbol} → ${op.spender.slice(0, 6)}…${op.spender.slice(-4)}`;
    case "wrap_eth":
      return `Wrap ${op.amount} ETH → WETH`;
    case "unwrap_weth":
      return `Unwrap ${op.amount} WETH → ETH`;
    case "add_liquidity_v2":
      return `Add V2 LP: ${op.amountA ?? "?"} ${op.tokenA.symbol} + ${op.amountB ?? "?"} ${op.tokenB.symbol}`;
    case "remove_liquidity_v2":
      return `Remove V2 LP: ${op.lpAmount ?? "?"} ${op.tokenA.symbol}/${op.tokenB.symbol}`;
    case "add_liquidity_v3":
      return `Mint V3 LP: ${op.amount0Desired} ${op.token0.symbol} + ${op.amount1Desired} ${op.token1.symbol} (fee ${op.fee})`;
    case "exit_liquidity_v3":
      return `Exit V3 LP #${op.tokenId} (${op.token0.symbol}/${op.token1.symbol})`;
    case "limit_order":
      return `Limit: ${op.amountIn} ${op.fromToken.symbol} → ≥${op.minAmountOut} ${op.toToken.symbol}`;
    case "twap_order":
      return `TWAP: ${op.totalAmountIn} ${op.fromToken.symbol} → ${op.toToken.symbol} (${op.chunks} chunks)`;
    case "hl_order":
      return `HL ${op.isBuy ? "BUY" : "SELL"} ${op.size} ${op.coin} @ ${op.price} (${op.tif}${op.reduceOnly ? ", reduce-only" : ""})`;
    case "hl_cancel":
      return `HL cancel ${op.coin} #${op.hlOrderId}`;
    case "hl_close_position":
      return `HL close ${op.coin} (${op.positionSize} contracts)`;
    case "hl_leverage":
      return `HL set ${op.coin} leverage to ${op.leverage}x ${op.isCross ? "cross" : "isolated"}`;
  }
}

function Subline({ op }: { op: PendingOp }) {
  const wallet = `${op.walletAddress.slice(0, 6)}…${op.walletAddress.slice(-4)}`;
  const ts = new Date(op.requestedAt).toLocaleTimeString();
  const slipFor =
    "slippageBps" in op && (op as { slippageBps?: number }).slippageBps !== undefined
      ? `Slippage ${((op as { slippageBps: number }).slippageBps / 100).toFixed(2)}% · `
      : "";
  return (
    <p className="mt-1 font-mono text-xs text-muted-foreground/70">
      {slipFor}
      Wallet <span className="tabular-nums">{wallet}</span> · {ts}
    </p>
  );
}

function ChainPill({ label }: { label: string }) {
  return (
    <span className="rounded-sm border border-border-subtle px-1.5 py-px font-code text-2xs uppercase tracking-wider text-muted-foreground/70">
      {label}
    </span>
  );
}

const KIND_LABEL: Record<PendingOp["kind"], string> = {
  swap: "Swap",
  transfer: "Transfer",
  approve: "Approve",
  wrap_eth: "Wrap",
  unwrap_weth: "Unwrap",
  add_liquidity_v2: "Add LP V2",
  remove_liquidity_v2: "Remove LP V2",
  add_liquidity_v3: "Mint LP V3",
  exit_liquidity_v3: "Exit LP V3",
  limit_order: "Limit · UniswapX",
  twap_order: "TWAP · UniswapX",
  hl_order: "HL Order",
  hl_cancel: "HL Cancel",
  hl_close_position: "HL Close",
  hl_leverage: "HL Leverage",
};

function KindPill({ op }: { op: PendingOp }) {
  const venueSuffix = op.kind === "swap" ? (op.venue === "uniswap" ? " · Uniswap V2" : " · 1inch") : "";
  return (
    <span className="rounded-sm border border-border px-1.5 py-px font-code text-2xs uppercase tracking-wider text-muted-foreground">
      {KIND_LABEL[op.kind]}
      {venueSuffix}
    </span>
  );
}

function StatusPill({ status }: { status: PendingStatus }) {
  // Dot color is the status signal; the label stays neutral mono.
  const dot: Record<PendingStatus, string> = {
    pending: "bg-warning",
    approved: "bg-foreground",
    submitted: "bg-success",
    rejected: "bg-muted-foreground/40",
    failed: "bg-destructive",
  };
  return (
    <span className="flex items-center gap-1.5 rounded-sm border border-border px-1.5 py-px">
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot[status]}`} />
      <span className="font-code text-2xs uppercase tracking-wider text-muted-foreground">
        {status}
      </span>
    </span>
  );
}
