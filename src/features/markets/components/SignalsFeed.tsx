import { LoadingState, ErrorState } from "@/components/StateViews";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Zap } from "lucide-react";
import { generateMarketSignals } from "@/lib/market.functions";
import { MarketSignalCard } from "./MarketSignalCard";
import { cn } from "@/lib/utils";

type Timeframe = "1D" | "1W" | "1M";
type Filter = "all" | "options" | "stocks" | "crypto";
type Direction = "call" | "put" | "buy" | "sell";
type SignalType = "options_flow" | "buy_sell";

type SignalRow = {
  id: string;
  asset: string;
  signal_type: SignalType;
  direction: Direction;
  confidence: number;
  entry_price: number | null;
  target_price: number | null;
  stop_price: number | null;
  expected_edge_pct: number | null;
  thesis: string | null;
  result: string;
  created_at: string;
};

const CRYPTO_RE = /^(BTC|ETH|SOL|DOGE|ADA|XRP|AVAX|MATIC|BCH|DOT|LINK|SHIB|LTC|UNI|ATOM|BNB)/i;

export function SignalsFeed({ onDetailsClick }: { onDetailsClick?: (asset: string, kind: "stock" | "crypto") => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const qc = useQueryClient();
  const generateFn = useServerFn(generateMarketSignals);

  const q = useQuery({
    queryKey: ["signals-feed", filter, timeframe],
    queryFn: async () => {
      const since = new Date();
      if (timeframe === "1D") since.setHours(0, 0, 0, 0);
      else if (timeframe === "1W") since.setDate(since.getDate() - 7);
      else since.setDate(since.getDate() - 30);

      let query = supabase
        .from("market_signals")
        .select("*")
        .gte("created_at", since.toISOString())
        .eq("is_public", true)
        .order("created_at", { ascending: false })
        .limit(timeframe === "1D" ? 24 : timeframe === "1W" ? 60 : 120);

      if (filter === "options") query = query.eq("signal_type", "options_flow");
      else if (filter === "stocks") query = query.eq("signal_type", "buy_sell");

      const { data, error } = await query;
      if (error) throw error;
      let rows = (data ?? []) as SignalRow[];
      if (filter === "crypto") rows = rows.filter((r) => CRYPTO_RE.test(r.asset));
      else if (filter === "stocks") rows = rows.filter((r) => !CRYPTO_RE.test(r.asset));
      return rows;
    },
    refetchInterval: 60_000,
  });

  const signals = q.data ?? [];

  async function refresh() {
    await generateFn();
    qc.invalidateQueries({ queryKey: ["signals-feed"] });
    qc.invalidateQueries({ queryKey: ["public-signals-today"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-secondary rounded-lg p-0.5">
          {(["all", "options", "stocks", "crypto"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-all",
                filter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="flex bg-secondary rounded-lg p-0.5">
          {(["1D", "1W", "1M"] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                timeframe === tf ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tf}
            </button>
          ))}
        </div>

        <Button size="sm" variant="outline" onClick={refresh} disabled={q.isFetching} className="ml-auto">
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", q.isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {q.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-52 bg-card rounded-lg animate-pulse border border-border" />)}
        </div>
      ) : signals.length === 0 ? (
        <Card className="p-10 text-center border-border bg-card">
          <Zap className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            No {filter === "all" ? "" : filter + " "}signals in the last {timeframe}. Try Refresh above.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {signals.map((s, i) => (
            <MarketSignalCard
              key={s.id}
              index={i}
              asset={s.asset}
              direction={s.direction}
              signalType={s.signal_type}
              confidence={s.confidence}
              entryPrice={s.entry_price}
              targetPrice={s.target_price}
              stopPrice={s.stop_price}
              expectedEdgePct={s.expected_edge_pct}
              thesis={s.thesis}
              onDetailsClick={onDetailsClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
