import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/daily-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anon = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
        const apikey = request.headers.get("apikey") ?? request.headers.get("Apikey");
        if (!anon || apikey !== anon) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        const aiKey = process.env.LOVABLE_API_KEY;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const dayAgo = new Date(Date.now() - 86400_000).toISOString();

        // Users with at least one active strategy
        const { data: userRows } = await supabaseAdmin
          .from("strategies").select("user_id").eq("active", true);
        const userIds = Array.from(new Set((userRows ?? []).map((r) => r.user_id as string)));

        let sent = 0;
        for (const userId of userIds) {
          const [portfolio, prevSnap, execs, signals, perf] = await Promise.all([
            supabaseAdmin.from("paper_portfolios").select("equity, starting_balance").eq("user_id", userId).maybeSingle(),
            supabaseAdmin.from("portfolio_snapshots").select("equity").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
            supabaseAdmin.from("signals_executions").select("reason, strategy_id").eq("user_id", userId).gte("created_at", dayAgo),
            supabaseAdmin.from("market_signals").select("result").eq("user_id", userId).gte("created_at", dayAgo).in("result", ["hit_target", "hit_stop"]),
            supabaseAdmin.from("paper_trades").select("strategy_id, pnl").eq("user_id", userId).eq("is_open", false).gte("closed_at", dayAgo),
          ]);

          const equity = Number(portfolio.data?.equity ?? 0);
          const prevEquity = Number(prevSnap.data?.equity ?? portfolio.data?.starting_balance ?? equity);
          const dayPnl = equity - prevEquity;
          const opens = (execs.data ?? []).filter((e) => (e.reason ?? "").includes("auto_entry")).length;
          const closes = (execs.data ?? []).filter((e) => (e.reason ?? "").includes("auto_exit")).length;
          const hits = (signals.data ?? []).filter((s) => s.result === "hit_target").length;
          const stops = (signals.data ?? []).filter((s) => s.result === "hit_stop").length;

          const byStrat = new Map<string, number>();
          for (const t of perf.data ?? []) {
            if (!t.strategy_id) continue;
            byStrat.set(t.strategy_id, (byStrat.get(t.strategy_id) ?? 0) + Number(t.pnl ?? 0));
          }
          const sortedStrat = [...byStrat.entries()].sort((a, b) => b[1] - a[1]);
          const bestId = sortedStrat[0]?.[0];
          const worstId = sortedStrat[sortedStrat.length - 1]?.[0];
          const stratNames = new Map<string, string>();
          if (bestId || worstId) {
            const { data: names } = await supabaseAdmin.from("strategies").select("id, name").in("id", [bestId, worstId].filter(Boolean) as string[]);
            for (const n of names ?? []) stratNames.set(n.id, n.name);
          }

          const stats = {
            dayPnl: dayPnl.toFixed(2),
            opens, closes, hits, stops,
            best: bestId ? `${stratNames.get(bestId)} (+$${sortedStrat[0][1].toFixed(2)})` : "none",
            worst: worstId && worstId !== bestId ? `${stratNames.get(worstId)} ($${sortedStrat[sortedStrat.length - 1][1].toFixed(2)})` : "none",
          };

          let body = `Yesterday: P&L $${stats.dayPnl}. Auto-opened ${opens}, auto-closed ${closes}. Signals: ${hits} hit target, ${stops} hit stop. Best: ${stats.best}. Worst: ${stats.worst}.`;
          if (aiKey) {
            try {
              const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Lovable-API-Key": aiKey, "X-Lovable-AIG-SDK": "direct" },
                body: JSON.stringify({
                  model: "google/gemini-2.5-flash",
                  messages: [{ role: "user", content: `Summarize this trading day in 3 plain-English sentences for a retail trader:\n${JSON.stringify(stats)}` }],
                }),
              });
              if (r.ok) {
                const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
                const text = j.choices?.[0]?.message?.content?.trim();
                if (text) body = text.slice(0, 800);
              }
            } catch { /* keep default */ }
          }

          const title = `Daily digest · ${dayPnl >= 0 ? "+" : ""}$${dayPnl.toFixed(2)}`;
          await supabaseAdmin.from("notifications").insert({
            user_id: userId, type: "digest", title, body,
          });

          // Email via Resend (optional — requires RESEND_API_KEY secret + verified sender)
          const resendKey = process.env.RESEND_API_KEY;
          const fromAddr = process.env.RESEND_FROM ?? "digest@trading.local";
          if (resendKey) {
            try {
              const { data: userInfo } = await supabaseAdmin.auth.admin.getUserById(userId);
              const toEmail = userInfo?.user?.email;
              if (toEmail) {
                const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#111">
                  <h2 style="margin:0 0 8px 0;font-size:18px">${title}</h2>
                  <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#333">${body.replace(/</g, "&lt;")}</p>
                  <hr style="border:none;border-top:1px solid #eee;margin:16px 0" />
                  <table style="font-size:12px;color:#555;border-collapse:collapse">
                    <tr><td>Auto-opened</td><td style="padding-left:12px">${opens}</td></tr>
                    <tr><td>Auto-closed</td><td style="padding-left:12px">${closes}</td></tr>
                    <tr><td>Signals hit target</td><td style="padding-left:12px">${hits}</td></tr>
                    <tr><td>Signals hit stop</td><td style="padding-left:12px">${stops}</td></tr>
                  </table>
                </div>`;
                await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
                  body: JSON.stringify({ from: fromAddr, to: [toEmail], subject: title, html }),
                });
              }
            } catch (e) {
              console.error("[daily-digest] resend failed", e);
            }
          }

          sent++;
        }

        return Response.json({ ok: true, sent });
      },
    },
  },
});
