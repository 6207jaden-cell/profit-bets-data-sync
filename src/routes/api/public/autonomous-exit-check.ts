import { createFileRoute } from "@tanstack/react-router";
import { fetchQuotePrice } from "@/lib/indicators";
import { callGateway } from "@/routes/api/public/autonomous-agent";

type ExitAction = { position_id: string; action: "hold" | "trim" | "exit"; reason: string };

export const Route = createFileRoute("/api/public/autonomous-exit-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: users } = await supabaseAdmin
          .from("user_settings").select("user_id").eq("autonomous_mode", true);
        if (!users || users.length === 0) return Response.json({ ok: true, reason: "no_users" });

        // ET hour approximation for intraday EOD
        const etHourMin = (() => {
          const s = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });
          const m = s.match(/(\d{1,2}):(\d{2})/);
          if (!m) return { h: 0, m: 0 };
          return { h: Number(m[1]), m: Number(m[2]) };
        })();
        const afterEod = etHourMin.h * 60 + etHourMin.m >= 15 * 60 + 30;

        let totalClosed = 0;
        for (const u of users) {
          const closed = await runExitForUser(u.user_id, supabaseAdmin, afterEod);
          totalClosed += closed;
        }
        return Response.json({ ok: true, users: users.length, closed: totalClosed });
      },
    },
  },
});

