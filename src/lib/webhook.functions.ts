/**
 * Server-only webhook dispatcher. Best-effort — never throws.
 * Used by cron/eval loops to notify user endpoints of trade events.
 */
export async function fireWebhook(
  userId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("user_webhooks")
      .select("webhook_url, events, active")
      .eq("user_id", userId)
      .eq("active", true)
      .maybeSingle();
    if (!data || !data.webhook_url) return;
    const events = Array.isArray(data.events) ? data.events : [];
    if (!events.includes(event)) return;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 5000);
    try {
      await fetch(data.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, ts: new Date().toISOString(), ...payload }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(to);
    }
  } catch {
    /* best-effort */
  }
}
