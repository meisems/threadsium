import { describe, expect, it } from "./expect.ts";
import { SqlStore } from "../../worker/whales/store.ts";
import type { SignalRecord } from "../../worker/whales/types.ts";
import { sqlite } from "./expect.ts";
import { TOKEN, USER } from "./fixtures.ts";

const signal = (dedupeKey: string): SignalRecord => ({
  type: "WHALE_BUY", token: TOKEN, tokenSymbol: "T", wallet: USER, clusterWallets: null, fundedBy: null, tradeKeys: ["0x1:0"], amountInHype: 60, hypeUsd: null,
  launchpad: "unknown", txHash: "0x01", blockNumber: 1, createdAt: 1, dedupeKey, walletNonce: 1, walletFundedAt: null,
});

describe("SqlStore launchpads", () => {
  it("a signal stored as unknown shows the token's launchpad once it is resolved; a known one is never overwritten", () => {
    const store = new SqlStore(sqlite(), "mainnet", 1e9);
    store.saveTokens([{ address: TOKEN, symbol: "T", name: "T", decimals: 18, firstSeenBlock: 1, firstSeenAt: 1, launchpad: "unknown" }]);
    store.saveSignals([signal("a")]);
    expect(store.listSignals({ limit: 5 })[0].launchpad).toBe("unknown");
    store.updateLaunchpads(new Map([[TOKEN, "Montra"]]));
    expect(store.listSignals({ limit: 5 })[0].launchpad).toBe("Montra");
    expect(store.unposted(5)[0].launchpad).toBe("Montra");
    store.updateLaunchpads(new Map([[TOKEN, "Other"]]));
    expect(store.knownLaunchpad(TOKEN)).toBe("Montra");
  });
  it("filters still work through the join", () => {
    const store = new SqlStore(sqlite(), "mainnet", 1e9);
    store.saveSignals([signal("a"), { ...signal("b"), type: "FRESH_BUY" }]);
    expect(store.listSignals({ type: "FRESH_BUY", token: TOKEN, wallet: USER, before: 99, limit: 5 }).map((row) => row.type)).toEqual(["FRESH_BUY"]);
  });
});

describe("SqlStore recent buys (Whale watch's Buys list)", () => {
  const trade = (n: number, side: "BUY" | "SELL", hype: number, token = TOKEN) => ({
    txHash: `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`, logIndex: 0, blockNumber: n, blockTime: 1000 + n, wallet: USER, token, side,
    amountToken: 1n, amountInHype: hype, baseAsset: "native", launchpad: "unknown", walletNonce: 1, fresh: true, txTo: null,
  });
  it("lists the newest buys first, only buys, only at or above the minimum, across tokens or for one", () => {
    const store = new SqlStore(sqlite(), "mainnet", 1e9);
    store.saveTokens([{ address: TOKEN, symbol: "T", name: "T", decimals: 18, firstSeenBlock: 1, firstSeenAt: 1, launchpad: "unknown" }]);
    store.saveTrades([trade(1, "BUY", 6), trade(2, "SELL", 40), trade(3, "BUY", 4), trade(4, "BUY", 12, "0x00000000000000000000000000000000000000d2"), trade(5, "BUY", 5)] as never);
    expect(store.recentBuys({ minHype: 5, limit: 10 }).map((row) => row.blockNumber)).toEqual([5, 4, 1]);
    expect(store.recentBuys({ token: TOKEN, minHype: 5, limit: 10 }).map((row) => row.blockNumber)).toEqual([5, 1]);
    expect(store.recentBuys({ minHype: 5, limit: 10 })[0].symbol).toBe("T");
    expect(store.recentBuys({ minHype: 5, limit: 1 })).toHaveLength(1);
  });
});
