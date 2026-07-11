import { createFileRoute } from "@tanstack/react-router";
import { saveTradeOutcomeMemory } from "@/lib/agent-memory";

export const Route = createFileRoute("/api/public/autonomous-learning")({
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

        let processed = 0;
        for (const u of users) {
          const ok = await runLearningForUser(u.user_id, supabaseAdmin);
          if (ok) processed += 1;
        }
        return Response.json({ ok: true, processed });
      },
    },
  },
});

async function runLearningForUser(userId: string, supabaseAdmin: Awaited<ReturnType<typeof getAdmin>>): Promise<boolean> {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: trades } = await supabaseAdmin
    .from("paper_trades").select("*")
    .eq("user_id", userId).eq("is_open", false).gte("closed_at", weekAgo);
  if (!trades || trades.length < 3) return false;

  const withPnl = trades.map((t) => ({ ...t, pnl_num: Number(t.pnl ?? 0) }));
  const wins = withPnl.filter((t) => t.pnl_num > 0).length;
  const winRate = wins / withPnl.length;
  const avgPnlPct = withPnl.reduce((s, t) => {
    const pct = ((Number(t.exit_price) - Number(t.entry_price)) / Number(t.entry_price)) * 100 * (t.side === "buy" ? 1 : -1);
    return s + pct;
  }, 0) / withPnl.length;

  const { data: prior } = await supabaseAdmin
    .from("agent_learnings").select("analysis, adjustments")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(4);
  const priorSummary = (prior ?? []).map((p, i) => `Week ${i + 1}: ${p.analysis?.slice(0, 200)}`).join("\n") || "None.";

  const system = `You are a quantitative trading analyst reviewing a week of autonomous trading activity. Identify patterns in what worked and what didn't and provide specific actionable adjustments for next week. Be direct and honest. Respond ONLY with valid JSON (no markdown): { "analysis": "string", "key_insights": ["string"], "adjustments": ["string"] }`;
  const userMsg = JSON.stringify({
    trades: withPnl.map((t) => ({
      asset: t.asset, side: t.side, instrument: t.instrument,
      entry_price: t.entry_price, exit_price: t.exit_price, pnl: t.pnl,
      hold_duration: t.hold_duration, rationale: t.rationale?.slice(0, 200),
      opened: t.created_at, closed: t.closed_at,
    })),
    stats: { win_rate: winRate, avg_pnl_pct: avgPnlPct, count: withPnl.length },
    prior_learnings: priorSummary,
  });

  const key = process.env.LOVABLE_API_KEY;
  if (!key) return false;
  let parsed: { analysis: string; key_insights: string[]; adjustments: string[] } | null = null;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
        temperature: 0.5,
      }),
    });
    if (!r.ok) return false;
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = (j.choices?.[0]?.message?.content ?? "").replace(/```json\s*|\s*```/g, "").trim();
    parsed = JSON.parse(text);
  } catch (e) { console.error("[learning]", e); return false; }
  if (!parsed) return false;

  // Compute last Monday's date
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const daysBack = day === 0 ? 6 : day - 1;
  const weekStart = new Date(now.getTime() - daysBack * 86400000).toISOString().slice(0, 10);

  // Save trade outcome memories for significant trades
  for (const t of withPnl.slice(0, 20)) {
    if (Math.abs(Number(t.pnl ?? 0)) < 1) continue; // skip tiny trades
    const entryPrice = Number((t as Record<string, unknown>).entry_price ?? 0);
    const exitPrice = Number((t as Record<string, unknown>).exit_price ?? 0);
    if (!entryPrice || !exitPrice) continue;
    const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100 * (String((t as Record<string, unknown>).side ?? "buy") === "buy" ? 1 : -1);
    await saveTradeOutcomeMemory(supabaseAdmin as never, userId, {
      asset: String((t as Record<string, unknown>).asset ?? ""),
      side: String((t as Record<string, unknown>).side ?? "buy"),
      instrument: String((t as Record<string, unknown>).instrument ?? "stock"),
      entry_price: entryPrice,
      exit_price: exitPrice,
      pnl_pct: pnlPct,
      hold_duration: String((t as Record<string, unknown>).hold_duration ?? ""),
      rationale: String((t as Record<string, unknown>).rationale ?? ""),
    }).catch(() => {});
  }

  await supabaseAdmin.from("agent_learnings").insert({
    user_id: userId, week_start: weekStart,
    analysis: parsed.analysis,
    key_insights: parsed.key_insights as never,
    adjustments: parsed.adjustments as never,
    trades_analyzed: withPnl.length, win_rate: winRate, avg_pnl_pct: avgPnlPct,
  });
  const firstAdj = parsed.adjustments.slice(0, 2).join("; ");
  await supabaseAdmin.from("agent_messages").insert({
    user_id: userId, role: "assistant", is_autonomous: true, session_type: "weekly_learning",
    content: `📚 Weekly learning review complete. Analyzed ${withPnl.length} trades (${(winRate * 100).toFixed(0)}% win rate, avg ${avgPnlPct >= 0 ? "+" : ""}${avgPnlPct.toFixed(1)}% per trade). Key insight: ${parsed.key_insights[0] ?? "n/a"}. Adjustments for next week: ${firstAdj}.`,
  });
  return true;
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
