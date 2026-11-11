import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, parseAbi } from "viem";
import { fmtUnits } from "../src/lib/format.ts";
import { findVenues, NATIVE, poolId, quoteSwap, V3_FAMILIES, type Venue } from "../src/lib/swap.ts";
import { classifyTx, TRANSFER_TOPIC } from "../worker/elywake/classify.ts";
import { Detectors } from "../worker/elywake/detectors.ts";
import { BASES, THRESHOLDS } from "../worker/elywake/labels.ts";
import type { Address, Hex, RawLog, RawTx } from "../worker/elywake/types.ts";
import { describeTransfer } from "../worker/transfers.ts";

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const WHYPE = "0xba876237b0f021a6c6d852d6c26e107997cc5e81" as Address;
const HYPE = 10n ** 18n;
const topic = (a: string) => `0x${a.slice(2).padStart(64, "0")}` as Hex;
const word = (v: bigint) => `0x${v.toString(16).padStart(64, "0")}` as Hex;
let li = 0;
const transfer = (token: Address, from: Address, to: Address, value: bigint, hash: Hex = "0x01"): RawLog => ({
  address: token,
  topics: [TRANSFER_TOPIC, topic(from), topic(to)],
  data: word(value),
  logIndex: `0x${(li++).toString(16)}`,
  transactionHash: hash,
  blockNumber: "0x64",
});
const tx = (fields: Partial<RawTx> = {}): RawTx => ({ hash: "0x01", from: A(0xe1), to: A(0xc1), value: "0x0", type: "0x2", blockNumber: "0x64", ...fields });
const ctx = { bases: BASES, bridges: new Set<Address>(), launchpads: new Map<Address, string>([[A(0xc1), "TestPad"]]), hypeUsd: 40 };

describe("transfer amounts", () => {
  it("formats raw units for message bubbles", () => {
    assert.equal(fmtUnits("1500000000000000000", 18), "1.5");
    assert.equal(fmtUnits("1234567000000000000000", 18), "1,234.567");
    assert.equal(fmtUnits("5", 18), "< 0.000001");
    assert.equal(fmtUnits("2500000", 6), "2.5");
  });
  it("describes a verified transfer for the stored message text", () => {
    assert.equal(describeTransfer({ amount: "250000000000000000", decimals: 18, symbol: "HYPE" }), "0.25 HYPE");
    assert.equal(describeTransfer({ amount: "42", decimals: 0, symbol: "PTS" }), "42 PTS");
  });
});

describe("elywake port: classifier", () => {
  it("native HYPE buy is a BUY sized by tx.value", () => {
    const trades = classifyTx(tx({ value: `0x${(60n * HYPE).toString(16)}` }), [transfer(A(0xd1), A(0xc2), A(0xe1), 5000n)], 1_700_000_000, ctx);
    assert.equal(trades.length, 1);
    assert.equal(trades[0].side, "BUY");
    assert.equal(trades[0].amountInHype, 60);
    assert.equal(trades[0].launchpad, "TestPad");
  });
  it("token out, WHYPE in is a SELL", () => {
    const trades = classifyTx(tx(), [transfer(A(0xd1), A(0xe1), A(0xc2), 50n), transfer(WHYPE, A(0xc2), A(0xe1), 7n * HYPE)], 1_700_000_000, ctx);
    assert.equal(trades[0].side, "SELL");
    assert.equal(trades[0].amountInHype, 7);
  });
});

