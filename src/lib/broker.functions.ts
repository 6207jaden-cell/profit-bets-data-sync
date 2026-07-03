import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type BrokerProvider = "paper" | "alpaca" | "ibkr";

function alpacaBase(isLive: boolean): string {
  return isLive ? "https://api.alpaca.markets" : "https://paper-api.alpaca.markets";
}

function alpacaHeaders(): Record<string, string> | null {
  const key = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) return null;
  return {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
    "Content-Type": "application/json",
  };
}

export const listBrokerConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("broker_connections").select("*")
      .eq("user_id", context.userId).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const connectBroker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    provider: z.enum(["alpaca", "ibkr"]),
    is_live: z.boolean().default(false),
    account_label: z.string().max(60).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.provider === "ibkr") {
      return { ok: false as const, reason: "ibkr_coming_soon" };
    }
    const headers = alpacaHeaders();
    if (!headers) return { ok: false as const, reason: "alpaca_credentials_missing" };
    // Test with account endpoint
    const r = await fetch(`${alpacaBase(data.is_live)}/v2/account`, { headers });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false as const, reason: `alpaca_auth_failed: ${t.slice(0, 120)}` };
    }
    const acct = (await r.json()) as { account_number?: string; status?: string };
    const label = data.account_label ?? `Alpaca ${data.is_live ? "LIVE" : "Paper"} ${acct.account_number ?? ""}`.trim();

    // Upsert per (user, provider, is_live)
    const { data: existing } = await context.supabase
      .from("broker_connections").select("id")
      .eq("user_id", context.userId).eq("provider", "alpaca").eq("is_live", data.is_live).maybeSingle();
    if (existing) {
      await context.supabase.from("broker_connections").update({
        connected: true, account_label: label, updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      await context.supabase.from("broker_connections").insert({
        user_id: context.userId, provider: "alpaca", is_live: data.is_live, connected: true, account_label: label,
      });
    }
    return { ok: true as const, status: acct.status ?? "ACTIVE", account: acct.account_number ?? null };
  });

export const disconnectBroker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("broker_connections").update({ connected: false, updated_at: new Date().toISOString() })
      .eq("id", data.id).eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

type LiveOrderResult =
  | { ok: true; order_id: string; provider: BrokerProvider; status: string }
  | { ok: false; reason: string };

export const placeLiveOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    symbol: z.string().min(1).max(20),
    side: z.enum(["buy", "sell"]),
    qty: z.number().positive(),
    type: z.enum(["market", "limit"]).default("market"),
    limit_price: z.number().positive().optional(),
    time_in_force: z.enum(["day", "gtc"]).default("day"),
    confirm: z.literal(true),
  }).parse(d))
  .handler(async ({ data, context }): Promise<LiveOrderResult> => {
    // Premium gate
    const { data: profile } = await context.supabase
      .from("profiles").select("tier").eq("id", context.userId).maybeSingle();
    if (profile?.tier !== "premium") return { ok: false, reason: "premium_required" };

    // Active live connection required
    const { data: conn } = await context.supabase
      .from("broker_connections").select("*")
      .eq("user_id", context.userId).eq("provider", "alpaca").eq("is_live", true).eq("connected", true).maybeSingle();
    if (!conn) return { ok: false, reason: "no_live_broker_connected" };

    const headers = alpacaHeaders();
    if (!headers) return { ok: false, reason: "alpaca_credentials_missing" };

    const body: Record<string, unknown> = {
      symbol: data.symbol.toUpperCase(),
      qty: data.qty,
      side: data.side,
      type: data.type,
      time_in_force: data.time_in_force,
    };
    if (data.type === "limit" && data.limit_price) body.limit_price = data.limit_price;

    const r = await fetch(`${alpacaBase(true)}/v2/orders`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      await context.supabase.from("signals_executions").insert({
        user_id: context.userId, execution_type: "live", status: "rejected",
        asset: data.symbol.toUpperCase(), side: data.side, quantity: data.qty,
        reason: `alpaca_rejected: ${t.slice(0, 200)}`,
      });
      return { ok: false, reason: `alpaca_rejected: ${t.slice(0, 120)}` };
    }
    const order = (await r.json()) as { id: string; status: string; filled_avg_price?: string };
    await context.supabase.from("signals_executions").insert({
      user_id: context.userId, execution_type: "live", status: "filled",
      asset: data.symbol.toUpperCase(), side: data.side, quantity: data.qty,
      price: order.filled_avg_price ? Number(order.filled_avg_price) : null,
      reason: `alpaca_order ${order.id}`,
    });
    return { ok: true, order_id: order.id, provider: "alpaca", status: order.status };
  });
