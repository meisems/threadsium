import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractTextTokens, fmtCompact, fmtPrice, normalizeRoomAddress, shortAddr, toCrossPlatformRoomId } from "../src/lib/format.ts";
import { buildCandles, type SwapSample } from "../src/lib/candles.ts";
import { rasterType, safeSvg } from "../worker/logo.ts";
import { ELYSIUM_CHAIN } from "../src/config/chain.ts";
import { SEEDED_TOKENS } from "../src/config/tokens.ts";
import { V3_VENUES } from "../src/config/venues.ts";
import { V4_MANAGERS } from "../src/config/v4.ts";

describe("Elysium 99901 configuration & registries", () => {
  it("uses provisional chain ID 99901 (0x1863d) and Kinetiq primary RPC", () => {
    assert.equal(ELYSIUM_CHAIN.id, 99901);
    assert.equal(ELYSIUM_CHAIN.hexId, "0x1863d");
    assert.equal(ELYSIUM_CHAIN.provisional, true);
    assert.equal(ELYSIUM_CHAIN.rpcPrimary, "https://rpc.elysium.kinetiq.xyz");
  });

  it("registers all 7 V3 factories, 6 V4 PoolManagers, and 7 seeded tokens with valid 0x addresses", () => {
    assert.equal(V3_VENUES.length, 7);
    assert.equal(V4_MANAGERS.length, 6);
    assert.equal(SEEDED_TOKENS.length, 7);
    for (const v of V3_VENUES) {
      assert.match(v.factory, /^0x[a-fA-F0-9]{40}$/);
      assert.match(v.whype, /^0x[a-fA-F0-9]{40}$/);
    }
    for (const m of V4_MANAGERS) {
      assert.match(m.poolManager, /^0x[a-fA-F0-9]{40}$/);
    }
    for (const t of SEEDED_TOKENS) {
      assert.match(t.address, /^0x[a-fA-F0-9]{40}$/);
      assert.equal(t.launchpadUrl.includes("elyspump.com"), false);
    }
  });
});

describe("Text token & entity extraction", () => {
  it("extracts $TICKER, 0x contract addresses, and #hashtags accurately", () => {
    const sample =
      "Watching $KNTQ and $boxa liquidity on 0xa3c1d6a8648df3978a38ce1478fbc284c75d95d7 #Elysium #99901_Trench";
    const res = extractTextTokens(sample);
    assert.deepEqual(res.tickers, ["KNTQ", "BOXA"]);
    assert.deepEqual(res.addresses, ["0xa3c1d6a8648df3978a38ce1478fbc284c75d95d7"]);
    assert.deepEqual(res.hashtags, ["elysium", "99901_trench"]);
  });

  it("formats compact numbers, prices, and addresses cleanly", () => {
    assert.equal(
      shortAddr("0xa3c1d6a8648df3978a38ce1478fbc284c75d95d7", 6, 4),
      "0xa3c1…95d7"
    );
    assert.equal(fmtCompact(12500, 1), "12.5K");
    assert.equal(fmtPrice(0.0425), "0.042500");
  });
});

describe("On-chain Swap OHLCV candle builder", () => {
  it("aggregates Swap samples into sorted OHLCV buckets", () => {
    const samples: SwapSample[] = [
      {
        txHash: "0x1",
        blockNumber: 100,
        logIndex: 0,
        timestamp: 1700000045,
        priceHype: 0.1,
        volumeWhype: 5,
        side: "buy",
        venue: "BOXA V3",
      },
      {
        txHash: "0x2",
        blockNumber: 101,
        logIndex: 1,
        timestamp: 1700000060,
        priceHype: 0.15,
        volumeWhype: 10,
        side: "buy",
        venue: "BOXA V3",
      },
      {
        txHash: "0x3",
        blockNumber: 102,
        logIndex: 0,
        timestamp: 1700000085,
        priceHype: 0.08,
        volumeWhype: 3,
        side: "sell",
        venue: "BOXA V3",
      },
    ];
    const bars = buildCandles(samples, "1m", 1);
    assert.equal(bars.length, 1);
    assert.ok(Math.abs(bars[0].open - 0.1) < 1e-6);
    assert.ok(Math.abs(bars[0].high - 0.15) < 1e-6);
    assert.ok(Math.abs(bars[0].low - 0.08) < 1e-6);
    assert.ok(Math.abs(bars[0].close - 0.08) < 1e-6);
    assert.ok(Math.abs(bars[0].volume - 18) < 1e-6);
  });
});

describe("Upload & logo magic-byte security checks", () => {
  it("accepts valid PNG/JPEG/GIF/WebP magic bytes and rejects arbitrary bytes", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
    assert.equal(rasterType(png), "image/png");
    assert.equal(rasterType(jpg), "image/jpeg");
    assert.equal(rasterType(html), null);
  });

  it("rejects SVGs containing scripts or event handlers", () => {
    const enc = new TextEncoder();
    assert.equal(
      safeSvg(enc.encode('<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>')),
      true
    );
    assert.equal(
      safeSvg(
        enc.encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
      ),
      false
    );
    assert.equal(
      safeSvg(
        enc.encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')
      ),
      false
    );
  });
});

describe("Cross-platform token room normalization", () => {
  it("normalizes 0x..., 99901-0x..., and 99901:0x... into one shared room address", () => {
    const kntq = "0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0";
    assert.equal(normalizeRoomAddress("0xE45A355d9e9cad2ad85f2d03e3ee3102a036acf0"), kntq);
    assert.equal(normalizeRoomAddress("99901-0xE45A355d9e9cad2ad85f2d03e3ee3102a036acf0"), kntq);
    assert.equal(normalizeRoomAddress("99901:0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0"), kntq);
    assert.equal(toCrossPlatformRoomId(kntq), `99901-${kntq}`);
    assert.equal(normalizeRoomAddress("not-an-address"), null);
  });
});
