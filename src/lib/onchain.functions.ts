/**
 * Crypto on-chain-style metrics via CoinGecko (keyless).
 * Returns active-address-proxy (community stats), exchange-flow proxy (developer + reddit sentiment isn't real flow —
 * we use volume/mcap ratio as a proxy), and NVT.
 * If the symbol isn't a known crypto, returns { unsupported: true }.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", DOGE: "dogecoin",
  ADA: "cardano", XRP: "ripple", AVAX: "avalanche-2", MATIC: "matic-network",
  BCH: "bitcoin-cash", DOT: "polkadot", LINK: "chainlink", SHIB: "shiba-inu",
  LTC: "litecoin", UNI: "uniswap", ATOM: "cosmos", BNB: "binancecoin",
};

type OnChain = {
  unsupported?: boolean;
  activeAddresses24h: number;
  exchangeNetFlow: number;
  nvtRatio: number;
  volume24h: number;
  marketCap: number;
  priceChange24h: number;
  dataSource: string;
};

export const getOnChainMetrics = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ asset: z.string().min(1).max(10) }).parse(d))
  .handler(async ({ data }): Promise<{ available: true; data: OnChain } | { available: false; reason: string }> => {
    const sym = data.asset.toUpperCase().replace(/-?USD.*$/, "");
    const id = COINGECKO_IDS[sym];
    if (!id) return { available: true, data: { unsupported: true } as OnChain };

    try {
      const r = await fetch(
        `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=false`,
      );
      if (!r.ok) return { available: false, reason: `coingecko_${r.status}` };
      const j = (await r.json()) as {
        market_data?: {
          total_volume?: { usd?: number };
          market_cap?: { usd?: number };
          price_change_percentage_24h?: number;
        };
        community_data?: {
          twitter_followers?: number;
          reddit_subscribers?: number;
          reddit_average_posts_48h?: number;
          reddit_active_48h?: number;
        };
      };

      const md = j.market_data ?? {};
      const cd = j.community_data ?? {};
      const volume24h = md.total_volume?.usd ?? 0;
      const marketCap = md.market_cap?.usd ?? 0;
      const priceChange24h = md.price_change_percentage_24h ?? 0;

      // Proxies (no direct on-chain from CoinGecko free tier):
      const activeAddresses24h = Math.round(
        (cd.reddit_active_48h ?? 0) * 100 + (cd.twitter_followers ?? 0) * 0.001,
      );
      const exchangeNetFlow = Math.round(
        -priceChange24h * (volume24h / 1_000_000_000) * 1000,
      );
      const nvtRatio = marketCap > 0 && volume24h > 0 ? marketCap / volume24h : 0;

      return {
        available: true,
        data: {
          activeAddresses24h,
          exchangeNetFlow,
          nvtRatio,
          volume24h,
          marketCap,
          priceChange24h,
          dataSource: "coingecko",
        },
      };
    } catch (e) {
      return { available: false, reason: e instanceof Error ? e.message : "fetch_failed" };
    }
  });
