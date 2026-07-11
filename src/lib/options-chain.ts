/**
 * Fetches real options contracts from Polygon to match the AI's abstract
 * options spec (e.g. "ATM call, 21 days out") to an actual tradeable contract.
 *
 * Server-side only — uses POLYGON_API_KEY.
 */

export type OptionsSpec = {
  expiry_days_out: number;
  strike_type: "atm" | "otm_1" | "otm_2" | "itm_1";
  contracts: number;
  spread_width?: number | null;
};

export type ResolvedContract = {
  ticker: string;          // OCC symbol e.g. O:AAPL250718C00185000
  expiration_date: string;
  strike: number;
  contract_type: "call" | "put";
  bid: number;
  ask: number;
  mid: number;
  open_interest: number;
  volume: number;
  implied_volatility: number | null;
  delta: number | null;
  days_to_expiry: number;
};

/**
 * Resolves an abstract options spec to a real Polygon contract.
 * Returns null if no matching contract found or Polygon key not set.
 */
export async function resolveOptionsContract(
  underlying: string,
  direction: "call" | "put",
  currentPrice: number,
  spec: OptionsSpec,
): Promise<ResolvedContract | null> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return null;

  try {
    // Calculate target expiry date
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + spec.expiry_days_out);
    // Round to nearest Friday (options typically expire Fridays)
    const day = targetDate.getDay();
    if (day !== 5) {
      const daysToFriday = day < 5 ? 5 - day : 7 - day + 5;
      targetDate.setDate(targetDate.getDate() + daysToFriday);
    }
    const expiryStr = targetDate.toISOString().slice(0, 10);
    // Fetch options chain snapshot from Polygon
    const sym = underlying.toUpperCase().replace("-USD", "");
    const url = new URL(`https://api.polygon.io/v3/snapshot/options/${sym}`);
    url.searchParams.set("apiKey", key);
    url.searchParams.set("contract_type", direction);
    url.searchParams.set("expiration_date.gte", expiryStr);
    url.searchParams.set("expiration_date.lte", new Date(targetDate.getTime() + 14 * 86400_000).toISOString().slice(0, 10));
    url.searchParams.set("limit", "50");
    url.searchParams.set("sort", "expiration_date");

    const r = await fetch(url.toString());
    if (!r.ok) return null;

    const json = (await r.json()) as {
      results?: Array<{
        details?: {
          contract_type: string;
          expiration_date: string;
          strike_price: number;
          ticker: string;
        };
        day?: { volume?: number };
        last_quote?: { bid?: number; ask?: number };
        greeks?: { delta?: number; implied_volatility?: number };
        open_interest?: number;
        implied_volatility?: number;
      }>;
    };

    if (!json.results?.length) return null;

    // Determine target strike based on spec
    function targetStrike(type: OptionsSpec["strike_type"], price: number, dir: string): number {
      const step = price < 20 ? 0.5 : price < 50 ? 1 : price < 200 ? 5 : 10;
      const atm = Math.round(price / step) * step;
      const otmDir = dir === "call" ? 1 : -1;
      switch (type) {
        case "atm": return atm;
        case "otm_1": return atm + otmDir * step;
        case "otm_2": return atm + otmDir * step * 2;
        case "itm_1": return atm - otmDir * step;
        default: return atm;
      }
    }

    const idealStrike = targetStrike(spec.strike_type, currentPrice, direction);

    // Find closest matching contract
    const candidates = json.results
      .filter((c) => {
        if (c.details?.contract_type?.toLowerCase() !== direction) return false;
        // Liquidity filter: skip illiquid contracts
        const oi = c.open_interest ?? 0;
        const bid = c.last_quote?.bid ?? 0;
        const ask = c.last_quote?.ask ?? 0;
        const mid = (bid + ask) / 2;
        if (oi < 100) return false; // too little open interest
        if (mid > 0 && (ask - bid) / mid > 0.25) return false; // spread > 25% of mid = too wide
        return true;
      })
      .map((c) => ({
        ...c,
        strikeDiff: Math.abs((c.details?.strike_price ?? 0) - idealStrike),
      }))
      .sort((a, b) => a.strikeDiff - b.strikeDiff);

    // If no liquid contracts found, fall back to best available without liquidity filter
    const allCandidates = candidates.length > 0 ? candidates : json.results
      .filter((c) => c.details?.contract_type?.toLowerCase() === direction)
      .map((c) => ({ ...c, strikeDiff: Math.abs((c.details?.strike_price ?? 0) - idealStrike) }))
      .sort((a, b) => a.strikeDiff - b.strikeDiff);

    const best = allCandidates[0];
    if (!best?.details) return null;

    const bid = best.last_quote?.bid ?? 0;
    const ask = best.last_quote?.ask ?? 0;
    const mid = (bid + ask) / 2;
    const expDate = best.details.expiration_date;
    const dte = Math.round((new Date(expDate).getTime() - Date.now()) / 86400_000);

    return {
      ticker: best.details.ticker,
      expiration_date: expDate,
      strike: best.details.strike_price,
      contract_type: direction,
      bid,
      ask,
      mid,
      open_interest: best.open_interest ?? 0,
      volume: best.day?.volume ?? 0,
      implied_volatility: best.greeks?.implied_volatility ?? best.implied_volatility ?? null,
      delta: best.greeks?.delta ?? null,
      days_to_expiry: dte,
    };
  } catch {
    return null;
  }
}

/**
 * Format a resolved contract for display.
 */
export function formatContractSummary(c: ResolvedContract): string {
  const iv = c.implied_volatility != null ? ` IV ${(c.implied_volatility * 100).toFixed(0)}%` : "";
  const delta = c.delta != null ? ` Δ${c.delta.toFixed(2)}` : "";
  return `${c.ticker} | Strike $${c.strike} ${c.contract_type.toUpperCase()} exp ${c.expiration_date} (${c.days_to_expiry}d) | Mid $${c.mid.toFixed(2)}${iv}${delta} | OI ${c.open_interest.toLocaleString()}`;
}
