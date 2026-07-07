// GoPlus token security API — free, no auth required for the basic chain endpoint.
// Docs: https://docs.gopluslabs.io/reference/api-overview-token-security

import type { Address } from "viem";
import { getChain, type ChainId } from "@/lib/chains";

const ENDPOINT = "https://api.gopluslabs.io/api/v1/token_security";

type RawTokenSecurity = {
  is_honeypot?: string;
  cannot_sell_all?: string;
  cannot_buy?: string;
  buy_tax?: string;
  sell_tax?: string;
  transfer_pausable?: string;
  is_anti_whale?: string;
  trading_cooldown?: string;
  hidden_owner?: string;
  is_mintable?: string;
  is_proxy?: string;
  is_open_source?: string;
  external_call?: string;
  selfdestruct?: string;
  owner_address?: string;
  owner_balance?: string;
  creator_address?: string;
  can_take_back_ownership?: string;
  holder_count?: string;
  total_supply?: string;
  lp_holder_count?: string;
  lp_total_supply?: string;
  dex?: Array<{ name: string; liquidity: string; pair: string }>;
  token_name?: string;
  token_symbol?: string;
};

export type TokenSafetyReport = {
  token: { address: Address; name?: string; symbol?: string };
  // High-signal flags ranked roughly by danger
  flags: {
    isHoneypot: boolean | "unknown";
    cannotSellAll: boolean | "unknown";
    cannotBuy: boolean | "unknown";
    transferPausable: boolean;
    isMintable: boolean;
    isProxy: boolean;
    selfdestructible: boolean;
    hasExternalCall: boolean;
    hiddenOwner: boolean;
    canTakeBackOwnership: boolean;
    isAntiWhale: boolean;
    hasCooldown: boolean;
    isOpenSource: boolean;
    ownershipRenounced: boolean;
  };
  fees: { buyTaxPct: number | null; sellTaxPct: number | null };
  market: {
    holderCount: number | null;
    lpHolderCount: number | null;
    totalSupply: string | null;
    dexes: Array<{ name: string; liquidity: number; pair: string }>;
  };
  /** Plain-English summary computed from the flags. */
  verdict: { level: "safe" | "caution" | "danger" | "unknown"; reasons: string[] };
};

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export async function fetchTokenSafety(address: Address, chain: ChainId = "ethereum"): Promise<TokenSafetyReport> {
  const numericId = getChain(chain).numericId;
  const url = `${ENDPOINT}/${numericId}?contract_addresses=${address.toLowerCase()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GoPlus returned HTTP ${res.status}`);
  const body = (await res.json()) as { code: number; message: string; result?: Record<string, RawTokenSecurity> };
  if (body.code !== 1) throw new Error(`GoPlus error: ${body.message}`);
  const raw = body.result?.[address.toLowerCase()];
  if (!raw) throw new Error("No GoPlus data for this token (may be too new or not indexed yet).");
  return shape(address, raw);
}

