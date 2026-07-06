import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { FlaskConical, Play, TrendingUp, TrendingDown, Activity, AlertCircle, Loader2 } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { runBacktest } from "@/lib/backtest.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BlurLock } from "@/features/markets/components/BlurLock";
import { cn } from "@/lib/utils";

type BacktestResponse = Awaited<ReturnType<typeof runBacktest>>;
type SuccessResult = Extract<BacktestResponse, { ok: true }>;

export function BacktestingPanel() {
  const { hasPro, userId } = useProfile();
  const qc = useQueryClient();
  const runFn = useServerFn(runBacktest);
  const allowed = hasPro;

  const [selectedId, setSelectedId] = useState<string>("");
  const [symbol, setSymbol] = useState("");
  const [days, setDays] = useState(365);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SuccessResult | null>(null);
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
    setRunning(true); setError(null); setResult(null);
    try {
      const res = (await runFn({
        data: { strategy_id: selectedId, symbol: symbol || undefined, days },
      })) as BacktestResponse;
      if (res.ok) {
        setResult(res);
        history.refetch();
        qc.invalidateQueries({ queryKey: ["leaderboard"] });
      } else {
        setError(res.reason);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "backtest_failed");
    } finally {
      setRunning(false);
    }
  }

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
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mt-4">
          <Button onClick={handleRun} disabled={running || !selectedId} className="font-mono w-full sm:w-auto">
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            {running ? "RUNNING…" : "RUN BACKTEST"}
          </Button>
          {error && (
            <span className="text-xs text-bear flex items-start gap-1 min-w-0 break-words">
              <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" /> <span className="min-w-0 break-words">{error.replace(/_/g, " ")}</span>
            </span>
          )}
        </div>
      </Card>

      {result && <BacktestResultView result={result} />}

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

function BacktestResultView({ result }: { result: SuccessResult }) {
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
          <h3 className="font-display font-semibold">Equity Curve — {result.symbol}</h3>
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
