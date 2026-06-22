import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Tier = "free" | "starter" | "pro" | "premium";
export const ALERT_LIMITS: Record<Tier, number> = { free: 3, starter: 10, pro: 20, premium: Infinity };

export function useProfile() {
  const [tier, setTier] = useState<Tier>("free");
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
      const { data: p } = await supabase.from("profiles").select("tier").eq("id", data.user.id).maybeSingle();
      if (!active) return;
      setTier(((p?.tier as Tier) ?? "free"));
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  return { tier, email, userId, loading, alertLimit: ALERT_LIMITS[tier] };
}
