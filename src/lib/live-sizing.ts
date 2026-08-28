/**
 * Percentage-based sizing for live Robinhood execution.
 *
 * The paper portfolio and the real Robinhood Agentic account hold different
 * amounts of money, so mirroring a paper trade's dollar notional into the live
 * account either massively over-spends or under-spends. Instead we mirror the
 * trade's *weight*: the percentage of paper equity a trade represents is
 * applied to the live account's portfolio value.
 *
 * The scaling math here is pure and unit-tested; the account lookup below is
 * server-only (never import this from client code).
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";


/** Robinhood rejects dust orders; anything under a dollar is not worth sending. */
export const MIN_LIVE_NOTIONAL = 1;

export type ScaleResult =
  | { ok: true; notional: number; pct: number; clamped: boolean }
  | { ok: false; reason: "invalid_equity" | "invalid_notional" | "below_min" | "no_buying_power" };

/**
 * Converts a paper-trade dollar notional into the equivalent live-account
 * notional at the same percentage of capital.
 *
 * @param paperNotional  dollars the paper trade used
 * @param paperEquity    total paper account equity at the time of the trade
 * @param liveEquity     live Robinhood portfolio value
 * @param buyingPowerLeft remaining live buying power for this scan
 */
export function scaleNotional(
  paperNotional: number,
  paperEquity: number,
  liveEquity: number,
  buyingPowerLeft: number,
  minNotional: number = MIN_LIVE_NOTIONAL,
): ScaleResult {
  if (!Number.isFinite(paperEquity) || paperEquity <= 0) return { ok: false, reason: "invalid_equity" };
  if (!Number.isFinite(liveEquity) || liveEquity <= 0) return { ok: false, reason: "invalid_equity" };
  if (!Number.isFinite(paperNotional) || paperNotional <= 0) return { ok: false, reason: "invalid_notional" };
  if (!Number.isFinite(buyingPowerLeft) || buyingPowerLeft < minNotional) return { ok: false, reason: "no_buying_power" };

  const pct = (paperNotional / paperEquity) * 100;
  const target = (pct / 100) * liveEquity;
  const clamped = target > buyingPowerLeft;
  const notional = Math.round((clamped ? buyingPowerLeft : target) * 100) / 100;
  if (notional < minNotional) return { ok: false, reason: "below_min" };
  return { ok: true, notional, pct, clamped };
}

/**
 * Fraction-based sell sizing: sell the same fraction of the live position that
 * the paper trade represents of the paper position, capped so the sold value
 * never exceeds the percentage-scaled notional.
 */
export function scaleSellQuantity(
  paperTradeQty: number,
  paperPositionQty: number,
  liveQty: number,
  scaledNotional: number,
  price: number,
): { ok: true; quantity: number } | { ok: false; reason: "no_live_position" | "invalid_inputs" | "below_min" } {
  if (!Number.isFinite(liveQty) || liveQty <= 0) return { ok: false, reason: "no_live_position" };
  if (!Number.isFinite(paperTradeQty) || paperTradeQty <= 0) return { ok: false, reason: "invalid_inputs" };
  if (!Number.isFinite(paperPositionQty) || paperPositionQty <= 0) return { ok: false, reason: "invalid_inputs" };

  const fraction = Math.min(1, paperTradeQty / paperPositionQty);
  let qty = liveQty * fraction;
  if (Number.isFinite(price) && price > 0 && Number.isFinite(scaledNotional) && scaledNotional > 0) {
    qty = Math.min(qty, scaledNotional / price);
  }
  qty = Math.floor(qty * 1e6) / 1e6;
  if (qty <= 0) return { ok: false, reason: "below_min" };
  return { ok: true, quantity: qty };
}

// ─── Live account lookup (server-only) ───────────────────────────────────────

export type LiveAccount = {
  portfolio_value: number;
  buying_power: number;
  source: "robinhood_mcp" | "snapshot";
};

/**
 * Reads the agentic account's real value via the Robinhood MCP tools.
 * Delegates to robinhood-live.ts, which resolves the agentic_allowed account
 * and calls get_portfolio — the previous implementation called a non-existent
 * "get_account_info" tool, so every live scan reported "live account value
 * could not be read" and skipped all real orders.
 */
async function mcpAccount(accessToken: string): Promise<LiveAccount | null> {
  const { fetchAgenticPortfolio } = await import("@/lib/robinhood-live");
  const p = await fetchAgenticPortfolio(accessToken);
  if (!p) return null;
  return {
    portfolio_value: p.total_value,
    buying_power: p.buying_power > 0 ? p.buying_power : p.total_value,
    source: "robinhood_mcp",
  };
}

/**
 * Resolves the live account's portfolio value and buying power, preferring a
 * fresh Robinhood MCP read and falling back to the latest recorded snapshot.
 * Returns null when neither is available — callers must then skip live orders
 * rather than guess a size.
 */
export async function resolveLiveAccount(
  supabaseAdmin: ReturnType<typeof createClient<Database>>,
  userId: string,
  accessToken: string | null,
): Promise<LiveAccount | null> {
  if (accessToken) {
    const live = await mcpAccount(accessToken);
    if (live) return live;
  }


  const { data: snap } = await (supabaseAdmin as never as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          order: (c: string, o: { ascending: boolean }) => {
            limit: (n: number) => { maybeSingle: () => Promise<{ data: { balance: number | null; buying_power: number | null } | null }> };
          };
        };
      };
    };
  }).from("robinhood_snapshots")
    .select("balance, buying_power")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const balance = Number(snap?.balance ?? 0);
  if (balance > 0) {
    const bp = Number(snap?.buying_power ?? 0);
    return { portfolio_value: balance, buying_power: bp > 0 ? bp : balance, source: "snapshot" };
  }
  return null;
}
