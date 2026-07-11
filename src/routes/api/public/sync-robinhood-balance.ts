import { createFileRoute } from "@tanstack/react-router";
import { getValidToken } from "@/lib/robinhood-live";

/**
 * Syncs the Robinhood Agentic account balance and open positions to the
 * paper portfolio. Runs daily at 9:15am ET (before morning scan).
 *
 * When execution_mode = 'live', the real account and paper portfolio must
 * stay in lockstep so the equity curve and P&L reflect reality.
 *
 * POST /api/public/sync-robinhood-balance
 * Auth: apikey header
 */

const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";

async function mcpToolCall(
  accessToken: string,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  // Initialize session
  const initRes = await fetch(ROBINHOOD_MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "balance-sync", version: "1.0" } },
    }),
  });
  const sessionId = initRes.headers.get("mcp-session-id");

  const callRes = await fetch(ROBINHOOD_MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  const ct = callRes.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const text = await callRes.text();
    const frames = text.split(/\n\n/).map((c) => {
      const l = c.split("\n").find((x) => x.startsWith("data:"));
      return l ? l.slice(5).trim() : "";
    }).filter(Boolean);
    for (const f of frames) {
      try {
        const j = JSON.parse(f) as { id?: number; result?: unknown };
        if (j.id === 2) return j.result;
      } catch { /* skip */ }
    }
    return null;
  }
  const j = (await callRes.json()) as { result?: unknown };
  return j.result ?? null;
}

function extractNumber(text: string, pattern: RegExp): number | null {
  const m = text.match(pattern);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

export const Route = createFileRoute("/api/public/sync-robinhood-balance")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Only sync users in live execution mode
        const { data: liveUsers } = await supabaseAdmin
          .from("user_settings")
          .select("user_id")
          .eq("autonomous_mode", true)
          .eq("autonomous_execution_mode", "live");

        if (!liveUsers || liveUsers.length === 0) {
          return Response.json({ ok: true, synced: 0, reason: "no_live_users" });
        }

        let synced = 0;
        const errors: string[] = [];

        for (const { user_id: userId } of liveUsers) {
          try {
            const token = await getValidToken(supabaseAdmin, userId);
            if (!token) {
              errors.push(`${userId}: no valid token`);
              continue;
            }

            // Try to get buying power / account info
            const result = await mcpToolCall(token, "get_account_info", {});
            if (!result) {
              errors.push(`${userId}: MCP call returned null`);
              continue;
            }

            const text = JSON.stringify(result);

            // Extract buying power / cash balance from MCP response text
            const buyingPower = extractNumber(text, /buying.power[:\s$]*([0-9,]+\.?[0-9]*)/i)
              ?? extractNumber(text, /cash[:\s$]*([0-9,]+\.?[0-9]*)/i)
              ?? extractNumber(text, /available[:\s$]*([0-9,]+\.?[0-9]*)/i);

            const portfolioValue = extractNumber(text, /portfolio.value[:\s$]*([0-9,]+\.?[0-9]*)/i)
              ?? extractNumber(text, /account.value[:\s$]*([0-9,]+\.?[0-9]*)/i)
              ?? extractNumber(text, /total.value[:\s$]*([0-9,]+\.?[0-9]*)/i);

            if (!buyingPower && !portfolioValue) {
              errors.push(`${userId}: could not parse balance from MCP response`);
              continue;
            }

            // Update paper portfolio to match real account
            const { data: portfolio } = await supabaseAdmin
              .from("paper_portfolios")
              .select("id, balance, equity")
              .eq("user_id", userId)
              .maybeSingle();

            if (!portfolio) continue;

            const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
            if (buyingPower != null) updates.balance = buyingPower;
            if (portfolioValue != null) updates.equity = portfolioValue;

            await supabaseAdmin
              .from("paper_portfolios")
              .update(updates)
              .eq("id", portfolio.id);

            // Post sync notification
            await supabaseAdmin.from("agent_messages").insert({
              user_id: userId,
              role: "assistant",
              is_autonomous: true,
              session_type: "balance_sync",
              content: `🔄 Robinhood balance synced: ${portfolioValue != null ? `Portfolio $${portfolioValue.toLocaleString()}` : ""} ${buyingPower != null ? `· Cash $${buyingPower.toLocaleString()}` : ""} — paper portfolio updated to match live account.`,
            });

            synced++;
          } catch (e) {
            errors.push(`${userId}: ${String(e)}`);
          }
        }

        return Response.json({
          ok: true, synced,
          errors: errors.length > 0 ? errors : undefined,
          ts: new Date().toISOString(),
        });
      },
    },
  },
});
