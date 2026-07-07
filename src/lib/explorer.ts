// On-chain history fetcher.
// Two backends, picked per-chain:
//   - Etherscan V2 multichain (free for Ethereum, paid for Base). Used when ETHERSCAN_API_KEY is set
//     AND the chain is supported on the free tier (or the user has paid).
//   - Alchemy `alchemy_getAssetTransfers` (free for both Ethereum and Base — single API call returns
//     external + internal + erc20 transfers). Used as the only path for Base, or as a fallback.
//
// Public API: fetchTokenTransfers, fetchNormalTxs, fetchInternalTxs — chain-aware dispatch.

import { type Address } from "viem";
import { getChain, type ChainId } from "@/lib/chains";

// ---------- public types (canonical shape — both backends normalize into these) ----------

export type TokenTransfer = {
  blockNumber: string;
  timeStamp: string; // unix seconds
  hash: string;
  from: string;
  contractAddress: string;
  to: string;
  value: string; // raw integer
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
};

export type NormalTx = {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string; // wei
  isError: string; // "0" / "1"
};

export type InternalTx = {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string; // wei
  isError: string;
};

export function isExplorerConfigured(): boolean {
  return Boolean(process.env.ETHERSCAN_API_KEY || process.env.ALCHEMY_API_KEY);
}

// ---------- backend selection ----------

function backendFor(chain: ChainId): "etherscan" | "alchemy" {
  // Etherscan V2 free tier only covers Ethereum. Use Alchemy for everything else.
  if (chain === "ethereum" && process.env.ETHERSCAN_API_KEY) return "etherscan";
  if (process.env.ALCHEMY_API_KEY) return "alchemy";
  // Last-resort: Etherscan (will error helpfully if it's a non-free chain)
  if (process.env.ETHERSCAN_API_KEY) return "etherscan";
  throw new Error(
    "No explorer credentials. Set ETHERSCAN_API_KEY (free for Ethereum: https://etherscan.io/myapikey) " +
      "AND/OR ALCHEMY_API_KEY (free for both chains: https://alchemy.com). For Base sync you NEED Alchemy."
  );
}

// ---------- Etherscan V2 multichain ----------

const ETHERSCAN_BASE = "https://api.etherscan.io/v2/api";

