import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PositionSchema = z.object({
  asset: z.string(),
  asset_type: z.enum(["stock", "crypto"]),
  shares: z.number(),
  cost_basis: z.number(),
  price: z.number().nullable(),
  value: z.number().nullable(),
  pnl: z.number().nullable(),
  pnl_pct: z.number().nullable(),
});

export type CommentaryResult =
  | { ok: true; commentary: string; risks: string[]; opportunities: string[]; rebalance: string[] }
  | { ok: false; reason: string };

export const getPortfolioCommentary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { positions: unknown }) =>
    z.object({ positions: z.array(PositionSchema).max(50) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<CommentaryResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { ok: false, reason: "missing_lovable_api_key" };

    // Gate to Pro
    const { data: hasProRow } = await context.supabase.rpc("has_tier", {
      _user_id: context.userId,
      _min: "pro",
    });
    if (!hasProRow) return { ok: false, reason: "requires_pro" };

    if (data.positions.length === 0) {
      return { ok: false, reason: "empty_portfolio" };
    }

    const totalValue = data.positions.reduce(
      (s, p) => s + (p.value ?? p.cost_basis * p.shares),
      0,
    );
    const summary = data.positions
      .map((p) => {
        const alloc = ((p.value ?? p.cost_basis * p.shares) / totalValue) * 100;
        return `${p.asset} (${p.asset_type}): ${p.shares} @ $${p.cost_basis}, now $${p.price ?? "?"}, P&L ${p.pnl_pct?.toFixed(2) ?? "?"}%, ${alloc.toFixed(1)}% of book`;
      })
      .join("\n");

    const system = `You are a portfolio analyst. Return STRICT JSON with keys:
{
  "commentary": "3-4 sentence overall read of the portfolio",
  "risks": ["short risk 1", "short risk 2"],
  "opportunities": ["short opportunity 1", ...],
  "rebalance": ["specific rebalancing suggestion 1", ...]
}
Rules: No markdown fences. Concise. Concrete. Reference tickers where relevant. Max 3 items per list.`;

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": apiKey,
          "X-Lovable-AIG-SDK": "direct",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: `Portfolio (total ~$${totalValue.toFixed(2)}):\n${summary}\n\nReturn JSON only.`,
            },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) return { ok: false, reason: `ai_gateway_${res.status}` };
      const j = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = j.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(text) as {
        commentary?: string;
        risks?: string[];
        opportunities?: string[];
        rebalance?: string[];
      };
      return {
        ok: true,
        commentary: parsed.commentary ?? "",
        risks: (parsed.risks ?? []).slice(0, 3),
        opportunities: (parsed.opportunities ?? []).slice(0, 3),
        rebalance: (parsed.rebalance ?? []).slice(0, 3),
      };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "unknown_error" };
    }
  });
