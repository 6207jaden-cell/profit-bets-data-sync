import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Zap, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type OptionsFlow = {
  symbol: string;
  expiry: string;
  strike: number;
  type: "call" | "put";
  premium: number;       // total premium (contracts × price × 100)
  volume: number;
  open_interest: number;
  vol_oi_ratio: number;  // volume/OI — high ratio = unusual activity
  implied_vol: number;
  sentiment: "bullish" | "bearish" | "neutral";
  size_label: "large" | "medium" | "small";
  fetched_at: string;
};

const WATCHED_SYMBOLS = [
  "AAPL","MSFT","NVDA","TSLA","AMZN","META","GOOGL","SPY","QQQ",
  "AMD","COIN","PLTR","SOFI","MSTR"
];

async function fetchOptionsFlow(): Promise<OptionsFlow[]> {
  const poly = import.meta.env.VITE_POLYGON_API_KEY as string | undefined;
  // Server-side fetch is better — use our existing proxy pattern via supabase functions
  // Client-side: use Polygon options snapshot endpoint
  if (!poly) return [];

  const results: OptionsFlow[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const exp30 = new Date(Date.now() + 35 * 86400_000).toISOString().slice(0, 10);

  await Promise.allSettled(
    WATCHED_SYMBOLS.slice(0, 8).map(async (sym) => {
      try {
        const url = `https://api.polygon.io/v3/snapshot/options/${sym}?expiration_date.gte=${today}&expiration_date.lte=${exp30}&limit=50&sort=details.strike_price&apiKey=${poly}`;
        const r = await fetch(url);
        if (!r.ok) return;
        const j = (await r.json()) as {
          results?: Array<{
            details?: { contract_type: string; expiration_date: string; strike_price: number };
            day?: { volume?: number };
            greeks?: { implied_volatility?: number };
            open_interest?: number;
            last_quote?: { bid?: number; ask?: number };
          }>;
        };

        const contracts = (j.results ?? []).filter((c) => {
          const vol = c.day?.volume ?? 0;
          const oi = c.open_interest ?? 0;
          return vol > 500 && oi > 0 && vol / oi > 0.5; // unusual activity filter
        });

        for (const c of contracts.slice(0, 3)) {
          const vol = c.day?.volume ?? 0;
          const oi = c.open_interest ?? 1;
          const bid = c.last_quote?.bid ?? 0;
          const ask = c.last_quote?.ask ?? 0;
          const mid = (bid + ask) / 2;
          const premium = mid * vol * 100;
          const volOi = vol / oi;
          const iv = c.greeks?.implied_volatility ?? 0;
          const type = c.details?.contract_type?.toLowerCase() === "put" ? "put" : "call";
          const sentiment: "bullish" | "bearish" | "neutral" =
            type === "call" && volOi > 1 ? "bullish" :
            type === "put" && volOi > 1 ? "bearish" : "neutral";
          const size_label: "large" | "medium" | "small" =
            premium > 500_000 ? "large" : premium > 100_000 ? "medium" : "small";

          results.push({
            symbol: sym,
            expiry: c.details?.expiration_date ?? "",
            strike: c.details?.strike_price ?? 0,
            type,
            premium,
            volume: vol,
            open_interest: oi,
            vol_oi_ratio: Number(volOi.toFixed(2)),
            implied_vol: Number((iv * 100).toFixed(1)),
            sentiment,
            size_label,
            fetched_at: new Date().toISOString(),
          });
        }
      } catch { /* skip */ }
    })
  );

  // Sort by premium descending (biggest bets first)
  return results.sort((a, b) => b.premium - a.premium).slice(0, 20);
}

export function OptionsFlowPanel() {
  const { data: flow, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["options-flow"],
    queryFn: fetchOptionsFlow,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000, // refresh every 10 minutes
  });

  const bullish = (flow ?? []).filter((f) => f.sentiment === "bullish").length;
  const bearish = (flow ?? []).filter((f) => f.sentiment === "bearish").length;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-amber-400" />
            Unusual Options Activity
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            High vol/OI ratio contracts — potential institutional positioning
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(flow ?? []).length > 0 && (
            <div className="flex gap-1.5 text-[11px]">
              <span className="text-emerald-400">{bullish} bullish</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-red-400">{bearish} bearish</span>
            </div>
          )}
          <button
            onClick={() => refetch()}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Scanning options activity…
        </div>
      ) : !flow || flow.length === 0 ? (
        <Card className="p-4 text-center text-sm text-muted-foreground border-border/50">
          <p>No unusual options activity found.</p>
          <p className="text-xs mt-1">Requires POLYGON_API_KEY. Activity filters: volume &gt; 500, vol/OI &gt; 0.5</p>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {flow.map((f, i) => (
            <Card
              key={i}
              className={cn(
                "px-3 py-2.5 border-border/50",
                f.sentiment === "bullish" ? "bg-emerald-950/20 border-emerald-800/30" :
                f.sentiment === "bearish" ? "bg-red-950/20 border-red-800/30" :
                "bg-card/60"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {f.sentiment === "bullish"
                    ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    : <TrendingDown className="h-3.5 w-3.5 text-red-400 shrink-0" />
                  }
                  <span className="font-mono font-bold text-sm">{f.symbol}</span>
                  <Badge
                    className={cn(
                      "text-[10px] border-none",
                      f.type === "call"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-red-500/20 text-red-300"
                    )}
                  >
                    ${f.strike} {f.type.toUpperCase()}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    exp {f.expiry.slice(5)}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    className={cn(
                      "text-[10px] border-none",
                      f.size_label === "large" ? "bg-amber-500/20 text-amber-300" :
                      f.size_label === "medium" ? "bg-blue-500/20 text-blue-300" :
                      "bg-zinc-500/20 text-zinc-400"
                    )}
                  >
                    {f.size_label}
                  </Badge>
                  <span className="font-mono text-xs font-semibold">
                    ${f.premium >= 1_000_000
                      ? `${(f.premium / 1_000_000).toFixed(1)}M`
                      : `${(f.premium / 1_000).toFixed(0)}K`
                    }
                  </span>
                </div>
              </div>
              <div className="flex gap-3 mt-1.5 text-[10px] text-muted-foreground font-mono">
                <span>Vol: {f.volume.toLocaleString()}</span>
                <span>OI: {f.open_interest.toLocaleString()}</span>
                <span className={cn(f.vol_oi_ratio > 2 ? "text-amber-400" : "")}>
                  Vol/OI: {f.vol_oi_ratio}x
                </span>
                <span>IV: {f.implied_vol}%</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {dataUpdatedAt > 0 && (
        <p className="text-[10px] text-muted-foreground text-right">
          Updated {new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          {" · "}refreshes every 10 min
        </p>
      )}
    </div>
  );
}
