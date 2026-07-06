import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getStockQuotes, getCryptoQuotes } from "@/lib/market.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Briefcase, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-profile";
import { cn } from "@/lib/utils";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { PortfolioCommentaryCard, type CommentaryPosition } from "./PortfolioCommentaryCard";

type Pos = { id: string; asset: string; asset_type: "stock" | "crypto"; shares: number; cost_basis: number };

const COLORS = ["#34d399", "#22d3ee", "#fbbf24", "#fb7185", "#a78bfa", "#f97316", "#60a5fa", "#f472b6"];

export function PortfolioPanel() {
  const { userId } = useProfile();
  const qc = useQueryClient();
  const stockQuotes = useServerFn(getStockQuotes);
  const cryptoQuotes = useServerFn(getCryptoQuotes);

  const { data: positions = [] } = useQuery({
    queryKey: ["positions", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("manual_positions").select("*").order("created_at");
      if (error) throw error;
      return (data ?? []) as Pos[];
    },
    enabled: !!userId,
  });

  const stocks = positions.filter((p) => p.asset_type === "stock").map((p) => p.asset);
  const cryptos = positions.filter((p) => p.asset_type === "crypto").map((p) => p.asset);

  const { data: sq } = useQuery({ queryKey: ["pos-sq", stocks], queryFn: () => stockQuotes({ data: { symbols: stocks } }), enabled: stocks.length > 0 });
  const { data: cq } = useQuery({ queryKey: ["pos-cq", cryptos], queryFn: () => cryptoQuotes({ data: { ids: cryptos } }), enabled: cryptos.length > 0 });

  const priceOf = (p: Pos): number | null => {
    const list = p.asset_type === "stock" ? (sq?.available ? sq.data : []) : (cq?.available ? cq.data : []);
    return list?.find((q) => q.symbol === p.asset)?.price ?? null;
  };

  const enriched = positions.map((p) => {
    const price = priceOf(p);
    const value = price != null ? price * p.shares : null;
    const cost = p.cost_basis * p.shares;
    const pnl = value != null ? value - cost : null;
    const pnlPct = pnl != null ? (pnl / cost) * 100 : null;
    return { ...p, price, value, cost, pnl, pnlPct };
  });

  const totalValue = enriched.reduce((s, r) => s + (r.value ?? r.cost), 0);
  const totalCost = enriched.reduce((s, r) => s + r.cost, 0);
  const totalPnl = totalValue - totalCost;

  const [asset, setAsset] = useState("");
  const [assetType, setAssetType] = useState<"stock" | "crypto">("stock");
  const [shares, setShares] = useState("");
  const [cost, setCost] = useState("");

  const add = useMutation({
    mutationFn: async () => {
      const s = Number(shares); const c = Number(cost);
      if (!asset || !s || !c) throw new Error("All fields required");
      const { error } = await supabase.from("manual_positions").insert({ user_id: userId, asset: asset.toUpperCase(), asset_type: assetType, shares: s, cost_basis: c });
      if (error) throw error;
    },
    onSuccess: () => { setAsset(""); setShares(""); setCost(""); qc.invalidateQueries({ queryKey: ["positions", userId] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("manual_positions").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["positions", userId] }),
  });

  const pie = enriched.filter((r) => (r.value ?? r.cost) > 0).map((r) => ({ name: r.asset, value: r.value ?? r.cost }));

  const commentaryPositions: CommentaryPosition[] = enriched.map((r) => ({
    asset: r.asset,
    asset_type: r.asset_type,
    shares: r.shares,
    cost_basis: r.cost_basis,
    price: r.price,
    value: r.value,
    pnl: r.pnl,
    pnl_pct: r.pnlPct,
  }));

  return (
    <>
    <PortfolioCommentaryCard positions={commentaryPositions} />
    <Card className="p-5 border-border bg-card">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-primary" />
          <h2 className="font-display font-semibold">Portfolio</h2>
        </div>
        <div className="text-right">
          <div className="font-num text-lg">${totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          <div className={cn("font-num text-xs", totalPnl >= 0 ? "text-bull" : "text-bear")}>
            {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)} ({totalCost > 0 ? ((totalPnl / totalCost) * 100).toFixed(2) : "0.00"}%)
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4">
        <Input placeholder="Symbol" value={asset} onChange={(e) => setAsset(e.target.value)} />
        <Select value={assetType} onValueChange={(v) => setAssetType(v as "stock" | "crypto")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="stock">Stock</SelectItem>
            <SelectItem value="crypto">Crypto</SelectItem>
          </SelectContent>
        </Select>
        <Input type="number" step="0.0001" placeholder="Shares" value={shares} onChange={(e) => setShares(e.target.value)} />
        <Input type="number" step="0.01" placeholder="Cost / unit" value={cost} onChange={(e) => setCost(e.target.value)} />
        <Button onClick={() => add.mutate()} disabled={add.isPending}><Plus className="h-4 w-4 mr-1" /> Add</Button>
      </div>

      {positions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add positions to see live P&amp;L and allocation.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ul className="divide-y divide-border">
            {enriched.map((r) => (
              <li key={r.id} className="py-2.5 flex items-center justify-between">
                <div>
                  <div className="font-display font-semibold">{r.asset} <span className="text-[10px] uppercase text-muted-foreground ml-1">{r.asset_type}</span></div>
                  <div className="text-xs text-muted-foreground font-num">{r.shares} @ ${r.cost_basis}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="font-num text-sm">{r.price != null ? `$${r.price.toFixed(2)}` : "—"}</div>
                    <div className={cn("font-num text-xs", (r.pnl ?? 0) >= 0 ? "text-bull" : "text-bear")}>
                      {r.pnlPct != null ? `${r.pnlPct >= 0 ? "+" : ""}${r.pnlPct.toFixed(2)}%` : "—"}
                    </div>
                  </div>
                  <button onClick={() => remove.mutate(r.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
                  {pie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Card>
    </>
  );
}
