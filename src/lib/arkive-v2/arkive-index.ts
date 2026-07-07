// arkive.index — auto-maintained JSON link graph (§13 of the spec).
//
// File format: JSON. Every entity in the substrate becomes a node. Universal
// link types (§6) become outgoing edges; the reverse is computed for
// incoming. Forward + backward queries are O(1) per node.
//
// Properties from §13:
//   - Updates atomic with file writes
//   - Rebuildable from scratch by scanning all markdown frontmatter
//   - Cross-practice links are traversable
//
// Per §16's "index integrity" rule: every entity write triggers an atomic
// index update. The writer is responsible — see write-tools.ts.

import { storage, currentUserId, type StoredEntry } from "@/lib/storage";
import {
  PATH_CONFIG,
  PATH_IDENTITY,
  PATH_INDEX,
  PATH_PROTOCOL,
  PRACTICES_DIR,
  V2_ROOT,
} from "./paths";
import { parseFrontmatter } from "./frontmatter";
import { UNIVERSAL_LINK_TYPES, type UniversalLinkType } from "./schemas";

export type IndexNode = {
  entity_type: string;
  practice: string;
  created_at?: string;
  /** version, name, status — whatever the entity exposes in frontmatter. */
  [k: string]: unknown;
  outgoing: Partial<Record<UniversalLinkType, string[]>>;
  incoming: Partial<Record<string, string[]>>;
};

export type ArkiveIndex = {
  version: 1;
  core_version: string;
  /** Schema generation of the extractor. Bumped when the index codec
   *  changes shape OR the extraction logic changes meaningfully (e.g.
   *  picking up practice-declared link types). readIndex() invalidates
   *  caches whose extractor_generation doesn't match. */
  extractor_generation: number;
  last_updated: string;
  nodes: Record<string, IndexNode>;
};

/** Bump this whenever the extractor logic in rebuildIndex changes. Caches
 *  written by older generations get invalidated + rebuilt. */
export const EXTRACTOR_GENERATION = 2;

/** Frontmatter keys that are scalar metadata (not link candidates). */
const NON_LINK_META_KEYS = new Set<string>([
  "entity_type",
  "practice",
  "created_at",
  "last_updated",
  "version",
  "protocol_version",
  "name",
  "title",
  "status",
  "kind",
  "mentions",
  "routed_to",
  "summary",
  "thesis_summary",
  "topic",
  "description",
  "asset",
  "chain",
  "venue",
  "type",
  "side",
  "leverage",
  "size",
  "entry_price",
  "exit_price",
  "exit_date",
  "pnl",
  "trade_id",
  "flagged",
  "topic_tags",
  "user_state_revealed",
  "duration_minutes",
  "target_date",
  "predictions",
  "falsification_criteria",
  "period_start",
  "period_end",
  "highlights",
  "open_questions",
  "envelope_override",
  "resolution_date",
  "cooldown_until",
  "proposed_output",
  "evidence_types",
  "structured_fields",
  "ran_at",
  "touched",
]);

/** Heuristic: does this string look like an internal arkive path? */
function looksLikePath(s: string): boolean {
  if (typeof s !== "string" || s.length === 0) return false;
  if (s.includes(" ")) return false; // titles, not paths
  if (s.startsWith("http://") || s.startsWith("https://")) return false; // URLs (etherscan)
  return (
    s.startsWith("arkive/") ||
    s.startsWith("_internal/") ||
    s.startsWith("practices/") ||
    s.endsWith(".md")
  );
}

/** Normalize a referenced path so it matches the index key format
 *  (arkive/...). Accepts already-prefixed paths, leading-slash variants,
 *  and bare practices/... shorthand. */
function normalizePathRef(ref: string): string {
  let r = ref.trim();
  if (r.startsWith("./")) r = r.slice(2);
  if (r.startsWith("/")) r = r.slice(1);
  if (r.startsWith("arkive/")) return r;
  if (r.startsWith("practices/")) return `${V2_ROOT}/${r}`;
  if (r.endsWith(".md") && !r.includes("/")) return r; // plain filename, leave as-is
  return r;
}

/** Build the full index from scratch by scanning every entry.
 *
 *  The link extractor is INTENTIONALLY heuristic: it scans every frontmatter
 *  field whose value is a string (or array of strings) and treats anything
 *  that resolves to a known entry path as an edge, typed by the field name.
 *  This catches universal link types (sources, evidence, ...), practice-
 *  declared link types (linked_trade, applied_skill, tests_thesis, ...),
 *  and anything else the AI adds in the future — with no per-practice
 *  registration plumbing required.
 */
