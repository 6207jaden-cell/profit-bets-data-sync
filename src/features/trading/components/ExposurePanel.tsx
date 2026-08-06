import { useQuery } from "@tanstack/react-query";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Scale } from "lucide-react";
import { LoadingState } from "@/components/StateViews";
import { getExposure } from "@/lib/exposure.functions";

function concentrationLabel(hhi: number | null): { text: string; tone: "positive" | "neutral" | "negative" } {
  if (hhi == null) return { text: "—", tone: "neutral" };
  if (hhi < 1500) return { text: "Diversified", tone: "positive" };
  if (hhi < 2500) return { text: "Moderate", tone: "neutral" };
  return { text: "Concentrated", tone: "negative" };
}

export function ExposurePanel() {
  const { userId } = useProfile();

  const { data: exposure, isLoading } = useQuery({
    queryKey: ["exposure", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => getExposure(),
  });

  if (isLoading) return <LoadingState message="Loading current exposure…" />;
  if (!exposure) return null;

  const concentration = concentrationLabel(exposure.concentrationHHI);

  return (
    <section>
      <h2 className="font-display font-semibold text-sm mb-1 flex items-center gap-2">
        <Scale className="h-4 w-4 text-primary" />
        Current Exposure
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Right now, not historical — how much capital is deployed vs. cash, and how concentrated it is. Position sizes use entry value, not live mark-to-market price.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Card className="p-3 border-border/60 bg-card">
          <p className="text-[10px] text-muted-foreground mb-1">Deployed</p>
          <p className="text-lg font-mono font-bold">{exposure.deployedPct.toFixed(0)}%</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">${exposure.deployedValue.toLocaleString()}</p>
        </Card>
        <Card className="p-3 border-border/60 bg-card">
          <p className="text-[10px] text-muted-foreground mb-1">Cash</p>
          <p className="text-lg font-mono font-bold">{exposure.cashPct.toFixed(0)}%</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">${exposure.cashBalance.toLocaleString()}</p>
        </Card>
        <Card className="p-3 border-border/60 bg-card">
          <p className="text-[10px] text-muted-foreground mb-1">Open Positions</p>
          <p className="text-lg font-mono font-bold">{exposure.openPositionCount}</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">
            {exposure.largestPositionPct != null ? `largest: ${exposure.largestPositionPct.toFixed(0)}% of deployed` : "none open"}
          </p>
        </Card>
        <Card className="p-3 border-border/60 bg-card">
          <p className="text-[10px] text-muted-foreground mb-1">Concentration</p>
          <p className={cn(
            "text-lg font-mono font-bold",
            concentration.tone === "positive" ? "text-emerald-400" : concentration.tone === "negative" ? "text-red-400" : ""
          )}>
            {concentration.text}
          </p>
          <p className="text-[9px] text-muted-foreground mt-0.5">
            {exposure.concentrationHHI != null ? `HHI: ${exposure.concentrationHHI}` : "no open positions"}
          </p>
        </Card>
      </div>

      {exposure.byAssetClass.length > 0 && (
        <Card className="mt-2 border-border/60 bg-card overflow-hidden">
          <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50 font-medium">Deployed Capital by Asset Class</div>
          <div className="divide-y divide-border/30">
            {exposure.byAssetClass.map((r) => (
              <div key={r.assetClass} className="flex items-center justify-between px-4 py-2">
                <span className="text-sm font-medium capitalize">{r.assetClass}</span>
                <div className="text-right">
                  <span className="text-xs font-mono block">${r.valueDollar.toLocaleString()}</span>
                  <span className="text-[9px] text-muted-foreground">{r.pctOfDeployed.toFixed(0)}% of deployed</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </section>
  );
}
