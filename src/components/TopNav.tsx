import { useState } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Brain, ShieldCheck, TrendingUp, LogOut, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const items = [
  { to: "/markets", label: "Markets", icon: Activity },
  { to: "/trading", label: "AI Trading", icon: Brain },
] as const;

export function TopNav() {
  const { isAdmin, userId } = useProfile();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

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
