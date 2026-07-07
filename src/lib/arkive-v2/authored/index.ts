// The authored-practices registry — the single seam between the core engine
// and packaged ("authored") practices.
//
// Core (paths, stream, practices, arkive-config, read-bundle, migrate) is
// fully practice-agnostic: it knows the universal shape (stream + the
// four-folder practice skeleton) and nothing about any specific domain.
//
// A packaged practice is one a human expert encoded up front so it's useful
// on a fresh install with zero user data (protocol §2, source-of-knowing #1:
// "Authored"). Such practices register here. Today that's only trading;
// adding another is a one-line append to AUTHORED_PRACTICES.
//
// The core asks this module three questions and nothing more:
//   - which packaged practices should a fresh arkive install? (defaultArkiveConfig)
//   - is this practice name a packaged one? (verified flag, sort order)
//   - is this name reserved? (block user create/modify collisions)
//
// It must never import core practice-management code (practices.ts,
// arkive-config.ts) — that would invert the dependency. It depends only on
// schemas (types) and paths (generic helpers).

import type { PracticeConfigFile } from "../schemas";
import { tradingAuthoredPractice } from "./trading";

/** A practice that ships pre-installed, authored by a domain expert. */
export type AuthoredPractice = {
  /** Practice slug. Reserved — users cannot create or rename onto it. */
  name: string;
  /** Semver registered into arkive.config when the practice is installed. */
  version: string;
  /** The packaged practice.config (declarations). */
  config: () => PracticeConfigFile;
  /** The packaged operational playbook (practice.instructions.md body). */
  instructions: () => string;
  /** Seed context/ files written under the practice's context dir on install. */
  contextSeeds: () => Array<{ filename: string; body: string }>;
};

/** Every packaged practice that ships pre-installed on a fresh arkive. */
export const AUTHORED_PRACTICES: AuthoredPractice[] = [tradingAuthoredPractice];

const AUTHORED_NAMES = new Set(AUTHORED_PRACTICES.map((p) => p.name));

/** True if `name` is a packaged practice (verified; ships pre-installed). */
export function isAuthoredPractice(name: string): boolean {
  return AUTHORED_NAMES.has(name);
}

/**
 * Names users may not create or modify via create_practice /
 * update_practice_config. Today this is exactly the set of authored names,
 * but it's a distinct concept so future reservations (e.g. "core") don't
 * have to be authored practices.
 */
export function isReservedPractice(name: string): boolean {
  return AUTHORED_NAMES.has(name);
}

/** Look up a packaged practice's descriptor by slug. */
export function authoredPracticeByName(name: string): AuthoredPractice | undefined {
  return AUTHORED_PRACTICES.find((p) => p.name === name);
}

/** All packaged practice slugs. */
export function authoredPracticeNames(): string[] {
  return AUTHORED_PRACTICES.map((p) => p.name);
}
