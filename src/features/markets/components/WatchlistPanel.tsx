import { LoadingState, ErrorState } from "@/components/StateViews";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getStockQuotes, getCryptoQuotes } from "@/lib/market.functions";
import { getHistoricalBars } from "@/lib/history.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer } from "recharts";
import { Eye, Plus, Trash2, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-profile";
import { cn } from "@/lib/utils";
import { LiveBadge } from "./LiveBadge";

type Row = { id: string; asset: string; asset_type: "stock" | "crypto" };

// Default watchlist — mirrors agent UNIVERSE. Added via "Populate defaults" button.
const DEFAULT_STOCKS = [
  "AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","AMD","CRM","ADBE","ORCL","INTC","QCOM","MU","NOW","SNOW","SHOP",
  "AVGO","TSM","ASML","ARM","AMAT","KLAC","TXN","MRVL",
  "JPM","V","BAC","GS","MS","WFC","AXP","BLK","COF",
  "UNH","LLY","ABBV","PFE","MRK","TMO","ISRG","JNJ",
  "COST","MCD","SBUX","NKE","LOW","WMT","HD","PG",
  "XOM","CVX","COP","CAT","BA","GE","HON","LMT","RTX",
  "PANW","CRWD","NET","DDOG","UBER","DIS","NFLX","APP","CELH",
  "PLTR","SOUN","BBAI","IONQ","SMCI","MSTR","ALAB","TEM","NVTS","SMTC",
  "SOFI","HOOD","COIN","PYPL","UPST","RIVN","RBLX","SNAP","LYFT","ABNB",
  "ROKU","DKNG","CAVA","HIMS","MARA","RIOT","ACHR","JOBY","LUNR","RKLB",
  "AXON","TTD","ARQT","RXRX","DNA","BABA","BIDU","GFS","OPEN",
  "SPY","QQQ","IWM","GLD","TLT","XLF","XLK","XLE","XLV","XLI","XLP",
  "ARKK","SOXX","IBIT","SOXL","TQQQ","LABU","FNGU","MIDU","UDOW",
];
const DEFAULT_CRYPTO = [
  "BTC-USD","ETH-USD","SOL-USD","AVAX-USD","XRP-USD","ADA-USD","TRX-USD","TON-USD","HBAR-USD","ETC-USD","ATOM-USD",
  "LINK-USD","AAVE-USD","UNI-USD","MATIC-USD","ARB-USD","OP-USD",
  "INJ-USD","SUI-USD","NEAR-USD","DOT-USD","LTC-USD","FET-USD","RENDER-USD",
  "DOGE-USD","SHIB-USD","PEPE-USD","WIF-USD","BONK-USD","FLOKI-USD",
];



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
    staleTime: 45_000,
    gcTime: 5 * 60_000,
  });
  const { data: cryptoData } = useQuery({
    queryKey: ["watch-crypto-q", cryptos, refreshAt],
    queryFn: () => cryptoQuotes({ data: { ids: cryptos } }),
    enabled: cryptos.length > 0,
    staleTime: 45_000,
    gcTime: 5 * 60_000,
  });

  useEffect(() => {
    const i = setInterval(() => setRefreshAt(Date.now()), 60_000);
    return () => clearInterval(i);
  }, []);

  const [asset, setAsset] = useState("");
  const [assetType, setAssetType] = useState<"stock" | "crypto">("stock");
  const [detailAsset, setDetailAsset] = useState<{ asset: string; type: "stock" | "crypto" } | null>(null);

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

  const populateDefaults = useMutation({
    mutationFn: async () => {
      const { data: existing } = await supabase.from("market_tracking").select("asset").eq("user_id", userId!);
      const existingSet = new Set((existing ?? []).map((r) => r.asset.toUpperCase()));
      const rows = [
        ...DEFAULT_STOCKS.filter((s) => !existingSet.has(s)).map((s) => ({ user_id: userId!, asset: s, asset_type: "stock" as const })),
        ...DEFAULT_CRYPTO.filter((c) => !existingSet.has(c)).map((c) => ({ user_id: userId!, asset: c, asset_type: "crypto" as const })),
      ];
      if (rows.length === 0) return { added: 0 };
      for (let i = 0; i < rows.length; i += 50) {
        const { error } = await supabase.from("market_tracking").insert(rows.slice(i, i + 50));
        if (error) throw error;
      }
      return { added: rows.length };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["watchlist", userId] });
      toast.success(result?.added ? `Added ${result.added} assets to your watchlist` : "Watchlist already up to date");
    },
    onError: (e) => toast.error(`Failed: ${String(e)}`),
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
      <Button
        size="sm"
        variant="outline"
        onClick={() => populateDefaults.mutate()}
        disabled={populateDefaults.isPending}
        title="Adds all 100 stocks, 20 ETFs and 30 crypto from the agent scanning universe"
      >
        {populateDefaults.isPending ? "Adding…" : "＋ All defaults"}
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
                <button
                  onClick={() => setDetailAsset({ asset: r.asset, type: r.asset_type })}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left hover:text-primary transition"
                >
                  <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-display font-semibold truncate">{r.asset}</span>
                  <span className="text-[10px] uppercase text-muted-foreground shrink-0">{r.asset_type}</span>
                </button>
                <div className="flex items-center gap-4 shrink-0">
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
      <WatchlistChartSheet detail={detailAsset} onClose={() => setDetailAsset(null)} />
    </Card>
  );
}

