import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Link2, Loader2, Radio, ShieldAlert, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BlurLock } from "@/features/markets/components/BlurLock";
import { useProfile } from "@/hooks/use-profile";
import {
  connectBroker, disconnectBroker, listBrokerConnections, placeLiveOrder,
} from "@/lib/broker.functions";

export function BrokerPanel() {
  const { tier } = useProfile();
  const isPremium = tier === "premium";
  const qc = useQueryClient();

  const list = useServerFn(listBrokerConnections);
  const connect = useServerFn(connectBroker);
  const disconnect = useServerFn(disconnectBroker);
  const order = useServerFn(placeLiveOrder);

  const conns = useQuery({
    queryKey: ["broker-connections"],
    queryFn: () => list(),
  });

  const [isLive, setIsLive] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState<number>(1);
  const [pending, setPending] = useState(false);

  const connectMut = useMutation({
    mutationFn: (payload: { provider: "alpaca" | "ibkr"; is_live: boolean }) =>
      connect({ data: payload }),
    onSuccess: (r) => {
      if ("ok" in r && r.ok) {
        toast.success(`Connected: ${r.account ?? "OK"}`);
        qc.invalidateQueries({ queryKey: ["broker-connections"] });
      } else {
        toast.error(`Failed: ${(r as { reason: string }).reason}`);
      }
    },
  });

  const disconnectMut = useMutation({
    mutationFn: (id: string) => disconnect({ data: { id } }),
    onSuccess: () => {
      toast.success("Disconnected");
      qc.invalidateQueries({ queryKey: ["broker-connections"] });
    },
  });

  async function submitLiveOrder() {
    if (!symbol || qty <= 0) return;
    setPending(false);
    try {
      const r = await order({
        data: { symbol, side, qty, type: "market", time_in_force: "day", confirm: true as const },
      });
      if (r.ok) {
        toast.success(`Live order placed: ${r.order_id} (${r.status})`);
        setSymbol(""); setQty(1);
      } else {
        toast.error(`Rejected: ${r.reason}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Order failed");
    }
  }

  return (
    <BlurLock active={!isPremium} label="Live broker requires Premium">
      <div className="space-y-6">
        <Card className="p-5 border-border bg-card">
          <header className="mb-4">
            <h3 className="font-display font-semibold flex items-center gap-2">
              <Link2 className="h-4 w-4 text-primary" /> Broker Connections
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Connect Alpaca to route live orders. Paper endpoint is safe for testing.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-display font-semibold">Alpaca</div>
                  <div className="text-xs text-muted-foreground">US equities &amp; crypto</div>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {isLive ? "LIVE ENDPOINT" : "PAPER ENDPOINT"}
                </Badge>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <Switch checked={isLive} onCheckedChange={setIsLive} id="alpaca-live" />
                <Label htmlFor="alpaca-live" className="text-xs">Use live endpoint</Label>
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={() => connectMut.mutate({ provider: "alpaca", is_live: isLive })}
                disabled={connectMut.isPending}
              >
                {connectMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Link2 className="h-3 w-3 mr-1" />}
                Connect Alpaca
              </Button>
            </div>

            <div className="rounded-lg border border-border p-4 opacity-70">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-display font-semibold">Interactive Brokers</div>
                  <div className="text-xs text-muted-foreground">Global multi-asset</div>
                </div>
                <Badge variant="outline" className="text-[10px]">COMING SOON</Badge>
              </div>
              <Button size="sm" className="w-full" disabled>Coming Soon</Button>
            </div>
          </div>

          <div className="space-y-2">
            {conns.isLoading && <div className="text-xs text-muted-foreground">Loading connections…</div>}
            {conns.data?.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-4">No broker connections yet.</div>
            )}
            {conns.data?.map((c) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between border border-border rounded-md px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  {c.connected ? <CheckCircle2 className="h-4 w-4 text-bull" /> : <ShieldAlert className="h-4 w-4 text-muted-foreground" />}
                  <div>
                    <div className="text-sm font-semibold">{c.account_label ?? c.provider}</div>
                    <div className="text-[10px] text-muted-foreground uppercase font-mono">
                      {c.provider} · {c.is_live ? "LIVE" : "PAPER"} · {c.connected ? "ACTIVE" : "DISCONNECTED"}
                    </div>
                  </div>
                </div>
                {c.connected && (
                  <Button size="sm" variant="ghost" onClick={() => disconnectMut.mutate(c.id)}>
                    <Unlink className="h-3 w-3 mr-1" /> Disconnect
                  </Button>
                )}
              </motion.div>
            ))}
          </div>
        </Card>

        <Card className="p-5 border-border bg-card">
          <header className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-display font-semibold flex items-center gap-2">
                <Radio className="h-4 w-4 text-bear" /> Live Order
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Sends a real market order via your connected LIVE broker. Requires explicit confirmation.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={liveEnabled} onCheckedChange={setLiveEnabled} id="live-enabled" />
              <Label htmlFor="live-enabled" className="text-xs">Live trading enabled</Label>
            </div>
          </header>

          {!liveEnabled ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground border border-dashed border-border rounded-md p-4">
              <AlertTriangle className="h-4 w-4 text-primary" />
              Toggle "Live trading enabled" to reveal the order form. Default state is OFF for safety.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <Label className="text-xs">Symbol</Label>
                <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="AAPL" />
              </div>
              <div>
                <Label className="text-xs">Side</Label>
                <div className="flex gap-1 mt-1">
                  <Button size="sm" variant={side === "buy" ? "default" : "outline"} onClick={() => setSide("buy")} className="flex-1">Buy</Button>
                  <Button size="sm" variant={side === "sell" ? "default" : "outline"} onClick={() => setSide("sell")} className="flex-1">Sell</Button>
                </div>
              </div>
              <div>
                <Label className="text-xs">Quantity</Label>
                <Input type="number" min={0.0001} step="any" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
              </div>
              <Button variant="destructive" onClick={() => setPending(true)} disabled={!symbol || qty <= 0}>
                Place LIVE Order
              </Button>
            </div>
          )}
        </Card>

        <AlertDialog open={pending} onOpenChange={setPending}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-bear" /> Confirm live order
              </AlertDialogTitle>
              <AlertDialogDescription>
                You are about to send a <span className="font-semibold uppercase">{side}</span> market order for{" "}
                <span className="font-mono">{qty}</span> {symbol} to your connected LIVE broker. This uses real money.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={submitLiveOrder}>Confirm &amp; Send</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </BlurLock>
  );
}
