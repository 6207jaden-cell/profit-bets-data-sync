import { describe, it, expect } from "vitest";
import { generateOAuthState, verifyOAuthState, isHttpsUrl } from "@/lib/mcp-oauth.server";

describe("generateOAuthState", () => {
  it("generates a non-empty string", () => {
    const state = generateOAuthState();
    expect(typeof state).toBe("string");
    expect(state.length).toBeGreaterThan(0);
  });

  it("generates a different value on every call — a real nonce must not be predictable or reused", () => {
    const a = generateOAuthState();
    const b = generateOAuthState();
    expect(a).not.toBe(b);
  });

  it("generates URL-safe output (no characters that would need escaping in a query string)", () => {
    const state = generateOAuthState();
    expect(state).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("has enough entropy to be a genuine anti-CSRF nonce, not a short guessable token", () => {
    // 24 random bytes, base64url-encoded, should produce a string well
    // over 30 characters — this isn't meant to be a precise assertion on
    // the exact encoding, just a sanity floor confirming this isn't
    // accidentally producing something short and guessable.
    const state = generateOAuthState();
    expect(state.length).toBeGreaterThan(30);
  });
});

describe("verifyOAuthState", () => {
  it("returns true when the received state matches the stored state exactly", () => {
    expect(verifyOAuthState("abc123", "abc123")).toBe(true);
  });

  it("returns false when the received state does not match the stored state", () => {
    expect(verifyOAuthState("abc123", "xyz789")).toBe(false);
  });

  it("returns false when the received state is missing — this is the core CSRF-prevention behavior", () => {
    expect(verifyOAuthState(null, "abc123")).toBe(false);
    expect(verifyOAuthState(undefined, "abc123")).toBe(false);
    expect(verifyOAuthState("", "abc123")).toBe(false);
  });

  it("returns false when the stored state is missing, even if a value was received — both being 'absent' is not the same as them matching", () => {
    expect(verifyOAuthState("abc123", null)).toBe(false);
    expect(verifyOAuthState("abc123", undefined)).toBe(false);
  });

  it("returns false when BOTH are missing — two absent values must never be treated as a match", () => {
    expect(verifyOAuthState(null, null)).toBe(false);
    expect(verifyOAuthState(undefined, undefined)).toBe(false);
    expect(verifyOAuthState("", "")).toBe(false);
  });

  it("is case-sensitive — a state differing only in case must not verify", () => {
    expect(verifyOAuthState("AbC123", "abc123")).toBe(false);
  });
});

describe("isHttpsUrl", () => {
  it("returns true for a well-formed HTTPS URL", () => {
    expect(isHttpsUrl("https://auth.robinhood.com/oauth")).toBe(true);
  });

  it("returns false for a plain HTTP URL — the exact downgrade attack this exists to catch", () => {
    expect(isHttpsUrl("http://auth.robinhood.com/oauth")).toBe(false);
  });

  it("returns false for other schemes that could be used to redirect a fetch unexpectedly", () => {
    expect(isHttpsUrl("ftp://example.com")).toBe(false);
    expect(isHttpsUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
  });

  it("returns false for a malformed/unparseable URL string rather than throwing", () => {
    expect(isHttpsUrl("not a url at all")).toBe(false);
    expect(isHttpsUrl("")).toBe(false);
    expect(isHttpsUrl("://missing-scheme")).toBe(false);
  });

  it("returns true regardless of path/query/fragment, only the scheme matters", () => {
    expect(isHttpsUrl("https://example.com/deep/path?query=1#fragment")).toBe(true);
  });
});
