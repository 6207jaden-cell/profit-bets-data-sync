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
              // Primary recipient — always send to this address
              const primaryEmail = "6207jaden@gmail.com";
              // Also send to account email as backup
              const { data: userInfo } = await supabaseAdmin.auth.admin.getUserById(userId);
              const accountEmail = userInfo?.user?.email;
              const recipients = [primaryEmail, ...(accountEmail && accountEmail !== primaryEmail ? [accountEmail] : [])];

              // Fetch open positions for the email
              const { data: openPositions } = await supabaseAdmin
                .from("paper_trades")
                .select("asset, side, entry_price, quantity, rationale")
                .eq("user_id", userId)
                .eq("is_open", true)
                .limit(10);

              // Fetch yesterday closed trades
              const yesterday = new Date(Date.now() - 86_400_000).toISOString();
              const { data: recentClosed } = await supabaseAdmin
                .from("paper_trades")
                .select("asset, side, entry_price, exit_price, quantity, rationale")
                .eq("user_id", userId)
                .eq("is_open", false)
                .gte("closed_at", yesterday)
                .order("closed_at", { ascending: false })
                .limit(10);

              // Compute yesterday P&L
              const yesterdayPnL = (recentClosed ?? []).reduce((sum, t) => {
                if (!t.exit_price) return sum;
                const dir = t.side === "buy" ? 1 : -1;
                return sum + (Number(t.exit_price) - Number(t.entry_price)) * Number(t.quantity) * dir;
              }, 0);

              const openPositionsHtml = (openPositions ?? []).length > 0
                ? (openPositions ?? []).map(p => {
                    const label = (p.rationale ?? "").includes("[SCALP]") ? "🔪 SCALP"
                      : (p.rationale ?? "").includes("[CRYPTO]") ? "₿ CRYPTO"
                      : "📈 SWING";
                    return `<tr style="border-bottom:1px solid #2a2a3a">
                      <td style="padding:6px 8px;color:#e2e8f0">${label}</td>
                      <td style="padding:6px 8px;font-weight:600;color:#a78bfa">${p.asset}</td>
                      <td style="padding:6px 8px;color:#94a3b8">${p.side.toUpperCase()} @ $${Number(p.entry_price).toFixed(2)}</td>
                    </tr>`;
                  }).join("")
                : `<tr><td colspan="3" style="padding:12px;color:#64748b;text-align:center">No open positions</td></tr>`;

              const closedHtml = (recentClosed ?? []).length > 0
                ? (recentClosed ?? []).map(t => {
                    if (!t.exit_price) return "";
                    const dir = t.side === "buy" ? 1 : -1;
                    const pnl = (Number(t.exit_price) - Number(t.entry_price)) * Number(t.quantity) * dir;
                    const isWin = pnl >= 0;
                    return `<tr style="border-bottom:1px solid #2a2a3a">
                      <td style="padding:6px 8px;color:#e2e8f0">${t.asset}</td>
                      <td style="padding:6px 8px;color:#94a3b8">$${Number(t.entry_price).toFixed(2)} → $${Number(t.exit_price).toFixed(2)}</td>
                      <td style="padding:6px 8px;font-weight:600;color:${isWin ? "#34d399" : "#f87171"}">${isWin ? "+" : ""}$${pnl.toFixed(2)}</td>
                    </tr>`;
                  }).join("")
                : `<tr><td colspan="3" style="padding:12px;color:#64748b;text-align:center">No trades closed yesterday</td></tr>`;

              const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;background:#0f172a;color:#e2e8f0;padding:24px;border-radius:12px">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
                  <div style="font-size:24px">📊</div>
                  <div>
                    <h1 style="margin:0;font-size:18px;font-weight:700;color:#a78bfa">PROFIT_BETS.AI</h1>
                    <p style="margin:0;font-size:12px;color:#64748b">Morning Brief — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
                  </div>
                </div>

                <div style="background:#1e293b;border-radius:8px;padding:16px;margin-bottom:16px">
                  <h2 style="margin:0 0 8px 0;font-size:14px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em">Agent Outlook</h2>
                  <p style="margin:0;font-size:14px;line-height:1.6;color:#e2e8f0">${body}</p>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
                  <div style="background:#1e293b;border-radius:8px;padding:12px;text-align:center">
                    <div style="font-size:20px;font-weight:700;color:${yesterdayPnL >= 0 ? "#34d399" : "#f87171"}">${yesterdayPnL >= 0 ? "+" : ""}$${Math.abs(yesterdayPnL).toFixed(2)}</div>
                    <div style="font-size:11px;color:#64748b;margin-top:4px">Yesterday P&L</div>
                  </div>
                  <div style="background:#1e293b;border-radius:8px;padding:12px;text-align:center">
                    <div style="font-size:20px;font-weight:700;color:#e2e8f0">${opens}</div>
                    <div style="font-size:11px;color:#64748b;margin-top:4px">Trades opened</div>
                  </div>
                  <div style="background:#1e293b;border-radius:8px;padding:12px;text-align:center">
                    <div style="font-size:20px;font-weight:700;color:#e2e8f0">${(openPositions ?? []).length}</div>
                    <div style="font-size:11px;color:#64748b;margin-top:4px">Open now</div>
                  </div>
                </div>

                ${(openPositions ?? []).length > 0 ? `
                <div style="margin-bottom:16px">
                  <h2 style="margin:0 0 8px 0;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em">Open Positions</h2>
                  <table style="width:100%;border-collapse:collapse;background:#1e293b;border-radius:8px;overflow:hidden">
                    ${openPositionsHtml}
                  </table>
                </div>` : ""}

                ${(recentClosed ?? []).length > 0 ? `
                <div style="margin-bottom:16px">
                  <h2 style="margin:0 0 8px 0;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em">Closed Yesterday</h2>
                  <table style="width:100%;border-collapse:collapse;background:#1e293b;border-radius:8px;overflow:hidden">
                    ${closedHtml}
                  </table>
                </div>` : ""}

                <div style="margin-top:20px;padding-top:16px;border-top:1px solid #1e293b;font-size:11px;color:#475569;text-align:center">
                  PROFIT_BETS.AI · Autonomous paper trading · Reply STOP to unsubscribe
                </div>
              </div>`;

              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
                body: JSON.stringify({
                  from: fromAddr,
                  to: recipients,
                  subject: `📊 ${title}`,
                  html,
                }),
              });
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
