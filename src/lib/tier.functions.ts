import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type Tier = "free" | "pro" | "elite";

export const getMyTier = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [tierRes, adminRes] = await Promise.all([
      context.supabase.from("user_tiers").select("tier").eq("user_id", context.userId).maybeSingle(),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    ]);
    return {
      tier: (tierRes.data?.tier as Tier) ?? "free",
      isAdmin: !!adminRes.data,
    };
  });

async function assertAdmin(context: { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export const listUserTiers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as never);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: tiers, error: tErr }, { data: authData, error: aErr }] = await Promise.all([
      supabaseAdmin.from("user_tiers").select("user_id, tier, updated_at, granted_by"),
      supabaseAdmin.auth.admin.listUsers({ perPage: 200 }),
    ]);
    if (tErr) throw new Error(tErr.message);
    if (aErr) throw new Error(aErr.message);

    const tierMap = new Map((tiers ?? []).map((t) => [t.user_id, t]));
    return authData.users.map((u) => {
      const t = tierMap.get(u.id);
      return {
        user_id: u.id,
        email: u.email ?? "",
        tier: (t?.tier as Tier) ?? "free",
        updated_at: t?.updated_at ?? u.created_at,
      };
    }).sort((a, b) => a.email.localeCompare(b.email));
  });

export const setUserTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      user_id: z.string().uuid(),
      tier: z.enum(["free", "pro", "elite"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_tiers")
      .upsert({ user_id: data.user_id, tier: data.tier, granted_by: context.userId, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
