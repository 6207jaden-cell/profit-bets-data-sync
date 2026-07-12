import { createFileRoute } from "@tanstack/react-router";
import { buildContext, detectMarketRegime, fetchBars, fetchQuotePrice, isMarketOpen } from "@/lib/indicators";
import { getValidToken, placeLiveBuy, placeLiveSell } from "@/lib/robinhood-live";
import { resolveOptionsContract, formatContractSummary } from "@/lib/options-chain";
import { loadRelevantMemories, saveMemories, buildMemorySection } from "@/lib/agent-memory";
import { fireWebhook } from "@/lib/webhook.functions";
import { scanCatalystsInternal } from "@/lib/catalysts.functions";

const UNIVERSE = {
  large_cap: ["AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","JPM","V","XOM","WMT","JNJ","HD","BAC","PG","DIS","NFLX","AMD","CRM","UBER","ORCL","ADBE","INTC","QCOM","MU","NOW","SNOW","SHOP"],
  small_mid_cap: ["PLTR","SOFI","RIVN","HOOD","COIN","RBLX","SNAP","LYFT","ABNB","ROKU","DKNG","OPEN","IONQ","SMCI","MSTR","SOUN","BBAI","ACHR","JOBY","LUNR","RKLB","DNA","ARQT","HIMS","RXRX"],
  etfs: ["SPY","QQQ","IWM","GLD","TLT","XLF","XLK","XLE","ARKK","SOXL","TQQQ","LABU","FNGU","MIDU","UDOW"],
  crypto: ["BTC-USD","ETH-USD","SOL-USD","AVAX-USD","LINK-USD","DOT-USD","MATIC-USD"],
};
const ALL_SYMBOLS = [
  ...UNIVERSE.large_cap, ...UNIVERSE.small_mid_cap, ...UNIVERSE.etfs, ...UNIVERSE.crypto,
];

const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  max_position_pct: 20,   // lowered from 35 → allows more concurrent positions
  min_cash_pct: 15,        // lowered from 20 → more deployable capital
  stop_loss_pct: 6,
  take_profit_pct: 12,
  extra_symbols: [],
};

const SECTOR: Record<string, string> = {
  AAPL:"tech",MSFT:"tech",NVDA:"tech",GOOGL:"tech",AMZN:"tech",META:"tech",TSLA:"tech",
  AMD:"tech",CRM:"tech",NFLX:"tech",PLTR:"tech",SMCI:"tech",IONQ:"tech",MSTR:"tech",
  JPM:"finance",V:"finance",BAC:"finance",SOFI:"finance",HOOD:"finance",COIN:"finance",
  XOM:"energy",XLE:"energy",WMT:"consumer",JNJ:"health",HD:"consumer",PG:"consumer",
  DIS:"consumer",UBER:"consumer",LYFT:"consumer",ABNB:"consumer",RBLX:"consumer",
  SNAP:"consumer",ROKU:"consumer",DKNG:"consumer",OPEN:"consumer",RIVN:"consumer",
};

type AgentSettings = {
  max_position_pct: number;
  min_cash_pct: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  extra_symbols: string[];
};

type AiTrade = {
  symbol: string;
  direction: "long" | "short";
  instrument: string;
  conviction: number;
  allocation_pct: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  hold_duration: "intraday" | "swing" | "position";
  rationale: string;
  options_details?: unknown;
};
type AiResponse = {
  market_assessment: string;
  regime: string;
  cash_deployment_pct: number;
  trades: AiTrade[];
  message_to_user: string;
};

type UserRow = {
  user_id: string;
  autonomous_execution_mode: string | null;
  agent_settings: unknown;
  autonomous_paused_until: string | null;
};

