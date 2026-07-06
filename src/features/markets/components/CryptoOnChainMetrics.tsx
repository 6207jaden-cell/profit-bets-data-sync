import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, WifiOff } from "lucide-react";
import { getOnChainMetrics } from "@/lib/onchain.functions";
import { cn } from "@/lib/utils";

type Signal = "bullish" | "bearish" | "neutral";

const sigColor = (s: Signal) => s === "bullish" ? "text-bull" : s === "bearish" ? "text-bear" : "text-muted-foreground";
const sigBg = (s: Signal) => s === "bullish" ? "bg-bull/10" : s === "bearish" ? "bg-bear/10" : "bg-secondary";

export function CryptoOnChainMetrics({ asset }: { asset: string }) {
  const fn = useServerFn(getOnChainMetrics);
  const q = useQuery({
    queryKey: ["onchain", asset],
    queryFn: () => fn({ data: { asset } }),
    staleTime: 5 * 60_000,
  });

  if (q.isLoading) return <div className="bg-secondary/40 rounded-lg p-3 animate-pulse h-20" />;
  if (!q.data?.available) {
    return (
      <div className="bg-secondary/40 rounded-lg p-3 flex items-center gap-2">
        <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">On-chain data unavailable</span>
      </div>
    );
  }
  const d = q.data.data;
  if (d.unsupported) return null;

  const flowSignal: Signal = d.exchangeNetFlow < 0 ? "bullish" : d.exchangeNetFlow > 5000 ? "bearish" : "neutral";
  const nvtSignal: Signal = d.nvtRatio < 40 ? "bullish" : d.nvtRatio > 65 ? "bearish" : "neutral";
  const addrSignal: Signal = d.activeAddresses24h >= 500_000 ? "bullish" : d.activeAddresses24h <= 200_000 ? "bearish" : "neutral";

  return (
    <div className="bg-secondary/40 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Activity className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">On-Chain</span>
        <span className="ml-auto text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-semibold">LIVE</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className={cn("rounded-md p-2", sigBg(addrSignal))}>
          <div className="text-[10px] text-muted-foreground">Community</div>
          <div className={cn("text-xs font-num font-bold", sigColor(addrSignal))}>
            {d.activeAddresses24h > 1_000_000 ? `${(d.activeAddresses24h / 1_000_000).toFixed(1)}M` : `${(d.activeAddresses24h / 1000).toFixed(0)}K`}
          </div>
        </div>
        <div className={cn("rounded-md p-2", sigBg(flowSignal))}>
          <div className="text-[10px] text-muted-foreground">Flow proxy</div>
          <div className={cn("text-xs font-num font-bold", sigColor(flowSignal))}>
            {d.exchangeNetFlow >= 0 ? "+" : ""}{(d.exchangeNetFlow / 1000).toFixed(1)}K
          </div>
        </div>
        <div className={cn("rounded-md p-2", sigBg(nvtSignal))}>
          <div className="text-[10px] text-muted-foreground">NVT</div>
          <div className={cn("text-xs font-num font-bold", sigColor(nvtSignal))}>{d.nvtRatio.toFixed(1)}</div>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-muted-foreground text-right">
        24h: <span className={d.priceChange24h >= 0 ? "text-bull" : "text-bear"}>
          {d.priceChange24h >= 0 ? "+" : ""}{d.priceChange24h.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}
