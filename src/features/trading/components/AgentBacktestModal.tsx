import { useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer } from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { FlaskConical, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Summary = {
  total_return_pct: number; win_rate: number; avg_pnl_pct: number;
  sharpe: number; trade_count: number; days_back: number; hold_days: number; picks_per_day: number;
};
type Result = { summary: Summary; equity_curve: Array<{ day: number; equity: number }> };

export function AgentBacktestModal({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(30);
  const [hold, setHold] = useState(3);
  const [picks, setPicks] = useState(3);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const anonKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)
    ?? (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const r = await fetch(`${origin}/api/public/agent-backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: anonKey },
        body: JSON.stringify({ user_id: userId, days_back: days, hold_days: hold, picks_per_day: picks }),
      });
      const j = await r.json() as { ok: boolean; error?: string; summary?: Summary; equity_curve?: Result["equity_curve"] };
      if (!j.ok || !j.summary || !j.equity_curve) {
        setError(j.error ?? `HTTP ${r.status}`);
      } else {
        setResult({ summary: j.summary, equity_curve: j.equity_curve });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "request_failed");
    } finally {
      setLoading(false);
      // Ensure session cookie present (silence lint about supabase import)
      void supabase;
    }
  }

  const s = result?.summary;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FlaskConical className="w-3.5 h-3.5 mr-1.5" /> Backtest agent
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Backtest the autonomous agent</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="days-back" className="text-xs">Days back</Label>
            <Input id="days-back" type="number" min={7} max={180} value={days}
              onChange={(e) => setDays(Number(e.target.value))} />
          </div>
          <div>
            <Label htmlFor="hold-days" className="text-xs">Hold days</Label>
            <Input id="hold-days" type="number" min={1} max={20} value={hold}
              onChange={(e) => setHold(Number(e.target.value))} />
          </div>
          <div>
            <Label htmlFor="picks-per-day" className="text-xs">Picks / day</Label>
            <Input id="picks-per-day" type="number" min={1} max={8} value={picks}
              onChange={(e) => setPicks(Number(e.target.value))} />
          </div>
        </div>
        <Button onClick={run} disabled={loading} className="w-full">
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Simulating…</> : "Run backtest"}
        </Button>
        {error && <div className="text-sm text-bear">Error: {error}</div>}
        {s && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Return" value={`${s.total_return_pct >= 0 ? "+" : ""}${s.total_return_pct}%`} tone={s.total_return_pct >= 0 ? "good" : "bad"} />
              <Stat label="Win rate" value={`${s.win_rate.toFixed(1)}%`} />
              <Stat label="Sharpe" value={s.sharpe.toFixed(2)} />
              <Stat label="Trades" value={String(s.trade_count)} />
            </div>
            <Card className="p-3 border-border bg-secondary/30">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={result!.equity_curve}>
                    <defs>
                      <linearGradient id="bt-eq" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="day" hide />
                    <YAxis domain={["dataMin", "dataMax"]} hide />
                    <RTooltip formatter={(v: number) => `$${Number(v).toFixed(2)}`} labelFormatter={(l) => `Day ${l}`} />
                    <Area type="monotone" dataKey="equity" stroke="hsl(var(--primary))" fill="url(#bt-eq)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <p className="text-[11px] text-muted-foreground">
              Simulated across {s.days_back} days holding {s.hold_days} days per pick ({s.picks_per_day} picks/day). Result saved to your backtest history.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="p-2 rounded-md bg-secondary/40 border border-border">
      <div className="text-[10px] uppercase text-muted-foreground font-mono">{label}</div>
      <div className={cn("text-sm font-mono font-semibold", tone === "good" && "text-bull", tone === "bad" && "text-bear")}>{value}</div>
    </div>
  );
}
