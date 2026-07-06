import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bell, Plus, Trash2, Zap, X } from "lucide-react";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-profile";
import { PremiumLock } from "@/components/PremiumLock";

type Metric = "price" | "change_pct_24h" | "volume" | "rsi_14";
type Operator = ">" | ">=" | "<" | "<=" | "==";
type Logic = "AND" | "OR";
type Condition = { asset: string; asset_type: "stock" | "crypto"; metric: Metric; operator: Operator; value: number };

type SmartAlertRow = {
  id: string;
  name: string;
  active: boolean;
  conditions: { logic: Logic; rules: Condition[] };
  action: { type: "notify"; channel: "in_app" };
  last_triggered_at: string | null;
  created_at: string;
};

const METRIC_LABEL: Record<Metric, string> = {
  price: "Price ($)",
  change_pct_24h: "24h Change (%)",
  volume: "Volume",
  rsi_14: "RSI(14)",
};

export function SmartAlertsPanel() {
  const { userId, hasPro, tier } = useProfile();
  const qc = useQueryClient();

  const { data: alerts = [] } = useQuery({
    queryKey: ["smart_alerts", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("smart_alerts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SmartAlertRow[];
    },
    enabled: hasPro && !!userId,
  });

  const [name, setName] = useState("");
  const [logic, setLogic] = useState<Logic>("AND");
  const [rules, setRules] = useState<Condition[]>([
    { asset: "", asset_type: "stock", metric: "price", operator: ">", value: 0 },
  ]);

  const create = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Give your alert a name.");
      const cleaned = rules.filter((r) => r.asset.trim());
      if (cleaned.length === 0) throw new Error("Add at least one condition with a symbol.");
      const { error } = await supabase.from("smart_alerts").insert({
        user_id: userId,
        name: name.trim(),
        active: true,
        conditions: { logic, rules: cleaned.map((r) => ({ ...r, asset: r.asset.toUpperCase() })) },
        action: { type: "notify", channel: "in_app" },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setName("");
      setRules([{ asset: "", asset_type: "stock", metric: "price", operator: ">", value: 0 }]);
      setLogic("AND");
      toast.success("Smart alert created");
      qc.invalidateQueries({ queryKey: ["smart_alerts", userId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("smart_alerts").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["smart_alerts", userId] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("smart_alerts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["smart_alerts", userId] }),
  });

  if (!hasPro) {
    return (
      <PremiumLock
        requiredTier="pro"
        title="Smart Alerts"
        description="Build multi-condition alerts with IF/AND/OR logic across price, volume, and technicals."
        perks={[
          "Combine up to 5 conditions with AND/OR",
          "Alert on price, 24h change, volume, RSI, and more",
          "In-app notifications the moment conditions trigger",
        ]}
      />
    );
  }

  function updateRule(i: number, patch: Partial<Condition>) {
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRule() {
    if (rules.length >= 5) return;
    setRules((rs) => [...rs, { asset: "", asset_type: "stock", metric: "price", operator: ">", value: 0 }]);
  }
  function removeRule(i: number) {
    setRules((rs) => rs.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-6">
      <Card className="p-5 border-border bg-card">
        <header className="flex items-center gap-2 mb-4">
          <Zap className="h-4 w-4 text-primary" />
          <h2 className="font-display font-semibold">Create Smart Alert</h2>
          <Badge variant="outline" className="ml-auto text-[10px]">{tier}</Badge>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 mb-4">
          <Input
            placeholder="Alert name (e.g. AAPL breakdown watch)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Select value={logic} onValueChange={(v) => setLogic(v as Logic)}>
            <SelectTrigger className="w-full md:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="AND">Match ALL (AND)</SelectItem>
              <SelectItem value="OR">Match ANY (OR)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          {rules.map((r, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto_minmax(0,1fr)_auto] gap-2 items-center">
              <Input
                placeholder="Symbol (e.g. AAPL / bitcoin)"
                value={r.asset}
                onChange={(e) => updateRule(i, { asset: e.target.value })}
              />
              <Select value={r.asset_type} onValueChange={(v) => updateRule(i, { asset_type: v as "stock" | "crypto" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">Stock</SelectItem>
                  <SelectItem value="crypto">Crypto</SelectItem>
                </SelectContent>
              </Select>
              <Select value={r.metric} onValueChange={(v) => updateRule(i, { metric: v as Metric })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
                    <SelectItem key={m} value={m}>{METRIC_LABEL[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={r.operator} onValueChange={(v) => updateRule(i, { operator: v as Operator })}>
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["<", "<=", "==", ">=", ">"] as Operator[]).map((op) => (
                    <SelectItem key={op} value={op}>{op}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                step="0.01"
                placeholder="Value"
                value={Number.isNaN(r.value) ? "" : r.value}
                onChange={(e) => updateRule(i, { value: Number(e.target.value) })}
              />
              <button
                onClick={() => removeRule(i)}
                disabled={rules.length === 1}
                className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                title="Remove condition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-3">
          <Button variant="outline" size="sm" onClick={addRule} disabled={rules.length >= 5}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add condition
          </Button>
          <Button size="sm" className="ml-auto" onClick={() => create.mutate()} disabled={create.isPending}>
            <Bell className="h-3.5 w-3.5 mr-1" /> Create alert
          </Button>
        </div>
      </Card>

      <Card className="p-5 border-border bg-card">
        <header className="flex items-center gap-2 mb-4">
          <Bell className="h-4 w-4 text-primary" />
          <h2 className="font-display font-semibold">Your Smart Alerts</h2>
          <Badge variant="outline" className="ml-auto text-[10px]">{alerts.length} total</Badge>
        </header>

        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No smart alerts yet. Create one above.</p>
        ) : (
          <ul className="divide-y divide-border">
            {alerts.map((a) => (
              <li key={a.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-display font-semibold">{a.name}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{a.conditions.logic}</Badge>
                    {a.last_triggered_at && (
                      <Badge variant="outline" className="text-[10px] border-bull/40 text-bull">
                        last: {new Date(a.last_triggered_at).toLocaleDateString()}
                      </Badge>
                    )}
                  </div>
                  <ul className="text-xs text-muted-foreground space-y-0.5">
                    {a.conditions.rules.map((r, i) => (
                      <li key={i} className="font-num">
                        {r.asset} · {METRIC_LABEL[r.metric]} {r.operator} {r.value}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Switch
                    checked={a.active}
                    onCheckedChange={(v) => toggle.mutate({ id: a.id, active: v })}
                  />
                  <button
                    onClick={() => remove.mutate(a.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
