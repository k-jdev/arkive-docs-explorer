// Tree builder — derives the file-explorer tree from the bundle.
//
// Per arkive-core-v1, every practice has the same four-folder shape:
// journal/<subfolders>, skills/_archive, insights/{pending,accepted,rejected},
// context/. We seed those canonical folders for every loaded practice so
// the user always sees the structure even when empty.

import type { Bundle, Entry, TreeNode } from "./types";

const CANONICAL_PRACTICE_FOLDERS = [
  "journal",
  "skills",
  "skills/_archive",
  "insights",
  "insights/pending",
  "insights/accepted",
  "insights/rejected",
  "context",
];

export const HIDDEN_FROM_TREE = new Set<string>([
  "arkive/arkive.config", // pure YAML — visible elsewhere
  "arkive/arkive.index",  // auto-maintained JSON
]);

export function buildTree(bundle: Bundle): TreeNode {
  const root: TreeNode = { name: "docs", path: "arkive/docs", isFolder: true, children: [] };

  for (const path of bundle.extra_paths ?? []) {
    if (!path.startsWith("arkive/docs/")) continue;
    ensurePathUnder(root, path, "arkive/docs", false);
  }

  sortTree(root);
  return root;
}

function ensurePathUnder(root: TreeNode, fullPath: string, basePath: string, terminalIsFolder: boolean) {
  if (fullPath === basePath) return;
  const relative = fullPath.slice(basePath.length + 1);
  const segments = relative.split("/");
  let cursor = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const childPath = `${basePath}/${segments.slice(0, i + 1).join("/")}`;
    const shouldBeFolder = !isLast || terminalIsFolder;
    let child = cursor.children.find((c) => c.name === seg);
    if (!child) {
      child = { name: seg, path: childPath, isFolder: shouldBeFolder, children: [] };
      cursor.children.push(child);
    } else if (!child.isFolder && shouldBeFolder) {
      child.isFolder = true;
    }
    cursor = child;
  }
}

function ensurePath(root: TreeNode, fullPath: string, terminalIsFolder: boolean) {
  if (HIDDEN_FROM_TREE.has(fullPath)) return;
  const segments = fullPath.split("/").slice(1);
  let cursor = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const childPath = ["arkive", ...segments.slice(0, i + 1)].join("/");
    const shouldBeFolder = !isLast || terminalIsFolder;
    let child = cursor.children.find((c) => c.name === seg);
    if (!child) {
      child = { name: seg, path: childPath, isFolder: shouldBeFolder, children: [] };
      cursor.children.push(child);
    } else if (!child.isFolder && shouldBeFolder) {
      child.isFolder = true;
    }
    cursor = child;
  }
}

// Explicit ordering for docs tree — matches litepaper structure.
const DOCS_ORDER: Record<string, string[]> = {
  "arkive/docs": [
    "about-arkive",
    "architecture",
    "design-philosophy.md",
    "project-defi.md",
    "business-model",
    "conclusion.md",
    "legal.md",
    "guides",
  ],
  "arkive/docs/about-arkive": ["overview.md", "problem-statement.md"],
  "arkive/docs/architecture": [
    "introduction.md",
    "arkives.md",
    "the-compounding-loop.md",
    "practices.md",
    "mcp-integration.md",
  ],
  "arkive/docs/business-model": ["revenue-model.md", "ark-token.md"],
  "arkive/docs/guides": ["setup.md"],
};

function sortTree(n: TreeNode) {
  const order = DOCS_ORDER[n.path];
  if (order) {
    n.children.sort((a, b) => {
      const ai = order.indexOf(a.name);
      const bi = order.indexOf(b.name);
      const av = ai === -1 ? 9999 : ai;
      const bv = bi === -1 ? 9999 : bi;
      if (av !== bv) return av - bv;
      return a.name.localeCompare(b.name);
    });
  } else {
    n.children.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }
  for (const c of n.children) sortTree(c);
}

/** Collect every folder path in the tree (recursive). Used for expand-all. */
export function collectAllFolderPaths(node: TreeNode): string[] {
  const paths: string[] = [];
  function walk(n: TreeNode) {
    if (n.isFolder) {
      paths.push(n.path);
      for (const c of n.children) walk(c);
    }
  }
  walk(node);
  return paths;
}

export function findEntryByPath(bundle: Bundle, p: string): Entry | null {
  if (bundle.identity?.path === p) return bundle.identity;
  if (bundle.loadup?.path === p) return bundle.loadup;
  if (bundle.protocol?.path === p) {
    return { path: p, meta: {}, body: bundle.protocol.body };
  }
  // Stream observations resolved directly from the bundle's recent slice;
  // anything older comes via the lazy /api/arkive-v2/entry path in
  // ArkiveWorkspace (already wired for journal/skills/insights).
  for (const obs of bundle.recent_observations ?? []) {
    if (obs.path === p) return obs;
  }
  for (const practice of bundle.practices) {
    if (practice.instructions?.path === p) return practice.instructions;
    if (`arkive/practices/${practice.name}/practice.config` === p && practice.config) {
      const cfg = practice.config;
      const body = `# ${cfg.name} practice config

**Version:** ${cfg.version}
**Based on:** ${cfg.based_on}

${cfg.description}

## Entity types

${cfg.provides.journal_entity_types.map((et) => `- \`${et.name}\` → \`journal/${et.folder}/\``).join("\n") || "(none)"}

## Context files

${cfg.provides.context_files.map((cf) => `- \`${cf.name}\` (${cf.schema}) — ${cf.purpose}`).join("\n") || "(none)"}

## Loading

Default mode: \`${cfg.loading.default_mode}\`${cfg.loading.triggers?.length ? `
Triggers: ${cfg.loading.triggers.join(", ")}` : ""}

## MCP tools

${cfg.provides.mcp_tools?.map((t) => `- \`${t.name}\` (gate: ${t.requires_gate})`).join("\n") || "(none)"}
`;
      return { path: p, meta: { entity_type: "practice_config", practice: practice.name }, body };
    }
    for (const e of practice.context) if (e.path === p) return e;
    for (const e of practice.recent_journal) if (e.path === p) return e;
    for (const e of practice.pending_insights) if (e.path === p) return e;
  }
  return null;
}
