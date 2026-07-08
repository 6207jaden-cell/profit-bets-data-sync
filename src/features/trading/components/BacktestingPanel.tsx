import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import {
  FlaskConical, Play, TrendingUp, TrendingDown, Activity, AlertCircle, Loader2,
  Sliders, Dice5, GitBranch,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import {
  runBacktest,
  runWalkForwardBacktest,
  runParameterOptimization,
  runMonteCarloSimulation,
} from "@/lib/backtest.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BlurLock } from "@/features/markets/components/BlurLock";
import { cn } from "@/lib/utils";

type BacktestResponse = Awaited<ReturnType<typeof runBacktest>>;
type SuccessResult = Extract<BacktestResponse, { ok: true }>;
type WFResponse = Awaited<ReturnType<typeof runWalkForwardBacktest>>;
type WFSuccess = Extract<WFResponse, { ok: true }>;
type OptResponse = Awaited<ReturnType<typeof runParameterOptimization>>;
type OptSuccess = Extract<OptResponse, { ok: true }>;
type MCResponse = Awaited<ReturnType<typeof runMonteCarloSimulation>>;
type MCSuccess = Extract<MCResponse, { ok: true }>;

type Mode = "single" | "walk_forward";

export function BacktestingPanel() {
  const { hasPro, userId } = useProfile();
  const qc = useQueryClient();
  const runFn = useServerFn(runBacktest);
  const runWF = useServerFn(runWalkForwardBacktest);
  const runOpt = useServerFn(runParameterOptimization);
  const runMC = useServerFn(runMonteCarloSimulation);
  const allowed = hasPro;

  const [selectedId, setSelectedId] = useState<string>("");
  const [symbol, setSymbol] = useState("");
  const [days, setDays] = useState(365);
  const [mode, setMode] = useState<Mode>("single");
  const [trainPct, setTrainPct] = useState(0.7);

  const [running, setRunning] = useState(false);
  const [optRunning, setOptRunning] = useState(false);
  const [mcRunning, setMcRunning] = useState(false);

  const [result, setResult] = useState<SuccessResult | null>(null);
  const [wfResult, setWfResult] = useState<WFSuccess | null>(null);
  const [optResult, setOptResult] = useState<OptSuccess | null>(null);
  const [mcResult, setMcResult] = useState<MCSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  const strategies = useQuery({
    queryKey: ["strategies-list", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("strategies").select("id,name,strategy_json,market_type")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const history = useQuery({
    queryKey: ["backtest-history", userId, selectedId],
    enabled: !!userId && !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("strategy_performance").select("*")
        .eq("strategy_id", selectedId)
        .order("updated_at", { ascending: false }).limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const selectedStrategy = useMemo(
    () => strategies.data?.find((s) => s.id === selectedId),
    [strategies.data, selectedId],
  );

  async function handleRun() {
    if (!selectedId) { setError("Pick a strategy first"); return; }
    setRunning(true); setError(null);
    setResult(null); setWfResult(null); setMcResult(null);
    try {
      if (mode === "single") {
        const res = (await runFn({
          data: { strategy_id: selectedId, symbol: symbol || undefined, days },
        })) as BacktestResponse;
        if (res.ok) {
          setResult(res);
          history.refetch();
          qc.invalidateQueries({ queryKey: ["leaderboard"] });
        } else setError(res.reason);
      } else {
        const res = (await runWF({
          data: { strategy_id: selectedId, symbol: symbol || undefined, days, train_pct: trainPct },
        })) as WFResponse;
        if (res.ok) setWfResult(res);
        else setError(res.reason);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "backtest_failed");
    } finally {
      setRunning(false);
    }
  }

  async function handleOptimize() {
    if (!selectedId) { setError("Pick a strategy first"); return; }
    setOptRunning(true); setError(null); setOptResult(null);
    try {
      const res = (await runOpt({
        data: { strategy_id: selectedId, symbol: symbol || undefined, days },
      })) as OptResponse;
      if (res.ok) setOptResult(res);
      else setError(res.reason);
    } catch (e) {
      setError(e instanceof Error ? e.message : "optimize_failed");
    } finally {
      setOptRunning(false);
    }
  }

  async function handleMonteCarlo() {
    const trades = result?.trades ?? wfResult?.holdout.trades;
    if (!trades || trades.length < 2) {
      setError("Run a backtest first — Monte Carlo needs a trade log");
      return;
    }
    const trade_log = trades
      .filter((t) => t.pnl != null && t.price)
      .map((t) => ({ pnl_pct: ((t.pnl ?? 0) / (t.price)) * 100 }));
    if (trade_log.length < 2) { setError("Not enough closed trades to resample"); return; }
    setMcRunning(true); setError(null); setMcResult(null);
    try {
      const res = (await runMC({ data: { trade_log, simulations: 500 } })) as MCResponse;
      if (res.ok) setMcResult(res);
      else setError(res.reason);
    } catch (e) {
      setError(e instanceof Error ? e.message : "monte_carlo_failed");
    } finally {
      setMcRunning(false);
    }
  }

  const canMonteCarlo = !!(result?.trades?.length || wfResult?.holdout.trades?.length);

  const content = (
    <div className="space-y-6">
      <Card className="p-4 sm:p-5 border-border bg-card">
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <h3 className="font-display font-semibold flex items-center gap-2">
            <FlaskConical className="h-4 w-4 shrink-0 text-primary" /> Historical Backtest
          </h3>
          <Badge variant="outline" className="font-mono text-[10px] self-start sm:self-auto">
            POLYGON → ALPHA VANTAGE FALLBACK
          </Badge>
        </header>

        {/* Mode toggle */}
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-border p-0.5 bg-background w-fit mb-3 text-xs font-mono">
          <button
            onClick={() => setMode("single")}
            className={cn("px-2.5 py-1 rounded-sm", mode === "single" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            Single Run
          </button>
          <button
            onClick={() => setMode("walk_forward")}
            className={cn("px-2.5 py-1 rounded-sm inline-flex items-center gap-1", mode === "walk_forward" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <GitBranch className="h-3 w-3" /> Walk-Forward
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Strategy</label>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={strategies.data?.length ? "Choose a strategy…" : "No strategies yet"} />
              </SelectTrigger>
              <SelectContent>
                {strategies.data?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Symbol (optional)</label>
            <Input
              value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder={selectedStrategy ? ((selectedStrategy.strategy_json as { universe?: string[] })?.universe?.[0] ?? "AAPL") : "AAPL"}
              className="mt-1 font-mono uppercase"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Lookback (days)</label>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="90">90 days</SelectItem>
                <SelectItem value="180">180 days</SelectItem>
                <SelectItem value="365">1 year</SelectItem>
                <SelectItem value="730">2 years</SelectItem>
                <SelectItem value="1825">5 years</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "walk_forward" && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Train Split</label>
              <Select value={String(trainPct)} onValueChange={(v) => setTrainPct(Number(v))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.5">50% train / 50% holdout</SelectItem>
                  <SelectItem value="0.6">60% / 40%</SelectItem>
                  <SelectItem value="0.7">70% / 30%</SelectItem>
                  <SelectItem value="0.8">80% / 20%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Button onClick={handleRun} disabled={running || !selectedId} className="font-mono">
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            {running ? "RUNNING…" : mode === "walk_forward" ? "RUN WALK-FORWARD" : "RUN BACKTEST"}
          </Button>
          <Button
            variant="outline" onClick={handleOptimize}
            disabled={optRunning || !selectedId} className="font-mono"
            title="Grid-search RSI + SMA parameters"
          >
            {optRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sliders className="h-4 w-4 mr-2" />}
            {optRunning ? "OPTIMIZING…" : "OPTIMIZE"}
          </Button>
          <Button
            variant="outline" onClick={handleMonteCarlo}
            disabled={mcRunning || !canMonteCarlo} className="font-mono"
            title={canMonteCarlo ? "Resample the last backtest's trades 500 times" : "Run a backtest first"}
          >
            {mcRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Dice5 className="h-4 w-4 mr-2" />}
            {mcRunning ? "SIMULATING…" : "MONTE CARLO"}
          </Button>
          {error && (
            <span className="text-xs text-bear flex items-start gap-1 min-w-0 break-words">
              <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" /> <span className="min-w-0 break-words">{error.replace(/_/g, " ")}</span>
            </span>
          )}
        </div>
      </Card>

      {result && <BacktestResultView result={result} title="Backtest" />}
      {wfResult && <WalkForwardResultView wf={wfResult} />}
      {optResult && <OptimizationResultView opt={optResult} />}
      {mcResult && <MonteCarloResultView mc={mcResult} />}

      {history.data && history.data.length > 0 && (
        <Card className="p-4 sm:p-5 border-border bg-card">
          <h3 className="font-display font-semibold mb-3">Recent Runs</h3>
          <ul className="divide-y divide-border text-sm">
            {history.data.map((h) => (
              <li key={h.id} className="py-2 grid grid-cols-2 sm:grid-cols-5 gap-x-3 gap-y-1 font-mono text-xs">
                <span className="text-muted-foreground col-span-2 sm:col-span-1 truncate">{new Date(h.updated_at).toLocaleString()}</span>
                <span>ROI {Number(h.roi ?? 0).toFixed(2)}%</span>
                <span>Win {Number(h.win_rate ?? 0).toFixed(1)}%</span>
                <span>DD {Number(h.drawdown ?? 0).toFixed(2)}%</span>
                <span>Sharpe {Number(h.sharpe ?? 0).toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );

  return <BlurLock active={!allowed} label="Backtesting requires Starter">{content}</BlurLock>;
}

function BacktestResultView({ result, title }: { result: SuccessResult; title: string }) {
  const positive = result.roi >= 0;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Metric label="ROI" value={`${result.roi >= 0 ? "+" : ""}${result.roi.toFixed(2)}%`} tone={positive ? "good" : "bad"} icon={positive ? TrendingUp : TrendingDown} />
        <Metric label="Win Rate" value={`${result.win_rate.toFixed(1)}%`} />
        <Metric label="Max Drawdown" value={`${result.drawdown.toFixed(2)}%`} tone="bad" />
        <Metric label="Sharpe" value={result.sharpe.toFixed(2)} tone={result.sharpe >= 1 ? "good" : undefined} />
        <Metric label="Trades" value={result.trade_count} icon={Activity} />
      </div>

      <Card className="p-5 border-border bg-card">
        <header className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold">{title} — Equity Curve — {result.symbol}</h3>
          <span className="text-[10px] font-mono text-muted-foreground uppercase">
            {result.from} → {result.to} • {result.bars} bars • {result.source}
          </span>
        </header>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={result.equity_curve}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" fontSize={10} minTickGap={40} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                formatter={(v: number) => `$${v.toFixed(2)}`}
              />
              <Line type="monotone" dataKey="equity" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {result.trades.length > 0 && (
        <Card className="p-5 border-border bg-card">
          <h3 className="font-display font-semibold mb-3">Trade Log (last 50)</h3>
          <ul className="divide-y divide-border max-h-72 overflow-auto">
            {result.trades.map((t, i) => (
              <li key={i} className="py-2 flex items-center justify-between text-sm font-mono">
                <div className="flex items-center gap-3">
                  <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded",
                    t.side === "buy" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear")}>{t.side}</span>
                  <span className="text-xs text-muted-foreground">{t.t}</span>
                  <span>${t.price.toFixed(2)}</span>
                </div>
                {t.pnl != null && (
                  <span className={cn("text-xs", t.pnl >= 0 ? "text-bull" : "text-bear")}>
                    {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </motion.div>
  );
}

function WalkForwardResultView({ wf }: { wf: WFSuccess }) {
  const overfit = wf.overfit_score;
  const overfitTone = Math.abs(overfit) < 10 ? "good" : Math.abs(overfit) < 25 ? undefined : "bad";
  return (
    <div className="space-y-4">
      <Card className="p-5 border-border bg-card">
        <header className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" /> Walk-Forward Analysis
          </h3>
          <div className="text-[10px] font-mono uppercase text-muted-foreground">
            Overfit Δ ROI:{" "}
            <span className={cn(
              "font-semibold",
              overfitTone === "good" && "text-bull",
              overfitTone === "bad" && "text-bear",
            )}>{overfit >= 0 ? "+" : ""}{overfit.toFixed(2)}%</span>
          </div>
        </header>
        <p className="text-xs text-muted-foreground mb-3">
          If holdout numbers are close to train, the edge is likely real. Big drop-offs = curve-fitted.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MiniStats label="Train (in-sample)" r={wf.train} accent="text-primary" />
          <MiniStats label="Holdout (out-of-sample)" r={wf.holdout} accent="text-amber-500" />
        </div>
      </Card>
      <BacktestResultView result={wf.holdout} title="Holdout" />
    </div>
  );
}

function MiniStats({ label, r, accent }: { label: string; r: WFSuccess["train"]; accent: string }) {
  return (
    <div className="border border-border rounded-md p-3 bg-background/50">
      <div className={cn("text-[10px] uppercase tracking-wider font-mono mb-2", accent)}>{label}</div>
      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        <span>ROI <b className={cn(r.roi >= 0 ? "text-bull" : "text-bear")}>{r.roi >= 0 ? "+" : ""}{r.roi.toFixed(2)}%</b></span>
        <span>Sharpe <b>{r.sharpe.toFixed(2)}</b></span>
        <span>Win {r.win_rate.toFixed(1)}%</span>
        <span>DD {r.drawdown.toFixed(2)}%</span>
        <span>Trades {r.trade_count}</span>
        <span className="text-muted-foreground">{r.from} → {r.to}</span>
      </div>
    </div>
  );
}

function OptimizationResultView({ opt }: { opt: OptSuccess }) {
  return (
    <Card className="p-5 border-border bg-card">
      <header className="flex items-center justify-between mb-3">
        <h3 className="font-display font-semibold flex items-center gap-2">
          <Sliders className="h-4 w-4 text-primary" /> Parameter Optimization
        </h3>
        <span className="text-[10px] font-mono text-muted-foreground uppercase">
          {opt.evaluated} combos · top 5 by Sharpe
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead className="text-[10px] uppercase text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left py-2">#</th>
              <th className="text-right py-2">RSI</th>
              <th className="text-right py-2">SMA Short</th>
              <th className="text-right py-2">SMA Long</th>
              <th className="text-right py-2">ROI</th>
              <th className="text-right py-2">Win %</th>
              <th className="text-right py-2">Sharpe</th>
            </tr>
          </thead>
          <tbody>
            {opt.top.map((r, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="py-2">{i + 1}</td>
                <td className="text-right">{r.params.rsi_period}</td>
                <td className="text-right">{r.params.sma_short}</td>
                <td className="text-right">{r.params.sma_long}</td>
                <td className={cn("text-right", r.roi >= 0 ? "text-bull" : "text-bear")}>
                  {r.roi >= 0 ? "+" : ""}{r.roi.toFixed(2)}%
                </td>
                <td className="text-right">{r.win_rate.toFixed(1)}%</td>
                <td className="text-right font-semibold">{r.sharpe.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MonteCarloResultView({ mc }: { mc: MCSuccess }) {
  // Build a superimposed sampled-curves dataset for a fan chart.
  const maxLen = Math.max(...mc.curves.map((c) => c.length));
  const chartData = Array.from({ length: maxLen }, (_, i) => {
    const point: Record<string, number> = { step: i };
    mc.curves.forEach((c, ci) => {
      if (c[i] != null) point[`s${ci}`] = c[i];
    });
    return point;
  });
  const roiOf = (v: number) => ((v - mc.start_equity) / mc.start_equity) * 100;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Metric label="P5 Final (worst)" value={`$${mc.p5_final.toFixed(0)}`} tone="bad" />
        <Metric label="P25 Final" value={`$${mc.p25_final.toFixed(0)}`} />
        <Metric label="Median" value={`$${mc.p50_final.toFixed(0)}`} tone={mc.p50_final >= mc.start_equity ? "good" : "bad"} />
        <Metric label="P95 Final (best)" value={`$${mc.p95_final.toFixed(0)}`} tone="good" />
        <Metric label="Worst-5% Drawdown" value={`${mc.worst_drawdown_p5.toFixed(2)}%`} tone="bad" />
      </div>
      <Card className="p-5 border-border bg-card">
        <header className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold flex items-center gap-2">
            <Dice5 className="h-4 w-4 text-primary" /> Monte Carlo Fan — {mc.simulations} resamples
          </h3>
          <span className="text-[10px] font-mono uppercase text-muted-foreground">
            median ROI {roiOf(mc.p50_final) >= 0 ? "+" : ""}{roiOf(mc.p50_final).toFixed(2)}%
          </span>
        </header>
        <p className="text-xs text-muted-foreground mb-3">
          Each line shuffles your trade order. Tight fans = robust; wide fans = luck-dependent.
        </p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="step" stroke="hsl(var(--muted-foreground))" fontSize={10} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                formatter={(v: number) => `$${Number(v).toFixed(2)}`}
              />
              {mc.curves.map((_, i) => (
                <Line
                  key={i}
                  type="monotone"
                  dataKey={`s${i}`}
                  stroke="hsl(var(--primary))"
                  strokeOpacity={0.18}
                  dot={false}
                  strokeWidth={1}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function Metric({ label, value, tone, icon: Icon }: {
  label: string; value: string | number; tone?: "good" | "bad"; icon?: typeof Activity;
}) {
  return (
    <Card className="p-3 border-border bg-card">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </div>
      <div className={cn("font-mono text-xl font-semibold",
        tone === "good" && "text-bull", tone === "bad" && "text-bear")}>{value}</div>
    </Card>
  );
}
