// Item 13's XSS review (2026-08-06): several components render `href`/
// `src` attributes directly from EXTERNAL, untrusted API responses (news
// article URLs from Finnhub via market.functions.ts and
// catalysts.functions.ts) with no scheme validation. A malicious or
// compromised upstream response containing a `javascript:` (or other
// non-http(s)) URI in a `url` field would execute if a user clicked the
// resulting link. Checked before writing this: every internally-
// constructed URL in this codebase (robinhood-links.ts) always starts
// from a hardcoded https://robinhood.com/... prefix and only interpolates
// a symbol into the PATH, never the scheme — those are NOT vulnerable to
// this and don't need this helper. This is specifically for URLs whose
// value originates entirely from a third-party API response.

/**
 * Returns `url` unchanged if it's a well-formed http(s) URL, or "#"
 * otherwise. "#" is a safe, inert href — clicking it does nothing rather
 * than navigating anywhere or executing anything.
 */
export function safeExternalUrl(url: string | null | undefined): string {
  if (!url) return "#";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
    return "#";
  } catch {
    return "#";
  }
}
