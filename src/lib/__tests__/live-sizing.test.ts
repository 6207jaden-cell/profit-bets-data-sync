import { describe, expect, it } from "vitest";
import { scaleNotional, scaleSellQuantity } from "../live-sizing";

describe("scaleNotional", () => {
  it("scales down when the live account is smaller", () => {
    const r = scaleNotional(1000, 10_000, 2_000, 5_000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pct).toBeCloseTo(10);
      expect(r.notional).toBeCloseTo(200);
      expect(r.clamped).toBe(false);
    }
  });

  it("scales up when the live account is larger", () => {
    const r = scaleNotional(500, 10_000, 100_000, 100_000);
    expect(r.ok && r.notional).toBeCloseTo(5_000);
  });

  it("clamps to remaining buying power", () => {
    const r = scaleNotional(2_000, 10_000, 10_000, 750);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.notional).toBeCloseTo(750);
      expect(r.clamped).toBe(true);
    }
  });

  it("skips dust orders below the minimum", () => {
    const r = scaleNotional(1, 10_000, 500, 5_000);
    expect(r).toEqual({ ok: false, reason: "below_min" });
  });

  it("refuses to size without valid equity", () => {
    expect(scaleNotional(100, 0, 1_000, 1_000)).toEqual({ ok: false, reason: "invalid_equity" });
    expect(scaleNotional(100, 10_000, 0, 1_000)).toEqual({ ok: false, reason: "invalid_equity" });
    expect(scaleNotional(100, 10_000, 1_000, NaN)).toEqual({ ok: false, reason: "no_buying_power" });
  });

  it("rejects a non-positive paper notional", () => {
    expect(scaleNotional(0, 10_000, 1_000, 1_000)).toEqual({ ok: false, reason: "invalid_notional" });
  });
});

describe("scaleSellQuantity", () => {
  it("sells the same fraction of the live position", () => {
    const r = scaleSellQuantity(5, 10, 40, 1_000_000, 10);
    expect(r).toEqual({ ok: true, quantity: 20 });
  });

  it("caps the quantity by the scaled notional", () => {
    const r = scaleSellQuantity(10, 10, 100, 250, 10);
    expect(r.ok && r.quantity).toBeCloseTo(25);
  });

  it("skips when there is no live position", () => {
    expect(scaleSellQuantity(5, 10, 0, 500, 10)).toEqual({ ok: false, reason: "no_live_position" });
  });

  it("rejects invalid paper inputs", () => {
    expect(scaleSellQuantity(0, 10, 5, 500, 10)).toEqual({ ok: false, reason: "invalid_inputs" });
    expect(scaleSellQuantity(5, 0, 5, 500, 10)).toEqual({ ok: false, reason: "invalid_inputs" });
  });
});
