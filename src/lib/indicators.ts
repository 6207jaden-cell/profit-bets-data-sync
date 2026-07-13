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
  macd?: number | null;
  macd_signal?: number | null;
  macd_histogram?: number | null;
  bb_upper?: number | null;
  bb_lower?: number | null;
  bb_pct_b?: number | null;
  stoch_rsi_k?: number | null;
  stoch_rsi_d?: number | null;
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

/** Average True Range. Returns the latest ATR or null if insufficient data. */
export function atr(highs: number[], lows: number[], closes: number[], period = 14): number | null {
  const n = Math.min(highs.length, lows.length, closes.length);
  if (n < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < n; i++) {
    const h = highs[i], l = lows[i], pc = closes[i - 1];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < period) return null;
  let a = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
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
    if (token === "macd" || token === "macd_histogram") return ctx.macd_histogram ?? null;
    if (token === "macd_signal") return ctx.macd_signal ?? null;
    if (token === "bb_upper") return ctx.bb_upper ?? null;
    if (token === "bb_lower") return ctx.bb_lower ?? null;
    if (token === "bb_pct_b") return ctx.bb_pct_b ?? null;
    if (token === "stoch_rsi_k" || token === "stoch_k") return ctx.stoch_rsi_k ?? null;
    if (token === "stoch_rsi_d" || token === "stoch_d") return ctx.stoch_rsi_d ?? null;
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

// ---------- Market regime & hours ----------

/** True if the given symbol is a crypto pair (24/7 markets). */
export function isCryptoSymbol(sym: string): boolean {
  const s = sym.toUpperCase();
  if (/^[A-Z]{2,10}[-/]USD[T]?$/.test(s)) return true;
  return /^(BTC|ETH|SOL|BITCOIN|ETHEREUM|SOLANA)$/.test(s) || /USD$/.test(s) && /^(BTC|ETH|SOL)/.test(s);
}

/** True if US equity market is currently open (Mon-Fri, 9:30-16:00 ET, roughly). */
export function isMarketOpen(now: Date = new Date()): boolean {
  // Compute ET wall-clock via toLocaleString
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay(); // 0 Sun, 6 Sat
  if (day === 0 || day === 6) return false;
  const hour = et.getHours();
  const minute = et.getMinutes();
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

/** Detect broad market regime from SPY closes. */
export function detectMarketRegime(spyCloses: number[]): "bull" | "bear" | "sideways" {
  if (!spyCloses || spyCloses.length < 200) return "sideways";
  const sma50Arr = sma(spyCloses, 50);
  const sma200Arr = sma(spyCloses, 200);
  const i = spyCloses.length - 1;
  const s50 = sma50Arr[i], s200 = sma200Arr[i], last = spyCloses[i];
  if (s50 == null || s200 == null) return "sideways";
  if (s50 > s200 && last > s50) return "bull";
  if (s50 < s200 && last < s50) return "bear";
  return "sideways";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Extract base coin from "BTC-USD" / "BTC/USDT" -> "BTC". */
export function cryptoBase(sym: string): string {
  return sym.toUpperCase().replace(/[-/]USD[T]?$/, "");
}


export type Bars = {
  times: number[];
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  volumes: number[];
};

/**
 * Fetch ~`days` recent daily OHLCV bars. Handles stocks and crypto (e.g. "BTC-USD").
 * Polygon first, Alpha Vantage fallback. Returns oldest → newest.
 * Sleeps between Polygon calls to respect the free-tier limit.
 * All callers (backtester, live evaluator, generator) go through this one function.
 */
export async function fetchBars(symbol: string, days = 220): Promise<Bars | null> {
  const S = symbol.toUpperCase();
  const isCrypto = isCryptoSymbol(S);
  const poly = process.env.POLYGON_API_KEY;
  if (poly) {
    try {
      const to = new Date();
      const from = new Date(Date.now() - days * 86400_000);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const polySym = isCrypto ? `X:${cryptoBase(S)}USD` : S;
      const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(polySym)}/range/1/day/${fmt(from)}/${fmt(to)}?adjusted=true&sort=asc&limit=5000&apiKey=${poly}`;
      const r = await fetch(url);
      if (r.ok) {
        const j = (await r.json()) as { results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> };
        const rows = (j.results ?? []).filter((b) => Number.isFinite(b.c));
        if (rows.length >= 50) {
          // No sleep needed - Polygon Starter plan allows 100 req/min
          // The old 13-second sleep was causing 14-minute scan timeouts
          return {
            times: rows.map((b) => b.t),
            opens: rows.map((b) => b.o),
            highs: rows.map((b) => b.h),
            lows: rows.map((b) => b.l),
            closes: rows.map((b) => b.c),
            volumes: rows.map((b) => b.v),
          };
        }
      }
    } catch { /* fall through */ }
  }
  const alpha = process.env.ALPHA_VANTAGE_API_KEY;
  if (alpha) {
    try {
      const url = isCrypto
        ? `https://www.alphavantage.co/query?function=DIGITAL_CURRENCY_DAILY&symbol=${cryptoBase(S)}&market=USD&apikey=${alpha}`
        : `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(S)}&outputsize=full&apikey=${alpha}`;
      const r = await fetch(url);
      if (r.ok) {
        const j = (await r.json()) as Record<string, unknown>;
        const seriesKey = isCrypto ? "Time Series (Digital Currency Daily)" : "Time Series (Daily)";
        const series = j[seriesKey] as Record<string, Record<string, string>> | undefined;
        if (series) {
          const oKey = isCrypto ? "1a. open (USD)" : "1. open";
          const hKey = isCrypto ? "2a. high (USD)" : "2. high";
          const lKey = isCrypto ? "3a. low (USD)" : "3. low";
          const cKey = isCrypto ? "4a. close (USD)" : "4. close";
          const rows = Object.entries(series)
            .map(([date, v]) => ({
              t: new Date(date).getTime(),
              o: Number(v[oKey] ?? v["1. open"]),
              h: Number(v[hKey] ?? v["2. high"]),
              l: Number(v[lKey] ?? v["3. low"]),
              c: Number(v[cKey] ?? v["4. close"]),
              v: Number(v["5. volume"] ?? 0),
            }))
            .filter((b) => Number.isFinite(b.c))
            .sort((a, b) => a.t - b.t)
            .slice(-days);
          if (rows.length >= 50) {
            return {
              times: rows.map((b) => b.t),
              opens: rows.map((b) => b.o),
              highs: rows.map((b) => b.h),
              lows: rows.map((b) => b.l),
              closes: rows.map((b) => b.c),
              volumes: rows.map((b) => b.v),
            };
          }
        }
      }
    } catch { /* fall through */ }
  }
  return null;
}

/** Back-compat: fetch just the close series through the shared bar fetcher. */
export async function fetchDailyCloses(symbol: string, days = 220): Promise<number[] | null> {
  const b = await fetchBars(symbol, days);
  return b?.closes ?? null;
}


/**
 * Stochastic RSI: applies stochastic formula to RSI values.
 * Returns K line (fast) and D line (3-period SMA of K).
 * K < 20 = oversold, K > 80 = overbought. More sensitive than RSI alone.
 */
export function stochasticRsi(
  closes: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  kSmooth = 3,
  dSmooth = 3,
): { k: number | null; d: number | null } {
  const rsiValues = rsi(closes, rsiPeriod).filter((v): v is number => v != null);
  if (rsiValues.length < stochPeriod) return { k: null, d: null };

  // Stochastic of RSI
  const kRaw: number[] = [];
  for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
    const slice = rsiValues.slice(i - stochPeriod + 1, i + 1);
    const lo = Math.min(...slice), hi = Math.max(...slice);
    kRaw.push(hi - lo < 1e-9 ? 50 : ((rsiValues[i] - lo) / (hi - lo)) * 100);
  }

  // Smooth K
  const kSmoothed = sma(kRaw, kSmooth);
  const kLast = kSmoothed[kSmoothed.length - 1] ?? null;

  // D = SMA of smoothed K
  const validK = kSmoothed.filter((v): v is number => v != null);
  if (validK.length < dSmooth) return { k: kLast, d: null };
  const dArr = sma(validK, dSmooth);
  const dLast = dArr[dArr.length - 1] ?? null;

  return { k: kLast, d: dLast };
}

/**
 * MACD line = EMA12 - EMA26. Signal line = EMA9 of MACD.
 * Returns { macd, signal, histogram } for the last bar.
 */
export function macd(closes: number[]): { macd: number | null; signal: number | null; histogram: number | null } {
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macdLine = closes.map((_, i) =>
    e12[i] != null && e26[i] != null ? e12[i]! - e26[i]! : null
  );
  const validMacd = macdLine.filter((v): v is number => v != null);
  if (validMacd.length < 9) return { macd: null, signal: null, histogram: null };
  const signalLine = ema(validMacd, 9);
  const lastMacd = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];
  return {
    macd: lastMacd,
    signal: lastSignal,
    histogram: lastMacd != null && lastSignal != null ? lastMacd - lastSignal : null,
  };
}

