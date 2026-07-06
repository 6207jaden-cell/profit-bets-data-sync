/**
 * Robinhood deep-link helpers.
 * Universal links open the app on mobile if installed, otherwise fall back to web.
 * Ported from PROFIT_BETS.AI MarketSignalCard broker chooser.
 */

const REF = "stefanb-2ada5c"; // affiliate ref — keeps referral credit on installs

type Side = "buy" | "sell";
type OptType = "call" | "put";

const q = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== "");
  if (entries.length === 0) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
};

export function robinhoodStockUrl(symbol: string, _side: Side = "buy"): string {
  const s = symbol.toUpperCase();
  return `https://robinhood.com/stocks/${s}${q({ ref: REF })}`;
}

export function robinhoodCryptoUrl(symbol: string): string {
  // Robinhood crypto pair uses e.g. BTC-USD
  const base = symbol.toUpperCase().replace(/-?USD.*$/, "");
  return `https://robinhood.com/crypto/${base}${q({ ref: REF })}`;
}

export function robinhoodOptionsChainUrl(symbol: string, type?: OptType): string {
  const s = symbol.toUpperCase();
  return `https://robinhood.com/options/chains/${s}${q({ type })}`;
}

export function robinhoodSignup(): string {
  return `https://join.robinhood.com/${REF}`;
}

/** Best URL for a signal card / asset drawer based on asset kind & direction. */
export function robinhoodLinkForSignal(opts: {
  asset: string;
  assetKind: "stock" | "crypto" | "options";
  direction?: "call" | "put" | "buy" | "sell";
}): { label: string; url: string } {
  const { asset, assetKind, direction } = opts;
  if (assetKind === "options") {
    const t: OptType | undefined = direction === "call" || direction === "put" ? direction : undefined;
    return { label: `Open ${t ?? "options"} chain on Robinhood`, url: robinhoodOptionsChainUrl(asset, t) };
  }
  if (assetKind === "crypto") {
    return { label: "Trade on Robinhood", url: robinhoodCryptoUrl(asset) };
  }
  return { label: "Trade on Robinhood", url: robinhoodStockUrl(asset, direction === "sell" ? "sell" : "buy") };
}