function WatchlistChartSheet({
  detail, onClose,
}: {
  detail: { asset: string; type: "stock" | "crypto" } | null;
  onClose: () => void;
}) {
  const barsFn = useServerFn(getHistoricalBars);
  const symbol = detail ? (detail.type === "crypto" ? cryptoToSymbol(detail.asset) : detail.asset.toUpperCase()) : "";
  const bars = useQuery({
    queryKey: ["watchlist-bars", symbol],
    enabled: !!detail && !!symbol,
    staleTime: 3600_000,
    queryFn: () => barsFn({ data: { symbol, days: 90 } }),
  });
  const data = (bars.data?.points ?? []).map((p) => ({
    date: new Date(p.t).toLocaleDateString([], { month: "short", day: "numeric" }),
    close: p.close,
  }));
  const first = data[0]?.close ?? 0;
  const last = data[data.length - 1]?.close ?? 0;
  const pct = first > 0 ? ((last - first) / first) * 100 : 0;
  const up = pct >= 0;
  const stroke = up ? "hsl(var(--bull))" : "hsl(var(--bear))";

  return (
    <Sheet open={!!detail} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            {detail?.asset} <span className="text-xs uppercase text-muted-foreground">{detail?.type}</span>
          </SheetTitle>
          <SheetDescription>90-day price history</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {bars.isLoading ? (
            <LoadingState />
          ) : data.length < 2 ? (
            <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">No historical data available for this asset.</div>
          ) : (
            <>
              <div className="flex items-baseline gap-3 mb-3">
                <span className="font-num text-2xl font-semibold">${last.toFixed(2)}</span>
                <span className={cn("text-sm font-mono", up ? "text-bull" : "text-bear")}>
                  {up ? "+" : ""}{pct.toFixed(2)}% <span className="text-muted-foreground">90d</span>
                </span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="watch-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" minTickGap={30} />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={["auto", "auto"]} />
                    <RTooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                      formatter={(v: number) => [`$${v.toFixed(2)}`, "Close"]}
                    />
                    <Area type="monotone" dataKey="close" stroke={stroke} fill="url(#watch-fill)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function cryptoToSymbol(id: string): string {
  const map: Record<string, string> = { bitcoin: "BTC-USD", ethereum: "ETH-USD", solana: "SOL-USD" };
  return map[id.toLowerCase()] ?? `${id.toUpperCase()}-USD`;
}

