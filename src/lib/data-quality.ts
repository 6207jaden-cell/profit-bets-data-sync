/**
 * Data-integrity screen for trade rows.
 *
 * Background: 19 closed paper_trades had |return| > 100% because
 * fetchQuotePrice accepted a single unchecked quote source when writing
 * entry_price. Those rows accounted for the large majority of all reported
 * P&L. The root cause is fixed in src/lib/indicators.ts (cross-source
 * corroboration); this module is the second line of defence — any trade
 * that still closes with an impossible return is FLAGGED, not deleted and
 * not silently trusted. See DECISION_LOG.md (2026-09-18) and
 * diag_flagged_trades().
 */

export const IMPLAUSIBLE_RETURN_PCT = 100;

/** Return on notional, in percent. Null when notional is unknown/zero. */
export function returnPctOfNotional(
  pnl: number | null | undefined,
  entryPrice: number | null | undefined,
  quantity: number | null | undefined,
): number | null {
  // A missing pnl is "unknown", not zero — Number(null) would silently be 0
  // and make an unrecorded trade look like a flat, verified 0% return.
  if (pnl == null) return null;
  const p = Number(pnl);
  const notional = Number(entryPrice) * Number(quantity);
  if (!Number.isFinite(p) || !Number.isFinite(notional) || notional === 0) return null;
  return (p / notional) * 100;
}

/**
 * True when a closed trade's return is outside anything a real fill can
 * produce for this system's position sizing — i.e. the price data behind it
 * cannot be trusted.
 */
export function isImplausibleReturn(
  pnl: number | null | undefined,
  entryPrice: number | null | undefined,
  quantity: number | null | undefined,
): boolean {
  const ret = returnPctOfNotional(pnl, entryPrice, quantity);
  if (ret == null) return false;
  return Math.abs(ret) > IMPLAUSIBLE_RETURN_PCT;
}

// The generated Database type lags the applied migrations (data_quality_flag
// is newer than the last codegen run), and a fully-typed client parameter
// would make every internal .update() call here fail type-checking.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MinimalAdmin = any;

/**
 * Flag a just-closed trade when its return is impossible. Auditable and
 * reversible: the row is kept exactly as recorded, only marked so that
 * analytics and the learning loop exclude it.
 */
export async function flagTradeIfImplausible(
  supabaseAdmin: MinimalAdmin,
  tradeId: string,
  pnl: number | null | undefined,
  entryPrice: number | null | undefined,
  quantity: number | null | undefined,
): Promise<boolean> {
  if (!isImplausibleReturn(pnl, entryPrice, quantity)) return false;
  const ret = returnPctOfNotional(pnl, entryPrice, quantity);
  try {
    await supabaseAdmin.from("paper_trades").update({
      data_quality_flag: true,
      data_quality_reason: `implausible_return_pct_gt_${IMPLAUSIBLE_RETURN_PCT}: computed ${ret?.toFixed(1)}% on notional — quote data not trusted`,
    }).eq("id", tradeId);
  } catch (e) {
    console.warn("[data-quality] failed to flag trade", tradeId, e instanceof Error ? e.message : JSON.stringify(e));
  }
  console.warn(`[data-quality] trade ${tradeId} flagged: return ${ret?.toFixed(1)}% exceeds ±${IMPLAUSIBLE_RETURN_PCT}%`);
  return true;
}
