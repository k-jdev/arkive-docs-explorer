// Uniswap V2 swap helpers — chain-aware (Ethereum mainnet + Base).
// Fully on-chain, no API key, no KYC.
// Docs: https://docs.uniswap.org/contracts/v2/reference/smart-contracts/router-02

import {
  encodeFunctionData,
  parseUnits,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import { publicClient } from "@/lib/eth";
import { getChain, type ChainId } from "@/lib/chains";

// ---------- ABIs (only the bits we use) ----------

const ROUTER_ABI = [
  {
    type: "function",
    name: "getAmountsOut",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactETHForTokensSupportingFeeOnTransferTokens",
    stateMutability: "payable",
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "swapExactTokensForTokensSupportingFeeOnTransferTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "swapExactTokensForETHSupportingFeeOnTransferTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const FACTORY_ABI = [
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    outputs: [{ name: "pair", type: "address" }],
  },
] as const;

const PAIR_ABI = [
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const ERC20_META_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

const ZERO: Address = "0x0000000000000000000000000000000000000000";

// ---------- exposed addresses (chain-aware) ----------

export function wethAddress(chain: ChainId): Address {
  return getChain(chain).v2.weth;
}
export function routerAddress(chain: ChainId): Address {
  return getChain(chain).v2.router;
}
export function factoryAddress(chain: ChainId): Address {
  return getChain(chain).v2.factory;
}

// ---------- token list (Uniswap default, public CDN, no auth, multi-chain) ----------

export type TokenInfo = {
  chainId: number;
  chain: ChainId;
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
};

type RawListedToken = {
  chainId: number;
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
};

let _tokenCache: { fetchedAt: number; byChain: Map<ChainId, RawListedToken[]> } | undefined;
const TOKEN_TTL_MS = 1000 * 60 * 60;

async function loadTokens(chain: ChainId): Promise<RawListedToken[]> {
  const fresh = _tokenCache && Date.now() - _tokenCache.fetchedAt < TOKEN_TTL_MS;
  if (!fresh) {
    const res = await fetch("https://tokens.uniswap.org/", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load Uniswap token list (${res.status})`);
    const data = (await res.json()) as { tokens: RawListedToken[] };
    const byChain = new Map<ChainId, RawListedToken[]>();
    byChain.set("ethereum", data.tokens.filter((t) => t.chainId === 1));
    byChain.set("base", data.tokens.filter((t) => t.chainId === 8453));
    _tokenCache = { fetchedAt: Date.now(), byChain };
  }
  return _tokenCache!.byChain.get(chain) ?? [];
}

async function readTokenMetadata(address: Address, chain: ChainId): Promise<TokenInfo> {
  const [decimals, symbol, name] = await Promise.all([
    publicClient(chain).readContract({ address, abi: ERC20_META_ABI, functionName: "decimals" }),
    publicClient(chain).readContract({ address, abi: ERC20_META_ABI, functionName: "symbol" }),
    publicClient(chain).readContract({ address, abi: ERC20_META_ABI, functionName: "name" }),
  ]);
  return {
    chainId: getChain(chain).numericId,
    chain,
    address,
    decimals: decimals as number,
    symbol: symbol as string,
    name: name as string,
  };
}

export async function findToken(query: string, chain: ChainId = "ethereum"): Promise<TokenInfo | undefined> {
  const cfg = getChain(chain);
  const q = query.trim();
  if (q.toLowerCase() === "eth") {
    return {
      chainId: cfg.numericId,
      chain,
      address: cfg.v2.weth,
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
    };
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
    try {
      return await readTokenMetadata(q as Address, chain);
    } catch {
      return undefined;
    }
  }
  const tokens = await loadTokens(chain);
  const lower = q.toLowerCase();
  const exact = tokens.filter((t) => t.symbol.toLowerCase() === lower);
  if (exact.length > 0) {
    const pick = exact.sort((a, b) => a.name.length - b.name.length)[0];
    return { ...pick, chain };
  }
  const nameHits = tokens.filter((t) => t.name.toLowerCase().includes(lower));
  if (nameHits.length === 1) return { ...nameHits[0], chain };
  return undefined;
}

// ---------- routing ----------

export function isNativeEth(t: TokenInfo): boolean {
  return t.symbol === "ETH" && t.address.toLowerCase() === wethAddress(t.chain).toLowerCase();
}

function routedAddress(t: TokenInfo): Address {
  return isNativeEth(t) ? wethAddress(t.chain) : t.address;
}

export async function findPath(src: TokenInfo, dst: TokenInfo): Promise<Address[]> {
  if (src.chain !== dst.chain) throw new Error("Cross-chain swaps are not supported");
  const chain = src.chain;
  const a = routedAddress(src);
  const b = routedAddress(dst);
  if (a.toLowerCase() === b.toLowerCase()) throw new Error("Source and destination tokens are the same");
  const direct: Address[] = [a, b];
  if (await pairExists(a, b, chain)) return direct;
  const weth = wethAddress(chain);
  if (a.toLowerCase() !== weth.toLowerCase() && b.toLowerCase() !== weth.toLowerCase()) {
    if ((await pairExists(a, weth, chain)) && (await pairExists(weth, b, chain))) {
      return [a, weth, b];
    }
  }
  throw new Error(`No Uniswap V2 pool found on ${chain} for ${src.symbol} <-> ${dst.symbol}`);
}

async function pairExists(a: Address, b: Address, chain: ChainId): Promise<boolean> {
  return (await getPairAddress(a, b, chain)) !== ZERO;
}

export async function getPairAddress(a: Address, b: Address, chain: ChainId): Promise<Address> {
  return (await publicClient(chain).readContract({
    address: factoryAddress(chain),
    abi: FACTORY_ABI,
    functionName: "getPair",
    args: [a, b],
  })) as Address;
}

export async function getPairReserves(pair: Address, chain: ChainId) {
  const [reserves, token0, token1] = await Promise.all([
    publicClient(chain).readContract({ address: pair, abi: PAIR_ABI, functionName: "getReserves" }),
    publicClient(chain).readContract({ address: pair, abi: PAIR_ABI, functionName: "token0" }),
    publicClient(chain).readContract({ address: pair, abi: PAIR_ABI, functionName: "token1" }),
  ]);
  const [r0, r1, ts] = reserves as readonly [bigint, bigint, number];
  return { token0: token0 as Address, token1: token1 as Address, reserve0: r0, reserve1: r1, blockTimestampLast: ts };
}

/**
 * USD price of one whole token via Uniswap V2 — LIQUIDITY-GATED.
 *
 * The naive version returns the spot quote from any pool that exists, no matter
 * how thin. A scammer who pairs 1 SCAM with 0.0001 WETH gets a "price" of
 * tens of thousands of dollars per token — multiplied by the airdropped balance,
 * the user's portfolio appears to hold millions in worthless tokens.
 *
 * Fix: require the routing pool to hold AT LEAST `minQuoteUsd` of liquidity on
 * the quote side (USDC for direct pairs, WETH-valued-in-USD for routed pairs).
 * Returns null if the floor isn't met. Caller (computePositions, etc.) treats
 * a null price as "unpriced" and excludes it from totals.
 *
 * Threshold defaults to $500 — high enough to filter dust pools, low enough to
 * include most legitimate low-cap tokens. Tunable via user profile.
 */
export async function priceUsd(token: TokenInfo, minQuoteUsd: number = 500): Promise<number | null> {
  const cfg = getChain(token.chain);
  const usdcAddr = cfg.v2.usdc.address.toLowerCase();
  const wethAddr = cfg.v2.weth.toLowerCase();
  if (token.address.toLowerCase() === usdcAddr) return 1;

  try {
    // ---------- prefer the direct token/USDC pool ----------
    const directPair = await getPairAddress(token.address as Address, cfg.v2.usdc.address, token.chain);
    if (directPair !== ZERO) {
      const res = await getPairReserves(directPair, token.chain);
      const usdcReserveWei = res.token0.toLowerCase() === usdcAddr ? res.reserve0 : res.reserve1;
      const usdcReserveUsd = Number(formatUnits(usdcReserveWei, cfg.v2.usdc.decimals));
      if (usdcReserveUsd >= minQuoteUsd) {
        const usdc: TokenInfo = mkTokenInfo(cfg, cfg.v2.usdc.address, "USDC", cfg.v2.usdc.decimals);
        const q = await quoteExactIn({ src: token, dst: usdc, amount: "1" });
        return Number(q.amountOutFormatted);
      }
    }

    // ---------- fall through to token/WETH → WETH/USDC ----------
    if (token.address.toLowerCase() !== wethAddr) {
      const wethPair = await getPairAddress(token.address as Address, cfg.v2.weth, token.chain);
      if (wethPair !== ZERO) {
        const res = await getPairReserves(wethPair, token.chain);
        const wethReserveWei = res.token0.toLowerCase() === wethAddr ? res.reserve0 : res.reserve1;
        const wethReserveEth = Number(formatUnits(wethReserveWei, 18));
        // Need an ETH price to convert the WETH reserve into a USD floor. If the
        // WETH/USDC pool itself is broken we'd loop, so we read its reserves
        // directly rather than recursing.
        const ethPrice = await ethPriceFromPool(token.chain);
        if (!ethPrice) return null;
        const wethReserveUsd = wethReserveEth * ethPrice;
        if (wethReserveUsd >= minQuoteUsd) {
          const usdc: TokenInfo = mkTokenInfo(cfg, cfg.v2.usdc.address, "USDC", cfg.v2.usdc.decimals);
          const q = await quoteExactIn({ src: token, dst: usdc, amount: "1" });
          return Number(q.amountOutFormatted);
        }
      }
    }

    // No pool met the liquidity floor.
    return null;
  } catch {
    return null;
  }
}

function mkTokenInfo(cfg: ReturnType<typeof getChain>, addr: Address, symbol: string, decimals: number): TokenInfo {
  return {
    chainId: cfg.numericId,
    chain: cfg.id,
    address: addr,
    symbol,
    name: symbol,
    decimals,
  };
}

/** Direct ETH/USD price from the WETH/USDC pool reserves. Avoids recursing into priceUsd. */
async function ethPriceFromPool(chain: ChainId): Promise<number | null> {
  const cfg = getChain(chain);
  try {
    const pair = await getPairAddress(cfg.v2.weth, cfg.v2.usdc.address, chain);
    if (pair === ZERO) return null;
    const res = await getPairReserves(pair, chain);
    const wethIsToken0 = res.token0.toLowerCase() === cfg.v2.weth.toLowerCase();
    const wethReserve = wethIsToken0 ? res.reserve0 : res.reserve1;
    const usdcReserve = wethIsToken0 ? res.reserve1 : res.reserve0;
    const wethF = Number(formatUnits(wethReserve, 18));
    const usdcF = Number(formatUnits(usdcReserve, cfg.v2.usdc.decimals));
    if (wethF === 0) return null;
    return usdcF / wethF;
  } catch {
    return null;
  }
}

export type Quote = {
  src: TokenInfo;
  dst: TokenInfo;
  path: Address[];
  amountInWei: bigint;
  amountOutWei: bigint;
  amountOutFormatted: string;
};

export async function quoteExactIn(args: { src: TokenInfo; dst: TokenInfo; amount: string }): Promise<Quote> {
  if (args.src.chain !== args.dst.chain) throw new Error("Cross-chain swaps are not supported");
  const chain = args.src.chain;
  const path = await findPath(args.src, args.dst);
  const amountInWei = parseUnits(args.amount, args.src.decimals);
  const amounts = (await publicClient(chain).readContract({
    address: routerAddress(chain),
    abi: ROUTER_ABI,
    functionName: "getAmountsOut",
    args: [amountInWei, path],
  })) as readonly bigint[];
  const out = amounts[amounts.length - 1];
  return {
    src: args.src,
    dst: args.dst,
    path,
    amountInWei,
    amountOutWei: out,
    amountOutFormatted: formatUnits(out, args.dst.decimals),
  };
}

export type BuiltSwap = {
  to: Address;
  data: Hex;
  value: bigint;
  amountOutMin: bigint;
  path: Address[];
};

export function buildSwap(args: {
  src: TokenInfo;
  dst: TokenInfo;
  path: Address[];
  amountInWei: bigint;
  amountOutWei: bigint;
  recipient: Address;
  slippageBps: number;
  deadlineSeconds?: number;
}): BuiltSwap {
  if (args.src.chain !== args.dst.chain) throw new Error("Cross-chain swaps are not supported");
  const chain = args.src.chain;
  const slip = BigInt(10_000 - args.slippageBps);
  const amountOutMin = (args.amountOutWei * slip) / 10_000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + (args.deadlineSeconds ?? 600));
  const router = routerAddress(chain);

  if (isNativeEth(args.src)) {
    const data = encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
      args: [amountOutMin, args.path, args.recipient, deadline],
    });
    return { to: router, data, value: args.amountInWei, amountOutMin, path: args.path };
  }
  if (isNativeEth(args.dst)) {
    const data = encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
      args: [args.amountInWei, amountOutMin, args.path, args.recipient, deadline],
    });
    return { to: router, data, value: 0n, amountOutMin, path: args.path };
  }
  const data = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens",
    args: [args.amountInWei, amountOutMin, args.path, args.recipient, deadline],
  });
  return { to: router, data, value: 0n, amountOutMin, path: args.path };
}