/**
 * Bollinger Bands: upper = SMA20 + 2σ, lower = SMA20 - 2σ.
 * Returns { upper, middle, lower, pct_b } for the last bar.
 * pct_b = (price - lower) / (upper - lower) — 0 = at lower band, 1 = at upper band.
 */
export function bollingerBands(closes: number[], period = 20, stdDevMult = 2): {
  upper: number | null; middle: number | null; lower: number | null; pct_b: number | null;
} {
  if (closes.length < period) return { upper: null, middle: null, lower: null, pct_b: null };
  const smaArr = sma(closes, period);
  const last = closes.length - 1;
  const middle = smaArr[last];
  if (middle == null) return { upper: null, middle: null, lower: null, pct_b: null };
  const slice = closes.slice(last - period + 1, last + 1);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = middle + stdDevMult * stdDev;
  const lower = middle - stdDevMult * stdDev;
  const price = closes[last];
  const pct_b = upper !== lower ? (price - lower) / (upper - lower) : 0.5;
  return { upper, middle, lower, pct_b };
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
  const macdResult = macd(closes);
  const bbResult = bollingerBands(closes, 20, 2);
  const stochResult = stochasticRsi(closes, 14, 14, 3, 3);
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
    macd: macdResult.macd,
    macd_signal: macdResult.signal,
    macd_histogram: macdResult.histogram,
    bb_upper: bbResult.upper,
    bb_lower: bbResult.lower,
    bb_pct_b: bbResult.pct_b,
    stoch_rsi_k: stochResult.k,
    stoch_rsi_d: stochResult.d,
  };
}