function shape(address: Address, r: RawTokenSecurity): TokenSafetyReport {
  const f = r.is_honeypot;
  const isHoneypot: boolean | "unknown" = f === "1" ? true : f === "0" ? false : "unknown";
  const cantSell: boolean | "unknown" = r.cannot_sell_all === "1" ? true : r.cannot_sell_all === "0" ? false : "unknown";
  const cantBuy: boolean | "unknown" = r.cannot_buy === "1" ? true : r.cannot_buy === "0" ? false : "unknown";

  const flags = {
    isHoneypot,
    cannotSellAll: cantSell,
    cannotBuy: cantBuy,
    transferPausable: r.transfer_pausable === "1",
    isMintable: r.is_mintable === "1",
    isProxy: r.is_proxy === "1",
    selfdestructible: r.selfdestruct === "1",
    hasExternalCall: r.external_call === "1",
    hiddenOwner: r.hidden_owner === "1",
    canTakeBackOwnership: r.can_take_back_ownership === "1",
    isAntiWhale: r.is_anti_whale === "1",
    hasCooldown: r.trading_cooldown === "1",
    isOpenSource: r.is_open_source === "1",
    ownershipRenounced:
      (r.owner_address ?? "").toLowerCase() === ZERO_ADDR ||
      (r.owner_address ?? "") === "" ||
      r.can_take_back_ownership === "0",
  };

  const fees = {
    buyTaxPct: r.buy_tax ? Math.round(parseFloat(r.buy_tax) * 10000) / 100 : null,
    sellTaxPct: r.sell_tax ? Math.round(parseFloat(r.sell_tax) * 10000) / 100 : null,
  };

  const market = {
    holderCount: r.holder_count ? parseInt(r.holder_count, 10) : null,
    lpHolderCount: r.lp_holder_count ? parseInt(r.lp_holder_count, 10) : null,
    totalSupply: r.total_supply ?? null,
    dexes: (r.dex ?? []).map((d) => ({
      name: d.name,
      liquidity: parseFloat(d.liquidity ?? "0"),
      pair: d.pair,
    })),
  };

  const verdict = computeVerdict(flags, fees, market);

  return {
    token: { address, name: r.token_name, symbol: r.token_symbol },
    flags,
    fees,
    market,
    verdict,
  };
}

function computeVerdict(
  flags: TokenSafetyReport["flags"],
  fees: TokenSafetyReport["fees"],
  market: TokenSafetyReport["market"]
): TokenSafetyReport["verdict"] {
  const reasons: string[] = [];
  let danger = 0;
  let caution = 0;

  if (flags.isHoneypot === true) {
    reasons.push("Flagged as a HONEYPOT — buys may succeed but sells will revert.");
    danger += 10;
  } else if (flags.isHoneypot === "unknown") {
    reasons.push("Honeypot status unknown — proceed cautiously.");
    caution += 1;
  }
  if (flags.cannotSellAll === true) {
    reasons.push("Contract restricts selling the full balance.");
    danger += 5;
  }
  if (flags.cannotBuy === true) {
    reasons.push("Contract currently blocks buys.");
    danger += 5;
  }
  if ((fees.buyTaxPct ?? 0) >= 10 || (fees.sellTaxPct ?? 0) >= 10) {
    reasons.push(`High taxes — buy ${fees.buyTaxPct ?? "?"}% / sell ${fees.sellTaxPct ?? "?"}%.`);
    danger += 3;
  } else if ((fees.buyTaxPct ?? 0) > 0 || (fees.sellTaxPct ?? 0) > 0) {
    reasons.push(`Tokens have transfer tax (buy ${fees.buyTaxPct}% / sell ${fees.sellTaxPct}%).`);
    caution += 1;
  }
  if (flags.transferPausable) {
    reasons.push("Owner can pause transfers.");
    caution += 2;
  }
  if (flags.isMintable) {
    reasons.push("Owner can mint more supply (potential dilution).");
    caution += 2;
  }
  if (flags.canTakeBackOwnership) {
    reasons.push("Ownership can be reclaimed (renounce is reversible).");
    caution += 2;
  }
  if (!flags.isOpenSource) {
    reasons.push("Contract source is NOT verified on Etherscan.");
    caution += 2;
  }
  if (flags.selfdestructible) {
    reasons.push("Contract has selfdestruct capability.");
    danger += 3;
  }
  if (flags.hiddenOwner) {
    reasons.push("Hidden owner detected.");
    caution += 2;
  }
  if ((market.holderCount ?? 0) < 100 && market.holderCount !== null) {
    reasons.push(`Very few holders (${market.holderCount}) — thin distribution.`);
    caution += 1;
  }
  if ((market.lpHolderCount ?? 0) === 0) {
    reasons.push("No LP holders detected — liquidity may be unlocked or absent.");
    caution += 1;
  }

  let level: TokenSafetyReport["verdict"]["level"] = "safe";
  if (danger >= 5) level = "danger";
  else if (caution >= 3 || danger > 0) level = "caution";
  if (reasons.length === 0) reasons.push("No major red flags detected.");

  return { level, reasons };
}
