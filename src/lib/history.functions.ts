import { createServerFn } from "@tanstack/react-start";
import { fetchBars } from "@/lib/indicators";

export type BarPoint = { t: number; close: number };

export const getHistoricalBars = createServerFn({ method: "POST" })
  .inputValidator((d: { symbol: string; days?: number }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; symbol: string; points: BarPoint[]; reason?: string }> => {
    const symbol = String(data.symbol).toUpperCase();
    const days = Math.min(365, Math.max(10, Number(data.days ?? 90)));
    // fetchBars requires enough history for indicator consumers to validate the
    // response. Fetch a wider window here, then trim it for chart consumers.
    const bars = await fetchBars(symbol, Math.max(90, days));
    if (!bars || !bars.closes.length) return { ok: false, symbol, points: [], reason: "no_data" };
    const cutoff = Date.now() - days * 86400_000;
    const allPoints: BarPoint[] = bars.closes.map((c, i) => ({
      t: bars.times?.[i] ?? Date.now() - (bars.closes.length - i) * 86400_000,
      close: Number(c),
    }));
    const trimmed = allPoints.filter((point) => point.t >= cutoff);
    const points = trimmed.length >= 2 ? trimmed : allPoints.slice(-Math.max(2, days));
    return { ok: true, symbol, points };
  });
