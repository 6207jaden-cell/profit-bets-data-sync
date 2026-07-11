/**
 * Agent memory — persists key facts between autonomous scan sessions.
 * The agent saves observations after each run and loads relevant ones at the
 * start of each scan. Memories decay in relevance over time via daily cron.
 *
 * Server-side only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;

export type Memory = {
  id: string;
  symbol: string | null;
  memory_type: string;
  content: string;
  relevance: number;
  created_at: string;
};

/**
 * Load the most relevant memories for the current scan.
 * Returns a formatted string ready to inject into the Claude prompt.
 */
export async function loadRelevantMemories(
  db: DB,
  userId: string,
  symbols: string[],
  maxTotal = 20,
): Promise<string> {
  const dbAny = db as unknown as SupabaseClient;
  // Load symbol-specific memories for symbols in this scan
  const { data: symbolMems } = symbols.length > 0
    ? await dbAny
        .from("agent_memory")
        .select("id, symbol, memory_type, content, relevance, created_at")
        .eq("user_id", userId)
        .in("symbol", symbols)
        .gt("relevance", 0.2)
        .order("relevance", { ascending: false })
        .limit(Math.ceil(maxTotal * 0.6))
    : { data: [] as unknown[] };

  // Load global memories (no symbol)
  const { data: globalMems } = await dbAny
    .from("agent_memory")
    .select("id, symbol, memory_type, content, relevance, created_at")
    .eq("user_id", userId)
    .is("symbol", null)
    .gt("relevance", 0.3)
    .order("relevance", { ascending: false })
    .limit(Math.ceil(maxTotal * 0.4));

  const all = [...(symbolMems ?? []), ...(globalMems ?? [])] as Memory[];
  if (all.length === 0) return "No prior memories.";

  return all
    .map((m) => {
      const sym = m.symbol ? `[${m.symbol}] ` : "[GLOBAL] ";
      const age = Math.round((Date.now() - new Date(m.created_at).getTime()) / 86400_000);
      return `${sym}${m.content} (${age}d ago, relevance ${m.relevance.toFixed(2)})`;
    })
    .join("\n");
}

/**
 * Save new memories after a scan run.
 * Called after Claude returns its response and trades are executed.
 */
export async function saveMemories(
  db: DB,
  userId: string,
  memories: Array<{
    symbol?: string | null;
    memory_type: "trade_outcome" | "market_observation" | "strategy_note" | "sector_note";
    content: string;
    expires_days?: number;
  }>,
): Promise<void> {
  if (memories.length === 0) return;
  const rows = memories.map((m) => ({
    user_id: userId,
    symbol: m.symbol ?? null,
    memory_type: m.memory_type,
    content: m.content,
    relevance: 1.0,
    expires_at: m.expires_days
      ? new Date(Date.now() + m.expires_days * 86400_000).toISOString()
      : null,
  }));
  await db.from("agent_memory").insert(rows);
}

/**
 * Save memories derived from closed trades.
 * Called at the end of weekly learning to record what the agent learned.
 */
export async function saveTradeOutcomeMemory(
  db: DB,
  userId: string,
  trade: {
    asset: string;
    side: string;
    instrument: string | null;
    entry_price: number;
    exit_price: number;
    pnl_pct: number;
    hold_duration: string | null;
    rationale: string | null;
  },
): Promise<void> {
  const outcome = trade.pnl_pct >= 0 ? "winner" : "loser";
  const sign = trade.pnl_pct >= 0 ? "+" : "";
  const content = `${trade.asset} ${trade.instrument ?? "stock"} ${trade.side} was a ${outcome} (${sign}${trade.pnl_pct.toFixed(1)}% over ${trade.hold_duration ?? "unknown"} hold). Entry: $${trade.entry_price.toFixed(2)}, Exit: $${trade.exit_price.toFixed(2)}. Original rationale: ${(trade.rationale ?? "none").slice(0, 200)}`;

  await saveMemories(db, userId, [{
    symbol: trade.asset,
    memory_type: "trade_outcome",
    content,
    expires_days: 60, // Trade outcomes expire after 60 days
  }]);
}

/**
 * Build the memory prompt section to inject into Claude's user message.
 */
export function buildMemorySection(memories: string): string {
  return `\n\nAGENT MEMORY (facts from previous sessions — use to inform decisions):\n${memories}`;
}
