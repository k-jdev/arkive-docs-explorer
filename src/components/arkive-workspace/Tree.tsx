"use client";

import { ChevronRight } from "lucide-react";
import type { TreeNode } from "./types";

type Props = {
  node: TreeNode;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onHoverPath?: (path: string | null) => void;
  depth?: number;
};

function IndentGuides({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <>
      {Array.from({ length: depth }).map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-px bg-border-subtle"
          style={{ left: i * 16 + 10 }}
        />
      ))}
    </>
  );
}

export function Tree({
  node,
  expanded,
  onToggle,
  selectedPath,
  onSelectFile,
  onHoverPath,
  depth = 0,
}: Props) {
  const isOpen = expanded.has(node.path);
  const isSelected = selectedPath === node.path;
  const indent = depth * 16;

  if (node.isFolder) {
    return (
      <div>
        <div
          className={`group relative flex h-6 w-full items-center font-code text-xs transition-colors duration-120 ${
            isSelected
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
          }`}
          onMouseEnter={() => onHoverPath?.(node.path)}
          onMouseLeave={() => onHoverPath?.(null)}
          style={{ paddingLeft: indent + 4 }}
        >
          <IndentGuides depth={depth} />
          <button
            type="button"
            onClick={() => onToggle(node.path)}
            className="flex h-full flex-1 items-center gap-1 pr-1 text-left"
          >
            <ChevronRight
              size={12}
              className={`shrink-0 text-muted-foreground/50 transition-transform ${isOpen ? "rotate-90" : ""}`}
              strokeWidth={2}
            />
            <span className="truncate">{node.name}/</span>
          </button>
        </div>
        {isOpen && (
          <div>
            {node.children.map((c) => (
              <Tree
                key={c.path}
                node={c}
                expanded={expanded}
                onToggle={onToggle}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                onHoverPath={onHoverPath}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelectFile(node.path)}
      onMouseEnter={() => onHoverPath?.(node.path)}
      onMouseLeave={() => onHoverPath?.(null)}
      className={`relative flex h-6 w-full items-center font-code text-xs transition-colors duration-120 ${
        isSelected
          ? "bg-secondary text-foreground"
          : "text-muted-foreground/80 hover:bg-secondary/50 hover:text-foreground"
      }`}
      style={{
        paddingLeft: indent + 20,
        boxShadow: isSelected ? "inset 2px 0 0 hsl(var(--primary))" : undefined,
      }}
    >
      <IndentGuides depth={depth} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}
