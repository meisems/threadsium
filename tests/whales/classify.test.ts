import { describe, expect, it } from "./expect.ts";
import { keccak256, toBytes } from "viem";
import { classifyTx, TRANSFER_TOPIC, WITHDRAWAL_TOPIC } from "../../worker/whales/classify.ts";
import { A, ctx, GATEWAY, HYPE, POOL, POOL2, ROUTER, TOKEN, TOKEN2, transfer, tx, USDC, USER, WHYPE, withdrawal } from "./fixtures.ts";

const T = 1_700_000_000;

describe("event topics", () => {
  it("match the keccak of the event signatures (Transfer is the one the build prompt quotes)", () => {
    expect(TRANSFER_TOPIC).toBe("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
    expect(WITHDRAWAL_TOPIC).toBe(keccak256(toBytes("Withdrawal(address,uint256)")));
  });
});

describe("classifyTx", () => {
  it("native HYPE buy: tx.value spent, launch token received", () => {
    const trades = classifyTx(tx({ value: `0x${(12n * HYPE).toString(16)}` }), [transfer(TOKEN, POOL, USER, 5000n)], T, ctx());
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ side: "BUY", token: TOKEN, wallet: USER, amountInHype: 12, baseAsset: "HYPE", launchpad: "TestPad", amountToken: 5000n });
  });

  it("WHYPE buy: WHYPE sent by the wallet, launch token received", () => {
    const trades = classifyTx(tx({ to: A(0x999) }), [transfer(WHYPE, USER, POOL, 3n * HYPE), transfer(TOKEN, POOL, USER, 700n)], T, ctx());
    expect(trades[0]).toMatchObject({ side: "BUY", amountInHype: 3, baseAsset: "WHYPE", launchpad: "unknown" });
  });

  it("USDC buy converts with the HYPE price", () => {
    const trades = classifyTx(tx(), [transfer(USDC, USER, POOL, 400_000_000n), transfer(TOKEN, POOL, USER, 1n)], T, ctx(40));
    expect(trades[0]).toMatchObject({ side: "BUY", baseAsset: "USDC" });
    expect(trades[0].amountInHype).toBeCloseTo(10);
  });

  it("USDC buy without a price keeps the trade with no HYPE amount", () => {
    const trades = classifyTx(tx(), [transfer(USDC, USER, POOL, 400_000_000n), transfer(TOKEN, POOL, USER, 1n)], T, ctx(null));
    expect(trades[0]).toMatchObject({ side: "BUY", amountInHype: null });
  });

  it("multi-hop USDC -> WHYPE -> TOKEN counts only the wallet's net flows", () => {
    const logs = [
      transfer(USDC, USER, POOL, 80_000_000n), transfer(WHYPE, POOL, POOL2, 2n * HYPE), transfer(TOKEN, POOL2, USER, 999n),
    ];
    const trades = classifyTx(tx(), logs, T, ctx(40));
    expect(trades).toHaveLength(1);
    expect(trades[0].amountInHype).toBeCloseTo(2);
    expect(trades[0].baseAsset).toBe("USDC");
  });

  it("native HYPE in, refund unwrapped from WHYPE is netted out", () => {
    const logs = [transfer(TOKEN, POOL, USER, 10n), withdrawal(WHYPE, ROUTER, HYPE)];
    const trades = classifyTx(tx({ value: `0x${(5n * HYPE).toString(16)}` }), logs, T, ctx());
    expect(trades[0].amountInHype).toBeCloseTo(4);
  });

  it("sell to WHYPE and sell unwrapped to native HYPE", () => {
    const toWhype = classifyTx(tx(), [transfer(TOKEN, USER, POOL, 50n), transfer(WHYPE, POOL, USER, 7n * HYPE)], T, ctx());
    expect(toWhype[0]).toMatchObject({ side: "SELL", amountInHype: 7, baseAsset: "WHYPE" });
    const toNative = classifyTx(tx(), [transfer(TOKEN, USER, POOL, 50n), transfer(WHYPE, POOL, ROUTER, 2n * HYPE), withdrawal(WHYPE, ROUTER, 2n * HYPE)], T, ctx());
    expect(toNative[0]).toMatchObject({ side: "SELL", amountInHype: 2, baseAsset: "HYPE" });
  });

  it("bridge transfers are not trades", () => {
    expect(classifyTx(tx({ to: GATEWAY, value: "0x1" }), [transfer(TOKEN, A(0), USER, 1n)], T, ctx())).toEqual([]);
    expect(classifyTx(tx({ value: "0x10" }), [transfer(TOKEN, GATEWAY, USER, 1n)], T, ctx())).toEqual([]);
    expect(classifyTx(tx(), [transfer(TOKEN, USER, GATEWAY, 1n), transfer(WHYPE, POOL, USER, HYPE)], T, ctx())).toEqual([]);
  });

  it("ArbOS deposit and retryable transactions are not trades", () => {
    for (const type of ["0x64", "0x68", "0x69", "0x6a"] as const) expect(classifyTx(tx({ type, value: "0x10" }), [transfer(TOKEN, POOL, USER, 1n)], T, ctx())).toEqual([]);
  });

  it("plain token transfers and base-only swaps are not trades", () => {
    expect(classifyTx(tx(), [transfer(TOKEN, USER, A(0x5), 9n)], T, ctx())).toEqual([]);
    expect(classifyTx(tx({ value: "0x10" }), [transfer(WHYPE, POOL, A(0x5), 9n)], T, ctx())).toEqual([]);
    expect(classifyTx(tx(), [transfer(USDC, USER, POOL, 1_000_000n), transfer(WHYPE, POOL, USER, HYPE)], T, ctx())).toEqual([]);
  });

  it("a buy of two launch tokens splits the HYPE evenly, one trade per token", () => {
    const trades = classifyTx(tx({ value: `0x${(10n * HYPE).toString(16)}` }), [transfer(TOKEN, POOL, USER, 1n), transfer(TOKEN2, POOL2, USER, 2n)], T, ctx());
    expect(trades.map((trade) => [trade.token, trade.amountInHype])).toEqual([[TOKEN, 5], [TOKEN2, 5]]);
    expect(new Set(trades.map((trade) => trade.logIndex)).size).toBe(2);
  });

  it("ignores ERC-721 transfers (four topics) and removed logs", () => {
    const nft = { ...transfer(TOKEN, POOL, USER, 1n), topics: [TRANSFER_TOPIC, "0x00", "0x00", "0x01"] as `0x${string}`[] };
    expect(classifyTx(tx({ value: "0x10" }), [nft], T, ctx())).toEqual([]);
    expect(classifyTx(tx({ value: "0x10" }), [{ ...transfer(TOKEN, POOL, USER, 1n), removed: true }], T, ctx())).toEqual([]);
  });
});
