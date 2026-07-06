import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOptionsFlow } from "@/lib/market.functions";
import { getRobinhoodConnection } from "@/lib/mcp-client.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownRight, ExternalLink, RefreshCw, Activity, Filter, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { robinhoodOptionsChainUrl } from "@/lib/robinhood-links";

/**
 * Options Flow tab for the Trading dashboard.
 * Uses the existing getOptionsFlow (Polygon) server function.
 * Each row has:
 *  - a "Robinhood" deep-link to the options chain (works whether you're MCP-connected or not)
 *  - a "MCP" badge showing if your Robinhood MCP is connected (for future in-app execution)
 */
export function OptionsFlowPanel() {
  const flowFn = useServerFn(getOptionsFlow);
  const rhFn = useServerFn(getRobinhoodConnection);

  const flow = useQuery({ queryKey: ["options-flow"], queryFn: () => flowFn(), staleTime: 3 * 60_000 });
  const rh = useQuery({ queryKey: ["mcp-robinhood"], queryFn: () => rhFn(), staleTime: 60_000 });

  const [filter, setFilter] = useState<"all" | "call" | "put">("all");
  const [minPremium, setMinPremium] = useState("10000");
  const [tickerFilter, setTickerFilter] = useState("");

  const rows = useMemo(() => {
    if (!flow.data?.available) return [];
    const minP = Number(minPremium) || 0;
    const tf = tickerFilter.trim().toUpperCase();
    return flow.data.data.filter((f) => {
      if (filter !== "all" && f.type !== filter) return false;
      if (f.premium < minP) return false;
      if (tf && !f.symbol.toUpperCase().includes(tf)) return false;
      return true;
    });
  }, [flow.data, filter, minPremium, tickerFilter]);

  // Extract underlying ticker from Polygon option symbol (e.g. O:AAPL240119C00150000 → AAPL)
  const underlying = (sym: string) => {
    const m = sym.match(/^O:([A-Z]+)/);
    return m ? m[1] : sym;
  };

  const mcpConnected = rh.data?.status === "ready";

  return (
    <div className="space-y-4">
      <Card className="p-4 border-border bg-card">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h2 className="font-display font-semibold">Options Flow Scanner</h2>
            <Badge variant="outline" className="text-[10px]">Polygon</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              className={cn(
                "text-[10px]",
                mcpConnected ? "bg-bull/15 text-bull border-bull/30" : "bg-muted text-muted-foreground border-border",
              )}
              variant="outline"
            >
              <Zap className="h-3 w-3 mr-1" />
              {mcpConnected ? "Robinhood MCP ready" : "Robinhood MCP off"}
            </Badge>
            <Button size="sm" variant="ghost" onClick={() => flow.refetch()} disabled={flow.isFetching}>
              <RefreshCw className={cn("h-3.5 w-3.5", flow.isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="flex bg-secondary rounded-md p-0.5">
            {(["all", "call", "put"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setFilter(v)}
                className={cn(
                  "px-3 py-1 rounded text-[11px] font-semibold uppercase transition-all",
                  filter === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Ticker"
              value={tickerFilter}
              onChange={(e) => setTickerFilter(e.target.value)}
              className="h-8 w-24 text-xs"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Min premium $</span>
            <Input
              type="number"
              value={minPremium}
              onChange={(e) => setMinPremium(e.target.value)}
              className="h-8 w-28 text-xs font-num"
            />
          </div>
        </div>

        {flow.isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-secondary/50 rounded-md animate-pulse" />
            ))}
          </div>
        ) : !flow.data?.available ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            Options flow unavailable{" "}
            {flow.data?.reason === "missing_api_key" && "— add a Polygon API key to enable."}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">No contracts match your filters.</div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.slice(0, 40).map((f, i) => {
              const under = underlying(f.symbol);
              return (
                <li key={`${f.symbol}-${i}`} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {f.type === "call" ? (
                      <ArrowUpRight className="h-4 w-4 text-bull shrink-0" />
                    ) : (
                      <ArrowDownRight className="h-4 w-4 text-bear shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-display font-semibold text-sm truncate">{under}</div>
                      <div className="text-[10px] text-muted-foreground font-num truncate">
                        {f.expiry} · ${f.strike} {f.type}
                      </div>
                    </div>
                  </div>
                  <div className="text-right hidden sm:block">
                    <div className="text-xs font-num">${(f.premium / 1000).toFixed(1)}k</div>
                    <div className="text-[10px] text-muted-foreground font-num">vol {f.volume.toLocaleString()}</div>
                  </div>
                  <a
                    href={robinhoodOptionsChainUrl(under, f.type)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${under} ${f.type} chain on Robinhood`}
                  >
                    <Button size="sm" variant="outline" className="h-8">
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Robinhood
                    </Button>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
