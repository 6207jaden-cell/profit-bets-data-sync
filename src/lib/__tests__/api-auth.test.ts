import { describe, it, expect } from "vitest";
import { verifyPublicApiKey, unauthorizedResponse } from "@/lib/api-auth";

function requestWithApiKey(key: string | null): Request {
  const headers = new Headers();
  if (key !== null) headers.set("apikey", key);
  return new Request("https://example.com/api/public/test", { method: "POST", headers });
}

describe("verifyPublicApiKey", () => {
  it("accepts a request with the correct key", () => {
    expect(verifyPublicApiKey(requestWithApiKey("correct-secret"), "correct-secret")).toBe(true);
  });

  it("rejects a request with an incorrect key", () => {
    expect(verifyPublicApiKey(requestWithApiKey("wrong-secret"), "correct-secret")).toBe(false);
  });

  it("rejects a request with no apikey header at all", () => {
    expect(verifyPublicApiKey(requestWithApiKey(null), "correct-secret")).toBe(false);
  });

  it("rejects a request with an empty-string apikey header", () => {
    expect(verifyPublicApiKey(requestWithApiKey(""), "correct-secret")).toBe(false);
  });

  it("rejects ANY non-empty string when the check is naive presence-only — this is BUG-002's exact regression case", () => {
    // The original sync-crons.ts bug: `if (!apikey)` passes for literally any
    // non-empty string. This test locks in that the real implementation
    // requires an exact match, not just non-emptiness.
    expect(verifyPublicApiKey(requestWithApiKey("literally anything"), "correct-secret")).toBe(false);
    expect(verifyPublicApiKey(requestWithApiKey("x"), "correct-secret")).toBe(false);
  });

  it("the Headers API itself normalizes leading/trailing whitespace in header values (RFC 7230) — verified here so this isn't mistaken for a bug in verifyPublicApiKey later", () => {
    // This documents real platform behavior rather than testing our own
    // logic: by the time verifyPublicApiKey sees request.headers.get(),
    // the runtime has already trimmed whitespace per the HTTP spec. A
    // key with accidental leading/trailing whitespace in the ORIGINAL
    // request still matches correctly — this is correct, expected
    // behavior, not a security gap.
    expect(verifyPublicApiKey(requestWithApiKey(" correct-secret "), "correct-secret")).toBe(true);
  });

  it("is case-sensitive — a key differing only in case is rejected", () => {
    expect(verifyPublicApiKey(requestWithApiKey("Correct-Secret"), "correct-secret")).toBe(false);
  });

  it("fails safe when the server's own expected key is misconfigured (null/undefined/empty) — never treats a missing expected key as 'anything goes'", () => {
    expect(verifyPublicApiKey(requestWithApiKey("anything"), undefined)).toBe(false);
    expect(verifyPublicApiKey(requestWithApiKey("anything"), null)).toBe(false);
    expect(verifyPublicApiKey(requestWithApiKey("anything"), "")).toBe(false);
    // Even an empty provided key against an empty expected key must not pass —
    // two falsy values matching each other is not a valid authorization.
    expect(verifyPublicApiKey(requestWithApiKey(""), "")).toBe(false);
  });
});

describe("unauthorizedResponse", () => {
  it("returns a 401 status", () => {
    const response = unauthorizedResponse();
    expect(response.status).toBe(401);
  });
});
