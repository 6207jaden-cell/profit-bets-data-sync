import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  sma,
  ema,
  rsi,
  evalGroup,
  fetchBars,
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

async function loadBarsInternal(symbol: string, days: number): Promise<{ bars: Bar[] | null; source: "polygon" | "alpha_vantage" }> {
  const b = await fetchBars(symbol, days);
  if (!b) return { bars: null, source: "polygon" };
  const bars: Bar[] = b.times.map((t, i) => ({ t, o: b.opens[i], h: b.highs[i], l: b.lows[i], c: b.closes[i], v: b.volumes[i] }));
  // Provider identity is best-effort now that both go through fetchBars; report polygon when key present.
  const source: "polygon" | "alpha_vantage" = process.env.POLYGON_API_KEY ? "polygon" : "alpha_vantage";
  return { bars, source };
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

    const loaded = await loadBarsInternal(symbol, data.days);
    const bars = loaded.bars;
    const source = loaded.source;
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

// -------- Shared simulation helpers (walk-forward, optimization) --------

type SimParams = { rsi_period: number; sma_short: number; sma_long: number };

function simulate(bars: Bar[], sj: { entry: { conditions: string[]; logic: "AND" | "OR" }; exit: { conditions: string[]; logic: "AND" | "OR" } }, params: SimParams = { rsi_period: 14, sma_short: 20, sma_long: 50 }) {
  const closes = bars.map((b) => b.c);
  const rsiArr = rsi(closes, params.rsi_period);
  const smaShortArr = sma(closes, params.sma_short);
  const smaLongArr = sma(closes, params.sma_long);
  const sma200Arr = sma(closes, 200);
  const ema12Arr = ema(closes, 12);
  const ema26Arr = ema(closes, 26);
  let cash = 10000, position = 0;
  let entry_price: number | null = null;
  const equity_curve: Array<{ t: string; equity: number }> = [];
  const trades: Array<{ side: "buy" | "sell"; t: string; price: number; pnl?: number; pnl_pct?: number }> = [];
  const returns: number[] = [];
  let peak = cash, maxDrawdown = 0, wins = 0, totalClosed = 0;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const ctx: IndicatorContext = {
      price: b.c, prev_price: bars[i - 1].c,
      rsi: rsiArr[i],
      sma20: smaShortArr[i], sma50: smaLongArr[i], sma200: sma200Arr[i],
      ema12: ema12Arr[i], ema26: ema26Arr[i],
      entry_price,
    };
    const tIso = new Date(b.t).toISOString().slice(0, 10);
    if (position === 0) {
      if (evalGroup(sj.entry.conditions, sj.entry.logic, ctx)) {
        position = cash / b.c; entry_price = b.c; cash = 0;
        trades.push({ side: "buy", t: tIso, price: b.c });
      }
    } else if (evalGroup(sj.exit.conditions, sj.exit.logic, ctx)) {
      const proceeds = position * b.c;
      const pnl = proceeds - entry_price! * position;
      const pnl_pct = ((b.c - entry_price!) / entry_price!) * 100;
      cash = proceeds;
      trades.push({ side: "sell", t: tIso, price: b.c, pnl, pnl_pct });
      if (pnl > 0) wins++;
      totalClosed++;
      position = 0; entry_price = null;
    }
    const newEquity = cash + position * b.c;
    const prev = equity_curve.length ? equity_curve[equity_curve.length - 1].equity : 10000;
    returns.push((newEquity - prev) / prev);
    peak = Math.max(peak, newEquity);
    const dd = (peak - newEquity) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
    equity_curve.push({ t: tIso, equity: newEquity });
  }
  if (position > 0) {
    const last = bars[bars.length - 1].c;
    const pnl = position * last - entry_price! * position;
    const pnl_pct = ((last - entry_price!) / entry_price!) * 100;
    trades.push({ side: "sell", t: new Date(bars[bars.length - 1].t).toISOString().slice(0, 10), price: last, pnl, pnl_pct });
    if (pnl > 0) wins++;
    totalClosed++;
    cash = position * last;
  }
  const roi = (cash - 10000) / 10000;
  const winRate = totalClosed > 0 ? wins / totalClosed : 0;
  const mean = returns.reduce((a, b) => a + b, 0) / Math.max(returns.length, 1);
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(returns.length, 1);
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  return {
    roi: Number((roi * 100).toFixed(2)),
    win_rate: Number((winRate * 100).toFixed(2)),
    drawdown: Number((maxDrawdown * 100).toFixed(2)),
    sharpe: Number(sharpe.toFixed(3)),
    trade_count: totalClosed,
    equity_curve,
    trades,
  };
}

