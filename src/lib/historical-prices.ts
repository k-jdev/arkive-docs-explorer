// Defillama historical price API — free, no auth.
// Docs: https://defillama.com/docs/api  (coins/historical endpoint)
//
// Coin format: "<chain>:<address>" — e.g. "ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" (WETH)
// For native ETH on Ethereum: "coingecko:ethereum"  (or use WETH addr)

import type { Address } from "viem";
import type { ChainId } from "@/lib/chains";

const ENDPOINT = "https://coins.llama.fi/prices/historical";

const CHAIN_NAME: Record<ChainId, string> = {
  ethereum: "ethereum",
  base: "base",
};

function coinKey(chain: ChainId, address: Address): string {
  return `${CHAIN_NAME[chain]}:${address.toLowerCase()}`;
}

type HistoricalResponse = {
  coins: Record<
    string,
    {
      decimals?: number;
      symbol?: string;
      price?: number;
      timestamp?: number;
      confidence?: number;
    }
  >;
};

/**
 * Get USD price of a token at a specific UNIX timestamp (seconds).
 * Returns null if no price is available (defillama returns empty `coins` for unknown tokens).
 */
export async function priceAt(chain: ChainId, address: Address, unixSeconds: number): Promise<number | null> {
  const key = coinKey(chain, address);
  const url = `${ENDPOINT}/${unixSeconds}/${key}?searchWidth=4h`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Defillama returned ${res.status}`);
  const body = (await res.json()) as HistoricalResponse;
  const entry = body.coins[key];
  return entry?.price ?? null;
}

/** Batch convenience — returns map keyed by lowercased address. */
export async function pricesAt(
  chain: ChainId,
  addresses: Address[],
  unixSeconds: number
): Promise<Record<string, number | null>> {
  if (addresses.length === 0) return {};
  const keys = addresses.map((a) => coinKey(chain, a));
  const url = `${ENDPOINT}/${unixSeconds}/${keys.join(",")}?searchWidth=4h`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Defillama returned ${res.status}`);
  const body = (await res.json()) as HistoricalResponse;
  const out: Record<string, number | null> = {};
  for (const a of addresses) {
    const k = coinKey(chain, a);
    out[a.toLowerCase()] = body.coins[k]?.price ?? null;
  }
  return out;
}