export async function rebuildIndex(): Promise<ArkiveIndex> {
  const uid = await currentUserId();
  const adapter = storage();
  const all = await adapter.listEntries(uid, `${V2_ROOT}/`);

  const index: ArkiveIndex = {
    version: 1,
    core_version: "arkive-core-v1",
    extractor_generation: EXTRACTOR_GENERATION,
    last_updated: new Date().toISOString(),
    nodes: {},
  };

  // Pass 0 — register every node (without links) so Pass 1's path resolver
  // can verify referenced paths exist.
  for (const e of all) {
    if (skipFromIndex(e.path)) continue;
    const { meta } = parseFrontmatter(e.body);
    const m = (meta ?? {}) as Record<string, unknown>;
    const node: IndexNode = {
      entity_type:
        typeof m.entity_type === "string" ? m.entity_type : "unknown",
      practice: typeof m.practice === "string" ? m.practice : "core",
      created_at: typeof m.created_at === "string" ? m.created_at : undefined,
      outgoing: {},
      incoming: {},
    };
    for (const k of ["version", "name", "status", "last_updated"]) {
      if (m[k] !== undefined) node[k] = m[k];
    }
    index.nodes[e.path] = node;
  }

  // Pass 1 — universal-link extraction + heuristic scan of all other fields.
  // We do both so universal links are always recognized even when the
  // referenced target doesn't (yet) exist in the index — the index can carry
  // broken edges for diagnostics. Non-universal fields are only added when
  // they resolve to a known node, to avoid noise from scalar metadata.
  const knownPaths = new Set(Object.keys(index.nodes));

  for (const e of all) {
    if (skipFromIndex(e.path)) continue;
    const node = index.nodes[e.path];
    if (!node) continue;
    const { meta } = parseFrontmatter(e.body);
    const m = (meta ?? {}) as Record<string, unknown>;

    // (a) Universal link types — always indexed even when the target
    // doesn't resolve, so broken-link analyses work.
    for (const link of UNIVERSAL_LINK_TYPES) {
      const v = m[link];
      const refs = collectStringRefs(v);
      if (refs.length === 0) continue;
      node.outgoing[link] = (node.outgoing[link] ?? []).concat(
        refs.map(normalizePathRef),
      );
    }

    // (b) Heuristic scan — every OTHER frontmatter field. Only kept when
    // the value resolves to a known node, so we don't pollute the graph
    // with random scalar strings.
    for (const [key, value] of Object.entries(m)) {
      if (NON_LINK_META_KEYS.has(key)) continue;
      if ((UNIVERSAL_LINK_TYPES as readonly string[]).includes(key)) continue;
      const refs = collectStringRefs(value);
      const resolved = refs
        .map(normalizePathRef)
        .filter((p) => knownPaths.has(p));
      if (resolved.length === 0) continue;
      const existing =
        (node.outgoing as Record<string, string[] | undefined>)[key] ?? [];
      (node.outgoing as Record<string, string[]>)[key] =
        existing.concat(resolved);
    }
  }

  // Pass 2 — invert outgoing → incoming for fast backward queries
  for (const [path, node] of Object.entries(index.nodes)) {
    for (const [link, targets] of Object.entries(node.outgoing)) {
      for (const target of targets ?? []) {
        const tgt = index.nodes[target];
        if (!tgt) continue;
        if (!tgt.incoming[link]) tgt.incoming[link] = [];
        tgt.incoming[link]!.push(path);
      }
    }
  }

  return index;
}

/** Extract string references from a frontmatter value. Handles single
 *  strings + arrays of strings; filters out non-path-shaped scalars. */
function collectStringRefs(value: unknown): string[] {
  if (typeof value === "string" && looksLikePath(value)) return [value];
  if (Array.isArray(value)) {
    return value.filter(
      (x): x is string => typeof x === "string" && looksLikePath(x),
    );
  }
  return [];
}

/** Read the index off disk; rebuild + persist if missing, unreadable, or
 *  generated by an older extractor (so logic changes auto-invalidate
 *  caches without manual user action). */
export async function readIndex(): Promise<ArkiveIndex> {
  const uid = await currentUserId();
  const entry = await storage().readEntry(uid, PATH_INDEX);
  if (entry) {
    try {
      const parsed = JSON.parse(entry.body) as ArkiveIndex;
      if ((parsed.extractor_generation ?? 0) === EXTRACTOR_GENERATION) {
        return parsed;
      }
      // Stale generation — fall through to rebuild.
    } catch {
      // Corrupt — rebuild.
    }
  }
  const fresh = await rebuildIndex();
  try {
    await writeIndex(fresh);
  } catch {
    // Read-only filesystem (Vercel / serverless). Rebuilding in-memory
    // on every read is cheap when the entry count is small (the litepaper
    // use-case — pre-seeded docs have no mutations at runtime).
  }
  return fresh;
}

/** Persist the index atomically (§16 "index integrity"). */
export async function writeIndex(index: ArkiveIndex): Promise<void> {
  const uid = await currentUserId();
  const body = JSON.stringify(index, null, 2);
  await storage().writeEntry(uid, {
    path: PATH_INDEX,
    body,
    meta: {},
  });
}

