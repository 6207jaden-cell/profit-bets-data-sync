import { describe, it, expect } from "vitest";
import {
  OPTIONS_INSTRUMENT_TYPES, NON_OPTIONS_INSTRUMENT_TYPES, ALL_PROPOSABLE_INSTRUMENT_TYPES,
  isOptionsInstrumentType,
} from "@/lib/instruments";

describe("instrument type lists", () => {
  it("does NOT include iron_condor anywhere — the entire point of BUG-003's fix", () => {
    expect(ALL_PROPOSABLE_INSTRUMENT_TYPES).not.toContain("iron_condor");
    expect(OPTIONS_INSTRUMENT_TYPES).not.toContain("iron_condor");
  });

  it("ALL_PROPOSABLE_INSTRUMENT_TYPES is exactly the union of the two sub-lists, with no duplicates or omissions", () => {
    const combined = [...NON_OPTIONS_INSTRUMENT_TYPES, ...OPTIONS_INSTRUMENT_TYPES];
    expect(ALL_PROPOSABLE_INSTRUMENT_TYPES).toEqual(combined);
    expect(new Set(ALL_PROPOSABLE_INSTRUMENT_TYPES).size).toBe(ALL_PROPOSABLE_INSTRUMENT_TYPES.length);
  });

  it("contains exactly the 7 expected instrument types, matching what the AI schema and execution math both need to agree on", () => {
    expect(ALL_PROPOSABLE_INSTRUMENT_TYPES).toEqual(["stock", "etf", "crypto", "call", "put", "call_spread", "put_spread"]);
  });
});

describe("isOptionsInstrumentType", () => {
  it("returns true for every genuine options instrument", () => {
    for (const t of OPTIONS_INSTRUMENT_TYPES) {
      expect(isOptionsInstrumentType(t)).toBe(true);
    }
  });

  it("returns false for every non-options instrument", () => {
    for (const t of NON_OPTIONS_INSTRUMENT_TYPES) {
      expect(isOptionsInstrumentType(t)).toBe(false);
    }
  });

  it("returns false for iron_condor specifically — this exact check is what BUG-003 needed", () => {
    expect(isOptionsInstrumentType("iron_condor")).toBe(false);
  });

  it("returns false for null, undefined, and empty string rather than throwing", () => {
    expect(isOptionsInstrumentType(null)).toBe(false);
    expect(isOptionsInstrumentType(undefined)).toBe(false);
    expect(isOptionsInstrumentType("")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isOptionsInstrumentType("CALL")).toBe(true);
    expect(isOptionsInstrumentType("Call_Spread")).toBe(true);
  });
});

describe("regression guard: the actual route files never hardcode a competing instrument list", () => {
  // BUG-003 existed because the AI's JSON schema and the execution math's
  // isOptionsInstrument check were two independently-maintained lists that
  // drifted apart. Now that both are built FROM this shared module, the
  // main risk is someone bypassing it and hardcoding a new duplicate list
  // directly in a route file again — this test reads the actual source
  // text of the files known to have needed this fix and catches that.
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");

  const filesToCheck = [
    "src/routes/api/public/autonomous-agent.ts",
    "src/routes/api/public/snapshot-portfolio.ts",
  ];

  for (const relativePath of filesToCheck) {
    it(`${relativePath} does not contain the literal string "iron_condor"`, () => {
      const fullPath = path.resolve(process.cwd(), relativePath);
      const content = fs.readFileSync(fullPath, "utf-8");
      expect(content).not.toContain("iron_condor");
    });

    it(`${relativePath} does not hardcode a duplicate ["call", "put", "call_spread", "put_spread"] literal`, () => {
      const fullPath = path.resolve(process.cwd(), relativePath);
      const content = fs.readFileSync(fullPath, "utf-8");
      expect(content).not.toContain('["call", "put", "call_spread", "put_spread"]');
    });
  }
});