async function loadBars(symbol: string, days: number): Promise<{ bars: Bar[] | null; source: "polygon" | "alpha_vantage" }> {
  let bars = await fetchPolygon(symbol, days);
  let source: "polygon" | "alpha_vantage" = "polygon";
  if (!bars || bars.length < 50) {
    bars = await fetchAlphaVantage(symbol);
    source = "alpha_vantage";
    if (bars && bars.length > days) bars = bars.slice(-days);
  }
  return { bars, source };
}

export const runWalkForwardBacktest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { strategy_id: string; symbol?: string; days?: number; train_pct?: number }) => {
    if (!input?.strategy_id) throw new Error("strategy_id_required");
    return {
      strategy_id: String(input.strategy_id),
      symbol: input.symbol ? String(input.symbol).toUpperCase() : undefined,
      days: Math.min(Math.max(Number(input.days ?? 365), 60), 1825),
      train_pct: Math.min(Math.max(Number(input.train_pct ?? 0.7), 0.3), 0.9),
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: strat, error } = await supabase.from("strategies").select("*").eq("id", data.strategy_id).maybeSingle();
    if (error || !strat) return { ok: false as const, reason: "strategy_not_found" };
    const sj = strat.strategy_json as { entry: { conditions: string[]; logic: "AND" | "OR" }; exit: { conditions: string[]; logic: "AND" | "OR" }; universe?: string[] };
    const symbol = data.symbol ?? sj.universe?.[0] ?? "AAPL";
    const { bars, source } = await loadBars(symbol, data.days);
    if (!bars || bars.length < 100) return { ok: false as const, reason: "insufficient_data" };
    const split = Math.floor(bars.length * data.train_pct);
    const trainBars = bars.slice(0, split);
    const holdoutBars = bars.slice(split);
    const train = simulate(trainBars, sj);
    const holdout = simulate(holdoutBars, sj);
    const overfit_score = Number((train.roi - holdout.roi).toFixed(2));
    const shape = (r: ReturnType<typeof simulate>, bs: Bar[]) => ({
      ok: true as const,
      symbol,
      bars: bs.length,
      from: new Date(bs[0].t).toISOString().slice(0, 10),
      to: new Date(bs[bs.length - 1].t).toISOString().slice(0, 10),
      win_rate: r.win_rate,
      roi: r.roi,
      drawdown: r.drawdown,
      sharpe: r.sharpe,
      trade_count: r.trade_count,
      equity_curve: r.equity_curve,
      trades: r.trades.slice(-50),
      source,
    });
    return { ok: true as const, train: shape(train, trainBars), holdout: shape(holdout, holdoutBars), overfit_score };
  });

