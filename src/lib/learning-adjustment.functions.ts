import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Applies a natural-language learning adjustment to an active strategy.
 * Called when the user clicks "Apply this adjustment" on a weekly learning message.
 *
 * Uses AI to interpret the adjustment and modify the strategy's entry/exit conditions.
 */
export const applyLearningAdjustment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      strategy_id: z.string().uuid(),
      adjustment: z.string().min(1).max(500),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { ok: false, error: "missing_api_key" };

    // Load strategy
    const { data: strategy, error: sErr } = await supabase
      .from("strategies")
      .select("id, name, strategy_json, description")
      .eq("id", data.strategy_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (sErr || !strategy) return { ok: false, error: "strategy_not_found" };

    const sj = strategy.strategy_json as {
      entry: { conditions: string[]; logic: "AND" | "OR" };
      exit: { conditions: string[]; logic: "AND" | "OR" };
      universe?: string[];
      style?: string;
    };

    // Ask AI to apply the adjustment
    const prompt = `You are a quantitative strategy editor. Given an existing trading strategy and a performance insight, modify the strategy's entry and/or exit conditions to incorporate the insight.

CURRENT STRATEGY: "${strategy.name}"
Current entry conditions: ${JSON.stringify(sj.entry.conditions)} (logic: ${sj.entry.logic})
Current exit conditions: ${JSON.stringify(sj.exit.conditions)} (logic: ${sj.exit.logic})
Universe: ${JSON.stringify(sj.universe ?? [])}
Style: ${sj.style ?? "unknown"}

LEARNING INSIGHT TO APPLY: "${data.adjustment}"

Available condition tokens: RSI, RSI(14), SMA(20), SMA(50), SMA(200), EMA(12), EMA(26), price, prev_price, entry, macd_histogram, bb_pct_b, stoch_rsi_k, stoch_rsi_d
Available operators: <, >, <=, >=, ==, !=
Numeric literals are supported. Multiplication is supported (e.g. entry * 0.97).

RULES:
- Keep conditions simple and evaluable (no function calls, only the tokens above)
- Only modify what the insight suggests — don't change unrelated conditions
- Keep 2-5 entry conditions and 2-4 exit conditions
- Explain your change in one sentence

Respond ONLY with valid JSON (no markdown):
{
  "new_entry_conditions": ["condition1", "condition2"],
  "new_entry_logic": "AND",
  "new_exit_conditions": ["condition1", "condition2"],
  "new_exit_logic": "OR",
  "change_summary": "One sentence describing what changed and why"
}`;

    let text = "";
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": apiKey,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) return { ok: false, error: `gateway_${res.status}` };
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      text = j.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      return { ok: false, error: String(e) };
    }

    let parsed: {
      new_entry_conditions: string[];
      new_entry_logic: "AND" | "OR";
      new_exit_conditions: string[];
      new_exit_logic: "AND" | "OR";
      change_summary: string;
    };
    try {
      parsed = JSON.parse(text.replace(/```json\s*|\s*```/g, "").trim());
    } catch {
      return { ok: false, error: "parse_failed" };
    }

    // Validate the new conditions look reasonable
    if (!Array.isArray(parsed.new_entry_conditions) || parsed.new_entry_conditions.length === 0) {
      return { ok: false, error: "invalid_conditions" };
    }

    // Save a version snapshot before modifying (for version history)
    const versionNote = `Before applying: "${data.adjustment.slice(0, 100)}"`;
    try {
      await (supabase as any).from("strategy_versions").insert({
        strategy_id: strategy.id,
        user_id: userId,
        strategy_json: strategy.strategy_json,
        note: versionNote,
      });
    } catch { /* silent fail if table doesn't exist yet */ }

    // Apply the changes
    const newStrategyJson = {
      ...sj,
      entry: {
        conditions: parsed.new_entry_conditions,
        logic: parsed.new_entry_logic ?? sj.entry.logic,
      },
      exit: {
        conditions: parsed.new_exit_conditions,
        logic: parsed.new_exit_logic ?? sj.exit.logic,
      },
    };

    const { error: updateErr } = await supabase
      .from("strategies")
      .update({
        strategy_json: newStrategyJson as never,
        description: `${strategy.description ?? ""} [Auto-adjusted: ${parsed.change_summary}]`.slice(0, 500),
      })
      .eq("id", strategy.id)
      .eq("user_id", userId);

    if (updateErr) return { ok: false, error: updateErr.message };

    return {
      ok: true,
      strategy_name: strategy.name,
      change_summary: parsed.change_summary,
      new_entry_conditions: parsed.new_entry_conditions,
      new_exit_conditions: parsed.new_exit_conditions,
    };
  });