function parseSettings(raw: unknown): AgentSettings {
  const s = (raw ?? {}) as Partial<AgentSettings>;
  return {
    max_position_pct: clamp(Number(s.max_position_pct ?? DEFAULT_AGENT_SETTINGS.max_position_pct), 5, 50),
    min_cash_pct: clamp(Number(s.min_cash_pct ?? DEFAULT_AGENT_SETTINGS.min_cash_pct), 10, 50),
    stop_loss_pct: clamp(Number(s.stop_loss_pct ?? DEFAULT_AGENT_SETTINGS.stop_loss_pct), 2, 15),
    take_profit_pct: clamp(Number(s.take_profit_pct ?? DEFAULT_AGENT_SETTINGS.take_profit_pct), 5, 30),
    extra_symbols: Array.isArray(s.extra_symbols) ? (s.extra_symbols as string[]).map((x) => String(x).toUpperCase()).slice(0, 20) : [],
  };
}
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export const Route = createFileRoute("/api/public/autonomous-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }
        const body = (await request.json().catch(() => ({}))) as { session?: string };
        const session: "morning" | "midday" | "weekend_prep" =
          body.session === "midday" ? "midday"
          : body.session === "weekend_prep" ? "weekend_prep"
          : "morning";
        const sessionType = session === "midday" ? "midday_scan"
          : session === "weekend_prep" ? "weekend_prep"
          : "morning_scan";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Auto-clear expired pauses so they take effect on next run.
        await supabaseAdmin
          .from("user_settings")
          .update({ autonomous_paused_until: null })
          .not("autonomous_paused_until", "is", null)
          .lt("autonomous_paused_until", new Date().toISOString());

        const { data: rawUsers } = await supabaseAdmin
          .from("user_settings")
          .select("user_id, autonomous_execution_mode, agent_settings, autonomous_paused_until")
          .eq("autonomous_mode", true);
        const activeUsers = (rawUsers ?? []) as UserRow[];
        // Skip users whose pause is still in the future.
        const eligibleUsers = activeUsers.filter((u) => {
          if (!u.autonomous_paused_until) return true;
          return new Date(u.autonomous_paused_until).getTime() <= Date.now();
        });
        if (eligibleUsers.length === 0) {
          return Response.json({ ok: true, reason: "no_eligible_users", paused: activeUsers.length - eligibleUsers.length });
        }

        const marketOpen = isMarketOpen();
        // SPY regime + returns for relative strength calculation
        const spyBars = await fetchBars("SPY", 220);
        const regime = spyBars ? detectMarketRegime(spyBars.closes) : "sideways";
        const spy5dReturn = spyBars && spyBars.closes.length >= 6
          ? ((spyBars.closes[spyBars.closes.length - 1] - spyBars.closes[spyBars.closes.length - 6]) / spyBars.closes[spyBars.closes.length - 6]) * 100
          : 0;
        const spy20dReturn = spyBars && spyBars.closes.length >= 21
          ? ((spyBars.closes[spyBars.closes.length - 1] - spyBars.closes[spyBars.closes.length - 21]) / spyBars.closes[spyBars.closes.length - 21]) * 100
          : 0;
        let vixLevel: number | null = null;
        let fearGreedValue: number | null = null;
        let fearGreedLabel = "Unknown";
        try {
          const finKey = process.env.FINNHUB_API_KEY;
          if (finKey) {
            const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=VIX&token=${finKey}`);
            if (r.ok) { const j = (await r.json()) as { c?: number }; vixLevel = j.c ?? null; }
          }
        } catch { /* ignore */ }
        // Fear & Greed Index (keyless, from alternative.me)
        try {
          const fgr = await fetch("https://api.alternative.me/fng/?limit=1");
          if (fgr.ok) {
            const fgj = (await fgr.json()) as { data?: Array<{ value: string; value_classification: string }> };
            const d = fgj.data?.[0];
            if (d) { fearGreedValue = Number(d.value); fearGreedLabel = d.value_classification; }
          }
        } catch { /* ignore */ }

        // Macro overlay: 10Y Treasury yield, DXY, and yield curve shape
        // These are the top macro factors driving stocks and crypto
        let tenYearYield: number | null = null;
        let twoYearYield: number | null = null;
        let dxyLevel: number | null = null;
        let yieldCurveShape = "unknown";
        try {
          const finKey = process.env.FINNHUB_API_KEY;
          if (finKey) {
            // 10Y Treasury yield via Finnhub (symbol: ^TNX or US10Y)
            // DXY (dollar index) via Finnhub
            const [r10y, r2y, rdxy] = await Promise.all([
              fetch(`https://finnhub.io/api/v1/quote?symbol=US10Y&token=${finKey}`),
              fetch(`https://finnhub.io/api/v1/quote?symbol=US02Y&token=${finKey}`),
              fetch(`https://finnhub.io/api/v1/quote?symbol=DXY&token=${finKey}`),
            ]);
            if (r10y.ok) { const j = (await r10y.json()) as { c?: number }; tenYearYield = j.c ?? null; }
            if (r2y.ok) { const j = (await r2y.json()) as { c?: number }; twoYearYield = j.c ?? null; }
            if (rdxy.ok) { const j = (await rdxy.json()) as { c?: number }; dxyLevel = j.c ?? null; }
          }
        } catch { /* ignore */ }
        // Fallback: try alternative symbols if Finnhub doesn't have them
        if (!tenYearYield) {
          try {
            const r = await fetch("https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&limit=1&sort_order=desc&api_key=demo&file_type=json");
            if (r.ok) {
              const j = (await r.json()) as { observations?: Array<{ value: string }> };
              const v = j.observations?.[0]?.value;
              if (v && v !== ".") tenYearYield = Number(v);
            }
          } catch { /* ignore */ }
        }
        if (tenYearYield && twoYearYield) {
          const spread = tenYearYield - twoYearYield;
          yieldCurveShape = spread > 0.5 ? "normal_steep" : spread > 0 ? "normal_flat" : "inverted";
        }
        const macroContext = [
          tenYearYield != null ? `10Y yield: ${tenYearYield.toFixed(2)}%` : null,
          twoYearYield != null ? `2Y yield: ${twoYearYield.toFixed(2)}%` : null,
          yieldCurveShape !== "unknown" ? `curve: ${yieldCurveShape}` : null,
          dxyLevel != null ? `DXY: ${dxyLevel.toFixed(1)}` : null,
        ].filter(Boolean).join(", ") || "macro data unavailable";

        // Dynamic universe: augment with top news catalysts (symbol format A-Z + optional -USD).
        const catalysts = await scanCatalystsInternal(15).catch(() => []);
        const catalystSymbols = catalysts
          .map((c) => c.symbol)
          .filter((s) => /^[A-Z]{1,6}(-USD)?$/.test(s));
        // Build candidate universe once (shared across users). Per-user extras added later.
        const baseSymbols = marketOpen ? ALL_SYMBOLS : UNIVERSE.crypto;
        const symbolsThisRun = Array.from(new Set([...baseSymbols, ...catalystSymbols]));

        // ---- Weekend prep: research-only brief, no trades. ----
        if (session === "weekend_prep") {
          const catalystsBrief = catalysts.slice(0, 10)
            .map((c) => `${c.symbol} (×${c.mentions}, sent ${c.sentiment >= 0 ? "+" : ""}${c.sentiment.toFixed(2)})`)
            .join(", ") || "no notable catalysts";
          for (const u of eligibleUsers) {
            await supabaseAdmin.from("agent_messages").insert({
              user_id: u.user_id, role: "assistant", is_autonomous: true, session_type: "weekend_prep",
              content: `🗓️ Weekend prep brief\n\nMarket regime heading into Monday: **${regime}**${vixLevel != null ? ` (VIX ${vixLevel.toFixed(1)})` : ""}.\n\nTop news catalysts I'm watching: ${catalystsBrief}.\n\nI'll re-evaluate open positions at Monday's morning scan. No trades taken during weekend prep.`,
            });
            await supabaseAdmin.from("agent_decisions").insert({
              user_id: u.user_id, session_type: "weekend_prep", regime, trades_opened: 0,
              payload: { catalysts: catalysts.slice(0, 15), vix: vixLevel } as never,
            });
          }
          return Response.json({
            ok: true, session, regime, vix: vixLevel,
            users: eligibleUsers.length, trades_opened: 0,
            catalysts: catalysts.slice(0, 15),
          });
        }

        const candidateMap = new Map<string, {
          symbol: string; price: number; rsi: number | null;
          sma20: number | null; sma50: number | null; ema12: number | null; ema26: number | null;
          momentum_pct: number; atr_pct: number | null; regime_aligned: boolean;
          vol_surge_pct: number; five_day_return: number; twenty_day_return: number; pct_above_sma20: number;
          rs_vs_spy_5d: number; rs_vs_spy_20d: number;
          macd_histogram: number | null; bb_pct_b: number | null; avg_volume_20d: number; stoch_rsi_k: number | null;
        }>();
        const batchSize = 10;
        for (let i = 0; i < symbolsThisRun.length; i += batchSize) {
          const batch = symbolsThisRun.slice(i, i + batchSize);
          await Promise.all(batch.map(async (sym) => {
            const bars = await fetchBars(sym, 220);
            if (!bars || bars.closes.length < 60) return;
            const ctx = buildContext(bars.closes);
            if (!ctx) return;
            const sma50 = ctx.sma50 ?? ctx.price;
            const momentum = ((ctx.price - sma50) / sma50) * 100;
            const n = Math.min(14, bars.highs.length - 1);
            let sumTr = 0;
            for (let k = bars.highs.length - n; k < bars.highs.length; k++) {
              sumTr += Math.max(
                bars.highs[k] - bars.lows[k],
                Math.abs(bars.highs[k] - bars.closes[k - 1]),
                Math.abs(bars.lows[k] - bars.closes[k - 1]),
              );
            }
            const atrPct = n > 0 ? (sumTr / n) / ctx.price * 100 : null;
            const aligned = (regime === "bull" && momentum > 0) || (regime === "bear" && momentum < 0) || regime === "sideways";

            // Volume surge: is today's volume above 20-day average? Strong signal.
            const vols = bars.volumes;
            const recentVols = vols.slice(-21, -1);
            const avgVol = recentVols.length > 0 ? recentVols.reduce((s, v) => s + v, 0) / recentVols.length : 0;
            const todayVol = vols[vols.length - 1] ?? 0;
            const volSurgePct = avgVol > 0 ? ((todayVol - avgVol) / avgVol) * 100 : 0;

            // 5-day return for short-term momentum
            const fiveDayReturn = bars.closes.length >= 6
              ? ((bars.closes[bars.closes.length - 1] - bars.closes[bars.closes.length - 6]) / bars.closes[bars.closes.length - 6]) * 100
              : 0;

            // 20-day return for medium-term trend  
            const twentyDayReturn = bars.closes.length >= 21
              ? ((bars.closes[bars.closes.length - 1] - bars.closes[bars.closes.length - 21]) / bars.closes[bars.closes.length - 21]) * 100
              : 0;

            // Price vs SMA20 (mean reversion signal)
            const pctAboveSma20 = ctx.sma20 ? ((ctx.price - ctx.sma20) / ctx.sma20) * 100 : 0;

            // Relative strength vs SPY (positive = outperforming market)
            const rs5d = Number((fiveDayReturn - spy5dReturn).toFixed(2));
            const rs20d = Number((twentyDayReturn - spy20dReturn).toFixed(2));

            const macdHist = ctx.macd_histogram;
            const bbPctB = ctx.bb_pct_b;
            const stochK = ctx.stoch_rsi_k;

            // Average daily volume (liquidity signal)
            const avgVolume = bars.volumes.length >= 20
              ? Math.round(bars.volumes.slice(-20).reduce((s, v) => s + v, 0) / 20)
              : 0;

            candidateMap.set(sym, {
              symbol: sym, price: ctx.price, rsi: ctx.rsi,
              sma20: ctx.sma20, sma50: ctx.sma50, ema12: ctx.ema12, ema26: ctx.ema26,
              momentum_pct: momentum, atr_pct: atrPct, regime_aligned: aligned,
              vol_surge_pct: Number(volSurgePct.toFixed(1)),
              five_day_return: Number(fiveDayReturn.toFixed(2)),
              twenty_day_return: Number(twentyDayReturn.toFixed(2)),
              pct_above_sma20: Number(pctAboveSma20.toFixed(2)),
              rs_vs_spy_5d: rs5d,
              rs_vs_spy_20d: rs20d,
              macd_histogram: macdHist != null ? Number(macdHist.toFixed(4)) : null,
              bb_pct_b: bbPctB != null ? Number(bbPctB.toFixed(3)) : null,
              avg_volume_20d: avgVolume,
              stoch_rsi_k: ctx.stoch_rsi_k != null ? Number(ctx.stoch_rsi_k.toFixed(1)) : null,
            });
          }));
        }

        const allCandidates = Array.from(candidateMap.values());

        // Composite opportunity score: momentum + volume surge + 5-day return + regime alignment
        function opportunityScore(c: typeof allCandidates[0]): number {
          // Earnings beat bonus is applied per-user in runForUser; skipped in scan-scope scoring
          let score = 0;
          score += Math.abs(c.momentum_pct) * 0.3;          // SMA50 momentum
          score += Math.min(c.vol_surge_pct, 200) * 0.02;      // volume surge (capped at 200%)
          score += Math.abs(c.five_day_return) * 0.25;          // 5-day momentum
          score += Math.abs(c.twenty_day_return) * 0.1;         // medium-term trend
          score += Math.abs(c.rs_vs_spy_5d) * 0.2;             // relative strength vs market
          if (c.rs_vs_spy_5d > 2) score += 8;                  // outperforming market strongly
          if (c.rs_vs_spy_5d < -2) score += 6;                 // underperforming (short candidate)
          if (c.regime_aligned) score += 5;                     // regime bonus
          if (c.rsi != null && c.rsi < 30) score += 8;         // oversold bounce signal
          if (c.rsi != null && c.rsi > 70) score += 6;         // overbought momentum signal
          if (c.vol_surge_pct > 50) score += 10;               // significant volume surge
          // Liquidity bonus: higher average volume = more reliable fills
          if (c.avg_volume_20d > 10_000_000) score += 3;        // highly liquid
          if (c.avg_volume_20d < 100_000) score -= 5;           // illiquid, penalize
          // MACD momentum: positive histogram = bullish momentum building
          if (c.macd_histogram != null && c.macd_histogram > 0) score += 5;
          if (c.macd_histogram != null && c.macd_histogram < 0) score += 4;  // bearish momentum (short signal)
          // Bollinger Band extremes: mean reversion signals
          if (c.bb_pct_b != null && c.bb_pct_b < 0.05) score += 9;  // near/below lower band = oversold
          if (c.bb_pct_b != null && c.bb_pct_b > 0.95) score += 7;  // near/above upper band = overbought
          // Stochastic RSI: more sensitive than RSI for momentum turning points
          if (c.stoch_rsi_k != null && c.stoch_rsi_k < 20) score += 8; // stoch oversold
          if (c.stoch_rsi_k != null && c.stoch_rsi_k > 80) score += 6; // stoch overbought (short)
          return score;
        }

        const sorted = session === "midday"
          ? allCandidates.sort((a, b) => opportunityScore(b) - opportunityScore(a)).slice(0, 15)
          : allCandidates.sort((a, b) => opportunityScore(b) - opportunityScore(a)).slice(0, 25);

        // Multi-timeframe confirmation: for top 12 candidates, check 1h and daily alignment.
        // Only worth doing for the cream of the crop to limit API calls.
        const poly = process.env.POLYGON_API_KEY;
        const mtfMap = new Map<string, { score: number; label: string }>();
        if (poly) {
          const top12 = sorted.slice(0, 12);
          await Promise.allSettled(top12.map(async (c) => {
            try {
              const sym = String(c.symbol);
              const isCrypto = /-?USD$/i.test(sym);
              const polySym = isCrypto ? `X:${sym.replace(/-?USD.*$/i, "")}USD` : sym;

              // Fetch 1h bars (last 7 days) and weekly bars (last 1 year)
              const [hourlyRes, weeklyRes] = await Promise.all([
                fetch(`https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(polySym)}/range/1/hour/2024-01-01/${new Date().toISOString().slice(0,10)}?adjusted=true&sort=asc&limit=168&apiKey=${poly}`),
                fetch(`https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(polySym)}/range/1/week/2023-01-01/${new Date().toISOString().slice(0,10)}?adjusted=true&sort=asc&limit=52&apiKey=${poly}`),
              ]);

              let score = 0;
              const labels: string[] = [];

              if (hourlyRes.ok) {
                const hj = (await hourlyRes.json()) as { results?: Array<{ c: number }> };
                const hCloses = (hj.results ?? []).map((b) => b.c);
                if (hCloses.length >= 20) {
                  const { sma, rsi: rsiFunc } = await import("@/lib/indicators");
                  const hSma20 = sma(hCloses, 20);
                  const hRsi = rsiFunc(hCloses, 14);
                  const hPrice = hCloses[hCloses.length - 1];
                  const hSmaVal = hSma20[hSma20.length - 1];
                  const hRsiVal = hRsi[hRsi.length - 1];
                  if (hSmaVal && hPrice > hSmaVal && hRsiVal && hRsiVal > 45 && hRsiVal < 72) { score += 2; labels.push("1h↑"); }
                  else if (hSmaVal && hPrice < hSmaVal && hRsiVal && hRsiVal < 55 && hRsiVal > 28) { score -= 2; labels.push("1h↓"); }
                  else { labels.push("1h~"); }
                }
              }

              if (weeklyRes.ok) {
                const wj = (await weeklyRes.json()) as { results?: Array<{ c: number }> };
                const wCloses = (wj.results ?? []).map((b) => b.c);
                if (wCloses.length >= 10) {
                  const { sma } = await import("@/lib/indicators");
                  const wSma10 = sma(wCloses, 10);
                  const wPrice = wCloses[wCloses.length - 1];
                  const wSmaVal = wSma10[wSma10.length - 1];
                  if (wSmaVal && wPrice > wSmaVal) { score += 1; labels.push("W↑"); }
                  else if (wSmaVal && wPrice < wSmaVal) { score -= 1; labels.push("W↓"); }
                  else { labels.push("W~"); }
                }
              }

              mtfMap.set(sym, {
                score,
                label: labels.join(" ") || "no data",
              });
            } catch { /* skip */ }
          }));
        }

        // Add MTF data to candidates and boost/reduce opportunity score
        const sortedWithMtf = sorted.map((c) => {
          const mtf = mtfMap.get(String(c.symbol));
          const mtfBoost = mtf ? mtf.score * 3 : 0; // +6 if both TFs agree, -6 if both disagree
          return { ...c, mtf_score: mtf?.score ?? 0, mtf_label: mtf?.label ?? "daily only", _finalScore: opportunityScore(c) + mtfBoost };
        }).sort((a, b) => b._finalScore - a._finalScore);

        let totalOpened = 0;
        const skipped: Array<{ user: string; reason: string }> = [];
        for (const u of eligibleUsers) {
          try {
            const settings = parseSettings(u.agent_settings);
            const result = await runForUser({
              userId: u.user_id,
              executionMode: u.autonomous_execution_mode ?? "paper",
              session, sessionType, regime, vixLevel,
              candidates: sortedWithMtf, supabaseAdmin, settings,
            });
            if (result.skipped) skipped.push({ user: u.user_id, reason: result.skipped });
            totalOpened += result.opened;
          } catch (e) {
            console.error("[autonomous-agent] user", u.user_id, e);
          }
        }

        return Response.json({
          ok: true, session, regime, vix: vixLevel,
          users: eligibleUsers.length, trades_opened: totalOpened, skipped,
          paused_users: activeUsers.length - eligibleUsers.length,
        });
      },
    },
  },
});

