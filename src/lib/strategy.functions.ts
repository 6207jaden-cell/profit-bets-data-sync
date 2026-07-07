import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type StrategyJSON = {
  indicators: Array<{ name: string; params?: Record<string, number> }>;
  entry: { conditions: string[]; logic: "AND" | "OR" };
  exit: { conditions: string[]; logic: "AND" | "OR" };
  timeframes: string[];
  universe?: string[];
  notes?: string;
};

type GenerateResult =
  | { ok: true; name: string; description: string; strategy_json: StrategyJSON; market_type: "stocks" | "crypto" | "both"; risk_level: "low" | "medium" | "high" }
  | { ok: false; reason: string };

export const generateStrategyFromPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { prompt: string }) => {
    if (!input?.prompt || typeof input.prompt !== "string" || input.prompt.length < 4) {
      throw new Error("prompt_required");
    }
    return { prompt: input.prompt.slice(0, 800) };
  })
  .handler(async ({ data }): Promise<GenerateResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { ok: false, reason: "missing_lovable_api_key" };

    const systemPrompt = `You are a senior quantitative strategist. Convert the user's natural-language trading idea into a STRICT JSON specification.

Return JSON with this exact shape:
{
  "name": "short title (max 60 chars)",
  "description": "1-2 sentence summary",
  "market_type": "stocks" | "crypto" | "both",
  "risk_level": "low" | "medium" | "high",
  "strategy_json": {
    "indicators": [ { "name": "RSI"|"MACD"|"VWAP"|"SMA"|"EMA"|"BBANDS"|"ATR", "params": { ... } } ],
    "entry": { "conditions": ["RSI < 30", "price > SMA(50)"], "logic": "AND" },
    "exit":  { "conditions": ["RSI > 70", "price < entry * 0.97"], "logic": "OR" },
    "timeframes": ["1h", "1d"],
    "universe": ["AAPL","MSFT"],
    "notes": "optional context"
  }
}

Rules:
- conditions MUST be simple, evaluable strings using indicators above plus price/volume.
- Always include both entry and exit conditions.
- universe: 1-10 liquid tickers/symbols (e.g. BTC-USD for crypto).
- JSON ONLY. No prose, no markdown fences.`;

    let text = "";
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "direct" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: data.prompt },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (res.status === 429) return { ok: false, reason: "rate_limited" };
      if (res.status === 402) return { ok: false, reason: "credits_exhausted" };
      if (!res.ok) return { ok: false, reason: `gateway_${res.status}` };
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      text = j.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "gateway_fetch_failed" };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: "parse_failed" };
    }

    const sj = parsed.strategy_json as StrategyJSON | undefined;
    if (!sj || !sj.entry || !sj.exit || !Array.isArray(sj.indicators)) {
      return { ok: false, reason: "invalid_shape" };
    }

    const mt = String(parsed.market_type ?? "stocks");
    const rl = String(parsed.risk_level ?? "medium");
    return {
      ok: true,
      name: String(parsed.name ?? "Untitled Strategy").slice(0, 60),
      description: String(parsed.description ?? "").slice(0, 400),
      market_type: (["stocks", "crypto", "both"].includes(mt) ? mt : "stocks") as "stocks" | "crypto" | "both",
      risk_level: (["low", "medium", "high"].includes(rl) ? rl : "medium") as "low" | "medium" | "high",
      strategy_json: {
        indicators: sj.indicators.slice(0, 8),
        entry: { conditions: (sj.entry.conditions ?? []).slice(0, 8).map(String), logic: sj.entry.logic === "OR" ? "OR" : "AND" },
        exit:  { conditions: (sj.exit.conditions ?? []).slice(0, 8).map(String),  logic: sj.exit.logic  === "OR" ? "OR" : "AND" },
        timeframes: (sj.timeframes ?? ["1d"]).slice(0, 4).map(String),
        universe: (sj.universe ?? []).slice(0, 10).map((u) => String(u).toUpperCase()),
        notes: sj.notes ? String(sj.notes).slice(0, 400) : undefined,
      },
    };
  });

export const generateStrategyExplanation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { strategy_id: string }) => {
    if (!input?.strategy_id) throw new Error("strategy_id_required");
    return { strategy_id: String(input.strategy_id) };
  })
  .handler(async ({ data, context }): Promise<{ ok: true; explanation: string } | { ok: false; reason: string }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { ok: false, reason: "missing_lovable_api_key" };
    const { supabase } = context;
    const { data: strat, error } = await supabase
      .from("strategies").select("name, description, strategy_json").eq("id", data.strategy_id).maybeSingle();
    if (error || !strat) return { ok: false, reason: "strategy_not_found" };

    const systemPrompt = "You are a quantitative trading educator. Given a trading strategy's rules, write a clear 4-paragraph explanation: (1) What market inefficiency or pattern this strategy exploits, (2) Why the chosen indicators work together for this purpose, (3) What market conditions will cause this strategy to fail, (4) What a trader should watch for to know if the strategy is working as intended. Be specific, honest about risks, and avoid hype. Max 200 words total.";

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "direct" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify({ name: strat.name, description: strat.description, rules: strat.strategy_json }) },
          ],
        }),
      });
      if (res.status === 429) return { ok: false, reason: "rate_limited" };
      if (res.status === 402) return { ok: false, reason: "credits_exhausted" };
      if (!res.ok) return { ok: false, reason: `gateway_${res.status}` };
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const explanation = (j.choices?.[0]?.message?.content ?? "").trim();
      if (!explanation) return { ok: false, reason: "empty_response" };
      await supabase.from("strategies").update({ explanation }).eq("id", data.strategy_id);
      return { ok: true, explanation };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "gateway_failed" };
    }
  });
