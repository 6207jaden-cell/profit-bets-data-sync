import { createFileRoute } from "@tanstack/react-router";

/**
 * Resolve open market_signals against current market prices.
 * Runs hourly via pg_cron.
 */

function isCrypto(sym: string): boolean {
  return /-USD$|USDT$|BTC|ETH|SOL/i.test(sym) || sym.includes("-USD");
}

async function livePrice(symbol: string): Promise<number | null> {
  const S = symbol.toUpperCase();
  const fin = process.env.FINNHUB_API_KEY;
  const poly = process.env.POLYGON_API_KEY;
  try {
    if (fin && !isCrypto(S)) {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${S}&token=${fin}`);
      if (r.ok) {
        const j = (await r.json()) as { c?: number };
        if (j.c) return j.c;
      }
    }
    if (fin && isCrypto(S)) {
      const base = S.replace(/[-/]USD[T]?$/i, "");
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=BINANCE:${base}USDT&token=${fin}`);
      if (r.ok) {
        const j = (await r.json()) as { c?: number };
        if (j.c) return j.c;
      }
    }
  } catch { /* fall */ }
  try {
    if (poly) {
      const polySym = isCrypto(S) ? `X:${S.replace(/[-/]USD[T]?$/i, "")}USD` : S;
      const r = await fetch(`https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(polySym)}/prev?apiKey=${poly}`);
      if (r.ok) {
        const j = (await r.json()) as { results?: Array<{ c: number }> };
        if (j.results?.[0]?.c) return j.results[0].c;
      }
    }
  } catch { /* fall */ }
  return null;
}

export const Route = createFileRoute("/api/public/resolve-signals")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anon = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
        const apikey = request.headers.get("apikey") ?? request.headers.get("Apikey");
        if (!anon || apikey !== anon) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
        const fiveDaysAgo = new Date(Date.now() - 5 * 86400_000).toISOString();

        const { data: signals, error } = await supabaseAdmin
          .from("market_signals")
          .select("id, asset, direction, entry_price, target_price, stop_price, created_at, user_id")
          .eq("result", "open")
          .lte("created_at", thirtyMinAgo);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        const { fireWebhook } = await import("@/lib/webhook.functions");


        const priceCache = new Map<string, number | null>();
        let hit_target = 0, hit_stop = 0, expired = 0;

        for (const s of signals ?? []) {
          const asset = String(s.asset);
          const dir = String(s.direction);
          const entry = Number(s.entry_price);
          const tgt = s.target_price != null ? Number(s.target_price) : null;
          const stp = s.stop_price != null ? Number(s.stop_price) : null;
          const isShort = dir === "sell" || dir === "put";

          if (s.created_at < fiveDaysAgo) {
            await supabaseAdmin.from("market_signals").update({ result: "stale" }).eq("id", s.id);
            expired++;
            continue;
          }

          if (!priceCache.has(asset)) priceCache.set(asset, await livePrice(asset));
          const price = priceCache.get(asset);
          if (!price || !entry) continue;

          const dirMult = isShort ? -1 : 1;
          if (tgt != null && ((!isShort && price >= tgt) || (isShort && price <= tgt))) {
            const pnl = ((tgt - entry) / entry) * 100 * dirMult;
            await supabaseAdmin.from("market_signals").update({
              result: "hit_target", resolved_pnl_pct: pnl,
            }).eq("id", s.id);
            if (s.user_id) await fireWebhook(String(s.user_id), "signal_hit", { signal_id: s.id, asset, direction: dir, entry, target: tgt, pnl_pct: pnl });
            hit_target++;

          } else if (stp != null && ((!isShort && price <= stp) || (isShort && price >= stp))) {
            const pnl = ((stp - entry) / entry) * 100 * dirMult;
            await supabaseAdmin.from("market_signals").update({
              result: "hit_stop", resolved_pnl_pct: pnl,
            }).eq("id", s.id);
            hit_stop++;
          }
        }

        return Response.json({
          ok: true, resolved: hit_target + hit_stop + expired, hit_target, hit_stop, expired,
        });
      },
    },
  },
});
