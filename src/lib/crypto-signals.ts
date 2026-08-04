// Crypto-specific market structure signals that price/volume technicals can't
// see. These are the signals professional crypto desks actually watch:
// funding rate (leverage/positioning in the derivatives market) and BTC
// dominance rate of change (capital rotation between BTC and alts). Both
// come from free, keyless public APIs.

export type FundingRateInfo = {
  symbol: string;
  /** Funding rate as a percentage (e.g. 0.01 = 0.01%), paid every 8h on Binance perps. */
  fundingRatePct: number;
};

/**
 * Perpetual futures funding rate from Binance's public API (no auth needed).
 * Extremely high positive funding means longs are paying shorts heavily to
 * stay open — a sign of dangerous over-leverage that often precedes a long
 * squeeze (sharp reversal). Extremely negative funding is the mirror image
 * for shorts. Rough thresholds: |rate| > 0.05% per 8h = elevated, > 0.1% =
 * high, > 0.2% = extreme.
 */
export async function fetchFundingRate(cryptoBaseSymbol: string): Promise<FundingRateInfo | null> {
  try {
    const symbol = `${cryptoBaseSymbol.toUpperCase()}USDT`;
    const r = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { symbol?: string; lastFundingRate?: string };
    if (j.lastFundingRate == null) return null;
    const rate = Number(j.lastFundingRate);
    if (!Number.isFinite(rate)) return null;
    return { symbol: j.symbol ?? symbol, fundingRatePct: Number((rate * 100).toFixed(4)) };
  } catch {
    return null;
  }
}

/** Human-readable interpretation of a funding rate for prompt context. */
export function interpretFundingRate(fundingRatePct: number): string {
  const abs = Math.abs(fundingRatePct);
  const direction = fundingRatePct > 0 ? "longs overleveraged" : "shorts overleveraged";
  if (abs > 0.2) return `EXTREME (${direction}, squeeze risk high)`;
  if (abs > 0.1) return `HIGH (${direction})`;
  if (abs > 0.05) return `elevated (${direction})`;
  return "normal";
}

/**
 * Current BTC dominance (BTC's % of total crypto market cap) from CoinGecko's
 * free global endpoint (no auth needed).
 */
export async function fetchBtcDominance(): Promise<number | null> {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/global");
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: { market_cap_percentage?: { btc?: number } } };
    const btc = j.data?.market_cap_percentage?.btc;
    return typeof btc === "number" ? Number(btc.toFixed(3)) : null;
  } catch {
    return null;
  }
}

/**
 * Fetches current BTC dominance, stores the reading, and compares against a
 * snapshot from ~2 hours ago to compute a rate of change. A rising dominance
 * ROC means capital is rotating OUT of altcoins INTO BTC (alts underperform
 * or sell off harder than BTC) — a falling one means the opposite (alt
 * season conditions). This is a leading indicator: the rotation is often
 * visible in dominance before it's obvious in individual alt price action.
 */
export async function getBtcDominanceRoc(
  supabaseAdmin: { from: (table: string) => any },
): Promise<{ current: number; changePct: number; interpretation: string } | null> {
  const current = await fetchBtcDominance();
  if (current == null) return null;

  try {
    await supabaseAdmin.from("btc_dominance_snapshots").insert({ dominance_pct: current });
  } catch { /* best-effort — still return the current reading even if storage fails */ }

  let changePct = 0;
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    const { data: prior } = await supabaseAdmin
      .from("btc_dominance_snapshots")
      .select("dominance_pct, created_at")
      .lte("created_at", twoHoursAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prior) changePct = Number((current - Number(prior.dominance_pct)).toFixed(3));
  } catch { /* changePct stays 0 if we can't look up history yet */ }

  const interpretation = changePct > 1.5
    ? "RAPID ROTATION TO BTC — alts likely underperforming/selling off, reduce alt exposure"
    : changePct > 0.5
    ? "mild rotation to BTC"
    : changePct < -1.5
    ? "RAPID ROTATION TO ALTS — alt season conditions, favorable for alt longs"
    : changePct < -0.5
    ? "mild rotation to alts"
    : "stable, no significant rotation";

  return { current, changePct, interpretation };
}

/** True on Saturday or Sunday UTC — crypto's thinnest-liquidity window. */
export function isCryptoWeekend(): boolean {
  const day = new Date().getUTCDay();
  return day === 0 || day === 6;
}
