/**
 * Server functions for market data.
 * Each function tries a live source. If credentials are missing or the upstream fails,
 * it returns { available: false, reason } so the UI can render an explicit fallback.
 * No mock data.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type FetchResult<T> = { available: true; data: T; updatedAt: string } | { available: false; reason: string; updatedAt: string };

const now = () => new Date().toISOString();

async function safeJson(url: string, init?: RequestInit, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ---------- Fear & Greed (keyless) ----------
export const getFearGreed = createServerFn({ method: "GET" }).handler(async (): Promise<FetchResult<{ value: number; classification: string }>> => {
  try {
    const j = (await safeJson("https://api.alternative.me/fng/?limit=1")) as { data?: Array<{ value: string; value_classification: string }> };
    const d = j.data?.[0];
    if (!d) return { available: false, reason: "empty_response", updatedAt: now() };
    return { available: true, data: { value: Number(d.value), classification: d.value_classification }, updatedAt: now() };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : "fetch_failed", updatedAt: now() };
  }
});

// ---------- Stock quote with fallback chain ----------
type Quote = { symbol: string; price: number; change: number; changePct: number; source: string };

async function polygonQuote(symbol: string, key: string): Promise<Quote | null> {
  const j = (await safeJson(`https://api.polygon.io/v2/aggs/ticker/${symbol}/prev?apiKey=${key}`)) as { results?: Array<{ c: number; o: number }> };
  const r = j.results?.[0];
  if (!r) return null;
  const change = r.c - r.o;
  return { symbol, price: r.c, change, changePct: (change / r.o) * 100, source: "polygon" };
}
async function finnhubQuote(symbol: string, key: string): Promise<Quote | null> {
  const j = (await safeJson(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${key}`)) as { c?: number; d?: number; dp?: number };
  if (!j.c) return null;
  return { symbol, price: j.c, change: j.d ?? 0, changePct: j.dp ?? 0, source: "finnhub" };
}
async function alphaQuote(symbol: string, key: string): Promise<Quote | null> {
  const j = (await safeJson(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${key}`)) as { ["Global Quote"]?: Record<string, string> };
  const g = j["Global Quote"];
  if (!g || !g["05. price"]) return null;
  const price = Number(g["05. price"]);
  const change = Number(g["09. change"]);
  return { symbol, price, change, changePct: Number(String(g["10. change percent"]).replace("%", "")), source: "alphavantage" };
}

export const getStockQuotes = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ symbols: z.array(z.string()).max(20) }).parse(d))
  .handler(async ({ data }): Promise<FetchResult<Quote[]>> => {
    const poly = process.env.POLYGON_API_KEY;
    const fin = process.env.FINNHUB_API_KEY;
    const alpha = process.env.ALPHA_VANTAGE_API_KEY;
    if (!poly && !fin && !alpha) return { available: false, reason: "missing_api_key", updatedAt: now() };
    const out: Quote[] = [];
    for (const sym of data.symbols) {
      const s = sym.toUpperCase();
      let q: Quote | null = null;
      try { if (!q && poly) q = await polygonQuote(s, poly); } catch { /* fall through */ }
      try { if (!q && alpha) q = await alphaQuote(s, alpha); } catch { /* fall through */ }
      try { if (!q && fin) q = await finnhubQuote(s, fin); } catch { /* fall through */ }
      if (q) out.push(q);
    }
    return { available: true, data: out, updatedAt: now() };
  });

