import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Tier = "free" | "pro" | "elite";

export const TIER_LABEL: Record<Tier, string> = { free: "Free", pro: "Pro", elite: "Elite" };
export const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, elite: 2 };
export const ALERT_LIMITS: Record<Tier, number> = { free: 3, pro: 20, elite: Infinity };

export function useProfile() {
  const [tier, setTier] = useState<Tier>("free");
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!active || !data.user) { setLoading(false); return; }
      setUserId(data.user.id);
      setEmail(data.user.email ?? "");

      const [tierRes, adminRes] = await Promise.all([
        supabase.from("user_tiers").select("tier").eq("user_id", data.user.id).maybeSingle(),
        supabase.rpc("has_role", { _user_id: data.user.id, _role: "admin" }),
      ]);
      if (!active) return;
      setTier((tierRes.data?.tier as Tier) ?? "free");
      setIsAdmin(!!adminRes.data);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const hasPro = TIER_RANK[tier] >= TIER_RANK.pro;
  const hasElite = TIER_RANK[tier] >= TIER_RANK.elite;

  return {
    tier,
    tierLabel: TIER_LABEL[tier],
    email,
    userId,
    loading,
    hasPro,
    hasElite,
    isAdmin,
    alertLimit: ALERT_LIMITS[tier],
  };
}
