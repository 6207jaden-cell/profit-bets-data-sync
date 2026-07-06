import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Layers, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { getMultiTimeframeConsensus } from "@/lib/multitimeframe.functions";
import { cn } from "@/lib/utils";

type Verdict = "bullish" | "bearish" | "neutral";

const Icon = ({ v }: { v: Verdict }) =>
  v === "bullish" ? <TrendingUp className="w-3.5 h-3.5 text-bull" /> :
  v === "bearish" ? <TrendingDown className="w-3.5 h-3.5 text-bear" /> :
  <Minus className="w-3.5 h-3.5 text-muted-foreground" />;

export function MultiTimeframeConsensus({ asset, assetType }: { asset: string; assetType: "stock" | "crypto" }) {
  const fn = useServerFn(getMultiTimeframeConsensus);
  const q = useQuery({
    queryKey: ["mtf", asset, assetType],
    queryFn: () => fn({ data: { asset, assetType } }),
    staleTime: 3 * 60_000,
  });

  if (q.isLoading) return <div className="rounded-lg border border-border bg-card p-4 h-40 animate-pulse" />;
  if (!q.data?.available) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Multi-timeframe data unavailable{q.data && "reason" in q.data ? ` (${q.data.reason})` : ""}.
      </div>
    );
  }

  const { timeframes, consensus, score } = q.data;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <h3 className="font-display font-semibold">Multi-Timeframe Consensus</h3>
        </div>
        <div className={cn(
          "flex items-center gap-1 text-xs uppercase tracking-wider px-2 py-1 rounded font-semibold",
          consensus === "bullish" && "bg-bull/15 text-bull",
          consensus === "bearish" && "bg-bear/15 text-bear",
          consensus === "neutral" && "bg-muted text-muted-foreground",
        )}>
          <Icon v={consensus} /> {consensus} · {score > 0 ? "+" : ""}{score}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {timeframes.map((t) => (
          <div key={t.tf} className="rounded-md border border-border/60 bg-background/40 p-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t.label}</span>
              <Icon v={t.verdict} />
            </div>
            <div className="font-num text-sm font-semibold">${t.price.toFixed(2)}</div>
            <div className={cn("text-[10px] font-num", t.changePct >= 0 ? "text-bull" : "text-bear")}>
              {t.changePct >= 0 ? "+" : ""}{t.changePct.toFixed(2)}% (20-bar)
            </div>
            <div className="text-[10px] text-muted-foreground mt-1 font-num">RSI {t.rsi14.toFixed(0)} · SMA20 {t.sma20.toFixed(2)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
