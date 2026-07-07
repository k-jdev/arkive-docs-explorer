// Reconstruct trade history from on-chain data — UNIVERSAL detection.
// Strategy:
//   1. Pull ERC-20 transfers (Etherscan tokentx) for the wallet.
//   2. Pull regular ETH-value txs (txlist) — for ETH the wallet sent.
//   3. Pull internal txs (txlistinternal) — for ETH the wallet received from contracts.
//   4. Group by tx hash. For each tx, build a NET asset-flow map:
//      net[asset] = (incoming amount) - (outgoing amount)
//      where assets include native ETH and every ERC-20 contract address.
//   5. Classify as a swap iff there's at least one asset with net < 0 (input)
//      AND at least one DIFFERENT asset with net > 0 (output).
//      This is router-agnostic — works for Uniswap, 1inch, Maestro, Banana Gun,
//      0x, CowSwap, Aerodrome, custom MEV bots, anything.
//   6. Skip wrap/unwrap (ETH ↔ WETH same wallet) — same economic asset.
//   7. Pick the largest input + largest output by absolute net.
//   8. Look up historical USD price (Defillama) for the BASE side at tx timestamp.
//   9. Hand off to recordTrade() with explicit baseUsdPriceOverride + executedAt.
//
// Idempotent: dedups on txHash.

import type { Address, Hex } from "viem";
import { getChain, type ChainId, ALL_CHAINS } from "@/lib/chains";
import { fetchTokenTransfers, fetchNormalTxs, fetchInternalTxs, type TokenTransfer } from "@/lib/explorer";
import { priceAt } from "@/lib/historical-prices";
import { recordTrade } from "@/lib/trades";
import * as uniswap from "@/lib/uniswap";

const NATIVE_KEY = "native:eth";
const NATIVE_PSEUDO_ADDR: Address = "0x0000000000000000000000000000000000000000";

function tokenInfoFromTransfer(t: TokenTransfer) {
  return {
    address: t.contractAddress as Address,
    symbol: t.tokenSymbol,
    decimals: parseInt(t.tokenDecimal, 10),
  };
}

