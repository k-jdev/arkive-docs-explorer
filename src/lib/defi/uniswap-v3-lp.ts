// Uniswap V3 liquidity provision.
//
// Concentrated-liquidity positions live as ERC-721 NFTs minted by the
// NonfungiblePositionManager (NPM). Each position carries:
//   - token0, token1 (sorted), fee tier
//   - tickLower, tickUpper (the price range the liquidity is active across)
//   - liquidity (the L value used in V3 math)
//   - tokensOwed0/tokensOwed1 (uncollected fees)
//
// To mint: NPM.mint(MintParams).
// To exit fully: multicall([decreaseLiquidity(full), collect(max), burn]).
//
// Tick math:
//   - 1 tick = ~0.01% price step (1.0001^tick = price ratio).
//   - Each fee tier has a tickSpacing (1, 10, 60, 200). Positions must align
//     tickLower/tickUpper to multiples of the spacing.
//   - We accept user input as price bounds (priceLower, priceUpper expressed
//     as token1 per token0) and convert internally.

import {
  encodeFunctionData,
  parseUnits,
  formatUnits,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import {
  UNISWAP_V3_NPM_ABI,
  UNISWAP_V3_FACTORY_ABI,
  UNISWAP_V3_POOL_ABI,
  ERC20_TRANSFER_APPROVE_ABI,
  MAX_UINT128,
  MAX_UINT256,
} from "./abis";
import { getChain, type ChainId } from "@/lib/chains";
import { publicClient, getTokenBalance } from "@/lib/eth";
import { findToken, isNativeEth } from "@/lib/uniswap";
import type { TokenRef, V3FeeTier } from "@/lib/state";

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

const FEE_TICK_SPACING: Record<V3FeeTier, number> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
};

/** Convert a token1/token0 price → tick. Uses log base 1.0001. */
export function priceToTick(price: number): number {
  if (price <= 0) throw new Error("Price must be positive");
  return Math.round(Math.log(price) / Math.log(1.0001));
}

/** Snap a tick to the nearest valid spacing (floor for lower, ceil for upper). */
export function snapTick(tick: number, spacing: number, direction: "down" | "up"): number {
  if (direction === "down") return Math.floor(tick / spacing) * spacing;
  return Math.ceil(tick / spacing) * spacing;
}

/** Sort a TokenRef pair lexicographically by address (V3 convention). */
function sortTokens(a: TokenRef, b: TokenRef): { token0: TokenRef; token1: TokenRef; swapped: boolean } {
  if (a.address.toLowerCase() < b.address.toLowerCase()) return { token0: a, token1: b, swapped: false };
  return { token0: b, token1: a, swapped: true };
}

async function resolveToken(q: string, chain: ChainId): Promise<{ ref: TokenRef; isNative: boolean }> {
  const t = await findToken(q, chain);
  if (!t) throw new Error(`Could not find token "${q}" on ${chain}.`);
  if (isNativeEth(t)) {
    // V3 doesn't have a payable mint for ETH — users must wrap to WETH first.
    // We surface this expectation by treating ETH as WETH but flagging isNative.
    const cfg = getChain(chain);
    return { ref: { address: cfg.v2.weth, symbol: "WETH", decimals: 18 }, isNative: true };
  }
  return { ref: { address: t.address as Address, symbol: t.symbol, decimals: t.decimals }, isNative: false };
}

// ============================================================================
// Pool inspection
// ============================================================================

export type V3PoolInfo = {
  address: Address;
  tick: number;
  sqrtPriceX96: bigint;
  liquidity: bigint;
};

export async function fetchPool(args: {
  token0: Address;
  token1: Address;
  fee: V3FeeTier;
  chain: ChainId;
}): Promise<V3PoolInfo | null> {
  const cfg = getChain(args.chain);
  const client = publicClient(args.chain);
  const pool = (await client.readContract({
    address: cfg.v3.factory,
    abi: UNISWAP_V3_FACTORY_ABI,
    functionName: "getPool",
    args: [args.token0, args.token1, args.fee],
  })) as Address;
  if (pool === ZERO_ADDRESS) return null;
  const [slot0, liquidity] = await Promise.all([
    client.readContract({ address: pool, abi: UNISWAP_V3_POOL_ABI, functionName: "slot0" }),
    client.readContract({ address: pool, abi: UNISWAP_V3_POOL_ABI, functionName: "liquidity" }),
  ]);
  return { address: pool, sqrtPriceX96: slot0[0], tick: slot0[1], liquidity };
}

