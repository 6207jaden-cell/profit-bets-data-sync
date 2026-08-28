/**
 * Guardrails for the weekly self-learning loop.
 *
 * Root cause this exists for: weekly review "adjustments" are injected into
 * every scan prompt. During an early period when non-crypto trades were failing
 * for unrelated technical reasons, the reviewer concluded "only trade crypto"
 * and wrote that as an adjustment. Every later scan read it as a hard rule and
 * refused to trade stocks, ETFs or options — the agent locked itself into a
 * crypto-only universe permanently.
 *
 * Which asset classes and instrument types are tradeable is *system policy*,
 * not something the model may narrow on its own. Any adjustment that tries to
 * do so is dropped here, both when a new weekly review is saved and when old
 * reviews are read back into a prompt (so historical rows can't keep poisoning
 * scans even if they survive somewhere).
 */

const UNIVERSE_RESTRICTION_PATTERNS: RegExp[] = [
  /\bonly\b[^.]{0,60}\b(crypto|cryptocurrenc\w*)\b/i,
  /\b(crypto|cryptocurrency)[- ]only\b/i,
  /\b(exclusively|solely)\b[^.]{0,60}\b(crypto|cryptocurrenc\w*)\b/i,
  /\b(crypto|cryptocurrenc\w*)\b[^.]{0,60}\b(exclusively|solely)\b/i,
  /\b(avoid|stop|never|no|not|prohibit\w*|forbid\w*|ban|exclude|blacklist|disallow\w*)\b[^.]{0,60}\b(stock|stocks|equit\w+|etf|etfs|option|options)\b/i,
  /\b(stock|stocks|equit\w+|etf|etfs|option|options)\b[^.]{0,60}\b(are|is)\b[^.]{0,25}\b(forbidden|prohibited|not allowed|disallowed|banned|off limits|off-limits)\b/i,
  /\bnon-crypto\b/i,
  /\b(hard|pre-trade|pretrade)\b[^.]{0,60}\bfilter\b[^.]{0,80}\b(crypto|stock|stocks|equit\w+|etf)\b/i,
  /\bLEARNED RULE\b[^.]{0,80}\bcrypto\b/i,
  /\bcrypto\b[^.]{0,40}\b(mandate|only rule|focus only)\b/i,
];

/** True when a single adjustment string tries to narrow the tradeable universe. */
export function isUniverseRestrictingAdjustment(text: string | null | undefined): boolean {
  const s = String(text ?? "");
  if (!s.trim()) return false;
  return UNIVERSE_RESTRICTION_PATTERNS.some((re) => re.test(s));
}

/** Drop every adjustment that tries to narrow the tradeable universe. */
export function sanitizeLearningAdjustments(adjustments: unknown): string[] {
  if (!Array.isArray(adjustments)) return [];
  return adjustments
    .map((a) => String(a ?? "").trim())
    .filter((a) => a.length > 0 && !isUniverseRestrictingAdjustment(a));
}

/**
 * Same treatment for free-text analysis that gets summarised into the prompt:
 * remove whole sentences that assert a universe restriction, keep the rest.
 */
export function sanitizeLearningAnalysis(analysis: string | null | undefined): string {
  const s = String(analysis ?? "");
  if (!s.trim()) return "";
  return s
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !isUniverseRestrictingAdjustment(sentence))
    .join(" ")
    .trim();
}

/**
 * Instruction appended to the weekly-review system prompt so the reviewer stops
 * producing universe restrictions in the first place (the sanitizers above are
 * the backstop; this is the prevention).
 */
export const LEARNING_SCOPE_INSTRUCTION = `
SCOPE LIMITS — these are system policy and NOT yours to change:
- Never propose restricting which asset classes or instrument types may be traded (e.g. "trade only crypto", "focus exclusively on crypto", "avoid stocks/ETFs/options", "filter out non-crypto"). Stocks, ETFs, crypto and options are all permanently in scope.
- If a group of trades performed badly, say so as an observation about market conditions, sizing, entries or exits — never as a ban on that asset class.
- Adjustments must be about risk sizing, entry/exit timing, stop/target levels, signal weighting, hold duration and conviction thresholds.`;