/**
 * Atomic update: refresh the entry's node + recompute the affected incoming
 * edges. Called by write-tools on every entity write.
 *
 * Simple implementation for v1: full rebuild. Scales fine to ~10k entries.
 * Future optimization: incremental update touching only the affected node.
 */
export async function updateIndexForEntry(_path: string): Promise<void> {
  const fresh = await rebuildIndex();
  await writeIndex(fresh);
}

/** Skip files that don't belong in the link graph. */
function skipFromIndex(path: string): boolean {
  if (path === PATH_CONFIG) return true; // pure YAML, no frontmatter
  if (path === PATH_INDEX) return true; // the index itself
  if (path.startsWith("_internal/")) return true;
  if (path.endsWith("/practice.config")) return true; // pure YAML
  // Skip raw asset files that aren't markdown entities
  if (
    !path.endsWith(".md") &&
    path !== PATH_IDENTITY &&
    path !== PATH_PROTOCOL
  ) {
    return !path.startsWith(PRACTICES_DIR + "/");
  }
  return false;
}

// ---- Back-compat for callers expecting the old buildIndex shape ------------

/** @deprecated v5: use readIndex() / rebuildIndex(). Returns a flat
 *  list of edges synthesized from the new graph shape. */
export async function buildIndex(): Promise<{
  version: 1;
  computedAt: string;
  nodes: Array<{
    path: string;
    type: string;
    title?: string;
    timestamp?: string;
  }>;
  edges: Array<{ from: string; to: string; type: string; broken?: boolean }>;
  nodeByPath: Map<string, { path: string; type: string }>;
  outgoingByPath: Map<
    string,
    Array<{ from: string; to: string; type: string }>
  >;
  incomingByPath: Map<
    string,
    Array<{ from: string; to: string; type: string }>
  >;
}> {
  const idx = await readIndex();
  const nodes: Array<{
    path: string;
    type: string;
    title?: string;
    timestamp?: string;
  }> = [];
  const edges: Array<{
    from: string;
    to: string;
    type: string;
    broken?: boolean;
  }> = [];
  const outgoingByPath = new Map<
    string,
    Array<{ from: string; to: string; type: string }>
  >();
  const incomingByPath = new Map<
    string,
    Array<{ from: string; to: string; type: string }>
  >();
  for (const [path, n] of Object.entries(idx.nodes)) {
    nodes.push({ path, type: n.entity_type, timestamp: n.created_at });
    for (const [type, targets] of Object.entries(n.outgoing)) {
      for (const to of targets ?? []) {
        const edge = { from: path, to, type };
        edges.push(edge);
        const out = outgoingByPath.get(path) ?? [];
        out.push(edge);
        outgoingByPath.set(path, out);
        const inc = incomingByPath.get(to) ?? [];
        inc.push(edge);
        incomingByPath.set(to, inc);
      }
    }
  }
  const nodeByPath = new Map(nodes.map((n) => [n.path, n]));
  return {
    version: 1,
    computedAt: idx.last_updated,
    nodes,
    edges,
    nodeByPath,
    outgoingByPath,
    incomingByPath,
  };
}

export type GraphEdge = {
  from: string;
  to: string;
  type: string;
  broken?: boolean;
};
export type GraphNode = {
  path: string;
  type: string;
  title?: string;
  timestamp?: string;
};
export type NodeType = string;
export type EdgeType = UniversalLinkType;
export type TraverseResult = {
  root: GraphNode | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

/** @deprecated v5: simple BFS traversal — kept for any remaining caller. */
export function traverse(
  index: Awaited<ReturnType<typeof buildIndex>>,
  args: {
    filePath: string;
    direction: "forward" | "backward" | "both";
    depth: number;
  },
): TraverseResult {
  const root = index.nodeByPath.get(args.filePath) ?? null;
  if (!root) return { root: null, nodes: [], edges: [] };
  const visited = new Map<string, GraphNode>();
  const collected: GraphEdge[] = [];
  visited.set(root.path, root);
  let frontier: string[] = [root.path];
  for (let hop = 0; hop < args.depth; hop++) {
    const next: string[] = [];
    for (const p of frontier) {
      if (args.direction !== "backward") {
        for (const e of index.outgoingByPath.get(p) ?? []) {
          collected.push(e);
          if (!visited.has(e.to)) {
            const n = index.nodeByPath.get(e.to);
            if (n) {
              visited.set(e.to, n);
              next.push(e.to);
            }
          }
        }
      }
      if (args.direction !== "forward") {
        for (const e of index.incomingByPath.get(p) ?? []) {
          collected.push(e);
          if (!visited.has(e.from)) {
            const n = index.nodeByPath.get(e.from);
            if (n) {
              visited.set(e.from, n);
              next.push(e.from);
            }
          }
        }
      }
    }
    frontier = next;
  }
  return { root, nodes: Array.from(visited.values()), edges: collected };
}
