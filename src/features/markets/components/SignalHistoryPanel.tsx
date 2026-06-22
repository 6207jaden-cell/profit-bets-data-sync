import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ZAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { History } from "lucide-react";
import { cn } from "@/lib/utils";

type Row = { id: string; asset: string; direction: string; confidence: number; result: string; resolved_pnl_pct: number | null; created_at: string };

export function SignalHistoryPanel() {
  const { data: rows = [] } = useQuery({
    queryKey: ["signal-history"],
    queryFn: async () => {
      const { data, error } = await supabase.from("market_signals").select("id, asset, direction, confidence, result, resolved_pnl_pct, created_at").neq("result", "open").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  // Calibration: bucket confidence in 10% bins, compute hit rate
  const buckets: { conf: number; hit: number; n: number }[] = Array.from({ length: 10 }, (_, i) => ({ conf: i * 10 + 5, hit: 0, n: 0 }));
  for (const r of rows) {
    const i = Math.min(9, Math.floor(r.confidence / 10));
    buckets[i].n++;
    if (r.result === "hit_target") buckets[i].hit++;
  }
  const calibration = buckets.filter((b) => b.n > 0).map((b) => ({ predicted: b.conf, actual: (b.hit / b.n) * 100, n: b.n }));

  return (
    <Card className="p-5 border-border bg-card">
      <header className="flex items-center gap-2 mb-4">
        <History className="h-4 w-4 text-primary" />
        <h2 className="font-display font-semibold">Signal History &amp; Calibration</h2>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Recent resolved</h3>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No resolved signals yet.</p>
          ) : (
            <ul className="text-sm divide-y divide-border max-h-80 overflow-y-auto">
              {rows.slice(0, 30).map((r) => (
                <li key={r.id} className="py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-display font-semibold">{r.asset}</span>
                    <span className="text-[10px] uppercase text-muted-foreground">{r.direction}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-num text-xs">{r.confidence.toFixed(0)}%</span>
                    <span className={cn("text-xs font-medium", r.result === "hit_target" ? "text-bull" : r.result === "hit_stop" ? "text-bear" : "text-muted-foreground")}>
                      {r.result.replace("_", " ")}
                    </span>
                    {r.resolved_pnl_pct != null && (
                      <span className={cn("font-num text-xs w-14 text-right", r.resolved_pnl_pct >= 0 ? "text-bull" : "text-bear")}>
                        {r.resolved_pnl_pct >= 0 ? "+" : ""}{r.resolved_pnl_pct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Calibration: predicted vs actual hit rate</h3>
          <div className="h-72">
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 30, left: 30 }}>
                <CartesianGrid strokeOpacity={0.1} />
                <XAxis type="number" dataKey="predicted" name="Predicted" domain={[0, 100]} unit="%" stroke="var(--muted-foreground)" fontSize={11}>
                </XAxis>
                <YAxis type="number" dataKey="actual" name="Actual" domain={[0, 100]} unit="%" stroke="var(--muted-foreground)" fontSize={11} />
                <ZAxis type="number" dataKey="n" range={[60, 240]} name="N" />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <Scatter data={calibration} fill="oklch(0.78 0.17 165)" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">Dots on the diagonal = well-calibrated confidence.</p>
        </div>
      </div>
    </Card>
  );
}
