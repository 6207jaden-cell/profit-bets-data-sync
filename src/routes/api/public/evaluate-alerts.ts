import { createFileRoute } from "@tanstack/react-router";

/**
 * Called by pg_cron every 5 minutes via the project's anon key in the `apikey` header.
 * Scans active alerts, compares to live quotes, marks triggered.
 */
export const Route = createFileRoute("/api/public/evaluate-alerts")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: alerts, error } = await supabaseAdmin
          .from("price_alerts")
          .select("id, asset, asset_type, target_price, direction")
          .eq("triggered", false);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        if (!alerts || alerts.length === 0) return Response.json({ ok: true, checked: 0, triggered: 0 });

        const stockSyms = [...new Set(alerts.filter((a) => a.asset_type === "stock").map((a) => a.asset))];
        const cryptoIds = [...new Set(alerts.filter((a) => a.asset_type === "crypto").map((a) => a.asset.toLowerCase()))];

        const priceMap = new Map<string, number>();

        // Stocks: try Finnhub (cheapest free tier)
        const fin = process.env.FINNHUB_API_KEY;
        if (fin && stockSyms.length > 0) {
          await Promise.all(stockSyms.map(async (s) => {
            try {
              const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${fin}`);
              if (r.ok) {
                const j = (await r.json()) as { c?: number };
                if (j.c) priceMap.set(`stock:${s.toUpperCase()}`, j.c);
              }
            } catch { /* skip */ }
          }));
        }

        // Crypto via CoinGecko
        if (cryptoIds.length > 0) {
          try {
            const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cryptoIds.join(",")}&vs_currencies=usd`);
            if (r.ok) {
              const j = (await r.json()) as Record<string, { usd: number }>;
              for (const [id, v] of Object.entries(j)) {
                priceMap.set(`crypto:${id.toUpperCase()}`, v.usd);
              }
            }
          } catch { /* skip */ }
        }

        let triggered = 0;
        for (const a of alerts) {
          const key = `${a.asset_type}:${a.asset.toUpperCase()}`;
          const price = priceMap.get(key);
          if (price == null) continue;
          const hit = a.direction === "above" ? price >= Number(a.target_price) : price <= Number(a.target_price);
          if (hit) {
            await supabaseAdmin.from("price_alerts").update({
              triggered: true,
              triggered_at: new Date().toISOString(),
              triggered_price: price,
            }).eq("id", a.id);
            triggered++;
          }
        }

        return Response.json({ ok: true, checked: alerts.length, triggered });
      },
    },
  },
});
