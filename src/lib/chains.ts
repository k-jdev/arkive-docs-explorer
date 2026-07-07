// Chain registry. Adding a new EVM chain = add an entry here + (optional) tweak any
// chain-specific quirks in the call sites.
import { mainnet, base } from "viem/chains";
import type { Address, Chain as ViemChain } from "viem";

export type ChainId = "ethereum" | "base";

export type ChainConfig = {
  id: ChainId;
  numericId: 1 | 8453;
  name: string;
  explorer: string;
  defaultRpc: string;
  rpcEnvVar: string;
  viem: ViemChain;
  // Uniswap V2 deployment
  v2: {
    router: Address;
    factory: Address;
    weth: Address;
    /** Native USDC for USD pricing. */
    usdc: { address: Address; decimals: number };
  };
  // Uniswap V3 deployment (NonfungiblePositionManager + factory).
  // Same address on Ethereum and Base for both contracts (canonical Uniswap V3 deploy).
  v3: {
    factory: Address;
    nonfungiblePositionManager: Address;
    quoter: Address;
  };
  /** Tokens that count as "base" assets for trade-side classification (PnL). Order = preference. */
  baseAssets: ReadonlyArray<{ symbol: string; address: Address; decimals: number }>;
};

// Canonical Uniswap V3 addresses — same on all supported EVM chains as of writing.
const V3_FACTORY: Address = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const V3_NPM: Address = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const V3_QUOTER_ETH: Address = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const V3_QUOTER_BASE: Address = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";

const ETH_USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ETH_WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const ETH_USDT: Address = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const ETH_DAI: Address = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const ETH_WBTC: Address = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";

const BASE_USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_WETH: Address = "0x4200000000000000000000000000000000000006";
// USDbC = older bridged USDC, still has liquidity on Base — useful as fallback base
const BASE_USDBC: Address = "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA";

export const CHAINS: Record<ChainId, ChainConfig> = {
  ethereum: {
    id: "ethereum",
    numericId: 1,
    name: "Ethereum",
    explorer: "https://etherscan.io",
    defaultRpc: "https://ethereum-rpc.publicnode.com",
    rpcEnvVar: "ETH_RPC_URL",
    viem: mainnet,
    v2: {
      router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
      factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
      weth: ETH_WETH,
      usdc: { address: ETH_USDC, decimals: 6 },
    },
    v3: {
      factory: V3_FACTORY,
      nonfungiblePositionManager: V3_NPM,
      quoter: V3_QUOTER_ETH,
    },
    baseAssets: [
      { symbol: "USDC", address: ETH_USDC, decimals: 6 },
      { symbol: "USDT", address: ETH_USDT, decimals: 6 },
      { symbol: "DAI", address: ETH_DAI, decimals: 18 },
      { symbol: "WETH", address: ETH_WETH, decimals: 18 },
      { symbol: "WBTC", address: ETH_WBTC, decimals: 8 },
    ],
  },
  base: {
    id: "base",
    numericId: 8453,
    name: "Base",
    explorer: "https://basescan.org",
    defaultRpc: "https://base-rpc.publicnode.com",
    rpcEnvVar: "BASE_RPC_URL",
    viem: base,
    v2: {
      router: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
      factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
      weth: BASE_WETH,
      usdc: { address: BASE_USDC, decimals: 6 },
    },
    v3: {
      // Base V3 deployment uses Base-specific factory/NPM addresses, not the
      // canonical Ethereum ones. Source: https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments
      factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
      nonfungiblePositionManager: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
      quoter: V3_QUOTER_BASE,
    },
    baseAssets: [
      { symbol: "USDC", address: BASE_USDC, decimals: 6 },
      { symbol: "USDbC", address: BASE_USDBC, decimals: 6 },
      { symbol: "WETH", address: BASE_WETH, decimals: 18 },
    ],
  },
};

export function getChain(id: ChainId): ChainConfig {
  const c = CHAINS[id];
  if (!c) throw new Error(`Unknown chain: ${id}`);
  return c;
}

export function rpcUrl(chain: ChainConfig): string {
  return process.env[chain.rpcEnvVar] || chain.defaultRpc;
}

export const ALL_CHAINS: ChainId[] = ["ethereum", "base"];
