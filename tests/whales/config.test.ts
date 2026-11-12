import { describe, expect, it } from "./expect.ts";
import { loadEnv } from "../../worker/whales/config.ts";

describe("Whale watch indexer settings", () => {
  it("defaults to mainnet with the indexer's thresholds, and keeps every buy of 5 HYPE and up", () => {
    const env = loadEnv({});
    expect(env.chain.chainId).toBe(99901);
    expect(env.thresholds).toMatchObject({ whaleMinHype: 50, freshMinHype: 5, freshMaxNonce: 5, freshMaxAgeHours: 24, accumMinBuys: 3, accumWindowMin: 360, clusterMinWallets: 3, clusterWindowMin: 10, confirmations: 1, backfillBlocks: 20_000, storeMinHype: 5 });
    expect(env.chain.multicall3).toBe("0xca11bde05977b3631167028862be2a173976ca11");
    expect(env.dailyWriteBudget).toBe(50_000);
  });

  it("uses every Elysium node the profile names: the public list first, then the history-only ones", () => {
    const env = loadEnv({});
    expect(env.chain.rpcHttp).toEqual([
      "https://rpc.elysium.kinetiq.xyz",
      "https://rpc-live.boxa.club",
      "https://boxa.club/api/rpc",
      "https://rpc.elyscan.live",
      "https://rpc.volta.family",
    ]);
    expect(env.chain.historyRpc).toEqual(["https://rpc.elysium.kinetiq.xyz", "https://rpc.volta.family", "https://rpc.elyscan.live"]);
    expect(env.chain.rpcIsProvider).toBe(false);
    expect(env.chain.rpcHttp.some((url) => /alchemy/i.test(url))).toBe(false);
  });

  it("WHALE_CHAIN=testnet switches profile; WHALE_RPC overrides endpoints (https only); bad numbers fall back", () => {
    const env = loadEnv({ WHALE_CHAIN: "testnet", WHALE_RPC: "https://example.invalid/v2/key, http://insecure", WHALE_MIN_HYPE: "abc", FRESH_MAX_NONCE: "-4" });
    expect(env.chain.chainId).toBe(99801);
    expect(env.chain.rpcHttp).toEqual(["https://example.invalid/v2/key"]);
    expect(env.chain.rpcIsProvider).toBe(true);
    expect(env.thresholds.whaleMinHype).toBe(50);
    expect(env.thresholds.freshMaxNonce).toBe(0);
  });
});
