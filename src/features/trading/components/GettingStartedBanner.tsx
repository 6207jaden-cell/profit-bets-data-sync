import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Bot, Brain, FlaskConical, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Step = {
  icon: typeof Bot;
  title: string;
  description: string;
  action: string;
  tab: string;
  done?: boolean;
};

export function GettingStartedBanner({
  userId,
  onNavigate,
}: {
  userId: string | null | undefined;
  onNavigate: (tab: string) => void;
}) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("getting-started-dismissed") === "1"; } catch { return false; }
  });

  const { data: counts } = useQuery({
    queryKey: ["getting-started-counts", userId],
    enabled: !!userId && !dismissed,
    staleTime: 60_000,
    queryFn: async () => {
      const [{ count: strategies }, { count: trades }, { data: settings }] = await Promise.all([
        supabase.from("strategies").select("*", { count: "exact", head: true }).eq("user_id", userId!).eq("active", true),
        supabase.from("paper_trades").select("*", { count: "exact", head: true }).eq("user_id", userId!),
        supabase.from("user_settings").select("autonomous_mode").eq("user_id", userId!).maybeSingle(),
      ]);
      return {
        hasStrategy: (strategies ?? 0) > 0,
        hasTrade: (trades ?? 0) > 0,
        hasAutonomous: settings?.autonomous_mode === true,
      };
    },
  });

  // Only show if user is new (no trades yet)
  if (dismissed || counts?.hasTrade) return null;

  const steps: Step[] = [
    {
      icon: Bot,
      title: "Turn on the AI Agent",
      description: "Enable autonomous mode to let the agent scan markets and open paper trades automatically.",
      action: "Go to Agent tab",
      tab: "agent",
      done: counts?.hasAutonomous,
    },
    {
      icon: Brain,
      title: "Create your first strategy",
      description: "Describe a strategy in plain English — or pick a template. The AI Lab also generates them hourly.",
      action: "Go to Strategies",
      tab: "strategies",
      done: counts?.hasStrategy,
    },
    {
      icon: FlaskConical,
      title: "Run a backtest",
      description: "See how your strategy would have performed historically before trusting it with paper money.",
      action: "Go to Backtest",
      tab: "backtest",
      done: false,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;

  function dismiss() {
    try { localStorage.setItem("getting-started-dismissed", "1"); } catch { /* ignore */ }
    setDismissed(true);
  }

  return (
    <div className={cn(
      "rounded-xl border p-4 sm:p-5 relative",
      allDone
        ? "border-emerald-500/30 bg-emerald-950/20"
        : "border-primary/25 bg-primary/5"
    )}>
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground p-1 rounded"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">
            {allDone ? "🎉 You're all set!" : "Get started — 3 steps"}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {completedCount}/{steps.length} complete
          </span>
        </div>
        {!allDone && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Complete these steps to start paper trading with the AI agent.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <button
              key={i}
              onClick={() => !step.done && onNavigate(step.tab)}
              disabled={step.done}
              aria-disabled={step.done}
              tabIndex={step.done ? -1 : 0}
              className={cn(
                "text-left rounded-lg border p-3 transition-all group",
                step.done
                  ? "border-emerald-500/30 bg-emerald-950/30 opacity-60 cursor-not-allowed pointer-events-none"
                  : "border-border/60 bg-card hover:border-primary/40 hover:bg-primary/5 cursor-pointer"
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center shrink-0",
                  step.done ? "bg-emerald-500/20" : "bg-primary/10"
                )}>
                  {step.done
                    ? <span className="text-emerald-400 text-sm">✓</span>
                    : <Icon className="h-3.5 w-3.5 text-primary" />
                  }
                </div>
                <span className="text-[10px] text-muted-foreground mt-1">Step {i + 1}</span>
              </div>
              <div className="text-xs font-medium mb-1">{step.title}</div>
              <div className="text-[11px] text-muted-foreground leading-relaxed mb-2">
                {step.description}
              </div>
              {!step.done && (
                <div className="flex items-center gap-1 text-[11px] text-primary group-hover:gap-1.5 transition-all">
                  {step.action}
                  <ChevronRight className="h-3 w-3" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {allDone && (
        <button
          onClick={dismiss}
          className="mt-3 text-xs text-muted-foreground hover:text-foreground underline"
        >
          Dismiss this panel
        </button>
      )}
    </div>
  );
}
