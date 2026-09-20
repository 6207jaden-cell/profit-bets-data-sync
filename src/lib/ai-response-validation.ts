// Item 13's insecure-deserialization review (2026-08-06): the AI
// gateway's JSON response is parsed via `JSON.parse(cleaned) as
// AiResponse` (autonomous-agent.ts's callGateway) — a TypeScript type
// ASSERTION, not runtime validation. If the model ever returns a
// malformed or unexpected-shape trade proposal (a missing field, wrong
// type, or a value outside any sane range), nothing catches it before
// downstream code — e.g. `t.symbol.toUpperCase()` — runs on it directly.
//
// Checked the actual blast radius before treating this as urgent: the
// trade-processing loop lives inside runForUser(), and the per-user call
// site already wraps runForUser() in its own try/catch — so today, an
// uncaught throw here is contained to one user's one scan cycle (logged,
// skipped, retried at the next scheduled run), not a wider outage. Still
// a real, worth-closing gap: a single malformed trade proposal currently
// aborts that ENTIRE cycle's remaining valid trades too, not just the
// bad one. This filter fixes that — skip only the malformed entries,
// keep processing the rest.

export type AiTradeShape = {
  symbol: string;
  direction: "long" | "short";
  instrument: string;
  conviction: number;
  allocation_pct: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  hold_duration: "intraday" | "swing" | "position";
  rationale: string;
  options_details?: unknown;
};

/**
 * Runtime type guard for one parsed AI trade proposal. Checks the fields
 * every downstream consumer in the trade-processing pipeline actually
 * dereferences without a null-check (symbol.toUpperCase(), direction
 * comparisons, numeric math on conviction/allocation_pct/stop_loss_pct/
 * take_profit_pct) — not a full exhaustive schema, deliberately scoped to
 * what would otherwise throw or silently corrupt downstream math.
 */
export function isValidAiTrade(trade: unknown): trade is AiTradeShape {
  if (trade == null || typeof trade !== "object") return false;
  const t = trade as Record<string, unknown>;

  if (typeof t.symbol !== "string" || t.symbol.trim().length === 0) return false;
  if (t.direction !== "long" && t.direction !== "short") return false;
  if (typeof t.instrument !== "string" || t.instrument.trim().length === 0) return false;
  if (typeof t.conviction !== "number" || !Number.isFinite(t.conviction)) return false;
  if (typeof t.allocation_pct !== "number" || !Number.isFinite(t.allocation_pct) || t.allocation_pct <= 0) return false;
  if (typeof t.stop_loss_pct !== "number" || !Number.isFinite(t.stop_loss_pct) || t.stop_loss_pct <= 0) return false;
  if (typeof t.take_profit_pct !== "number" || !Number.isFinite(t.take_profit_pct)) return false;
  if (t.hold_duration !== "intraday" && t.hold_duration !== "swing" && t.hold_duration !== "position") return false;
  if (typeof t.rationale !== "string") return false;

  return true;
}

/**
 * Filters an array of parsed AI trade proposals down to the valid ones,
 * logging (not throwing) for each malformed entry skipped — so one bad
 * proposal doesn't abort the whole batch's otherwise-valid trades.
 */
export function filterValidAiTrades(trades: unknown[]): AiTradeShape[] {
  const valid: AiTradeShape[] = [];
  for (const t of trades) {
    if (isValidAiTrade(t)) {
      valid.push(t);
    } else {
      const symbolHint = t != null && typeof t === "object" && "symbol" in t ? String((t as Record<string, unknown>).symbol) : "unknown";
      console.warn(`[autonomous-agent] skipping malformed AI trade proposal (symbol: ${symbolHint})`, t);
    }
  }
  return valid;
}

/**
 * An exit instruction for an already-open position. The prompt explicitly
 * tells the model it may exit a position with direction="close", and such a
 * proposal legitimately carries zeroed allocation/stop/target numbers — so it
 * cannot be validated with the entry rules above (that mismatch silently
 * discarded every exit decision the agent made; see CHANGELOG 2026-09-20).
 */
export type AiCloseShape = {
  symbol: string;
  direction: "close";
  rationale?: string;
};

export function isValidAiClose(proposal: unknown): proposal is AiCloseShape {
  if (proposal == null || typeof proposal !== "object") return false;
  const t = proposal as Record<string, unknown>;
  if (t.direction !== "close") return false;
  if (typeof t.symbol !== "string" || t.symbol.trim().length === 0) return false;
  if (t.rationale != null && typeof t.rationale !== "string") return false;
  return true;
}

/**
 * Splits one AI response's proposals into entries (long/short, strict rules)
 * and closes (exit instructions), dropping only genuinely malformed entries.
 */
export function splitAiProposals(proposals: unknown[]): { entries: AiTradeShape[]; closes: AiCloseShape[] } {
  const entries: AiTradeShape[] = [];
  const closes: AiCloseShape[] = [];
  for (const p of proposals) {
    if (isValidAiClose(p)) {
      closes.push(p);
    } else if (isValidAiTrade(p)) {
      entries.push(p);
    } else {
      const symbolHint = p != null && typeof p === "object" && "symbol" in p ? String((p as Record<string, unknown>).symbol) : "unknown";
      console.warn(`[autonomous-agent] skipping malformed AI trade proposal (symbol: ${symbolHint})`, p);
    }
  }
  return { entries, closes };
}
