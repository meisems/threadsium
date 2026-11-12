import { describe, expect, it } from "./expect.ts";
import { Detectors, isFresh } from "../../worker/whales/detectors.ts";
import type { SignalRecord } from "../../worker/whales/types.ts";
import { A, buy, facts, thresholds, TOKEN, TOKEN2, USER } from "./fixtures.ts";

const T0 = 1_700_000_000;
const types = (signals: SignalRecord[]) => signals.map((signal) => signal.type);

describe("isFresh", () => {
  const t = thresholds();
  it("nonce at the buy's block decides, funding age can make a wallet fresh", () => {
    expect(isFresh({ nonce: 5, nonceAtBlock: true, fundedAt: null }, T0, t)).toBe(true);
    expect(isFresh({ nonce: 6, nonceAtBlock: true, fundedAt: null }, T0, t)).toBe(false);
    expect(isFresh({ nonce: 40, nonceAtBlock: true, fundedAt: T0 - 3600 }, T0, t)).toBe(true);
    expect(isFresh({ nonce: 40, nonceAtBlock: true, fundedAt: T0 - 25 * 3600 }, T0, t)).toBe(false);
  });
  it("a `latest` nonce above the limit proves nothing", () => {
    expect(isFresh({ nonce: 9, nonceAtBlock: false, fundedAt: null }, T0, t)).toBe(null);
    expect(isFresh({ nonce: 2, nonceAtBlock: false, fundedAt: null }, T0, t)).toBe(true);
    expect(isFresh({ nonce: null, nonceAtBlock: false, fundedAt: null }, T0, t)).toBe(null);
  });
});

describe("WHALE_BUY and FRESH_BUY", () => {
  it("whale at the threshold, not below", () => {
    const d = new Detectors(thresholds());
    expect(types(d.onBuy({ trade: buy({ amountInHype: 50 }), facts: facts(), tokenSymbol: "X", hypeUsd: null }))).toEqual(["WHALE_BUY"]);
    expect(types(d.onBuy({ trade: buy({ amountInHype: 49.99, wallet: A(0x77) }), facts: facts(), tokenSymbol: "X", hypeUsd: null }))).toEqual([]);
  });
  it("fresh needs both a fresh wallet and FRESH_MIN_HYPE", () => {
    const d = new Detectors(thresholds());
    expect(types(d.onBuy({ trade: buy({ amountInHype: 5, wallet: A(0x71) }), facts: facts({ nonce: 1, fresh: true }), tokenSymbol: null, hypeUsd: null }))).toEqual(["FRESH_BUY"]);
    expect(types(d.onBuy({ trade: buy({ amountInHype: 4.9, wallet: A(0x72) }), facts: facts({ nonce: 1, fresh: true }), tokenSymbol: null, hypeUsd: null }))).toEqual([]);
    expect(types(d.onBuy({ trade: buy({ amountInHype: 60, wallet: A(0x73) }), facts: facts({ nonce: 1, fresh: true }), tokenSymbol: null, hypeUsd: null }))).toEqual(["WHALE_BUY", "FRESH_BUY"]);
  });
  it("sells never signal", () => {
    const d = new Detectors(thresholds());
    expect(d.onBuy({ trade: buy({ side: "SELL", amountInHype: 500 }), facts: facts({ fresh: true }), tokenSymbol: null, hypeUsd: null })).toEqual([]);
  });
});