function formatRaw(raw: string, decimals: number): string {
  // Format big-int string with decimals — avoids precision loss.
  if (decimals === 0) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, -decimals);
  let fracPart = padded.slice(-decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

export type SyncResult = {
  chain: ChainId;
  wallet: Address;
  scanned: number;
  recorded: number;
  skippedDuplicates: number;
  skippedNonSwap: number;
  skippedWrapUnwrap: number;
  skippedNoBase: number;
  skippedNoUsdPrice: number;
  errors: string[];
};

export async function syncWalletFromChain(args: {
  walletId: string;
  walletAddress: Address;
  chain: ChainId;
  /** Lower bound on tx timestamp (UNIX seconds). Defaults to 0 (all time). */
  sinceUnixSec?: number;
}): Promise<SyncResult> {
  const { walletId, walletAddress, chain } = args;
  const since = args.sinceUnixSec ?? 0;
  const out: SyncResult = {
    chain,
    wallet: walletAddress,
    scanned: 0,
    recorded: 0,
    skippedDuplicates: 0,
    skippedNonSwap: 0,
    skippedWrapUnwrap: 0,
    skippedNoBase: 0,
    skippedNoUsdPrice: 0,
    errors: [],
  };

  const lowerWallet = walletAddress.toLowerCase();
  const wethLower = uniswap.wethAddress(chain).toLowerCase();

  // Pull all three sources in parallel
  const [tokenTxs, normalTxs, internalTxs] = await Promise.all([
    fetchTokenTransfers(chain, walletAddress),
    fetchNormalTxs(chain, walletAddress),
    fetchInternalTxs(chain, walletAddress),
  ]);

  // Group token transfers by hash
  const tokenByHash = new Map<string, TokenTransfer[]>();
  for (const t of tokenTxs) {
    if (parseInt(t.timeStamp, 10) < since) continue;
    if (!tokenByHash.has(t.hash)) tokenByHash.set(t.hash, []);
    tokenByHash.get(t.hash)!.push(t);
  }
  // Index normal/internal txs by hash for O(1) lookup
  const normalByHash = new Map(normalTxs.filter((t) => t.isError === "0").map((t) => [t.hash, t]));
  const internalByHash = new Map<string, typeof internalTxs>();
  for (const t of internalTxs) {
    if (t.isError !== "0") continue;
    if (!internalByHash.has(t.hash)) internalByHash.set(t.hash, []);
    internalByHash.get(t.hash)!.push(t);
  }

  out.scanned = tokenByHash.size;

  for (const [hash, transfers] of tokenByHash) {
    try {
      const normal = normalByHash.get(hash);
      const internalList = internalByHash.get(hash) ?? [];

      // Build NET asset-flow map: positive = wallet received, negative = wallet sent.
      // Universal — no router whitelist. Works for any executor (Uniswap, 1inch,
      // Maestro, Banana Gun, MEV bots, custom relayers, future routers).
      const net = new Map<string, bigint>();
      // Per-asset metadata (symbol/decimals) cached as we encounter transfers
      const meta = new Map<string, { address: Address; symbol: string; decimals: number }>();

      const bump = (key: string, delta: bigint) => {
        net.set(key, (net.get(key) ?? 0n) + delta);
      };

      // ETH legs
      const ethOutWei =
        normal && normal.from.toLowerCase() === lowerWallet && normal.value !== "0"
          ? BigInt(normal.value)
          : 0n;
      const ethInWei = internalList
        .filter((t) => t.to.toLowerCase() === lowerWallet)
        .reduce((sum, t) => sum + BigInt(t.value), 0n);
      if (ethOutWei > 0n) bump(NATIVE_KEY, -ethOutWei);
      if (ethInWei > 0n) bump(NATIVE_KEY, ethInWei);
      if (ethOutWei > 0n || ethInWei > 0n) {
        meta.set(NATIVE_KEY, { address: uniswap.wethAddress(chain), symbol: "ETH", decimals: 18 });
      }

      // ERC-20 legs
      for (const t of transfers) {
        const isOut = t.from.toLowerCase() === lowerWallet;
        const isIn = t.to.toLowerCase() === lowerWallet;
        if (!isOut && !isIn) continue; // wallet not party to this transfer
        const key = t.contractAddress.toLowerCase();
        const amount = BigInt(t.value);
        if (isOut) bump(key, -amount);
        if (isIn) bump(key, amount);
        if (!meta.has(key)) {
          meta.set(key, {
            address: t.contractAddress as Address,
            symbol: t.tokenSymbol,
            decimals: parseInt(t.tokenDecimal, 10),
          });
        }
      }

      // Identify net inputs (wallet spent) and outputs (wallet received).
      // Net == 0 means refunded fully — neither input nor output for PnL purposes.
      const inputs = [...net.entries()].filter(([, v]) => v < 0n);
      const outputs = [...net.entries()].filter(([, v]) => v > 0n);
      if (inputs.length === 0 || outputs.length === 0) {
        out.skippedNonSwap++;
        continue;
      }

      // Pick the largest by absolute net (handles multi-token zaps / fee refunds gracefully)
      inputs.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)); // most negative first
      outputs.sort((a, b) => (a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0)); // most positive first
      const [inKey, inNet] = inputs[0];
      const [outKey, outNet] = outputs[0];

      // Skip wrap/unwrap (ETH ↔ WETH on the same wallet — no economic change)
      const isWrap = inKey === NATIVE_KEY && outKey === wethLower;
      const isUnwrap = inKey === wethLower && outKey === NATIVE_KEY;
      if (isWrap || isUnwrap) {
        out.skippedWrapUnwrap++;
        continue;
      }
      // Same asset on both sides means it's a refund, not a real swap
      if (inKey === outKey) {
        out.skippedNonSwap++;
        continue;
      }

      const inMeta = meta.get(inKey)!;
      const outMeta = meta.get(outKey)!;

      type Side = { address: Address; symbol: string; decimals: number; amount: string };
      let input: Side = {
        ...inMeta,
        amount: formatRaw((-inNet).toString(), inMeta.decimals),
      };
      let output: Side = {
        ...outMeta,
        amount: formatRaw(outNet.toString(), outMeta.decimals),
      };
      // Treat WETH as ETH for cleaner side classification downstream
      if (input.address.toLowerCase() === wethLower) input = { ...input, symbol: "ETH" };
      if (output.address.toLowerCase() === wethLower) output = { ...output, symbol: "ETH" };

      // Determine the BASE side for historical pricing
      // (mirror trades.classify priorities: stablecoins first, then ETH/WBTC)
      const cfg = getChain(chain);
      const baseAddrs = new Set(cfg.baseAssets.map((b) => b.address.toLowerCase()));
      const inputBaseAddr = input.symbol === "ETH" ? wethLower : input.address.toLowerCase();
      const outputBaseAddr = output.symbol === "ETH" ? wethLower : output.address.toLowerCase();
      const inputIsBase = baseAddrs.has(inputBaseAddr);
      const outputIsBase = baseAddrs.has(outputBaseAddr);

      let basePriceLookup: { addr: Address; isStable: boolean } | null = null;
      if (inputIsBase) {
        const meta = cfg.baseAssets.find((b) => b.address.toLowerCase() === inputBaseAddr)!;
        basePriceLookup = { addr: meta.address, isStable: meta.symbol.includes("USD") };
      } else if (outputIsBase) {
        const meta = cfg.baseAssets.find((b) => b.address.toLowerCase() === outputBaseAddr)!;
        basePriceLookup = { addr: meta.address, isStable: meta.symbol.includes("USD") };
      } else {
        out.skippedNoBase++;
        continue;
      }

      const ts = parseInt(transfers[0].timeStamp, 10);
      let baseUsdPrice: number | null;
      if (basePriceLookup.isStable) {
        baseUsdPrice = 1;
      } else {
        baseUsdPrice = await priceAt(chain, basePriceLookup.addr, ts);
      }
      if (baseUsdPrice === null) {
        out.skippedNoUsdPrice++;
        continue;
      }

      const recorded = await recordTrade({
        walletId,
        walletAddress,
        chain,
        venue: "chain-sync",
        txHash: hash as Hex,
        executedAt: ts * 1000,
        inputToken: { address: input.address, symbol: input.symbol, decimals: input.decimals },
        outputToken: { address: output.address, symbol: output.symbol, decimals: output.decimals },
        inputAmount: input.amount,
        outputAmount: output.amount,
        baseUsdPriceOverride: baseUsdPrice,
      });
      if (recorded === null) {
        out.skippedDuplicates++;
      } else {
        out.recorded++;
      }
    } catch (e) {
      out.errors.push(`${hash}: ${(e as Error).message}`);
    }
  }

  return out;
}

