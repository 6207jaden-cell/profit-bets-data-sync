import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Newspaper, ExternalLink, RefreshCw, TrendingUp, Bitcoin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getMarketNews } from "@/lib/market.functions";
import { cn } from "@/lib/utils";

type Filter = "all" | "stocks" | "crypto";

function timeAgo(ms: number) {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function NewsFeed() {
  const [filter, setFilter] = useState<Filter>("all");
  const newsFn = useServerFn(getMarketNews);
  const q = useQuery({
    queryKey: ["market-news", filter],
    queryFn: () => newsFn({ data: { category: filter } }),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const articles = q.data?.available ? q.data.data : [];

  return (
    <Card className="p-5 border-border bg-card">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h3 className="text-sm font-display font-semibold flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-primary" /> Market News &amp; Catalysts
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex bg-secondary rounded-lg p-0.5">
            {(["all", "stocks", "crypto"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[10px] font-semibold capitalize transition-all",
                  filter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {f === "all" ? "All" : f === "stocks" ? "📈 Stocks" : "₿ Crypto"}
              </button>
            ))}
          </div>
          <button
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            className="p-1.5 rounded-md bg-secondary text-muted-foreground hover:text-foreground"
            aria-label="Refresh news"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", q.isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {q.data && !q.data.available ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          {q.data.reason === "missing_api_key" ? "Add a Finnhub API key to enable news." : "News unavailable right now."}
        </p>
      ) : q.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-secondary/50 rounded-lg animate-pulse" />)}
        </div>
      ) : articles.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No news available right now.</p>
      ) : (
        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
          {articles.map((a) => (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-3 bg-secondary/30 rounded-lg border border-border p-3 hover:border-primary/40 transition-all group"
            >
              {a.image && (
                <img
                  src={a.image}
                  alt=""
                  className="w-16 h-16 rounded-md object-cover flex-shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-xs font-semibold leading-tight line-clamp-2 group-hover:text-primary transition-colors">
                    {a.headline}
                  </h4>
                  <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                {a.summary && <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{a.summary}</p>}
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5",
                    a.category === "crypto" ? "bg-amber-500/15 text-amber-500" : "bg-primary/15 text-primary",
                  )}>
                    {a.category === "crypto" ? <Bitcoin className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                    {a.category}
                  </span>
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded font-semibold",
                    a.sentiment === "bullish" && "bg-bull/15 text-bull",
                    a.sentiment === "bearish" && "bg-bear/15 text-bear",
                    a.sentiment === "neutral" && "bg-muted text-muted-foreground",
                  )}>{a.sentiment}</span>
                  {a.tickers.slice(0, 3).map((t) => (
                    <span key={t} className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground font-num">{t}</span>
                  ))}
                  <span className="text-[10px] text-muted-foreground ml-auto">{a.source} · {timeAgo(a.datetime)}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </Card>
  );
}