export const runParameterOptimization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    strategy_id: string;
    symbol?: string;
    days?: number;
    param_grid?: { rsi_period?: number[]; sma_short?: number[]; sma_long?: number[] };
  }) => {
    if (!input?.strategy_id) throw new Error("strategy_id_required");
    return {
      strategy_id: String(input.strategy_id),
      symbol: input.symbol ? String(input.symbol).toUpperCase() : undefined,
      days: Math.min(Math.max(Number(input.days ?? 365), 60), 1825),
      param_grid: {
        rsi_period: input.param_grid?.rsi_period ?? [10, 14, 20],
        sma_short: input.param_grid?.sma_short ?? [10, 20, 30],
        sma_long: input.param_grid?.sma_long ?? [40, 50, 100],
      },
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: strat } = await supabase.from("strategies").select("*").eq("id", data.strategy_id).maybeSingle();
    if (!strat) return { ok: false as const, reason: "strategy_not_found" };
    const sj = strat.strategy_json as { entry: { conditions: string[]; logic: "AND" | "OR" }; exit: { conditions: string[]; logic: "AND" | "OR" }; universe?: string[] };
    const symbol = data.symbol ?? sj.universe?.[0] ?? "AAPL";
    const { bars } = await loadBars(symbol, data.days);
    if (!bars || bars.length < 100) return { ok: false as const, reason: "insufficient_data" };
    const results: Array<{ params: SimParams; roi: number; win_rate: number; sharpe: number }> = [];
    for (const rp of data.param_grid.rsi_period) {
      for (const ss of data.param_grid.sma_short) {
        for (const sl of data.param_grid.sma_long) {
          if (ss >= sl) continue;
          const r = simulate(bars, sj, { rsi_period: rp, sma_short: ss, sma_long: sl });
          results.push({ params: { rsi_period: rp, sma_short: ss, sma_long: sl }, roi: r.roi, win_rate: r.win_rate, sharpe: r.sharpe });
        }
      }
    }
    results.sort((a, b) => b.sharpe - a.sharpe);
    return { ok: true as const, top: results.slice(0, 5), evaluated: results.length };
  });

export const runMonteCarloSimulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { trade_log: Array<{ pnl_pct: number }>; simulations?: number }) => {
    if (!Array.isArray(input?.trade_log) || input.trade_log.length < 2) throw new Error("trade_log_required");
    return {
      trade_log: input.trade_log.map((t) => ({ pnl_pct: Number(t.pnl_pct) })),
      simulations: Math.min(Math.max(Number(input.simulations ?? 500), 50), 2000),
    };
  })
  .handler(async ({ data }) => {
    const trades = data.trade_log.filter((t) => Number.isFinite(t.pnl_pct));
    if (trades.length < 2) return { ok: false as const, reason: "insufficient_trades" };
    const start = 10000;
    const finals: number[] = [];
    const drawdowns: number[] = [];
    const sampledCurves: number[][] = [];
    const sampleEvery = Math.max(1, Math.floor(data.simulations / 20));
    for (let s = 0; s < data.simulations; s++) {
      const shuffled = [...trades];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      let equity = start;
      let peak = start;
      let maxDD = 0;
      const curve: number[] = [start];
      for (const t of shuffled) {
        equity = equity * (1 + t.pnl_pct / 100);
        peak = Math.max(peak, equity);
        const dd = (peak - equity) / peak;
        if (dd > maxDD) maxDD = dd;
        curve.push(equity);
      }
      finals.push(equity);
      drawdowns.push(maxDD * 100);
      if (s % sampleEvery === 0 && sampledCurves.length < 20) sampledCurves.push(curve);
    }
    const sortedFinals = [...finals].sort((a, b) => a - b);
    const sortedDD = [...drawdowns].sort((a, b) => a - b);
    const pct = (arr: number[], p: number) => arr[Math.floor(arr.length * p)];
    return {
      ok: true as const,
      p5_final: Number(pct(sortedFinals, 0.05).toFixed(2)),
      p25_final: Number(pct(sortedFinals, 0.25).toFixed(2)),
      p50_final: Number(pct(sortedFinals, 0.5).toFixed(2)),
      p75_final: Number(pct(sortedFinals, 0.75).toFixed(2)),
      p95_final: Number(pct(sortedFinals, 0.95).toFixed(2)),
      worst_drawdown_p5: Number(pct(sortedDD, 0.95).toFixed(2)), // 95th percentile drawdown = worst-5%
      curves: sampledCurves,
      simulations: data.simulations,
      start_equity: start,
    };
  });