describe("ACCUMULATION", () => {
  it("fires on the third buy within the window, once, then again after the window", () => {
    const d = new Detectors(thresholds());
    const at = (minutes: number) => d.onBuy({ trade: buy({ blockTime: T0 + minutes * 60, amountInHype: 2 }), facts: facts(), tokenSymbol: null, hypeUsd: null });
    expect(types(at(0))).toEqual([]);
    expect(types(at(60))).toEqual([]);
    const third = at(120);
    expect(types(third)).toEqual(["ACCUMULATION"]);
    expect(third[0].buyCount).toBe(3);
    expect(third[0].tradeKeys).toHaveLength(3);
    expect(types(at(130))).toEqual([]); // quiet within the window after firing
    expect(types(at(130 + 360))).toEqual([]); // window rolled: only 1 buy inside it...
    expect(types(at(130 + 361))).toEqual([]);
    expect(types(at(130 + 362))).toEqual(["ACCUMULATION"]);
  });
  it("buys spread wider than the window do not accumulate, and other tokens do not count", () => {
    const d = new Detectors(thresholds());
    for (const minutes of [0, 200, 400, 600]) expect(types(d.onBuy({ trade: buy({ blockTime: T0 + minutes * 60, amountInHype: 3 }), facts: facts(), tokenSymbol: null, hypeUsd: null }))).toEqual([]);
    const mixed = new Detectors(thresholds());
    mixed.onBuy({ trade: buy({ token: TOKEN, amountInHype: 3 }), facts: facts(), tokenSymbol: null, hypeUsd: null });
    mixed.onBuy({ trade: buy({ token: TOKEN2, amountInHype: 3 }), facts: facts(), tokenSymbol: null, hypeUsd: null });
    expect(types(mixed.onBuy({ trade: buy({ token: TOKEN, amountInHype: 3 }), facts: facts(), tokenSymbol: null, hypeUsd: null }))).toEqual([]);
  });
  it("dust below ACCUM_MIN_TOTAL_HYPE is ignored", () => {
    const d = new Detectors(thresholds());
    for (let i = 0; i < 5; i++) expect(types(d.onBuy({ trade: buy({ amountInHype: 0.5 }), facts: facts(), tokenSymbol: null, hypeUsd: null }))).toEqual([]);
  });
});

describe("CLUSTER", () => {
  const funder = A(0xf00d);
  const fresh = (wallet: number, minutes: number, by = funder) => ({ trade: buy({ wallet: A(wallet), blockTime: T0 + minutes * 60, amountInHype: 1 }), facts: facts({ nonce: 1, fresh: true, fundedBy: by }), tokenSymbol: null, hypeUsd: null });
  it("three fresh wallets from one funder within 10 minutes fire once", () => {
    const d = new Detectors(thresholds());
    expect(types(d.onBuy(fresh(1, 0)))).toEqual([]);
    expect(types(d.onBuy(fresh(2, 4)))).toEqual([]);
    const out = d.onBuy(fresh(3, 9));
    expect(types(out)).toEqual(["CLUSTER"]);
    expect(out[0].clusterWallets).toEqual([A(1), A(2), A(3)]);
    expect(out[0].fundedBy).toBe(funder);
    expect(types(d.onBuy(fresh(4, 9)))).toEqual([]);
  });
  it("different funders or a wider spread do not cluster", () => {
    const d = new Detectors(thresholds());
    d.onBuy(fresh(1, 0)); d.onBuy(fresh(2, 1, A(0xbeef)));
    expect(types(d.onBuy(fresh(3, 2)))).toEqual([]);
    const wide = new Detectors(thresholds());
    wide.onBuy(fresh(1, 0)); wide.onBuy(fresh(2, 11));
    expect(types(wide.onBuy(fresh(3, 22)))).toEqual([]);
  });
  it("funding found later re-evaluates the cluster and FRESH_BUY", () => {
    const d = new Detectors(thresholds());
    d.onBuy(fresh(1, 0)); d.onBuy(fresh(2, 1));
    const late = { trade: buy({ wallet: A(3), blockTime: T0 + 120, amountInHype: 6 }), facts: facts({ nonce: 30, fresh: false }), tokenSymbol: null, hypeUsd: null };
    expect(types(d.onBuy(late))).toEqual([]);
    expect(types(d.onFunding({ ...late, facts: facts({ nonce: 30, fresh: true, fundedBy: funder, fundedAt: T0 }) }))).toEqual(["FRESH_BUY", "CLUSTER"]);
  });
});
