import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import crypto from "node:crypto";
import { listWallets, updateWalletMetadata } from "@/lib/keystore";
import { syncWalletFromChain, findHoldings } from "@/lib/sync";
import { isExplorerConfigured } from "@/lib/explorer";
import { recordTrade } from "@/lib/trades";
import {
  isUnlocked,
  getUnlocked,
  listPending,
  enqueuePending,
  getPending,
  updatePending,
  type SwapVenue,
} from "@/lib/state";
import { getEthBalance, getTokenBalance, parseUnits, formatUnits, publicClient } from "@/lib/eth";
import * as uniswap from "@/lib/uniswap";
import * as oneinch from "@/lib/oneinch";
import { fetchTokenSafety } from "@/lib/safety";
import {
  listTrades,
  computePositions,
  computePnlSummary,
} from "@/lib/trades";
import { getChain, ALL_CHAINS, type ChainId } from "@/lib/chains";
import { logAction } from "@/lib/activity";
import {
  getUserProfile,
  setProfileDimension,
  markOnboardingComplete,
  getDustThresholdUsd,
  type UserProfile,
} from "@/lib/user-profile";
import { formatEther, formatGwei, type Address } from "viem";


const ChainSchema = z
  .enum(["ethereum", "base"])
  .default("ethereum")
  .describe("EVM chain to operate on. Default: ethereum. Supported: ethereum (mainnet), base.");

const VenueSchema = z
  .enum(["uniswap", "1inch"])
  .default("uniswap")
  .describe(
    "Routing venue. 'uniswap' (default) is fully on-chain Uniswap V2 — works on ethereum AND base, no API key. " +
      "'1inch' uses the 1inch aggregator API and is ETHEREUM-ONLY in this MVP (and requires ONEINCH_API_KEY)."
  );

// Optional grouping — set these on EVERY request_* tool call inside the
// same logical sequence so the /pending UI shows them as ONE titled
// slideshow the user clicks through. The AI generates the groupId (any
// string — a UUID is fine) and includes it on every call in the group.
// The first call passes groupTitle; subsequent calls can omit it (the
// server backfills from the first sibling). Single one-off ops can leave
// both undefined and the UI renders them individually as today.
const GroupIdSchema = z
  .string()
  .optional()
  .describe(
    "Optional. When this op is part of a sequence (e.g. set leverage + open position), generate a single groupId once and pass it on EVERY request_* call in the sequence. The /pending UI groups same-groupId ops into one titled slideshow."
  );
const GroupTitleSchema = z
  .string()
  .optional()
  .describe(
    "Optional. One-line summary of the WHOLE sequence (e.g. 'Open 5 ETH long with 10x leverage'). Pass with the FIRST call in a group; subsequent calls can omit."
  );

/** Decorate an op with group fields before enqueueing. No-op when both
 *  args are undefined (single-op flows render as today). */
function withGroup<T extends { groupId?: string; groupTitle?: string }>(
  op: T,
  groupId?: string,
  groupTitle?: string
): T {
  if (groupId) op.groupId = groupId;
  if (groupTitle) op.groupTitle = groupTitle;
  return op;
}

