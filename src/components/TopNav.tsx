import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { Activity, Brain, ShieldCheck, TrendingUp, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";

const items = [
  { to: "/markets", label: "Markets", icon: Activity },
  { to: "/trading", label: "AI Trading", icon: Brain },
] as const;

export function TopNav() {
  const { isAdmin, userId } = useProfile();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  const links = [
    ...items,
    ...(isAdmin ? [{ to: "/admin" as const, label: "Admin", icon: ShieldCheck }] : []),
  ];

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
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
          <button
            onClick={signOut}
            aria-label="Sign out"
            className="ml-auto shrink-0 flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
