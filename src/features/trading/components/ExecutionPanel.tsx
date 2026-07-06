import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Zap, X, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { openPaperTrade, closePaperTrade } from "@/lib/execution.functions";

export function ExecutionPanel() {
  const { userId, tier } = useProfile();
  const qc = useQueryClient();
  const open = useServerFn(openPaperTrade);
  const close = useServerFn(closePaperTrade);

  const [asset, setAsset] = useState("AAPL");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [alloc, setAlloc] = useState(10);
  const [strategyId, setStrategyId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);

  const strategies = useQuery({
    queryKey: ["strategies-list", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("strategies").select("id,name").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const openTrades = useQuery({
    queryKey: ["open-trades", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paper_trades").select("*").eq("is_open", true).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  async function submit() {
    setSubmitting(true);
    try {
      const res = await open({ data: { asset, side, allocation_pct: alloc, strategy_id: strategyId || undefined } });
      if (!res.ok) toast.error(`Blocked: ${res.reason}`);
      else {
        toast.success(`Opened ${side.toUpperCase()} ${asset} @ $${res.price.toFixed(2)}`);
        qc.invalidateQueries({ queryKey: ["open-trades", userId] });
        qc.invalidateQueries({ queryKey: ["paper-trades", userId] });
        qc.invalidateQueries({ queryKey: ["paper-portfolio", userId] });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function closeTrade(id: string) {
    setClosing(id);
    try {
      const res = await close({ data: { trade_id: id } });
      if (!res.ok) toast.error(`Close failed: ${res.reason}`);
      else {
        toast.success(`Closed @ $${res.price.toFixed(2)}`);
        qc.invalidateQueries({ queryKey: ["open-trades", userId] });
        qc.invalidateQueries({ queryKey: ["paper-trades", userId] });
        qc.invalidateQueries({ queryKey: ["paper-portfolio", userId] });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setClosing(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-5 border-border bg-card">
        <header className="flex items-center justify-between mb-4">
          <h2 className="font-display font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" /> Paper Execution
          </h2>
          <Badge variant="outline" className="font-mono text-[10px] border-primary/40 text-primary">PAPER MODE</Badge>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Asset</Label>
            <Input value={asset} onChange={(e) => setAsset(e.target.value.toUpperCase())} className="font-mono uppercase" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Side</Label>
            <Select value={side} onValueChange={(v) => setSide(v as "buy" | "sell")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="buy">BUY (long)</SelectItem>
                <SelectItem value="sell">SELL (short)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Allocation %</Label>
            <Input type="number" min={1} max={100} value={alloc} onChange={(e) => setAlloc(Number(e.target.value))} className="font-mono" />
          </div>
          <div className="space-y-1.5 md:col-span-1">
            <Label className="text-xs">Strategy (optional)</Label>
            <Select value={strategyId || "none"} onValueChange={(v) => setStrategyId(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {strategies.data?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={submit} disabled={submitting || !asset} className="w-full">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{side === "buy" ? <TrendingUp className="h-4 w-4 mr-1" /> : <TrendingDown className="h-4 w-4 mr-1" />}Execute</>}
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Risk engine validates position size, cooldown, and daily loss cap before filling. Live broker execution {tier === "elite" ? "available — connect a broker in settings." : "requires Elite tier."}
        </p>
      </Card>

      <Card className="border-border bg-card">
        <header className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-display font-semibold">Open Positions ({openTrades.data?.length ?? 0})</h2>
        </header>
        {(openTrades.data?.length ?? 0) === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">No open paper positions.</div>
        ) : (
          <ul className="divide-y divide-border">
            {openTrades.data!.map((t, i) => {
              const qty = Number(t.quantity);
              const entry = Number(t.entry_price);
              return (
                <motion.li
                  key={t.id}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="px-5 py-3 flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded font-mono",
                      t.side === "buy" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear",
                    )}>{t.side}</span>
                    <span className="font-display font-semibold">{t.asset}</span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {qty.toFixed(4)} @ ${entry.toFixed(2)} · cost ${(qty * entry).toFixed(2)}
                    </span>
                  </div>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => closeTrade(t.id)}
                    disabled={closing === t.id}
                  >
                    {closing === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><X className="h-3 w-3 mr-1" />Close</>}
                  </Button>
                </motion.li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
