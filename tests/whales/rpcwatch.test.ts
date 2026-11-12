import { describe, expect, it } from "./expect.ts";
import { Rpc, type Probe } from "../../worker/whales/client.ts";
import { choose, RpcWatch } from "../../worker/whales/rpcwatch.ts";

const probe = (index: number, head: number | null, ms = 100, error: string | null = null): Probe => ({ index, host: `rpc${index}`, head, ms, error: head === null ? error ?? "timed out" : null });

describe("choose: which endpoint to move to after a probe", () => {
  it("stays when the current endpoint is the furthest ahead", () => {
    expect(choose([probe(0, 1000), probe(1, 990)], 0, 990, 14)).toBeNull();
  });
  it("stays when another endpoint is only a few blocks ahead (no flapping)", () => {
    expect(choose([probe(0, 1000), probe(1, 1020)], 0, 990, 14)).toBeNull(); // 20 < 3 s of blocks (42)
  });
  it("moves when the current endpoint failed the probe", () => {
    expect(choose([probe(0, null), probe(1, 1000), probe(2, 1005)], 0, 990, 14)).toMatchObject({ index: 2 });
  });
  it("moves when the current endpoint is frozen on the last head seen", () => {
    expect(choose([probe(0, 990), probe(1, 1001)], 0, 990, 14)).toMatchObject({ index: 1, why: expect.stringContaining("frozen") });
  });
  it("moves when another endpoint is more than about 3 s of blocks ahead", () => {
    expect(choose([probe(0, 1000), probe(1, 1100)], 0, 950, 14)).toMatchObject({ index: 1 });
  });
  it("breaks a tie on the head by response time, and stays when nobody answered", () => {
    expect(choose([probe(0, null), probe(1, 1000, 300), probe(2, 1000, 80)], 0, 900, 14)).toMatchObject({ index: 2 });
    expect(choose([probe(0, null), probe(1, null)], 0, 900, 14)).toBeNull();
  });
});

