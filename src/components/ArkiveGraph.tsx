"use client";

// Arkive v2 substrate graph.
//
// Renders the v2 directory layout as a force-directed node display:
//   - "arkive" master node at the center (dark)
//   - Each top-level folder (journal, skills, insights, context) = root node
//   - Each sub-folder = folder node
//   - Each file = small leaf node
//
// Drag to reposition, scroll to zoom, click a folder to focus, click a file
// to open it in the right pane (callback up to the parent).
//
// Knows nothing about v1; takes the same TreeNode structure ArkiveBrowser
// builds from the read_arkive bundle.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { useTheme } from "@/hooks/useTheme";

export type GraphTreeNode = {
  name: string;
  path: string;
  isFolder: boolean;
  children: GraphTreeNode[];
};

export type Backlink = { from: string; to: string; type?: string; reason?: string; broken?: boolean };

// Edge-type → stroke color. Falls back to PRIMARY for anything unknown.
// Exported so the overview panel can render a matching legend.
export const EDGE_COLOR: Record<string, string> = {
  sources: "#2E68F4",         // primary blue
  linked_trades: "#14B8A6",   // success teal
  linked_insights: "#5BC0EB", // agent cyan
  evidence: "#EAB308",        // warning yellow
  produced: "#A78BFA",        // soft purple
  links_to_entry: "#F472B6",  // pink (entry↔exit pairing)
};

export type NodeDetail = { title: string; type: string; excerpt: string };

type Props = {
  root: GraphTreeNode;
  /** Cross-file connections rendered as dashed edges (e.g. SOL research ↔ SOL trade). */
  backlinks?: Backlink[];
  /** Optional per-path detail map used by the hover popup. Keyed by node path. */
  nodeDetails?: Map<string, NodeDetail>;
  /**
   * Externally-driven hover. When set (e.g. the user hovers a row in the
   * file explorer), the graph dims everything except the matching node's
   * neighborhood AND shows the same hover popup it would show for an
   * internal cursor hover, positioned at the node's current screen coords.
   * Cursor-hover INSIDE the graph still works normally and wins when both
   * are active.
   */
  externalHoverPath?: string | null;
  /**
   * Paths the file explorer currently has expanded. The graph mirrors this:
   * a folder's children only show in the graph if the folder is expanded
   * in the side tree. Top-level folders (depth 1, direct children of
   * arkive/) are always visible regardless — they're the entry points.
   * When omitted, the graph shows every node (back-compat).
   */
  expandedPaths?: Set<string>;
  /**
   * Folder path → accent color (hex with leading #). When a node's path
   * matches a colored folder — or descends from one — it takes that
   * color. The MOST SPECIFIC ancestor wins, so painting
   * `arkive/practices/trading` red and then `arkive/practices/trading/journal`
   * blue leaves the journal subtree blue and everything else under trading
   * red. Nodes that don't descend from any colored folder fall back to
   * the neutral primary tint.
   */
  folderColors?: Map<string, string>;
  focusedPath: string | null;
  onFocusFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
};

const MASTER_ID = "__master__";

// Brand tokens — same palette as the rest of the app
const PRIMARY = "#2E68F4";
const PRIMARY_DARK = "#1E40AF";
const BG = "#0A0A0A";
const FG = "#F2F2F2";
const MUTED = "#B4B4B4";
const BORDER = "#2A2A2A";

type GraphNode = d3.SimulationNodeDatum & {
  id: string;
  label: string;
  kind: "master" | "folder" | "file";
  depth: number;
  filePath?: string;
  folderPath?: string;
};

type GraphLink = d3.SimulationLinkDatum<GraphNode> & {
  source: string;
  target: string;
};

type HoverState = {
  /** Path of the hovered file node. */
  path: string;
  /** Wrapper-relative pixel coords where the popup should anchor. */
  x: number;
  y: number;
};

