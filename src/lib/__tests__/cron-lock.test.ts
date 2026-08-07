import { describe, it, expect } from "vitest";
import { tryAcquireCronLock, releaseCronLock } from "@/lib/cron-lock";

function makeMockSupabase(acquireResults: boolean[] = [true]) {
  let callIndex = 0;
  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  const mock = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      if (fn === "try_acquire_cron_lock") {
        const result = acquireResults[Math.min(callIndex, acquireResults.length - 1)];
        callIndex++;
        return { data: result, error: null };
      }
      if (fn === "release_cron_lock") return { data: null, error: null };
      return { data: null, error: null };
    },
  };
  return { mock: mock as any, rpcCalls };
}

describe("tryAcquireCronLock", () => {
  it("returns acquired: true when the RPC reports the lock was successfully acquired", async () => {
    const { mock } = makeMockSupabase([true]);
    const result = await tryAcquireCronLock(mock, "test-lock", 600);
    expect(result.acquired).toBe(true);
  });

  it("returns acquired: false when the RPC reports the lock is already held — this is the actual overlap-prevention behavior", async () => {
    const { mock } = makeMockSupabase([false]);
    const result = await tryAcquireCronLock(mock, "test-lock", 600);
    expect(result.acquired).toBe(false);
  });

  it("passes the exact lock key and TTL through to the RPC call", async () => {
    const { mock, rpcCalls } = makeMockSupabase([true]);
    await tryAcquireCronLock(mock, "scalp-scan", 300);
    expect(rpcCalls[0].fn).toBe("try_acquire_cron_lock");
    expect(rpcCalls[0].params.p_lock_key).toBe("scalp-scan");
    expect(rpcCalls[0].params.p_ttl_seconds).toBe(300);
  });

  it("fails OPEN (acquired: true) when the underlying RPC throws — a lock-check outage must not block a scheduled trading scan", async () => {
    const throwingMock = { rpc: async () => { throw new Error("simulated DB outage"); } };
    const result = await tryAcquireCronLock(throwingMock as any, "test-lock", 600);
    expect(result.acquired).toBe(true);
  });

  it("fails OPEN when the RPC returns an error field instead of throwing", async () => {
    const errorMock = { rpc: async () => ({ data: null, error: { message: "connection refused" } }) };
    const result = await tryAcquireCronLock(errorMock as any, "test-lock", 600);
    expect(result.acquired).toBe(true);
  });

  it("different lock keys are independent — a held lock for one session type doesn't block another", async () => {
    let calls = 0;
    const mock = {
      rpc: async (_fn: string, params: { p_lock_key: string }) => {
        calls++;
        return { data: params.p_lock_key === "crypto-scan", error: null };
      },
    };
    const scalpResult = await tryAcquireCronLock(mock as any, "scalp-scan", 600);
    const cryptoResult = await tryAcquireCronLock(mock as any, "crypto-scan", 600);
    expect(scalpResult.acquired).toBe(false);
    expect(cryptoResult.acquired).toBe(true);
    expect(calls).toBe(2);
  });
});

describe("releaseCronLock", () => {
  it("calls the release RPC with the correct lock key", async () => {
    const { mock, rpcCalls } = makeMockSupabase();
    await releaseCronLock(mock, "test-lock");
    expect(rpcCalls[0].fn).toBe("release_cron_lock");
    expect(rpcCalls[0].params.p_lock_key).toBe("test-lock");
  });

  it("does not throw even if the underlying RPC fails — release is best-effort, the lock self-clears via TTL regardless", async () => {
    const throwingMock = { rpc: async () => { throw new Error("simulated DB outage"); } };
    await expect(releaseCronLock(throwingMock as any, "test-lock")).resolves.not.toThrow();
  });
});
