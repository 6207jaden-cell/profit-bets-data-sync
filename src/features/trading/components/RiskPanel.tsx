import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Shield, Save, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { upsertRiskLimits } from "@/lib/execution.functions";

const DEFAULTS = { max_daily_loss_pct: 5, max_position_pct: 10, max_sector_pct: 40, cooldown_seconds: 30 };

export function RiskPanel() {
  const { userId } = useProfile();
  const qc = useQueryClient();
  const save = useServerFn(upsertRiskLimits);
  const [vals, setVals] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);

  const limits = useQuery({
    queryKey: ["risk-limits", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("risk_limits").select("*").eq("user_id", userId).maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (limits.data) {
      setVals({
        max_daily_loss_pct: Number(limits.data.max_daily_loss_pct),
        max_position_pct: Number(limits.data.max_position_pct),
        max_sector_pct: Number(limits.data.max_sector_pct),
        cooldown_seconds: Number(limits.data.cooldown_seconds),
      });
    }
  }, [limits.data]);

  // Today's P&L vs cap
  const todayPnl = useQuery({
    queryKey: ["today-pnl", userId],
    enabled: !!userId,
    queryFn: async () => {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const { data: portfolio } = await supabase.from("paper_portfolios").select("starting_balance").eq("user_id", userId).maybeSingle();
      const { data: trades } = await supabase
        .from("paper_trades").select("pnl")
        .eq("is_open", false).gte("closed_at", dayStart.toISOString());
      const pnl = (trades ?? []).reduce((a, t) => a + Number(t.pnl ?? 0), 0);
      return { pnl, start: Number(portfolio?.starting_balance ?? 10000) };
    },
    refetchInterval: 60_000,
  });

  async function onSave() {
    setSaving(true);
    try {
      await save({ data: vals });
      toast.success("Risk limits saved");
      qc.invalidateQueries({ queryKey: ["risk-limits", userId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const lossPct = todayPnl.data ? Math.max(0, (-todayPnl.data.pnl / todayPnl.data.start) * 100) : 0;
  const lossUsed = Math.min(100, (lossPct / vals.max_daily_loss_pct) * 100);
  const breached = lossPct >= vals.max_daily_loss_pct;

  return (
    <div className="space-y-6">
      <Card className="p-5 border-border bg-card">
        <header className="flex items-center justify-between mb-4">
          <h2 className="font-display font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" /> Daily Loss Budget
          </h2>
          {breached && (
            <span className="flex items-center gap-1 text-xs text-bear font-mono">
              <AlertTriangle className="h-3.5 w-3.5" /> CAP REACHED
            </span>
          )}
        </header>
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Today: <span className="font-mono text-foreground">{todayPnl.data ? `${todayPnl.data.pnl >= 0 ? "+" : ""}$${todayPnl.data.pnl.toFixed(2)}` : "—"}</span></span>
            <span>Cap: <span className="font-mono">{vals.max_daily_loss_pct}%</span> of ${todayPnl.data?.start.toFixed(0) ?? "—"}</span>
          </div>
          <Progress value={lossUsed} className={breached ? "[&>div]:bg-bear" : ""} />
          <p className="text-[11px] text-muted-foreground">When the cap is reached, the execution engine blocks new trades until tomorrow.</p>
        </div>
      </Card>

      <Card className="p-5 border-border bg-card">
        <header className="mb-4">
          <h2 className="font-display font-semibold">Risk Limits</h2>
          <p className="text-xs text-muted-foreground mt-1">Enforced on every paper and live execution.</p>
        </header>

        <div className="space-y-6">
          <SliderRow
            label="Max daily loss"
            value={vals.max_daily_loss_pct} suffix="%"
            min={0.5} max={25} step={0.5}
            onChange={(v) => setVals({ ...vals, max_daily_loss_pct: v })}
          />
          <SliderRow
            label="Max position size"
            value={vals.max_position_pct} suffix="%"
            min={1} max={100} step={1}
            onChange={(v) => setVals({ ...vals, max_position_pct: v })}
          />
          <SliderRow
            label="Max sector exposure"
            value={vals.max_sector_pct} suffix="%"
            min={10} max={100} step={5}
            onChange={(v) => setVals({ ...vals, max_sector_pct: v })}
          />
          <SliderRow
            label="Trade cooldown"
            value={vals.cooldown_seconds} suffix="s"
            min={0} max={600} step={5}
            onChange={(v) => setVals({ ...vals, cooldown_seconds: v })}
          />
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1.5" />Save limits</>}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function SliderRow({ label, value, suffix, min, max, step, onChange }: {
  label: string; value: number; suffix: string; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <span className="font-mono text-sm text-primary">{value}{suffix}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}
