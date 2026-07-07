import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/snapshot-portfolio")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anon = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
        const apikey = request.headers.get("apikey") ?? request.headers.get("Apikey");
        if (!anon || apikey !== anon) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: portfolios, error } = await supabaseAdmin
          .from("paper_portfolios").select("user_id, balance, equity");
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        let inserted = 0;
        for (const p of portfolios ?? []) {
          const { count } = await supabaseAdmin
            .from("paper_trades").select("id", { count: "exact", head: true })
            .eq("user_id", p.user_id).eq("is_open", true);
          const { error: iErr } = await supabaseAdmin.from("portfolio_snapshots").insert({
            user_id: p.user_id,
            equity: Number(p.equity ?? 0),
            cash: Number(p.balance ?? 0),
            open_positions: count ?? 0,
          });
          if (!iErr) inserted++;
        }
        return Response.json({ ok: true, inserted });
      },
    },
  },
});
