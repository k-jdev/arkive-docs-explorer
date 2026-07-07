// NodeGraph — the substrate visualization that lives inside the overview
// card. Per spec: static SVG with absolute-positioned floating circles
// surrounding a central Arkive logo. No connecting lines. Labels in
// monospace, muted grey. Subtle drift animation (very slow, 20s+ cycle).
//
// Position assignment is DETERMINISTIC per label so the layout stays
// stable across renders (no jitter when the bundle refreshes).

"use client";

import { useMemo } from "react";
import { LogoMark } from "./LogoMark";
import type { TreeNode } from "./types";

type Pt = {
  label: string;
  /** -1..1 fraction of the canvas half-extent in each axis. */
  fx: number;
  fy: number;
  /** Radius in px. */
  r: number;
  /** Drift seed — phase offset for the keyframe animation. */
  phase: number;
};

/**
 * Walk the tree and pick interesting labels for the graph. Each top-level
 * folder, each sub-folder, plus a few notable single files. Caps at ~18
 * nodes so the canvas stays readable.
 */
function collectLabels(root: TreeNode): string[] {
  const labels: string[] = [];
  for (const top of root.children) {
    if (top.isFolder) {
      labels.push(top.name);
      for (const sub of top.children) {
        if (sub.isFolder) labels.push(sub.name);
      }
    } else {
      // top-level files (identity.md, stats.md, etc.) — strip the .md
      labels.push(top.name.replace(/\.md$/, ""));
    }
  }
  // De-dupe while preserving order (labels can repeat across categories,
  // e.g. "context" the folder vs "context" appearing elsewhere — spec
  // allows duplicates but for cleanliness we keep them unique here).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of labels) {
    if (!seen.has(l)) {
      seen.add(l);
      out.push(l);
    }
  }
  return out.slice(0, 18);
}

/**
 * Deterministic hash → float in [0, 1). Used to scatter the labels in a
 * stable but varied pattern so the graph looks "natural" without being
 * actually random (would jitter on every re-render).
 */
function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function assignPositions(labels: string[]): Pt[] {
  return labels.map((label, i) => {
    // Spread labels around a ring at varying distances, then perturb.
    const angle = (i / labels.length) * Math.PI * 2 + hash01(label, 1) * 0.6;
    // Distance: avoid the center (where the logo lives) and the edges.
    const dist = 0.55 + hash01(label, 2) * 0.35; // 0.55..0.9 of half-extent
    const fx = Math.cos(angle) * dist;
    const fy = Math.sin(angle) * dist * 0.78; // squash vertically a bit
    return {
      label,
      fx,
      fy,
      // Circle radius — varies subtly so the field doesn't look uniform
      r: 6 + Math.floor(hash01(label, 3) * 8), // 6..13
      phase: hash01(label, 4) * 6,
    };
  });
}

export function NodeGraph({ root }: { root: TreeNode }) {
  const points = useMemo(() => assignPositions(collectLabels(root)), [root]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Central node — Arkive logo */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: 64, height: 64 }}
      >
        <div className="grid h-12 w-12 place-items-center rounded-full bg-[#1a1a1a] text-[#e5e5e5] shadow-[0_0_0_1px_#262626] mx-auto">
          <LogoMark size={20} />
        </div>
        <div className="mt-2 text-center font-mono text-xs text-[#e5e5e5]">
          Arkive
        </div>
      </div>

      {/* Floating labeled dots — positioned in % so they scale with the
          card. Each gets a very slow drift via the .drift-* animations
          defined in globals.css (added below). */}
      {points.map((p) => (
        <div
          key={p.label + ":" + p.fx + ":" + p.fy}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${50 + p.fx * 45}%`,
            top: `${50 + p.fy * 45}%`,
            animation: `arkive-drift 28s ease-in-out infinite`,
            animationDelay: `-${p.phase}s`,
          }}
        >
          <div className="flex flex-col items-center gap-1.5">
            <span
              className="rounded-full"
              style={{
                width: p.r * 2,
                height: p.r * 2,
                background: "#3f3f3f",
                boxShadow: "inset 0 0 0 1px #525252",
              }}
              aria-hidden="true"
            />
            <span className="whitespace-nowrap font-mono text-xs text-[#737373]">
              {p.label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
