import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getStockQuotes, getCryptoQuotes } from "@/lib/market.functions";
import { cn } from "@/lib/utils";

const STOCKS = ["SPY", "QQQ", "AAPL", "TSLA", "NVDA", "MSTR", "PLTR", "CRWD", "LLY"];
const CRYPTOS = [
  { sym: "BTC", id: "bitcoin" }, { sym: "ETH", id: "ethereum" },
  { sym: "SOL", id: "solana" }, { sym: "XRP", id: "ripple" }, { sym: "DOGE", id: "dogecoin" },
];

type Item = { symbol: string; price: number; changePct: number; type: "stock" | "crypto" };

export function LivePriceTicker() {
  const stocksFn = useServerFn(getStockQuotes);
  const cryptoFn = useServerFn(getCryptoQuotes);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const stocks = useQuery({
    queryKey: ["ticker-stocks"],
    queryFn: () => stocksFn({ data: { symbols: STOCKS } }),
    staleTime: 90_000,
    refetchInterval: 120_000,
  });
  const cryptos = useQuery({
    queryKey: ["ticker-cryptos"],
    queryFn: () => cryptoFn({ data: { ids: CRYPTOS.map((c) => c.id) } }),
    staleTime: 90_000,
    refetchInterval: 120_000,
  });

  const items: Item[] = [
    ...(stocks.data?.available ? stocks.data.data.map((q) => ({ symbol: q.symbol, price: q.price, changePct: q.changePct, type: "stock" as const })) : []),
    ...(cryptos.data?.available
      ? cryptos.data.data.map((q) => {
          const match = CRYPTOS.find((c) => c.id.toUpperCase() === q.symbol);
          return { symbol: match?.sym ?? q.symbol, price: q.price, changePct: q.changePct, type: "crypto" as const };
        })
      : []),
  ];

  useEffect(() => {
    if (paused || !scrollRef.current || items.length === 0) return;
    const el = scrollRef.current;
    let raf = 0;
    const step = () => {
      if (el.scrollLeft >= el.scrollWidth - el.clientWidth) el.scrollLeft = 0;
      else el.scrollLeft += 0.4;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [paused, items.length]);

  const fmt = (p: number, type: string) => {
    if (p === 0) return "—";
    if (type === "crypto" && p > 100) return p.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    return p.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (items.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      className="flex gap-2 overflow-x-auto scrollbar-hide py-2"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="Live prices"
    >
      {items.map((item) => (
        <div key={`${item.type}-${item.symbol}`} className="flex items-center gap-2 px-3 py-1.5 bg-card rounded-lg border border-border min-w-[145px] shrink-0">
          <span className="text-xs font-display font-semibold">{item.symbol}</span>
          <span className="text-xs font-num text-muted-foreground">{fmt(item.price, item.type)}</span>
          {item.changePct !== 0 && (
            <span className={cn("flex items-center gap-0.5 text-[10px] font-num font-semibold", item.changePct > 0 ? "text-bull" : "text-bear")}>
              {item.changePct > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {item.changePct > 0 ? "+" : ""}{item.changePct.toFixed(1)}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