// ---------- Crypto quotes (CoinGecko, keyless) ----------
export const getCryptoQuotes = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string()).max(20) }).parse(d))
  .handler(async ({ data }): Promise<FetchResult<Quote[]>> => {
    try {
      const ids = data.ids.map((i) => i.toLowerCase()).join(",");
      const j = (await safeJson(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`)) as Record<string, { usd: number; usd_24h_change: number }>;
      const out: Quote[] = Object.entries(j).map(([id, v]) => ({
        symbol: id.toUpperCase(),
        price: v.usd,
        change: (v.usd * (v.usd_24h_change ?? 0)) / 100,
        changePct: v.usd_24h_change ?? 0,
        source: "coingecko",
      }));
      return { available: true, data: out, updatedAt: now() };
    } catch (e) {
      return { available: false, reason: e instanceof Error ? e.message : "fetch_failed", updatedAt: now() };
    }
  });

// ---------- News (Finnhub) ----------
type NewsItem = {
  id: string; headline: string; summary: string; url: string; source: string;
  datetime: number; sentiment: "bullish" | "bearish" | "neutral";
  image: string | null; tickers: string[]; category: "stocks" | "crypto";
};
export const getMarketNews = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ category: z.enum(["all", "stocks", "crypto"]).optional() }).parse(d ?? {}))
  .handler(async ({ data }): Promise<FetchResult<NewsItem[]>> => {
    const key = process.env.FINNHUB_API_KEY;
    if (!key) return { available: false, reason: "missing_api_key", updatedAt: now() };
    const category = data.category ?? "all";
    try {
      const fetchCat = async (cat: "general" | "crypto") =>
        (await safeJson(`https://finnhub.io/api/v1/news?category=${cat}&token=${key}`)) as Array<{ id: number; headline: string; summary: string; url: string; source: string; datetime: number; image?: string; related?: string }>;
      const buckets: Array<{ raw: Awaited<ReturnType<typeof fetchCat>>; cat: "stocks" | "crypto" }> = [];
      if (category === "all" || category === "stocks") buckets.push({ raw: await fetchCat("general"), cat: "stocks" });
      if (category === "all" || category === "crypto") buckets.push({ raw: await fetchCat("crypto"), cat: "crypto" });
      const items: NewsItem[] = buckets.flatMap(({ raw, cat }) =>
        raw.slice(0, category === "all" ? 15 : 30).map((n) => ({
          id: `${cat}-${n.id}`,
          headline: n.headline,
          summary: n.summary,
          url: n.url,
          source: n.source,
          datetime: n.datetime * 1000,
          sentiment: classify(`${n.headline} ${n.summary}`),
          image: n.image || null,
          tickers: (n.related ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4),
          category: cat,
        })),
      );
      items.sort((a, b) => b.datetime - a.datetime);
      return { available: true, data: items.slice(0, 40), updatedAt: now() };
    } catch (e) {
      return { available: false, reason: e instanceof Error ? e.message : "fetch_failed", updatedAt: now() };
    }
  });

function classify(text: string): "bullish" | "bearish" | "neutral" {
  const t = text.toLowerCase();
  const bull = ["beat", "surge", "rally", "soar", "growth", "record", "upgrade", "outperform", "gain", "jump", "rise", "boost"];
  const bear = ["miss", "plunge", "crash", "decline", "downgrade", "warn", "cut", "fall", "drop", "slump", "loss", "fear", "concern"];
  let s = 0;
  for (const w of bull) if (t.includes(w)) s++;
  for (const w of bear) if (t.includes(w)) s--;
  if (s > 0) return "bullish";
  if (s < 0) return "bearish";
  return "neutral";
}

// ---------- Earnings (Finnhub calendar) ----------
type Earnings = { symbol: string; date: string; epsEstimate: number | null; revenueEstimate: number | null; hour: string };
export const getEarnings = createServerFn({ method: "GET" }).handler(async (): Promise<FetchResult<Earnings[]>> => {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return { available: false, reason: "missing_api_key", updatedAt: now() };
  try {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
    const j = (await safeJson(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${key}`)) as { earningsCalendar?: Array<{ symbol: string; date: string; epsEstimate: number; revenueEstimate: number; hour: string }> };
    const items = (j.earningsCalendar ?? []).slice(0, 30).map((e) => ({ symbol: e.symbol, date: e.date, epsEstimate: e.epsEstimate ?? null, revenueEstimate: e.revenueEstimate ?? null, hour: e.hour ?? "" }));
    return { available: true, data: items, updatedAt: now() };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : "fetch_failed", updatedAt: now() };
  }
});

// ---------- Options Flow (Polygon snapshot - large open interest movers) ----------
type Flow = { symbol: string; type: "call" | "put"; strike: number; expiry: string; premium: number; volume: number };
export const getOptionsFlow = createServerFn({ method: "GET" }).handler(async (): Promise<FetchResult<Flow[]>> => {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return { available: false, reason: "missing_api_key", updatedAt: now() };
  try {
    // Polygon: most-active options across the market
    const j = (await safeJson(`https://api.polygon.io/v3/snapshot?type=options&order=desc&limit=25&sort=session.volume&apiKey=${key}`)) as { results?: Array<{ ticker: string; details: { contract_type: string; strike_price: number; expiration_date: string }; session?: { volume: number; close: number } }> };
    const items: Flow[] = (j.results ?? []).map((r) => ({
      symbol: r.ticker,
      type: r.details.contract_type === "put" ? "put" : "call",
      strike: r.details.strike_price,
      expiry: r.details.expiration_date,
      premium: (r.session?.close ?? 0) * (r.session?.volume ?? 0) * 100,
      volume: r.session?.volume ?? 0,
    }));
    return { available: true, data: items, updatedAt: now() };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : "fetch_failed", updatedAt: now() };
  }
});

// ---------- AI Signal generation (Lovable AI Gateway, Gemini) ----------
export const generateMarketSignals = createServerFn({ method: "POST" }).handler(async (): Promise<{ generated: number; reason?: string }> => {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return { generated: 0, reason: "missing_lovable_api_key" };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Skip if we already generated signals in the last 6 hours
  const since = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { count } = await supabaseAdmin.from("market_signals").select("id", { count: "exact", head: true }).gte("created_at", since).is("user_id", null);
  if ((count ?? 0) >= 6) return { generated: 0, reason: "fresh_enough" };

  const prompt = `You are a quantitative analyst. Generate 6 SHORT-TERM trade ideas for the US session, mixing 3 options-flow ideas (calls/puts) and 3 buy/sell stock ideas, on liquid large-cap tickers. Return STRICT JSON array. Each item:
{
  "asset": "TICKER",
  "signal_type": "options_flow" | "buy_sell",
  "direction": "call" | "put" | "buy" | "sell",
  "confidence": 0-100,
  "entry_price": number,
  "target_price": number,
  "stop_price": number,
  "expected_edge_pct": number,
  "thesis": "one sentence rationale"
}
Use realistic prices for the chosen tickers. JSON ONLY, no commentary.`;

  let text = "";
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "direct" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return { generated: 0, reason: `gateway_${res.status}` };
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    text = j.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    return { generated: 0, reason: e instanceof Error ? e.message : "gateway_fetch_failed" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { generated: 0, reason: "parse_failed" };
  }
  const arr = Array.isArray(parsed) ? parsed : (parsed as { signals?: unknown[] }).signals;
  if (!Array.isArray(arr)) return { generated: 0, reason: "no_array" };

  const rows = arr.slice(0, 8).map((r) => {
    const s = r as Record<string, unknown>;
    return {
      asset: String(s.asset ?? "").toUpperCase().slice(0, 10),
      signal_type: s.signal_type === "options_flow" ? "options_flow" : "buy_sell",
      direction: ["call", "put", "buy", "sell"].includes(String(s.direction)) ? (s.direction as string) : "buy",
      confidence: Math.max(0, Math.min(100, Number(s.confidence) || 50)),
      entry_price: Number(s.entry_price) || null,
      target_price: Number(s.target_price) || null,
      stop_price: Number(s.stop_price) || null,
      expected_edge_pct: Number(s.expected_edge_pct) || null,
      thesis: String(s.thesis ?? "").slice(0, 400),
      is_public: true,
    };
  }).filter((r) => r.asset.length > 0);

  if (rows.length === 0) return { generated: 0, reason: "no_valid_rows" };
  const { error } = await supabaseAdmin.from("market_signals").insert(rows as never);
  if (error) return { generated: 0, reason: error.message };
  return { generated: rows.length };
});

// ---------- Stats for the dashboard top bar ----------
export const getMarketStats = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();

  const [openToday, recent] = await Promise.all([
    supabaseAdmin.from("market_signals").select("id", { count: "exact", head: true }).gte("created_at", dayStart.toISOString()).eq("result", "open"),
    supabaseAdmin.from("market_signals").select("result, resolved_pnl_pct").gte("created_at", monthAgo).neq("result", "open"),
  ]);

  const resolved = (recent.data ?? []) as Array<{ result: string; resolved_pnl_pct: number | null }>;
  const wins = resolved.filter((r) => r.result === "hit_target").length;
  const winRate = resolved.length > 0 ? (wins / resolved.length) * 100 : 0;
  const avgPnl = resolved.length > 0 ? resolved.reduce((s, r) => s + (r.resolved_pnl_pct ?? 0), 0) / resolved.length : 0;

  return {
    openSignalsToday: openToday.count ?? 0,
    winRate30d: winRate,
    avgPnl30d: avgPnl,
    updatedAt: now(),
  };
});