async function runForUser(args: {
  userId: string;
  executionMode: string;
  session: "morning" | "midday" | "weekend_prep";
  sessionType: string;
  regime: string;
  vixLevel: number | null;
  candidates: Array<Record<string, unknown>>;
  supabaseAdmin: Awaited<ReturnType<typeof getAdmin>>;
  settings: AgentSettings;
}): Promise<{ opened: number; skipped?: string }> {
  const { userId, session, sessionType, regime, vixLevel, candidates, supabaseAdmin, executionMode, settings } = args;

  const { data: portfolio } = await supabaseAdmin
    .from("paper_portfolios").select("*").eq("user_id", userId).maybeSingle();
  if (!portfolio) return { opened: 0, skipped: "no_portfolio" };

  const startBal = Number(portfolio.starting_balance) || 0;
  const cash = Number(portfolio.balance) || 0;

  // Batch open trades once.
  const { data: openTrades } = await supabaseAdmin
    .from("paper_trades").select("*").eq("user_id", userId).eq("is_open", true);
  const openList = openTrades ?? [];

  // ---- Compute total unrealized P&L on open positions ----
  let unrealized = 0;
  const quotes = new Map<string, number>();
  await Promise.all(openList.map(async (t) => {
    const p = await fetchQuotePrice(String(t.asset));
    if (p) quotes.set(String(t.asset), p);
  }));
  for (const t of openList) {
    const q = quotes.get(String(t.asset));
    if (!q) continue;
    const qty = Number(t.quantity), entry = Number(t.entry_price);
    unrealized += (q - entry) * qty * (t.side === "buy" ? 1 : -1);
  }

  // ---- Portfolio-level Expected Value ----
  // EV = Σ(position: prob_win × target_gain% + prob_lose × -stop_loss%)
  // We use a simplified Bayesian estimate: assume 55% base win probability,
  // adjusted by how far the position is from its target vs stop.
  let portfolioEV = 0;
  for (const t of openList) {
    const currentPrice = quotes.get(String(t.asset)) ?? Number(t.entry_price);
    const entry = Number(t.entry_price);
    const pnlPct = ((currentPrice - entry) / entry) * 100 * (t.side === "buy" ? 1 : -1);
    const stopPct = Number(t.stop_loss_pct ?? 7);
    const targetPct = Number(t.take_profit_pct ?? 15);
    const distToTarget = targetPct - pnlPct;
    const distToStop = stopPct + pnlPct; // positive = above stop
    // Win probability: adjust base 55% by risk/reward remaining
    const rrRatio = distToStop > 0 ? distToTarget / distToStop : 1;
    const probWin = Math.min(0.85, Math.max(0.15, 0.55 + (rrRatio - 1) * 0.05));
    const positionEV = (probWin * distToTarget) + ((1 - probWin) * -distToStop);
    const notional = Number(t.quantity) * currentPrice;
    portfolioEV += positionEV * notional / 100; // weighted by position size
  }
  const portfolioEVPct = openList.length > 0 && Number(portfolio.equity) > 0
    ? (portfolioEV / Number(portfolio.equity)) * 100
    : 0;
  const currentEquity = cash + openList.reduce((s, t) => {
    const q = quotes.get(String(t.asset)) ?? Number(t.entry_price);
    return s + q * Number(t.quantity);
  }, 0);

  // ---- Today's realized P&L (for circuit breaker) ----
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const { data: closedToday } = await supabaseAdmin
    .from("paper_trades").select("pnl")
    .eq("user_id", userId).eq("is_open", false)
    .gte("closed_at", dayStart.toISOString());
  const realizedToday = (closedToday ?? []).reduce((s, t) => s + Number(t.pnl ?? 0), 0);
  const dayPnl = realizedToday + unrealized;
  const dayPnlPct = startBal > 0 ? (dayPnl / startBal) * 100 : 0;

  // ---- Circuit breaker: down >5% today → block entries, close intraday only ----
  if (dayPnlPct < -5) {
    let closedIntra = 0;
    for (const t of openList) {
      if (t.hold_duration !== "intraday") continue;
      const q = quotes.get(String(t.asset));
      if (!q) continue;
      const qty = Number(t.quantity), entry = Number(t.entry_price);
      const pnl = (q - entry) * qty * (t.side === "buy" ? 1 : -1);
      await supabaseAdmin.from("paper_trades").update({
        is_open: false, exit_price: q, pnl, closed_at: new Date().toISOString(),
      }).eq("id", t.id);
      closedIntra += 1;
    }
    // Post one circuit-breaker message per day max.
    const { data: existing } = await supabaseAdmin
      .from("agent_messages").select("id")
      .eq("user_id", userId).eq("session_type", "circuit_breaker")
      .gte("created_at", dayStart.toISOString()).limit(1).maybeSingle();
    if (!existing) {
      await supabaseAdmin.from("agent_messages").insert({
        user_id: userId, role: "assistant", is_autonomous: true, session_type: "circuit_breaker",
        content: `🛑 Circuit breaker triggered. Portfolio is down ${dayPnlPct.toFixed(1)}% today — pausing all new entries for the rest of the trading day to protect capital. Exits still active.`,
      });
    }
    await supabaseAdmin.from("agent_decisions").insert({
      user_id: userId, session_type: sessionType, regime, trades_opened: 0,
      payload: { circuit_breaker_triggered: true, day_pnl_pct: dayPnlPct, intraday_closed: closedIntra } as never,
    });
    console.log(`[autonomous] circuit_breaker_triggered user=${userId} pct=${dayPnlPct.toFixed(2)}`);
    return { opened: 0, skipped: "circuit_breaker" };
  }

  // ---- Drawdown protection: peak-to-current ----
  const { data: peakRow } = await supabaseAdmin
    .from("portfolio_snapshots").select("equity")
    .eq("user_id", userId).order("equity", { ascending: false }).limit(1).maybeSingle();
  const peakEquity = Math.max(Number(peakRow?.equity ?? 0), currentEquity, startBal);
  const drawdownPct = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;
  const defensive = drawdownPct > 15;
  const effectiveMinCashPct = defensive ? 40 : settings.min_cash_pct;
  const effectiveMaxPositionPct = settings.max_position_pct;
  if (defensive) {
    const { data: existing } = await supabaseAdmin
      .from("agent_messages").select("id")
      .eq("user_id", userId).eq("session_type", "drawdown_protection")
      .gte("created_at", dayStart.toISOString()).limit(1).maybeSingle();
    if (!existing) {
      await supabaseAdmin.from("agent_messages").insert({
        user_id: userId, role: "assistant", is_autonomous: true, session_type: "drawdown_protection",
        content: `⚠️ Drawdown protection active. Portfolio is ${drawdownPct.toFixed(1)}% below peak. Switching to defensive mode: 40% min cash, long equities only, high conviction only. Will restore normal parameters when within 10% of peak.`,
      });
    }
  }

  const cashPct = currentEquity > 0 ? (cash / currentEquity) * 100 : 100;
  if (cashPct < effectiveMinCashPct) {
    await supabaseAdmin.from("agent_messages").insert({
      user_id: userId, role: "assistant", is_autonomous: true, session_type: sessionType,
      content: `Held off on new positions — cash is at ${cashPct.toFixed(0)}%, below the ${effectiveMinCashPct}% minimum reserve${defensive ? " (defensive mode)" : ""}.`,
    });
    await supabaseAdmin.from("agent_decisions").insert({
      user_id: userId, session_type: sessionType, regime, trades_opened: 0,
      payload: { skipped: "min_cash", defensive, drawdown_pct: drawdownPct } as never,
    });
    return { opened: 0, skipped: "min_cash" };
  }

  const { data: learnings } = await supabaseAdmin
    .from("agent_learnings").select("analysis, key_insights, adjustments")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(4);
  const learningsSummary = (learnings ?? []).map((l, i) =>
    `Week ${i + 1}: ${l.analysis?.slice(0, 300)} | Adj: ${JSON.stringify(l.adjustments).slice(0, 200)}`
  ).join("\n") || "No prior learnings yet.";

  // Load agent memories relevant to this scan's symbols
  const scanSymbols = (candidates as Array<{symbol?: string}>).map((c) => String(c.symbol ?? "")).filter(Boolean);
  const memories = await loadRelevantMemories(supabaseAdmin as never, userId, scanSymbols);

  // Options flow: check for unusual institutional options activity on scan symbols
  // High vol/OI ratio on calls = bullish institutional bet; on puts = bearish hedge
  const optionsFlowMap = new Map<string, { signal: "bullish" | "bearish"; premium: number; vol_oi: number }>();
  const polyKey = process.env.POLYGON_API_KEY;
  if (polyKey) {
    const today = new Date().toISOString().slice(0, 10);
    const exp30 = new Date(Date.now() + 35 * 86400_000).toISOString().slice(0, 10);
    await Promise.allSettled(
      [...UNIVERSE.large_cap, ...UNIVERSE.small_mid_cap].slice(0, 15).map(async (sym) => {
        try {
          const url = `https://api.polygon.io/v3/snapshot/options/${sym}?expiration_date.gte=${today}&expiration_date.lte=${exp30}&limit=30&apiKey=${polyKey}`;
          const r = await fetch(url);
          if (!r.ok) return;
          const j = (await r.json()) as { results?: Array<{
            details?: { contract_type: string; strike_price: number };
            day?: { volume?: number };
            open_interest?: number;
            last_quote?: { bid?: number; ask?: number };
          }> };
          let bullishPremium = 0, bearishPremium = 0;
          let topVolOi = 0;
          for (const c of j.results ?? []) {
            const vol = c.day?.volume ?? 0;
            const oi = c.open_interest ?? 1;
            const volOi = vol / oi;
            if (vol < 200 || volOi < 0.5) continue;
            const mid = ((c.last_quote?.bid ?? 0) + (c.last_quote?.ask ?? 0)) / 2;
            const premium = mid * vol * 100;
            const type = c.details?.contract_type?.toLowerCase();
            if (type === "call") bullishPremium += premium;
            else bearishPremium += premium;
            topVolOi = Math.max(topVolOi, volOi);
          }
          const total = bullishPremium + bearishPremium;
          if (total > 50_000) {
            optionsFlowMap.set(sym, {
              signal: bullishPremium > bearishPremium * 1.5 ? "bullish" :
                      bearishPremium > bullishPremium * 1.5 ? "bearish" : "bullish",
              premium: total,
              vol_oi: topVolOi,
            });
          }
        } catch { /* skip */ }
      })
    );
  }
  const optionsFlowContext = optionsFlowMap.size > 0
    ? `Unusual options flow detected: ${[...optionsFlowMap.entries()].map(([s, f]) =>
        `${s} (${f.signal}, $${(f.premium/1000).toFixed(0)}K premium, vol/OI ${f.vol_oi.toFixed(1)}x)`
      ).join(", ")}`
    : "No unusual options flow detected.";

  // Earnings surprise signal: stocks that beat earnings recently have post-earnings drift
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const earningsBeatMap = new Map<string, number>(); // symbol → surprise pct
  const fin = process.env.FINNHUB_API_KEY;
  if (fin) {
    await Promise.allSettled(
      [...UNIVERSE.large_cap, ...UNIVERSE.small_mid_cap].slice(0, 20).map(async (sym) => {
        try {
          const r = await fetch(`https://finnhub.io/api/v1/stock/earnings?symbol=${sym}&limit=1&token=${fin}`);
          if (!r.ok) return;
          const j = (await r.json()) as Array<{ date?: string; actual?: number; estimate?: number }>;
          const latest = j[0];
          if (!latest?.date || !latest.actual || !latest.estimate) return;
          if (new Date(latest.date) < new Date(thirtyDaysAgo)) return;
          const surprise = ((latest.actual - latest.estimate) / Math.abs(latest.estimate)) * 100;
          if (Math.abs(surprise) > 3) earningsBeatMap.set(sym, surprise);
        } catch { /* skip */ }
      })
    );
  }
  const earningsContext = earningsBeatMap.size > 0
    ? `Recent earnings beats (last 30 days): ${[...earningsBeatMap.entries()].map(([s, p]) => `${s} ${p > 0 ? "+" : ""}${p.toFixed(1)}%`).join(", ")}`
    : "No recent earnings surprises.";

  // Signal → trade bridge: load recent open market signals for context
  const sixHoursAgo = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data: recentSignals } = await supabaseAdmin
    .from("market_signals")
    .select("asset, direction, confidence, signal_type, thesis, entry_price, target_price, stop_price")
    .eq("result", "open")
    .gte("created_at", sixHoursAgo)
    .order("confidence", { ascending: false })
    .limit(15);
  const signalContext = (recentSignals ?? []).map((s) =>
    `${s.asset} ${s.direction} (${s.signal_type}, confidence ${s.confidence}, thesis: ${(s.thesis ?? "").slice(0, 100)})`
  ).join("\n") || "No recent signals.";

  // Strategy → autonomous bridge: check which manual strategies have firing entry conditions
  const { data: activeStrategies } = await supabaseAdmin
    .from("strategies")
    .select("name, strategy_json")
    .eq("user_id", userId)
    .eq("active", true)
    .eq("execution_mode", "paper")
    .eq("source", "user")
    .limit(10);

  const firingStrategies: string[] = [];
  if (activeStrategies && activeStrategies.length > 0) {
    for (const strat of activeStrategies) {
      const sj = strat.strategy_json as { entry?: { conditions?: string[]; logic?: string }; universe?: string[] };
      if (!sj?.entry?.conditions) continue;
      for (const sym of (sj.universe ?? []).slice(0, 3)) {
        const bars = await fetchBars(String(sym), 220);
        if (!bars) continue;
        const ctx = buildContext(bars.closes);
        if (!ctx) continue;
        try {
          const { evalGroup: eg } = await import("@/lib/indicators");
          const fires = eg(sj.entry.conditions as string[], (sj.entry.logic ?? "AND") as "AND" | "OR", ctx);
          if (fires) firingStrategies.push(`${strat.name} firing on ${sym}`);
        } catch { /* skip */ }
      }
    }
  }
  const strategyBridgeContext = firingStrategies.length > 0
    ? `Manual strategies currently firing: ${firingStrategies.join(", ")}`
    : "No manual strategies currently firing.";

  const userMessage = {
    session, regime, vix_level: vixLevel,
    portfolio: { cash, equity: currentEquity, cash_pct: cashPct, open_positions_count: openList.length, day_pnl_pct: dayPnlPct, drawdown_pct: drawdownPct, portfolio_ev_pct: Number(portfolioEVPct.toFixed(2)) },
    defensive_mode: defensive,
    settings: {
      max_position_pct: effectiveMaxPositionPct,
      min_cash_pct: effectiveMinCashPct,
      default_stop_loss_pct: settings.stop_loss_pct,
      default_take_profit_pct: settings.take_profit_pct,
    },
    candidates,
    current_positions: await Promise.all(openList.map(async (t) => {
      const livePrice = quotes.get(String(t.asset)) ?? null;
      const entry = Number(t.entry_price);
      const pnlPct = livePrice ? ((livePrice - entry) / entry) * 100 * (t.side === "buy" ? 1 : -1) : null;
      const daysHeld = Math.round((Date.now() - new Date(String(t.created_at)).getTime()) / 86400_000);
      // Fetch current RSI for held position so agent can assess momentum
      let currentRsi: number | null = null;
      try {
        const b = await fetchBars(String(t.asset), 30);
        if (b) { const ctx = buildContext(b.closes); currentRsi = ctx?.rsi ?? null; }
      } catch { /* skip */ }
      return {
        id: t.id,
        asset: t.asset,
        side: t.side,
        instrument: t.instrument,
        entry_price: entry,
        current_price: livePrice,
        pnl_pct: pnlPct != null ? Number(pnlPct.toFixed(2)) : null,
        days_held: daysHeld,
        hold_duration: t.hold_duration,
        current_rsi: currentRsi != null ? Number(currentRsi.toFixed(1)) : null,
        stop_loss_pct: t.stop_loss_pct,
        take_profit_pct: t.take_profit_pct,
        rationale: String(t.rationale ?? "").slice(0, 150),
      };
    })),
    learnings_summary: learningsSummary,
    agent_memory: memories,
    recent_ai_signals: signalContext,
    manual_strategies_firing: strategyBridgeContext,
    earnings_surprises: earningsContext,
    unusual_options_flow: optionsFlowContext,
    fear_greed_index: fearGreedValue != null ? `${fearGreedValue}/100 (${fearGreedLabel})` : "unavailable",
    macro_overlay: macroContext,
    margin_available: false,
  };

  // Inject memory into user message
  const userMessageWithMemory = { ...userMessage, agent_memory: buildMemorySection(memories) };

  // Build dynamic hard rules from recent weekly learning adjustments
  const learningAdjustments = (learnings ?? [])
    .flatMap((l) => Array.isArray(l.adjustments) ? l.adjustments as string[] : [])
    .slice(0, 8)
    .map((a, i) => `- LEARNED RULE ${i + 1}: ${a}`)
    .join("\n");

  const systemPrompt = `You are an autonomous portfolio manager with deep expertise in equities, ETFs, crypto, and options (calls, puts, vertical spreads, iron condors). You manage a ring-fenced trading account. Your only goal is to maximize risk-adjusted returns over time.

HARD RULES — never violate these:
- Always maintain at least ${effectiveMinCashPct}% cash. Never deploy more than ${100 - effectiveMinCashPct}% of the portfolio.
- Never allocate more than ${effectiveMaxPositionPct}% to a single position.
- Default stop-loss is ${settings.stop_loss_pct}%, default take-profit is ${settings.take_profit_pct}% — tighten or loosen only with clear rationale.
- For SHORT positions: only recommend if margin_available is true. If not, use puts instead.
- Never trade assets with earnings within 48 hours.
- Session "midday" is intraday only — set hold_duration="intraday" for all midday trades.
- If defensive_mode is true: LONG stock/etf/crypto only (no shorts, no options, no spreads), conviction must be >= 75.
- Trade actively. You are a momentum-driven portfolio manager who makes 2-5 trades per scan when conditions allow. Do not default to inaction — markets always have opportunities if you look hard enough. Empty trades array should be RARE, only when ALL candidates show negative signals.
- Prefer smaller allocations (5-15%) to open more positions rather than large allocations (25-35%) on fewer. Diversification across 6-10 positions is better than concentration in 2-3.
- When vol_surge_pct > 50, that stock is moving on unusual volume — prioritize it.
- When five_day_return shows strong momentum (>3% or <-3%), that is a high-quality signal.
- When recent_ai_signals contains signals for a candidate, use them as additional evidence. Aligned signals increase conviction; contradicting signals decrease it.
- macro_overlay provides 10Y yield, 2Y yield, yield curve shape, and DXY: Rising 10Y yield = headwind for tech/growth stocks, tailwind for financials. Inverted yield curve = recession warning, favor defensive positions. Rising DXY = headwind for crypto and international stocks. Normal-steep curve = risk-on environment. Factor these into your conviction and sector preferences.
- fear_greed_index: <20 = Extreme Fear (buy quality names aggressively, high expected value), 20-40 = Fear (be opportunistic), 40-60 = Neutral, 60-80 = Greed (be selective, smaller positions), >80 = Extreme Greed (be very cautious, reduce sizes, take profits on existing positions).
- mtf_label on each candidate shows multi-timeframe alignment (1h↑ = hourly bullish, W↑ = weekly bullish). Prefer candidates where 1h and W align with your intended direction. Heavily penalize trades where MTF is against you (e.g. going long on 1h↓ W↓).
- When earnings_surprises shows a recent positive earnings beat (>5%), that stock has post-earnings drift momentum
- unusual_options_flow shows institutional positioning via options. Large call premium (bullish) = smart money buying upside. Large put premium (bearish) = smart money hedging or betting on downside. This is one of the most reliable leading indicators — weight it as +20 conviction when aligned with your technical view. — weight it as +20 conviction for long positions. Negative surprises (<-5%) = +20 for short/put.
- Use MACD histogram: positive = bullish momentum building (buy signal), negative and falling = bearish (short/put signal).
- portfolio_ev_pct is the expected value of current open positions as a % of portfolio. If EV > 5%: existing positions are doing well — be selective about new entries, prefer high conviction (>75) only. If EV < -2%: portfolio is under water — consider being more aggressive to recover, or if EV < -5% consider closing weak positions. If EV is near zero: neutral, trade normally.
- Trailing stops are automatically set at entry_price × (1 - stop_pct%) once a position gains >5%. When reviewing current_positions, if pnl_pct > 5% the position already has a trailing stop protecting profits — factor this into hold/exit decisions.
- Use Bollinger Bands: bb_pct_b < 0.05 = near lower band (oversold, buy/call), bb_pct_b > 0.95 = near upper band (overbought, sell/put).
- Sector ETF filter is already applied: long stock entries are only shown when their sector ETF is bullish.
- When manual_strategies_firing shows a strategy firing, that is strong corroborating evidence — weight it as +15 conviction points if it aligns with your analysis.
${learningAdjustments ? "\nLEARNED RULES FROM PAST PERFORMANCE (treat as hard rules):\n" + learningAdjustments : ""}

Respond with ONLY valid JSON — no prose, no markdown fences:
{
  "market_assessment": "2-3 sentence market overview",
  "regime": "bull|bear|sideways",
  "cash_deployment_pct": <0-${100 - effectiveMinCashPct} number>,
  "trades": [ { "symbol": "NVDA", "direction": "long|short", "instrument": "stock|etf|crypto|call|put|call_spread|put_spread|iron_condor", "conviction": <0-100>, "allocation_pct": <1-${effectiveMaxPositionPct}>, "stop_loss_pct": <number>, "take_profit_pct": <number>, "hold_duration": "intraday|swing|position", "rationale": "2-3 sentence explanation", "options_details": { "expiry_days_out": 21, "strike_type": "atm|otm_1|otm_2|itm_1", "contracts": 1, "spread_width": null } } ],
  "message_to_user": "Friendly 2-4 sentence summary."
}`;

  const ai = await callGateway(systemPrompt, JSON.stringify(userMessageWithMemory));
  if (!ai) {
    await supabaseAdmin.from("agent_decisions").insert({
      user_id: userId, session_type: sessionType, regime, trades_opened: 0,
      payload: { ai_error: true } as never,
    });
    return { opened: 0, skipped: "ai_error" };
  }

  const sectorCount = new Map<string, number>();
  for (const t of openList) {
    const s = SECTOR[String(t.asset).toUpperCase()] ?? "other";
    sectorCount.set(s, (sectorCount.get(s) ?? 0) + 1);
  }

  let opened = 0;
  let cashRemaining = cash;
  for (const raw of ai.trades ?? []) {
    let t = raw;
    if (t.direction === "short" && !userMessage.margin_available) {
      t = { ...t, instrument: "put", direction: "long", rationale: `${t.rationale} [converted from short to put — margin unavailable]` };
    }
    // Defensive-mode enforcement: block options/shorts/spreads + conviction filter
    if (defensive) {
      const okInstrument = ["stock", "etf", "crypto"].includes(t.instrument);
      if (!okInstrument || t.direction === "short" || (t.conviction ?? 0) < 75) continue;
    }
    // Boost allocation when a high-confidence market signal aligns with this trade
    const matchingSignal = (recentSignals ?? []).find((s) =>
      String(s.asset).toUpperCase() === t.symbol.toUpperCase() &&
      ((t.direction === "long" && ["buy","call"].includes(String(s.direction))) ||
       (t.direction === "short" && ["sell","put"].includes(String(s.direction))))
    );
    const signalBoost = matchingSignal && Number(matchingSignal.confidence) >= 80 ? 1.15
      : matchingSignal && Number(matchingSignal.confidence) >= 65 ? 1.05 : 1.0;
    const allocPct = Math.min(t.allocation_pct * signalBoost, effectiveMaxPositionPct);
    const allocCash = (cash * allocPct) / 100;
    // Sector ETF momentum filter: skip long stock entries when sector is below SMA50
    if (t.direction === "long" && ["stock"].includes(t.instrument ?? "stock")) {
      const sectorBullish = await isSectorBullish(t.symbol);
      if (!sectorBullish) {
        console.log(`[autonomous] skip ${t.symbol}: sector ETF below SMA50`);
        continue;
      }
    }

    // Scale-in: if conviction >= 85 and already have a winning position in this asset,
    // add up to 50% more at the current price (pyramid into strength).
    const existingWinner = openList.find((o) =>
      String(o.asset).toUpperCase() === t.symbol.toUpperCase() &&
      o.side === (t.direction === "long" ? "buy" : "sell") &&
      o.strategy_id !== null
    );
    if (existingWinner && (t.conviction ?? 0) >= 85) {
      const existingPrice = quotes.get(String(existingWinner.asset));
      if (existingPrice) {
        const existPnlPct = ((existingPrice - Number(existingWinner.entry_price)) / Number(existingWinner.entry_price)) * 100;
        if (existPnlPct > 3) {
          // Add half the normal allocation as a scale-in (pyramid up into strength)
          const scaleAllocPct = Math.min(allocPct * 0.5, effectiveMaxPositionPct * 0.3);
          const scaleCash = (cash * scaleAllocPct) / 100;
          if (scaleCash > 10 && scaleCash < cashRemaining * 0.5) {
            const scaleQty = scaleCash / existingPrice;
            await (supabaseAdmin as any).from("paper_trades").insert({
              user_id: userId, portfolio_id: portfolio.id,
              asset: t.symbol, side: t.direction === "long" ? "buy" : "sell",
              quantity: scaleQty, entry_price: existingPrice, is_open: true,
              hold_duration: t.hold_duration,
              stop_loss_pct: t.stop_loss_pct ?? settings.stop_loss_pct,
              take_profit_pct: t.take_profit_pct ?? settings.take_profit_pct,
              instrument: t.instrument, conviction: t.conviction ?? null,
              rationale: `[SCALE-IN conviction:${t.conviction}] Adding to winning ${t.symbol} position (+${existPnlPct.toFixed(1)}%). ${t.rationale}`,
            });
            cashRemaining -= scaleCash;
            opened++;
            console.log(`[autonomous] scale-in ${t.symbol} +${existPnlPct.toFixed(1)}% conviction=${t.conviction}`);
            continue; // Don't open a second full position, just scale in
          }
        }
      }
    }

    // Cumulative allocation guard: ensure this trade doesn't exceed deployable cash
    const deployableCash = cash * ((100 - effectiveMinCashPct) / 100);
    const alreadyDeployed = cash - cashRemaining;
    if (alreadyDeployed + allocCash > deployableCash * 1.02) {
      console.log(`[autonomous] skip ${t.symbol}: cumulative allocation would exceed deployable cash`);
      continue;
    }
    if (allocCash > cashRemaining * 0.99) continue;
    const sect = SECTOR[t.symbol.toUpperCase()] ?? "other";
    if ((sectorCount.get(sect) ?? 0) >= Math.max(2, Math.floor(openList.length * 0.4))) continue;

    // Sector ETF momentum filter: don't buy individual stocks when their sector ETF is below SMA50
    const SECTOR_ETF: Record<string, string> = {
      tech: "XLK", finance: "XLF", energy: "XLE", health: "XLV", consumer: "XLP",
    };
    const SECTOR_FOR: Record<string, string> = {
      AAPL:"tech",MSFT:"tech",NVDA:"tech",GOOGL:"tech",AMZN:"tech",META:"tech",AMD:"tech",
      CRM:"tech",INTC:"tech",QCOM:"tech",ADBE:"tech",ORCL:"tech",SNOW:"tech",
      JPM:"finance",BAC:"finance",V:"finance",GS:"finance",
      XOM:"energy",CVX:"energy",
      JNJ:"health",
    };
    const sectorEtfCache = new Map<string, boolean>(); // etf → is above SMA50
    async function isSectorBullish(symbol: string): Promise<boolean> {
      const sector = SECTOR_FOR[symbol.toUpperCase()];
      if (!sector) return true; // unknown sector: don't filter
      const etf = SECTOR_ETF[sector];
      if (!etf) return true;
      if (sectorEtfCache.has(etf)) return sectorEtfCache.get(etf)!;
      const etfBars = await fetchBars(etf, 60);
      if (!etfBars) { sectorEtfCache.set(etf, true); return true; }
      const etfCtx = buildContext(etfBars.closes);
      const bullish = etfCtx != null && etfCtx.sma50 != null && etfCtx.price > etfCtx.sma50;
      sectorEtfCache.set(etf, bullish);
      return bullish;
    }

    // Trade similarity detector: skip if already open in same asset + same instrument + same direction
    const alreadyHasSimilar = openList.some((o) => {
      const sameAsset = String(o.asset).toUpperCase() === t.symbol.toUpperCase();
      const sameDir = (o.side === "buy") === (t.direction === "long");
      const oInstr = String(o.instrument ?? "stock").toLowerCase();
      const tInstr = (t.instrument ?? "stock").toLowerCase();
      const sameInstrType = (oInstr.includes("call") && tInstr.includes("call")) ||
        (oInstr.includes("put") && tInstr.includes("put")) ||
        (["stock","etf","crypto"].includes(oInstr) && ["stock","etf","crypto"].includes(tInstr));
      return sameAsset && sameDir && sameInstrType;
    });
    if (alreadyHasSimilar) {
      console.log(`[autonomous] skip duplicate position: ${t.symbol} ${t.direction} ${t.instrument}`);
      continue;
    }

    const price = await fetchQuotePrice(t.symbol);
    if (!price || price <= 0) continue;
    const qty = allocCash / price;

    // For options trades, resolve the real contract from Polygon before inserting
    let resolvedOptions = t.options_details as Record<string, unknown> | null ?? null;
    let enrichedRationale = t.rationale;
    const isOptionsInstrument = ["call", "put", "call_spread", "put_spread"].includes(t.instrument?.toLowerCase() ?? "");
    if (isOptionsInstrument && t.options_details) {
      const spec = t.options_details as { expiry_days_out?: number; strike_type?: string; contracts?: number; spread_width?: number | null };
      const direction = t.instrument?.toLowerCase().includes("put") ? "put" : "call";
      const contract = await resolveOptionsContract(
        t.symbol,
        direction as "call" | "put",
        price,
        {
          expiry_days_out: spec.expiry_days_out ?? 21,
          strike_type: (spec.strike_type ?? "atm") as "atm" | "otm_1" | "otm_2" | "itm_1",
          contracts: spec.contracts ?? 1,
          spread_width: spec.spread_width ?? null,
        },
      );
      if (contract) {
        resolvedOptions = { ...resolvedOptions, resolved_contract: contract };
        enrichedRationale = `${t.rationale} | Contract: ${formatContractSummary(contract)}`;
      }
    }

    const { error } = await supabaseAdmin.from("paper_trades").insert({
      user_id: userId,
      portfolio_id: portfolio.id,
      asset: t.symbol,
      side: t.direction === "long" ? "buy" : "sell",
      quantity: qty,
      entry_price: price,
      is_open: true,
      hold_duration: t.hold_duration,
      stop_loss_pct: t.stop_loss_pct ?? settings.stop_loss_pct,
      take_profit_pct: t.take_profit_pct ?? settings.take_profit_pct,
      instrument: t.instrument,
      options_details: (resolvedOptions ?? null) as never,
      conviction: (t.conviction ?? null) as never,
      rationale: enrichedRationale,
    });
    if (error) { console.error("[autonomous] insert trade", error); continue; }
    cashRemaining -= allocCash;
    sectorCount.set(sect, (sectorCount.get(sect) ?? 0) + 1);
    opened += 1;
  }

  if (opened > 0) {
    await supabaseAdmin.from("paper_portfolios").update({ balance: cashRemaining, updated_at: new Date().toISOString() }).eq("id", portfolio.id);
  }

  // Save market observation memory for this scan
  if (ai?.market_assessment) {
    await saveMemories(supabaseAdmin as never, userId, [{
      symbol: null,
      memory_type: "market_observation",
      content: `${new Date().toDateString()} ${session}: ${ai.market_assessment} (regime: ${regime})`,
      expires_days: 14,
    }]);
  }

  // Save memories for each trade opened (for future self-critique)
  if (opened > 0 && ai?.trades) {
    const tradeMems = (ai.trades as Array<{symbol:string; rationale:string; conviction:number; direction:string}>)
      .filter((t) => t.symbol && t.rationale)
      .map((t) => ({
        symbol: t.symbol,
        memory_type: "strategy_note" as const,
        content: `Opened ${t.direction} position on ${new Date().toDateString()} (conviction ${t.conviction}): ${t.rationale.slice(0, 200)}`,
        expires_days: 30,
      }));
    if (tradeMems.length > 0) await saveMemories(supabaseAdmin as never, userId, tradeMems);
  }

  const newCashPct = currentEquity > 0 ? (cashRemaining / currentEquity) * 100 : 0;
  const agentMsgContent = `${ai.message_to_user}\n\n📊 **Positions opened:** ${opened} | **Cash remaining:** ${newCashPct.toFixed(0)}%${defensive ? " · defensive mode" : ""}${vixLevel != null ? ` · VIX ${vixLevel.toFixed(1)}` : ""}`;
  await supabaseAdmin.from("agent_messages").insert({
    user_id: userId, role: "assistant", is_autonomous: true, session_type: sessionType,
    content: agentMsgContent,
  });
  // Fire webhook for agent scan notification
  await fireWebhook(userId, "agent_scan", {
    session: sessionType, regime, opened, cash_pct: newCashPct.toFixed(0),
    message: ai.message_to_user?.slice(0, 500),
  }).catch(() => {});
  await supabaseAdmin.from("agent_decisions").insert({
    user_id: userId, session_type: sessionType, regime,
    market_assessment: ai.market_assessment, payload: ai as never,
    trades_opened: opened,
  });
  // ---- Live Robinhood execution for strategies in live mode ----
  if (executionMode === "live" && opened > 0) {
    try {
      const token = await getValidToken(supabaseAdmin, userId);
      if (token) {
        // Fetch the trades we just inserted to get their details
        const { data: newTrades } = await supabaseAdmin
          .from("paper_trades")
          .select("*")
          .eq("user_id", userId)
          .eq("is_open", true)
          .order("created_at", { ascending: false })
          .limit(opened);
        for (const trade of newTrades ?? []) {
          const allocCash = Number(trade.quantity) * Number(trade.entry_price);
          let result;
          if (trade.side === "buy") {
            result = await placeLiveBuy(token, String(trade.asset), allocCash);
          } else {
            result = await placeLiveSell(token, String(trade.asset), Number(trade.quantity));
          }
          if (result.ok) {
            // Update the paper trade with real fill details
            await supabaseAdmin.from("paper_trades").update({
              entry_price: result.filled_price ?? trade.entry_price,
              rationale: `${trade.rationale ?? ""} [LIVE: order_id=${result.order_id} status=${result.status}]`,
            }).eq("id", trade.id);
          } else {
            console.error("[autonomous] live order failed:", result.error, "trade:", trade.asset);
            // Mark as paper-only if live order fails
            await supabaseAdmin.from("paper_trades").update({
              rationale: `${trade.rationale ?? ""} [LIVE ORDER FAILED: ${result.error}]`,
            }).eq("id", trade.id);
          }
        }
      } else {
        console.warn("[autonomous] live mode but no valid Robinhood token for user", userId);
      }
    } catch (e) {
      console.error("[autonomous] live execution error:", e);
    }
  }
  return { opened };
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function callGateway(system: string, user: string): Promise<AiResponse | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,  // lower = more consistent, less "creative" for trading decisions
      }),
    });
    if (!r.ok) { console.error("[gateway]", r.status, await r.text()); return null; }
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = j.choices?.[0]?.message?.content ?? "";
    const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
    return JSON.parse(cleaned) as AiResponse;
  } catch (e) {
    console.error("[gateway] parse", e);
    return null;
  }
}
