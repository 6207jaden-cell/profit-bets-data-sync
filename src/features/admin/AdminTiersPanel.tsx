import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldCheck, Crown, Sparkles, User as UserIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listUserTiers, setUserTier } from "@/lib/tier.functions";

const TIERS = ["free", "pro", "elite"] as const;
type Tier = (typeof TIERS)[number];

const TIER_META: Record<Tier, { label: string; icon: typeof UserIcon; className: string }> = {
  free: { label: "Free", icon: UserIcon, className: "bg-muted text-muted-foreground" },
  pro: { label: "Pro", icon: Sparkles, className: "bg-primary/15 text-primary" },
  elite: { label: "Elite", icon: Crown, className: "bg-amber-500/15 text-amber-500" },
};

export function AdminTiersPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listUserTiers);
  const setFn = useServerFn(setUserTier);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  const users = useQuery({ queryKey: ["admin-tiers"], queryFn: () => listFn() });

  const mutate = useMutation({
    mutationFn: (v: { user_id: string; tier: Tier }) => setFn({ data: v }),
    onMutate: (v) => setBusyUser(v.user_id),
    onSettled: () => {
      setBusyUser(null);
      qc.invalidateQueries({ queryKey: ["admin-tiers"] });
    },
  });

  return (
    <div className="space-y-6">
      <Card className="p-6 bg-card border-border">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold">Membership Admin</h2>
            <p className="text-sm text-muted-foreground">Grant or revoke Pro / Elite access for any user.</p>
          </div>
        </div>
      </Card>

      <Card className="bg-card border-border overflow-hidden">
        {users.isLoading ? (
          <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : users.error ? (
          <div className="p-6 text-sm text-bear">Failed to load users: {(users.error as Error).message}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Current</th>
                <th className="text-right px-4 py-3 font-medium">Set tier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(users.data ?? []).map((u) => {
                const meta = TIER_META[u.tier as Tier];
                const Icon = meta.icon;
                const busy = busyUser === u.user_id;
                return (
                  <tr key={u.user_id}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.email || "(no email)"}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{u.user_id.slice(0, 8)}…</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={cn("gap-1", meta.className)}>
                        <Icon className="h-3 w-3" /> {meta.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {TIERS.map((t) => (
                          <Button
                            key={t}
                            size="sm"
                            variant={u.tier === t ? "default" : "outline"}
                            disabled={busy || u.tier === t}
                            onClick={() => mutate.mutate({ user_id: u.user_id, tier: t })}
                            className="h-7 px-2.5 text-xs capitalize"
                          >
                            {busy && u.tier !== t ? <Loader2 className="h-3 w-3 animate-spin" /> : t}
                          </Button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