export function buildArkiveMcp(): McpServer {
  const server = new McpServer(
    { name: "arkive", version: "0.4.0" },
    {
      capabilities: { tools: {} },
      instructions: ARKIVE_INSTRUCTIONS,
    }
  );

  // ===========================================================
  // WALLET / DISCOVERY
  // ===========================================================

  server.tool(
    "list_wallets",
    "List all wallets in the local Arkive keystore: id, address, label, kind, purpose, tags, and whether each is currently unlocked for signing. " +
      "kind='owned' means we hold the encrypted PK (signing works). kind='watch' means address-only (read tools work, signing refuses).",
    {},
    async () => {
      const wallets = await listWallets();
      const enriched = wallets.map((w) => ({
        id: w.id,
        address: w.address,
        label: w.label,
        kind: w.kind,
        purpose: w.purpose ?? null,
        tags: w.tags ?? [],
        unlocked: w.kind === "owned" ? isUnlocked(w.id) : false,
      }));
      return ok({ wallets: enriched });
    }
  );

  server.tool(
    "add_watch_wallet",
    "Add a watch-only (read-only) wallet by address. No private key required. " +
      "Read-only tools (get_balance, find_holdings, get_portfolio, sync_wallet_from_chain, etc.) " +
      "work exactly as for an owned wallet. Write tools (request_swap, request_transfer, request_add_liquidity, etc.) refuse with a clear error. " +
      "Arkive entries derived from this wallet's chain data are tagged with wallet_kind='watch' so they're distinguishable later.",
    {
      address: z.string().describe("Ethereum address (0x... 40 hex chars). Will be checksummed."),
      label: z.string().optional().describe("Optional label, e.g. 'vault' or 'cold storage'."),
    },
    async ({ address, label }) => {
      const { addWatchWallet } = await import("@/lib/keystore");
      const w = await addWatchWallet({ address, label });
      await logAction({
        action: "wallet_onboarded",
        actor: "claude",
        target: { wallet: { id: w.id, address: w.address } },
        result: { before: "absent", after: `watch-only:${w.label}` },
        linked_refs: [{ type: "wallet", id: w.id, address: w.address }],
      }).catch(() => {});
      return ok({ id: w.id, address: w.address, label: w.label, kind: "watch" });
    }
  );

  server.tool(
    "list_chains",
    "List the EVM chains Arkive supports along with their default RPCs and key addresses.",
    {},
    async () => {
      return ok({
        chains: ALL_CHAINS.map((id) => {
          const c = getChain(id);
          return {
            id: c.id,
            name: c.name,
            chainId: c.numericId,
            explorer: c.explorer,
            v2: { router: c.v2.router, factory: c.v2.factory },
            usdc: c.v2.usdc.address,
          };
        }),
      });
    }
  );

  server.tool(
    "find_holdings",
    "Enumerate EVERY ERC-20 a wallet has ever touched on the chain (via Etherscan tokentx) and return current non-zero balances. " +
      "Dust positions (USD value < user's profile threshold, default $1.00) are filtered out by default — pass includeDust=true to see them. " +
      "Requires ETHERSCAN_API_KEY env var.",
    {
      walletId: z.string(),
      chain: ChainSchema,
      includeUsdValues: z
        .boolean()
        .default(true)
        .describe("If true, also fetch live USD prices and total value (slower but usually what you want)."),
      includeDust: z
        .boolean()
        .default(false)
        .describe("If true, return ALL non-zero holdings including dust (sub-threshold + scam airdrops with no price)."),
    },
    async ({ walletId, chain, includeUsdValues, includeDust }) => {
      try {
        if (!isExplorerConfigured()) {
          return errText(
            "ETHERSCAN_API_KEY is not set. Get a free key at https://etherscan.io/myapikey and put it in .env.local."
          );
        }
        const c: ChainId = chain ?? "ethereum";
        const wallets = await listWallets();
        const w = wallets.find((x) => x.id === walletId);
        if (!w) return errText(`No wallet with id ${walletId}`);

        const holdings = await findHoldings({ walletAddress: w.address as Address, chain: c });

        // Add native ETH balance
        const ethBal = await getEthBalance(w.address as Address, c);
        const ethPrice = includeUsdValues ? (await uniswap.priceUsd((await uniswap.findToken("ETH", c))!)) ?? 0 : 0;

        const enriched = await Promise.all(
          holdings.map(async (h) => {
            let usdPrice: number | null = null;
            if (includeUsdValues) {
              try {
                const t = await uniswap.findToken(h.address, c);
                usdPrice = t ? await uniswap.priceUsd(t) : null;
              } catch {
                usdPrice = null;
              }
            }
            return {
              symbol: h.symbol,
              address: h.address,
              decimals: h.decimals,
              balance: h.balance,
              usdPrice,
              usdValue: usdPrice !== null ? Number(h.balance) * usdPrice : null,
            };
          })
        );

        const ethEntry = {
          symbol: "ETH",
          address: "0x0000000000000000000000000000000000000000" as Address,
          decimals: 18,
          balance: ethBal.eth,
          usdPrice: includeUsdValues ? ethPrice : null,
          usdValue: includeUsdValues ? Number(ethBal.eth) * ethPrice : null,
        };
        const allRaw = [ethEntry, ...enriched].filter((h) => Number(h.balance) > 0);
        const dustThreshold = await getDustThresholdUsd();
        const isDust = (h: { usdValue: number | null; usdPrice: number | null }) =>
          dustThreshold > 0 &&
          (h.usdPrice === null || (h.usdValue !== null && h.usdValue < dustThreshold));
        const filtered = includeDust ? allRaw : allRaw.filter((h) => !isDust(h));
        const dustCount = allRaw.length - filtered.length;
        filtered.sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));
        const totalUsd = filtered.reduce((s, h) => s + (h.usdValue ?? 0), 0);
        return ok({
          chain: c,
          wallet: { id: w.id, address: w.address, label: w.label },
          holdingsCount: filtered.length,
          dustFiltered: dustCount,
          dustThresholdUsd: dustThreshold,
          totalUsd: Math.round(totalUsd * 100) / 100,
          holdings: filtered,
          ...(dustCount > 0 && !includeDust
            ? { note: `Filtered ${dustCount} dust position(s) (< $${dustThreshold}). Pass includeDust=true to see them.` }
            : {}),
        });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "label_wallet",
    "Set or update a wallet's label, purpose ('hot trading', 'cold storage', etc.), and tags. " +
      "Used by Claude to disambiguate multi-wallet setups.",
    {
      walletId: z.string(),
      label: z.string().optional(),
      purpose: z.string().optional().describe("Short purpose string. e.g. 'hot trading', 'cold storage', 'memecoin gambling'."),
      tags: z.array(z.string()).optional(),
    },
    async ({ walletId, label, purpose, tags }) => {
      try {
        const updated = await updateWalletMetadata(walletId, { label, purpose, tags });
        // First-time labeling counts as onboarding the wallet.
        await logAction({
          action: "wallet_onboarded",
          actor: "user",
          target: { wallet: { id: walletId, address: updated.address } },
          result: { after: `${updated.label}${updated.purpose ? ` · ${updated.purpose}` : ""}` },
          linked_refs: [{ type: "wallet", id: walletId, address: updated.address }],
        }).catch(() => {});
        return ok({ updated, message: `Updated wallet ${walletId}` });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "get_balance",
    "Get the native ETH balance (and optionally an ERC-20 balance) of a wallet on a specific chain.",
    {
      walletId: z.string().describe("Wallet id from list_wallets"),
      chain: ChainSchema,
      tokenSymbolOrAddress: z
        .string()
        .optional()
        .describe("Optional ERC-20 symbol (e.g. USDC) or 0x address. If omitted, only ETH balance is returned."),
    },
    async ({ walletId, chain, tokenSymbolOrAddress }) => {
      const c: ChainId = chain ?? "ethereum";
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      const eth = await getEthBalance(w.address as Address, c);
      let token: unknown = undefined;
      if (tokenSymbolOrAddress) {
        const t = await uniswap.findToken(tokenSymbolOrAddress, c);
        if (!t) return errText(`Could not find token ${tokenSymbolOrAddress} on ${c}`);
        if (uniswap.isNativeEth(t)) {
          token = { symbol: "ETH", balance: eth.eth };
        } else {
          const tb = await getTokenBalance(w.address as Address, t.address, c);
          token = { symbol: tb.symbol, address: t.address, balance: tb.formatted };
        }
      }
      return ok({ chain: c, address: w.address, eth: eth.eth, token });
    }
  );

  server.tool(
    "get_token",
    "Look up an ERC-20 token by symbol or address on a specific chain. Falls back to on-chain ERC-20 metadata for any address.",
    {
      query: z.string().describe("Token symbol like 'USDC', 'WETH', 'PEPE' or a 0x address"),
      chain: ChainSchema,
    },
    async ({ query, chain }) => {
      const t = await uniswap.findToken(query, chain ?? "ethereum");
      if (!t) return errText(`Could not find token ${query} on ${chain ?? "ethereum"}`);
      return ok(t);
    }
  );

  // ===========================================================
  // PRICING / GAS
  // ===========================================================

  server.tool(
    "get_eth_price",
    "Current ETH price in USD via Uniswap V2 WETH/USDC pair on the specified chain.",
    { chain: ChainSchema },
    async ({ chain }) => {
      try {
        const c: ChainId = chain ?? "ethereum";
        const eth = (await uniswap.findToken("ETH", c))!;
        const usdc = (await uniswap.findToken("USDC", c))!;
        const q = await uniswap.quoteExactIn({ src: eth, dst: usdc, amount: "1" });
        return ok({ chain: c, usd: Number(q.amountOutFormatted).toFixed(2), source: `uniswap-v2-weth-usdc-${c}` });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "get_token_price",
    "USD price for one whole token via Uniswap V2 (direct USDC pair, or routed via WETH) on the specified chain.",
    {
      token: z.string().describe("Symbol or 0x address"),
      chain: ChainSchema,
    },
    async ({ token, chain }) => {
      try {
        const c: ChainId = chain ?? "ethereum";
        const t = await uniswap.findToken(token, c);
        if (!t) return errText(`Unknown token: ${token} on ${c}`);
        const price = await uniswap.priceUsd(t);
        if (price === null) return errText(`No Uniswap V2 price route for ${t.symbol} on ${c}.`);
        return ok({
          chain: c,
          token: { symbol: t.symbol, address: t.address, decimals: t.decimals },
          usd: price,
          formatted: `$${price < 0.01 ? price.toExponential(4) : price.toFixed(price < 1 ? 6 : 2)}`,
        });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "get_gas_price",
    "Current gas price (gwei) and estimated USD cost of a typical Uniswap V2 swap on the specified chain.",
    { chain: ChainSchema },
    async ({ chain }) => {
      try {
        const c: ChainId = chain ?? "ethereum";
        const gasWei = await publicClient(c).getGasPrice();
        const gwei = Number(formatGwei(gasWei));
        const swapGas = 150_000n;
        const costEth = Number(formatEther(gasWei * swapGas));
        const eth = (await uniswap.findToken("ETH", c))!;
        const ethUsd = (await uniswap.priceUsd(eth)) ?? 0;
        return ok({
          chain: c,
          gasPriceGwei: gwei.toFixed(4),
          ethPriceUsd: ethUsd.toFixed(2),
          typicalSwap: {
            gasUnits: 150_000,
            costEth: costEth.toFixed(8),
            costUsd: (costEth * ethUsd).toFixed(4),
          },
        });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  // ===========================================================
  // RESEARCH
  // ===========================================================

  server.tool(
    "analyze_token_safety",
    "Run an ERC-20 risk check via GoPlus on the specified chain: honeypot, taxes, ownership, mintability, " +
      "verified source, holder count, LP holders. Returns a verdict (safe/caution/danger) with reasons. " +
      "STRONGLY RECOMMENDED before any meme/low-cap token purchase.",
    {
      token: z.string().describe("Symbol or 0x address (address is more reliable for new tokens)."),
      chain: ChainSchema,
    },
    async ({ token, chain }) => {
      try {
        const c: ChainId = chain ?? "ethereum";
        const t = await uniswap.findToken(token, c);
        if (!t) return errText(`Unknown token: ${token} on ${c}`);
        const report = await fetchTokenSafety(t.address, c);
        // Log every scan to the activity stream. Severity scales with verdict.
        await logAction({
          action: "safety_scan",
          actor: "claude",
          severity:
            report.verdict.level === "danger" ? "critical" : report.verdict.level === "caution" ? "warn" : "info",
          target: { token: { address: t.address, symbol: t.symbol, chain: c } },
          result: { verdict: report.verdict.level === "unknown" ? undefined : report.verdict.level },
          linked_refs: [{ type: "token", address: t.address, symbol: t.symbol, chain: c }],
        }).catch(() => {});
        return ok(report);
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "get_pair_info",
    "Inspect a Uniswap V2 pair on the specified chain: pair address, reserves, current rate, USD liquidity.",
    {
      tokenA: z.string().describe("Symbol or address. 'ETH' resolves to WETH."),
      tokenB: z.string().describe("Symbol or address. 'ETH' resolves to WETH."),
      chain: ChainSchema,
    },
    async ({ tokenA, tokenB, chain }) => {
      try {
        const c: ChainId = chain ?? "ethereum";
        const a = await uniswap.findToken(tokenA, c);
        const b = await uniswap.findToken(tokenB, c);
        if (!a || !b) return errText("Unknown token");
        const aAddr = uniswap.isNativeEth(a) ? uniswap.wethAddress(c) : a.address;
        const bAddr = uniswap.isNativeEth(b) ? uniswap.wethAddress(c) : b.address;
        const pair = await uniswap.getPairAddress(aAddr, bAddr, c);
        if (pair === "0x0000000000000000000000000000000000000000") {
          return errText(`No Uniswap V2 pair exists for ${a.symbol}/${b.symbol} on ${c}.`);
        }
        const r = await uniswap.getPairReserves(pair, c);
        const aIsToken0 = r.token0.toLowerCase() === aAddr.toLowerCase();
        const reserveA = aIsToken0 ? r.reserve0 : r.reserve1;
        const reserveB = aIsToken0 ? r.reserve1 : r.reserve0;
        const reserveAFmt = formatUnits(reserveA, a.decimals);
        const reserveBFmt = formatUnits(reserveB, b.decimals);
        const ratio = Number(reserveBFmt) / Number(reserveAFmt);
        let liquidityUsd: number | null = null;
        const aUsd = await uniswap.priceUsd(a);
        if (aUsd !== null) liquidityUsd = 2 * Number(reserveAFmt) * aUsd;
        return ok({
          chain: c,
          pair,
          reserves: { [a.symbol]: reserveAFmt, [b.symbol]: reserveBFmt },
          rate: `1 ${a.symbol} = ${ratio.toFixed(8)} ${b.symbol}`,
          liquidityUsd: liquidityUsd !== null ? Math.round(liquidityUsd) : null,
          lastUpdated: new Date(r.blockTimestampLast * 1000).toISOString(),
        });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "simulate_swap",
    "Dry-run a Uniswap V2 swap on the specified chain: returns expected output, price impact %, and estimated gas cost in USD.",
    {
      fromToken: z.string(),
      toToken: z.string(),
      amount: z.string(),
      chain: ChainSchema,
    },
    async ({ fromToken, toToken, amount, chain }) => {
      try {
        const c: ChainId = chain ?? "ethereum";
        const src = await uniswap.findToken(fromToken, c);
        const dst = await uniswap.findToken(toToken, c);
        if (!src) return errText(`Unknown fromToken: ${fromToken} on ${c}`);
        if (!dst) return errText(`Unknown toToken: ${toToken} on ${c}`);
        const tradeQ = await uniswap.quoteExactIn({ src, dst, amount });
        const tinyAmount = "0.0001";
        const tinyQ = await uniswap.quoteExactIn({ src, dst, amount: tinyAmount });
        const tradeRate = Number(tradeQ.amountOutFormatted) / Number(amount);
        const spotRate = Number(tinyQ.amountOutFormatted) / Number(tinyAmount);
        const priceImpactPct = ((spotRate - tradeRate) / spotRate) * 100;
        const hops = tradeQ.path.length - 1;
        const gasUnits = BigInt(120_000 + hops * 60_000);
        const gasWei = await publicClient(c).getGasPrice();
        const costEth = Number(formatEther(gasWei * gasUnits));
        const eth = (await uniswap.findToken("ETH", c))!;
        const ethUsd = (await uniswap.priceUsd(eth)) ?? 0;
        return ok({
          chain: c,
          venue: "uniswap",
          path: tradeQ.path,
          hops,
          input: `${amount} ${src.symbol}`,
          expectedOutput: `${tradeQ.amountOutFormatted} ${dst.symbol}`,
          spotRate: `1 ${src.symbol} ≈ ${spotRate.toFixed(8)} ${dst.symbol}`,
          effectiveRate: `1 ${src.symbol} ≈ ${tradeRate.toFixed(8)} ${dst.symbol}`,
          priceImpactPct: Math.max(0, priceImpactPct).toFixed(4),
          estimatedGas: {
            units: Number(gasUnits),
            costEth: costEth.toFixed(8),
            costUsd: (costEth * ethUsd).toFixed(4),
          },
          warning:
            priceImpactPct > 5
              ? "HIGH price impact — consider a smaller trade size or higher slippage tolerance."
              : priceImpactPct > 1
              ? "Moderate price impact."
              : null,
        });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  // ===========================================================
  // QUOTING / TRADING
  // ===========================================================

  server.tool(
    "get_quote",
    "Quote a swap of `amount` of `fromToken` into `toToken`. Read-only — does not queue anything. Default venue Uniswap V2.",
    {
      fromToken: z.string().describe("Symbol or 0x address. Use 'ETH' for native ether."),
      toToken: z.string().describe("Symbol or 0x address."),
      amount: z.string().describe("Human-readable amount of fromToken, e.g. '0.05' or '100'."),
      chain: ChainSchema,
      venue: VenueSchema,
    },
    async ({ fromToken, toToken, amount, chain, venue }) => {
      const v: SwapVenue = venue ?? "uniswap";
      const c: ChainId = chain ?? "ethereum";
      try {
        if (v === "uniswap") {
          const src = await uniswap.findToken(fromToken, c);
          const dst = await uniswap.findToken(toToken, c);
          if (!src) return errText(`Unknown fromToken: ${fromToken} on ${c}`);
          if (!dst) return errText(`Unknown toToken: ${toToken} on ${c}`);
          const q = await uniswap.quoteExactIn({ src, dst, amount });
          return ok({
            chain: c,
            venue: "uniswap",
            from: { symbol: src.symbol, address: src.address, amount },
            to: { symbol: dst.symbol, address: dst.address, estimatedAmount: q.amountOutFormatted },
            path: q.path,
            rate: `1 ${src.symbol} ≈ ${(Number(q.amountOutFormatted) / Number(amount)).toFixed(8)} ${dst.symbol}`,
          });
        }
        if (c !== "ethereum") return errText("1inch venue is only supported on Ethereum mainnet in this MVP.");
        const src = await oneinch.findToken(fromToken);
        const dst = await oneinch.findToken(toToken);
        if (!src) return errText(`Unknown fromToken: ${fromToken}`);
        if (!dst) return errText(`Unknown toToken: ${toToken}`);
        const amountWei = parseUnits(amount, src.decimals).toString();
        const q = await oneinch.quote({ src: src.address, dst: dst.address, amountWei });
        const dstAmount = formatUnits(BigInt(q.dstAmount), dst.decimals);
        return ok({
          chain: "ethereum",
          venue: "1inch",
          from: { symbol: src.symbol, address: src.address, amount },
          to: { symbol: dst.symbol, address: dst.address, estimatedAmount: dstAmount },
          rate: `1 ${src.symbol} ≈ ${(Number(dstAmount) / Number(amount)).toFixed(8)} ${dst.symbol}`,
        });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "request_swap",
    "Queue a swap for the user to approve in the Arkive UI. Does NOT auto-sign — user must click Approve at /pending. " +
      "Returns a pendingSwapId. Default chain ethereum, default venue Uniswap V2.",
    {
      walletId: z.string().describe("Wallet id from list_wallets. Must be unlocked."),
      fromToken: z.string(),
      toToken: z.string(),
      amount: z.string(),
      slippageBps: z
        .number()
        .int()
        .min(1)
        .max(5000)
        .default(100)
        .describe("Slippage in basis points (100 = 1%). For meme tokens, try 300–500."),
      chain: ChainSchema,
      venue: VenueSchema,
      groupId: GroupIdSchema,
      groupTitle: GroupTitleSchema,
    },
    async ({ walletId, fromToken, toToken, amount, slippageBps, chain, venue, groupId, groupTitle }) => {
      const v: SwapVenue = venue ?? "uniswap";
      const c: ChainId = chain ?? "ethereum";
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      if (w.kind === "watch") {
        return errText(
          `Wallet "${w.label}" is watch-only — read tools work, but swaps require a private key. ` +
            `Use a different wallet (one with kind="owned") or re-add this address via import_wallet.`
        );
      }
      if (!isUnlocked(walletId)) {
        return errText(`Wallet ${w.label} is locked. Tell the user to unlock it before requesting a swap.`);
      }
      const account = getUnlocked(walletId)!;

      try {
        if (v === "uniswap") {
          const src = await uniswap.findToken(fromToken, c);
          const dst = await uniswap.findToken(toToken, c);
          if (!src) return errText(`Unknown fromToken: ${fromToken} on ${c}`);
          if (!dst) return errText(`Unknown toToken: ${toToken} on ${c}`);
          const amountWei = parseUnits(amount, src.decimals);
          if (uniswap.isNativeEth(src)) {
            const eth = await getEthBalance(account.address, c);
            if (BigInt(eth.wei) < amountWei) {
              return errText(`Insufficient ETH on ${c}. Wallet has ${eth.eth}, swap needs ${amount} (plus gas).`);
            }
          } else {
            const tb = await getTokenBalance(account.address, src.address, c);
            if (BigInt(tb.wei) < amountWei) {
              return errText(`Insufficient ${src.symbol} on ${c}. Wallet has ${tb.formatted}, swap needs ${amount}.`);
            }
          }
          const q = await uniswap.quoteExactIn({ src, dst, amount });
          const id = crypto.randomUUID();
          enqueuePending({
        groupId,
        groupTitle,
            id,
            kind: "swap",
            walletId,
            walletAddress: account.address,
            chain: c,
            venue: "uniswap",
            fromToken: { address: src.address, symbol: src.symbol, decimals: src.decimals },
            toToken: { address: dst.address, symbol: dst.symbol, decimals: dst.decimals },
            fromAmount: amount,
            fromAmountWei: amountWei.toString(),
            estimatedToAmount: q.amountOutFormatted,
            slippageBps,
            path: q.path,
            status: "pending",
            requestedAt: Date.now(),
            summary: `Swap ${amount} ${src.symbol} → ~${q.amountOutFormatted} ${dst.symbol}`,
          });
          await logAction({
            action: "swap_queued",
            actor: "claude",
            target: {
              token: { address: dst.address, symbol: dst.symbol, chain: c },
              wallet: { id: walletId, address: account.address },
            },
            result: {
              expected_output_amount: q.amountOutFormatted,
              expected_output_symbol: dst.symbol,
            },
            linked_refs: [
              { type: "wallet", id: walletId, address: account.address },
              { type: "token", address: dst.address, symbol: dst.symbol, chain: c },
            ],
          }).catch(() => {});
          return ok({
            pendingSwapId: id,
            chain: c,
            venue: "uniswap",
            status: "pending",
            path: q.path,
            message:
              `Uniswap V2 swap queued on ${c}. The user must open Arkive at /pending and click Approve. ` +
              `Estimated output: ~${q.amountOutFormatted} ${dst.symbol} for ${amount} ${src.symbol}.`,
            approvalUrl: "http://localhost:3000/pending",
          });
        }

        // 1inch path (ethereum only)
        if (c !== "ethereum") return errText("1inch is only supported on Ethereum mainnet in this MVP.");
        const src = await oneinch.findToken(fromToken);
        const dst = await oneinch.findToken(toToken);
        if (!src) return errText(`Unknown fromToken: ${fromToken}`);
        if (!dst) return errText(`Unknown toToken: ${toToken}`);
        const amountWei = parseUnits(amount, src.decimals).toString();
        if (src.address.toLowerCase() === oneinch.NATIVE_TOKEN) {
          const eth = await getEthBalance(account.address, "ethereum");
          if (BigInt(eth.wei) < BigInt(amountWei)) {
            return errText(`Insufficient ETH. Wallet has ${eth.eth}, swap needs ${amount} (plus gas).`);
          }
        } else {
          const tb = await getTokenBalance(account.address, src.address as Address, "ethereum");
          if (BigInt(tb.wei) < BigInt(amountWei)) {
            return errText(`Insufficient ${src.symbol}. Wallet has ${tb.formatted}, swap needs ${amount}.`);
          }
        }
        const q = await oneinch.quote({ src: src.address, dst: dst.address, amountWei });
        const estimated = formatUnits(BigInt(q.dstAmount), dst.decimals);
        const id = crypto.randomUUID();
        enqueuePending({
        groupId,
        groupTitle,
          id,
          kind: "swap",
          walletId,
          walletAddress: account.address,
          chain: "ethereum",
          venue: "1inch",
          fromToken: { address: src.address, symbol: src.symbol, decimals: src.decimals },
          toToken: { address: dst.address, symbol: dst.symbol, decimals: dst.decimals },
          fromAmount: amount,
          fromAmountWei: amountWei,
          estimatedToAmount: estimated,
          slippageBps,
          status: "pending",
          requestedAt: Date.now(),
          summary: `Swap ${amount} ${src.symbol} → ~${estimated} ${dst.symbol}`,
        });
        return ok({
          pendingSwapId: id,
          chain: "ethereum",
          venue: "1inch",
          status: "pending",
          message: `1inch swap queued. Estimated output ~${estimated} ${dst.symbol}.`,
          approvalUrl: "http://localhost:3000/pending",
        });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "get_swap_status",
    "Check the status of a previously requested pending op (swap, transfer, approval, wrap, LP) by id.",
    { pendingSwapId: z.string() },
    async ({ pendingSwapId }) => {
      const s = getPending(pendingSwapId);
      if (!s) return errText(`No pending op with id ${pendingSwapId}`);
      const explorer = getChain(s.chain).explorer;
      return ok({
        id: s.id,
        kind: s.kind,
        chain: s.chain,
        venue: s.kind === "swap" ? s.venue : undefined,
        status: s.status,
        summary: s.summary,
        txHash: s.txHash,
        error: s.error,
        explorer: s.txHash ? `${explorer}/tx/${s.txHash}` : undefined,
      });
    }
  );

  server.tool(
    "list_pending_swaps",
    "List all pending ops in this session (swaps + transfers + approvals + wraps + LP), with current status. " +
      "Each row exposes `kind` and a `summary` line; swap-specific fields are present only when kind='swap'.",
    {},
    async () => {
      const all = listPending();
      return ok({
        swaps: all.map((s) => ({
          id: s.id,
          kind: s.kind,
          chain: s.chain,
          venue: s.kind === "swap" ? s.venue : undefined,
          status: s.status,
          summary: s.summary ?? summarize(s),
          from: s.kind === "swap" ? `${s.fromAmount} ${s.fromToken.symbol}` : undefined,
          to: s.kind === "swap" ? `~${s.estimatedToAmount} ${s.toToken.symbol}` : undefined,
          txHash: s.txHash,
        })),
      });
    }
  );

  function summarize(op: ReturnType<typeof getPending>): string {
    if (!op) return "";
    switch (op.kind) {
      case "swap":
        return `Swap ${op.fromAmount} ${op.fromToken.symbol} → ~${op.estimatedToAmount} ${op.toToken.symbol}`;
      case "transfer":
        return `Transfer ${op.amount} ${op.asset.kind === "eth" ? "ETH" : op.asset.token.symbol} → ${op.toEns ?? op.to.slice(0, 6) + "…" + op.to.slice(-4)}`;
      case "approve":
        return `Approve ${op.amount === "max" ? "unlimited" : op.amount} ${op.token.symbol} → ${op.spender.slice(0, 6)}…${op.spender.slice(-4)}`;
      case "wrap_eth":
        return `Wrap ${op.amount} ETH → WETH`;
      case "unwrap_weth":
        return `Unwrap ${op.amount} WETH → ETH`;
      case "add_liquidity_v2":
        return `Add V2 LP: ${op.amountA} ${op.tokenA.symbol} + ${op.amountB} ${op.tokenB.symbol}`;
      case "remove_liquidity_v2":
        return `Remove V2 LP: ${op.lpAmount} ${op.tokenA.symbol}/${op.tokenB.symbol}`;
      case "add_liquidity_v3":
        return `Mint V3 LP: ${op.amount0Desired} ${op.token0.symbol} + ${op.amount1Desired} ${op.token1.symbol} (fee ${op.fee})`;
      case "exit_liquidity_v3":
        return `Exit V3 LP position #${op.tokenId} (${op.token0.symbol}/${op.token1.symbol})`;
      case "limit_order":
        return `Limit order: ${op.amountIn} ${op.fromToken.symbol} → ≥${op.minAmountOut} ${op.toToken.symbol} (UniswapX)`;
      case "twap_order":
        return `TWAP: ${op.totalAmountIn} ${op.fromToken.symbol} → ${op.toToken.symbol} over ${op.chunks} chunks (${op.intervalSeconds}s spacing)`;
      case "hl_order":
        return `Hyperliquid ${op.isBuy ? "BUY" : "SELL"} ${op.size} ${op.coin} @ ${op.price} (${op.tif}${op.reduceOnly ? ", reduce-only" : ""})`;
      case "hl_cancel":
        return `Hyperliquid: cancel ${op.coin} order #${op.hlOrderId}`;
      case "hl_close_position":
        return `Hyperliquid: close ${op.coin} position (size ${op.positionSize})`;
      case "hl_leverage":
        return `Hyperliquid: set ${op.coin} leverage to ${op.leverage}x ${op.isCross ? "cross" : "isolated"}`;
    }
  }

  server.tool(
    "cancel_pending_swap",
    "Cancel a queued swap that has not yet been signed. Only works while status is 'pending'.",
    { pendingSwapId: z.string() },
    async ({ pendingSwapId }) => {
      const s = getPending(pendingSwapId);
      if (!s) return errText(`No pending swap with id ${pendingSwapId}`);
      if (s.status !== "pending") return errText(`Cannot cancel — swap is already ${s.status}.`);
      updatePending(pendingSwapId, { status: "rejected", resolvedAt: Date.now() });
      return ok({ id: pendingSwapId, status: "rejected" });
    }
  );

  // ===========================================================
  // PORTFOLIO + PnL (new)
  // ===========================================================

  server.tool(
    "get_portfolio",
    "Portfolio view with USD values. " +
      "Pass walletId to scope to one wallet; OMIT walletId to AGGREGATE across ALL wallets. " +
      "Pass chain to scope to one chain; OMIT chain to aggregate across both ethereum + base. " +
      "By default uses find_holdings (Etherscan tokentx) for full long-tail discovery. " +
      "If ETHERSCAN_API_KEY is unset, falls back to a curated top-token whitelist. " +
      "Every holding is annotated with `safetyLevel` from GoPlus: safe / caution / danger / unknown. " +
      "DANGER-flagged tokens (scams, honeypots, manufactured liquid pools like ETHG/AICC) have their " +
      "usdPrice + usdValue NULLED so they don't inflate the total — the row stays visible so the user " +
      "still sees what's in their wallet. If `scamFlagged > 0`, mention which tokens were flagged and why " +
      "(reasons live in each holding's `safetyReasons`).",
    {
      walletId: z.string().optional(),
      chain: ChainSchema.optional(),
      tokens: z
        .array(z.string())
        .optional()
        .describe(
          "Optional explicit token list (symbols/addresses). If provided, overrides Etherscan discovery. " +
            "Useful when you want to check specific tokens fast."
        ),
      includeDust: z
        .boolean()
        .default(false)
        .describe("If true, do NOT filter out dust positions. Default false."),
    },
    async ({ walletId, chain, tokens, includeDust }) => {
      try {
        const wallets = await listWallets();
        const targetWallets = walletId ? wallets.filter((w) => w.id === walletId) : wallets;
        if (targetWallets.length === 0) return errText(walletId ? `No wallet with id ${walletId}` : "No wallets in keystore");
        const targetChains: ChainId[] = chain ? [chain] : ALL_CHAINS;
        const useExplorer = !tokens && isExplorerConfigured();

        type Holding = {
          symbol: string;
          address: Address;
          balance: string;
          usdPrice: number | null;
          usdValue: number | null;
          chain: ChainId;
          walletId: string;
          walletLabel: string;
        };
        const allHoldings: Holding[] = [];

        const fallbackTokens: Record<ChainId, string[]> = {
          ethereum: ["USDC", "USDT", "DAI", "WBTC", "LINK", "UNI", "SHIB", "PEPE"],
          base: ["USDC", "USDbC", "DAI", "AERO", "BRETT", "DEGEN"],
        };

        for (const w of targetWallets) {
          for (const c of targetChains) {
            try {
              // ETH first
              const ethBal = await getEthBalance(w.address as Address, c);
              const ethToken = (await uniswap.findToken("ETH", c))!;
              const ethPrice = (await uniswap.priceUsd(ethToken)) ?? 0;
              if (Number(ethBal.eth) > 0) {
                allHoldings.push({
                  symbol: "ETH",
                  address: "0x0000000000000000000000000000000000000000" as Address,
                  balance: ethBal.eth,
                  usdPrice: ethPrice,
                  usdValue: Number(ethBal.eth) * ethPrice,
                  chain: c,
                  walletId: w.id,
                  walletLabel: w.label,
                });
              }

              // Either explicit tokens OR explorer-discovered OR curated fallback
              if (tokens) {
                await Promise.all(
                  tokens.map(async (q) => {
                    try {
                      const t = await uniswap.findToken(q, c);
                      if (!t || uniswap.isNativeEth(t)) return;
                      const bal = await getTokenBalance(w.address as Address, t.address, c);
                      if (Number(bal.formatted) === 0) return;
                      const price = await uniswap.priceUsd(t);
                      allHoldings.push({
                        symbol: t.symbol,
                        address: t.address,
                        balance: bal.formatted,
                        usdPrice: price,
                        usdValue: price !== null ? Number(bal.formatted) * price : null,
                        chain: c,
                        walletId: w.id,
                        walletLabel: w.label,
                      });
                    } catch {
                      // ignore failures per token
                    }
                  })
                );
              } else if (useExplorer) {
                const found = await findHoldings({ walletAddress: w.address as Address, chain: c });
                await Promise.all(
                  found.map(async (h) => {
                    let price: number | null = null;
                    try {
                      const t = await uniswap.findToken(h.address, c);
                      price = t ? await uniswap.priceUsd(t) : null;
                    } catch {
                      price = null;
                    }
                    allHoldings.push({
                      symbol: h.symbol,
                      address: h.address,
                      balance: h.balance,
                      usdPrice: price,
                      usdValue: price !== null ? Number(h.balance) * price : null,
                      chain: c,
                      walletId: w.id,
                      walletLabel: w.label,
                    });
                  })
                );
              } else {
                await Promise.all(
                  fallbackTokens[c].map(async (q) => {
                    try {
                      const t = await uniswap.findToken(q, c);
                      if (!t || uniswap.isNativeEth(t)) return;
                      const bal = await getTokenBalance(w.address as Address, t.address, c);
                      if (Number(bal.formatted) === 0) return;
                      const price = await uniswap.priceUsd(t);
                      allHoldings.push({
                        symbol: t.symbol,
                        address: t.address,
                        balance: bal.formatted,
                        usdPrice: price,
                        usdValue: price !== null ? Number(bal.formatted) * price : null,
                        chain: c,
                        walletId: w.id,
                        walletLabel: w.label,
                      });
                    } catch {
                      // ignore
                    }
                  })
                );
              }
            } catch {
              // chain failure for this wallet — keep going
            }
          }
        }

        // ---- GoPlus safety pass ----------------------------------------------
        // Every non-ETH holding gets a cached GoPlus verdict. Tokens flagged as
        // `danger` get their usdValue/usdPrice nulled — the row stays so the user
        // sees what's in the wallet, but the value can't inflate the portfolio
        // total. This is the permanent fix for scam tokens (ETHG, AICC) with
        // manufactured liquid pools that the liquidity floor can't catch.
        const { batchSafety } = await import("@/lib/safety-cache");
        const ETH_PLACEHOLDER = "0x0000000000000000000000000000000000000000";
        const verdicts = await batchSafety(
          allHoldings.map((h) => ({ chain: h.chain, address: h.address as Address }))
        );
        type AnnotatedHolding = (typeof allHoldings)[number] & {
          safetyLevel: "safe" | "caution" | "danger" | "unknown";
          safetyReasons: string[];
        };
        const annotated: AnnotatedHolding[] = allHoldings.map((h, i) => {
          // ETH itself we never run through GoPlus (it's the native asset).
          if (h.address === ETH_PLACEHOLDER) {
            return { ...h, safetyLevel: "safe", safetyReasons: [] };
          }
          const v = verdicts[i];
          if (v.level === "danger") {
            return { ...h, usdPrice: null, usdValue: null, safetyLevel: v.level, safetyReasons: v.reasons };
          }
          return { ...h, safetyLevel: v.level, safetyReasons: v.reasons };
        });

        const dustThreshold = await getDustThresholdUsd();
        const isDust = (h: { usdValue: number | null; usdPrice: number | null }) =>
          dustThreshold > 0 &&
          (h.usdPrice === null || (h.usdValue !== null && h.usdValue < dustThreshold));
        const filtered = includeDust ? annotated : annotated.filter((h) => !isDust(h));
        const dustCount = annotated.length - filtered.length;
        const scamCount = annotated.filter((h) => h.safetyLevel === "danger").length;
        const totalUsd = filtered.reduce((s, h) => s + (h.usdValue ?? 0), 0);
        return ok({
          scope: {
            wallets: targetWallets.map((w) => ({ id: w.id, address: w.address, label: w.label })),
            chains: targetChains,
            discoveryMode: tokens ? "explicit" : useExplorer ? "etherscan" : "curated-fallback",
          },
          totalUsd: Math.round(totalUsd * 100) / 100,
          dustFiltered: dustCount,
          dustThresholdUsd: dustThreshold,
          scamFlagged: scamCount,
          holdings: filtered.sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0)),
          warning: !useExplorer && !tokens
            ? "ETHERSCAN_API_KEY not set — using curated whitelist. Long-tail tokens (memecoins, etc.) won't appear. Set the env var for full discovery."
            : null,
          ...(dustCount > 0 && !includeDust
            ? { note: `Filtered ${dustCount} dust position(s) (< $${dustThreshold}). Pass includeDust=true to see them.` }
            : {}),
          ...(scamCount > 0
            ? {
                scamNote: `${scamCount} token(s) flagged by GoPlus as scam/danger — their usdValue was nulled so they don't inflate the total. Inspect via safetyLevel="danger" + safetyReasons on each holding.`,
              }
            : {}),
        });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "get_trade_history",
    "List executed swap trades from the local Arkive log. Optional filters by wallet, chain, token. Sorted oldest-first.",
    {
      walletAddress: z
        .string()
        .optional()
        .describe("0x address. If omitted, returns trades for all wallets."),
      chain: z.enum(["ethereum", "base"]).optional().describe("If omitted, returns trades on all chains."),
      tokenAddress: z
        .string()
        .optional()
        .describe("0x address of the tracked token. If omitted, returns all tokens."),
      limit: z.number().int().min(1).max(500).default(100),
    },
    async ({ walletAddress, chain, tokenAddress, limit }) => {
      try {
        const trades = await listTrades({
          walletAddress: walletAddress as Address | undefined,
          chain,
          tokenAddress: tokenAddress as Address | undefined,
        });
        const slice = trades.slice(-limit);
        return ok({
          totalCount: trades.length,
          returned: slice.length,
          trades: slice.map((t) => ({
            id: t.id,
            executedAt: new Date(t.executedAt).toISOString(),
            chain: t.chain,
            venue: t.venue,
            side: t.side,
            token: t.token.symbol,
            base: t.base.symbol,
            tokenAmount: t.tokenAmount,
            baseAmount: t.baseAmount,
            tokenUsdPrice: t.tokenUsdPrice,
            tradeUsd: Math.round(t.tradeUsd * 100) / 100,
            wallet: t.walletAddress,
            txHash: t.txHash,
            explorer: `${getChain(t.chain).explorer}/tx/${t.txHash}`,
          })),
        });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "get_positions",
    "Compute per-token positions from the trade log: remaining quantity, FIFO average entry price, " +
      "live current price, unrealized PnL, realized PnL on already-sold portion. " +
      "Filter by walletAddress and/or chain.",
    {
      walletAddress: z.string().optional(),
      chain: z.enum(["ethereum", "base"]).optional(),
      includeClosed: z
        .boolean()
        .default(false)
        .describe("If true, also include positions with zero remaining (fully closed)."),
      includeDust: z
        .boolean()
        .default(false)
        .describe("If true, do NOT filter out dust positions (sub-threshold or unpriced)."),
    },
    async ({ walletAddress, chain, includeClosed, includeDust }) => {
      try {
        const positions = await computePositions({
          walletAddress: walletAddress as Address | undefined,
          chain,
        });
        const dustThreshold = await getDustThresholdUsd();
        const isDustPos = (p: { remainingTokens: number; currentValueUsd: number | null; currentPriceUsd: number | null }) =>
          dustThreshold > 0 &&
          p.remainingTokens > 0 &&
          (p.currentPriceUsd === null || (p.currentValueUsd !== null && p.currentValueUsd < dustThreshold));
        const dusted = includeDust ? positions : positions.filter((p) => !isDustPos(p));
        const dustCount = positions.length - dusted.length;
        const filtered = includeClosed ? dusted : dusted.filter((p) => p.remainingTokens > 0);
        return ok({
          ...(dustCount > 0 && !includeDust
            ? { note: `Filtered ${dustCount} dust position(s) (< $${dustThreshold}). Pass includeDust=true to see them.` }
            : {}),
          count: filtered.length,
          positions: filtered.map((p) => ({
            chain: p.chain,
            wallet: p.walletAddress,
            token: { symbol: p.token.symbol, address: p.token.address },
            remaining: p.remainingTokens,
            avgEntryUsd: round(p.avgEntryUsd, 8),
            currentPriceUsd: p.currentPriceUsd !== null ? round(p.currentPriceUsd, 8) : null,
            currentValueUsd: p.currentValueUsd !== null ? round(p.currentValueUsd, 2) : null,
            costBasisUsd: round(p.costBasisUsd, 2),
            unrealizedPnlUsd: p.unrealizedPnlUsd !== null ? round(p.unrealizedPnlUsd, 2) : null,
            realizedPnlUsd: round(p.realizedPnlUsd, 2),
            totalPnlUsd: round(p.realizedPnlUsd + (p.unrealizedPnlUsd ?? 0), 2),
            buyTrades: p.buyTrades,
            sellTrades: p.sellTrades,
            firstTradeAt: new Date(p.firstTradeAt).toISOString(),
            lastTradeAt: new Date(p.lastTradeAt).toISOString(),
          })),
        });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "get_realized_pnl",
    "Sum of realized (closed-portion) PnL across all positions, with optional filters and per-token breakdown. " +
      "Realized PnL = sum over all sells of `closeQty * (sellPriceUsd - lotEntryPriceUsd)`, FIFO.",
    {
      walletAddress: z.string().optional(),
      chain: z.enum(["ethereum", "base"]).optional(),
      sinceMs: z
        .number()
        .optional()
        .describe("Optional UNIX ms timestamp; only count realized PnL from sells AFTER this moment. " +
          "Note: this is a rough cutoff applied per-token (cost basis is still computed using all prior buys)."),
    },
    async ({ walletAddress, chain }) => {
      try {
        const positions = await computePositions({
          walletAddress: walletAddress as Address | undefined,
          chain,
        });
        const totalRealized = positions.reduce((s, p) => s + p.realizedPnlUsd, 0);
        const breakdown = positions
          .filter((p) => Math.abs(p.realizedPnlUsd) > 0.01)
          .sort((a, b) => b.realizedPnlUsd - a.realizedPnlUsd)
          .map((p) => ({
            chain: p.chain,
            token: p.token.symbol,
            realizedPnlUsd: round(p.realizedPnlUsd, 2),
            sells: p.sellTrades,
          }));
        return ok({
          filters: { walletAddress: walletAddress ?? null, chain: chain ?? null },
          totalRealizedUsd: round(totalRealized, 2),
          perToken: breakdown,
        });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  // ===========================================================
  // BACKFILL — for positions held before Arkive was tracking
  // ===========================================================

  server.tool(
    "set_cost_basis",
    "MANUAL backfill — record an opening position you held before Arkive started tracking. " +
      "Inserts a synthetic trade so PnL math works correctly. Use when the user says e.g. " +
      "'I have 1M GRAY at avg entry $0.0005, bought 2024-01-15'. Use sync_wallet_from_chain instead if " +
      "the user wants to auto-import from on-chain history.",
    {
      walletId: z.string(),
      chain: ChainSchema,
      tokenAddress: z.string().describe("0x address of the token you're recording cost basis for."),
      tokenAmount: z.string().describe("Quantity of the token (human-readable, e.g. '1000000')."),
      costPerTokenUsd: z
        .number()
        .describe("USD price you paid per single whole token at entry (e.g. 0.0005 for half a tenth of a cent)."),
      executedAtIso: z
        .string()
        .optional()
        .describe("ISO date/time of the original buy. Defaults to now. e.g. '2024-01-15' or '2024-01-15T14:30:00Z'."),
      side: z.enum(["buy", "sell"]).default("buy").describe("Almost always 'buy'. Use 'sell' to record a historical sell."),
    },
    async ({ walletId, chain, tokenAddress, tokenAmount, costPerTokenUsd, executedAtIso, side }) => {
      try {
        const c: ChainId = chain ?? "ethereum";
        const wallets = await listWallets();
        const w = wallets.find((x) => x.id === walletId);
        if (!w) return errText(`No wallet with id ${walletId}`);
        const t = await uniswap.findToken(tokenAddress, c);
        if (!t) return errText(`Could not resolve token ${tokenAddress} on ${c}`);

        const cfg = getChain(c);
        const usdc = cfg.v2.usdc;
        const tokenAmtNum = Number(tokenAmount);
        const totalUsd = tokenAmtNum * costPerTokenUsd;
        // Treat USDC as the synthetic counterparty; baseAmount = totalUsd, baseUsdPrice = 1
        const usdcSide = {
          address: usdc.address,
          symbol: "USDC",
          decimals: usdc.decimals,
        };
        const tokenSide = { address: t.address, symbol: t.symbol, decimals: t.decimals };

        const inputToken = side === "buy" ? usdcSide : tokenSide;
        const outputToken = side === "buy" ? tokenSide : usdcSide;
        const inputAmount = side === "buy" ? totalUsd.toString() : tokenAmount;
        const outputAmount = side === "buy" ? tokenAmount : totalUsd.toString();

        const executedAtMs = executedAtIso ? new Date(executedAtIso).getTime() : Date.now();
        if (Number.isNaN(executedAtMs)) {
          return errText(`Invalid executedAtIso: ${executedAtIso}`);
        }

        // Synthetic txHash so dedup keeps these unique
        const synthHash = `0xmanual${crypto.randomUUID().replace(/-/g, "")}` as `0x${string}`;

        const recorded = await recordTrade({
          walletId,
          walletAddress: w.address as Address,
          chain: c,
          venue: "manual",
          txHash: synthHash,
          executedAt: executedAtMs,
          inputToken,
          outputToken,
          inputAmount,
          outputAmount,
          baseUsdPriceOverride: 1,
        });
        if (!recorded) return errText("Failed to record cost basis trade.");
        await logAction({
          action: "cost_basis_set",
          actor: "user",
          target: {
            token: { address: t.address, symbol: t.symbol, chain: c },
            wallet: { id: walletId, address: w.address },
            amount_usd: totalUsd,
          },
          linked_refs: [
            { type: "trade", id: recorded.id },
            { type: "wallet", id: walletId, address: w.address },
            { type: "token", address: t.address, symbol: t.symbol, chain: c },
          ],
        }).catch(() => {});
        return ok({
          message: `Recorded ${side.toUpperCase()} ${tokenAmount} ${t.symbol} at $${costPerTokenUsd}/token (= $${totalUsd.toFixed(2)} total) on ${new Date(executedAtMs).toISOString().slice(0, 10)}.`,
          tradeId: recorded.id,
          venue: "manual",
        });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "sync_wallet_from_chain",
    "AUTO backfill — scan the wallet's on-chain swap history (Etherscan tokentx + internal txs) and " +
      "reconstruct the trade log with historical USD prices (Defillama). Idempotent — safe to re-run; dedupes by tx hash. " +
      "Requires ETHERSCAN_API_KEY env var. Can be slow for active wallets (one Defillama price lookup per tx).",
    {
      walletId: z.string(),
      chain: ChainSchema,
      sinceIso: z
        .string()
        .optional()
        .describe("Only sync txs after this ISO date. Default: all-time. Use to incrementally re-sync."),
    },
    async ({ walletId, chain, sinceIso }) => {
      try {
        if (!isExplorerConfigured()) {
          return errText(
            "ETHERSCAN_API_KEY is not set. Get a free key at https://etherscan.io/myapikey and put it in .env.local."
          );
        }
        const c: ChainId = chain ?? "ethereum";
        const wallets = await listWallets();
        const w = wallets.find((x) => x.id === walletId);
        if (!w) return errText(`No wallet with id ${walletId}`);
        const sinceUnixSec = sinceIso ? Math.floor(new Date(sinceIso).getTime() / 1000) : 0;
        if (sinceIso && Number.isNaN(sinceUnixSec)) {
          return errText(`Invalid sinceIso: ${sinceIso}`);
        }
        const result = await syncWalletFromChain({
          walletId,
          walletAddress: w.address as Address,
          chain: c,
          sinceUnixSec,
        });
        await logAction({
          action: "chain_sync_run",
          actor: "user",
          target: { wallet: { id: walletId, address: w.address } },
          result: { after: `${result.recorded} new trades` },
          linked_refs: [{ type: "wallet", id: walletId, address: w.address }],
        }).catch(() => {});
        return ok({
          message: `Sync complete: ${result.recorded} new trades recorded, ${result.skippedDuplicates} duplicates skipped.`,
          ...result,
        });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  // ===========================================================
  // ARKIVES — the layered behavioral substrate
  // (evidence → recaps + patterns → journal → rules)
  // ===========================================================

  server.tool(
    "get_pnl_summary",
    "Top-level trader summary: total invested, total proceeds, realized + unrealized PnL, win rate, " +
      "biggest winner & loser, trade counts. The single best 'how am I doing' tool.",
    {
      walletAddress: z.string().optional(),
      chain: z.enum(["ethereum", "base"]).optional(),
    },
    async ({ walletAddress, chain }) => {
      try {
        const summary = await computePnlSummary({
          walletAddress: walletAddress as Address | undefined,
          chain,
        });
        const winRate =
          summary.winners + summary.losers > 0
            ? Math.round((summary.winners / (summary.winners + summary.losers)) * 1000) / 10
            : null;
        return ok({ ...summary, winRatePct: winRate });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  // ===========================================================
  // ARKIVE v2 — append-only structured journal (Phase 3 + 4 + 5)
  // ===========================================================

  // ===========================================================
  // LIBRARIES — multi-domain context layer (v3+)
  // ===========================================================

  // ===========================================================
  // LIBRARY ENTRIES — generic file CRUD inside any library
  //
  // These are the tools you reach for in NON-TRADING libraries (and
  // anywhere a dedicated trading tool doesn't fit). Folders are implicit:
  // writing subpath "deals/rolex-daytona-2026-05-18.md" creates the
  // `deals/` folder automatically. No separate create-folder call.
  //
  // Trading library STILL prefers its dedicated tools (append_trade_entry,
  // create_skill, propose_insight, …) because they fill in the typed
  // frontmatter the trading analyzers expect. Use these generics for
  // everything else.
  // ===========================================================

  server.tool(
    "get_open_positions",
    "Open trades from the v2 journal — every trade entry with status=open. Each row includes the trade_id, asset, " +
      "venue, linked_skill, sources, file path, and frontmatter (which carries the structured fields). Live price " +
      "/ value / P&L will land here once the positions DB ships; for now derived from the markdown frontmatter only.",
    {},
    async () => {
      const { storage, currentUserId } = await import("@/lib/storage");
      try {
        const uid = await currentUserId();
        const adapter = storage();
        const all = await adapter.listEntries(uid, "arkive/journal/trades/");
        const open = all
          .filter((e) => e.path.includes("-entry-"))
          .filter((e) => ((e.meta as Record<string, unknown>) ?? {}).status === "open")
          .map((e) => {
            const m = (e.meta ?? {}) as Record<string, unknown>;
            return {
              trade_id: String(m.trade_id ?? ""),
              asset: String(m.asset ?? ""),
              venue: String(m.venue ?? ""),
              linked_skill: String(m.linked_skill ?? ""),
              sources: m.sources ?? [],
              created: String(m.created ?? ""),
              envelope_override: Boolean(m.envelope_override ?? false),
              path: e.path,
            };
          });
        return ok({ positions: open });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  // ===========================================================
  // HIDDEN TOKENS — per-user blocklist for scam/spam tokens
  // ===========================================================

  server.tool(
    "list_hidden_tokens",
    "List the user's blocklist of hidden tokens. These never appear in find_holdings, get_portfolio, or the dashboard.",
    {},
    async () => {
      const { getHiddenTokens } = await import("@/lib/user-profile");
      const hidden = await getHiddenTokens();
      return ok({ hidden });
    }
  );

  server.tool(
    "hide_token",
    "Permanently hide a token from the user's portfolio + holdings (per-user scam blocklist). " +
      "Use when the user complains about an obvious scam airdrop showing in their dashboard. Idempotent — hiding a token twice is a no-op.",
    {
      chain: ChainSchema,
      address: z.string().describe("ERC-20 contract address (0x… 40 hex)"),
      symbol: z.string().optional().describe("Token symbol at the time of hiding (kept for the UI list)"),
    },
    async ({ chain, address, symbol }) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return errText("address must be 0x… (40 hex chars)");
      try {
        const { hideToken } = await import("@/lib/user-profile");
        const hidden = await hideToken({ chain: chain ?? "ethereum", address, symbol });
        return ok({ added: { chain: chain ?? "ethereum", address: address.toLowerCase(), symbol }, hidden });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "unhide_token",
    "Remove a token from the user's hidden blocklist so it reappears in holdings + portfolio.",
    {
      chain: ChainSchema,
      address: z.string().describe("ERC-20 contract address (0x… 40 hex)"),
    },
    async ({ chain, address }) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return errText("address must be 0x… (40 hex chars)");
      try {
        const { unhideToken } = await import("@/lib/user-profile");
        const hidden = await unhideToken({ chain: chain ?? "ethereum", address });
        return ok({ removed: { chain: chain ?? "ethereum", address: address.toLowerCase() }, hidden });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  // ===========================================================
  // DeFi — TRANSFERS / APPROVALS / WRAP / LP (V2 + V3)
  // ===========================================================

  server.tool(
    "resolve_ens",
    "Resolve an ENS name to an Ethereum address. Always resolves against Ethereum mainnet (ENS lives there); the result address works on any EVM chain.",
    { name: z.string().describe("ENS name like alice.eth") },
    async ({ name }) => {
      const { resolveRecipient } = await import("@/lib/defi/transfers");
      try {
        const r = await resolveRecipient(name);
        return ok({ name, address: r.address });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "request_transfer",
    "Queue an ETH or ERC-20 transfer for user approval at /pending. " +
      "Pass asset='ETH' for native ETH, or a token symbol/address for ERC-20. " +
      "Recipient can be a 0x address or an ENS name (resolved via mainnet).",
    {
      walletId: z.string().describe("Wallet id from list_wallets. Must be owned + unlocked."),
      to: z.string().describe("Recipient: 0x address or alice.eth"),
      amount: z.string().describe("Human-readable amount, e.g. '0.5' or '1000'"),
      asset: z.string().optional().describe("'ETH' (default), a symbol like 'USDC', or a 0x address"),
      chain: ChainSchema,
      groupId: GroupIdSchema,
      groupTitle: GroupTitleSchema,
    },
    async ({ walletId, to, amount, asset, chain, groupId, groupTitle }) => {
      const c: ChainId = chain ?? "ethereum";
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      if (w.kind === "watch") {
        return errText(`Wallet "${w.label}" is watch-only — transfers require a private key.`);
      }
      if (!isUnlocked(walletId)) return errText(`Wallet ${w.label} is locked. Unlock it first.`);

      try {
        const { prepareTransfer } = await import("@/lib/defi/transfers");
        const plan = await prepareTransfer({ from: w.address as Address, to, amount, asset, chain: c });
        const id = crypto.randomUUID();
        enqueuePending({
        groupId,
        groupTitle,
          id,
          kind: "transfer",
          walletId,
          walletAddress: w.address as `0x${string}`,
          chain: c,
          to: plan.to,
          toEns: plan.toEns,
          asset: plan.kind === "eth" ? { kind: "eth" } : { kind: "erc20", token: plan.token },
          amount: plan.amount,
          amountWei: plan.amountWei,
          status: "pending",
          requestedAt: Date.now(),
          summary:
            plan.kind === "eth"
              ? `Transfer ${plan.amount} ETH → ${plan.toEns ?? plan.to.slice(0, 6) + "…" + plan.to.slice(-4)}`
              : `Transfer ${plan.amount} ${plan.token.symbol} → ${plan.toEns ?? plan.to.slice(0, 6) + "…" + plan.to.slice(-4)}`,
        });
        await logAction({
          action: "transfer_queued",
          actor: "claude",
          target: { wallet: { id: walletId, address: w.address, kind: "owned" } },
          result: {
            expected_output_amount: plan.amount,
            expected_output_symbol: plan.kind === "eth" ? "ETH" : plan.token.symbol,
          },
          linked_refs: [{ type: "wallet", id: walletId, address: w.address }],
        }).catch(() => {});
        return ok({ pendingId: id, status: "pending", plan });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "request_approve_token",
    "Queue an ERC-20 approval for user approval at /pending. " +
      "Use this to pre-approve a router, vault, or any contract to spend your tokens. " +
      "Amount can be 'max' / 'unlimited' for MAX_UINT256.",
    {
      walletId: z.string(),
      token: z.string().describe("Token symbol or 0x address"),
      spender: z.string().describe("0x contract address that will be authorized to spend"),
      amount: z.string().default("max").describe("'max' or a human-readable amount"),
      chain: ChainSchema,
      groupId: GroupIdSchema,
      groupTitle: GroupTitleSchema,
    },
    async ({ walletId, token, spender, amount, chain, groupId, groupTitle }) => {
      const c: ChainId = chain ?? "ethereum";
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      if (w.kind === "watch") return errText(`Wallet "${w.label}" is watch-only.`);
      if (!isUnlocked(walletId)) return errText(`Wallet ${w.label} is locked.`);

      try {
        const { prepareApprove } = await import("@/lib/defi/approvals");
        const plan = await prepareApprove({
          owner: w.address as Address,
          token,
          spender,
          amount,
          chain: c,
        });
        const id = crypto.randomUUID();
        enqueuePending({
        groupId,
        groupTitle,
          id,
          kind: "approve",
          walletId,
          walletAddress: w.address as `0x${string}`,
          chain: c,
          token: plan.token,
          spender: plan.spender,
          amount: plan.amount,
          amountWei: plan.amountWei,
          status: "pending",
          requestedAt: Date.now(),
          summary: `Approve ${plan.amount === "max" ? "unlimited" : plan.amount} ${plan.token.symbol} → ${plan.spender.slice(0, 6)}…${plan.spender.slice(-4)}`,
        });
        await logAction({
          action: "approve_queued",
          actor: "claude",
          target: { wallet: { id: walletId, address: w.address, kind: "owned" } },
          result: { expected_output_symbol: plan.token.symbol },
          linked_refs: [{ type: "wallet", id: walletId, address: w.address }],
        }).catch(() => {});
        return ok({ pendingId: id, status: "pending", plan });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "get_allowance",
    "Read current ERC-20 allowance: how much the given spender can withdraw from the owner's balance.",
    {
      walletId: z.string(),
      token: z.string(),
      spender: z.string(),
      chain: ChainSchema,
    },
    async ({ walletId, token, spender, chain }) => {
      const c: ChainId = chain ?? "ethereum";
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      const t = await uniswap.findToken(token, c);
      if (!t) return errText(`Could not find token ${token} on ${c}`);
      const { getAllowance } = await import("@/lib/defi/approvals");
      const allowance = await getAllowance({
        owner: w.address as Address,
        token: t.address as Address,
        spender: spender as Address,
        chain: c,
      });
      return ok({
        owner: w.address,
        token: { address: t.address, symbol: t.symbol, decimals: t.decimals },
        spender,
        allowanceWei: allowance.toString(),
        allowance: formatUnits(allowance, t.decimals),
        isUnlimited: allowance > 10n ** 30n,
      });
    }
  );

  server.tool(
    "request_wrap_eth",
    "Queue an ETH → WETH wrap (or WETH → ETH unwrap) for user approval at /pending.",
    {
      walletId: z.string(),
      amount: z.string().describe("Amount in ETH (human-readable)"),
      direction: z.enum(["wrap", "unwrap"]).default("wrap"),
      chain: ChainSchema,
      groupId: GroupIdSchema,
      groupTitle: GroupTitleSchema,
    },
    async ({ walletId, amount, direction, chain, groupId, groupTitle }) => {
      const c: ChainId = chain ?? "ethereum";
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      if (w.kind === "watch") return errText(`Wallet "${w.label}" is watch-only.`);
      if (!isUnlocked(walletId)) return errText(`Wallet ${w.label} is locked.`);

      try {
        const { prepareWrap } = await import("@/lib/defi/wrapped");
        const plan = await prepareWrap({
          owner: w.address as Address,
          amount,
          direction,
          chain: c,
        });
        const id = crypto.randomUUID();
        enqueuePending({
        groupId,
        groupTitle,
          id,
          kind: plan.kind,
          walletId,
          walletAddress: w.address as `0x${string}`,
          chain: c,
          amount: plan.amount,
          amountWei: plan.amountWei,
          weth: plan.weth,
          status: "pending",
          requestedAt: Date.now(),
          summary: plan.kind === "wrap_eth" ? `Wrap ${plan.amount} ETH → WETH` : `Unwrap ${plan.amount} WETH → ETH`,
        });
        await logAction({
          action: "wrap_queued",
          actor: "claude",
          target: { wallet: { id: walletId, address: w.address, kind: "owned" } },
          result: { expected_output_amount: plan.amount, expected_output_symbol: plan.kind === "wrap_eth" ? "WETH" : "ETH" },
          linked_refs: [{ type: "wallet", id: walletId, address: w.address }],
        }).catch(() => {});
        return ok({ pendingId: id, status: "pending", plan });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  // ---- Uniswap V2 LP ----

  server.tool(
    "request_add_liquidity_v2",
    "Queue an addLiquidity on Uniswap V2 for user approval at /pending. " +
      "Pass either token as 'ETH' to use addLiquidityETH (router wraps internally). " +
      "Amounts should be roughly at the pool's current ratio; the router uses whichever side is binding.",
    {
      walletId: z.string(),
      tokenA: z.string().describe("Symbol or 0x address (or 'ETH')"),
      tokenB: z.string().describe("Symbol or 0x address (or 'ETH')"),
      amountA: z.string(),
      amountB: z.string(),
      slippageBps: z.number().int().min(1).max(5000).default(100),
      chain: ChainSchema,
      groupId: GroupIdSchema,
      groupTitle: GroupTitleSchema,
    },
    async ({ walletId, tokenA, tokenB, amountA, amountB, slippageBps, chain, groupId, groupTitle }) => {
      const c: ChainId = chain ?? "ethereum";
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      if (w.kind === "watch") return errText(`Wallet "${w.label}" is watch-only.`);
      if (!isUnlocked(walletId)) return errText(`Wallet ${w.label} is locked.`);

      try {
        const { prepareAddLiquidityV2 } = await import("@/lib/defi/uniswap-v2-lp");
        const plan = await prepareAddLiquidityV2({
          owner: w.address as Address,
          tokenA,
          tokenB,
          amountA,
          amountB,
          slippageBps,
          chain: c,
        });
        const id = crypto.randomUUID();
        enqueuePending({
        groupId,
        groupTitle,
          id,
          kind: "add_liquidity_v2",
          walletId,
          walletAddress: w.address as `0x${string}`,
          chain: c,
          tokenA: plan.tokenA,
          tokenB: plan.tokenB,
          amountA: plan.amountA,
          amountAWei: plan.amountAWei,
          amountB: plan.amountB,
          amountBWei: plan.amountBWei,
          slippageBps: plan.slippageBps,
          deadline: plan.deadline,
          status: "pending",
          requestedAt: Date.now(),
          summary: `Add V2 LP: ${plan.amountA} ${plan.tokenA.symbol} + ${plan.amountB} ${plan.tokenB.symbol}`,
        });
        await logAction({
          action: "lp_queued",
          actor: "claude",
          target: { wallet: { id: walletId, address: w.address, kind: "owned" } },
          result: { expected_output_symbol: `${plan.tokenA.symbol}/${plan.tokenB.symbol}` },
          linked_refs: [{ type: "wallet", id: walletId, address: w.address }],
        }).catch(() => {});
        return ok({ pendingId: id, status: "pending", plan });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "request_remove_liquidity_v2",
    "Queue a removeLiquidity on Uniswap V2. Pass either token as 'ETH' to receive ETH instead of WETH.",
    {
      walletId: z.string(),
      tokenA: z.string(),
      tokenB: z.string(),
      lpAmount: z.string().describe("LP token amount to burn (human-readable, 18 decimals)"),
      slippageBps: z.number().int().min(1).max(5000).default(100),
      chain: ChainSchema,
      groupId: GroupIdSchema,
      groupTitle: GroupTitleSchema,
    },
    async ({ walletId, tokenA, tokenB, lpAmount, slippageBps, chain, groupId, groupTitle }) => {
      const c: ChainId = chain ?? "ethereum";
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      if (w.kind === "watch") return errText(`Wallet "${w.label}" is watch-only.`);
      if (!isUnlocked(walletId)) return errText(`Wallet ${w.label} is locked.`);

      try {
        const { prepareRemoveLiquidityV2 } = await import("@/lib/defi/uniswap-v2-lp");
        const plan = await prepareRemoveLiquidityV2({
          owner: w.address as Address,
          tokenA,
          tokenB,
          lpAmount,
          slippageBps,
          chain: c,
        });
        const id = crypto.randomUUID();
        enqueuePending({
        groupId,
        groupTitle,
          id,
          kind: "remove_liquidity_v2",
          walletId,
          walletAddress: w.address as `0x${string}`,
          chain: c,
          tokenA: plan.tokenA,
          tokenB: plan.tokenB,
          pair: plan.pair,
          lpAmount: plan.lpAmount,
          lpAmountWei: plan.lpAmountWei,
          minAmountA: plan.expectedAmountA,
          minAmountAWei: plan.amountAMinWei,
          minAmountB: plan.expectedAmountB,
          minAmountBWei: plan.amountBMinWei,
          slippageBps: plan.slippageBps,
          deadline: plan.deadline,
          status: "pending",
          requestedAt: Date.now(),
          summary: `Remove V2 LP: ${plan.lpAmount} ${plan.tokenA.symbol}/${plan.tokenB.symbol} → ~${plan.expectedAmountA} ${plan.tokenA.symbol} + ~${plan.expectedAmountB} ${plan.tokenB.symbol}`,
        });
        await logAction({
          action: "lp_queued",
          actor: "claude",
          target: { wallet: { id: walletId, address: w.address, kind: "owned" } },
          linked_refs: [{ type: "wallet", id: walletId, address: w.address }],
        }).catch(() => {});
        return ok({ pendingId: id, status: "pending", plan });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "list_lp_positions_v2",
    "List a wallet's Uniswap V2 LP positions for the given pairs. " +
      "V2 has no on-chain indexer, so you must specify which pairs to inspect.",
    {
      walletId: z.string(),
      pairs: z
        .array(z.object({ tokenA: z.string(), tokenB: z.string() }))
        .min(1)
        .describe("Pairs to check, e.g. [{tokenA:'WETH', tokenB:'USDC'}]"),
      chain: ChainSchema,
    },
    async ({ walletId, pairs, chain }) => {
      const c: ChainId = chain ?? "ethereum";
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      const { listLpPositionsV2 } = await import("@/lib/defi/uniswap-v2-lp");
      const rows = await listLpPositionsV2({ owner: w.address as Address, pairs, chain: c });
      return ok({ wallet: w.address, chain: c, positions: rows });
    }
  );

  // ---- Uniswap V3 LP ----

  server.tool(
    "request_add_liquidity_v3",
    "Queue a Uniswap V3 mint (new concentrated-liquidity position NFT). " +
      "Fee tiers: 100, 500, 3000, 10000 (in bps×100). " +
      "Price bounds are token1/token0 in the sorted convention; omit both for a full-range position. " +
      "V3 does not accept native ETH — wrap to WETH first if your input is ETH.",
    {
      walletId: z.string(),
      tokenA: z.string(),
      tokenB: z.string(),
      fee: z.union([z.literal(100), z.literal(500), z.literal(3000), z.literal(10000)]),
      amountA: z.string(),
      amountB: z.string(),
      priceLower: z.number().optional().describe("Lower price bound (token1/token0). Omit for full-range."),
      priceUpper: z.number().optional().describe("Upper price bound (token1/token0). Omit for full-range."),
      slippageBps: z.number().int().min(1).max(5000).default(100),
      chain: ChainSchema,
      groupId: GroupIdSchema,
      groupTitle: GroupTitleSchema,
    },
    async ({ walletId, tokenA, tokenB, fee, amountA, amountB, priceLower, priceUpper, slippageBps, chain, groupId, groupTitle }) => {
      const c: ChainId = chain ?? "ethereum";
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      if (w.kind === "watch") return errText(`Wallet "${w.label}" is watch-only.`);
      if (!isUnlocked(walletId)) return errText(`Wallet ${w.label} is locked.`);

      try {
        const { prepareAddLiquidityV3 } = await import("@/lib/defi/uniswap-v3-lp");
        const plan = await prepareAddLiquidityV3({
          owner: w.address as Address,
          tokenA,
          tokenB,
          fee,
          amountA,
          amountB,
          priceLower,
          priceUpper,
          slippageBps,
          chain: c,
        });
        const id = crypto.randomUUID();
        enqueuePending({
        groupId,
        groupTitle,
          id,
          kind: "add_liquidity_v3",
          walletId,
          walletAddress: w.address as `0x${string}`,
          chain: c,
          token0: plan.token0,
          token1: plan.token1,
          fee: plan.fee,
          tickLower: plan.tickLower,
          tickUpper: plan.tickUpper,
          amount0Desired: plan.amount0Desired,
          amount0DesiredWei: plan.amount0DesiredWei,
          amount1Desired: plan.amount1Desired,
          amount1DesiredWei: plan.amount1DesiredWei,
          amount0MinWei: plan.amount0MinWei,
          amount1MinWei: plan.amount1MinWei,
          slippageBps: plan.slippageBps,
          deadline: plan.deadline,
          status: "pending",
          requestedAt: Date.now(),
          summary: `Mint V3 LP: ${plan.amount0Desired} ${plan.token0.symbol} + ${plan.amount1Desired} ${plan.token1.symbol} (fee ${plan.fee})`,
        });
        await logAction({
          action: "lp_queued",
          actor: "claude",
          target: { wallet: { id: walletId, address: w.address, kind: "owned" } },
          linked_refs: [{ type: "wallet", id: walletId, address: w.address }],
        }).catch(() => {});
        return ok({ pendingId: id, status: "pending", plan });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "request_exit_liquidity_v3",
    "Queue a full exit of a Uniswap V3 LP position: decreaseLiquidity to 0 + collect all (principal + fees), optionally burn the NFT. " +
      "Get tokenId from list_lp_positions_v3.",
    {
      walletId: z.string(),
      tokenId: z.string().describe("V3 position NFT id"),
      burnAfter: z.boolean().default(true).describe("If true, burn the NFT after exit (cleaner). Set false to keep the empty NFT for re-deposit later."),
      chain: ChainSchema,
      groupId: GroupIdSchema,
      groupTitle: GroupTitleSchema,
    },
    async ({ walletId, tokenId, burnAfter, chain, groupId, groupTitle }) => {
      const c: ChainId = chain ?? "ethereum";
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      if (w.kind === "watch") return errText(`Wallet "${w.label}" is watch-only.`);
      if (!isUnlocked(walletId)) return errText(`Wallet ${w.label} is locked.`);

      try {
        const { prepareExitLiquidityV3 } = await import("@/lib/defi/uniswap-v3-lp");
        const plan = await prepareExitLiquidityV3({
          owner: w.address as Address,
          tokenId,
          slippageBps: 100,
          burnAfter,
          chain: c,
        });
        const id = crypto.randomUUID();
        enqueuePending({
        groupId,
        groupTitle,
          id,
          kind: "exit_liquidity_v3",
          walletId,
          walletAddress: w.address as `0x${string}`,
          chain: c,
          tokenId: plan.tokenId,
          token0: plan.token0,
          token1: plan.token1,
          liquidity: plan.liquidity,
          amount0MinWei: plan.amount0MinWei,
          amount1MinWei: plan.amount1MinWei,
          burnAfter: plan.burnAfter,
          deadline: plan.deadline,
          status: "pending",
          requestedAt: Date.now(),
          summary: `Exit V3 LP position #${plan.tokenId} (${plan.token0.symbol}/${plan.token1.symbol})${plan.burnAfter ? " + burn" : ""}`,
        });
        await logAction({
          action: "lp_queued",
          actor: "claude",
          target: { wallet: { id: walletId, address: w.address, kind: "owned" } },
          linked_refs: [{ type: "wallet", id: walletId, address: w.address }],
        }).catch(() => {});
        return ok({ pendingId: id, status: "pending", plan });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "list_lp_positions_v3",
    "List a wallet's Uniswap V3 LP positions (concentrated-liquidity NFTs). " +
      "Returns tokenId, token0, token1, fee tier, tick range, liquidity, and uncollected fees per position.",
    { walletId: z.string(), chain: ChainSchema },
    async ({ walletId, chain }) => {
      const c: ChainId = chain ?? "ethereum";
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      const { listLpPositionsV3 } = await import("@/lib/defi/uniswap-v3-lp");
      const positions = await listLpPositionsV3({ owner: w.address as Address, chain: c });
      return ok({ wallet: w.address, chain: c, positions });
    }
  );

  // ============================================================================
  // UNISWAPX — limit orders + TWAP (off-chain, gasless, signed via EIP-712)
  // ============================================================================

  server.tool(
    "request_limit_order",
    "Queue a UniswapX LIMIT ORDER for the user to approve in the Arkive UI. " +
      "Off-chain order — no gas to submit; fillers pay gas when the price " +
      "hits. User MUST click Approve at /pending before it's signed + " +
      "submitted.\n\n" +
      "Use when the user says 'sell X at $Y' or 'buy X if it drops to $Z' — " +
      "not for immediate market swaps (use request_swap for those). " +
      "Supports Ethereum + Base.\n\n" +
      "Inputs:\n" +
      "  amountIn        — total input amount (human-readable, e.g. '13391.14')\n" +
      "  minAmountOut    — minimum acceptable output, sets the limit price floor\n" +
      "                    (human-readable, e.g. '325' for 325 USDC)\n" +
      "  deadlineHours   — how long the order stays live (default 24, max 720)\n",
    {
      walletId: z.string(),
      fromToken: z.string(),
      toToken: z.string(),
      amountIn: z.string(),
      minAmountOut: z.string(),
      deadlineHours: z.number().int().min(1).max(720).default(24),
      chain: ChainSchema,
      groupId: GroupIdSchema,
      groupTitle: GroupTitleSchema,
    },
    async ({ walletId, fromToken, toToken, amountIn, minAmountOut, deadlineHours, chain, groupId, groupTitle }) => {
      const c: ChainId = chain ?? "ethereum";
      const { isChainSupported } = await import("@/lib/uniswapx");
      if (!isChainSupported(c)) {
        return errText(`UniswapX is not supported on chain '${c}'. Try ethereum or base.`);
      }
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      if (w.kind === "watch") return errText(`Wallet "${w.label}" is watch-only.`);
      if (!isUnlocked(walletId)) return errText(`Wallet ${w.label} is locked.`);
      const account = getUnlocked(walletId)!;

      const src = await uniswap.findToken(fromToken, c);
      const dst = await uniswap.findToken(toToken, c);
      if (!src) return errText(`Unknown fromToken: ${fromToken} on ${c}`);
      if (!dst) return errText(`Unknown toToken: ${toToken} on ${c}`);

      const amountInWei = parseUnits(amountIn, src.decimals).toString();
      const minAmountOutWei = parseUnits(minAmountOut, dst.decimals).toString();

      // Balance check (mirrors request_swap)
      if (uniswap.isNativeEth(src)) {
        const eth = await getEthBalance(account.address, c);
        if (BigInt(eth.wei) < BigInt(amountInWei)) {
          return errText(`Insufficient ETH on ${c}. Wallet has ${eth.eth}, order needs ${amountIn}.`);
        }
      } else {
        const tb = await getTokenBalance(account.address, src.address, c);
        if (BigInt(tb.wei) < BigInt(amountInWei)) {
          return errText(`Insufficient ${src.symbol} on ${c}. Wallet has ${tb.formatted}, order needs ${amountIn}.`);
        }
      }

      const deadline = Math.floor(Date.now() / 1000) + deadlineHours * 3600;
      const id = crypto.randomUUID();
      enqueuePending({
        groupId,
        groupTitle,
        id,
        kind: "limit_order",
        walletId,
        walletAddress: account.address,
        chain: c,
        fromToken: { address: src.address, symbol: src.symbol, decimals: src.decimals },
        toToken: { address: dst.address, symbol: dst.symbol, decimals: dst.decimals },
        amountIn,
        amountInWei,
        minAmountOut,
        minAmountOutWei,
        deadline,
        status: "pending",
        requestedAt: Date.now(),
        summary: `Limit: ${amountIn} ${src.symbol} → ≥${minAmountOut} ${dst.symbol} (UniswapX, ${deadlineHours}h)`,
      });
      return ok({
        pendingOrderId: id,
        chain: c,
        deadline,
        message:
          `UniswapX limit order queued. User approves at /pending. ` +
          `Limit price floor: ${minAmountOut} ${dst.symbol} for ${amountIn} ${src.symbol}. ` +
          `Expires in ${deadlineHours}h. Zero gas cost — fillers cover it.`,
      });
    }
  );

  server.tool(
    "request_twap_order",
    "Queue a TWAP (time-weighted average price) order — splits a total " +
      "into N equal UniswapX limit-order chunks with staggered deadlines so " +
      "fillers pick them up across a time window. Mirrors the Uniswap UI's " +
      "TWAP behavior (it does the same client-side chunking).\n\n" +
      "Use when the user wants to average into / out of a position over " +
      "minutes to hours rather than getting one fill at one price. " +
      "Honesty: this is BATCHED LIMIT ORDERS — not on-chain continuous " +
      "execution. If the market moves a lot during the window, some chunks " +
      "may not fill (each child is priced at submission-time minimum).\n\n" +
      "Inputs:\n" +
      "  totalAmountIn        — total input across all chunks (human-readable)\n" +
      "  chunks               — 2–50 child orders\n" +
      "  intervalMinutes      — spacing between chunk deadlines (≥1 min)\n" +
      "  minAmountOutPerChunk — per-chunk minimum output floor (human-readable)\n",
    {
      walletId: z.string(),
      fromToken: z.string(),
      toToken: z.string(),
      totalAmountIn: z.string(),
      chunks: z.number().int().min(2).max(50),
      intervalMinutes: z.number().int().min(1).max(1440),
      minAmountOutPerChunk: z.string(),
      chain: ChainSchema,
      groupId: GroupIdSchema,
      groupTitle: GroupTitleSchema,
    },
    async ({ walletId, fromToken, toToken, totalAmountIn, chunks, intervalMinutes, minAmountOutPerChunk, chain, groupId, groupTitle }) => {
      const c: ChainId = chain ?? "ethereum";
      const { isChainSupported } = await import("@/lib/uniswapx");
      if (!isChainSupported(c)) {
        return errText(`UniswapX is not supported on chain '${c}'.`);
      }
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      if (w.kind === "watch") return errText(`Wallet "${w.label}" is watch-only.`);
      if (!isUnlocked(walletId)) return errText(`Wallet ${w.label} is locked.`);
      const account = getUnlocked(walletId)!;

      const src = await uniswap.findToken(fromToken, c);
      const dst = await uniswap.findToken(toToken, c);
      if (!src) return errText(`Unknown fromToken: ${fromToken} on ${c}`);
      if (!dst) return errText(`Unknown toToken: ${toToken} on ${c}`);

      const totalAmountInWei = parseUnits(totalAmountIn, src.decimals).toString();
      const minAmountOutPerChunkWei = parseUnits(minAmountOutPerChunk, dst.decimals).toString();

      // Balance check (full total, not per-chunk — all submitted at once)
      if (uniswap.isNativeEth(src)) {
        const eth = await getEthBalance(account.address, c);
        if (BigInt(eth.wei) < BigInt(totalAmountInWei)) {
          return errText(`Insufficient ETH on ${c}. Wallet has ${eth.eth}, TWAP needs ${totalAmountIn}.`);
        }
      } else {
        const tb = await getTokenBalance(account.address, src.address, c);
        if (BigInt(tb.wei) < BigInt(totalAmountInWei)) {
          return errText(`Insufficient ${src.symbol} on ${c}. Wallet has ${tb.formatted}, TWAP needs ${totalAmountIn}.`);
        }
      }

      const baseDeadline = Math.floor(Date.now() / 1000) + 3600; // first chunk: 1h
      const intervalSeconds = intervalMinutes * 60;
      const id = crypto.randomUUID();
      enqueuePending({
        groupId,
        groupTitle,
        id,
        kind: "twap_order",
        walletId,
        walletAddress: account.address,
        chain: c,
        fromToken: { address: src.address, symbol: src.symbol, decimals: src.decimals },
        toToken: { address: dst.address, symbol: dst.symbol, decimals: dst.decimals },
        totalAmountIn,
        totalAmountInWei,
        chunks,
        intervalSeconds,
        baseDeadline,
        minAmountOutPerChunkWei,
        minAmountOutPerChunk,
        status: "pending",
        requestedAt: Date.now(),
        summary: `TWAP: ${totalAmountIn} ${src.symbol} → ${dst.symbol} over ${chunks} chunks (${intervalMinutes}m spacing, ≥${minAmountOutPerChunk}/chunk)`,
      });
      return ok({
        pendingOrderId: id,
        chain: c,
        chunks,
        totalDurationMinutes: chunks * intervalMinutes,
        message:
          `UniswapX TWAP queued. User approves at /pending. ${chunks} chunks of ` +
          `~${(parseFloat(totalAmountIn) / chunks).toFixed(6)} ${src.symbol} each, ${intervalMinutes}m apart. ` +
          `Total window: ~${(chunks * intervalMinutes)} min.`,
      });
    }
  );

  server.tool(
    "list_open_orders",
    "List the user's open UniswapX orders across all wallets (or a specific " +
      "wallet). Returns orderId, status, deadline, fill progress.",
    {
      walletId: z.string().optional().describe("If omitted, lists across all owned wallets."),
      status: z
        .enum(["open", "filled", "expired", "cancelled"])
        .optional()
        .describe("Filter by status."),
    },
    async ({ walletId, status }) => {
      const { listOrders } = await import("@/lib/uniswapx");
      const wallets = await listWallets();
      const targets = walletId
        ? wallets.filter((w) => w.id === walletId && w.kind === "owned")
        : wallets.filter((w) => w.kind === "owned");
      if (targets.length === 0) return errText("No matching owned wallets.");

      try {
        const all = [];
        for (const w of targets) {
          const r = await listOrders({ swapper: w.address as `0x${string}`, orderStatus: status });
          for (const o of r.orders ?? []) {
            all.push({ ...o, wallet_id: w.id, wallet_label: w.label, wallet_address: w.address });
          }
        }
        return ok({ count: all.length, orders: all });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "get_order_status",
    "Get the live status of a single UniswapX order by orderId. Returns " +
      "open / filled / expired / cancelled plus fill amount + tx hash if filled.",
    { orderId: z.string() },
    async ({ orderId }) => {
      const { getStatus } = await import("@/lib/uniswapx");
      try {
        return ok(await getStatus(orderId));
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "cancel_limit_order",
    "Stop tracking a UniswapX limit order on Arkive's side. The order is " +
      "off-chain — letting it expire is FREE (no on-chain cancel needed). " +
      "This tool removes it from the pending queue if it's still pending; " +
      "for already-submitted orders, the user can either let the deadline " +
      "pass or call the reactor's on-chain cancel (separate flow, costs gas).",
    {
      pendingOrderId: z
        .string()
        .describe("The pendingOrderId returned by request_limit_order — NOT the UniswapX orderId."),
    },
    async ({ pendingOrderId }) => {
      const { getPending, updatePending } = await import("@/lib/state");
      const op = getPending(pendingOrderId);
      if (!op) return errText(`No pending op with id ${pendingOrderId}`);
      if (op.status !== "pending") {
        return errText(
          `Pending op is already ${op.status} — to cancel a submitted UniswapX order, ` +
            `let the deadline expire or call the reactor's on-chain cancel (not implemented in this MVP).`
        );
      }
      updatePending(pendingOrderId, { status: "rejected", resolvedAt: Date.now() });
      return ok({ ok: true, pendingOrderId, status: "rejected" });
    }
  );

  // ============================================================================
  // HYPERLIQUID — perps + spot account, place / cancel / close / leverage
  //
  // The Hyperliquid account IS your Ethereum address. Deposit USDC via
  // the Arbitrum bridge (separate, off-Arkive flow today) and the same
  // owned wallet trades + signs.
  // ============================================================================

  server.tool(
    "hl_get_state",
    "Full Hyperliquid account snapshot for a wallet: total equity, " +
      "withdrawable margin, all open perpetual positions (with PnL + " +
      "leverage + liquidation price), spot balances, and open orders. " +
      "One call — use this as the canonical 'where do I stand on " +
      "Hyperliquid' answer.",
    {
      walletId: z.string().describe("Owned wallet id from list_wallets. Hyperliquid uses the same EVM address."),
    },
    async ({ walletId }) => {
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      try {
        const { getState } = await import("@/lib/hyperliquid");
        return ok(await getState(w.address as `0x${string}`));
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "hl_get_market",
    "Current orderbook + mark price for a Hyperliquid perp. Use to " +
      "quote before placing orders.",
    {
      coin: z.string().describe("Coin symbol — BTC, ETH, SOL, HYPE, etc."),
    },
    async ({ coin }) => {
      try {
        const { getMarket } = await import("@/lib/hyperliquid");
        return ok(await getMarket(coin));
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "hl_list_markets",
    "List every Hyperliquid perpetual coin with its asset index, size " +
      "decimals, and max leverage. Use when the user asks 'what's " +
      "tradeable' or you need to verify a coin exists before quoting.",
    {},
    async () => {
      try {
        const { listMarkets } = await import("@/lib/hyperliquid");
        return ok({ markets: await listMarkets() });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "hl_request_order",
    "Queue a Hyperliquid perpetual order. Goes through the standard " +
      "/pending approval flow before signing + submission.\n\n" +
      "Use:\n" +
      "  tif='Gtc' + price ≠ market — resting LIMIT order\n" +
      "  tif='Ioc' + price ≈ market with slippage room — MARKET-style fill\n" +
      "  tif='Alo' — POST-ONLY limit (rejected if it would cross)\n\n" +
      "For a market BUY use price ≈ mark * 1.005 (50 bps buffer). For a " +
      "market SELL use price ≈ mark * 0.995. Call hl_get_market first " +
      "to get the current mark.\n\n" +
      "Set reduceOnly=true when closing or reducing an existing position — " +
      "guarantees the order can't accidentally open opposite exposure.",
    {
      walletId: z.string(),
      coin: z.string(),
      side: z.enum(["buy", "sell"]),
      size: z.string().describe("Position size as decimal string (e.g. '0.05' for 0.05 BTC)."),
      price: z.string().describe("Limit price as decimal string."),
      tif: z.enum(["Gtc", "Ioc", "Alo"]).default("Gtc"),
      reduceOnly: z.boolean().default(false),
      groupId: GroupIdSchema,
      groupTitle: GroupTitleSchema,
    },
    async ({ walletId, coin, side, size, price, tif, reduceOnly, groupId, groupTitle }) => {
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      if (w.kind === "watch") return errText(`Wallet "${w.label}" is watch-only.`);
      if (!isUnlocked(walletId)) return errText(`Wallet ${w.label} is locked.`);
      const account = getUnlocked(walletId)!;

      const id = crypto.randomUUID();
      enqueuePending({
        groupId,
        groupTitle,
        id,
        kind: "hl_order",
        walletId,
        walletAddress: account.address,
        chain: "ethereum", // not used by HL execution; satisfies the PendingBase typing
        coin: coin.toUpperCase(),
        isBuy: side === "buy",
        size,
        price,
        tif,
        reduceOnly,
        status: "pending",
        requestedAt: Date.now(),
        summary: `Hyperliquid ${side.toUpperCase()} ${size} ${coin.toUpperCase()} @ ${price} (${tif}${reduceOnly ? ", reduce-only" : ""})`,
      });
      return ok({
        pendingOrderId: id,
        message:
          `Hyperliquid order queued. User approves at /pending. ` +
          `${side.toUpperCase()} ${size} ${coin.toUpperCase()} @ ${price} (${tif}${reduceOnly ? ", reduce-only" : ""}).`,
      });
    }
  );

  server.tool(
    "hl_request_cancel_order",
    "Cancel an open Hyperliquid order by its oid (numeric — get from " +
      "hl_get_state.open_orders[].oid). One-tap gate — reversing a " +
      "queued action, no new exposure.",
    {
      walletId: z.string(),
      coin: z.string(),
      orderId: z.number().int().describe("Numeric Hyperliquid oid."),
      groupId: GroupIdSchema,
      groupTitle: GroupTitleSchema,
    },
    async ({ walletId, coin, orderId, groupId, groupTitle }) => {
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      if (w.kind === "watch") return errText(`Wallet "${w.label}" is watch-only.`);
      if (!isUnlocked(walletId)) return errText(`Wallet ${w.label} is locked.`);
      const account = getUnlocked(walletId)!;

      const id = crypto.randomUUID();
      enqueuePending({
        groupId,
        groupTitle,
        id,
        kind: "hl_cancel",
        walletId,
        walletAddress: account.address,
        chain: "ethereum",
        coin: coin.toUpperCase(),
        hlOrderId: orderId,
        status: "pending",
        requestedAt: Date.now(),
        summary: `Hyperliquid: cancel ${coin.toUpperCase()} order #${orderId}`,
      });
      return ok({ pendingOrderId: id });
    }
  );

  server.tool(
    "hl_request_close_position",
    "Close a Hyperliquid position by submitting a reduce-only IOC order " +
      "for the exact inverse size at mark ± slippage. Hard_confirm gate.",
    {
      walletId: z.string(),
      coin: z.string(),
      slippageBps: z
        .number()
        .int()
        .min(1)
        .max(5000)
        .default(100)
        .describe("Slippage off mark for the synthetic IOC price. 100 = 1%."),
      groupId: GroupIdSchema,
      groupTitle: GroupTitleSchema,
    },
    async ({ walletId, coin, slippageBps, groupId, groupTitle }) => {
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      if (w.kind === "watch") return errText(`Wallet "${w.label}" is watch-only.`);
      if (!isUnlocked(walletId)) return errText(`Wallet ${w.label} is locked.`);
      const account = getUnlocked(walletId)!;

      // Look up current position size so the /pending UI summary shows
      // exactly what's about to close.
      try {
        const { getState } = await import("@/lib/hyperliquid");
        const state = await getState(account.address as `0x${string}`);
        const pos = state.perp.positions.find((p) => p.coin.toUpperCase() === coin.toUpperCase());
        if (!pos || parseFloat(pos.szi) === 0) {
          return errText(`No open position in ${coin.toUpperCase()} to close.`);
        }
        const id = crypto.randomUUID();
        enqueuePending({
        groupId,
        groupTitle,
          id,
          kind: "hl_close_position",
          walletId,
          walletAddress: account.address,
          chain: "ethereum",
          coin: coin.toUpperCase(),
          positionSize: pos.szi,
          slippageBps,
          status: "pending",
          requestedAt: Date.now(),
          summary: `Hyperliquid: close ${coin.toUpperCase()} (${pos.szi} contracts, slippage ${slippageBps}bps)`,
        });
        return ok({ pendingOrderId: id, positionSize: pos.szi });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "hl_request_update_leverage",
    "Set leverage for a Hyperliquid coin (per-asset, not per-position). " +
      "One-tap gate — changes margin settings but doesn't move funds. " +
      "Affects all current and future positions in this coin.",
    {
      walletId: z.string(),
      coin: z.string(),
      leverage: z
        .number()
        .int()
        .min(1)
        .max(50)
        .describe("Integer leverage. Max varies per coin — check hl_list_markets."),
      marginMode: z.enum(["cross", "isolated"]).default("cross"),
      groupId: GroupIdSchema,
      groupTitle: GroupTitleSchema,
    },
    async ({ walletId, coin, leverage, marginMode, groupId, groupTitle }) => {
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      if (w.kind === "watch") return errText(`Wallet "${w.label}" is watch-only.`);
      if (!isUnlocked(walletId)) return errText(`Wallet ${w.label} is locked.`);
      const account = getUnlocked(walletId)!;

      const id = crypto.randomUUID();
      enqueuePending({
        groupId,
        groupTitle,
        id,
        kind: "hl_leverage",
        walletId,
        walletAddress: account.address,
        chain: "ethereum",
        coin: coin.toUpperCase(),
        leverage,
        isCross: marginMode === "cross",
        status: "pending",
        requestedAt: Date.now(),
        summary: `Hyperliquid: set ${coin.toUpperCase()} leverage to ${leverage}x ${marginMode}`,
      });
      return ok({ pendingOrderId: id });
    }
  );

  server.tool(
    "hl_get_fills",
    "Recent fills (executed trades) for a Hyperliquid account. Use to " +
      "answer 'what did I trade,' 'how am I doing this week,' or to " +
      "reconstruct trade history for journaling.\n\n" +
      "Returns each fill's coin, side, price, size, time, direction " +
      "(Open Long / Close Short / Buy / etc), realized PnL on that " +
      "specific fill, and fee. Plus rolled-up totals for the slice.\n\n" +
      "Filter by `coin` to scope to one asset (e.g. just BTC fills). " +
      "Filter by `sinceMs` (Unix milliseconds) to get only recent — " +
      "without it you get up to 2000 fills back to account inception.",
    {
      walletId: z.string(),
      coin: z.string().optional().describe("Optional coin filter — case-insensitive."),
      sinceMs: z
        .number()
        .int()
        .optional()
        .describe(
          "Unix milliseconds. Only return fills at or after this time. Use Date.now() - 7*24*3600*1000 for past week."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .default(200)
        .describe("Cap on returned fills (after filtering)."),
      aggregateByTime: z
        .boolean()
        .default(true)
        .describe(
          "When true, partial fills of the same crossing order are aggregated into one row. Usually what you want for 'list my trades.'"
        ),
    },
    async ({ walletId, coin, sinceMs, limit, aggregateByTime }) => {
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      try {
        const { getFills } = await import("@/lib/hyperliquid");
        return ok(
          await getFills({
            user: w.address as `0x${string}`,
            coin,
            since: sinceMs,
            limit,
            aggregateByTime,
          })
        );
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "hl_get_funding_history",
    "Funding payments paid/received on perpetual positions over a time " +
      "window. Perp-specific — every funding interval (every hour) " +
      "generates a row for each coin the user holds a position in.\n\n" +
      "Returns per-payment {coin, time, funding_rate, position_size, " +
      "usdc} + a rolled-up total_usdc (positive = user PAID funding, " +
      "negative = user RECEIVED funding).",
    {
      walletId: z.string(),
      sinceMs: z
        .number()
        .int()
        .optional()
        .describe("Unix ms. Default = 7 days ago."),
      untilMs: z
        .number()
        .int()
        .optional()
        .describe("Unix ms. Default = now."),
    },
    async ({ walletId, sinceMs, untilMs }) => {
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      try {
        const { getFundingHistory } = await import("@/lib/hyperliquid");
        return ok(
          await getFundingHistory({
            user: w.address as `0x${string}`,
            since: sinceMs,
            until: untilMs,
          })
        );
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "hl_get_ledger",
    "Non-funding ledger updates for a Hyperliquid account — deposits, " +
      "withdrawals, internal transfers. Use to answer 'how much have I " +
      "deposited,' 'when did I withdraw,' or to reconstruct net capital " +
      "flow.\n\n" +
      "Returns per-event {time, type, usdc, hash} + rolled-up " +
      "total_deposits + total_withdrawals.",
    {
      walletId: z.string(),
      sinceMs: z
        .number()
        .int()
        .optional()
        .describe("Unix ms. Default = 30 days ago."),
      untilMs: z
        .number()
        .int()
        .optional()
        .describe("Unix ms. Default = now."),
    },
    async ({ walletId, sinceMs, untilMs }) => {
      const wallets = await listWallets();
      const w = wallets.find((x) => x.id === walletId);
      if (!w) return errText(`No wallet with id ${walletId}`);
      try {
        const { getLedger } = await import("@/lib/hyperliquid");
        return ok(
          await getLedger({
            user: w.address as `0x${string}`,
            since: sinceMs,
            until: untilMs,
          })
        );
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  // ============================================================================
  // UNIVERSAL CORE TOOLS — arkive-core-v1
  //
  // Every practice (trading + any user-installed) operates through these.
  // Practice-specific writers like `request_swap` above wrap chain-side
  // business logic; everything that touches the substrate (markdown +
  // frontmatter + index) goes through THESE tools.
  // ============================================================================

  server.tool(
    "read_arkive",
    "⭐ CALL THIS FIRST in every conversation. Returns the session-start " +
      "bundle, top-loaded with a CAPABILITY MANIFEST so you know the full " +
      "tool surface + practice population without any mid-session discovery.\n\n" +
      "Bundle shape (per Phase 4 §7 load economics):\n" +
      "  capability — Top of bundle. Read FIRST. Lists every installed\n" +
      "      practice with mode + version + declared entity_types +\n" +
      "      context_files + link_types + tools (with gates) + population\n" +
      "      status (empty / awaiting_structure / partially_populated /\n" +
      "      populated). Includes the universal entity_type + link_type\n" +
      "      vocabulary. Tells you the stream observation count + the\n" +
      "      routed_to tally so you see which practices the user has\n" +
      "      been thinking about.\n" +
      "  protocol/identity/loadup — universal root files.\n" +
      "  practices[] — per-practice digest:\n" +
      "      context (full bodies, small), pending_insights (full bodies),\n" +
      "      recent_journal (CAPPED ~15 full bodies),\n" +
      "      older_journal_summary (paths + entity_type + title + date —\n" +
      "        bodies on demand via read_entity),\n" +
      "      journal_by_entity_type (counts only),\n" +
      "      skill_index (paths only — skills are situation-triggered).\n" +
      "  recent_observations — newest slice of the universal stream.\n\n" +
      "COMPACTED for context economy: current state (identity, loadup,\n" +
      "context, pending_insights, instructions) is FULL; recent\n" +
      "observations + journal are SNIPPETS; older journal, skills, and\n" +
      "accepted/rejected insights are listed by PATH only. Counts\n" +
      "(observation_count, journal_by_entity_type, entry_count) are EXACT —\n" +
      "answer how-many/when/which from them, don't open files to count.\n" +
      "When you need a body that isn't inlined: call read_entity(path).\n" +
      "The summaries + counts tell you whether it's worth the read. See\n" +
      "loading_note in the bundle.",
    {},
    async () => {
      const { readArkive, projectBundleForModel } = await import("@/lib/arkive-v2/read-bundle");
      try {
        return ok(projectBundleForModel(await readArkive()));
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "list_practices",
    "List every installed practice with its config summary (name, description, " +
      "loading mode, entry count). Use to discover what domains the user has " +
      "set up. Already in the read_arkive bundle; call this directly when " +
      "you need a fresh enumeration.",
    {},
    async () => {
      const { listPractices } = await import("@/lib/arkive-v2/practices");
      try {
        return ok({ practices: await listPractices() });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "get_practice_config",
    "Load a practice's full practice.config — declares its journal entity " +
      "types, context files, skill format, link types, MCP tools, constraints, " +
      "loading mode, and insight_flow settings. Use to understand what a " +
      "practice supports before writing into it.",
    {
      practice: z.string().describe("Practice slug, e.g. 'trading'."),
    },
    async (args) => {
      const { getPracticeConfig } = await import("@/lib/arkive-v2/practices");
      try {
        const cfg = await getPracticeConfig(args.practice);
        if (!cfg) return errText(`Practice '${args.practice}' is not installed.`);
        return ok({ config: cfg });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "list_practice_templates",
    "Reference example practice SHAPES to pattern-match against when setting up a " +
      "NEW user practice. Returns authored templates spanning distinct structural " +
      "shapes — state-heavy (fitness), truth/pattern-heavy (writing), mixed (health), " +
      "business/team (sales) — each showing how to split context into STATE " +
      "(update_mode 'replace') vs TRUTH/PATTERN (update_mode 'accumulate' — the home " +
      "for accepted insights), which journal entity types to declare, and sensible " +
      "insight_flow / loading defaults. Call this BEFORE create_practice / " +
      "update_practice_config during setup: pick the closest SHAPE, then adapt it to " +
      "the user's domain. Pass `key` for one template's full config + placement " +
      "playbook; omit for the compact catalog.",
    {
      key: z
        .string()
        .optional()
        .describe("Template key (fitness | writing | health | sales) for its full config + placement instructions. Omit for the catalog."),
    },
    async (args) => {
      const { PRACTICE_TEMPLATES, templateCatalog } = await import("@/lib/arkive-v2/authored/examples");
      try {
        if (args.key) {
          const t = PRACTICE_TEMPLATES.find((x) => x.key === args.key);
          if (!t)
            return errText(
              `No template '${args.key}'. Available: ${PRACTICE_TEMPLATES.map((x) => x.key).join(", ")}`
            );
          return ok(t);
        }
        return ok({ templates: templateCatalog() });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "create_practice",
    "Create a BARE practice container — the four-folder skeleton + a " +
      "placeholder instructions file, with NO declared entity types or " +
      "context files. Use this AFTER the user has explicitly agreed to start " +
      "tracking a new domain (per the protocol §10 ask-once flow). Do NOT " +
      "call this off topic-detection — structure is earned by knowledge, " +
      "not guessed.\n\n" +
      "After creating, captures about this domain still go to the universal " +
      "stream via capture_observation (the stream is always available). " +
      "Use `update_practice_config` to declare entity types / context files " +
      "ONLY when intake or emergence has actually surfaced the shape. Until " +
      "then, the practice is intentionally empty — that's correct, not " +
      "incomplete.\n\n" +
      "Name 'trading' is reserved.",
    {
      name: z.string().describe("Practice slug (lowercased + dashed)."),
      description: z.string().optional().describe("One-line description."),
      triggers: z
        .array(z.string())
        .optional()
        .describe("Topic keywords that activate this practice when on_demand."),
    },
    async (args) => {
      const { createUserPractice } = await import("@/lib/arkive-v2/practices");
      try {
        return ok(await createUserPractice(args));
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "update_practice_config",
    "Step 2 (+) of shaping a practice. Additively patches an existing " +
      "practice.config: declare new journal entity types, context files, " +
      "link types, MCP tools, constraints, or update loading triggers + " +
      "insight_flow defaults. Idempotent on `name` — re-sending the same " +
      "entity_type/context_file/link_type/mcp_tool/constraint name REPLACES " +
      "the prior declaration in place (so you can correct a typo).\n\n" +
      "The 'trading' practice is verified and cannot be modified through " +
      "this tool.\n\n" +
      "Typical first call after `create_practice('watch-reselling')`:\n" +
      "  - add_entity_types: [\n" +
      "      { name: 'deal', folder: 'deals',\n" +
      "        schema: { required: ['ref', 'brand', 'model', 'price_paid'],\n" +
      "                  optional: ['sold_price', 'sold_date', 'platform'] },\n" +
      "        append_only: true,\n" +
      "        allowed_mutations: { status_field: ['acquired_to_sold'] } }\n" +
      "    ]\n" +
      "  - add_context_files: [\n" +
      "      { name: 'inventory.md', purpose: 'Watches currently held',\n" +
      "        schema: 'structured', update_triggers: ['deal_acquired','deal_sold'] }\n" +
      "    ]\n" +
      "  - set_loading_triggers: ['watch', 'rolex', 'sold', 'flipped']\n\n" +
      "IMPORTANT — a journal entity type's status_field uses TRANSITION syntax, not " +
      "bare states: each entry is '<from>_to_<to>' (e.g. 'planned_to_active', " +
      "'active_to_done'), never 'planned'/'active'/'done'. Configs with bare status " +
      "values are rejected on write.",
    {
      name: z.string().describe("Practice slug to update."),
      patch: z
        .object({
          set_description: z.string().optional(),
          set_loading_default_mode: z.enum(["active", "on_demand", "private"]).optional(),
          set_loading_triggers: z.array(z.string()).optional(),
          set_insight_flow: z
            .object({
              default_output: z.enum(["skill", "context", "both", "ask_user"]).optional(),
              evidence_threshold: z.number().int().min(1).optional(),
              evidence_types: z.array(z.string()).optional(),
              rejection_cooldown_threshold: z.number().int().min(1).optional(),
            })
            .optional(),
          add_entity_types: z
            .array(
              z.object({
                name: z.string(),
                folder: z.string(),
                schema: z.object({
                  required: z.array(z.string()),
                  optional: z.array(z.string()).optional(),
                }),
                append_only: z.boolean(),
                allowed_mutations: z
                  .object({
                    status_field: z
                      .array(z.string())
                      .optional()
                      .describe(
                        "Allowed status TRANSITIONS in '<from>_to_<to>' form — NOT bare states. " +
                          "For a deal lifecycle planned→active→done, pass " +
                          "['planned_to_active','active_to_done'] (never ['planned','active','done']). " +
                          "Bare-state values are rejected by the validator."
                      ),
                    body_appends: z.array(z.string()).optional(),
                  })
                  .optional(),
              })
            )
            .optional(),
          add_context_files: z
            .array(
              z.object({
                name: z.string().describe("File name including .md (e.g. 'inventory.md')."),
                purpose: z.string(),
                schema: z.enum(["structured", "free_form"]),
                structured_fields: z.array(z.record(z.string())).optional(),
                update_triggers: z.array(z.string()),
                update_mode: z
                  .enum(["replace", "accumulate"])
                  .optional()
                  .describe(
                    "How accepted insights + state updates write into this file. " +
                      "'replace' = STATE context overwritten as it changes (current program, open deals, metrics) — the default. " +
                      "'accumulate' = TRUTH/PATTERN context that GROWS: accepted insights append a new entry (rules, learned-truths, what-works). " +
                      "Declare at least one 'accumulate' file so accepted diagnostic insights have a home."
                  ),
              })
            )
            .optional(),
          add_link_types: z
            .array(
              z.object({
                name: z.string(),
                description: z.string(),
              })
            )
            .optional(),
          add_mcp_tools: z
            .array(
              z.object({
                name: z.string(),
                description: z.string(),
                requires_gate: z.enum(["none", "one_tap", "hard_confirm"]),
              })
            )
            .optional(),
          add_constraints: z
            .array(
              z.object({
                name: z.string(),
                description: z.string(),
              })
            )
            .optional(),
          remove_entity_type: z.string().optional(),
          remove_context_file: z.string().optional(),
          remove_link_type: z.string().optional(),
          remove_mcp_tool: z.string().optional(),
          remove_constraint: z.string().optional(),
          set_skill_format: z
            .object({
              description: z.string(),
              required_sections: z.array(z.string()),
              optional_sections: z.array(z.string()).optional(),
              versioning: z.enum(["semver_per_skill", "integer_per_skill"]),
              envelope_required: z.boolean(),
            })
            .optional(),
          bump_version: z.string().optional().describe("Semver — pass when making a meaningful change."),
        })
        .describe("Additive patch. All fields optional; supply what you want to add/change."),
    },
    async (args) => {
      const { updatePracticeConfig } = await import("@/lib/arkive-v2/practices");
      try {
        return ok(await updatePracticeConfig(args.name, args.patch));
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "write_entity",
    "Write a new entity inside any practice. The universal write — every " +
      "frontmatter field required by the practice's schema is enforced, and " +
      "arkive.index is updated atomically. Folders are implicit: passing " +
      "subpath 'journal/trades/2026-05-17-eth.md' creates the trades/ folder " +
      "if missing.\n\n" +
      "Refuses to overwrite existing journal entries unless `mutation` is set " +
      "(e.g. mutation: { status_field: 'open_to_closed' }) AND the practice " +
      "declared that mutation as allowed.",
    {
      practice: z.string().describe("Practice slug the entity belongs to."),
      entity_type: z
        .string()
        .describe("Universal (identity/insight/skill) or practice-declared type."),
      subpath: z
        .string()
        .describe("Path relative to the practice root, ending in .md."),
      body: z.string().describe("Markdown body."),
      meta: z
        .record(z.unknown())
        .optional()
        .describe(
          "Frontmatter — entity_type/practice/created_at are auto-filled. Include practice-required fields per the practice.config schema."
        ),
      mutation: z
        .object({
          status_field: z.string().optional(),
          body_append: z.string().optional(),
        })
        .optional()
        .describe("Set only when modifying an existing entry via a declared mutation."),
    },
    async (args) => {
      const { writeEntity } = await import("@/lib/arkive-v2/write-entity");
      try {
        return ok(await writeEntity(args));
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "append_to_entity",
    "Append a named section to an existing entity's body. Only allowed when " +
      "the practice's allowed_mutations.body_appends includes the section " +
      "name. Use for outcome notes on a closed trade, dated updates on " +
      "research, etc.",
    {
      practice: z.string(),
      entity_type: z.string(),
      subpath: z.string(),
      section_name: z
        .string()
        .describe("Must match one of the declared body_appends sections."),
      body: z.string(),
      createIfMissing: z
        .object({
          meta: z.record(z.unknown()),
          initialBody: z.string().optional(),
        })
        .optional(),
    },
    async (args) => {
      const { appendToEntity } = await import("@/lib/arkive-v2/write-entity");
      try {
        return ok(await appendToEntity(args));
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "read_entity",
    "Read a single entity by (practice, subpath). Returns { path, meta, body } " +
      "or null if missing.",
    {
      practice: z.string(),
      subpath: z.string(),
    },
    async (args) => {
      const { readEntity } = await import("@/lib/arkive-v2/write-entity");
      try {
        return ok(await readEntity(args));
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "list_entries",
    "List entries under (practice, optional subpath). Returns paths + meta " +
      "only — no body. Cheap. Use to scan what exists before deciding write " +
      "vs append.",
    {
      practice: z.string(),
      subpath: z.string().optional().describe("Optional folder filter, e.g. 'journal/trades'."),
    },
    async (args) => {
      const { listEntries } = await import("@/lib/arkive-v2/write-entity");
      try {
        return ok({ entries: await listEntries(args) });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "propose_insight",
    "File a candidate pattern as a pending insight. Per §9-10 of the spec: " +
      "evidence MUST point to real files; proposed_output declares whether " +
      "this leads to a skill, a context update, both, or asks the user.\n\n" +
      "Propose BOTH kinds, weighted equally: prescriptive how-to-act rules " +
      '(proposed_output: "skill") AND durable, non-obvious diagnostic ' +
      "observations about the user or their patterns (proposed_output: " +
      '"context"). A strong observation is worth filing as much as an ' +
      "actionable rule — don't withhold it just because it isn't a " +
      "prescription.\n\n" +
      "The runtime moves the insight to accepted/ or rejected/ when the user " +
      "decides — DO NOT skip the gate by writing accepted/ directly.",
    {
      practice: z.string(),
      title: z.string().describe("Short slug — becomes the filename."),
      summary: z
        .string()
        .describe("One-paragraph description of the pattern."),
      evidence: z
        .array(z.string())
        .describe("List of paths to journal entries supporting this pattern. Must be real files."),
      proposed_output: z
        .enum(["skill", "context", "both", "ask_user"])
        .describe("What this insight should produce on acceptance."),
      target_context_file: z
        .string()
        .optional()
        .describe(
          "For a context/both insight: which declared context file it lands in on " +
            "acceptance (e.g. 'rules.md'). This is your placement judgment — pick the " +
            "practice's accumulate/TRUTH context file that best fits. Omit ⇒ the accept " +
            "path uses the practice's first accumulate context file."
        ),
      triggered_by: z.array(z.string()).optional(),
    },
    async (args) => {
      // C5: file through the single shared propose path — the daydream loop
      // uses the same function, so the on-disk shape can never drift.
      const { proposeInsight } = await import("@/lib/arkive-v2/propose-insight");
      try {
        return ok(
          await proposeInsight({
            practice: args.practice,
            title: args.title,
            summary: args.summary,
            evidence: args.evidence,
            proposedOutput: args.proposed_output,
            targetContextFile: args.target_context_file,
            triggeredBy: args.triggered_by,
          })
        );
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "decide_insight",
    "Move a pending insight to accepted/ or rejected/. On ACCEPT: the insight is " +
      "relocated to insights/accepted/ (status flipped, resolution note appended, " +
      "index updated) AND projected into durable structure per its proposed_output — " +
      "a versioned skill in skills/ (old version archived per §4) and/or the learned " +
      "truth written into its target context file (accumulate/TRUTH context appends a " +
      "new entry; replace/STATE context overwrites), carrying created_from/triggered_by " +
      "provenance back to the insight + its evidence. 'ask_user' currently writes as " +
      "context (interactive placement is deferred). If the practice has no context " +
      "file home yet, the insight still moves to accepted/ and a note is returned. " +
      "On reject: records the user's reasoning + a cooldown_until timestamp; no projection.",
    {
      pending_path: z
        .string()
        .describe("Full path to the pending insight, e.g. arkive/practices/<name>/insights/pending/<file>.md"),
      decision: z.enum(["accept", "reject"]),
      reasoning: z.string().optional().describe("Required for reject — captured in the body."),
      reason_type: z
        .enum(["useful", "wrong", "not_useful", "too_speculative", "dont_care"])
        .optional()
        .describe(
          "Optional structured reason (§5.4) — makes feedback countable for the daydream loop. " +
            "Recorded alongside the free-text reasoning; not acted on by any durable learner in v1."
        ),
    },
    async (args) => {
      const { storage, currentUserId } = await import("@/lib/storage");
      const { parseFrontmatter, serializeEntry } = await import("@/lib/arkive-v2/frontmatter");
      const { readArkiveConfig } = await import("@/lib/arkive-v2/arkive-config");
      const { updateIndexForEntry } = await import("@/lib/arkive-v2/arkive-index");
      try {
        const uid = await currentUserId();
        const adapter = storage();
        const existing = await adapter.readEntry(uid, args.pending_path);
        if (!existing) return errText(`No pending insight at ${args.pending_path}`);
        const { meta, body } = parseFrontmatter(existing.body);
        const m = meta as Record<string, unknown>;
        const targetStatus = args.decision === "accept" ? "accepted" : "rejected";
        const newPath = args.pending_path.replace("/insights/pending/", `/insights/${targetStatus}/`);
        const now = new Date();
        const updated: Record<string, unknown> = {
          ...m,
          status: targetStatus,
          resolution_date: now.toISOString(),
        };
        // §5.4: structured, countable feedback for the daydream loop. Recorded
        // only — no durable learner reads it in v1.
        if (args.reason_type) updated.reason_type = args.reason_type;
        if (args.decision === "reject") {
          const cfg = await readArkiveConfig();
          const cooldownDays = Math.max(7, cfg.defaults.rejection_cooldown_threshold * 3);
          const cool = new Date(now);
          cool.setDate(cool.getDate() + cooldownDays);
          updated.cooldown_until = cool.toISOString();
        }
        const newBody = args.reasoning
          ? `${body.trim()}\n\n## Resolution\n\n${args.reasoning.trim()}\n`
          : body;
        await adapter.writeEntry(uid, {
          path: newPath,
          body: serializeEntry(updated, newBody),
          meta: updated,
        });
        await adapter.deleteEntry(uid, args.pending_path);
        await updateIndexForEntry(newPath);

        // On accept, project the insight into durable structure (the shared
        // path both loops graduate through). A projection miss never undoes the
        // move — it returns a note instead.
        let projected: unknown;
        if (args.decision === "accept") {
          const { projectAcceptedInsight } = await import("@/lib/arkive-v2/project-insight");
          try {
            projected = await projectAcceptedInsight({
              practice: String(m.practice ?? ""),
              insightPath: newPath,
              summary: body.trim(),
              proposedOutput:
                (m.proposed_output as "skill" | "context" | "both" | "ask_user") ?? "context",
              targetContextFile:
                typeof m.target_context_file === "string" ? m.target_context_file : undefined,
              evidence: Array.isArray(m.evidence)
                ? (m.evidence as unknown[]).filter((x): x is string => typeof x === "string")
                : [],
            });
          } catch (e) {
            projected = { error: (e as Error).message };
          }
        }
        return ok({ moved_to: newPath, status: targetStatus, ...(projected ? { projected } : {}) });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "traverse_index",
    "Walk the arkive.index link graph from any file. Returns forward (outgoing) " +
      "or backward (incoming) traversal up to `depth` hops. Use BEFORE making " +
      "grounded claims — fetches the chain of evidence + provenance for free.",
    {
      file_path: z.string().describe("Full path to start traversal from."),
      direction: z.enum(["forward", "backward", "both"]).default("both"),
      depth: z.number().int().min(1).max(6).default(2),
    },
    async (args) => {
      const { buildIndex, traverse } = await import("@/lib/arkive-v2/arkive-index");
      try {
        const idx = await buildIndex();
        return ok(
          traverse(idx, {
            filePath: args.file_path,
            direction: args.direction,
            depth: args.depth,
          })
        );
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "scan_emergence",
    "Walk the universal observation stream and surface (a) PATTERN " +
      "CANDIDATES — clusters of observations sharing a kind or mention " +
      "that have crossed the evidence threshold (default ≥3), and (b) " +
      "PRACTICE SUGGESTIONS — routed_to hints accumulating against " +
      "practices that don't exist yet (default ≥5).\n\n" +
      "Use this when you want to (i) formulate a propose_insight call " +
      "with real evidence, or (ii) decide whether to surface the §10 " +
      "ask-once nudge about starting a new practice.\n\n" +
      "PURE READ — never commits structure. Per protocol §2: emergence " +
      "is permission to ASK, never permission to BUILD.\n\n" +
      "read_arkive already returns these in capability.pattern_candidates " +
      "+ capability.practice_suggestions; call this tool when you want a " +
      "fresh scan (e.g. after a burst of captures in the same session).",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(5000)
        .optional()
        .describe("Optional cap on observations scanned. Default: scan the whole stream."),
    },
    async (args) => {
      const { scanEmergence } = await import("@/lib/arkive-v2/emergence");
      const { readArkiveConfig } = await import("@/lib/arkive-v2/arkive-config");
      try {
        const cfg = await readArkiveConfig();
        const report = await scanEmergence({
          installed_practice_names: Object.keys(cfg.practices),
          limit: args.limit,
        });
        return ok(report);
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "suggest_intake_questions",
    "Returns a short list of shape questions to run conversationally " +
      "after the user opts into a new practice. Use AFTER create_practice — " +
      "the answers license your follow-up update_practice_config call(s) " +
      "(adding journal_entity_types, context_files, loading triggers, " +
      "and shaping the practice.instructions.md).\n\n" +
      "Per protocol §2: 'a few questions, not a survey.' Skippable. If " +
      "the user dismisses intake or trails off, STAY IN RAW CAPTURE — " +
      "do NOT half-declare a phantom schema. Captures keep going to " +
      "the stream until intake completes or emergence surfaces enough " +
      "evidence later.\n\n" +
      "The default catalog is generic (events / state / triggers / " +
      "limits). Feel free to follow up with domain-specific questions if " +
      "the practice name suggests them (e.g. for a 'watches' practice " +
      "you might also ask 'Do you hold inventory or broker deals you " +
      "don't own?').",
    {
      practice: z.string().describe("The practice slug the user just opted into."),
    },
    async (args) => {
      const { defaultIntakeQuestions } = await import("@/lib/arkive-v2/emergence");
      try {
        return ok({
          practice: args.practice,
          questions: defaultIntakeQuestions(args.practice),
          guidance:
            "Run these conversationally — one beat, not a wizard. " +
            "Each answer maps to a config patch. If the user skips or " +
            "trails off, captures continue to the stream and no " +
            "structure gets committed.",
        });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  server.tool(
    "capture_observation",
    "The spine of the stream-first model. Captures a raw observation into " +
      "the universal stream. NEVER FAILS on input — no schema validation, no " +
      "required practice routing. Use this whenever the user says or does " +
      "something worth remembering: a trade decision, a deal moving, a " +
      "research thought, a rule articulated, anything.\n\n" +
      "DEFAULT TO CAPTURE. The system is designed around the assumption that " +
      "capture is cheap and structure emerges later — either authored " +
      "(packaged practice), via intake when the user opts in, or via " +
      "emergence once enough observations accrete that a real pattern is " +
      "visible. Do NOT wait until you can route to a practice; capture " +
      "first, route hints second.\n\n" +
      "Fields:\n" +
      "  body       — freeform; exactly what was said or what you observed.\n" +
      "  kind       — OPTIONAL loose hint (e.g. 'trade_close', 'watch_deal',\n" +
      "               'design_critique'). No enum; pick whatever fits.\n" +
      "  mentions   — OPTIONAL extracted entities (asset tickers, project\n" +
      "               names, wallet labels). Improves retrieval.\n" +
      "  routed_to  — OPTIONAL best-guess practice slug ('trading', etc.).\n" +
      "               Hint only; observation still lives at the stream root.\n" +
      "  created_at — OPTIONAL ISO timestamp; defaults to now. Set when\n" +
      "               backfilling historical data.",
    {
      body: z.string().describe("The observation body. Freeform; can be empty if all signal is in the hints."),
      kind: z.string().optional().describe("Loose hint, freeform — no enum."),
      mentions: z.array(z.string()).optional().describe("Extracted entity tags (assets, projects, wallets)."),
      routed_to: z.string().optional().describe("Best-guess practice slug for routing. Not a structural commitment."),
      created_at: z.string().optional().describe("ISO timestamp. Defaults to now."),
    },
    async (args) => {
      const { capture } = await import("@/lib/arkive-v2/stream");
      try {
        const obs = await capture({
          body: args.body,
          kind: args.kind,
          mentions: args.mentions,
          routedTo: args.routed_to,
          createdAt: args.created_at,
        });
        return ok({
          path: obs.path,
          captured_at: obs.meta.created_at,
          kind: obs.meta.kind,
          routed_to: obs.meta.routed_to,
        });
      } catch (e) {
        return errText((e as Error).message);
      }
    }
  );

  return server;
}

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function errText(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function round(n: number, digits: number): number {
  const m = Math.pow(10, digits);
  return Math.round(n * m) / m;
}

// MCP server instructions — deliberately minimal and universal.
//
// The single source of truth for session-start behavior is the user's own
// `loadup.md` inside their arkive. The protocol governs HOW to operate;
// practice configs govern domain-specific behavior. This text only points
// the AI at those — it does NOT prescribe trading workflow, wallets, or
// any other practice-specific behavior. Adding domain instructions here
// would re-create the two-sources-of-truth problem.
const ARKIVE_INSTRUCTIONS = `You are connected to the user's Arkive — their structured, user-owned memory across every domain they're running.

⚠️ MANDATORY FIRST CALL — every conversation: call \`read_arkive\`. It returns:
  • identity.md          — who the user is
  • arkive.protocol.md   — the universal contract that governs your behavior
  • loadup.md            — the USER'S session-start preferences (what to surface, in their words)
  • Every active practice's config + context + recent journal + pending insights

Then DO WHAT loadup.md SAYS. That file is the single source of truth for what
happens at the top of every session. Speak in the user's domain (their trades,
deals, projects, watches, whatever they're tracking) — never about the system,
tools, file paths, or "the protocol."

YOUR ROLE: silent partner. As the user talks, you LOG every development,
decision, change, research finding, and discussion into their arkive
automatically. They keep doing what they always do; you keep compounding
context. When a recurring topic doesn't fit any active practice, suggest
creating one conversationally (one line, not a survey).

Practice-specific tools (wallets, swaps, prices, etc. for the trading
practice; any others a user has installed) ship with their practice. ALL
practice-specific workflow comes from each practice's config — not from
this file. If a tool you need isn't visible, the practice probably hasn't
declared it; check \`get_practice_config\` or just \`list_entries\` to
see what's there.`;