async function etherscanGet<T>(chain: ChainId, params: Record<string, string | number>): Promise<T> {
  const url = new URL(ETHERSCAN_BASE);
  url.searchParams.set("chainid", String(getChain(chain).numericId));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("apikey", process.env.ETHERSCAN_API_KEY!);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Etherscan ${params.action} failed: HTTP ${res.status}`);
  const body = (await res.json()) as { status: string; message: string; result: unknown };
  if (body.status === "0" && body.message === "No transactions found") return [] as T;
  if (body.status === "0") {
    throw new Error(
      `Etherscan ${params.action} on ${chain} failed: ${body.message} ${typeof body.result === "string" ? body.result : ""}`
    );
  }
  return body.result as T;
}

// ---------- Alchemy ----------

const ALCHEMY_HOSTS: Record<ChainId, string> = {
  ethereum: "https://eth-mainnet.g.alchemy.com/v2/",
  base: "https://base-mainnet.g.alchemy.com/v2/",
};

type AlchemyTransfer = {
  blockNum: string; // hex
  uniqueId: string;
  hash: string;
  from: string;
  to: string;
  value: number | null; // formatted (decimal-adjusted), nullable for nfts/etc
  asset: string | null;
  category: "external" | "internal" | "erc20" | "erc721" | "erc1155" | "specialnft";
  rawContract: {
    address: string | null;
    decimal: string | null; // hex
    value: string; // hex of raw integer
  };
  metadata: { blockTimestamp: string };
};

async function alchemyRpc<T>(chain: ChainId, method: string, params: unknown[]): Promise<T> {
  const key = process.env.ALCHEMY_API_KEY!;
  const url = ALCHEMY_HOSTS[chain] + key;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Alchemy ${method} failed: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
  if (body.error) throw new Error(`Alchemy ${method} failed: ${body.error.message}`);
  return body.result as T;
}

async function alchemyAssetTransfers(
  chain: ChainId,
  address: string,
  category: "external" | "internal" | "erc20",
  direction: "from" | "to"
): Promise<AlchemyTransfer[]> {
  const all: AlchemyTransfer[] = [];
  let pageKey: string | undefined;
  // Page through all results
  for (let i = 0; i < 10; i++) {
    const params: Record<string, unknown> = {
      fromBlock: "0x0",
      toBlock: "latest",
      category: [category],
      withMetadata: true,
      excludeZeroValue: false,
      maxCount: "0x3e8", // 1000 per page
    };
    if (direction === "from") params.fromAddress = address;
    else params.toAddress = address;
    if (pageKey) params.pageKey = pageKey;
    const result = await alchemyRpc<{ transfers: AlchemyTransfer[]; pageKey?: string }>(
      chain,
      "alchemy_getAssetTransfers",
      [params]
    );
    all.push(...result.transfers);
    if (!result.pageKey) break;
    pageKey = result.pageKey;
  }
  return all;
}

function alchemyToTokenTransfer(t: AlchemyTransfer): TokenTransfer | null {
  if (t.category !== "erc20" || !t.rawContract.address) return null;
  const decimals = t.rawContract.decimal ? parseInt(t.rawContract.decimal, 16) : 18;
  const ts = Math.floor(new Date(t.metadata.blockTimestamp).getTime() / 1000);
  return {
    blockNumber: String(parseInt(t.blockNum, 16)),
    timeStamp: String(ts),
    hash: t.hash,
    from: t.from,
    contractAddress: t.rawContract.address,
    to: t.to,
    value: BigInt(t.rawContract.value).toString(), // raw integer
    tokenName: t.asset ?? "",
    tokenSymbol: t.asset ?? "",
    tokenDecimal: String(decimals),
  };
}

function alchemyToNormalOrInternal(t: AlchemyTransfer): NormalTx | InternalTx {
  const ts = Math.floor(new Date(t.metadata.blockTimestamp).getTime() / 1000);
  return {
    blockNumber: String(parseInt(t.blockNum, 16)),
    timeStamp: String(ts),
    hash: t.hash,
    from: t.from,
    to: t.to,
    value: BigInt(t.rawContract.value).toString(),
    isError: "0", // Alchemy excludes failed txs by default in getAssetTransfers
  };
}

// ---------- public API ----------

export async function fetchTokenTransfers(chain: ChainId, address: string): Promise<TokenTransfer[]> {
  const backend = backendFor(chain);
  if (backend === "etherscan") {
    return etherscanGet<TokenTransfer[]>(chain, {
      module: "account",
      action: "tokentx",
      address,
      startblock: 0,
      endblock: 99999999,
      page: 1,
      offset: 10000,
      sort: "asc",
    });
  }
  // Alchemy: pull both directions and merge
  const [outgoing, incoming] = await Promise.all([
    alchemyAssetTransfers(chain, address, "erc20", "from"),
    alchemyAssetTransfers(chain, address, "erc20", "to"),
  ]);
  const merged = [...outgoing, ...incoming]
    .map(alchemyToTokenTransfer)
    .filter((t): t is TokenTransfer => t !== null);
  // Dedup by uniqueness of (hash, from, to, contractAddress, value)
  const seen = new Set<string>();
  const dedup: TokenTransfer[] = [];
  for (const t of merged) {
    const k = `${t.hash}|${t.from}|${t.to}|${t.contractAddress}|${t.value}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(t);
  }
  return dedup.sort((a, b) => parseInt(a.timeStamp) - parseInt(b.timeStamp));
}

export async function fetchNormalTxs(chain: ChainId, address: string): Promise<NormalTx[]> {
  const backend = backendFor(chain);
  if (backend === "etherscan") {
    return etherscanGet<NormalTx[]>(chain, {
      module: "account",
      action: "txlist",
      address,
      startblock: 0,
      endblock: 99999999,
      page: 1,
      offset: 10000,
      sort: "asc",
    });
  }
  const transfers = await alchemyAssetTransfers(chain, address, "external", "from");
  return transfers
    .filter((t) => t.from.toLowerCase() === address.toLowerCase()) // only the wallet's outbound
    .map(alchemyToNormalOrInternal);
}

export async function fetchInternalTxs(chain: ChainId, address: string): Promise<InternalTx[]> {
  const backend = backendFor(chain);
  if (backend === "etherscan") {
    return etherscanGet<InternalTx[]>(chain, {
      module: "account",
      action: "txlistinternal",
      address,
      startblock: 0,
      endblock: 99999999,
      page: 1,
      offset: 10000,
      sort: "asc",
    });
  }
  const transfers = await alchemyAssetTransfers(chain, address, "internal", "to");
  return transfers
    .filter((t) => t.to.toLowerCase() === address.toLowerCase())
    .map(alchemyToNormalOrInternal);
}
