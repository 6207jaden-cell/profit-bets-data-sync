import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getStockQuotes, getCryptoQuotes } from "@/lib/market.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-profile";
import { cn } from "@/lib/utils";
import { LiveBadge } from "./LiveBadge";

type Row = { id: string; asset: string; asset_type: "stock" | "crypto" };

export function WatchlistPanel() {
  const { userId } = useProfile();
  const qc = useQueryClient();
  const stockQuotes = useServerFn(getStockQuotes);
  const cryptoQuotes = useServerFn(getCryptoQuotes);
  const [refreshAt, setRefreshAt] = useState(Date.now());

  const { data: rows = [] } = useQuery({
    queryKey: ["watchlist", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("market_tracking").select("*").order("created_at");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    enabled: !!userId,
  });

  const stocks = rows.filter((r) => r.asset_type === "stock").map((r) => r.asset);
  const cryptos = rows.filter((r) => r.asset_type === "crypto").map((r) => r.asset);

  const { data: stockData } = useQuery({
    queryKey: ["watch-stock-q", stocks, refreshAt],
    queryFn: () => stockQuotes({ data: { symbols: stocks } }),
    enabled: stocks.length > 0,
  });
  const { data: cryptoData } = useQuery({
    queryKey: ["watch-crypto-q", cryptos, refreshAt],
    queryFn: () => cryptoQuotes({ data: { ids: cryptos } }),
    enabled: cryptos.length > 0,
  });

  useEffect(() => {
    const i = setInterval(() => setRefreshAt(Date.now()), 60_000);
    return () => clearInterval(i);
  }, []);

  const [asset, setAsset] = useState("");
  const [assetType, setAssetType] = useState<"stock" | "crypto">("stock");

  const add = useMutation({
    mutationFn: async () => {
      if (!asset) return;
      const { error } = await supabase.from("market_tracking").insert({ user_id: userId, asset: asset.toUpperCase(), asset_type: assetType });
      if (error) throw error;
    },
    onSuccess: () => { setAsset(""); qc.invalidateQueries({ queryKey: ["watchlist", userId] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("market_tracking").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist", userId] }),
  });

  const quoteFor = (asset: string, type: "stock" | "crypto") => {
    if (type === "stock" && stockData?.available) return stockData.data.find((q) => q.symbol === asset);
    if (type === "crypto" && cryptoData?.available) return cryptoData.data.find((q) => q.symbol === asset);
    return null;
  };

  return (
    <Card className="p-5 border-border bg-card">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <h2 className="font-display font-semibold">Watchlist</h2>
        </div>
        <LiveBadge updatedAt={new Date(refreshAt)} />
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4">
        <Input placeholder="Symbol (e.g. AAPL or bitcoin)" value={asset} onChange={(e) => setAsset(e.target.value)} className="md:col-span-2" />
        <Select value={assetType} onValueChange={(v) => setAssetType(v as "stock" | "crypto")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="stock">Stock</SelectItem>
            <SelectItem value="crypto">Crypto (CoinGecko id)</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => add.mutate()} disabled={add.isPending}>
          <Plus className="h-4 w-4 mr-1" /> Track
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add stocks (e.g. AAPL, TSLA) or crypto (use CoinGecko id: bitcoin, ethereum) to track live quotes and receive Smart Alerts.
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "AAPL", type: "stock" as const },
              { label: "NVDA", type: "stock" as const },
              { label: "bitcoin", type: "crypto" as const },
            ].map((c) => (
              <button
                key={c.label}
                onClick={() => { setAsset(c.label); setAssetType(c.type); }}
                className="px-3 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition"
              >
                + {c.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const q = quoteFor(r.asset, r.asset_type);
            const positive = q ? q.changePct >= 0 : false;
            return (
              <li key={r.id} className="py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-display font-semibold">{r.asset}</span>
                  <span className="text-[10px] uppercase text-muted-foreground">{r.asset_type}</span>
                </div>
                <div className="flex items-center gap-4">
                  {q ? (
                    <>
                      <span className="font-num">${q.price.toFixed(2)}</span>
                      <span className={cn("font-num text-sm", positive ? "text-bull" : "text-bear")}>
                        {positive ? "+" : ""}{q.changePct.toFixed(2)}%
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">— no data —</span>
                  )}
                  <button onClick={() => remove.mutate(r.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