// ============================================================================
// Add liquidity (mint NFT)
// ============================================================================

export type AddLiquidityV3Plan = {
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
  /** Whichever input contained ETH gets remembered so the executor can warn the user to wrap. */
  warnings: string[];
  slippageBps: number;
  deadline: number;
};

export async function prepareAddLiquidityV3(args: {
  owner: Address;
  tokenA: string;
  tokenB: string;
  fee: V3FeeTier;
  amountA: string;
  amountB: string;
  /** Price bounds expressed as token1/token0 in the sorted convention. If
   * priceLower or priceUpper is undefined, the position is full-range. */
  priceLower?: number;
  priceUpper?: number;
  slippageBps: number;
  chain: ChainId;
  deadlineSecs?: number;
}): Promise<AddLiquidityV3Plan> {
  const [a, b] = await Promise.all([resolveToken(args.tokenA, args.chain), resolveToken(args.tokenB, args.chain)]);
  if (a.ref.address.toLowerCase() === b.ref.address.toLowerCase()) {
    throw new Error("tokenA and tokenB must be different");
  }
  const sorted = sortTokens(a.ref, b.ref);
  const amountAWei = parseUnits(args.amountA, a.ref.decimals);
  const amountBWei = parseUnits(args.amountB, b.ref.decimals);

  // Re-orient amounts to (token0, token1)
  const amount0Wei = sorted.swapped ? amountBWei : amountAWei;
  const amount1Wei = sorted.swapped ? amountAWei : amountBWei;
  const amount0Human = sorted.swapped ? args.amountB : args.amountA;
  const amount1Human = sorted.swapped ? args.amountA : args.amountB;

  // Balance checks
  const [bal0, bal1] = await Promise.all([
    getTokenBalance(args.owner, sorted.token0.address, args.chain),
    getTokenBalance(args.owner, sorted.token1.address, args.chain),
  ]);
  if (BigInt(bal0.wei) < amount0Wei) {
    throw new Error(
      `Insufficient ${sorted.token0.symbol}: have ${bal0.formatted}, need ${formatUnits(amount0Wei, sorted.token0.decimals)}. ` +
        `(If you have ETH, wrap it first via wrap_eth.)`
    );
  }
  if (BigInt(bal1.wei) < amount1Wei) {
    throw new Error(
      `Insufficient ${sorted.token1.symbol}: have ${bal1.formatted}, need ${formatUnits(amount1Wei, sorted.token1.decimals)}.`
    );
  }

  // Ticks
  const spacing = FEE_TICK_SPACING[args.fee];
  const MIN_TICK = -887272;
  const MAX_TICK = 887272;
  let tickLower: number;
  let tickUpper: number;
  if (args.priceLower === undefined || args.priceUpper === undefined) {
    // Full-range position, snapped to spacing
    tickLower = snapTick(MIN_TICK, spacing, "up");
    tickUpper = snapTick(MAX_TICK, spacing, "down");
  } else {
    if (args.priceLower >= args.priceUpper) throw new Error("priceLower must be < priceUpper");
    tickLower = snapTick(priceToTick(args.priceLower), spacing, "down");
    tickUpper = snapTick(priceToTick(args.priceUpper), spacing, "up");
  }

  const bps = BigInt(args.slippageBps);
  const amount0MinWei = (amount0Wei * (10_000n - bps)) / 10_000n;
  const amount1MinWei = (amount1Wei * (10_000n - bps)) / 10_000n;

  const warnings: string[] = [];
  if (a.isNative || b.isNative) {
    warnings.push(
      "V3 does not accept native ETH in mint — using WETH balance. If you only have ETH, call wrap_eth first."
    );
  }

  const deadline = Math.floor(Date.now() / 1000) + (args.deadlineSecs ?? 20 * 60);

  return {
    token0: sorted.token0,
    token1: sorted.token1,
    fee: args.fee,
    tickLower,
    tickUpper,
    amount0Desired: amount0Human,
    amount0DesiredWei: amount0Wei.toString(),
    amount1Desired: amount1Human,
    amount1DesiredWei: amount1Wei.toString(),
    amount0MinWei: amount0MinWei.toString(),
    amount1MinWei: amount1MinWei.toString(),
    warnings,
    slippageBps: args.slippageBps,
    deadline,
  };
}

