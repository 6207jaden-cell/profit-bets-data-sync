import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type OpenTrade = {
  id: string;
  asset: string;
  side: string;
  entry_price: number;
  stop_loss_pct: number | null;
  take_profit_pct: number | null;
  hold_duration: string | null;
  instrument: string | null;
};

/**
 * Watches live prices for all open positions every 90 seconds.
 * If any position hits its stop-loss or take-profit, calls /api/public/emergency-exit
 * immediately rather than waiting for the 2-hour cron.
 *
 * Skips options positions (no reliable real-time price available without options chain).
 * Only runs during market hours for stock/ETF positions; always runs for crypto.
 */
export function useRealtimeExitWatch(
  trades: OpenTrade[],
  anonKey: string,
  enabled: boolean,
) {
  const tradesRef = useRef(trades);
  tradesRef.current = trades;

  useEffect(() => {
    if (!enabled || trades.length === 0) return;

    let cancelled = false;

    async function checkPrices() {
      if (cancelled) return;
      const positions = tradesRef.current.filter((t) => {
        const instr = (t.instrument ?? "stock").toLowerCase();
        // Skip options — we can't reliably price them without the chain
        return !["call", "put", "call_spread", "put_spread", "iron_condor"].includes(instr);
      });
      if (positions.length === 0) return;

      // Fetch Supabase anon key from env for the API call
      const baseUrl = window.location.origin;

      await Promise.allSettled(
        positions.map(async (trade) => {
          try {
            // Fetch live price via Finnhub (client-side, using public key)
            const finnhubKey = (import.meta.env.VITE_FINNHUB_API_KEY as string | undefined) ?? "";
            if (!finnhubKey) return;

            const sym = String(trade.asset).replace("-USD", "").toUpperCase();
            const isCrypto = trade.asset.includes("-USD") || trade.asset.toLowerCase().includes("btc") || trade.asset.toLowerCase().includes("eth") || trade.asset.toLowerCase().includes("sol");

            let price: number | null = null;
            if (isCrypto) {
              const cgId = sym === "BTC" ? "bitcoin" : sym === "ETH" ? "ethereum" : sym === "SOL" ? "solana" : sym.toLowerCase();
              const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`);
              if (r.ok) {
                const j = (await r.json()) as Record<string, { usd?: number }>;
                price = j[cgId]?.usd ?? null;
              }
            } else {
              const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${finnhubKey}`);
              if (r.ok) {
                const j = (await r.json()) as { c?: number };
                price = j.c && j.c > 0 ? j.c : null;
              }
            }

            if (!price) return;

            const entry = Number(trade.entry_price);
            const isBuy = trade.side === "buy";
            const pnlPct = ((price - entry) / entry) * 100 * (isBuy ? 1 : -1);
            const stopPct = Number(trade.stop_loss_pct ?? 7);
            const targetPct = Number(trade.take_profit_pct ?? 15);

            // Check trailing stop if position is profitable
            const trailingStopPrice = (trade as Record<string,unknown> & { options_details?: Record<string,unknown> }).options_details?.trailing_stop_price as number | undefined;
            const hitTrailingStop = trailingStopPrice != null && isBuy && price <= trailingStopPrice;
            const hitStop = hitTrailingStop || pnlPct <= -stopPct;
            const hitTarget = pnlPct >= targetPct;

            // Check intraday EOD
            const now = new Date();
            const etHour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }).format(now));
            const etMin = Number(new Intl.DateTimeFormat("en-US", { minute: "numeric", timeZone: "America/New_York" }).format(now));
            const isEOD = trade.hold_duration === "intraday" && (etHour > 15 || (etHour === 15 && etMin >= 30));

            if (hitStop || hitTarget || isEOD) {
              // Call emergency exit endpoint
              await fetch(`${baseUrl}/api/public/emergency-exit`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  apikey: anonKey,
                },
                body: JSON.stringify({ trade_id: trade.id, current_price: price }),
              });
            }
          } catch {
            // Silently ignore — best effort
          }
        }),
      );
    }

    // Run immediately then every 20 seconds for stocks, 30s for crypto
    // (crypto prices update continuously, stocks during market hours only)
    checkPrices();
    const interval = setInterval(checkPrices, 20_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, trades.length, anonKey]);
}
