"use client";

// Rich markdown renderer for arkive entries.
// Source remains pure (downloadable) markdown — these enhancements are render-time only:
//   1. GFM tables, lists, strikethrough (already via remark-gfm)
//   2. GFM-style alerts:  > [!NOTE] / [!TIP] / [!WARNING] / [!IMPORTANT] / [!CAUTION] → colored callout boxes
//   3. ```chart``` fenced code blocks with JSON body → SVG bar/pie/sparkline charts
//   4. Inline HTML (color spans, badges) via rehype-raw — markdown spec allows raw HTML
//
// All enhancements degrade gracefully when the file is read in a plain markdown viewer.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { useMemo } from "react";

const ALERT_RE = /^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION|INFO|SUCCESS|DANGER)\]\s*(.*)$/i;

// Dark-mode callout tints per BRAND.md §2.2 — 500-stop hue at low alpha for
// bg/border, 300-stop for the label text.
const ALERT_STYLES: Record<string, { color: string; bg: string; border: string; label: string }> = {
  NOTE: { color: "#67E8F9", bg: "rgba(6,182,212,0.10)", border: "rgba(6,182,212,0.30)", label: "Note" },
  INFO: { color: "#67E8F9", bg: "rgba(6,182,212,0.10)", border: "rgba(6,182,212,0.30)", label: "Info" },
  TIP: { color: "#5EEAD4", bg: "rgba(20,184,166,0.10)", border: "rgba(20,184,166,0.30)", label: "Tip" },
  SUCCESS: { color: "#5EEAD4", bg: "rgba(20,184,166,0.10)", border: "rgba(20,184,166,0.30)", label: "Success" },
  IMPORTANT: { color: "#C4B5FD", bg: "rgba(139,92,246,0.10)", border: "rgba(139,92,246,0.30)", label: "Important" },
  WARNING: { color: "#FDE047", bg: "rgba(234,179,8,0.10)", border: "rgba(234,179,8,0.30)", label: "Warning" },
  CAUTION: { color: "#FB7185", bg: "rgba(244,63,94,0.10)", border: "rgba(244,63,94,0.30)", label: "Caution" },
  DANGER: { color: "#FB7185", bg: "rgba(244,63,94,0.10)", border: "rgba(244,63,94,0.30)", label: "Danger" },
};

export function RichMarkdown({ source }: { source: string }) {
  // Pre-process: convert chart fences into a marker we render via the `code` component.
  // Already supported by react-markdown — the language is "chart" — so we just need a
  // custom code renderer below.
  const transformed = useMemo(() => source, [source]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        h1: ({ children }) => (
          <h1 className="mb-4 mt-8 text-3xl font-bold tracking-tight text-foreground first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-3 mt-8 text-xl font-semibold tracking-tight text-foreground">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-2 mt-6 text-base font-semibold text-foreground">{children}</h3>
        ),
        a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
        blockquote: (props) => <BlockquoteWithAlertSupport {...props} />,
        code: ({ className, children, ...props }) => {
          const match = /language-(\w+)/.exec(className ?? "");
          const lang = match?.[1];
          const raw = String(children).replace(/\n$/, "");

          if (lang === "chart") {
            return <ChartBlock spec={raw} />;
          }
          if (!match) {
            // inline code
            return (
              <code
                {...props}
                className={(className ?? "") + " rounded bg-secondary px-1 py-0.5 font-code text-xs"}
              >
                {children}
              </code>
            );
          }
          // block code (default)
          return (
            <pre className="overflow-x-auto rounded-sm border border-border-subtle bg-background p-3 font-code text-xs text-foreground">
              <code className={className}>{raw}</code>
            </pre>
          );
        },
      }}
    >
      {transformed}
    </ReactMarkdown>
  );
}

/* ---------- GFM-style alert callouts ---------- */

function BlockquoteWithAlertSupport(props: React.HTMLAttributes<HTMLQuoteElement> & { children?: React.ReactNode }) {
  const { children, ...rest } = props;
  // react-markdown gives us children as React nodes. Walk to find the first text node.
  const firstText = extractFirstText(children);
  if (firstText) {
    const m = firstText.match(ALERT_RE);
    if (m) {
      const kind = m[1].toUpperCase();
      const style = ALERT_STYLES[kind];
      // Strip the [!KIND] prefix from rendering; render the rest as the callout body.
      const stripped = stripFirstLine(children);
      const trailingTitle = m[2]?.trim();
      return (
        <div
          className="my-3 rounded-sm border border-l-2 px-4 py-3"
          style={{ background: style.bg, borderColor: style.border }}
        >
          <div
            className="mb-1 font-code text-2xs font-medium uppercase tracking-wider"
            style={{ color: style.color }}
          >
            {trailingTitle || style.label}
          </div>
          <div className="text-sm text-foreground/90">{stripped}</div>
        </div>
      );
    }
  }
  return (
    <blockquote {...rest} className="border-l-3 my-3 border-border pl-3 text-muted-foreground">
      {children}
    </blockquote>
  );
}

function extractFirstText(node: React.ReactNode): string | null {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) {
    for (const c of node) {
      const t = extractFirstText(c);
      if (t) return t;
    }
    return null;
  }
  if (node && typeof node === "object" && "props" in node) {
    return extractFirstText((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return null;
}

function stripFirstLine(node: React.ReactNode): React.ReactNode {
  if (typeof node === "string") {
    const idx = node.indexOf("\n");
    return idx === -1 ? "" : node.slice(idx + 1);
  }
  if (Array.isArray(node)) {
    let stripped = false;
    return node.map((c, i) => {
      if (stripped) return c;
      if (typeof c === "string" && ALERT_RE.test(c)) {
        stripped = true;
        const idx = c.indexOf("\n");
        return idx === -1 ? "" : c.slice(idx + 1);
      }
      if (i === 0) {
        stripped = true;
        return stripFirstLine(c);
      }
      return c;
    });
  }
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props: { children?: React.ReactNode } }).props;
    const newChildren = stripFirstLine(props.children);
    return { ...(node as object), props: { ...props, children: newChildren } } as React.ReactNode;
  }
  return node;
}

