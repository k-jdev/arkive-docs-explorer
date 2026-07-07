// Per-folder color coding — the user can paint any folder in the explorer
// and the color cascades to every descendant in both the tree view and the
// node graph. Persisted to localStorage keyed by user (best-effort; if the
// user signs in on another device, they'll start fresh and re-paint).
//
// Picking a color is additive — most-specific colored ancestor wins, so
// painting a parent doesn't blow away its children's colors.

"use client";

import { useCallback, useEffect, useState } from "react";

export const FOLDER_PALETTE = [
  "#2E68F4", // blue
  "#EAB308", // yellow
  "#14B8A6", // teal
  "#A78BFA", // purple
  "#F472B6", // pink
  "#F97316", // orange
  "#10B981", // green
  "#EF4444", // red
  "#5BC0EB", // cyan
  "#84CC16", // lime
  "#FB7185", // rose
  "#94A3B8", // slate
] as const;

const STORAGE_KEY = "arkive:folder-colors:v1";

export type FolderColors = Map<string, string>;

function load(): FolderColors {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function persist(map: FolderColors) {
  if (typeof window === "undefined") return;
  try {
    const obj: Record<string, string> = {};
    for (const [k, v] of map) obj[k] = v;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // ignore — storage may be full or disabled
  }
}

/**
 * Returns the active color map plus mutators. The map is plain `Map<string,
 * string>` so it can be passed directly to ArkiveGraph and Tree.
 */
export function useFolderColors(): {
  colors: FolderColors;
  setColor: (path: string, color: string | null) => void;
  clearAll: () => void;
} {
  const [colors, setColors] = useState<FolderColors>(() => new Map());

  // Hydrate after mount so SSR doesn't desync. localStorage is client-only.
  useEffect(() => {
    setColors(load());
  }, []);

  const setColor = useCallback((path: string, color: string | null) => {
    setColors((prev) => {
      const next = new Map(prev);
      if (color === null) next.delete(path);
      else next.set(path, color);
      persist(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setColors(() => {
      const next = new Map<string, string>();
      persist(next);
      return next;
    });
  }, []);

  return { colors, setColor, clearAll };
}

/**
 * Resolve the effective color for a path by walking up to the most-specific
 * colored ancestor in the map. Returns undefined when nothing matches.
 */
export function resolveFolderColor(path: string, colors: FolderColors): string | undefined {
  const direct = colors.get(path);
  if (direct) return direct;
  let best: string | undefined;
  let bestLen = -1;
  for (const [folderPath, color] of colors) {
    const prefix = folderPath + "/";
    if (path.startsWith(prefix) && folderPath.length > bestLen) {
      best = color;
      bestLen = folderPath.length;
    }
  }
  return best;
}
