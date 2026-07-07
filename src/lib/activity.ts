// Activity stream — DEPRECATED in v2.
//
// In the v1 arkive substrate this module wrote every action (swap_queued,
// swap_approved, transfer_*, lp_*, wrap_*, etc.) into the journal as atom-
// level entries that then compacted into session → daily → weekly → monthly
// recaps. The v2 blueprint replaces this with explicit MCP tools:
//   - append_trade_entry / append_trade_exit handle trade lifecycle directly
//   - append_conversation handles substantive discussions
//   - write_recap / write_review handle period summaries
//   - propose_insight handles pattern observations
//
// So this file is now a NO-OP for new callers. It preserves the legacy
// `logAction` + `ActionKind` + `LogActionInput` exports so the existing
// pending-route + MCP DeFi tool plumbing compiles without rewrite, but the
// function silently returns instead of writing anything. The atoms-to-recaps
// cascade is gone; recap writing in v2 is an explicit MCP tool call.

export type ActionKind =
  | "safety_scan"
  | "swap_queued"
  | "swap_approved"
  | "swap_rejected"
  | "swap_failed"
  | "transfer_queued"
  | "transfer_approved"
  | "transfer_rejected"
  | "transfer_failed"
  | "approve_queued"
  | "approve_approved"
  | "approve_rejected"
  | "approve_failed"
  | "wrap_queued"
  | "wrap_approved"
  | "wrap_rejected"
  | "wrap_failed"
  | "lp_queued"
  | "lp_approved"
  | "lp_rejected"
  | "lp_failed"
  | "wallet_onboarded"
  | "cost_basis_set"
  | "chain_sync_run"
  | "rule_changed"
  | "profile_changed";

export type Severity = "info" | "warn" | "critical";

export type ActionTarget = {
  token?: { address: string; symbol: string; chain: string };
  wallet?: { id?: string; address?: string; kind?: "owned" | "watch" };
  amount_usd?: number;
  rule_id?: string;
  dimension?: string;
};

export type ActionResult = {
  verdict?: "safe" | "caution" | "danger";
  expected_output_amount?: string;
  expected_output_symbol?: string;
  price_impact_pct?: number;
  decision?: "approved" | "rejected" | "expired";
  tx_hash?: string;
  error?: string;
  before?: string;
  after?: string;
};

export type LogActionInput = {
  action: ActionKind;
  actor: "user" | "claude" | "system";
  severity?: Severity;
  target?: ActionTarget;
  result?: ActionResult;
  duration_ms?: number;
  linked_refs?: Array<Record<string, unknown>>;
  title?: string;
};

/** No-op in v2. Kept so call sites compile. */
export async function logAction(_input: LogActionInput): Promise<void> {
  return;
}