/* ---------- Chart fenced blocks ---------- */

type ChartSpec = {
  type: "bar" | "pie" | "sparkline";
  title?: string;
  data: Array<{ label: string; value: number; color?: string }>;
};

function ChartBlock({ spec }: { spec: string }) {
  let parsed: ChartSpec | null = null;
  try {
    parsed = JSON.parse(spec) as ChartSpec;
  } catch {
    return (
      <pre className="rounded bg-destructive/10 p-3 text-xs text-destructive">
        <code>Invalid chart JSON: {spec}</code>
      </pre>
    );
  }
  if (parsed.type === "bar") return <BarChart spec={parsed} />;
  if (parsed.type === "pie") return <PieChart spec={parsed} />;
  if (parsed.type === "sparkline") return <SparklineChart spec={parsed} />;
  return <pre className="rounded bg-destructive/10 p-3 text-xs text-destructive">Unknown chart type: {String(parsed.type)}</pre>;
}

function ChartShell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <figure className="my-4 rounded-lg border border-border bg-card p-4">
      {title && <figcaption className="mb-2 font-code text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</figcaption>}
      {children}
    </figure>
  );
}

function BarChart({ spec }: { spec: ChartSpec }) {
  const W = 520;
  const rowH = 26;
  const padL = 110;
  const padR = 20;
  const innerW = W - padL - padR;
  const max = Math.max(...spec.data.map((d) => Math.abs(d.value)), 1);
  const H = spec.data.length * rowH + 16;
  return (
    <ChartShell title={spec.title}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={spec.title ?? "bar chart"}>
        {spec.data.map((d, i) => {
          const y = i * rowH + 6;
          const isNeg = d.value < 0;
          const barLen = (Math.abs(d.value) / max) * (innerW - 50);
          const baseX = padL;
          const c = d.color ?? (isNeg ? "#EF4444" : "#2962FF");
          return (
            <g key={d.label}>
              <text x={padL - 6} y={y + 13} textAnchor="end" fontSize="11" fill="#0A0A0F">
                {truncate(d.label, 14)}
              </text>
              <rect x={baseX} y={y + 4} width={Math.max(barLen, 1)} height={rowH - 10} rx={3} fill={c} opacity={0.85} />
              <text x={baseX + barLen + 6} y={y + 13} fontSize="11" fill="#0A0A0F">
                {formatValue(d.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartShell>
  );
}

function PieChart({ spec }: { spec: ChartSpec }) {
  const total = spec.data.reduce((s, d) => s + Math.abs(d.value), 0) || 1;
  const W = 360;
  const r = 110;
  const cx = 160;
  const cy = 130;
  let acc = 0;
  return (
    <ChartShell title={spec.title}>
      <svg viewBox={`0 0 ${W} 280`} className="w-full" role="img" aria-label={spec.title ?? "pie chart"}>
        {spec.data.map((d, i) => {
          const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
          acc += Math.abs(d.value);
          const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
          const large = end - start > Math.PI ? 1 : 0;
          const x1 = cx + r * Math.cos(start);
          const y1 = cy + r * Math.sin(start);
          const x2 = cx + r * Math.cos(end);
          const y2 = cy + r * Math.sin(end);
          const c = d.color ?? defaultPieColor(i);
          return (
            <path
              key={d.label}
              d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`}
              fill={c}
              opacity={0.9}
              stroke="white"
              strokeWidth={1.5}
            />
          );
        })}
        {spec.data.map((d, i) => (
          <g key={d.label} transform={`translate(285, ${20 + i * 18})`}>
            <rect width={10} height={10} fill={d.color ?? defaultPieColor(i)} />
            <text x={14} y={9} fontSize="11" fill="#0A0A0F">
              {truncate(d.label, 14)} ({Math.round((Math.abs(d.value) / total) * 100)}%)
            </text>
          </g>
        ))}
      </svg>
    </ChartShell>
  );
}

function SparklineChart({ spec }: { spec: ChartSpec }) {
  const W = 520;
  const H = 80;
  const max = Math.max(...spec.data.map((d) => d.value));
  const min = Math.min(...spec.data.map((d) => d.value));
  const range = max - min || 1;
  const stepX = W / Math.max(spec.data.length - 1, 1);
  const points = spec.data
    .map((d, i) => `${i * stepX},${H - ((d.value - min) / range) * (H - 8) - 4}`)
    .join(" ");
  return (
    <ChartShell title={spec.title}>
      <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full" role="img" aria-label={spec.title ?? "sparkline"}>
        <polyline points={points} fill="none" stroke="#2962FF" strokeWidth={2} strokeLinejoin="round" />
        <text x={6} y={H + 14} fontSize="10" fill="#6B7280">
          min {formatValue(min)} · max {formatValue(max)} · last {formatValue(spec.data[spec.data.length - 1]?.value ?? 0)}
        </text>
      </svg>
    </ChartShell>
  );
}

function truncate(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function formatValue(v: number) {
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

function defaultPieColor(i: number) {
  const palette = ["#2962FF", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#14B8A6", "#F97316", "#6B7280"];
  return palette[i % palette.length];
}
