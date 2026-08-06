// Single source of truth for which instrument types are valid to PROPOSE
// (used to build the AI's JSON schema) and which ones are OPTIONS
// instruments specifically (used to branch position-sizing math). Extracted
// here specifically because BUG-003 existed due to these being two
// independently-maintained lists that drifted apart: the AI's schema
// enum listed "iron_condor" as selectable, but the options-math branch
// (`isOptionsInstrument` in autonomous-agent.ts) deliberately excluded it
// (since 4-leg execution was never built) — meaning if the AI ever picked
// it, the trade silently fell through to incorrect stock-quantity math
// instead of erroring or being rejected. One shared list closes that
// drift risk permanently, not just for this one historical incident.
//
// "iron_condor" is deliberately NOT included here — it has no real
// execution path (see DECISION_LOG.md D-05, TECHNICAL_DEBT.md TD-05).
// The AI's schema should never offer it as a choice until real 4-leg
// execution exists. Other code that needs to defensively RECOGNIZE
// "iron_condor" if it ever appears in historical data (cost-reality.ts,
// portfolio-attribution.ts) intentionally keeps its own separate,
// defensive check — that's a different concern (handling unexpected
// values gracefully) from this file's concern (defining valid choices).

export const OPTIONS_INSTRUMENT_TYPES = ["call", "put", "call_spread", "put_spread"] as const;
export const NON_OPTIONS_INSTRUMENT_TYPES = ["stock", "etf", "crypto"] as const;
export const ALL_PROPOSABLE_INSTRUMENT_TYPES = [...NON_OPTIONS_INSTRUMENT_TYPES, ...OPTIONS_INSTRUMENT_TYPES] as const;

export type OptionsInstrumentType = typeof OPTIONS_INSTRUMENT_TYPES[number];
export type ProposableInstrumentType = typeof ALL_PROPOSABLE_INSTRUMENT_TYPES[number];

export function isOptionsInstrumentType(instrument: string | null | undefined): boolean {
  return OPTIONS_INSTRUMENT_TYPES.includes((instrument ?? "").toLowerCase() as OptionsInstrumentType);
}
