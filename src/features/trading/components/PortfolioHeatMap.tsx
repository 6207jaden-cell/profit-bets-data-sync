import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type OpenTrade = {
  id: string;
  asset: string;
  side: string;
  instrument: string | null;
  quantity: number;
  entry_price: number;
  stop_loss_pct: number | null;
  take_profit_pct: number | null;
  conviction: number | null;
  created_at: string;
};

type LivePrice = { symbol: string; price: number };

/**
 * Treemap-style heat map of open positions.
 * Each box is sized by notional value (quantity × entry_price).
 * Color reflects current unrealized P&L: deep green → red.
 */
export function PortfolioHeatMap({ onExplain }: { onExplain?: (asset: string, pnlPct: number) => void }) {
  const { userId } = useProfile();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { data: trades } = useQuery({
    queryKey: ["heat-map-trades", userId],
    enabled: !!userId,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("paper_trades")
        .select("id, asset, side, instrument, quantity, entry_price, stop_loss_pct, take_profit_pct, conviction, created_at")
        .eq("user_id", userId!)
        .eq("is_open", true);
      return (data ?? []) as OpenTrade[];
    },
  });

  const { data: livePrices } = useQuery({
    queryKey: ["heat-map-prices", (trades ?? []).map((t) => t.asset).join(",")],
    enabled: (trades ?? []).length > 0,
    refetchInterval: 15_000,
    queryFn: async (): Promise<LivePrice[]> => {
      const symbols = [...new Set((trades ?? []).map((t) => String(t.asset)))];
      const fin = import.meta.env.VITE_FINNHUB_API_KEY as string | undefined;
      if (!fin) return [];
      const results = await Promise.allSettled(
        symbols.map(async (sym) => {
          const isCrypto = /^(BTC|ETH|SOL|AVAX|MATIC|LINK|DOT)-?USD/i.test(sym);
          const url = isCrypto
            ? `https://api.coingecko.com/api/v3/simple/price?ids=${sym.toLowerCase().replace("-usd","")}&vs_currencies=usd`
            : `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${fin}`;
          const r = await fetch(url);
          if (!r.ok) return null;
          const j = await r.json() as Record<string, unknown>;
          const price = isCrypto
            ? (j[sym.toLowerCase().replace("-usd","")]as Record<string,number>)?.usd
            : (j as { c?: number }).c;
          return price ? { symbol: sym, price: Number(price) } : null;
        })
      );
      return results.flatMap((r) => r.status === "fulfilled" && r.value ? [r.value] : []);
    },
  });

  if (!trades || trades.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No open positions to display
      </div>
    );
  }

  const priceMap = new Map((livePrices ?? []).map((p) => [p.symbol.toUpperCase(), p.price]));

  // Compute P&L and notional for each position
  const positions = trades.map((t) => {
    const livePrice = priceMap.get(String(t.asset).toUpperCase());
    const entry = Number(t.entry_price);
    const qty = Number(t.quantity);
    const notional = entry * qty;
    const pnlPct = livePrice
      ? ((livePrice - entry) / entry) * 100 * (t.side === "buy" ? 1 : -1)
      : 0;
    const pnlDollar = livePrice
      ? (livePrice - entry) * qty * (t.side === "buy" ? 1 : -1)
      : 0;
    return { ...t, livePrice, notional, pnlPct, pnlDollar };
  });

  const totalNotional = positions.reduce((s, p) => s + p.notional, 0);

  // Color by P&L
  function pnlColor(pct: number): string {
    if (pct > 8) return "bg-emerald-700 border-emerald-500";
    if (pct > 4) return "bg-emerald-600 border-emerald-400";
    if (pct > 1) return "bg-emerald-500/80 border-emerald-400";
    if (pct > -1) return "bg-zinc-600 border-zinc-500";
    if (pct > -4) return "bg-amber-600 border-amber-500";
    if (pct > -8) return "bg-orange-600 border-orange-500";
    return "bg-red-700 border-red-500";
  }

  function pnlTextColor(pct: number): string {
    if (pct > 1) return "text-emerald-100";
    if (pct < -1) return "text-red-100";
    return "text-zinc-200";
  }

  // Simple bin-packing: sort by notional desc, lay out in a flow grid
  const sorted = [...positions].sort((a, b) => b.notional - a.notional);

  // Dynamic height based on number of positions
  const rows = Math.ceil(sorted.length / 3);
  const containerHeight = Math.max(120, rows * 100);

  return (
    <div ref={containerRef} className="w-full">
      <div
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${Math.min(sorted.length, 4)}, 1fr)`,
          height: containerHeight,
        }}
      >
        {sorted.map((pos) => {
          const pct = pos.notional / Math.max(totalNotional, 1);
          const instr = String(pos.instrument ?? "stock").toUpperCase();
          const stopDist = pos.stop_loss_pct
            ? ((pos.livePrice ?? pos.entry_price) * (1 - Number(pos.stop_loss_pct) / 100))
            : null;

          return (
            <div
              key={pos.id}
              onClick={() => onExplain?.(String(pos.asset), pos.pnlPct)}
              className={cn(
                "rounded-lg border cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg",
                "flex flex-col items-center justify-center p-2 select-none",
                pnlColor(pos.pnlPct)
              )}
              title={`${pos.asset} — Entry: $${Number(pos.entry_price).toFixed(2)} | Live: $${pos.livePrice?.toFixed(2) ?? "?"} | P&L: ${pos.pnlPct >= 0 ? "+" : ""}${pos.pnlPct.toFixed(1)}%`}
            >
              <div className="font-mono font-bold text-white text-sm sm:text-base truncate max-w-full">
                {String(pos.asset).replace("-USD", "")}
              </div>
              <div className={cn("font-mono text-lg font-bold", pnlTextColor(pos.pnlPct))}>
                {pos.pnlPct >= 0 ? "+" : ""}{pos.pnlPct.toFixed(1)}%
              </div>
              <div className="text-[10px] text-white/70 mt-0.5">
                {pos.pnlDollar >= 0 ? "+" : ""}<span className="font-mono">${Math.abs(pos.pnlDollar).toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1 mt-1 flex-wrap justify-center">
                <Badge className="text-[8px] bg-white/10 text-white/80 border-none py-0 px-1">
                  {instr.slice(0, 5)}
                </Badge>
                {pos.conviction != null && (
                  <Badge className={cn(
                    "text-[8px] border-none py-0 px-1",
                    pos.conviction >= 80 ? "bg-emerald-900/60 text-emerald-200" :
                    pos.conviction >= 60 ? "bg-amber-900/60 text-amber-200" :
                    "bg-zinc-900/60 text-zinc-300"
                  )}>
                    {pos.conviction}%
                  </Badge>
                )}
              </div>
              {stopDist != null && pos.livePrice && (
                <div className="text-[9px] text-white/50 mt-0.5">
                  stop ${stopDist.toFixed(2)}
                </div>
              )}
              <div className="text-[9px] text-white/40 mt-0.5">
                {(pct * 100).toFixed(0)}% of portfolio
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary row */}
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>{positions.length} position{positions.length !== 1 ? "s" : ""}</span>
        <span>
          Total P&L:{" "}
          <span className={cn("font-mono font-medium",
            positions.reduce((s, p) => s + p.pnlDollar, 0) >= 0 ? "text-emerald-400" : "text-red-400"
          )}>
            {positions.reduce((s, p) => s + p.pnlDollar, 0) >= 0 ? "+" : ""}
            ${positions.reduce((s, p) => s + p.pnlDollar, 0).toFixed(2)}
          </span>
        </span>
        <span className="text-[10px]">↻ 15s</span>
      </div>
    </div>
  );
}
