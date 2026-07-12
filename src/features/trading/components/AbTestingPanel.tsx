import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FlaskConical, Trophy, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

type AbTest = {
  id: string;
  name: string;
  strategy_a_id: string;
  strategy_b_id: string;
  split_pct: number;
  ab_budget: number;
  status: string;
  start_date: string;
  end_date: string | null;
  result_winner: string | null;
  result_confidence: number | null;
  result_summary: string | null;
  created_at: string;
};

type Strategy = { id: string; name: string; source: string };
type TradeStats = { win_rate: number; avg_pnl: number; trade_count: number; total_pnl: number };

/** Two-proportion z-test for win rates — returns p-value */
function twoProportionZTest(winsA: number, nA: number, winsB: number, nB: number): number {
  if (nA < 5 || nB < 5) return 1; // not enough data
  const pA = winsA / nA, pB = winsB / nB;
  const pPool = (winsA + winsB) / (nA + nB);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
  if (se === 0) return 1;
  const z = (pA - pB) / se;
  // Approximate p-value from z-score
  const absZ = Math.abs(z);
  const p = 1 - (0.5 * (1 + Math.sign(z) * (1 - Math.exp(-0.717 * absZ - 0.416 * absZ * absZ))));
  return Math.max(0, Math.min(1, 2 * Math.min(p, 1 - p))); // two-tailed
}

function confidencePct(pValue: number): number {
  return Math.max(0, Math.min(99, Math.round((1 - pValue) * 100)));
}

