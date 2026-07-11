import { createServerFn } from "@tanstack/react-start";
import { fetchBars } from "@/lib/indicators";

export type BarPoint = { t: number; close: number };

export const getHistoricalBars = createServerFn({ method: "POST" })
  .inputValidator((d: { symbol: string; days?: number }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; symbol: string; points: BarPoint[]; reason?: string }> => {
    const symbol = String(data.symbol).toUpperCase();
    const days = Math.min(365, Math.max(10, Number(data.days ?? 90)));
    const bars = await fetchBars(symbol, days);
    if (!bars || !bars.closes.length) return { ok: false, symbol, points: [], reason: "no_data" };
    const points: BarPoint[] = bars.closes.map((c, i) => ({ t: bars.timestamps?.[i] ?? Date.now() - (bars.closes.length - i) * 86400_000, close: Number(c) }));
    return { ok: true, symbol, points };
  });
