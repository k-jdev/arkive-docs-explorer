// User profile — the configurable behavior layer.
//
// Stored under the internal-store namespace `_internal/user-profile/<dimension>`.
// NOT part of the user-facing arkive substrate (which is the v2 blueprint under
// `arkive/*`). The user manages this via the dashboard / app UI, not via the
// arkives view.

import { readInternal, writeInternal } from "@/lib/internal-store";

export type Strictness = "lenient" | "normal" | "strict";
export type Verbosity = "terse" | "normal" | "thorough";
export type Register = "explain-terms" | "peer" | "expert";
export type Pushback = "compliant" | "balanced" | "challenging";
export type Confirmation = "always" | "writes-and-financial" | "financial-only" | "never";

export type HiddenToken = {
  chain: "ethereum" | "base";
  /** Address — always lowercased for comparison. */
  address: string;
  /** Symbol at the time of hiding (denormalised — useful for the UI list). */
  symbol?: string;
  /** ISO timestamp of when the user hid the token. */
  hiddenAt: string;
};

export type Defaults = {
  default_chain: "ethereum" | "base" | "ask";
  dust_threshold_usd: number;
  /**
   * Minimum USD value the routing pool must hold on the quote side for a token's
   * price to be considered trustworthy. Below this, priceUsd returns null and the
   * token is rendered "unpriced" rather than counted toward portfolio totals.
   * Default $500 — high enough to filter scam dust pools, low enough to include
   * most legitimate low-cap tokens.
   */
  min_liquidity_usd: number;
  /** Per-user list of tokens to hide from holdings / portfolio entirely. */
  hidden_tokens: HiddenToken[];
};

export type UserProfile = {
  strictness: Strictness;
  verbosity: Verbosity;
  register: Register;
  pushback: Pushback;
  confirmation: Confirmation;
  defaults: Defaults;
};

export const DEFAULT_PROFILE: UserProfile = {
  strictness: "normal",
  verbosity: "normal",
  register: "peer",
  pushback: "balanced",
  confirmation: "writes-and-financial",
  defaults: {
    default_chain: "ethereum",
    dust_threshold_usd: 1.0,
    min_liquidity_usd: 500,
    hidden_tokens: [],
  },
};

export type ProfileMeta = {
  onboarding_completed_at: string | null;
  /** Version of the question schema the user was onboarded against. */
  schema_version: number | null;
};

const DIMENSION_IDS: Record<keyof UserProfile, string> = {
  strictness: "strictness",
  verbosity: "verbosity",
  register: "register",
  pushback: "pushback",
  confirmation: "confirmation",
  defaults: "defaults",
};

const META_ID = "_meta";
const NAMESPACE = "user-profile";

let _cached: { profile: UserProfile; meta: ProfileMeta; loadedAt: number } | null = null;
const CACHE_TTL_MS = 10_000; // 10s — short enough that set→read in same handler sees fresh values

export async function getUserProfile(force = false): Promise<UserProfile> {
  if (!force && _cached && Date.now() - _cached.loadedAt < CACHE_TTL_MS) {
    return _cached.profile;
  }
  const fresh = await loadProfile();
  return fresh.profile;
}

export async function getProfileMeta(force = false): Promise<ProfileMeta> {
  if (!force && _cached && Date.now() - _cached.loadedAt < CACHE_TTL_MS) {
    return _cached.meta;
  }
  const fresh = await loadProfile();
  return fresh.meta;
}

export function isOnboardingNeeded(meta: ProfileMeta): boolean {
  return !meta.onboarding_completed_at;
}

async function loadProfile(): Promise<{ profile: UserProfile; meta: ProfileMeta }> {
  const profile: UserProfile = { ...DEFAULT_PROFILE };
  for (const [dim, id] of Object.entries(DIMENSION_IDS)) {
    const e = await readInternal(NAMESPACE, id).catch(() => null);
    if (e && e.meta && (e.meta as Record<string, unknown>).value !== undefined) {
      (profile as Record<string, unknown>)[dim] = (e.meta as Record<string, unknown>).value;
    }
  }
  const metaEntry = await readInternal(NAMESPACE, META_ID).catch(() => null);
  const meta: ProfileMeta = {
    onboarding_completed_at:
      ((metaEntry?.meta as Record<string, unknown>)?.onboarding_completed_at as string | undefined) ?? null,
    schema_version:
      ((metaEntry?.meta as Record<string, unknown>)?.schema_version as number | undefined) ?? null,
  };
  _cached = { profile, meta, loadedAt: Date.now() };
  return { profile, meta };
}

export async function setProfileDimension<K extends keyof UserProfile>(
  dimension: K,
  value: UserProfile[K]
): Promise<void> {
  const id = DIMENSION_IDS[dimension];
  await writeInternal({
    namespace: NAMESPACE,
    id,
    meta: { dimension, value: value as unknown },
    body: `User-profile dimension: ${dimension}. Edit via the app UI; never edit this file by hand.`,
  });
  _cached = null;
}

export async function markOnboardingComplete(schemaVersion: number): Promise<void> {
  await writeInternal({
    namespace: NAMESPACE,
    id: META_ID,
    meta: {
      onboarding_completed_at: new Date().toISOString(),
      schema_version: schemaVersion,
    },
    body: "Onboarding completed.",
  });
  _cached = null;
}

// Helper used by tools that need a quick read (e.g. dust filter)
export async function getDustThresholdUsd(): Promise<number> {
  const p = await getUserProfile();
  return p.defaults.dust_threshold_usd;
}

export async function getMinLiquidityUsd(): Promise<number> {
  const p = await getUserProfile();
  return p.defaults.min_liquidity_usd ?? 500;
}

// ============================================================================
// Hidden tokens — per-user blocklist for scam/spam tokens that should never
// appear in holdings or contribute to portfolio totals.
// ============================================================================

function normalizeAddr(addr: string): string {
  return addr.trim().toLowerCase();
}

export async function getHiddenTokens(): Promise<HiddenToken[]> {
  const p = await getUserProfile();
  return p.defaults.hidden_tokens ?? [];
}

export async function isTokenHidden(chain: HiddenToken["chain"], address: string): Promise<boolean> {
  const list = await getHiddenTokens();
  const needle = normalizeAddr(address);
  return list.some((t) => t.chain === chain && t.address === needle);
}

export async function hideToken(args: {
  chain: HiddenToken["chain"];
  address: string;
  symbol?: string;
}): Promise<HiddenToken[]> {
  const profile = await getUserProfile(true);
  const next = [...(profile.defaults.hidden_tokens ?? [])];
  const needle = normalizeAddr(args.address);
  if (!next.some((t) => t.chain === args.chain && t.address === needle)) {
    next.push({
      chain: args.chain,
      address: needle,
      symbol: args.symbol,
      hiddenAt: new Date().toISOString(),
    });
  }
  await setProfileDimension("defaults", { ...profile.defaults, hidden_tokens: next });
  return next;
}

export async function unhideToken(args: { chain: HiddenToken["chain"]; address: string }): Promise<HiddenToken[]> {
  const profile = await getUserProfile(true);
  const needle = normalizeAddr(args.address);
  const next = (profile.defaults.hidden_tokens ?? []).filter(
    (t) => !(t.chain === args.chain && t.address === needle)
  );
  await setProfileDimension("defaults", { ...profile.defaults, hidden_tokens: next });
  return next;
}