export function AbTestingPanel() {
  const { userId } = useProfile();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [stratA, setStratA] = useState("");
  const [stratB, setStratB] = useState("");
  const [budget, setBudget] = useState("500");
  const [testName, setTestName] = useState("");

  const { data: strategies } = useQuery({
    queryKey: ["strategies-for-ab", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("strategies")
        .select("id, name, source")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(30);
      return (data ?? []) as Strategy[];
    },
  });

  const { data: tests, isLoading } = useQuery({
    queryKey: ["ab-tests", userId],
    enabled: !!userId,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("strategy_ab_tests")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      return (data ?? []) as AbTest[];
    },
  });

  const createTest = useMutation({
    mutationFn: async () => {
      if (!stratA || !stratB || stratA === stratB) throw new Error("Select two different strategies");
      const { error } = await (supabase as any).from("strategy_ab_tests").insert({
        user_id: userId!,
        name: testName || `A/B: ${strategies?.find((s) => s.id === stratA)?.name?.slice(0, 20)} vs ${strategies?.find((s) => s.id === stratB)?.name?.slice(0, 20)}`,
        strategy_a_id: stratA,
        strategy_b_id: stratB,
        ab_budget: Number(budget),
        split_pct: 50,
        status: "running",
        start_date: new Date().toISOString().slice(0, 10),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ab-tests", userId] });
      setCreating(false);
      setStratA(""); setStratB(""); setBudget("500"); setTestName("");
    },
  });

  // Compute live stats for each test
  const TestCard = ({ test }: { test: AbTest }) => {
    const stratAName = strategies?.find((s) => s.id === test.strategy_a_id)?.name ?? "Strategy A";
    const stratBName = strategies?.find((s) => s.id === test.strategy_b_id)?.name ?? "Strategy B";

    const { data: statsA } = useQuery({
      queryKey: ["ab-stats-a", test.id, test.strategy_a_id],
      staleTime: 120_000,
      queryFn: async (): Promise<TradeStats> => {
        const { data } = await supabase.rpc("get_strategy_trade_stats").select("*");
        const row = (data ?? []).find((r: Record<string,unknown>) => r.strategy_id === test.strategy_a_id);
        if (!row) return { win_rate: 0, avg_pnl: 0, trade_count: 0, total_pnl: 0 };
        const tc = Number(row.trade_count ?? 0);
        const wc = Number(row.win_count ?? 0);
        const pnl = Number(row.total_pnl ?? 0);
        return { win_rate: tc > 0 ? wc / tc * 100 : 0, avg_pnl: tc > 0 ? pnl / tc : 0, trade_count: tc, total_pnl: pnl };
      },
    });

    const { data: statsB } = useQuery({
      queryKey: ["ab-stats-b", test.id, test.strategy_b_id],
      staleTime: 120_000,
      queryFn: async (): Promise<TradeStats> => {
        const { data } = await supabase.rpc("get_strategy_trade_stats").select("*");
        const row = (data ?? []).find((r: Record<string,unknown>) => r.strategy_id === test.strategy_b_id);
        if (!row) return { win_rate: 0, avg_pnl: 0, trade_count: 0, total_pnl: 0 };
        const tc = Number(row.trade_count ?? 0);
        const wc = Number(row.win_count ?? 0);
        const pnl = Number(row.total_pnl ?? 0);
        return { win_rate: tc > 0 ? wc / tc * 100 : 0, avg_pnl: tc > 0 ? pnl / tc : 0, trade_count: tc, total_pnl: pnl };
      },
    });

    const sA = statsA ?? { win_rate: 0, avg_pnl: 0, trade_count: 0, total_pnl: 0 };
    const sB = statsB ?? { win_rate: 0, avg_pnl: 0, trade_count: 0, total_pnl: 0 };

    const pValue = twoProportionZTest(
      Math.round(sA.win_rate / 100 * sA.trade_count), sA.trade_count,
      Math.round(sB.win_rate / 100 * sB.trade_count), sB.trade_count,
    );
    const confidence = confidencePct(pValue);
    const winner = sA.trade_count >= 5 && sB.trade_count >= 5
      ? sA.total_pnl > sB.total_pnl ? "A" : sB.total_pnl > sA.total_pnl ? "B" : "TIE"
      : null;

    const daysRunning = Math.round((Date.now() - new Date(test.start_date).getTime()) / 86400_000);

    return (
      <Card className="p-4 border-border/50 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{test.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {winner && confidence >= 80 && (
              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px]">
                <Trophy className="h-2.5 w-2.5 mr-1" />
                Strategy {winner} wins ({confidence}% confidence)
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px]">
              {daysRunning}d running
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[{ label: stratAName, stats: sA, key: "A" }, { label: stratBName, stats: sB, key: "B" }].map(({ label, stats, key }) => (
            <div
              key={key}
              className={cn(
                "rounded-lg p-3 border",
                winner === key && confidence >= 80
                  ? "border-amber-500/40 bg-amber-500/10"
                  : "border-border/40 bg-muted/30"
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium truncate">{label}</span>
                {winner === key && confidence >= 80 && <Trophy className="h-3 w-3 text-amber-400 shrink-0" />}
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Trades</span>
                  <span className="font-mono">{stats.trade_count}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Win Rate</span>
                  <span className={cn("font-mono", stats.win_rate >= 50 ? "text-emerald-400" : "text-red-400")}>
                    {stats.trade_count > 0 ? `${stats.win_rate.toFixed(0)}%` : "—"}
                  </span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Total P&L</span>
                  <span className={cn("font-mono", stats.total_pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {stats.trade_count > 0 ? `${stats.total_pnl >= 0 ? "+" : ""}$${stats.total_pnl.toFixed(2)}` : "—"}
                  </span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Avg/Trade</span>
                  <span className={cn("font-mono", stats.avg_pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {stats.trade_count > 0 ? `${stats.avg_pnl >= 0 ? "+" : ""}$${stats.avg_pnl.toFixed(2)}` : "—"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {sA.trade_count + sB.trade_count < 10 && (
          <p className="text-[10px] text-muted-foreground text-center">
            Need at least 5 trades per strategy for statistical significance. Currently {sA.trade_count}A / {sB.trade_count}B trades.
          </p>
        )}
        {confidence > 0 && confidence < 80 && sA.trade_count + sB.trade_count >= 10 && (
          <p className="text-[10px] text-amber-400 text-center">
            {confidence}% confidence — not yet statistically significant (need ≥80%). Keep running.
          </p>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-primary" />
            A/B Strategy Testing
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Run two strategies in parallel to find which genuinely outperforms
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "+ New Test"}
        </Button>
      </div>

      {creating && (
        <Card className="p-4 border-primary/30 bg-primary/5 space-y-3">
          <div className="text-sm font-medium">Create A/B Test</div>
          <input
            value={testName}
            onChange={(e) => setTestName(e.target.value)}
            placeholder="Test name (optional)"
            className="w-full text-sm bg-background border border-border rounded px-3 py-1.5"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Strategy A</label>
              <Select value={stratA} onValueChange={setStratA}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose A" /></SelectTrigger>
                <SelectContent>
                  {(strategies ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Strategy B</label>
              <Select value={stratB} onValueChange={setStratB}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose B" /></SelectTrigger>
                <SelectContent>
                  {(strategies ?? []).filter((s) => s.id !== stratA).map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">Paper budget ($)</label>
            <input
              type="number"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="w-full text-sm bg-background border border-border rounded px-3 py-1.5"
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Both strategies will trade using their existing paper trading logic. Results are compared using their current closed paper trade history.
          </p>
          <Button
            size="sm"
            className="w-full"
            disabled={!stratA || !stratB || stratA === stratB || createTest.isPending}
            onClick={() => createTest.mutate()}
          >
            {createTest.isPending ? "Creating…" : "Start A/B Test"}
          </Button>
          {createTest.error && (
            <p className="text-[11px] text-red-400">{String(createTest.error)}</p>
          )}
        </Card>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Loading tests…</div>
      ) : !tests || tests.length === 0 ? (
        <Card className="p-6 text-center border-border/50">
          <FlaskConical className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No A/B tests running yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create a test to compare two strategies and find which genuinely wins — not just by luck.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {tests.map((test) => <TestCard key={test.id} test={test} />)}
        </div>
      )}
    </div>
  );
}