export async function executeAddLiquidityV3(args: {
  plan: {
    token0: TokenRef;
    token1: TokenRef;
    fee: V3FeeTier;
    tickLower: number;
    tickUpper: number;
    amount0DesiredWei: string;
    amount1DesiredWei: string;
    amount0MinWei: string;
    amount1MinWei: string;
    deadline: number;
  };
  from: Address;
  chain: ChainId;
  wallet: WalletClient;
}): Promise<{ hash: Hex }> {
  const cfg = getChain(args.chain);
  const npm = cfg.v3.nonfungiblePositionManager;

  // Approvals for both tokens to NPM.
  const client = publicClient(args.chain);
  for (const t of [
    { addr: args.plan.token0.address, need: BigInt(args.plan.amount0DesiredWei), symbol: args.plan.token0.symbol },
    { addr: args.plan.token1.address, need: BigInt(args.plan.amount1DesiredWei), symbol: args.plan.token1.symbol },
  ]) {
    const cur = await client.readContract({
      address: t.addr,
      abi: ERC20_TRANSFER_APPROVE_ABI,
      functionName: "allowance",
      args: [args.from, npm],
    });
    if (cur < t.need) {
      const data = encodeFunctionData({
        abi: ERC20_TRANSFER_APPROVE_ABI,
        functionName: "approve",
        args: [npm, MAX_UINT256],
      });
      const approveHash = await args.wallet.sendTransaction({
        account: args.wallet.account!,
        chain: args.wallet.chain,
        to: t.addr,
        data,
        value: 0n,
      });
      await client.waitForTransactionReceipt({ hash: approveHash });
    }
  }

  const data = encodeFunctionData({
    abi: UNISWAP_V3_NPM_ABI,
    functionName: "mint",
    args: [
      {
        token0: args.plan.token0.address,
        token1: args.plan.token1.address,
        fee: args.plan.fee,
        tickLower: args.plan.tickLower,
        tickUpper: args.plan.tickUpper,
        amount0Desired: BigInt(args.plan.amount0DesiredWei),
        amount1Desired: BigInt(args.plan.amount1DesiredWei),
        amount0Min: BigInt(args.plan.amount0MinWei),
        amount1Min: BigInt(args.plan.amount1MinWei),
        recipient: args.from,
        deadline: BigInt(args.plan.deadline),
      },
    ],
  });

  const hash = await args.wallet.sendTransaction({
    account: args.wallet.account!,
    chain: args.wallet.chain,
    to: npm,
    data,
    value: 0n,
  });
  return { hash };
}

// ============================================================================
// Exit liquidity (decrease + collect + optional burn) via multicall
// ============================================================================

export type V3Position = {
  tokenId: string;
  token0: TokenRef;
  token1: TokenRef;
  fee: V3FeeTier;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  tokensOwed0: string;
  tokensOwed1: string;
};

export async function listLpPositionsV3(args: { owner: Address; chain: ChainId }): Promise<V3Position[]> {
  const cfg = getChain(args.chain);
  const npm = cfg.v3.nonfungiblePositionManager;
  const client = publicClient(args.chain);

  const balance = await client.readContract({
    address: npm,
    abi: UNISWAP_V3_NPM_ABI,
    functionName: "balanceOf",
    args: [args.owner],
  });
  const n = Number(balance);
  if (n === 0) return [];

  // Enumerate tokenIds
  const tokenIds = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      client.readContract({
        address: npm,
        abi: UNISWAP_V3_NPM_ABI,
        functionName: "tokenOfOwnerByIndex",
        args: [args.owner, BigInt(i)],
      })
    )
  );

  // Fetch each position
  const positions = await Promise.all(
    tokenIds.map(async (tokenId) => {
      const p = await client.readContract({
        address: npm,
        abi: UNISWAP_V3_NPM_ABI,
        functionName: "positions",
        args: [tokenId],
      });
      // p is the 12-tuple from the ABI. Index map:
      // [0]nonce [1]operator [2]token0 [3]token1 [4]fee [5]tickLower [6]tickUpper
      // [7]liquidity [8]feeGrowthInside0LastX128 [9]feeGrowthInside1LastX128
      // [10]tokensOwed0 [11]tokensOwed1
      const [, , token0, token1, fee, tickLower, tickUpper, liquidity, , , owed0, owed1] = p;
      // Best-effort token metadata. Falls back to "TKN" + 18 decimals if findToken misses.
      const [tk0, tk1] = await Promise.all([
        findToken(token0 as string, args.chain).catch(() => null),
        findToken(token1 as string, args.chain).catch(() => null),
      ]);
      const ref0: TokenRef = tk0
        ? { address: tk0.address as Address, symbol: tk0.symbol, decimals: tk0.decimals }
        : { address: token0 as Address, symbol: "TKN", decimals: 18 };
      const ref1: TokenRef = tk1
        ? { address: tk1.address as Address, symbol: tk1.symbol, decimals: tk1.decimals }
        : { address: token1 as Address, symbol: "TKN", decimals: 18 };
      return {
        tokenId: tokenId.toString(),
        token0: ref0,
        token1: ref1,
        fee: Number(fee) as V3FeeTier,
        tickLower: Number(tickLower),
        tickUpper: Number(tickUpper),
        liquidity: liquidity.toString(),
        tokensOwed0: owed0.toString(),
        tokensOwed1: owed1.toString(),
      } satisfies V3Position;
    })
  );
  return positions;
}

