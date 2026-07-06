import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  sma,
  ema,
  rsi,
  evalGroup,
  type IndicatorContext,
} from "@/lib/indicators";

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

type BacktestResult =
  | {
      ok: true;
      symbol: string;
      bars: number;
      from: string;
      to: string;
      win_rate: number;
      roi: number;
      drawdown: number;
      sharpe: number;
      trade_count: number;
      equity_curve: Array<{ t: string; equity: number }>;
      trades: Array<{ side: "buy" | "sell"; t: string; price: number; pnl?: number }>;
      source: "polygon" | "alpha_vantage";
    }
  | { ok: false; reason: string };

async function fetchPolygon(symbol: string, days: number): Promise<Bar[] | null> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return null;
  const to = new Date();
  const from = new Date(Date.now() - days * 86400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${fmt(from)}/${fmt(to)}?adjusted=true&sort=asc&limit=5000&apiKey=${key}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = (await r.json()) as { results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> };
    if (!j.results || j.results.length === 0) return null;
    return j.results.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  } catch {
    return null;
  }
}

async function fetchAlphaVantage(symbol: string): Promise<Bar[] | null> {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return null;
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=full&apikey=${key}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = (await r.json()) as { "Time Series (Daily)"?: Record<string, Record<string, string>> };
    const series = j["Time Series (Daily)"];
    if (!series) return null;
    const bars = Object.entries(series)
      .map(([date, v]) => ({
        t: new Date(date).getTime(),
        o: Number(v["1. open"]),
        h: Number(v["2. high"]),
        l: Number(v["3. low"]),
        c: Number(v["4. close"]),
        v: Number(v["5. volume"] ?? 0),
      }))
      .sort((a, b) => a.t - b.t);
    return bars.length ? bars : null;
  } catch {
    return null;
  }
}

export const runBacktest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { strategy_id: string; symbol?: string; days?: number }) => {
    if (!input?.strategy_id) throw new Error("strategy_id_required");
    return {
      strategy_id: String(input.strategy_id),
      symbol: input.symbol ? String(input.symbol).toUpperCase() : undefined,
      days: Math.min(Math.max(Number(input.days ?? 365), 30), 1825),
    };
  })
  .handler(async ({ data, context }): Promise<BacktestResult> => {
    const { supabase, userId } = context;

    const { data: strat, error } = await supabase
      .from("strategies").select("*").eq("id", data.strategy_id).maybeSingle();
    if (error || !strat) return { ok: false, reason: "strategy_not_found" };

    const sj = strat.strategy_json as {
      entry: { conditions: string[]; logic: "AND" | "OR" };
      exit: { conditions: string[]; logic: "AND" | "OR" };
      universe?: string[];
    };
    const symbol = data.symbol ?? sj.universe?.[0] ?? "AAPL";

    // Fetch bars with fallback chain
    let bars = await fetchPolygon(symbol, data.days);
    let source: "polygon" | "alpha_vantage" = "polygon";
    if (!bars || bars.length < 50) {
      bars = await fetchAlphaVantage(symbol);
      source = "alpha_vantage";
      if (bars && bars.length > data.days) bars = bars.slice(-data.days);
    }
    if (!bars || bars.length < 50) return { ok: false, reason: "insufficient_data" };

    const closes = bars.map((b) => b.c);
    const rsiArr = rsi(closes, 14);
    const sma20Arr = sma(closes, 20);
    const sma50Arr = sma(closes, 50);
    const sma200Arr = sma(closes, 200);
    const ema12Arr = ema(closes, 12);
    const ema26Arr = ema(closes, 26);

    // Simulation: long-only, single position, 100% allocation
    let cash = 10000;
    let position = 0; // shares
    let entry_price: number | null = null;
    const equity_curve: Array<{ t: string; equity: number }> = [];
    const trades: Array<{ side: "buy" | "sell"; t: string; price: number; pnl?: number }> = [];
    const returns: number[] = [];

    let peak = cash;
    let maxDrawdown = 0;
    let wins = 0;
    let totalClosed = 0;

    for (let i = 1; i < bars.length; i++) {
      const b = bars[i];
      const ctx: IndicatorContext = {
        price: b.c,
        prev_price: bars[i - 1].c,
        rsi: rsiArr[i],
        sma20: sma20Arr[i],
        sma50: sma50Arr[i],
        sma200: sma200Arr[i],
        ema12: ema12Arr[i],
        ema26: ema26Arr[i],
        entry_price,
      };

      const equity = cash + position * b.c;
      const tIso = new Date(b.t).toISOString().slice(0, 10);

      if (position === 0) {
        if (evalGroup(sj.entry.conditions, sj.entry.logic, ctx)) {
          position = cash / b.c;
          entry_price = b.c;
          cash = 0;
          trades.push({ side: "buy", t: tIso, price: b.c });
        }
      } else {
        if (evalGroup(sj.exit.conditions, sj.exit.logic, ctx)) {
          const proceeds = position * b.c;
          const pnl = proceeds - (entry_price! * position);
          cash = proceeds;
          trades.push({ side: "sell", t: tIso, price: b.c, pnl });
          if (pnl > 0) wins++;
          totalClosed++;
          position = 0;
          entry_price = null;
        }
      }

      const newEquity = cash + position * b.c;
      const prevEquity = equity_curve.length ? equity_curve[equity_curve.length - 1].equity : 10000;
      returns.push((newEquity - prevEquity) / prevEquity);
      peak = Math.max(peak, newEquity);
      const dd = (peak - newEquity) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
      equity_curve.push({ t: tIso, equity: newEquity });
    }

    // Close any open position at last bar
    if (position > 0) {
      const last = bars[bars.length - 1].c;
      const pnl = position * last - entry_price! * position;
      trades.push({ side: "sell", t: new Date(bars[bars.length - 1].t).toISOString().slice(0, 10), price: last, pnl });
      if (pnl > 0) wins++;
      totalClosed++;
      cash = position * last;
      position = 0;
    }

    const finalEquity = cash;
    const roi = (finalEquity - 10000) / 10000;
    const winRate = totalClosed > 0 ? wins / totalClosed : 0;

    // Sharpe (daily, annualized)
    const mean = returns.reduce((a, b) => a + b, 0) / Math.max(returns.length, 1);
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(returns.length, 1);
    const std = Math.sqrt(variance);
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

    const from = new Date(bars[0].t).toISOString().slice(0, 10);
    const to = new Date(bars[bars.length - 1].t).toISOString().slice(0, 10);

    // Persist
    await supabase.from("strategy_performance").insert({
      user_id: userId,
      strategy_id: data.strategy_id,
      win_rate: Number((winRate * 100).toFixed(2)),
      roi: Number((roi * 100).toFixed(2)),
      drawdown: Number((maxDrawdown * 100).toFixed(2)),
      sharpe: Number(sharpe.toFixed(3)),
      trade_count: totalClosed,
      equity_curve: equity_curve.filter((_, i) => i % Math.max(1, Math.floor(equity_curve.length / 200)) === 0),
      backtest_from: from,
      backtest_to: to,
    });

    return {
      ok: true,
      symbol,
      bars: bars.length,
      from,
      to,
      win_rate: Number((winRate * 100).toFixed(2)),
      roi: Number((roi * 100).toFixed(2)),
      drawdown: Number((maxDrawdown * 100).toFixed(2)),
      sharpe: Number(sharpe.toFixed(3)),
      trade_count: totalClosed,
      equity_curve,
      trades: trades.slice(-50),
      source,
    };
  });
