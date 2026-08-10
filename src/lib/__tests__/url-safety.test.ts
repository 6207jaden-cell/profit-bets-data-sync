import { describe, it, expect } from "vitest";
import { safeExternalUrl } from "@/lib/url-safety";

describe("safeExternalUrl", () => {
  it("returns a well-formed https URL unchanged", () => {
    expect(safeExternalUrl("https://finnhub.io/article/123")).toBe("https://finnhub.io/article/123");
  });

  it("returns a well-formed http URL unchanged", () => {
    expect(safeExternalUrl("http://example.com/news")).toBe("http://example.com/news");
  });

  it("returns '#' for a javascript: URI — the exact XSS vector this exists to close", () => {
    expect(safeExternalUrl("javascript:alert(document.cookie)")).toBe("#");
  });

  it("returns '#' for other dangerous or unexpected schemes", () => {
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
    expect(safeExternalUrl("vbscript:msgbox(1)")).toBe("#");
    expect(safeExternalUrl("file:///etc/passwd")).toBe("#");
  });

  it("returns '#' for null, undefined, and empty string rather than throwing", () => {
    expect(safeExternalUrl(null)).toBe("#");
    expect(safeExternalUrl(undefined)).toBe("#");
    expect(safeExternalUrl("")).toBe("#");
  });

  it("returns '#' for a malformed/unparseable URL string rather than throwing", () => {
    expect(safeExternalUrl("not a url at all")).toBe("#");
    expect(safeExternalUrl("://missing-scheme")).toBe("#");
  });

  it("preserves path, query, and fragment on a valid URL", () => {
    const url = "https://example.com/article?id=42&ref=feed#comments";
    expect(safeExternalUrl(url)).toBe(url);
  });
});