export function ArkiveGraph({
  root,
  backlinks = [],
  nodeDetails,
  externalHoverPath,
  expandedPaths,
  folderColors,
  focusedPath,
  onFocusFolder,
  onSelectFile,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const theme = useTheme();
  // Bumps when the wrapper transitions from hidden (0×0) to visible so the
  // D3 effect re-runs with correct dimensions after the tab is shown.
  const [visibilityTick, setVisibilityTick] = useState(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let wasHidden = el.offsetWidth === 0;
    const ro = new ResizeObserver(() => {
      const hidden = el.offsetWidth === 0;
      if (wasHidden && !hidden) setVisibilityTick((t) => t + 1);
      wasHidden = hidden;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Small dwell timer so the popup doesn't disappear instantly when the
  // mouse darts between the node and the popup itself.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Live map of node id → current screen position. Populated each d3 tick
  // so we can position the hover popup AT a node when the hover is driven
  // from outside the graph (e.g. file explorer row mouseenter).
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Source of the current hover — "internal" means cursor on a node inside
  // the SVG (event-driven), "external" means a sibling component (file
  // explorer) told us to highlight a path. Used so internal mouseleave
  // doesn't clear a still-active external hover.
  const hoverSourceRef = useRef<"internal" | "external" | null>(null);
  // Latest click handlers behind stable refs — keeps the rebuild effect's
  // dep list to actual graph data, so parent re-renders (which produce
  // fresh inline callbacks) don't remount the simulation.
  const onFocusFolderRef = useRef(onFocusFolder);
  const onSelectFileRef = useRef(onSelectFile);
  useEffect(() => {
    onFocusFolderRef.current = onFocusFolder;
    onSelectFileRef.current = onSelectFile;
  });
  // Node id the camera should glide onto AFTER the next rebuild. Folder
  // clicks toggle expansion, which tears the SVG down and re-creates the
  // zoom behavior — a transition started in the click handler races that
  // rebuild and can be dropped. Deferring the glide into the rebuild
  // (positions are seeded, so the target hasn't moved) makes it reliable.
  const pendingZoomRef = useRef<string | null>(null);

  // Flatten the tree into nodes + links, pruning descendants of folders that
  // aren't expanded in the side tree.
  const { nodes, links } = useMemo(() => flatten(root, expandedPaths), [root, expandedPaths]);

  // Edge rewriting — every backlink whose endpoint is hidden (because its
  // containing folder is collapsed) gets rerouted to the NEAREST VISIBLE
  // ANCESTOR. This eliminates "lines to nowhere" entirely: every endpoint
  // is a node the user can see. The visual semantic is honest — when a
  // line lands on a folder, it means "there's a cross-reference inside
  // there; expand to see it."
  //
  // Edges whose both endpoints fold up to the SAME ancestor (i.e. the
  // connection is fully inside a collapsed subtree) get dropped — drawing
  // a self-loop or zero-length line would just be visual noise.
  const visibleBacklinks = useMemo<Backlink[]>(() => {
    if (!backlinks || backlinks.length === 0) return [];
    const visible = new Set(nodes.map((n) => n.id));
    function nearestVisibleAncestor(path: string): string | null {
      if (visible.has(path)) return path;
      // Walk up the path one segment at a time
      const segs = path.split("/");
      while (segs.length > 1) {
        segs.pop();
        const ancestor = segs.join("/");
        if (visible.has(ancestor)) return ancestor;
      }
      return null; // truly unknown — drop the edge
    }
    const rewritten: Backlink[] = [];
    for (const b of backlinks) {
      const from = nearestVisibleAncestor(b.from);
      const to = nearestVisibleAncestor(b.to);
      if (!from || !to) continue;       // can't render — neither side visible
      if (from === to) continue;        // collapsed into the same ancestor
      rewritten.push({ ...b, from, to });
    }
    return rewritten;
  }, [backlinks, nodes]);

  // Per-path color resolver — walks up the path looking for the most
  // specific colored ancestor in `folderColors`. Memoized so per-node attr
  // callbacks stay stable across renders.
  const colorForPath = useMemo(() => {
    return (path: string): string => {
      if (!folderColors || folderColors.size === 0) return PRIMARY;
      // Direct match (the node IS a colored folder)
      const direct = folderColors.get(path);
      if (direct) return direct;
      // Walk up the path looking for the longest colored ancestor
      let best: string | null = null;
      let bestLen = -1;
      for (const [folderPath, color] of folderColors) {
        const prefix = folderPath + "/";
        if (path.startsWith(prefix) && folderPath.length > bestLen) {
          best = color;
          bestLen = folderPath.length;
        }
      }
      return best ?? PRIMARY;
    };
  }, [folderColors]);

  // Per-path neighbor list — only files (excluded folders), 1-hop. Built once
  // per backlinks change and reused by the popup.
  const neighborsByPath = useMemo(() => {
    const map = new Map<string, Array<{ path: string; edgeType?: string; reason?: string }>>();
    for (const e of backlinks) {
      if (!map.has(e.from)) map.set(e.from, []);
      map.get(e.from)!.push({ path: e.to, edgeType: e.type, reason: e.reason });
      if (!map.has(e.to)) map.set(e.to, []);
      map.get(e.to)!.push({ path: e.from, edgeType: e.type, reason: e.reason });
    }
    return map;
  }, [backlinks]);

  function scheduleHide() {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      // Don't clear if an external hover is still in flight — the user
      // is still pointing at the matching row in the file explorer.
      if (hoverSourceRef.current === "external") return;
      hoverSourceRef.current = null;
      setHover(null);
    }, 120);
  }
  function cancelHide() {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  useEffect(() => {
    if (!svgRef.current || !wrapRef.current) return;
    const wrap = wrapRef.current;
    const svg = d3.select(svgRef.current);
    const { width, height } = wrap.getBoundingClientRect();
    // Don't wipe the SVG when the container is hidden (display:none → 0×0).
    // visibilityTick will bump when it becomes visible, re-triggering this effect.
    if (!width || !height) return;

    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    // Theme-resolved color tokens (dark is the brand default)
    const isLight = theme === "light";
    const FG_T      = isLight ? PRIMARY : FG;         // master center dot
    const LABEL_T   = isLight ? "#333333" : FG;      // master "arkive" label
    const MUTED_T   = isLight ? "#666666" : MUTED;   // depth-1 folder labels
    const DEEP_T    = isLight ? "#999999" : "#7a7a7a"; // deeper folder labels
    const BORDER_T  = isLight ? "#d0d0d0" : BORDER;  // master spoke strokes

    // Soft bloom used by the master core and folder rings. Cheap — only a
    // handful of nodes carry it; file dots stay unfiltered.
    const defs = svg.append("defs");
    const glow = defs
      .append("filter")
      .attr("id", "ark-glow")
      .attr("x", "-120%")
      .attr("y", "-120%")
      .attr("width", "340%")
      .attr("height", "340%");
    glow.append("feGaussianBlur").attr("stdDeviation", 2.6).attr("result", "blur");
    const merge = glow.append("feMerge");
    merge.append("feMergeNode").attr("in", "blur");
    merge.append("feMergeNode").attr("in", "SourceGraphic");

    // Background hit target — clears focus + glides the camera home when
    // the user clicks empty space. (`zoom` is declared below; the handler
    // only runs after this effect has finished, so the reference is safe.)
    svg
      .append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "transparent")
      .on("click", () => {
        onFocusFolderRef.current("");
        svg
          .transition()
          .duration(500)
          .ease(d3.easeCubicInOut)
          .call(zoom.transform, d3.zoomIdentity);
      });

    const zoomLayer = svg.append("g");

    // ---- position seeding ----
    // Carry the previous layout across rebuilds (positionsRef is refreshed
    // every tick) so toggling a folder doesn't reshuffle the constellation.
    // Brand-new nodes spawn beside their parent with a little jitter and let
    // the forces unfold them.
    const prevPos = positionsRef.current;
    let seeded = 0;
    for (const n of nodes) {
      if (n.x !== undefined && n.y !== undefined) {
        seeded++;
        continue; // same object from a previous sim run — already placed
      }
      const p = prevPos.get(n.id);
      if (p) {
        n.x = p.x;
        n.y = p.y;
        seeded++;
      }
    }
    const nodeByIdSeed = new Map(nodes.map((n) => [n.id, n]));
    for (const l of links) {
      const sid = typeof l.source === "string" ? l.source : (l.source as GraphNode).id;
      const tid = typeof l.target === "string" ? l.target : (l.target as GraphNode).id;
      const child = nodeByIdSeed.get(tid);
      const parent = nodeByIdSeed.get(sid);
      if (child && parent && child.x === undefined && parent.x !== undefined) {
        child.x = (parent.x ?? 0) + (Math.random() - 0.5) * 40;
        child.y = (parent.y ?? 0) + (Math.random() - 0.5) * 40;
      }
    }

    // ---- forces ----
    const sim = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance((l) => {
            const t = l.target as unknown as GraphNode;
            return t.kind === "master" ? 130 : t.kind === "folder" ? 80 : 38;
          })
          .strength(0.75)
      )
      .force(
        "charge",
        d3.forceManyBody().strength((n: d3.SimulationNodeDatum) => {
          const k = (n as GraphNode).kind;
          return k === "master" ? -680 : k === "folder" ? -240 : -90;
        })
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collide",
        d3.forceCollide<GraphNode>().radius((d) => (d.kind === "master" ? 44 : d.kind === "folder" ? 26 : 10))
      );

    // When the layout mostly carried over, reheat gently instead of from
    // alpha 1 — expanding a folder should feel like growth, not a relayout.
    if (seeded > nodes.length * 0.5) sim.alpha(0.45);

    // ---- structural links (parent → child) ----
    // Each link is tinted by the TARGET node's library color so a glance at
    // the graph shows you "this constellation belongs to that library". The
    // master spokes (target = top-level under arkive/) take PRIMARY since
    // they cross into library territory.
    const link = zoomLayer
      .append("g")
      .attr("stroke-opacity", 0.32)
      .attr("stroke-width", 1)
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", (l) => {
        const targetId = typeof l.target === "string" ? l.target : (l.target as { id: string }).id;
        if (targetId === MASTER_ID) return BORDER_T;
        return colorForPath(targetId);
      });

    // ---- backlinks (typed cross-file edges) ----
    // These don't participate in the simulation forces (we use plain lines that
    // follow the node positions on tick). Keeps the layout stable.
    // Edge color encodes type; dashed pattern signals "cross-reference" vs the
    // solid structural parent-child lines.
    //
    // visibleBacklinks has already been rewritten so every endpoint is a
    // visible node (collapsed-folder targets fold up to the nearest
    // visible ancestor). No "lines to nowhere" remain.
    const validIds = new Set(nodes.map((n) => n.id));
    const validBacklinks = visibleBacklinks.filter((b) => validIds.has(b.from) && validIds.has(b.to));
    const backlinkLines = zoomLayer
      .append("g")
      .attr("stroke-opacity", 0.5)
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "5,3")
      .attr("fill", "none")
      .selectAll<SVGLineElement, Backlink>("line.backlink")
      .data(validBacklinks)
      .join("line")
      .attr("class", "backlink arkive-backlink")
      .attr("stroke", (b) => (b.broken ? "#F43F5E" : EDGE_COLOR[b.type ?? ""] ?? PRIMARY));
    backlinkLines
      .append("title")
      .text((b) => `${b.type ?? "link"}${b.reason ? `: ${b.reason}` : ""}${b.broken ? " (broken)" : ""}`);

    // ---- nodes ----
    const node = zoomLayer
      .append("g")
      .selectAll<SVGGElement, GraphNode>("g.node")
      .data(nodes)
      .join("g")
      .attr("class", "node")
      .style("cursor", "pointer")
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) sim.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) sim.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      )
      .on("click", (event, d) => {
        event.stopPropagation();
        if (d.kind === "file" && d.filePath) {
          onSelectFileRef.current(d.filePath);
        } else if (d.kind === "folder" && d.folderPath) {
          // Toggle expansion (mirrored in the file explorer via the shared
          // expanded set) and queue the camera glide for the rebuild that
          // toggle triggers.
          pendingZoomRef.current = d.id;
          onFocusFolderRef.current(d.folderPath);
        } else if (d.kind === "master") {
          // No state change → no rebuild → glide immediately.
          zoomToNode(d);
        }
      })
      // Hover → custom popup. Fires for BOTH files and folders so the user
      // gets a rich preview no matter what they hover. Folders show contents
      // count; files show excerpt + 1-hop neighbors.
      .on("mouseenter", (event, d) => {
        if (d.kind === "master") return; // skip the central anchor
        const path = d.filePath ?? d.folderPath;
        if (!path) return;
        cancelHide();
        const wrap = wrapRef.current;
        if (!wrap) return;
        const wrapRect = wrap.getBoundingClientRect();
        const evt = event as MouseEvent;
        // Internal cursor hover wins over any active external hover —
        // the user is directly interacting with the graph now.
        hoverSourceRef.current = "internal";
        setHover({
          path,
          x: evt.clientX - wrapRect.left + 14,
          y: evt.clientY - wrapRect.top + 14,
        });
      })
      .on("mousemove", (event, d) => {
        if (d.kind === "master") return;
        const path = d.filePath ?? d.folderPath;
        if (!path) return;
        const wrap = wrapRef.current;
        if (!wrap) return;
        const wrapRect = wrap.getBoundingClientRect();
        const evt = event as MouseEvent;
        setHover((prev) =>
          prev && prev.path === path
            ? { ...prev, x: evt.clientX - wrapRect.left + 14, y: evt.clientY - wrapRect.top + 14 }
            : prev
        );
      })
      .on("mouseleave", (event, d) => {
        if (d.kind === "master") return;
        scheduleHide();
      });

    // Track the current zoom scale so node visuals can be counter-scaled.
    let currentK = 1;

    // Shape per kind — all visuals go into an inner <g class="node-inner">
    // so we can apply scale(1/k) on it, keeping circles and labels at a
    // fixed pixel size regardless of how far the user has zoomed in.
    node.each(function (d) {
      const g = d3.select(this);
      const inner = g.append("g").attr("class", "node-inner");
      const accent = d.kind === "master" ? PRIMARY : colorForPath(d.folderPath ?? d.filePath ?? "");
      if (d.kind === "master") {
        inner.append("circle").attr("r", 42).attr("fill", accent).attr("fill-opacity", 0.07);
        inner
          .append("circle")
          .attr("r", 24)
          .attr("fill", "none")
          .attr("stroke", accent)
          .attr("stroke-opacity", 0.55)
          .attr("stroke-width", 1.5);
        const masterCore = inner
          .append("circle")
          .attr("r", 7)
          .attr("fill", FG_T);
        if (!isLight) masterCore.attr("filter", "url(#ark-glow)");
      } else if (d.kind === "folder") {
        const folderCircle = inner
          .append("circle")
          .attr("r", 13)
          .attr("fill", accent)
          .attr("fill-opacity", 0.1)
          .attr("stroke", accent)
          .attr("stroke-opacity", 0.85)
          .attr("stroke-width", 1.5);
        if (!isLight) folderCircle.attr("filter", "url(#ark-glow)");
        inner.append("circle").attr("r", 3).attr("fill", accent);
      } else {
        inner.append("circle").attr("r", 13).attr("fill", "transparent");
        inner
          .append("circle")
          .attr("r", 4)
          .attr("fill", accent)
          .attr("fill-opacity", 0.9);
      }
      if (d.kind !== "file") inner.append("title").text(d.label);
    });

    // Labels inside the same counter-scaled inner group.
    node
      .filter((d) => d.kind === "master" || d.kind === "folder")
      .select("g.node-inner")
      .append("text")
      .text((d) => (d.kind === "master" ? d.label : `${d.label}/`))
      .attr("dy", (d) => (d.kind === "master" ? 58 : d.depth <= 1 ? 30 : 28))
      .attr("text-anchor", "middle")
      .attr("fill", (d) => (d.kind === "master" ? LABEL_T : d.depth <= 1 ? MUTED_T : DEEP_T))
      .attr("font-size", (d) => (d.kind === "master" ? 14 : d.depth <= 1 ? 13 : 12))
      .attr("font-weight", (d) => (d.kind === "master" ? 500 : 400))
      .attr("font-family", "var(--font-code), ui-monospace, monospace")
      .attr("letter-spacing", "0.08em")
      .style("pointer-events", "none")
      .style("user-select", "none");

    // Build an id→node lookup for backlink positioning
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const backlinkSelection = zoomLayer.selectAll<SVGLineElement, Backlink>("line.backlink");

    sim.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as unknown as GraphNode).x ?? 0)
        .attr("y1", (d) => (d.source as unknown as GraphNode).y ?? 0)
        .attr("x2", (d) => (d.target as unknown as GraphNode).x ?? 0)
        .attr("y2", (d) => (d.target as unknown as GraphNode).y ?? 0);
      backlinkSelection
        .attr("x1", (b) => nodeById.get(b.from)?.x ?? 0)
        .attr("y1", (b) => nodeById.get(b.from)?.y ?? 0)
        .attr("x2", (b) => nodeById.get(b.to)?.x ?? 0)
        .attr("y2", (b) => nodeById.get(b.to)?.y ?? 0);
      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      // Mirror node positions into the ref so the externalHoverPath effect
      // (and any other code that needs to position something AT a node)
      // can read the latest coordinates without poking into d3 internals.
      const map = positionsRef.current;
      map.clear();
      for (const n of nodes) {
        map.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
      }
    });
    // Touch backlinkLines so it's not flagged as unused (the selection above
    // re-queries the DOM since we appended <title> to the inserted line).
    void backlinkLines;

    // Zoom / pan. Default dblclick-zoom is disabled — single-clicking a
    // folder glides the camera onto it instead (zoomToNode below).
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 4]).on("zoom", (event) => {
      currentK = event.transform.k;
      zoomLayer.attr("transform", event.transform.toString());
      // Counter-scale every node's inner group so circles and labels stay
      // at a fixed pixel size no matter how far the user has zoomed in.
      zoomLayer
        .selectAll<SVGGElement, GraphNode>("g.node-inner")
        .attr("transform", `scale(${1 / currentK})`);
    });
    svg.call(zoom).on("dblclick.zoom", null);

    // The camera transform lives on the <svg> element and survives rebuilds,
    // but the fresh zoomLayer starts untransformed — re-apply it so toggling
    // a folder doesn't snap the view back to origin.
    const carried = d3.zoomTransform(svgRef.current!);
    if (carried.k !== 1 || carried.x !== 0 || carried.y !== 0) {
      zoomLayer.attr("transform", carried.toString());
    }

    // Deferred glide from a folder click (see pendingZoomRef). The target's
    // position was seeded from the previous layout, so it's already correct.
    if (pendingZoomRef.current) {
      const target = nodes.find((n) => n.id === pendingZoomRef.current);
      pendingZoomRef.current = null;
      if (target) zoomToNode(target);
    }

    // Glide the camera so the node lands center-frame. Keeps the current
    // zoom level when the user is already zoomed past the target scale.
    function zoomToNode(d: GraphNode) {
      const current = d3.zoomTransform(svgRef.current!);
      const scale = Math.max(current.k, 1.6);
      const tx = width / 2 - scale * (d.x ?? width / 2);
      const ty = height / 2 - scale * (d.y ?? height / 2);
      svg
        .transition()
        .duration(650)
        .ease(d3.easeCubicInOut)
        .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    }

    return () => {
      sim.stop();
    };
    // Click handlers go through onFocusFolderRef/onSelectFileRef — deps stay
    // limited to actual graph data so parent re-renders (fresh inline
    // callbacks) never remount the simulation. colorForPath is here because
    // node/link tints are baked in at build time.
  }, [nodes, links, visibleBacklinks, colorForPath, visibilityTick, theme]);

  // Focus ring on the focused folder — updates every render via D3 selection
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg
      .selectAll<SVGGElement, GraphNode>("g.node")
      .each(function (d) {
        const g = d3.select(this);
        const ring = g.select<SVGCircleElement>("circle.focus-ring");
        const isFocused = focusedPath !== null && (d.folderPath === focusedPath || d.filePath === focusedPath);
        if (isFocused) {
          if (ring.empty()) {
            g.insert("circle", ":first-child")
              .attr("class", "focus-ring")
              .attr("r", d.kind === "master" ? 36 : d.kind === "folder" ? 15 : 8)
              .attr("fill", "none")
              .attr("stroke", PRIMARY)
              .attr("stroke-width", 1)
              .attr("stroke-dasharray", "2,3")
              .attr("opacity", 0.7);
          }
        } else if (!ring.empty()) {
          ring.remove();
        }
      });
  }, [focusedPath]);

  // Hover-dim — when the cursor sits on a node, fade everything that isn't
  // (a) the node itself, (b) one of its backlink neighbors, or (c) its
  // structural ancestors/descendants. Backlink lines that don't touch the
  // hovered node are pushed down to ~0.08 opacity so the local neighborhood
  // pops out from the rest of the graph. When the hover clears, everything
  // goes back to its default opacity.
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    if (!hover) {
      svg.selectAll<SVGGElement, GraphNode>("g.node").attr("opacity", 1);
      svg.selectAll<SVGLineElement, GraphLink>("g > g > line").attr("opacity", null);
      svg.selectAll<SVGLineElement, Backlink>("line.backlink").attr("opacity", null);
      return;
    }
    const hoveredPath = hover.path;
    const connected = new Set<string>([hoveredPath]);
    // 1-hop backlink neighbors (typed cross-file connections).
    // Use the rewritten visibleBacklinks so the highlight matches the
    // edges that are actually drawn.
    for (const e of visibleBacklinks) {
      if (e.from === hoveredPath) connected.add(e.to);
      if (e.to === hoveredPath) connected.add(e.from);
    }
    // Structural ancestors + descendants — anything sharing a path prefix.
    // E.g. hovering arkive/skills/attention.md lights up arkive/skills
    // (its parent) and any nested children if it were a folder.
    for (const n of nodes) {
      if (
        n.id === hoveredPath ||
        hoveredPath.startsWith(n.id + "/") ||
        n.id.startsWith(hoveredPath + "/")
      ) {
        connected.add(n.id);
      }
    }
    // The master node is the conceptual root of the substrate but its id is
    // "__master__" — path-prefix matching above doesn't catch it. Add it
    // explicitly so EVERY hover lights up the chain all the way back to
    // arkive: hovered file → parent folder → … → top-level folder → master.
    connected.add(MASTER_ID);
    svg
      .selectAll<SVGGElement, GraphNode>("g.node")
      .attr("opacity", (d) => (connected.has(d.id) ? 1 : 0.22));
    // Structural links — only keep lit if BOTH endpoints are in the neighborhood.
    svg.selectAll<SVGLineElement, GraphLink>("g > g > line:not(.backlink)").attr("opacity", function (d) {
      const lk = d as unknown as { source: GraphNode | string; target: GraphNode | string };
      const sId = typeof lk.source === "string" ? lk.source : (lk.source as GraphNode).id;
      const tId = typeof lk.target === "string" ? lk.target : (lk.target as GraphNode).id;
      return connected.has(sId) && connected.has(tId) ? 1 : 0.08;
    });
    // Backlinks — keep lit if EITHER endpoint is the hovered node.
    svg.selectAll<SVGLineElement, Backlink>("line.backlink").attr("opacity", (b) =>
      b.from === hoveredPath || b.to === hoveredPath ? 0.9 : 0.08
    );
  }, [hover, visibleBacklinks, nodes]);

  // External hover bridge — when a sibling (file explorer) hands us a
  // path, mirror it into the same `hover` state the internal cursor
  // handlers use. That way the dim effect above, the rich popup below,
  // and the master-up-to-arkive highlighting all light up identically
  // whether the hover came from the graph itself or from another panel.
  //
  // Popup position comes from the node's last-projected screen coords
  // (captured each tick into positionsRef). Internal hover takes
  // precedence — if the user is actively pointing at a node in the
  // graph, we don't let an external set yank the popup elsewhere.
  useEffect(() => {
    if (hoverSourceRef.current === "internal") return; // don't override active cursor hover
    if (externalHoverPath) {
      const pos = positionsRef.current.get(externalHoverPath);
      // Fall back to wrapper center if we don't yet know the node position
      // (can happen on the very first paint before the sim has ticked).
      const wrap = wrapRef.current;
      const rect = wrap?.getBoundingClientRect();
      const x = pos?.x ?? (rect ? rect.width / 2 : 0);
      const y = pos?.y ?? (rect ? rect.height / 2 : 0);
      hoverSourceRef.current = "external";
      setHover({ path: externalHoverPath, x: x + 14, y: y + 14 });
    } else if (hoverSourceRef.current === "external") {
      hoverSourceRef.current = null;
      setHover(null);
    }
  }, [externalHoverPath]);

  // Resolve the hover popup's content from the latest details + neighbor map.
  // Falls back to a path-derived synthetic detail so the popup always renders
  // when something is hovered (no silent failure when the bundle doesn't
  // expose a body for this path).
  const hoverNeighbors = hover ? neighborsByPath.get(hover.path) ?? [] : [];
  const isFolderHover =
    hover ? !nodes.find((n) => n.id === hover.path)?.filePath : false;
  const hoverDetail: NodeDetail | null = hover
    ? nodeDetails?.get(hover.path) ?? {
        title: hover.path.split("/").pop()?.replace(/\.md$/, "") || hover.path,
        type: isFolderHover ? "folder" : "file",
        excerpt: isFolderHover
          ? `Folder. Click to focus, or open a child node to read its markdown.`
          : `Click to open this entry in the right pane.`,
      }
    : null;

  // For folder hovers, "neighbors" is the list of children files in that folder
  // (one level deep). Lets the popup preview what's inside.
  const folderChildren = useMemo(() => {
    if (!hover || !isFolderHover) return [];
    const prefix = hover.path + "/";
    return nodes
      .filter((n) => n.kind === "file" && n.filePath?.startsWith(prefix))
      .slice(0, 12)
      .map((n) => ({ path: n.filePath!, edgeType: "contains" as const }));
  }, [hover, isFolderHover, nodes]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <svg ref={svgRef} className="h-full w-full" />
      {hover && hoverDetail && (
        <HoverPopup
          x={hover.x}
          y={hover.y}
          path={hover.path}
          detail={hoverDetail}
          neighbors={isFolderHover ? folderChildren : hoverNeighbors}
          neighborsLabel={isFolderHover ? "Contains" : "Connected"}
          wrapWidth={wrapRef.current?.clientWidth ?? 800}
          wrapHeight={wrapRef.current?.clientHeight ?? 600}
          nodeDetails={nodeDetails}
          onEnter={cancelHide}
          onLeave={scheduleHide}
          onNeighborClick={(p) => {
            setHover(null);
            onSelectFile(p);
          }}
        />
      )}
    </div>
  );
}