/** Fake endpoints: each URL answers eth_blockNumber with the head set here, or fails. */
function fakeRpc(heads: Record<string, number | null>) {
  const fetcher = (async (input: RequestInfo | URL) => {
    const head = heads[String(input)];
    if (head === null || head === undefined) throw Object.assign(new Error("down"), { name: "TypeError" });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 0, result: `0x${head.toString(16)}` }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return new Rpc(Object.keys(heads), { fetcher, sleep: async () => {} });
}

describe("RpcWatch: idle detection and switching", () => {
  it("is not due while the head and cursor keep moving, and is due after more than 6 s idle", () => {
    let now = 0; const rpc = fakeRpc({ "https://a.test": 100, "https://b.test": 100 });
    const watch = new RpcWatch(rpc, () => now);
    watch.observe(100, 99); now = 3000; watch.observe(140, 139); now = 8000; watch.observe(210, 209);
    expect(watch.due()).toBe(false);
    now = 14_100; // head and cursor last moved at 8000
    expect(watch.due()).toBe(true);
  });

  it("switches to the endpoint that is ahead when the current one froze, then respects the cooldown", async () => {
    let now = 0; const heads: Record<string, number | null> = { "https://kinetiq.test": 500, "https://boxa.test": 590 };
    const rpc = fakeRpc(heads); const watch = new RpcWatch(rpc, () => now);
    watch.observe(500, 499); now = 7000;
    expect(watch.due()).toBe(true);
    expect(await watch.check(14)).toBe(true);
    expect(rpc.preferredIndex).toBe(1);
    expect(watch.last).toMatchObject({ switched: true, from: "kinetiq.test", to: "boxa.test" });
    // Fresh idle window and a 20 s cooldown after a check.
    now = 14_000; expect(watch.due()).toBe(false);
    now = 27_500; expect(watch.due()).toBe(true);
  });

  it("does not switch when the current endpoint is fine (slow processing, not a stuck RPC)", async () => {
    let now = 0; const rpc = fakeRpc({ "https://kinetiq.test": 1000, "https://boxa.test": 1010 });
    const watch = new RpcWatch(rpc, () => now);
    watch.observe(900, 800); now = 7000;
    expect(await watch.check(14)).toBe(false);
    expect(rpc.preferredIndex).toBe(0);
    expect(watch.last?.reason).toContain("idle 7.0 s");
  });

  it("switches away from an endpoint that stopped answering", async () => {
    let now = 0; const rpc = fakeRpc({ "https://kinetiq.test": null, "https://boxa.test": 1000, "https://elyscan.test": 990 });
    const watch = new RpcWatch(rpc, () => now);
    watch.observe(980, 979); now = 9000;
    expect(await watch.check(14)).toBe(true);
    expect(rpc.preferredIndex).toBe(1);
    expect(watch.last?.probes[0]).toMatchObject({ host: "kinetiq.test", head: null });
  });
});

describe("choose: preferring a faster endpoint when heads are level", () => {
  const speeds = (entries: [number, number, number][]) => new Map(entries.map(([index, ms, samples]) => [index, { ms, samples }]));

  it("moves to an endpoint within ~1 s of blocks that is at least twice as fast and 150 ms sooner (the live case)", () => {
    // Kinetiq ~400 ms, Boxa ~35 ms and 4 blocks behind, Elyscan ~50 ms (measured from Cloudflare, 9 November 2026).
    const pick = choose([probe(0, 3116459, 395), probe(1, 3116455, 35), probe(3, 3116458, 50)], 0, 3116400, 14, speeds([[0, 400, 2], [1, 35, 2], [3, 50, 2]]));
    expect(pick).toMatchObject({ index: 1, why: expect.stringContaining("faster") });
  });
  it("needs two samples for both endpoints before switching on speed (one probe time is noisy)", () => {
    expect(choose([probe(0, 1000, 400), probe(1, 1000, 30)], 0, 900, 14, speeds([[0, 400, 1], [1, 30, 2]]))).toBeNull();
    expect(choose([probe(0, 1000, 400), probe(1, 1000, 30)], 0, 900, 14, speeds([[0, 400, 2], [1, 30, 1]]))).toBeNull();
  });
  it("stays when the faster endpoint is more than ~1 s of blocks behind", () => {
    expect(choose([probe(0, 1000, 400), probe(1, 980, 30)], 0, 900, 14, speeds([[0, 400, 3], [1, 30, 3]]))).toBeNull();
  });
  it("stays when the gain is small: under 2x or under 150 ms", () => {
    expect(choose([probe(0, 1000, 300), probe(1, 1000, 200)], 0, 900, 14, speeds([[0, 300, 3], [1, 200, 3]]))).toBeNull(); // 1.5x
    expect(choose([probe(0, 1000, 120), probe(1, 1000, 30)], 0, 900, 14, speeds([[0, 120, 3], [1, 30, 3]]))).toBeNull();  // 90 ms
  });
  it("still prefers the head rules: a frozen or failed current endpoint goes to the one furthest ahead, not the fastest", () => {
    expect(choose([probe(0, null), probe(1, 1000, 30), probe(2, 1010, 300)], 0, 990, 14, speeds([[1, 30, 3], [2, 300, 3]]))).toMatchObject({ index: 2 });
  });
});

describe("RpcWatch: speed averages across checks", () => {
  it("switches to the faster endpoint on the second check, once both have two samples", async () => {
    let now = 0; let clock = 0;
    const delay: Record<string, number> = { "https://kinetiq.test": 400, "https://boxa.test": 35 };
    const fetcher = (async (input: RequestInfo | URL) => {
      clock += delay[String(input)]; // the probe measures Date.now() around fetch; advance the fake clock instead
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 0, result: "0x3e8" }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const rpc = new Rpc(Object.keys(delay), { fetcher, sleep: async () => {} });
    const realNow = Date.now; Date.now = () => clock;
    try {
      const watch = new RpcWatch(rpc, () => now);
      watch.observe(1000, 999); now = 7000;
      expect(await watch.check(14)).toBe(false); // one sample each
      now = 30_000;
      expect(await watch.check(14)).toBe(true);
      expect(rpc.preferredIndex).toBe(1);
      expect(watch.last?.reason).toContain("faster");
    } finally { Date.now = realNow; }
  });
});
