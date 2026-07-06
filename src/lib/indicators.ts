// Shared indicator + condition evaluation module.
// Extracted from backtest.functions.ts so both the backtester and the live
// paper-trading loop can share the same logic.

export type IndicatorContext = {
  price: number;
  prev_price: number;
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema12: number | null;
  ema26: number | null;
  entry_price: number | null;
};

// ---------- Indicators ----------

export function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    if (prev == null) {
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += values[j];
      prev = s / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = [null];
  let gains = 0, losses = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = Math.max(diff, 0);
    const loss = Math.max(-diff, 0);
    if (i <= period) {
      gains += gain; losses += loss;
      if (i === period) {
        const rs = losses === 0 ? 100 : gains / losses;
        out.push(100 - 100 / (1 + rs));
      } else out.push(null);
    } else {
      gains = (gains * (period - 1) + gain) / period;
      losses = (losses * (period - 1) + loss) / period;
      const rs = losses === 0 ? 100 : gains / losses;
      out.push(100 - 100 / (1 + rs));
    }
  }
  return out;
}

// ---------- Condition evaluators ----------

export function evalCondition(cond: string, ctx: IndicatorContext): boolean {
  const c = cond.replace(/\s+/g, "").toLowerCase();
  const get = (token: string): number | null => {
    if (token === "price" || token === "close") return ctx.price;
    if (token === "prev_price") return ctx.prev_price;
    if (token === "rsi" || token === "rsi(14)") return ctx.rsi;
    if (token === "sma(20)" || token === "sma20") return ctx.sma20;
    if (token === "sma(50)" || token === "sma50") return ctx.sma50;
    if (token === "sma(200)" || token === "sma200") return ctx.sma200;
    if (token === "ema(12)" || token === "ema12") return ctx.ema12;
    if (token === "ema(26)" || token === "ema26") return ctx.ema26;
    if (token === "entry") return ctx.entry_price;
    if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
    return null;
  };

  const m = c.match(/^(.+?)(<=|>=|<|>|==|!=)(.+)$/);
  if (!m) return false;
  const [, lhsStr, op, rhsStr] = m;

  function evalSide(s: string): number | null {
    if (s.includes("*")) {
      const parts = s.split("*");
      let acc: number | null = null;
      for (const p of parts) {
        const v = get(p);
        if (v == null) return null;
        acc = acc == null ? v : acc * v;
      }
      return acc;
    }
    return get(s);
  }

  const a = evalSide(lhsStr);
  const b = evalSide(rhsStr);
  if (a == null || b == null) return false;
  switch (op) {
    case "<": return a < b;
    case ">": return a > b;
    case "<=": return a <= b;
    case ">=": return a >= b;
    case "==": return Math.abs(a - b) < 1e-9;
    case "!=": return Math.abs(a - b) >= 1e-9;
  }
  return false;
}

export function evalGroup(conds: string[], logic: "AND" | "OR", ctx: IndicatorContext): boolean {
  if (conds.length === 0) return false;
  const results = conds.map((c) => evalCondition(c, ctx));
  return logic === "OR" ? results.some(Boolean) : results.every(Boolean);
}

// ---------- Live data ----------

/**
 * Fetch ~220 recent daily closes for a symbol. Polygon first, Alpha Vantage
 * fallback. Returns oldest → newest.
 */
export async function fetchDailyCloses(symbol: string, days = 220): Promise<number[] | null> {
  const S = symbol.toUpperCase();
  const poly = process.env.POLYGON_API_KEY;
  if (poly) {
    try {
      const to = new Date();
      const from = new Date(Date.now() - days * 86400_000);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(S)}/range/1/day/${fmt(from)}/${fmt(to)}?adjusted=true&sort=asc&limit=5000&apiKey=${poly}`;
      const r = await fetch(url);
      if (r.ok) {
        const j = (await r.json()) as { results?: Array<{ c: number }> };
        const closes = (j.results ?? []).map((b) => b.c).filter((c) => Number.isFinite(c));
        if (closes.length >= 50) return closes;
      }
    } catch { /* fall through */ }
  }
  const alpha = process.env.ALPHA_VANTAGE_API_KEY;
  if (alpha) {
    try {
      const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(S)}&outputsize=full&apikey=${alpha}`;
      const r = await fetch(url);
      if (r.ok) {
        const j = (await r.json()) as { "Time Series (Daily)"?: Record<string, Record<string, string>> };
        const series = j["Time Series (Daily)"];
        if (series) {
          const closes = Object.entries(series)
            .map(([date, v]) => ({ t: new Date(date).getTime(), c: Number(v["4. close"]) }))
            .filter((b) => Number.isFinite(b.c))
            .sort((a, b) => a.t - b.t)
            .map((b) => b.c);
          if (closes.length >= 50) return closes.slice(-days);
        }
      }
    } catch { /* fall through */ }
  }
  return null;
}

/**
 * Build an IndicatorContext for the *last* bar of the closes array.
 * Pass entryPrice when evaluating exit conditions against an open position.
 */
export function buildContext(closes: number[], entryPrice: number | null = null): IndicatorContext | null {
  if (!closes || closes.length < 2) return null;
  const rsiArr = rsi(closes, 14);
  const sma20Arr = sma(closes, 20);
  const sma50Arr = sma(closes, 50);
  const sma200Arr = sma(closes, 200);
  const ema12Arr = ema(closes, 12);
  const ema26Arr = ema(closes, 26);
  const i = closes.length - 1;
  return {
    price: closes[i],
    prev_price: closes[i - 1],
    rsi: rsiArr[i] ?? null,
    sma20: sma20Arr[i] ?? null,
    sma50: sma50Arr[i] ?? null,
    sma200: sma200Arr[i] ?? null,
    ema12: ema12Arr[i] ?? null,
    ema26: ema26Arr[i] ?? null,
    entry_price: entryPrice,
  };
}