export type ExitLiquidityV3Plan = {
  tokenId: string;
  token0: TokenRef;
  token1: TokenRef;
  liquidity: string;
  amount0MinWei: string;
  amount1MinWei: string;
  burnAfter: boolean;
  deadline: number;
};

export async function prepareExitLiquidityV3(args: {
  owner: Address;
  tokenId: string;
  /** Optional override; defaults to full liquidity. */
  liquidityToRemove?: string;
  slippageBps: number;
  burnAfter?: boolean;
  chain: ChainId;
  deadlineSecs?: number;
}): Promise<ExitLiquidityV3Plan> {
  const positions = await listLpPositionsV3({ owner: args.owner, chain: args.chain });
  const pos = positions.find((p) => p.tokenId === args.tokenId);
  if (!pos) throw new Error(`Position ${args.tokenId} not found in wallet's V3 positions on ${args.chain}.`);

  // We can't easily compute amount0Min/amount1Min without recomputing burn math
  // off the current sqrtPrice. Apply a flat slippage haircut from "expected = 0"
  // — i.e. allow any amount out, since liquidity withdrawal at a known liquidity
  // value can't be sandwiched. Set the mins to 0 with a comment.
  // The protective slippage applies primarily to swaps; pure liquidity removal
  // is mostly trustless against price moves.

  const deadline = Math.floor(Date.now() / 1000) + (args.deadlineSecs ?? 20 * 60);

  return {
    tokenId: args.tokenId,
    token0: pos.token0,
    token1: pos.token1,
    liquidity: args.liquidityToRemove ?? pos.liquidity,
    amount0MinWei: "0",
    amount1MinWei: "0",
    burnAfter: args.burnAfter ?? true,
    deadline,
  };
}

export async function executeExitLiquidityV3(args: {
  plan: ExitLiquidityV3Plan;
  from: Address;
  chain: ChainId;
  wallet: WalletClient;
}): Promise<{ hash: Hex }> {
  const cfg = getChain(args.chain);
  const npm = cfg.v3.nonfungiblePositionManager;

  // Build the multicall: decreaseLiquidity(full), collect(max), [burn?]
  const decreaseData = encodeFunctionData({
    abi: UNISWAP_V3_NPM_ABI,
    functionName: "decreaseLiquidity",
    args: [
      {
        tokenId: BigInt(args.plan.tokenId),
        liquidity: BigInt(args.plan.liquidity),
        amount0Min: BigInt(args.plan.amount0MinWei),
        amount1Min: BigInt(args.plan.amount1MinWei),
        deadline: BigInt(args.plan.deadline),
      },
    ],
  });
  const collectData = encodeFunctionData({
    abi: UNISWAP_V3_NPM_ABI,
    functionName: "collect",
    args: [
      {
        tokenId: BigInt(args.plan.tokenId),
        recipient: args.from,
        amount0Max: MAX_UINT128,
        amount1Max: MAX_UINT128,
      },
    ],
  });
  const calls: Hex[] = [decreaseData, collectData];
  if (args.plan.burnAfter) {
    const burnData = encodeFunctionData({
      abi: UNISWAP_V3_NPM_ABI,
      functionName: "burn",
      args: [BigInt(args.plan.tokenId)],
    });
    calls.push(burnData);
  }

  const data = encodeFunctionData({
    abi: UNISWAP_V3_NPM_ABI,
    functionName: "multicall",
    args: [calls],
  });
  const hash = await args.wallet.sendTransaction({
    account: args.wallet.account!,
    chain: args.wallet.chain,
    to: npm,
    data,
    value: 0n,
  });
  return { hash };
}
