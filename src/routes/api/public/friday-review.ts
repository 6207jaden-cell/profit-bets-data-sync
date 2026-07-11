import { createFileRoute } from "@tanstack/react-router";
import { fetchQuotePrice } from "@/lib/indicators";
import { callGateway } from "./autonomous-agent";

/**
 * Friday 3:45pm ET position review.
 * For every open swing/position trade, the agent posts a brief status update:
 * still valid? hold, trim, or watch for Monday?
 *
 * Called by pg_cron: Friday 19:45 UTC = 3:45pm ET
 * POST /api/public/friday-review
 */

export const Route = createFileRoute("/api/public/friday-review")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Only run for users with autonomous mode on
        const { data: users } = await supabaseAdmin
          .from("user_settings")
          .select("user_id")
          .eq("autonomous_mode", true);

        if (!users || users.length === 0) {
          return Response.json({ ok: true, reviewed: 0, reason: "no_users" });
        }

        let reviewed = 0;

        for (const { user_id: userId } of users) {
          try {
            // Load swing/position open trades (not intraday — those are auto-closed at EOD)
            const { data: openTrades } = await supabaseAdmin
              .from("paper_trades")
              .select("id, asset, side, instrument, quantity, entry_price, stop_loss_pct, take_profit_pct, rationale, created_at, hold_duration")
              .eq("user_id", userId)
              .eq("is_open", true)
              .neq("hold_duration", "intraday");

            if (!openTrades || openTrades.length === 0) continue;

            // Fetch current prices for all positions
            const positionSummaries = await Promise.all(
              openTrades.map(async (t) => {
                const currentPrice = await fetchQuotePrice(String(t.asset)).catch(() => null);
                const entry = Number(t.entry_price);
                const pnlPct = currentPrice
                  ? ((currentPrice - entry) / entry) * 100 * (t.side === "buy" ? 1 : -1)
                  : null;
                const daysHeld = Math.round(
                  (Date.now() - new Date(String(t.created_at)).getTime()) / 86400_000
                );
                return {
                  id: t.id,
                  asset: t.asset,
                  side: t.side,
                  instrument: t.instrument ?? "stock",
                  entry_price: entry,
                  current_price: currentPrice,
                  pnl_pct: pnlPct,
                  stop_loss_pct: t.stop_loss_pct ?? 7,
                  take_profit_pct: t.take_profit_pct ?? 15,
                  hold_duration: t.hold_duration,
                  days_held: daysHeld,
                  original_rationale: (String(t.rationale ?? "")).slice(0, 200),
                };
              })
            );

            // Ask Claude to review each position
            const systemPrompt = `You are a portfolio manager doing a Friday end-of-week position review. For each open position, provide a brief status update: is the original thesis still valid? Should we hold through the weekend, trim at Monday open, or watch for a specific trigger? Be honest if a position is not working. Keep each review to 1-2 sentences. Be specific about what to watch.

Respond with ONLY valid JSON — no prose, no markdown fences:
{
  "overall_summary": "1-2 sentence overall portfolio health summary",
  "positions": [
    {
      "asset": "NVDA",
      "status": "hold" | "watch" | "trim",
      "note": "1-2 sentence review"
    }
  ]
}`;

            const userMsg = JSON.stringify({
              positions: positionSummaries,
              market_note: "This is a Friday EOD review. Markets are closing. Weekend is 2 days.",
            });

            const ai = await callGateway(systemPrompt, userMsg);
            if (!ai) continue;

            // Build message content
            const parsed = ai as unknown as {
              overall_summary?: string;
              positions?: Array<{ asset: string; status: string; note: string }>;
            };

            const statusEmoji = { hold: "✅", watch: "👀", trim: "✂️" };
            let content = `📋 **Friday Position Review** — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}\n\n`;
            if (parsed.overall_summary) {
              content += `${parsed.overall_summary}\n\n`;
            }
            for (const pos of parsed.positions ?? []) {
              const emoji = statusEmoji[pos.status as keyof typeof statusEmoji] ?? "○";
              content += `${emoji} **${pos.asset}** (${pos.status.toUpperCase()}): ${pos.note}\n`;
            }
            if ((parsed.positions ?? []).length === 0) {
              content += "No open swing/position trades to review.";
            }

            await supabaseAdmin.from("agent_messages").insert({
              user_id: userId,
              role: "assistant",
              is_autonomous: true,
              session_type: "friday_review",
              content,
            });

            reviewed++;
          } catch (e) {
            console.error("[friday-review] user", userId, e);
          }
        }

        return Response.json({ ok: true, reviewed });
      },
    },
  },
});
