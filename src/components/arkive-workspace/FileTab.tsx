// FileTab — the tab content when a file is opened.
//
// Layout: file path breadcrumb header (with action buttons), YAML frontmatter
// block (syntax highlighted), markdown body, then a References panel below
// listing outgoing/incoming backlinks.
//
// Keeps the same brand colors as the rest of the workspace (greyscale,
// red-only-for-destructive). The frontmatter YAML keys use a muted-teal that
// still reads as "type token" without bringing color back into the UI.

"use client";

import { useState, useMemo } from "react";
import { RichMarkdown } from "@/components/RichMarkdown";
import { serializeYaml } from "@/lib/arkive-v2/frontmatter";

type Edge = { from: string; to: string; type: string; reason?: string; broken?: boolean };

type Props = {
  path: string;
  meta: Record<string, unknown>;
  body: string;
  backlinks: Edge[];
  onOpenPath: (p: string) => void;
  onSaved: () => Promise<void>;
  onBack?: () => void;
};

export function FileTab({ path, meta, body, backlinks, onOpenPath, onSaved, onBack }: Props) {
  // User-editable root files. Each entry knows its endpoint, payload
  // shape, placeholder, and help text. Per-practice instructions files
  // (arkive/practices/<name>/practice.instructions.md) are matched by
  // pattern below — they all use the same endpoint with the practice
  // slug extracted from the path.
  type EditSpec = {
    endpoint: string;
    placeholder: string;
    help: string;
    /** Extra fields to include in the POST body (beyond { body }). */
    extraPayload?: Record<string, string>;
  };
  // Match by FILENAME pattern, not exact path. This way identity.md and
  // loadup.md remain editable even when they're misrouted under a practice
  // subfolder (the pre-v7 "core is a practice" bug left some users with
  // identity at practices/core/identity.md instead of arkive/identity.md).
  // The endpoints always write to the canonical root path, so saving from
  // a misrouted file also fixes the location.
  const isIdentity = /(^|\/)identity\.md$/.test(path);
  const isLoadup = /(^|\/)loadup\.md$/.test(path);
  const practiceInstrMatch = path.match(/^arkive\/practices\/([^/]+)\/practice\.instructions\.md$/);
  const isStreamEntry = /^arkive\/stream\//.test(path);

  let editable: EditSpec | undefined;
  if (isStreamEntry) {
    editable = {
      endpoint: "/api/arkive-v2/stream-entry",
      placeholder: "Write your note…",
      help: "Personal stream note. Saved as-is.",
      extraPayload: { path },
    };
  } else if (isIdentity) {
    editable = {
      endpoint: "/api/arkive-v2/identity",
      placeholder:
        "I'm a self-directed trader running $X capital, medium-horizon, evenings only...",
      help: "Write a short bio: who you are, what you're tracking, how you want me to talk to you, hard limits. 5–10 lines is plenty. Markdown OK.",
    };
  } else if (isLoadup) {
    editable = {
      endpoint: "/api/arkive-v2/loadup",
      placeholder:
        "Tell me my open trade positions and which are most in the red. Then ask what I want to do.",
      help:
        "What do you want me to surface when you open Ark? Brief is good. Examples: 'Show my open positions and what's bleeding.' or 'Quietly load context — wait for me to bring up what I want.'",
    };
  } else if (practiceInstrMatch) {
    editable = {
      endpoint: "/api/arkive-v2/practice-instructions",
      placeholder:
        "Defaults, tool sequences, anti-patterns, decisive-execution rules for this practice...",
      help: `Tell me how to act inside the ${practiceInstrMatch[1]} practice. Defaults, tool sequences, things I should never do, when to log silently vs ask. Anything I should know to act like a competent partner here.`,
      extraPayload: { practice: practiceInstrMatch[1] },
    };
  }
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const outgoing = useMemo(() => backlinks.filter((e) => e.from === path), [backlinks, path]);
  const incoming = useMemo(() => backlinks.filter((e) => e.to === path), [backlinks, path]);

  function startEdit() {
    const looksLikePlaceholder =
      body.includes("Fill this in during onboarding") ||
      body.includes("Edit this file to tell Ark") ||
      body.includes("Edit freely; this is\nyour file");
    setDraft(looksLikePlaceholder ? "" : body.replace(/^##\s+v1[^\n]*\n+/m, "").trim());
    setEditing(true);
  }

  async function save() {
    if (!editable) return;
    setSaving(true);
    try {
      const r = await fetch(editable.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: draft.trim(),
          ...(editable.extraPayload ?? {}),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `Save failed: ${r.status}`);
      setEditing(false);
      await onSaved();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[880px] px-8 pb-12 pt-6">
      {/* Header — back button + path + edit action */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-3">
        <div className="flex min-w-0 items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="shrink-0 font-sans text-2xs text-muted-foreground/50 transition-colors hover:text-foreground"
            >
              ← Arkive
            </button>
          )}
          <code className="min-w-0 break-all font-code text-xs text-muted-foreground/70">{path}</code>
        </div>
        {editable && !editing && (
          <button
            onClick={startEdit}
            className="flex h-7 items-center rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors duration-120 hover:bg-secondary hover:text-foreground"
          >
            Edit
          </button>
        )}
      </div>

      {editing && editable ? (
        <div className="mt-6 space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">{editable.help}</p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-72 w-full rounded-lg border border-border bg-panel p-3 font-mono text-xs leading-relaxed text-foreground outline-none transition-colors focus:border-primary/60"
            placeholder={editable.placeholder}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="flex h-7 items-center rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors duration-120 hover:bg-secondary hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !draft.trim()}
              className="flex h-7 items-center rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {Object.keys(meta).length > 0 && <YamlBlock meta={meta} />}
          <div className="prose mt-6 max-w-none text-sm">
            <RichMarkdown source={body} />
          </div>

          {(outgoing.length > 0 || incoming.length > 0) && (
            <div className="mt-10 grid gap-4 border-t border-border-subtle pt-6 md:grid-cols-2">
              <ReferencePanel
                title="References"
                subtitle="What this file points to"
                edges={outgoing}
                role="outgoing"
                onOpenPath={onOpenPath}
              />
              <ReferencePanel
                title="Referenced by"
                subtitle="What points to this file"
                edges={incoming}
                role="incoming"
                onOpenPath={onOpenPath}
              />
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}

/* ============================================================================
 * YamlBlock — syntax-highlighted frontmatter block, restyled for the
 * workspace's greyscale palette.
 * ========================================================================== */
function YamlBlock({ meta }: { meta: Record<string, unknown> }) {
  const yaml = serializeYaml(meta).trimEnd();
  const lines = yaml.split("\n");
  return (
    <pre className="mt-6 overflow-x-auto rounded-xl border border-border-subtle bg-panel p-4 font-mono text-xs leading-relaxed">
      <code className="block">
        <div className="text-muted-foreground/40">---</div>
        {lines.map((line, i) => (
          <YamlLine key={i} line={line} />
        ))}
        <div className="text-muted-foreground/40">---</div>
      </code>
    </pre>
  );
}

function YamlLine({ line }: { line: string }) {
  const commentIdx = findCommentStart(line);
  const main = commentIdx >= 0 ? line.slice(0, commentIdx).trimEnd() : line;
  const comment = commentIdx >= 0 ? line.slice(commentIdx) : "";

  const m = main.match(/^(\s*)([A-Za-z0-9_\-]+):\s?(.*)$/);
  if (m) {
    const [, indent, key, value] = m;
    return (
      <div>
        <span>{indent}</span>
        <span className="text-info">{key}</span>
        <span className="text-muted-foreground/40">:</span>
        {value && (
          <span className={isPlaceholderValue(value) ? "text-muted-foreground/40" : "text-foreground"}>
            {" "}
            {value}
          </span>
        )}
        {comment && <span className="text-muted-foreground/40">  {comment}</span>}
      </div>
    );
  }
  return (
    <div>
      <span className={isPlaceholderValue(main) ? "text-muted-foreground/40" : "text-foreground"}>{main}</span>
      {comment && <span className="text-muted-foreground/40">  {comment}</span>}
    </div>
  );
}

function findCommentStart(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "#" && (i === 0 || /\s/.test(line[i - 1]))) return i;
  }
  return -1;
}
function isPlaceholderValue(v: string): boolean {
  const t = v.trim();
  return t.startsWith("<") && t.endsWith(">");
}

/* ============================================================================
 * Reference panel — outgoing or incoming backlinks for the open file.
 * ========================================================================== */
function ReferencePanel({
  title,
  subtitle,
  edges,
  role,
  onOpenPath,
}: {
  title: string;
  subtitle: string;
  edges: Edge[];
  role: "outgoing" | "incoming";
  onOpenPath: (p: string) => void;
}) {
  if (edges.length === 0) return null;
  return (
    <div className="rounded-xl border border-border-subtle bg-panel overflow-hidden">
      <div className="flex h-8 items-center justify-between border-b border-border-subtle px-3">
        <h3 className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
          {title}
        </h3>
        <span className="font-mono text-2xs text-muted-foreground/50">{subtitle}</span>
      </div>
      <ul>
        {edges.map((e, i) => {
          const target = role === "outgoing" ? e.to : e.from;
          return (
            <li key={i} className="border-b border-border-subtle last:border-b-0">
              <button
                type="button"
                onClick={() => onOpenPath(target)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-120 hover:bg-secondary/50"
                title={target + (e.reason ? `\n${e.type}: ${e.reason}` : `\n${e.type}`)}
              >
                <span className="shrink-0 font-code text-2xs uppercase tracking-wider text-muted-foreground/60">
                  {e.type}
                </span>
                <span className="truncate font-mono text-xs text-foreground/90">
                  {target.replace(/^arkive\//, "")}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
