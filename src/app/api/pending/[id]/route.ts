// Pending op approval endpoint.
//
// All write operations (swaps, transfers, approvals, wraps, LP add/remove)
// land here. Dispatch is by `op.kind`; each kind has its own executor in
// src/lib/defi/* (or the inline swap path for backward compat).

import { NextResponse } from "next/server";
import { getPending, getUnlocked, updatePending, type PendingOp, type PendingSwap } from "@/lib/state";
import { walletClientFor, publicClient, getAllowance } from "@/lib/eth";
import * as oneinch from "@/lib/oneinch";
import * as uniswap from "@/lib/uniswap";
import { recordTrade } from "@/lib/trades";
import { logAction, type ActionKind } from "@/lib/activity";
import { getChain } from "@/lib/chains";
import { executeTransfer } from "@/lib/defi/transfers";
import { executeApprove } from "@/lib/defi/approvals";
import { executeWrap } from "@/lib/defi/wrapped";
import { executeAddLiquidityV2, executeRemoveLiquidityV2 } from "@/lib/defi/uniswap-v2-lp";
import { executeAddLiquidityV3, executeExitLiquidityV3 } from "@/lib/defi/uniswap-v3-lp";
import { placeLimitOrder, placeTwapOrder } from "@/lib/uniswapx";
import {
  placeOrder as hlPlaceOrder,
  cancelOrder as hlCancelOrder,
  closePosition as hlClosePosition,
  updateLeverage as hlUpdateLeverage,
} from "@/lib/hyperliquid";
import type { Address, Hex } from "viem";