async function runExitForUser(userId: string, supabaseAdmin: Awaited<ReturnType<typeof getAdmin>>, afterEod: boolean): Promise<number> {
  const { data: portfolio } = await supabaseAdmin.from("paper_portfolios").select("*").eq("user_id", userId).maybeSingle();
  if (!portfolio) return 0;
  const { data: openTrades } = await supabaseAdmin.from("paper_trades").select("*").eq("user_id", userId).eq("is_open", true);
  if (!openTrades || openTrades.length === 0) return 0;

  type Row = typeof openTrades[number];
  const closures: Array<{ trade: Row; exit_price: number; reason: string }> = [];
  const aiCandidates: Array<Row & { current_price: number; current_pnl_pct: number; days_held: number }> = [];

  for (const t of openTrades) {
    const price = await fetchQuotePrice(t.asset);
    if (!price) continue;
    const dir = t.side === "buy" ? 1 : -1;
    const pnlPct = ((price - Number(t.entry_price)) / Number(t.entry_price)) * 100 * dir;
    const stop = t.stop_loss_pct ?? 7;
    const target = t.take_profit_pct ?? 15;

    // Trailing stop: once position is profitable >5%, move stop up to lock in gains.
    // Trailing stop = current_price × (1 - stop_pct/100) for longs.
    // We store the "effective stop price" in metadata (options_details.trailing_stop_price).
    if (pnlPct > 5 && t.side === "buy") {
      const trailingStopPrice = price * (1 - stop / 100);
      const existingTrailing = (t.options_details as Record<string,unknown> | null)?.trailing_stop_price as number | undefined;
      // Only ratchet upward — never lower the stop
      if (!existingTrailing || trailingStopPrice > existingTrailing) {
        await supabaseAdmin.from("paper_trades").update({
          options_details: { ...(t.options_details as Record<string,unknown> ?? {}), trailing_stop_price: trailingStopPrice },
        }).eq("id", t.id);
        // Use the updated trailing stop for this run
        (t as Record<string,unknown>).options_details = { ...(t.options_details as Record<string,unknown> ?? {}), trailing_stop_price: trailingStopPrice };
      }
    }

    // Check trailing stop (if set, use it instead of fixed stop for longs)
    const trailingStop = (t.options_details as Record<string,unknown> | null)?.trailing_stop_price as number | undefined;
    if (trailingStop && t.side === "buy" && price <= trailingStop) {
      closures.push({ trade: t, exit_price: price, reason: "trailing_stop_hit" });
      continue;
    }

    if (pnlPct <= -stop) {
      closures.push({ trade: t, exit_price: price, reason: "stop_loss_hit" });
      continue;
    }
    if (pnlPct >= target) {
      closures.push({ trade: t, exit_price: price, reason: "take_profit_hit" });
      continue;
    }
    if (t.hold_duration === "intraday" && afterEod) {
      closures.push({ trade: t, exit_price: price, reason: "intraday_eod_close" });
      continue;
    }
    if (t.hold_duration && t.hold_duration !== "intraday") {
      const days = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);
      aiCandidates.push({ ...t, current_price: price, current_pnl_pct: pnlPct, days_held: days });
    }
  }

  // AI batch decision for swing/position holds
  if (aiCandidates.length > 0) {
    // Fetch regime and current indicators for each position before AI review
    const { fetchBars, buildContext, detectMarketRegime } = await import("@/lib/indicators");
    const spyBarsForExit = await fetchBars("SPY", 60);
    const exitRegime = spyBarsForExit ? detectMarketRegime(spyBarsForExit.closes) : "sideways";

    const positionsWithIndicators = await Promise.all(aiCandidates.map(async (c) => {
      let currentRsi: number | null = null;
      let macdHist: number | null = null;
      let bbPctB: number | null = null;
      try {
        const bars = await fetchBars(String(c.asset), 30);
        if (bars) {
          const ctx = buildContext(bars.closes);
          currentRsi = ctx?.rsi ?? null;
          macdHist = ctx?.macd_histogram ?? null;
          bbPctB = ctx?.bb_pct_b ?? null;
        }
      } catch { /* skip */ }
      return {
        position_id: c.id, symbol: c.asset, direction: c.side,
        entry_price: c.entry_price, current_price: c.current_price,
        current_pnl_pct: c.current_pnl_pct, days_held: c.days_held,
        hold_duration: c.hold_duration,
        current_rsi: currentRsi,
        macd_histogram: macdHist,
        bb_pct_b: bbPctB,
        stop_loss_pct: c.stop_loss_pct,
        take_profit_pct: c.take_profit_pct,
        original_rationale: String((c as Record<string,unknown>).rationale ?? "").slice(0, 150),
      };
    }));

    const system = `You are a portfolio manager doing a position review. Market regime: ${exitRegime}. For each position, decide: hold, trim (close 50%), or exit (close 100%). Consider: current P&L%, current RSI (>70 overbought, <30 oversold), MACD histogram trend, Bollinger Band position (bb_pct_b: 0=lower band, 1=upper band), days held vs hold_duration, and whether original rationale still holds. Be willing to cut losses on positions not working. Respond ONLY with valid JSON array (no markdown): [{"position_id":"<id>","action":"hold|trim|exit","reason":"<short specific reason referencing indicators>"}]`;
    const userMsg = JSON.stringify(positionsWithIndicators);
    try {
      const key = process.env.LOVABLE_API_KEY;
      if (key) {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
            temperature: 0.3,
          }),
        });
        if (r.ok) {
          const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const text = (j.choices?.[0]?.message?.content ?? "").replace(/```json\s*|\s*```/g, "").trim();
          const actions = JSON.parse(text) as ExitAction[];
          for (const a of actions) {
            if (a.action === "hold") continue;
            const cand = aiCandidates.find((c) => c.id === a.position_id);
            if (!cand) continue;
            if (a.action === "exit") {
              closures.push({ trade: cand, exit_price: cand.current_price, reason: `ai_exit: ${a.reason}` });
            }
            // trim: skip for now (would require partial close support)
          }
        }
      }
    } catch (e) { console.error("[exit-ai]", e); }
    // ignore the unused suppression
    void callGateway;
  }

  if (closures.length === 0) return 0;

  let cash = Number(portfolio.balance) || 0;
  const summaries: string[] = [];
  for (const c of closures) {
    const dir = c.trade.side === "buy" ? 1 : -1;
    const pnl = (c.exit_price - Number(c.trade.entry_price)) * Number(c.trade.quantity) * dir;
    await supabaseAdmin.from("paper_trades").update({
      is_open: false, exit_price: c.exit_price, pnl, closed_at: new Date().toISOString(),
    }).eq("id", c.trade.id);
    cash += Number(c.trade.quantity) * c.exit_price;
    summaries.push(`${c.trade.asset} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} (${c.reason})`);
  }
  await supabaseAdmin.from("paper_portfolios").update({ balance: cash, updated_at: new Date().toISOString() }).eq("id", portfolio.id);
  const cashPct = Number(portfolio.equity) > 0 ? (cash / Number(portfolio.equity)) * 100 : 0;
  await supabaseAdmin.from("agent_messages").insert({
    user_id: userId, role: "assistant", is_autonomous: true, session_type: "exit_check",
    content: `🔄 Exit check complete. Closed ${closures.length} position(s): ${summaries.join(", ")}. Portfolio is now ${cashPct.toFixed(0)}% cash.`,
  });
  await supabaseAdmin.from("agent_decisions").insert({
    user_id: userId, session_type: "exit_check", trades_closed: closures.length,
    payload: { closures: summaries } as never,
  });
  return closures.length;
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