describe("elywake port: detectors", () => {
  it("fires WHALE_BUY and FRESH_BUY, then ACCUMULATION on the third buy", () => {
    const d = new Detectors(THRESHOLDS);
    const fresh = { nonce: 1, nonceAtBlock: true, fundedBy: null, fundedAt: null, fundingKind: "unavailable" as const, fresh: true };
    const mk = (i: number, hype: number) => ({
      txHash: `0x0${i}` as Hex,
      logIndex: 0,
      blockNumber: 100 + i,
      blockTime: 1_700_000_000 + i * 60,
      wallet: A(0xe1),
      token: A(0xd1),
      side: "BUY" as const,
      amountToken: 1n,
      amountInHype: hype,
      baseAsset: "HYPE" as const,
      launchpad: "TestPad",
      txTo: A(0xc1),
      venue: A(0xc2),
    });
    const first = d.onBuy({ trade: mk(1, 80), facts: fresh, tokenSymbol: null, hypeUsd: 40 }).map((s) => s.type);
    assert.deepEqual(first.sort(), ["FRESH_BUY", "WHALE_BUY"]);
    d.onBuy({ trade: mk(2, 2), facts: { ...fresh, fresh: false }, tokenSymbol: null, hypeUsd: 40 });
    const third = d.onBuy({ trade: mk(3, 2), facts: { ...fresh, fresh: false }, tokenSymbol: null, hypeUsd: 40 }).map((s) => s.type);
    assert.deepEqual(third, ["ACCUMULATION"]);
  });
});

describe("swap routing", () => {
  it("hashes a V4 pool key like the PoolManager (abi.encode of the key)", () => {
    const id = poolId({ currency0: NATIVE, currency1: "0x063f7cc5339f92a5fd7baf3d22233044fda1f327", fee: 0x800000, tickSpacing: 200, hooks: "0x6b1216a40b65c83e9c9e18a562c446697b8cf8ec" });
    assert.match(id, /^0x[0-9a-f]{64}$/);
  });

  it("picks the venue that pays the most and applies slippage to the floor", async () => {
    const venue = (name: string, rate: bigint): Venue => ({
      id: name,
      name,
      router: A(1),
      spender: A(1),
      quote: async (_side, amountIn) => (amountIn * rate) / 1000n,
      tx: () => ({ to: A(1), data: "0x", value: 0n }),
    });
    const q = await quoteSwap(NATIVE, A(0xd1), 1000n * HYPE, 100, async () => [venue("thin", 900n), venue("deep", 950n)]);
    assert.ok(!("error" in q));
    if ("error" in q) return;
    assert.equal(q.legs[0].venue.name, "deep");
    assert.equal(q.out, 950n * HYPE);
    assert.equal(q.minOut, (950n * HYPE * 9900n) / 10_000n);
    assert.equal(q.impactBps, 0); // a linear quote has no price impact
  });

  it("routes token to token through HYPE, spending only the first leg's minimum", async () => {
    const venue: Venue = {
      id: "v",
      name: "V",
      router: A(1),
      spender: A(1),
      quote: async (_s, amountIn) => amountIn,
      tx: () => ({ to: A(1), data: "0x", value: 0n }),
    };
    const q = await quoteSwap(A(0xd1), A(0xd2), 1000n, 300, async () => [venue]);
    assert.ok(!("error" in q));
    if ("error" in q) return;
    assert.equal(q.legs.length, 2);
    assert.equal(q.legs[1].amountIn, q.legs[0].minOut);
  });

  it("finds the deepest V3 pool and builds a sell that unwraps WHYPE to the seller", async () => {
    const fam = V3_FAMILIES[0];
    const pool = A(0xbeef);
    const seller = A(0xe1);
    const token = A(0xd1);
    const reader = {
      call: async (to: string, data: Hex) => {
        // getPool(token, whype, 10000) on the BOXA V3 factory answers; every other probe reverts.
        if (to === fam.factory && data.startsWith("0x1698ee82") && data.endsWith("2710")) return word(BigInt(pool));
        if (to === fam.whype && data.startsWith("0x70a08231")) return word(5n * HYPE);
        return null;
      },
    };
    const venues = await findVenues(token, reader);
    assert.equal(venues.length, 1);
    assert.equal(venues[0].router, fam.router);
    const step = venues[0].tx("sell", 100n, 90n, seller, 9999n);
    assert.equal(step.value, 0n);
    const outer = decodeFunctionData({ abi: parseAbi(["function multicall(bytes[] data) payable returns (bytes[])"]), data: step.data });
    const calls = outer.args[0] as Hex[];
    assert.equal(calls.length, 2);
    const unwrap = decodeFunctionData({ abi: parseAbi(["function unwrapWETH9(uint256 amountMinimum, address recipient)"]), data: calls[1] });
    assert.deepEqual(unwrap.args, [90n, seller]);
  });
});
