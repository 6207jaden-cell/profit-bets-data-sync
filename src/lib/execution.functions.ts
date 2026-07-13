import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Quote = { symbol: string; price: number; source: string };

async function safeJson(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`http_${r.status}`);
  return (await r.json()) as Record<string, unknown>;
}

async function fetchQuote(symbol: string): Promise<Quote | null> {
  const poly = process.env.POLYGON_API_KEY;
  const fin = process.env.FINNHUB_API_KEY;
  const alpha = process.env.ALPHA_VANTAGE_API_KEY;
  const S = symbol.toUpperCase();
  try {
    if (poly) {
      const j = (await safeJson(`https://api.polygon.io/v2/aggs/ticker/${S}/prev?apiKey=${poly}`)) as { results?: Array<{ c: number }> };
      const c = j.results?.[0]?.c;
      if (c) return { symbol: S, price: c, source: "polygon" };
    }
  } catch { /* fall */ }
  try {
    if (fin) {
      const j = (await safeJson(`https://finnhub.io/api/v1/quote?symbol=${S}&token=${fin}`)) as { c?: number };
      if (j.c) return { symbol: S, price: j.c, source: "finnhub" };
    }
  } catch { /* fall */ }
  try {
    if (alpha) {
      const j = (await safeJson(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${S}&apikey=${alpha}`)) as { ["Global Quote"]?: Record<string, string> };
      const p = j["Global Quote"]?.["05. price"];
      if (p) return { symbol: S, price: Number(p), source: "alphavantage" };
    }
  } catch { /* fall */ }
  return null;
}

type ExecResult =
  | { ok: true; trade_id: string; price: number; quantity: number; source: string }
  | { ok: false; reason: string };

// Recompute portfolio equity = cash + Σ(qty × current price) across open positions.
// Falls back to entry_price for any symbol whose live quote fails.
async function recomputeEquity(
  supabase: any,
  portfolio: { id: string; balance: number | string },
): Promise<number> {
  const { data: opens } = await supabase
    .from("paper_trades")
    .select("asset,quantity,entry_price,side")
    .eq("portfolio_id", portfolio.id)
    .eq("is_open", true);
  const cash = Number(portfolio.balance);
  const trades = (opens ?? []) as Array<{ asset: string; quantity: number | string; entry_price: number | string; side: string }>;
  if (trades.length === 0) return cash;
  const symbols = Array.from(new Set(trades.map((t) => t.asset.toUpperCase())));
  const quotes = await Promise.all(symbols.map((s) => fetchQuote(s).catch(() => null)));
  const priceMap = new Map<string, number>();
  symbols.forEach((s, i) => { const q = quotes[i]; if (q) priceMap.set(s, q.price); });
  let positionsValue = 0;
  for (const t of trades) {
    const qty = Number(t.quantity);
    const entry = Number(t.entry_price);
    const px = priceMap.get(t.asset.toUpperCase()) ?? entry;
    positionsValue += qty * px;
  }
  return cash + positionsValue;
}

export const openPaperTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      asset: z.string().min(1).max(20),
      side: z.enum(["buy", "sell"]),
      allocation_pct: z.number().min(0.1).max(100).default(10),
      strategy_id: z.string().uuid().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ExecResult> => {
    const { supabase, userId } = context;

    // Portfolio
    const { data: portfolio } = await supabase
      .from("paper_portfolios").select("*").eq("user_id", userId).maybeSingle();
    if (!portfolio) return { ok: false, reason: "no_portfolio" };

    // Risk limits (defaults if none)
    const { data: limits } = await supabase
      .from("risk_limits").select("*").eq("user_id", userId).maybeSingle();
    const maxDailyLossPct = Number(limits?.max_daily_loss_pct ?? 5);
    const maxPositionPct = Number(limits?.max_position_pct ?? 10);
    const cooldown = Number(limits?.cooldown_seconds ?? 30);

    // Position size cap
    if (data.allocation_pct > maxPositionPct) {
      return { ok: false, reason: `position_too_large (max ${maxPositionPct}%)` };
    }

    // Cooldown
    const { data: lastExec } = await supabase
      .from("signals_executions").select("created_at")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (lastExec) {
      const since = (Date.now() - new Date(lastExec.created_at).getTime()) / 1000;
      if (since < cooldown) return { ok: false, reason: `cooldown_active (${Math.ceil(cooldown - since)}s)` };
    }

    // Daily loss
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const { data: todayTrades } = await supabase
      .from("paper_trades").select("pnl")
      .eq("user_id", userId).eq("is_open", false)
      .gte("closed_at", dayStart.toISOString());
    const dayPnl = (todayTrades ?? []).reduce((a, t) => a + Number(t.pnl ?? 0), 0);
    const start = Number(portfolio.starting_balance);
    if (start > 0 && (-dayPnl / start) * 100 >= maxDailyLossPct) {
      return { ok: false, reason: `daily_loss_cap_reached (${maxDailyLossPct}%)` };
    }

    // Quote
    const quote = await fetchQuote(data.asset);
    if (!quote) return { ok: false, reason: "quote_unavailable" };

    const cash = Number(portfolio.balance);
    const allocCash = (cash * data.allocation_pct) / 100;
    if (allocCash <= 0) return { ok: false, reason: "insufficient_cash" };
    const quantity = allocCash / quote.price;

    // Insert paper_trade (open)
    const { data: trade, error: tErr } = await supabase
      .from("paper_trades").insert({
        user_id: userId,
        portfolio_id: portfolio.id,
        strategy_id: data.strategy_id ?? null,
        asset: data.asset.toUpperCase(),
        side: data.side,
        quantity,
        entry_price: quote.price,
        is_open: true,
      }).select().single();
    if (tErr || !trade) return { ok: false, reason: tErr?.message ?? "insert_failed" };

    // Update portfolio cash (reserve)
    await supabase.from("paper_portfolios").update({
      balance: cash - allocCash,
      equity: cash, // equity recomputed on close
      updated_at: new Date().toISOString(),
    }).eq("id", portfolio.id);

    // Log execution
    await supabase.from("signals_executions").insert({
      user_id: userId,
      strategy_id: data.strategy_id ?? null,
      execution_type: "paper",
      status: "filled",
      asset: data.asset.toUpperCase(),
      side: data.side,
      quantity,
      price: quote.price,
      reason: `manual_open via ${quote.source}`,
    });

    return { ok: true, trade_id: trade.id, price: quote.price, quantity, source: quote.source };
  });

export const closePaperTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ trade_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<ExecResult> => {
    const { supabase, userId } = context;
    const { data: trade } = await supabase
      .from("paper_trades").select("*").eq("id", data.trade_id).eq("user_id", userId).maybeSingle();
    if (!trade || !trade.is_open) return { ok: false, reason: "trade_not_open" };

    const { data: portfolio } = await supabase
      .from("paper_portfolios").select("*").eq("id", trade.portfolio_id).maybeSingle();
    if (!portfolio) return { ok: false, reason: "no_portfolio" };

    const quote = await fetchQuote(trade.asset);
    if (!quote) return { ok: false, reason: "quote_unavailable" };

    const qty = Number(trade.quantity);
    const entry = Number(trade.entry_price);
    const proceeds = qty * quote.price;
    const cost = qty * entry;
    const pnl = trade.side === "buy" ? proceeds - cost : cost - proceeds;

    await supabase.from("paper_trades").update({
      is_open: false,
      exit_price: quote.price,
      pnl,
      closed_at: new Date().toISOString(),
    }).eq("id", trade.id);

    const newCash = Number(portfolio.balance) + proceeds;
    await supabase.from("paper_portfolios").update({
      balance: newCash,
      equity: newCash,
      updated_at: new Date().toISOString(),
    }).eq("id", portfolio.id);

    await supabase.from("signals_executions").insert({
      user_id: userId,
      strategy_id: trade.strategy_id,
      execution_type: "paper",
      status: "filled",
      asset: trade.asset,
      side: trade.side === "buy" ? "sell" : "buy",
      quantity: qty,
      price: quote.price,
      reason: `close pnl=${pnl.toFixed(2)} via ${quote.source}`,
    });

    return { ok: true, trade_id: trade.id, price: quote.price, quantity: qty, source: quote.source };
  });

export const upsertRiskLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      max_daily_loss_pct: z.number().min(0.5).max(50),
      max_position_pct: z.number().min(1).max(100),
      max_sector_pct: z.number().min(5).max(100),
      cooldown_seconds: z.number().int().min(0).max(3600),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("risk_limits").select("id").eq("user_id", userId).maybeSingle();
    if (existing) {
      const { error } = await supabase.from("risk_limits")
        .update({ ...data, updated_at: new Date().toISOString() }).eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("risk_limits").insert({ user_id: userId, ...data });
      if (error) throw error;
    }
    return { ok: true };
  });
