// Daydreams tab — the human-facing lens on the autonomous loop.
//
// Sections, top to bottom, mirroring the funnel the engine writes:
//   1. Header — manual "Think now" trigger.
//   2. Run status — live stepper while a pass streams (reading → thinking →
//      writing), with an elapsed clock + real per-daydream progress, then a
//      result summary. There is no cadence/scheduler; a pass runs only when the
//      user clicks Think now.
//   3. Notices — surfaced daydreams, read-only HYPOTHESES (CP2).
//   4. Proposals — pending insights the human accepts/rejects (CP3).
//
// Data comes entirely from the bundle (notices, practices[].pending_insights)
// and goes back through existing gated routes — no parallel write path, no
// direct storage access. Styled in the workspace's instrument-panel dialect
// (border-border-subtle / bg-panel / mono micro-labels). Daydreams are framed
// as hypotheses (the `agent` cyan accent = AI moments), never as fact.

"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Bundle, Entry } from "./types";

type Props = {
  bundle: Bundle;
  /** Open a file (evidence / built-on daydream) in a file tab. */
  onSelectFile: (path: string) => void;
  /** Re-fetch the bundle after a run / decision. */
  onRefresh: () => void | Promise<void>;
};

/** Reject reasons (§5.4). "useful" is the accept reason, sent implicitly. */
const REJECT_REASONS = ["not_useful", "wrong", "too_speculative", "dont_care"] as const;
type RejectReason = (typeof REJECT_REASONS)[number];

type ProposalItem = { entry: Entry; practice: string };

type RunSummary = {
  daydreams_written: number;
  surfaced: number;
  proposed: number;
  recurrences_recorded?: number;
  note?: string;
};
type RunResult = { summary: RunSummary; cost: { usd: number; model_id: string; model_calls: number } };

/** Live run state, folded from the streamed NDJSON progress events. */
type RunPhase = "idle" | "reading" | "thinking" | "writing" | "done" | "error";
type RunProgress = {
  phase: RunPhase;
  context?: {
    observations: number;
    priorDaydreams: number;
    candidates: number;
    feedback: number;
    practices: number;
  };
  modelId?: string;
  total?: number;
  wrote?: number;
  surfaced?: number;
  proposed?: number;
};