/** Fetch a live quote price for a symbol. Finnhub → Polygon → Alpha Vantage. */
export async function fetchQuotePrice(symbol: string): Promise<number | null> {
  const S = symbol.toUpperCase();
  const isCrypto = isCryptoSymbol(S);
  const fin = process.env.FINNHUB_API_KEY;
  const poly = process.env.POLYGON_API_KEY;
  const alpha = process.env.ALPHA_VANTAGE_API_KEY;
  // Yahoo Finance (keyless) — works for both stocks and crypto pairs like ETH-USD.
  // Tried FIRST for crypto because Finnhub free tier does not return BINANCE quotes.
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(S)}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    if (r.ok) {
      const j = (await r.json()) as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> } };
      const p = j.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (p && p > 0) return p;
    }
  } catch { /* fall */ }
  try {
    if (fin && !isCrypto) {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${S}&token=${fin}`);
      if (r.ok) { const j = (await r.json()) as { c?: number }; if (j.c) return j.c; }
    }
    if (fin && isCrypto) {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=BINANCE:${cryptoBase(S)}USDT&token=${fin}`);
      if (r.ok) { const j = (await r.json()) as { c?: number }; if (j.c) return j.c; }
    }
  } catch { /* fall */ }
  try {
    if (poly) {
      const polySym = isCrypto ? `X:${cryptoBase(S)}USD` : S;
      const r = await fetch(`https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(polySym)}/prev?apiKey=${poly}`);
      if (r.ok) {
        const j = (await r.json()) as { results?: Array<{ c: number }> };
        const c = j.results?.[0]?.c;
        if (c) return c;
      }
    }
  } catch { /* fall */ }
  try {
    if (alpha && !isCrypto) {
      const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${S}&apikey=${alpha}`);
      if (r.ok) {
        const j = (await r.json()) as { ["Global Quote"]?: Record<string, string> };
        const p = j["Global Quote"]?.["05. price"];
        if (p) return Number(p);
      }
    }
  } catch { /* fall */ }
  return null;
}

// ---------- Options pricing ----------

/** Standard normal CDF via Abramowitz & Stegun approximation. */
function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * Black-Scholes theoretical value of a European call/put.
 * Returns per-share value (multiply by 100 for a single US options contract).
 */
export function estimateOptionValue(params: {
  underlying_price: number;
  strike: number;
  days_to_expiry: number;
  implied_vol: number;
  risk_free_rate: number;
  option_type: "call" | "put";
}): number {
  const { underlying_price: S, strike: K, days_to_expiry, implied_vol: sigma, risk_free_rate: r, option_type } = params;
  const T = Math.max(days_to_expiry, 0) / 365;
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    return option_type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (option_type === "call") return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}
