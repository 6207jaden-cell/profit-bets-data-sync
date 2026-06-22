import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Bell, Trash2, Plus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-profile";
import { cn } from "@/lib/utils";

type AlertRow = {
  id: string;
  asset: string;
  asset_type: "stock" | "crypto";
  target_price: number;
  direction: "above" | "below";
  triggered: boolean;
  triggered_at: string | null;
  triggered_price: number | null;
  created_at: string;
};

export function PriceAlertsPanel() {
  const { userId, alertLimit, tier } = useProfile();
  const qc = useQueryClient();

  const { data: alerts = [] } = useQuery({
    queryKey: ["price_alerts", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("price_alerts").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AlertRow[];
    },
    enabled: !!userId,
  });

  // Realtime
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`alerts-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "price_alerts", filter: `user_id=eq.${userId}` }, (payload) => {
        qc.invalidateQueries({ queryKey: ["price_alerts", userId] });
        if (payload.eventType === "UPDATE" && (payload.new as AlertRow).triggered) {
          const a = payload.new as AlertRow;
          toast.success(`${a.asset} ${a.direction} $${a.target_price} triggered`);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc]);

  const [asset, setAsset] = useState("");
  const [assetType, setAssetType] = useState<"stock" | "crypto">("stock");
  const [target, setTarget] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");

  const active = alerts.filter((a) => !a.triggered);
  const triggered = alerts.filter((a) => a.triggered);

  const create = useMutation({
    mutationFn: async () => {
      if (active.length >= alertLimit) throw new Error(`Your ${tier} plan allows ${alertLimit} active alerts.`);
      const tp = Number(target);
      if (!asset || !tp) throw new Error("Asset and target price required.");
      const { error } = await supabase.from("price_alerts").insert({
        user_id: userId,
        asset: asset.toUpperCase(),
        asset_type: assetType,
        target_price: tp,
        direction,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Alert created");
      setAsset(""); setTarget("");
      qc.invalidateQueries({ queryKey: ["price_alerts", userId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("price_alerts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["price_alerts", userId] }),
  });

  return (
    <Card className="p-5 border-border bg-card">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <h2 className="font-display font-semibold">Price Alerts</h2>
        </div>
        <span className="text-xs text-muted-foreground">
          {active.length}/{alertLimit === Infinity ? "∞" : alertLimit} active
        </span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-5">
        <Input placeholder="Symbol" value={asset} onChange={(e) => setAsset(e.target.value)} className="md:col-span-1" />
        <Select value={assetType} onValueChange={(v) => setAssetType(v as "stock" | "crypto")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="stock">Stock</SelectItem>
            <SelectItem value="crypto">Crypto</SelectItem>
          </SelectContent>
        </Select>
        <Select value={direction} onValueChange={(v) => setDirection(v as "above" | "below")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="above">Above</SelectItem>
            <SelectItem value="below">Below</SelectItem>
          </SelectContent>
        </Select>
        <Input type="number" step="0.01" placeholder="Target price" value={target} onChange={(e) => setTarget(e.target.value)} />
        <Button onClick={() => create.mutate()} disabled={create.isPending}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Active</h3>
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active alerts.</p>
          ) : (
            <ul className="space-y-2">
              {active.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-background/40 p-2.5">
                  <div className="flex items-center gap-3">
                    <span className="font-display font-semibold">{a.asset}</span>
                    <span className={cn("text-xs", a.direction === "above" ? "text-bull" : "text-bear")}>
                      {a.direction} ${a.target_price}
                    </span>
                    <span className="text-[10px] uppercase text-muted-foreground">{a.asset_type}</span>
                  </div>
                  <button onClick={() => remove.mutate(a.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Triggered</h3>
          {triggered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No triggers yet.</p>
          ) : (
            <ul className="space-y-2">
              {triggered.slice(0, 10).map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-background/40 p-2.5">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <span className="font-display font-semibold">{a.asset}</span>
                    <span className="text-xs text-muted-foreground">
                      {a.direction} ${a.target_price} {a.triggered_price ? `→ $${a.triggered_price}` : ""}
                    </span>
                  </div>
                  <button onClick={() => remove.mutate(a.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Card>
  );
}
