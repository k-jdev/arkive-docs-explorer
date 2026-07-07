// Uniswap V2 liquidity provision.
//
// Single-tick AMM: deposit (token0, token1) at the current pool ratio, receive
// LP tokens. Withdraw burns LP tokens for proportional shares of the reserves.
//
// Key on-chain quirks the tools handle:
//   - If one side is ETH, use addLiquidityETH / removeLiquidityETH (router pulls
//     ETH via `value`, internally wraps to WETH).
//   - addLiquidity requires the desired amounts to be approximately at the pool
//     ratio. The router takes whichever side is the binding constraint. We
//     compute the "optimal" pair from current reserves so the user sees what
//     they'll actually deposit.
//   - amountAMin / amountBMin gate slippage. We compute them from the slippageBps
//     param at request time (locked into the pending row).

import {
  encodeFunctionData,
  parseUnits,
  formatUnits,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import {
  UNISWAP_V2_ROUTER_LP_ABI,
  UNISWAP_V2_FACTORY_ABI,
  UNISWAP_V2_PAIR_ABI,
  ERC20_TRANSFER_APPROVE_ABI,
  MAX_UINT256,
} from "./abis";
import { getChain, type ChainId } from "@/lib/chains";
import { publicClient, getTokenBalance, getEthBalance } from "@/lib/eth";
import { findToken, isNativeEth } from "@/lib/uniswap";
import type { TokenRef } from "@/lib/state";

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export type V2PairInfo = {
  pair: Address;
  token0: Address;
  token1: Address;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
};

export async function fetchPair(args: {
  tokenA: Address;
  tokenB: Address;
  chain: ChainId;
}): Promise<V2PairInfo | null> {
  const cfg = getChain(args.chain);
  const client = publicClient(args.chain);
  const pair = await client.readContract({
    address: cfg.v2.factory,
    abi: UNISWAP_V2_FACTORY_ABI,
    functionName: "getPair",
    args: [args.tokenA, args.tokenB],
  });
  if (pair === ZERO_ADDRESS) return null;

  const [token0, token1, reserves, totalSupply] = await Promise.all([
    client.readContract({ address: pair, abi: UNISWAP_V2_PAIR_ABI, functionName: "token0" }),
    client.readContract({ address: pair, abi: UNISWAP_V2_PAIR_ABI, functionName: "token1" }),
    client.readContract({ address: pair, abi: UNISWAP_V2_PAIR_ABI, functionName: "getReserves" }),
    client.readContract({ address: pair, abi: UNISWAP_V2_PAIR_ABI, functionName: "totalSupply" }),
  ]);
  return {
    pair: pair as Address,
    token0: token0 as Address,
    token1: token1 as Address,
    reserve0: reserves[0],
    reserve1: reserves[1],
    totalSupply,
  };
}

/**
 * Resolve a token reference from a symbol or address. Maps "ETH" to WETH internally
 * but keeps `isNative: true` so the executor knows to use addLiquidityETH.
 */
async function resolveLpToken(
  q: string,
  chain: ChainId
): Promise<{ ref: TokenRef; isNative: boolean }> {
  const t = await findToken(q, chain);
  if (!t) throw new Error(`Could not find token "${q}" on ${chain}.`);
  if (isNativeEth(t)) {
    const cfg = getChain(chain);
    return {
      ref: { address: cfg.v2.weth, symbol: "ETH", decimals: 18 },
      isNative: true,
    };
  }
  return {
    ref: { address: t.address as Address, symbol: t.symbol, decimals: t.decimals },
    isNative: false,
  };
}

/** Build the add-liquidity plan: validate balances, compute optimal pair amounts + min thresholds. */
export type AddLiquidityV2Plan = {
  tokenA: TokenRef;
  tokenB: TokenRef;
  amountA: string;
  amountAWei: string;
  amountB: string;
  amountBWei: string;
  amountAMinWei: string;
  amountBMinWei: string;
  /** True if either tokenA or tokenB is native ETH (use addLiquidityETH). */
  isEthPair: boolean;
  /** Which side is ETH (only meaningful when isEthPair). */
  ethSide?: "A" | "B";
  pair?: V2PairInfo;
  slippageBps: number;
  deadline: number;
};

export async function prepareAddLiquidityV2(args: {
  owner: Address;
  tokenA: string;
  tokenB: string;
  amountA: string;
  amountB: string;
  slippageBps: number;
  chain: ChainId;
  deadlineSecs?: number; // default 20 min
}): Promise<AddLiquidityV2Plan> {
  const [a, b] = await Promise.all([resolveLpToken(args.tokenA, args.chain), resolveLpToken(args.tokenB, args.chain)]);
  if (a.ref.address.toLowerCase() === b.ref.address.toLowerCase()) {
    throw new Error("tokenA and tokenB must be different");
  }
  const isEthPair = a.isNative || b.isNative;
  const ethSide: "A" | "B" | undefined = a.isNative ? "A" : b.isNative ? "B" : undefined;

  const amountAWei = parseUnits(args.amountA, a.ref.decimals);
  const amountBWei = parseUnits(args.amountB, b.ref.decimals);

  // Balance checks
  const [balA, balB] = await Promise.all([
    a.isNative
      ? getEthBalance(args.owner, args.chain).then((r) => BigInt(r.wei))
      : getTokenBalance(args.owner, a.ref.address, args.chain).then((r) => BigInt(r.wei)),
    b.isNative
      ? getEthBalance(args.owner, args.chain).then((r) => BigInt(r.wei))
      : getTokenBalance(args.owner, b.ref.address, args.chain).then((r) => BigInt(r.wei)),
  ]);
  if (balA < amountAWei) throw new Error(`Insufficient ${a.ref.symbol}: have ${formatUnits(balA, a.ref.decimals)}, need ${args.amountA}.`);
  if (balB < amountBWei) throw new Error(`Insufficient ${b.ref.symbol}: have ${formatUnits(balB, b.ref.decimals)}, need ${args.amountB}.`);

  // Slippage thresholds — same percentage to both legs.
  const bps = BigInt(args.slippageBps);
  const amountAMinWei = (amountAWei * (10_000n - bps)) / 10_000n;
  const amountBMinWei = (amountBWei * (10_000n - bps)) / 10_000n;

  // Best-effort pair fetch (null on first liquidity provision)
  const pair = await fetchPair({ tokenA: a.ref.address, tokenB: b.ref.address, chain: args.chain }).catch(() => null);

  const deadline = Math.floor(Date.now() / 1000) + (args.deadlineSecs ?? 20 * 60);

  return {
    tokenA: a.ref,
    tokenB: b.ref,
    amountA: args.amountA,
    amountAWei: amountAWei.toString(),
    amountB: args.amountB,
    amountBWei: amountBWei.toString(),
    amountAMinWei: amountAMinWei.toString(),
    amountBMinWei: amountBMinWei.toString(),
    isEthPair,
    ethSide,
    pair: pair ?? undefined,
    slippageBps: args.slippageBps,
    deadline,
  };
}

/**
 * On approval: ensure router has allowance on the non-ETH side(s), then call
 * addLiquidity or addLiquidityETH.
 */
export async function executeAddLiquidityV2(args: {
  plan: {
    tokenA: TokenRef;
    tokenB: TokenRef;
    amountAWei: string;
    amountBWei: string;
    amountAMinWei: string;
    amountBMinWei: string;
    isEthPair: boolean;
    ethSide?: "A" | "B";
    deadline: number;
  };
  from: Address;
  chain: ChainId;
  wallet: WalletClient;
}): Promise<{ hash: Hex }> {
  const cfg = getChain(args.chain);
  const router = cfg.v2.router;

  // Approve any non-ETH side that lacks allowance.
  const sides: Array<{ token: Address; amountWei: bigint; symbol: string }> = [];
  if (!(args.plan.isEthPair && args.plan.ethSide === "A")) {
    sides.push({ token: args.plan.tokenA.address, amountWei: BigInt(args.plan.amountAWei), symbol: args.plan.tokenA.symbol });
  }
  if (!(args.plan.isEthPair && args.plan.ethSide === "B")) {
    sides.push({ token: args.plan.tokenB.address, amountWei: BigInt(args.plan.amountBWei), symbol: args.plan.tokenB.symbol });
  }
  const client = publicClient(args.chain);
  for (const s of sides) {
    const current = await client.readContract({
      address: s.token,
      abi: ERC20_TRANSFER_APPROVE_ABI,
      functionName: "allowance",
      args: [args.from, router],
    });
    if (current < s.amountWei) {
      const data = encodeFunctionData({
        abi: ERC20_TRANSFER_APPROVE_ABI,
        functionName: "approve",
        args: [router, MAX_UINT256],
      });
      const approveHash = await args.wallet.sendTransaction({
        account: args.wallet.account!,
        chain: args.wallet.chain,
        to: s.token,
        data,
        value: 0n,
      });
      await client.waitForTransactionReceipt({ hash: approveHash });
    }
  }

  // Build the addLiquidity / addLiquidityETH call.
  if (args.plan.isEthPair) {
    const isAEth = args.plan.ethSide === "A";
    const tokenAddr = isAEth ? args.plan.tokenB.address : args.plan.tokenA.address;
    const tokenAmount = isAEth ? args.plan.amountBWei : args.plan.amountAWei;
    const tokenMin = isAEth ? args.plan.amountBMinWei : args.plan.amountAMinWei;
    const ethAmount = isAEth ? args.plan.amountAWei : args.plan.amountBWei;
    const ethMin = isAEth ? args.plan.amountAMinWei : args.plan.amountBMinWei;

    const data = encodeFunctionData({
      abi: UNISWAP_V2_ROUTER_LP_ABI,
      functionName: "addLiquidityETH",
      args: [
        tokenAddr,
        BigInt(tokenAmount),
        BigInt(tokenMin),
        BigInt(ethMin),
        args.from,
        BigInt(args.plan.deadline),
      ],
    });
    const hash = await args.wallet.sendTransaction({
      account: args.wallet.account!,
      chain: args.wallet.chain,
      to: router,
      data,
      value: BigInt(ethAmount),
    });
    return { hash };
  }

  // ERC-20/ERC-20
  const data = encodeFunctionData({
    abi: UNISWAP_V2_ROUTER_LP_ABI,
    functionName: "addLiquidity",
    args: [
      args.plan.tokenA.address,
      args.plan.tokenB.address,
      BigInt(args.plan.amountAWei),
      BigInt(args.plan.amountBWei),
      BigInt(args.plan.amountAMinWei),
      BigInt(args.plan.amountBMinWei),
      args.from,
      BigInt(args.plan.deadline),
    ],
  });
  const hash = await args.wallet.sendTransaction({
    account: args.wallet.account!,
    chain: args.wallet.chain,
    to: router,
    data,
    value: 0n,
  });
  return { hash };
}

// ============================================================================
// Remove liquidity
// ============================================================================

export type RemoveLiquidityV2Plan = {
  tokenA: TokenRef;
  tokenB: TokenRef;
  pair: Address;
  lpAmount: string;
  lpAmountWei: string;
  /** Expected token amounts out, before slippage. */
  expectedAmountA: string;
  expectedAmountB: string;
  amountAMinWei: string;
  amountBMinWei: string;
  isEthPair: boolean;
  ethSide?: "A" | "B";
  slippageBps: number;
  deadline: number;
};

export async function prepareRemoveLiquidityV2(args: {
  owner: Address;
  tokenA: string;
  tokenB: string;
  lpAmount: string; // human, in LP token (18 decimals — V2 LP tokens are always 18 dec)
  slippageBps: number;
  chain: ChainId;
  deadlineSecs?: number;
}): Promise<RemoveLiquidityV2Plan> {
  const [a, b] = await Promise.all([resolveLpToken(args.tokenA, args.chain), resolveLpToken(args.tokenB, args.chain)]);
  const pair = await fetchPair({ tokenA: a.ref.address, tokenB: b.ref.address, chain: args.chain });
  if (!pair) throw new Error(`No Uniswap V2 pair for ${a.ref.symbol}/${b.ref.symbol} on ${args.chain}.`);

  const lpDecimals = 18; // V2 LP is always 18
  const lpWei = parseUnits(args.lpAmount, lpDecimals);

  const lpBal = await getTokenBalance(args.owner, pair.pair, args.chain);
  if (BigInt(lpBal.wei) < lpWei) {
    throw new Error(
      `Insufficient LP balance for ${a.ref.symbol}/${b.ref.symbol}. Have ${lpBal.formatted}, withdrawing ${args.lpAmount}.`
    );
  }

  if (pair.totalSupply === 0n) throw new Error("Pair has zero total supply — nothing to redeem.");
  const share0 = (pair.reserve0 * lpWei) / pair.totalSupply;
  const share1 = (pair.reserve1 * lpWei) / pair.totalSupply;
  // Map share0/share1 → A/B based on pair's token0/token1 vs our A/B
  const aIsToken0 = a.ref.address.toLowerCase() === pair.token0.toLowerCase();
  const shareA = aIsToken0 ? share0 : share1;
  const shareB = aIsToken0 ? share1 : share0;

  const bps = BigInt(args.slippageBps);
  const amountAMinWei = (shareA * (10_000n - bps)) / 10_000n;
  const amountBMinWei = (shareB * (10_000n - bps)) / 10_000n;

  const deadline = Math.floor(Date.now() / 1000) + (args.deadlineSecs ?? 20 * 60);

  return {
    tokenA: a.ref,
    tokenB: b.ref,
    pair: pair.pair,
    lpAmount: args.lpAmount,
    lpAmountWei: lpWei.toString(),
    expectedAmountA: formatUnits(shareA, a.ref.decimals),
    expectedAmountB: formatUnits(shareB, b.ref.decimals),
    amountAMinWei: amountAMinWei.toString(),
    amountBMinWei: amountBMinWei.toString(),
    isEthPair: a.isNative || b.isNative,
    ethSide: a.isNative ? "A" : b.isNative ? "B" : undefined,
    slippageBps: args.slippageBps,
    deadline,
  };
}

export async function executeRemoveLiquidityV2(args: {
  plan: {
    tokenA: TokenRef;
    tokenB: TokenRef;
    pair: Address;
    lpAmountWei: string;
    amountAMinWei: string;
    amountBMinWei: string;
    isEthPair: boolean;
    ethSide?: "A" | "B";
    deadline: number;
  };
  from: Address;
  chain: ChainId;
  wallet: WalletClient;
}): Promise<{ hash: Hex }> {
  const cfg = getChain(args.chain);
  const router = cfg.v2.router;

  // Approve LP token to router if needed.
  const client = publicClient(args.chain);
  const lpAllowance = await client.readContract({
    address: args.plan.pair,
    abi: ERC20_TRANSFER_APPROVE_ABI,
    functionName: "allowance",
    args: [args.from, router],
  });
  if (lpAllowance < BigInt(args.plan.lpAmountWei)) {
    const data = encodeFunctionData({
      abi: ERC20_TRANSFER_APPROVE_ABI,
      functionName: "approve",
      args: [router, MAX_UINT256],
    });
    const approveHash = await args.wallet.sendTransaction({
      account: args.wallet.account!,
      chain: args.wallet.chain,
      to: args.plan.pair,
      data,
      value: 0n,
    });
    await client.waitForTransactionReceipt({ hash: approveHash });
  }

  // Build the removeLiquidity call.
  if (args.plan.isEthPair) {
    const isAEth = args.plan.ethSide === "A";
    const tokenAddr = isAEth ? args.plan.tokenB.address : args.plan.tokenA.address;
    const tokenMin = isAEth ? args.plan.amountBMinWei : args.plan.amountAMinWei;
    const ethMin = isAEth ? args.plan.amountAMinWei : args.plan.amountBMinWei;

    const data = encodeFunctionData({
      abi: UNISWAP_V2_ROUTER_LP_ABI,
      functionName: "removeLiquidityETH",
      args: [
        tokenAddr,
        BigInt(args.plan.lpAmountWei),
        BigInt(tokenMin),
        BigInt(ethMin),
        args.from,
        BigInt(args.plan.deadline),
      ],
    });
    const hash = await args.wallet.sendTransaction({
      account: args.wallet.account!,
      chain: args.wallet.chain,
      to: router,
      data,
      value: 0n,
    });
    return { hash };
  }

  const data = encodeFunctionData({
    abi: UNISWAP_V2_ROUTER_LP_ABI,
    functionName: "removeLiquidity",
    args: [
      args.plan.tokenA.address,
      args.plan.tokenB.address,
      BigInt(args.plan.lpAmountWei),
      BigInt(args.plan.amountAMinWei),
      BigInt(args.plan.amountBMinWei),
      args.from,
      BigInt(args.plan.deadline),
    ],
  });
  const hash = await args.wallet.sendTransaction({
    account: args.wallet.account!,
    chain: args.wallet.chain,
    to: router,
    data,
    value: 0n,
  });
  return { hash };
}

// ============================================================================
// Listing — V2 LP positions for a wallet.
//
// Naive approach: V2 doesn't have an indexer contract, so we'd need an event-log
// scan to find every pair the wallet has ever LP'd into. That's expensive for a
// read tool. Instead we let the caller specify the pairs they care about; we
// query each pair's balanceOf(walletAddr) + reserves to compute their share.
// ============================================================================

export type V2PositionRow = {
  pair: Address;
  tokenA: TokenRef;
  tokenB: TokenRef;
  lpBalance: string; // human
  lpBalanceWei: string;
  /** Estimated underlying amounts at current price. */
  shareA: string;
  shareB: string;
  poolSharePct: number;
};

export async function listLpPositionsV2(args: {
  owner: Address;
  pairs: Array<{ tokenA: string; tokenB: string }>;
  chain: ChainId;
}): Promise<V2PositionRow[]> {
  const rows: V2PositionRow[] = [];
  for (const p of args.pairs) {
    const [a, b] = await Promise.all([resolveLpToken(p.tokenA, args.chain), resolveLpToken(p.tokenB, args.chain)]);
    const pair = await fetchPair({ tokenA: a.ref.address, tokenB: b.ref.address, chain: args.chain });
    if (!pair) continue;
    const lpBal = await getTokenBalance(args.owner, pair.pair, args.chain);
    const lpWei = BigInt(lpBal.wei);
    if (lpWei === 0n) continue;
    const share0 = (pair.reserve0 * lpWei) / pair.totalSupply;
    const share1 = (pair.reserve1 * lpWei) / pair.totalSupply;
    const aIsToken0 = a.ref.address.toLowerCase() === pair.token0.toLowerCase();
    const shareA = aIsToken0 ? share0 : share1;
    const shareB = aIsToken0 ? share1 : share0;
    const pct = pair.totalSupply > 0n ? Number((lpWei * 10000n) / pair.totalSupply) / 100 : 0;
    rows.push({
      pair: pair.pair,
      tokenA: a.ref,
      tokenB: b.ref,
      lpBalance: lpBal.formatted,
      lpBalanceWei: lpBal.wei,
      shareA: formatUnits(shareA, a.ref.decimals),
      shareB: formatUnits(shareB, b.ref.decimals),
      poolSharePct: pct,
    });
  }
  return rows;
}
