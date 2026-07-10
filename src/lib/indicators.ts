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
          await sleep(13_000);
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