const MAX_UINT256 =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const op = getPending(id);
  if (!op) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ swap: op }); // backward-compat: UI calls it "swap"
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action as "approve" | "reject" | undefined;

  const op = getPending(id);
  if (!op) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (op.status !== "pending") {
    return NextResponse.json({ error: `Op is already ${op.status}` }, { status: 400 });
  }

  if (action === "reject") {
    updatePending(id, { status: "rejected", resolvedAt: Date.now() });
    await logRejection(op).catch(() => {});
    return NextResponse.json({ ok: true });
  }
  if (action !== "approve") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const account = getUnlocked(op.walletId);
  if (!account) {
    return NextResponse.json({ error: "Wallet is locked. Unlock it first." }, { status: 401 });
  }

  updatePending(id, { status: "approved" });
  const wallet = walletClientFor(account, op.chain);

  try {
    const result = await dispatchExecute(op, account.address, wallet);
    updatePending(id, { status: "submitted", txHash: result.hash, resolvedAt: Date.now() });
    await logApproval(op, result).catch(() => {});
    return NextResponse.json({ ok: true, txHash: result.hash });
  } catch (e) {
    const msg = (e as Error).message;
    updatePending(id, { status: "failed", error: msg, resolvedAt: Date.now() });
    await logFailure(op, msg).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ============================================================================
// Dispatch
// ============================================================================

type ExecResult = { hash: Hex; recordedTrade?: Awaited<ReturnType<typeof recordTrade>> | null };

async function dispatchExecute(
  op: PendingOp,
  from: Address,
  wallet: ReturnType<typeof walletClientFor>
): Promise<ExecResult> {
  switch (op.kind) {
    case "swap":
      return executeSwap(op, from, wallet);
    case "transfer": {
      const plan =
        op.asset.kind === "eth"
          ? { kind: "eth" as const, to: op.to, amountWei: op.amountWei }
          : {
              kind: "erc20" as const,
              to: op.to,
              token: { address: op.asset.token.address },
              amountWei: op.amountWei,
            };
      const { hash } = await executeTransfer({ plan, chain: op.chain, wallet });
      return { hash };
    }
    case "approve": {
      const { hash } = await executeApprove({
        plan: { token: op.token, spender: op.spender, amount: op.amount, amountWei: op.amountWei },
        chain: op.chain,
        wallet,
      });
      return { hash };
    }
    case "wrap_eth":
    case "unwrap_weth": {
      const { hash } = await executeWrap({
        plan: { kind: op.kind, amount: op.amount, amountWei: op.amountWei, weth: op.weth },
        chain: op.chain,
        wallet,
      });
      return { hash };
    }
    case "add_liquidity_v2": {
      const { hash } = await executeAddLiquidityV2({
        plan: {
          tokenA: op.tokenA,
          tokenB: op.tokenB,
          amountAWei: op.amountAWei,
          amountBWei: op.amountBWei,
          amountAMinWei: ((BigInt(op.amountAWei) * (10_000n - BigInt(op.slippageBps))) / 10_000n).toString(),
          amountBMinWei: ((BigInt(op.amountBWei) * (10_000n - BigInt(op.slippageBps))) / 10_000n).toString(),
          isEthPair: op.tokenA.symbol === "ETH" || op.tokenB.symbol === "ETH",
          ethSide: op.tokenA.symbol === "ETH" ? "A" : op.tokenB.symbol === "ETH" ? "B" : undefined,
          deadline: op.deadline,
        },
        from,
        chain: op.chain,
        wallet,
      });
      return { hash };
    }
    case "remove_liquidity_v2": {
      const { hash } = await executeRemoveLiquidityV2({
        plan: {
          tokenA: op.tokenA,
          tokenB: op.tokenB,
          pair: op.pair,
          lpAmountWei: op.lpAmountWei,
          amountAMinWei: op.minAmountAWei,
          amountBMinWei: op.minAmountBWei,
          isEthPair: op.tokenA.symbol === "ETH" || op.tokenB.symbol === "ETH",
          ethSide: op.tokenA.symbol === "ETH" ? "A" : op.tokenB.symbol === "ETH" ? "B" : undefined,
          deadline: op.deadline,
        },
        from,
        chain: op.chain,
        wallet,
      });
      return { hash };
    }
    case "add_liquidity_v3": {
      const { hash } = await executeAddLiquidityV3({
        plan: {
          token0: op.token0,
          token1: op.token1,
          fee: op.fee,
          tickLower: op.tickLower,
          tickUpper: op.tickUpper,
          amount0DesiredWei: op.amount0DesiredWei,
          amount1DesiredWei: op.amount1DesiredWei,
          amount0MinWei: op.amount0MinWei,
          amount1MinWei: op.amount1MinWei,
          deadline: op.deadline,
        },
        from,
        chain: op.chain,
        wallet,
      });
      return { hash };
    }
    case "exit_liquidity_v3": {
      const { hash } = await executeExitLiquidityV3({
        plan: {
          tokenId: op.tokenId,
          token0: op.token0,
          token1: op.token1,
          liquidity: op.liquidity,
          amount0MinWei: op.amount0MinWei,
          amount1MinWei: op.amount1MinWei,
          burnAfter: op.burnAfter,
          deadline: op.deadline,
        },
        from,
        chain: op.chain,
        wallet,
      });
      return { hash };
    }
    case "limit_order": {
      // Off-chain UniswapX limit order — quote → sign → submit. The
      // "txHash" field on the pending row gets the orderId (a 32-byte
      // hex string compatible with the Hex type) so existing UI shows
      // something useful. Full order metadata patched in via updatePending.
      // `account` here is the same PrivateKeyAccount the dispatcher
      // already unlocked via getUnlocked() above.
      const account = (await import("@/lib/state")).getUnlocked(op.walletId)!;
      const result = await placeLimitOrder({
        chain: op.chain,
        account,
        tokenIn: op.fromToken.address,
        tokenOut: op.toToken.address,
        amountInWei: op.amountInWei,
        minOutWei: op.minAmountOutWei,
        deadline: op.deadline,
      });
      updatePending(op.id, {
        orderId: result.orderId,
        routing: result.routing,
        orderStatus: result.orderStatus,
      } as Partial<PendingOp>);
      return { hash: result.orderId as Hex };
    }
    case "twap_order": {
      // N child UniswapX limit orders, submitted all-now with staggered
      // deadlines. We store the full childOrderIds list; the dispatcher's
      // single "hash" slot gets the first orderId for UI continuity.
      const account = (await import("@/lib/state")).getUnlocked(op.walletId)!;
      const result = await placeTwapOrder({
        chain: op.chain,
        account,
        tokenIn: op.fromToken.address,
        tokenOut: op.toToken.address,
        totalInWei: op.totalAmountInWei,
        chunks: op.chunks,
        intervalSeconds: op.intervalSeconds,
        baseDeadlineSeconds: op.baseDeadline,
        minOutPerChunkWei: op.minAmountOutPerChunkWei,
      });
      const childOrderIds = result.child_orders.map((c) => c.orderId);
      const childOrderStatuses = result.child_orders.map((c) => c.orderStatus);
      updatePending(op.id, {
        childOrderIds,
        childOrderStatuses,
      } as Partial<PendingOp>);
      return { hash: (childOrderIds[0] ?? "0x") as Hex };
    }

    // ---- Hyperliquid (perps) ----
    // Hyperliquid uses the same EVM private key for EIP-712 signing as our
    // existing keystore; the SDK handles the action_hash + Agent envelope
    // internally. We repurpose the "txHash" field for the numeric oid (hex-
    // encoded) so the existing /pending UI shows something useful.
    case "hl_order": {
      const account = (await import("@/lib/state")).getUnlocked(op.walletId)!;
      const result = await hlPlaceOrder({
        account,
        coin: op.coin,
        isBuy: op.isBuy,
        size: op.size,
        price: op.price,
        tif: op.tif,
        reduceOnly: op.reduceOnly,
      });
      if (result.status !== "ok") {
        throw new Error(`Hyperliquid rejected order: ${JSON.stringify(result.raw).slice(0, 400)}`);
      }
      const oidHex = result.order_id !== undefined ? oidToHex(result.order_id) : ("0x" as Hex);
      updatePending(op.id, {
        orderId: oidHex,
        resultStatus: "submitted",
      } as Partial<PendingOp>);
      return { hash: oidHex };
    }
    case "hl_cancel": {
      const account = (await import("@/lib/state")).getUnlocked(op.walletId)!;
      const result = await hlCancelOrder({
        account,
        coin: op.coin,
        orderId: op.hlOrderId,
      });
      if (result.status !== "ok") {
        throw new Error(`Hyperliquid cancel rejected: ${JSON.stringify(result.raw).slice(0, 400)}`);
      }
      return { hash: oidToHex(op.hlOrderId) };
    }
    case "hl_close_position": {
      const account = (await import("@/lib/state")).getUnlocked(op.walletId)!;
      const result = await hlClosePosition({
        account,
        coin: op.coin,
        slippageBps: op.slippageBps,
      });
      if (result.status !== "ok") {
        throw new Error(`Hyperliquid close rejected: ${JSON.stringify(result.raw).slice(0, 400)}`);
      }
      const oidHex = result.order_id !== undefined ? oidToHex(result.order_id) : ("0x" as Hex);
      updatePending(op.id, { orderId: oidHex } as Partial<PendingOp>);
      return { hash: oidHex };
    }
    case "hl_leverage": {
      const account = (await import("@/lib/state")).getUnlocked(op.walletId)!;
      const result = await hlUpdateLeverage({
        account,
        coin: op.coin,
        leverage: op.leverage,
        isCross: op.isCross,
      });
      if (result.status !== "ok") {
        throw new Error(`Hyperliquid updateLeverage rejected: ${JSON.stringify(result.raw).slice(0, 400)}`);
      }
      // No order id to surface — return a synthetic hash so the dispatcher
      // can mark the op submitted. Hyperliquid leverage changes are
      // off-chain account-state mutations, not on-chain txs.
      return { hash: ("0x" + "0".repeat(64)) as Hex };
    }
  }
}

/** Encode a numeric Hyperliquid oid as a 32-byte hex string so it slots
 *  into the existing txHash: Hex field for UI display. */
function oidToHex(oid: number): Hex {
  return ("0x" + oid.toString(16).padStart(64, "0")) as Hex;
}

// ============================================================================
// Activity logging — one action kind per op family.
// ============================================================================

function actionKindFor(op: PendingOp, phase: "rejected" | "approved" | "failed"): ActionKind {
  switch (op.kind) {
    case "swap":
      return `swap_${phase}` as ActionKind;
    case "transfer":
      return `transfer_${phase}` as ActionKind;
    case "approve":
      return `approve_${phase}` as ActionKind;
    case "wrap_eth":
    case "unwrap_weth":
      return `wrap_${phase}` as ActionKind;
    case "add_liquidity_v2":
    case "remove_liquidity_v2":
    case "add_liquidity_v3":
    case "exit_liquidity_v3":
      return `lp_${phase}` as ActionKind;
    case "limit_order":
    case "twap_order":
    case "hl_order":
    case "hl_cancel":
    case "hl_close_position":
    case "hl_leverage":
      // activity.ts is deprecated (no-op stub) so the cast is safe even
      // though we haven't extended its enum. Real provenance for these
      // lives in the trade journal entries the AI writes.
      return `swap_${phase}` as ActionKind;
  }
}

async function logRejection(op: PendingOp): Promise<void> {
  await logAction({
    action: actionKindFor(op, "rejected"),
    actor: "user",
    target: { wallet: { id: op.walletId, address: op.walletAddress, kind: "owned" } },
    result: { decision: "rejected" },
    linked_refs: [{ type: "wallet", id: op.walletId, address: op.walletAddress }],
  });
}

async function logFailure(op: PendingOp, error: string): Promise<void> {
  await logAction({
    action: actionKindFor(op, "failed"),
    actor: "system",
    severity: "warn",
    target: { wallet: { id: op.walletId, address: op.walletAddress, kind: "owned" } },
    result: { error },
    linked_refs: [{ type: "wallet", id: op.walletId, address: op.walletAddress }],
  });
}

async function logApproval(op: PendingOp, result: ExecResult): Promise<void> {
  if (op.kind === "swap") {
    // Preserve the existing swap_approved + recordTrade path.
    try {
      const recordedTrade = await recordTrade({
        walletId: op.walletId,
        walletAddress: op.walletAddress as Address,
        chain: op.chain,
        venue: op.venue,
        txHash: result.hash,
        inputToken: op.fromToken,
        outputToken: op.toToken,
        inputAmount: op.fromAmount,
        outputAmount: op.estimatedToAmount,
      });
      if (recordedTrade) {
        await logAction({
          action: "swap_approved",
          actor: "user",
          target: {
            token: { address: op.toToken.address, symbol: op.toToken.symbol, chain: op.chain },
            wallet: { id: op.walletId, address: op.walletAddress, kind: "owned" },
          },
          result: {
            decision: "approved",
            tx_hash: result.hash,
            expected_output_amount: recordedTrade.tokenAmount,
            expected_output_symbol: recordedTrade.token.symbol,
          },
          linked_refs: [
            { type: "trade", id: recordedTrade.id },
            { type: "tx", chain: op.chain, hash: result.hash },
          ],
        });
      }
    } catch (e) {
      console.error("swap recordTrade failed:", (e as Error).message);
    }
    return;
  }

  // Generic op log for transfers / approvals / wraps / LP
  await logAction({
    action: actionKindFor(op, "approved"),
    actor: "user",
    target: { wallet: { id: op.walletId, address: op.walletAddress, kind: "owned" } },
    result: { decision: "approved", tx_hash: result.hash },
    linked_refs: [
      { type: "wallet", id: op.walletId, address: op.walletAddress },
      { type: "tx", chain: op.chain, hash: result.hash },
    ],
  });
}

// ============================================================================
// Swap executor — preserved verbatim from the previous handler so existing
// swap flows behave unchanged. Only the dispatch above is new.
// ============================================================================

async function executeSwap(
  swap: PendingSwap,
  from: Address,
  wallet: ReturnType<typeof walletClientFor>
): Promise<ExecResult> {
  if (swap.venue === "uniswap") {
    const result = await executeUniswap(swap, from, wallet);
    return { hash: result.hash };
  }
  if (swap.chain !== "ethereum") {
    throw new Error("1inch venue is only supported on Ethereum mainnet in this MVP.");
  }
  const hash = await executeOneInch(swap, from, wallet);
  return { hash };
}

async function executeUniswap(
  swap: PendingSwap,
  from: Address,
  wallet: ReturnType<typeof walletClientFor>
): Promise<{ hash: Hex; actualOutAmount: string }> {
  const chain = swap.chain;
  const isFromEth = swap.fromToken.symbol === "ETH";
  const path = (swap.path ?? []) as Address[];
  if (path.length < 2) throw new Error("Pending swap is missing routing path");

  const cfg = getChain(chain);
  const wethAddr = cfg.v2.weth;
  const router = cfg.v2.router;

  const src = isFromEth
    ? { chainId: cfg.numericId, chain, address: wethAddr, symbol: "ETH", name: "Ether", decimals: 18 }
    : {
        chainId: cfg.numericId,
        chain,
        address: swap.fromToken.address as Address,
        symbol: swap.fromToken.symbol,
        name: swap.fromToken.symbol,
        decimals: swap.fromToken.decimals,
      };
  const dst =
    swap.toToken.symbol === "ETH"
      ? { chainId: cfg.numericId, chain, address: wethAddr, symbol: "ETH", name: "Ether", decimals: 18 }
      : {
          chainId: cfg.numericId,
          chain,
          address: swap.toToken.address as Address,
          symbol: swap.toToken.symbol,
          name: swap.toToken.symbol,
          decimals: swap.toToken.decimals,
        };

  // Approval: only needed when input is ERC-20
  if (!isFromEth) {
    const current = await getAllowance(from, router, src.address, chain);
    if (current < BigInt(swap.fromAmountWei)) {
      const approveData = encodeApprove(router, MAX_UINT256);
      const approveHash = await wallet.sendTransaction({
        account: wallet.account!,
        chain: wallet.chain,
        to: src.address,
        data: approveData,
        value: 0n,
      });
      await publicClient(chain).waitForTransactionReceipt({ hash: approveHash });
    }
  }

  // Refresh quote at execution time
  const fresh = await uniswap.quoteExactIn({ src, dst, amount: swap.fromAmount });
  const built = uniswap.buildSwap({
    src,
    dst,
    path: fresh.path,
    amountInWei: fresh.amountInWei,
    amountOutWei: fresh.amountOutWei,
    recipient: from,
    slippageBps: swap.slippageBps,
  });

  const hash = await wallet.sendTransaction({
    account: wallet.account!,
    chain: wallet.chain,
    to: built.to,
    data: built.data,
    value: built.value,
  });

  return { hash, actualOutAmount: fresh.amountOutFormatted };
}

async function executeOneInch(
  swap: PendingSwap,
  from: Address,
  wallet: ReturnType<typeof walletClientFor>
): Promise<Hex> {
  if (swap.fromToken.address.toLowerCase() !== oneinch.NATIVE_TOKEN) {
    const spender = (await oneinch.getApproveSpender()).address;
    const current = await getAllowance(from, spender, swap.fromToken.address, "ethereum");
    if (current < BigInt(swap.fromAmountWei)) {
      const approveTx = await oneinch.getApproveTx({
        token: swap.fromToken.address,
        amountWei: swap.fromAmountWei,
      });
      const approveHash = await wallet.sendTransaction({
        account: wallet.account!,
        chain: wallet.chain,
        to: approveTx.to,
        data: approveTx.data,
        value: BigInt(approveTx.value || "0"),
      });
      await publicClient("ethereum").waitForTransactionReceipt({ hash: approveHash });
    }
  }

  const built = await oneinch.buildSwap({
    src: swap.fromToken.address,
    dst: swap.toToken.address,
    amountWei: swap.fromAmountWei,
    from,
    slippageBps: swap.slippageBps,
  });

  return wallet.sendTransaction({
    account: wallet.account!,
    chain: wallet.chain,
    to: built.tx.to,
    data: built.tx.data as Hex,
    value: BigInt(built.tx.value || "0"),
  });
}

function encodeApprove(spender: Address, amount: bigint): Hex {
  const selector = "0x095ea7b3";
  const padSpender = spender.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const padAmount = amount.toString(16).padStart(64, "0");
  return (selector + padSpender + padAmount) as Hex;
}