export function DaydreamTab({ bundle, onSelectFile, onRefresh }: Props) {
  const notices = bundle.notices ?? [];
  const proposals: ProposalItem[] = bundle.practices.flatMap((p) =>
    (p.pending_insights ?? []).map((entry) => ({ entry, practice: p.name }))
  );

  const [prog, setProg] = useState<RunProgress>({ phase: "idle" });
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState(0);

  const running = prog.phase === "reading" || prog.phase === "thinking" || prog.phase === "writing";

  // Live elapsed clock — most meaningful during "Thinking" (the one opaque, long
  // model call). Ticks only while a run is in flight, then freezes.
  useEffect(() => {
    if (!running || startedAt == null) return;
    setNowTs(Date.now());
    const t = setInterval(() => setNowTs(Date.now()), 200);
    return () => clearInterval(t);
  }, [running, startedAt]);
  const elapsedMs = startedAt != null ? Math.max(0, nowTs - startedAt) : 0;

  // Fold one streamed progress event into run state. Phases arrive in order:
  // reading → context → thinking → writing → wrote* → done (or error).
  function applyEvent(ev: Record<string, unknown>) {
    switch (ev.phase) {
      case "reading":
        setProg((p) => ({ ...p, phase: "reading" }));
        break;
      case "context":
        setProg((p) => ({
          ...p,
          phase: "reading",
          context: {
            observations: num(ev.observations),
            priorDaydreams: num(ev.priorDaydreams),
            candidates: num(ev.candidates),
            feedback: num(ev.feedback),
            practices: num(ev.practices),
          },
        }));
        break;
      case "thinking":
        setProg((p) => ({ ...p, phase: "thinking", modelId: String(ev.modelId ?? "") }));
        break;
      case "writing":
        setProg((p) => ({ ...p, phase: "writing", total: num(ev.total), wrote: 0, surfaced: 0, proposed: 0 }));
        break;
      case "wrote":
        setProg((p) => ({
          ...p,
          phase: "writing",
          total: ev.total != null ? num(ev.total) : p.total,
          wrote: num(ev.index),
          surfaced: num(ev.surfaced),
          proposed: num(ev.proposed),
        }));
        break;
      case "done": {
        const summary = (ev.summary ?? {}) as RunSummary;
        const cost = (ev.cost ?? {}) as RunResult["cost"];
        setProg((p) => ({
          ...p,
          phase: "done",
          total: p.total ?? summary.daydreams_written ?? 0,
          wrote: summary.daydreams_written ?? p.wrote,
          surfaced: summary.surfaced ?? p.surfaced,
          proposed: summary.proposed ?? p.proposed,
        }));
        setRunResult({ summary, cost });
        void onRefresh(); // new notices / proposals appear
        break;
      }
      case "error":
        setProg({ phase: "error" });
        setRunError(typeof ev.error === "string" ? ev.error : "Run failed");
        break;
    }
  }

  async function thinkNow() {
    if (running) return;
    setRunError(null);
    setRunResult(null);
    const t0 = Date.now();
    setStartedAt(t0);
    setNowTs(t0);
    setProg({ phase: "reading" });
    try {
      const r = await fetch("/api/arkive-v2/daydream/run", { method: "POST" });
      if (!r.ok || !r.body) {
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `Run failed (${r.status})`);
      }
      // Stream the NDJSON progress events as the pass executes.
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const handleLine = (line: string) => {
        const s = line.trim();
        if (!s) return;
        try {
          applyEvent(JSON.parse(s) as Record<string, unknown>);
        } catch {
          /* ignore a partial / non-JSON line */
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          handleLine(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
      handleLine(buf); // flush a trailing line with no final newline
    } catch (e) {
      setProg({ phase: "error" });
      setRunError((e as Error).message);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1240px] px-8 pb-12 pt-7">
        {/* ---- Header ---- */}
        <div className="flex items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="font-code text-2xs uppercase tracking-[0.18em] text-muted-foreground/60">
              daydreams · hypotheses
            </div>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-foreground">
              Daydreams
            </h1>
            <p className="mt-1 max-w-[640px] text-sm leading-relaxed text-muted-foreground">
              Unverified thoughts the loop surfaced while running on its own. These are
              hypotheses, not facts — the strongest become proposals you decide on.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <button
              type="button"
              onClick={thinkNow}
              disabled={running}
              className="flex h-7 items-center gap-1.5 rounded-lg border border-agent/40 bg-agent/10 px-2.5 text-xs font-medium text-agent transition-colors duration-120 hover:bg-agent/20 disabled:opacity-50"
            >
              {running ? "Thinking…" : "Think now"}
            </button>
            <span className="font-code text-2xs uppercase tracking-wider text-muted-foreground/50">
              manual · uses your active model key
            </span>
          </div>
        </div>

        {/* ---- Run status — live stepper while streaming, summary when done ---- */}
        {(running || prog.phase === "done" || prog.phase === "error") && (
          <RunStatusPanel prog={prog} elapsedMs={elapsedMs} result={runResult} error={runError} />
        )}

        {/* ---- Notices (surfaced daydreams, read-only) ---- */}
        <section className="mt-6 border border-border-subtle bg-panel">
          <div className="flex h-9 items-center justify-between border-b border-border-subtle px-3">
            <span className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
              notices
            </span>
            <span className="font-mono text-2xs text-muted-foreground/60">{notices.length}</span>
          </div>
          {notices.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No notices yet. Run a daydream pass to surface the loop&apos;s strongest hypotheses.
            </p>
          ) : (
            <ul>
              {notices.map((n) => (
                <NoticeRow key={n.path} notice={n} onSelectFile={onSelectFile} />
              ))}
            </ul>
          )}
        </section>

        {/* ---- Proposals (pending insights — human-gated accept/reject) ---- */}
        <section className="mt-4 border border-border-subtle bg-panel">
          <div className="flex h-9 items-center justify-between border-b border-border-subtle px-3">
            <span className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
              proposals · pending
            </span>
            <span className="font-mono text-2xs text-muted-foreground/60">{proposals.length}</span>
          </div>
          {proposals.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No pending proposals. Strong daydreams graduate here for you to accept or reject.
            </p>
          ) : (
            <ul>
              {proposals.map(({ entry, practice }) => (
                <ProposalRow
                  key={entry.path}
                  entry={entry}
                  practice={practice}
                  onSelectFile={onSelectFile}
                  onRefresh={onRefresh}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Run status — live stepper while a pass streams, summary when it lands
 * -------------------------------------------------------------------------- */

const STEP_ORDER: RunPhase[] = ["reading", "thinking", "writing"];

/** Where a given step sits relative to the live phase. */
function stepState(step: RunPhase, phase: RunPhase): "pending" | "active" | "done" {
  if (phase === "done") return "done";
  if (phase === "error" || phase === "idle") return "pending";
  const pi = STEP_ORDER.indexOf(phase);
  const si = STEP_ORDER.indexOf(step);
  if (pi > si) return "done";
  if (pi === si) return "active";
  return "pending";
}

function RunStatusPanel({
  prog,
  elapsedMs,
  result,
  error,
}: {
  prog: RunProgress;
  elapsedMs: number;
  result: RunResult | null;
  error: string | null;
}) {
  const running = prog.phase === "reading" || prog.phase === "thinking" || prog.phase === "writing";
  const writePct =
    prog.total && prog.total > 0 ? Math.min(100, Math.round(((prog.wrote ?? 0) / prog.total) * 100)) : 0;

  return (
    <div className="mt-4 border border-border-subtle bg-panel">
      <div className="flex h-9 items-center justify-between border-b border-border-subtle px-3">
        <span className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
          {prog.phase === "error" ? "run failed" : prog.phase === "done" ? "run complete" : "daydream running"}
        </span>
        <span className="font-mono text-xs tabular-nums text-agent">
          {running ? fmtElapsed(elapsedMs) : prog.phase === "done" ? `in ${fmtElapsed(elapsedMs)}` : ""}
        </span>
      </div>

      {prog.phase === "error" ? (
        <p className="px-3 py-3 text-xs text-destructive">{error ?? "Run failed"}</p>
      ) : (
        <div className="px-3 py-3">
          <ol className="flex flex-col gap-2.5">
            <StepRow
              n={1}
              label="Reading your stream"
              state={stepState("reading", prog.phase)}
              detail={
                prog.context
                  ? `${prog.context.observations} observations · ${prog.context.priorDaydreams} prior daydreams · ${prog.context.candidates} patterns · ${prog.context.feedback} feedback`
                  : "gathering recent signal…"
              }
            />
            <StepRow
              n={2}
              label="Thinking"
              state={stepState("thinking", prog.phase)}
              detail={
                prog.modelId
                  ? `one model pass on ${prog.modelId} — the long step`
                  : "one model pass — the long step"
              }
            />
            <StepRow
              n={3}
              label="Writing daydreams"
              state={stepState("writing", prog.phase)}
              detail={
                prog.phase === "writing" || prog.phase === "done"
                  ? prog.total != null
                    ? `${prog.wrote ?? 0} / ${prog.total} written · ${prog.surfaced ?? 0} surfaced · ${prog.proposed ?? 0} proposed`
                    : "writing…"
                  : "surface + propose the strongest"
              }
            >
              {prog.phase === "writing" && prog.total ? (
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-sm bg-border">
                  <div
                    className="h-full bg-agent transition-all duration-200"
                    style={{ width: `${writePct}%` }}
                  />
                </div>
              ) : null}
            </StepRow>
          </ol>

          {prog.phase === "done" && result && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-subtle pt-3 font-mono text-xs text-muted-foreground">
              <span className="font-code uppercase tracking-wider text-muted-foreground/50">result</span>
              <span>{result.summary.daydreams_written} written</span>
              <span>{result.summary.surfaced} surfaced</span>
              <span>{result.summary.proposed} proposed</span>
              {typeof result.summary.recurrences_recorded === "number" && (
                <span>{result.summary.recurrences_recorded} reinforced</span>
              )}
              <span>${result.cost.usd.toFixed(4)}</span>
              <span className="text-muted-foreground/50">{result.cost.model_id}</span>
              {result.summary.note && <span className="text-warning">{result.summary.note}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepRow({
  n,
  label,
  state,
  detail,
  children,
}: {
  n: number;
  label: string;
  state: "pending" | "active" | "done";
  detail: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border font-mono text-2xs ${
          state === "done"
            ? "border-success/40 bg-success/10 text-success"
            : state === "active"
              ? "border-agent/50 bg-agent/10 text-agent"
              : "border-border text-muted-foreground/40"
        }`}
      >
        {state === "done" ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-medium ${
              state === "active"
                ? "text-foreground"
                : state === "done"
                  ? "text-muted-foreground"
                  : "text-muted-foreground/50"
            }`}
          >
            {label}
          </span>
          {state === "active" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-agent" />}
        </div>
        <p
          className={`mt-0.5 font-mono text-2xs leading-relaxed ${
            state === "pending" ? "text-muted-foreground/40" : "text-muted-foreground/70"
          }`}
        >
          {detail}
        </p>
        {children}
      </div>
    </li>
  );
}

/** mm:ss from a millisecond elapsed count. */
function fmtElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Coerce an unknown streamed field to a finite number (0 on failure). */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ----------------------------------------------------------------------------
 * Proposal row — one pending insight, accept/reject through the gated route
 * -------------------------------------------------------------------------- */

function ProposalRow({
  entry,
  practice,
  onSelectFile,
  onRefresh,
}: {
  entry: Entry;
  practice: string;
  onSelectFile: (path: string) => void;
  onRefresh: () => void | Promise<void>;
}) {
  const m = entry.meta as Record<string, unknown>;
  const title =
    (typeof m.title === "string" && m.title.trim()) || deriveTitle(entry.body) || shortPath(entry.path);
  const summary = (entry.body || "").trim();
  const proposedOutput = typeof m.proposed_output === "string" ? m.proposed_output : null;
  const evidence = strArray(m.evidence);

  // Loop provenance (§5.4) — present only on loop-authored proposals.
  const loopReasoning = typeof m.loop_reasoning === "string" ? m.loop_reasoning : null;
  const loopConfidence = typeof m.loop_confidence === "number" ? m.loop_confidence : null;
  const provenanceKind = typeof m.provenance_kind === "string" ? m.provenance_kind : null;
  const fromLoop = loopReasoning !== null || loopConfidence !== null;

  const [mode, setMode] = useState<null | "accepted" | "rejected">(null);
  const [reason, setReason] = useState<RejectReason>("not_useful");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: "accepted" | "rejected") {
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/arkive-v2/insight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          insightPath: entry.path,
          decision,
          userComment: comment,
          reason_type: decision === "accepted" ? "useful" : reason,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Failed");
      await onRefresh(); // proposal leaves pending/ → disappears on refresh
    } catch (e) {
      setError((e as Error).message);
    } finally {
      // Reset even on success: normally the row unmounts (the insight left
      // pending/), but if a stale refresh still lists it, re-enable so it's retryable.
      setSubmitting(false);
    }
  }

  return (
    <li className="border-b border-border-subtle px-3 py-3 last:border-b-0">
      {/* signal line */}
      <div className="flex flex-wrap items-center gap-2">
        {fromLoop ? (
          <span className="rounded-lg border border-agent/30 bg-agent/10 px-1.5 py-px font-code text-2xs uppercase tracking-wider text-agent">
            from loop
          </span>
        ) : (
          <span className="rounded-sm border border-border px-1.5 py-px font-code text-2xs uppercase tracking-wider text-muted-foreground/60">
            authored
          </span>
        )}
        <span className="rounded-sm border border-border px-1 py-px font-code text-2xs uppercase tracking-wider text-muted-foreground/70">
          {practice}
        </span>
        {proposedOutput && (
          <span className="font-mono text-2xs text-muted-foreground/70">→ {proposedOutput}</span>
        )}
        {loopConfidence !== null && (
          <span className="font-mono text-2xs text-muted-foreground/70">conf {loopConfidence.toFixed(2)}</span>
        )}
        {provenanceKind && (
          <span className="font-mono text-2xs text-muted-foreground/70">{provenanceKind}-grounded</span>
        )}
      </div>

      {/* title + summary */}
      <p className="mt-2 text-sm leading-snug text-foreground">{title}</p>
      {summary && summary !== title && (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{summary}</p>
      )}

      {/* the loop's own reasoning, if any */}
      {loopReasoning && (
        <p className="mt-2 border-l-2 border-agent/30 pl-2 text-xs leading-relaxed text-muted-foreground/80">
          {loopReasoning}
        </p>
      )}

      {evidence.length > 0 && (
        <div className="mt-2">
          <PathLinks label="evidence" paths={evidence} onSelectFile={onSelectFile} />
        </div>
      )}

      {/* decide controls */}
      <div className="mt-3">
        {mode === null ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode("accepted")}
              className="flex h-7 items-center rounded-lg border border-success/40 bg-success/10 px-2.5 text-xs font-medium text-success transition-colors duration-120 hover:bg-success/20"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => setMode("rejected")}
              className="flex h-7 items-center rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 text-xs font-medium text-destructive transition-colors duration-120 hover:bg-destructive/20"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => onSelectFile(entry.path)}
              className="flex h-7 items-center rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors duration-120 hover:bg-secondary hover:text-foreground"
            >
              Open
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-background p-2.5">
            <div className="font-code text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">
              {mode === "accepted" ? "accept proposal" : "reject proposal"}
            </div>
            {mode === "rejected" && (
              <div className="flex flex-wrap gap-1.5">
                {REJECT_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className={`flex h-6 items-center rounded-md border px-2 font-code text-2xs uppercase tracking-wider transition-colors duration-120 ${
                      reason === r
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground/70 hover:bg-secondary"
                    }`}
                  >
                    {r.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optional note…"
              rows={2}
              className="w-full rounded-lg border border-border bg-background p-2 font-mono text-xs text-foreground outline-none focus:border-primary"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => submit(mode)}
                className={`flex h-7 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors duration-120 disabled:opacity-50 ${
                  mode === "accepted"
                    ? "border-success/40 bg-success/10 text-success hover:bg-success/20"
                    : "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
                }`}
              >
                {submitting ? "Saving…" : mode === "accepted" ? "Confirm accept" : "Confirm reject"}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setMode(null);
                  setError(null);
                }}
                className="flex h-7 items-center rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors duration-120 hover:bg-secondary hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

function deriveTitle(body: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "";
}

/* ----------------------------------------------------------------------------
 * Notice row — one surfaced daydream
 * -------------------------------------------------------------------------- */

function NoticeRow({ notice, onSelectFile }: { notice: Entry; onSelectFile: (path: string) => void }) {
  const m = notice.meta as Record<string, unknown>;
  const confidence = typeof m.confidence === "number" ? m.confidence : null;
  const recurrence = typeof m.recurrence === "number" ? m.recurrence : 0;
  const practices = strArray(m.practices);
  const evidence = strArray(m.evidence);
  const builtOn = strArray(m.created_from);
  // Set once a daydream graduates into a pending insight (proposeInsight).
  // Such a notice is no longer "just" a hypothesis — it produced a proposal.
  const promotedTo = typeof m.promoted_to === "string" ? m.promoted_to : null;
  const body = (notice.body || "").trim();

  return (
    <li className="border-b border-border-subtle px-3 py-3 last:border-b-0">
      {/* signal line */}
      <div className="flex flex-wrap items-center gap-2">
        {promotedTo ? (
          <span className="rounded-lg border border-primary/40 bg-primary/10 px-1.5 py-px font-code text-2xs uppercase tracking-wider text-primary">
            proposed
          </span>
        ) : (
          <span className="rounded-lg border border-agent/30 bg-agent/10 px-1.5 py-px font-code text-2xs uppercase tracking-wider text-agent">
            hypothesis
          </span>
        )}
        {confidence !== null && (
          <span className="font-mono text-2xs text-muted-foreground/70">
            conf {confidence.toFixed(2)}
          </span>
        )}
        {recurrence > 0 && (
          <span className="font-mono text-2xs text-muted-foreground/70" title="times the loop re-arrived at this thought">
            ↻ {recurrence}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-1">
          {practices.length > 0 ? (
            practices.map((p) => (
              <span
                key={p}
                className="rounded-sm border border-border px-1 py-px font-code text-2xs uppercase tracking-wider text-muted-foreground/70"
              >
                {p}
              </span>
            ))
          ) : (
            <span className="font-code text-2xs uppercase tracking-wider text-muted-foreground/50">
              cross-cutting
            </span>
          )}
        </span>
      </div>

      {/* the thought */}
      <p className="mt-2 text-sm leading-relaxed text-foreground">{body}</p>

      {/* provenance links */}
      {(evidence.length > 0 || builtOn.length > 0 || promotedTo) && (
        <div className="mt-2 flex flex-col gap-1">
          {promotedTo && (
            <PathLinks label="proposed insight" paths={[promotedTo]} onSelectFile={onSelectFile} />
          )}
          {evidence.length > 0 && (
            <PathLinks label="grounded in" paths={evidence} onSelectFile={onSelectFile} />
          )}
          {builtOn.length > 0 && (
            <PathLinks label="builds on" paths={builtOn} onSelectFile={onSelectFile} />
          )}
        </div>
      )}
    </li>
  );
}

function PathLinks({
  label,
  paths,
  onSelectFile,
}: {
  label: string;
  paths: string[];
  onSelectFile: (path: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-code text-2xs uppercase tracking-wider text-muted-foreground/50">
        {label}
      </span>
      {paths.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onSelectFile(p)}
          className="font-mono text-xs text-muted-foreground transition-colors duration-120 hover:text-foreground"
          title={p}
        >
          {shortPath(p)}
        </button>
      ))}
    </div>
  );
}

/* ---- helpers ---- */

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Last two path segments — enough to identify the file without the full path. */
function shortPath(p: string): string {
  const parts = p.split("/");
  return parts.slice(-2).join("/");
}
