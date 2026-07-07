"use client";

import type { TreeNode } from "./types";
import { Tree } from "./Tree";

export function FileExplorer({
  root,
  expanded,
  onToggle,
  selectedPath,
  onSelectFile,
  onHoverPath,
}: {
  root: TreeNode;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onHoverPath?: (path: string | null) => void;
}) {
  return (
    <div className="flex h-full w-full flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center border-b border-border-subtle px-3">
        <span className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
          Litepaper 1.0
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Tree
          node={root}
          expanded={expanded}
          onToggle={onToggle}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          onHoverPath={onHoverPath}
        />
      </div>
    </div>
  );
}
