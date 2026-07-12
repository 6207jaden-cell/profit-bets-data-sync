import { LoadingState, ErrorState } from "@/components/StateViews";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Newspaper, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { scanNewsCatalysts } from "@/lib/catalysts.functions";
import { cn } from "@/lib/utils";

function timeAgo(ms: number) {
  const d = Date.now() - ms;
  const m = Math.floor(d / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function CatalystsPanel() {
  const scanFn = useServerFn(scanNewsCatalysts);
  const q = useQuery({
    queryKey: ["news-catalysts"],
    queryFn: () => scanFn({ data: { limit: 25 } }),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const catalysts = q.data?.ok ? q.data.catalysts : [];

  return (
    <Card className="p-5 border-border bg-card">
      <header className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="font-display font-semibold flex items-center gap-2">
            <Newspaper className="w-4 h-4 text-primary" /> News Catalysts
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Symbols moving in the news right now — ranked by mention volume × sentiment. The autonomous agent adds top catalysts to its scan universe.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", q.isFetching && "animate-spin")} /> Refresh
        </Button>
      </header>

      {q.isLoading ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Scanning news feeds…</div>
      ) : q.data && !q.data.ok ? (
        <div className="text-sm text-muted-foreground py-6 text-center">News source unavailable ({q.data.reason}).</div>
      ) : catalysts.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">No catalysts detected in the current news cycle.</div>
      ) : (
        <ul className="divide-y divide-border">
          {catalysts.map((c) => {
            const Sent = c.sentiment > 0.15 ? TrendingUp : c.sentiment < -0.15 ? TrendingDown : Minus;
            const sentTone = c.sentiment > 0.15 ? "text-bull" : c.sentiment < -0.15 ? "text-bear" : "text-muted-foreground";
            return (
              <li key={c.symbol} className="py-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                <div className="flex flex-col items-center min-w-[3.5rem]">
                  <span className="font-display font-bold text-sm">{c.symbol}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">×{c.mentions}</span>
                </div>
                <div className="min-w-0">
                  <a href={c.latestUrl} target="_blank" rel="noopener noreferrer"
                    className="text-sm truncate block hover:text-primary transition-colors">
                    {c.latestHeadline} <ExternalLink className="w-3 h-3 inline-block ml-1 opacity-60" />
                  </a>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5">
                    <span>{c.sources.slice(0, 2).join(", ")}</span>
                    <span>·</span>
                    <span>{timeAgo(c.latestAt)}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="outline" className="font-mono text-[10px]">score {c.score}</Badge>
                  <div className={cn("flex items-center gap-1 text-[10px] font-mono", sentTone)}>
                    <Sent className="w-3 h-3" />
                    {c.sentiment > 0 ? "+" : ""}{c.sentiment.toFixed(2)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
