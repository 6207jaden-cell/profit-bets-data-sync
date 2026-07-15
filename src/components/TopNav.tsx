import { useEffect, useRef, useState } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Brain, ShieldCheck, TrendingUp, LogOut, Bell, BellRing, Settings as SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const items = [
  { to: "/markets", label: "Markets", icon: Activity },
  { to: "/trading", label: "AI Trading", icon: Brain },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;


export function TopNav() {
  const { isAdmin, userId } = useProfile();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [pushPerm, setPushPerm] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  );
  const seenIds = useRef<Set<string>>(new Set());

  const links = [
    ...items,
    ...(isAdmin ? [{ to: "/admin" as const, label: "Admin", icon: ShieldCheck }] : []),
  ];

  const notifs = useQuery({
    queryKey: ["notifications", userId],
    enabled: !!userId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body, read, created_at")
        .order("created_at", { ascending: false }).limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });
  const unread = (notifs.data ?? []).filter((n) => !n.read).length;

  // Seed seenIds with existing notifications so we only alert on brand-new ones
  useEffect(() => {
    if (notifs.data) {
      for (const n of notifs.data) seenIds.current.add(n.id);
    }
  }, [notifs.data]);

  // Realtime subscription: toast + browser push on new notification
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as { id: string; title: string; body: string; type?: string };
          if (seenIds.current.has(n.id)) return;
          seenIds.current.add(n.id);
          // In-app toast
          const isClose = n.type === "trade_close" || /closed/i.test(n.title);
          const isAlert = n.type === "price_alert" || /alert/i.test(n.title);
          if (isClose) toast.success(n.title, { description: n.body, duration: 8000 });
          else if (isAlert) toast.warning(n.title, { description: n.body, duration: 8000 });
          else toast(n.title, { description: n.body, duration: 8000 });
          // Browser push
          if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            try {
              const notif = new Notification(n.title, { body: n.body, tag: n.id, icon: "/favicon.ico" });
              notif.onclick = () => { window.focus(); notif.close(); };
            } catch (e) { console.error("[push]", e); }
          }
          qc.invalidateQueries({ queryKey: ["notifications", userId] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, qc]);

  async function enablePush() {
    if (typeof window === "undefined" || !("Notification" in window) || typeof Notification.requestPermission !== "function") {
      toast.info("In-app alerts are on", {
        description: "Browser popups aren't supported on this device — you'll still see toasts and the bell badge in real time.",
      });
      setPushPerm("unsupported");
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      setPushPerm(perm);
      if (perm === "granted") {
        new Notification("Notifications enabled", { body: "You'll be alerted when the agent opens, closes, or an alert fires." });
        toast.success("Browser notifications enabled");
      } else {
        toast.error("Notifications blocked — enable in browser settings");
      }
    } catch {
      toast.info("In-app alerts are on", {
        description: "Browser popups aren't available here — toasts and the bell badge still update live.",
      });
      setPushPerm("unsupported");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  async function markAllRead() {
    if (!userId) return;
    await supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
    qc.invalidateQueries({ queryKey: ["notifications", userId] });
  }


  return (
    <div className="w-full border-b border-border bg-background/80 backdrop-blur sticky top-0 z-30">
      <div className="flex items-center gap-1 px-4 md:px-6 h-12 overflow-x-auto">
        <Link to="/markets" className="flex items-center gap-1.5 mr-3 shrink-0">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="font-display font-semibold text-sm">Markets</span>
        </Link>
        <nav className="flex items-center gap-1 flex-1">
          {links.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || pathname.startsWith(to + "/");
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-1.5 px-3 h-9 rounded-md text-sm whitespace-nowrap transition-colors",
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            );
          })}
        </nav>
        {userId && (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  aria-label="Notifications"
                  className="relative ml-auto shrink-0 flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <Bell className="h-4 w-4" />
                  {unread > 0 && (
                    <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-bear" />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="p-3 border-b border-border flex items-center justify-between">
                  <span className="font-display font-semibold text-sm">Notifications</span>
                  {unread > 0 && (
                    <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                      Mark all read
                    </button>
                  )}
                </div>
                {pushPerm === "default" && typeof window !== "undefined" && "Notification" in window && (
                  <div className="p-3 border-b border-border bg-primary/5 flex items-center justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <BellRing className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      <span className="text-[11px] text-muted-foreground">
                        Get browser popups when the agent trades or an alert fires.
                      </span>
                    </div>
                    <button onClick={enablePush} className="text-[11px] font-medium text-primary hover:underline shrink-0">
                      Enable
                    </button>
                  </div>
                )}

                {(notifs.data?.length ?? 0) === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    No notifications yet. Daily digests arrive after your first trading day.
                  </div>
                ) : (
                  <ul className="max-h-96 overflow-auto divide-y divide-border">
                    {notifs.data!.slice(0, 5).map((n) => {
                      const open = openId === n.id;
                      return (
                        <li key={n.id} className={cn("p-3 text-xs cursor-pointer hover:bg-muted/40", !n.read && "bg-primary/5")}>
                          <button onClick={() => setOpenId(open ? null : n.id)} className="w-full text-left">
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-medium text-foreground truncate">{n.title}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {new Date(n.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                              </span>
                            </div>
                            <p className={cn("text-muted-foreground mt-1", !open && "line-clamp-2")}>
                              {open ? n.body : n.body.slice(0, 100) + (n.body.length > 100 ? "…" : "")}
                            </p>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </PopoverContent>
            </Popover>
            <button
              onClick={signOut}
              aria-label="Sign out"
              className="shrink-0 flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