/* ============================================================================
 * Hover popup — file node preview + 1-hop neighbor list
 *
 * Rendered as a plain absolute-positioned React div over the SVG. Clamped to
 * the wrapper so it never escapes the visible area. Closes after a short
 * delay when the mouse leaves both the node AND the popup, so users can move
 * into the popup to click a neighbor link.
 * ========================================================================== */

function HoverPopup({
  x,
  y,
  path,
  detail,
  neighbors,
  neighborsLabel = "Connected",
  nodeDetails,
  wrapWidth,
  wrapHeight,
  onEnter,
  onLeave,
  onNeighborClick,
}: {
  x: number;
  y: number;
  path: string;
  detail: NodeDetail;
  neighbors: Array<{ path: string; edgeType?: string; reason?: string }>;
  neighborsLabel?: string;
  nodeDetails?: Map<string, NodeDetail>;
  wrapWidth: number;
  wrapHeight: number;
  onEnter: () => void;
  onLeave: () => void;
  onNeighborClick: (p: string) => void;
}) {
  // Clamp the popup to stay within the visible canvas. Estimate the popup
  // height conservatively so we flip it above-cursor when it would overflow
  // the bottom. Width is fixed at 320.
  const POPUP_WIDTH = 320;
  const POPUP_ESTIMATED_HEIGHT = 280;
  const MARGIN = 8;
  let left = x;
  let top = y;
  if (left + POPUP_WIDTH + MARGIN > wrapWidth) left = wrapWidth - POPUP_WIDTH - MARGIN;
  if (left < MARGIN) left = MARGIN;
  if (top + POPUP_ESTIMATED_HEIGHT + MARGIN > wrapHeight) {
    top = Math.max(MARGIN, y - POPUP_ESTIMATED_HEIGHT - 20);
  }
  if (top < MARGIN) top = MARGIN;
  const style: React.CSSProperties = {
    left,
    top,
    width: POPUP_WIDTH,
    pointerEvents: "auto",
  };

  // De-dupe neighbors that appear twice (e.g. both as 'sources' and 'evidence')
  const seen = new Set<string>();
  const dedupedNeighbors = neighbors.filter((n) => {
    if (seen.has(n.path)) return false;
    seen.add(n.path);
    return true;
  });

  return (
    <div
      className="pointer-events-auto absolute z-30 w-[320px] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
      style={style}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {/* Header — type chip + title */}
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="shrink-0 rounded-sm border border-border px-1 py-px font-code text-2xs uppercase tracking-wider text-muted-foreground">
          {detail.type.replace(/_/g, " ")}
        </span>
        <span className="truncate font-code text-xs text-foreground" title={detail.title}>
          {detail.title}
        </span>
      </div>
      {/* Path */}
      <code className="block break-all border-b border-border-subtle px-3 py-1.5 font-code text-2xs text-muted-foreground/60">
        {path.replace(/^arkive\//, "")}
      </code>
      {/* Excerpt — what's inside without opening */}
      {detail.excerpt && (
        <p className="px-3 py-2 text-xs leading-snug text-muted-foreground">{detail.excerpt}</p>
      )}

      {/* Connected nodes (1-hop) */}
      {dedupedNeighbors.length > 0 && (
        <div className="border-t border-border-subtle pb-1">
          <div className="px-3 pt-2 font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
            {neighborsLabel} · {dedupedNeighbors.length}
          </div>
          <ul className="mt-1">
            {dedupedNeighbors.slice(0, 6).map((n) => {
              const nd = nodeDetails?.get(n.path);
              const label = nd?.title ?? n.path.split("/").pop()?.replace(/\.md$/, "") ?? n.path;
              return (
                <li key={n.path}>
                  <button
                    type="button"
                    onClick={() => onNeighborClick(n.path)}
                    className="flex w-full items-center gap-2 px-3 py-1 text-left transition-colors duration-120 hover:bg-secondary/60"
                    title={`${label}\n${n.path}${n.reason ? `\n${n.edgeType ?? "link"}: ${n.reason}` : ""}`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-1 w-1 shrink-0 rounded-full"
                      style={{
                        background: n.edgeType ? EDGE_COLOR[n.edgeType] ?? "#5c5c5c" : "#5c5c5c",
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate font-code text-xs text-foreground/90">
                      {label}
                    </span>
                    {n.edgeType && (
                      <span className="shrink-0 font-code text-2xs uppercase tracking-wider text-muted-foreground/60">
                        {n.edgeType}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {dedupedNeighbors.length > 6 && (
              <li className="px-3 py-1 font-mono text-2xs text-muted-foreground/60">
                +{dedupedNeighbors.length - 6} more — open the node to see all
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function flatten(
  root: GraphTreeNode,
  expandedPaths?: Set<string>
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [{ id: MASTER_ID, label: "arkive", kind: "master", depth: 0, folderPath: "arkive" }];
  const links: GraphLink[] = [];

  /**
   * A folder's children render in the graph IFF the folder is expanded in
   * the side tree. Without an `expandedPaths` set we show everything
   * (back-compat with callers that don't pass it). Depth 1 nodes (direct
   * children of arkive/) always render as entry points — but their children
   * follow the expanded set like everyone else, so clicking a folder in
   * either panel stays in lockstep with the other.
   */
  function isExpanded(path: string, _depth: number): boolean {
    if (!expandedPaths) return true;
    return expandedPaths.has(path);
  }

  function visit(node: GraphTreeNode, depth: number, parentId: string) {
    if (depth === 0) {
      // skip root — represented by MASTER
      for (const child of node.children) visit(child, depth + 1, MASTER_ID);
      return;
    }
    const id = node.path;
    nodes.push({
      id,
      label: node.name,
      kind: node.isFolder ? "folder" : "file",
      depth,
      filePath: node.isFolder ? undefined : node.path,
      folderPath: node.isFolder ? node.path : undefined,
    });
    links.push({ source: parentId, target: id });
    // Recurse only when the parent folder is expanded — keeps the graph
    // in lockstep with what's visible in the file explorer.
    if (node.isFolder && isExpanded(node.path, depth)) {
      for (const child of node.children) visit(child, depth + 1, id);
    }
  }
  visit(root, 0, MASTER_ID);
  return { nodes, links };
}