/**
 * Enumerate every ERC-20 the wallet has held by deriving the set from `tokentx`,
 * then `balanceOf` each in parallel and filtering non-zero.
 */
export async function findHoldings(args: {
  walletAddress: Address;
  chain: ChainId;
}): Promise<Array<{ address: Address; symbol: string; decimals: number; balance: string; balanceWei: string }>> {
  const transfers = await fetchTokenTransfers(args.chain, args.walletAddress);
  // Dedupe by contract address; remember symbol/decimals from any transfer
  const meta = new Map<string, { symbol: string; decimals: number }>();
  for (const t of transfers) {
    const k = t.contractAddress.toLowerCase();
    if (!meta.has(k)) meta.set(k, { symbol: t.tokenSymbol, decimals: parseInt(t.tokenDecimal, 10) });
  }

  // Filter out the user's hidden-tokens blocklist (scams etc.) before we even
  // touch the chain — saves balance reads and ensures the result is consistent
  // across every caller (mcp tool, sync, dashboard).
  const { getHiddenTokens } = await import("@/lib/user-profile");
  const hidden = await getHiddenTokens();
  const hiddenSet = new Set(hidden.filter((h) => h.chain === args.chain).map((h) => h.address));

  const addresses = [...meta.keys()].filter((a) => !hiddenSet.has(a));
  const out: Array<{ address: Address; symbol: string; decimals: number; balance: string; balanceWei: string }> = [];
  const { getTokenBalance } = await import("@/lib/eth");

  const BATCH = 30;
  for (let i = 0; i < addresses.length; i += BATCH) {
    const batch = addresses.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((addr) => getTokenBalance(args.walletAddress, addr as Address, args.chain))
    );
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status !== "fulfilled") continue;
      if (BigInt(r.value.wei) === 0n) continue;
      const m = meta.get(batch[j])!;
      out.push({
        address: batch[j] as Address,
        symbol: r.value.symbol || m.symbol,
        decimals: r.value.decimals || m.decimals,
        balance: r.value.formatted,
        balanceWei: r.value.wei,
      });
    }
  }
  return out;
}

export { ALL_CHAINS };
