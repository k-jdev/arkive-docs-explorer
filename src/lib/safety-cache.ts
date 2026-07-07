// Module-level cache for GoPlus token-safety lookups.
//
// Why a cache: a portfolio with 20 tokens × ~250ms GoPlus latency = 5s of
// blocking on every dashboard load. The verdict (is this token a scam? is it a
// honeypot?) almost never changes — caching for an hour is safe and turns
// repeated portfolio reads instant.
//
// Why module-level (not Postgres): the answer is independent of which user is
// asking, so it can be shared globally across the lambda. On Vercel each lambda
// instance maintains its own cache; warm invocations benefit, cold ones pay the
// first-fetch cost.

import { fetchTokenSafety, type TokenSafetyReport } from "@/lib/safety";
import type { Address } from "viem";
import type { ChainId } from "@/lib/chains";

const TTL_MS = 60 * 60 * 1000; // 1 hour
const NEGATIVE_TTL_MS = 5 * 60 * 1000; // 5 min for transient API failures

type Entry = {
  verdict: SafetyVerdict;
  expiresAt: number;
};

export type SafetyVerdict = {
  level: TokenSafetyReport["verdict"]["level"]; // "safe" | "caution" | "danger" | "unknown"
  reasons: string[];
  /** Convenience: aggregate score for sorting. Higher = scammier. */
  dangerScore: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __arkiveSafetyCache: Map<string, Entry> | undefined;
}

function store(): Map<string, Entry> {
  if (!globalThis.__arkiveSafetyCache) globalThis.__arkiveSafetyCache = new Map();
  return globalThis.__arkiveSafetyCache;
}

function key(chain: ChainId, address: string): string {
  return `${chain}:${address.toLowerCase()}`;
}

function toVerdict(report: TokenSafetyReport): SafetyVerdict {
  // Roughly map verdict.level → numeric danger score for UI sort/threshold tuning.
  const base =
    report.verdict.level === "danger" ? 10 : report.verdict.level === "caution" ? 3 : report.verdict.level === "unknown" ? 1 : 0;
  return { level: report.verdict.level, reasons: report.verdict.reasons, dangerScore: base };
}

/** Return cached verdict if present, else null. */
function readCache(chain: ChainId, address: string): SafetyVerdict | null {
  const e = store().get(key(chain, address));
  if (!e) return null;
  if (e.expiresAt < Date.now()) {
    store().delete(key(chain, address));
    return null;
  }
  return e.verdict;
}

function writeCache(chain: ChainId, address: string, verdict: SafetyVerdict, ttlMs = TTL_MS) {
  store().set(key(chain, address), { verdict, expiresAt: Date.now() + ttlMs });
}

/**
 * Lookup a token's safety verdict — cache-first. Returns `unknown` if GoPlus
 * doesn't have data (very new token, indexing lag) or if the call itself fails;
 * NEVER throws. Callers should treat `unknown` as "we can't confirm safety, but
 * don't punish the token either."
 */
export async function getTokenSafetyCached(chain: ChainId, address: Address): Promise<SafetyVerdict> {
  const hit = readCache(chain, address);
  if (hit) return hit;
  try {
    const report = await fetchTokenSafety(address, chain);
    const verdict = toVerdict(report);
    writeCache(chain, address, verdict);
    return verdict;
  } catch {
    // Negative cache so we don't hammer GoPlus on broken/un-indexed tokens.
    const verdict: SafetyVerdict = {
      level: "unknown",
      reasons: ["No GoPlus data available."],
      dangerScore: 1,
    };
    writeCache(chain, address, verdict, NEGATIVE_TTL_MS);
    return verdict;
  }
}

/**
 * Parallel batch — returns verdicts in the same order as input. Promise.allSettled
 * so a single failure doesn't poison the whole portfolio render.
 */
export async function batchSafety(
  tokens: Array<{ chain: ChainId; address: Address }>
): Promise<SafetyVerdict[]> {
  const results = await Promise.allSettled(
    tokens.map((t) => getTokenSafetyCached(t.chain, t.address))
  );
  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { level: "unknown" as const, reasons: ["Lookup failed."], dangerScore: 1 }
  );
}
