import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractTextTokens,
  fmtCompact,
  fmtPrice,
  normalizeRoomAddress,
  shortAddr,
  toCrossPlatformRoomId,
} from "../src/lib/format.ts";
import { buildCandles, type SwapSample } from "../src/lib/candles.ts";
import {
  getRememberedLogoUrl,
  rasterType,
  rememberLogoUrl,
  safeImageUrl,
  safeSvg,
} from "../worker/logo.ts";
import { weiToHype } from "../worker/launchpads.ts";
import { ELYSIUM_CHAIN } from "../src/config/chain.ts";
import { keccak256, toBytes } from "viem";
import {
  buildEmitterPlans,
  decodeLaunchLog,
  launchedTokenOf,
} from "../worker/launchIndex.ts";
import {
  iconCandidates,
  LAUNCH_EVENTS,
  LAUNCHPAD_REGISTRY,
  POOL_MANAGERS,
  launchpadById,
  launchpadOfPool,
  launchpadTokenOf,
} from "../src/config/launchpads.ts";
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

  it("registers all 11 V3 factories, 6 V4 PoolManagers, and 9 seeded tokens with valid 0x addresses", () => {
    assert.equal(V3_VENUES.length, 11);
    assert.equal(V4_MANAGERS.length, 6);
    assert.equal(SEEDED_TOKENS.length, 9);
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

describe("Elysium Launchpad Registry & Fast Logo Track", () => {
  it("keeps launchpad IDs unique, lowercase 0x addresses, and never links elyspump.com", () => {
    const ids = new Set<string>();
    assert.ok(LAUNCHPAD_REGISTRY.length >= 18);
    for (const lp of LAUNCHPAD_REGISTRY) {
      assert.equal(ids.has(lp.id), false, `duplicate id ${lp.id}`);
      ids.add(lp.id);
      if (lp.site) {
        assert.equal(lp.site.includes("elyspump.com"), false);
      }
      for (const c of lp.contracts) {
        assert.match(c.address, /^0x[0-9a-f]{40}$/);
      }
      if (lp.token) {
        assert.match(lp.token.address, /^0x[0-9a-f]{40}$/);
        assert.equal(launchpadTokenOf(lp.token.address)?.id, lp.id);
      }
    }
  });

  it("attributes pools by V4 hook, venue group, or factory address", () => {
    // Montra V4 hook on shared PoolManager
    assert.equal(
      launchpadOfPool(
        "shared-v4",
        "0x6b1216a40b65c83e9c9e18a562c446697b8cf8ec",
        null
      )?.id,
      "montra"
    );
    // Obol V4 hook on shared PoolManager
    assert.equal(
      launchpadOfPool(
        "shared-v4",
        "0xd096377596efd99e3a80431e31cea857c226eacc",
        null
      )?.id,
      "obol"
    );
    // Volta V4 hook
    assert.equal(
      launchpadOfPool(
        "shared-v4",
        "0x3ab88ddc3cf2a012af88b60828edb4553697e5dc",
        null
      )?.id,
      "volta"
    );
    // Kleos by group
    assert.equal(launchpadOfPool("kleos-v4", null, null)?.id, "kleos");
    // Lookup by name or id
    assert.equal(launchpadById("BOXA")?.id, "boxa");
  });

  it("extracts apple-touch-icon and raster icon candidates from launchpad HTML", () => {
    const html = `
      <html><head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="icon" type="image/png" href="/icon-32.png" />
        <link rel="apple-touch-icon" href="https://cdn.example.com/touch.png" />
      </head></html>
    `;
    const list = iconCandidates(html, "https://boxa.club");
    assert.deepEqual(list, [
      "https://cdn.example.com/touch.png",
      "https://boxa.club/icon-32.png",
    ]);
  });

  it("remembers discovered token logo URLs in the Fast-Track memory map and blocks unsafe domains", () => {
    const addr = "0x51c343ed5131f17895991849860b61c2cb0e7e7a";
    rememberLogoUrl(addr, "https://www.thekleos.pro/logos/kleos.png");
    assert.equal(
      getRememberedLogoUrl(addr),
      "https://www.thekleos.pro/logos/kleos.png"
    );
    assert.equal(safeImageUrl("https://elyspump.com/logo.png"), null);
    assert.equal(safeImageUrl("http://localhost/logo.png"), null);
    assert.ok(Math.abs(weiToHype("25500000000000000000") - 25.5) < 1e-6);
  });
});

describe("Text token & entity extraction", () => {
  it("extracts $TICKER, 0x contract addresses, and #hashtags accurately", () => {
    const sample =
      "Watching $KNTQ and $boxa liquidity on 0xa3c1d6a8648df3978a38ce1478fbc284c75d95d7 #Elysium #99901_Trench";
    const res = extractTextTokens(sample);
    assert.deepEqual(res.tickers, ["KNTQ", "BOXA"]);
    assert.deepEqual(res.addresses, [
      "0xa3c1d6a8648df3978a38ce1478fbc284c75d95d7",
    ]);
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
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    const jpg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const html = new TextEncoder().encode(
      "<!doctype html><script>alert(1)</script>"
    );
    assert.equal(rasterType(png), "image/png");
    assert.equal(rasterType(jpg), "image/jpeg");
    assert.equal(rasterType(html), null);
  });

  it("rejects SVGs containing scripts or event handlers", () => {
    const enc = new TextEncoder();
    assert.equal(
      safeSvg(
        enc.encode(
          '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>'
        )
      ),
      true
    );
    assert.equal(
      safeSvg(
        enc.encode(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        )
      ),
      false
    );
    assert.equal(
      safeSvg(
        enc.encode(
          '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'
        )
      ),
      false
    );
  });
});

describe("Cross-platform token room normalization", () => {
  it("normalizes 0x..., 99901-0x..., and 99901:0x... into one shared room address", () => {
    const kntq = "0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0";
    assert.equal(
      normalizeRoomAddress("0xE45A355d9e9cad2ad85f2d03e3ee3102a036acf0"),
      kntq
    );
    assert.equal(
      normalizeRoomAddress("99901-0xE45A355d9e9cad2ad85f2d03e3ee3102a036acf0"),
      kntq
    );
    assert.equal(
      normalizeRoomAddress("99901:0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0"),
      kntq
    );
    assert.equal(toCrossPlatformRoomId(kntq), `99901-${kntq}`);
    assert.equal(normalizeRoomAddress("not-an-address"), null);
  });
});

describe("On-chain launch index", () => {
  const word = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");
  const addrTopic = (a: string) => `0x${word(a)}`;

  it("keeps event topics equal to keccak256 of their signatures", () => {
    for (const spec of Object.values(LAUNCH_EVENTS)) {
      assert.equal(keccak256(toBytes(spec.signature)), spec.topic0);
    }
  });

  it("gives every launch source a lowercase emitter, a hook for V4, and a start block", () => {
    for (const lp of LAUNCHPAD_REGISTRY) {
      for (const s of lp.launchSources) {
        assert.match(s.emitter, /^0x[0-9a-f]{40}$/, `${lp.id} emitter`);
        assert.ok(Number.isInteger(s.startBlock) && s.startBlock >= 0, `${lp.id} startBlock`);
        if (s.event === "v4-initialize") assert.match(s.hook ?? "", /^0x[0-9a-f]{40}$/, `${lp.id} hook`);
        if (s.hook) assert.equal(launchpadOfPool(null, s.hook, null)?.id, lp.id, `${lp.id} hook attribution`);
      }
    }
    // Every launchpad with a verified launch contract is indexed; the shared PoolManager is scanned once.
    const plans = buildEmitterPlans();
    const shared = plans.filter((p) => p.emitter === POOL_MANAGERS.shared);
    assert.equal(shared.length, 1);
    for (const id of ["montra", "ascend", "volta", "mesa", "perpme", "stockium", "obol"]) {
      assert.ok([...shared[0].hooks.values()].includes(id), id);
    }
    assert.ok(LAUNCHPAD_REGISTRY.filter((lp) => lp.launchSources.length > 0).length >= 16);
  });

  it("picks the launched side of a pool and skips quote-only pools", () => {
    const token = "0x857289b98a6c7845dde621df3b4cd591bc4cf188";
    const zero = "0x0000000000000000000000000000000000000000";
    const whype = "0xba876237b0f021a6c6d852d6c26e107997cc5e81";
    const kleos = "0x51c343ed5131f17895991849860b61c2cb0e7e7a";
    const kntq = "0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0";
    assert.equal(launchedTokenOf(zero, token), token);
    assert.equal(launchedTokenOf(token, whype), token);
    assert.equal(launchedTokenOf(kleos, token), token);
    assert.equal(launchedTokenOf(zero, kntq), null);
    assert.equal(launchedTokenOf(whype, zero), null);
  });

  it("decodes Initialize by hook and PoolCreated by factory into launches", () => {
    const plans = buildEmitterPlans();
    const shared = plans.find((p) => p.emitter === POOL_MANAGERS.shared)!;
    const token = "0x857289b98a6c7845dde621df3b4cd591bc4cf188";
    const poolId = `0x${"ab".repeat(32)}`;
    const montraHook = "0x6b1216a40b65c83e9c9e18a562c446697b8cf8ec";
    const v4Log = {
      address: POOL_MANAGERS.shared,
      topics: [LAUNCH_EVENTS["v4-initialize"].topic0, poolId, addrTopic("0x0"), addrTopic(token)],
      data: `0x${word("2710")}${word("c8")}${word(montraHook)}${word("1")}${word("0")}`,
      blockNumber: "0x9c4f0",
    };
    assert.deepEqual(decodeLaunchLog(shared, v4Log), {
      launchpadId: "montra",
      token,
      pool: `${POOL_MANAGERS.shared}:${poolId}`,
      emitter: POOL_MANAGERS.shared,
      block: 640240,
    });
    const unknownHook = { ...v4Log, data: `0x${word("2710")}${word("c8")}${word("0x1234")}${word("1")}${word("0")}` };
    assert.equal(decodeLaunchLog(shared, unknownHook), null);

    const chainzy = plans.find((p) => p.emitter === "0x4f6cf2793119141c886544a4bca617ec906635b1")!;
    const pool = "0x00000000000000000000000000000000000000aa";
    const v3Log = {
      address: chainzy.emitter,
      topics: [
        LAUNCH_EVENTS["v3-pool-created"].topic0,
        addrTopic(token),
        addrTopic("0xba876237b0f021a6c6d852d6c26e107997cc5e81"),
        addrTopic("2710"),
      ],
      data: `0x${word("c8")}${word(pool)}`,
      blockNumber: "0xdc9",
    };
    assert.equal(decodeLaunchLog(chainzy, v3Log)?.launchpadId, "chainzy");
    assert.equal(decodeLaunchLog(chainzy, v3Log)?.pool, pool);
  });
});

import {
  BASIC_LIMITS,
  MAX_LIMITS,
  PREMIUM,
  PREMIUM_LIMITS,
  isBadgeImageUrl,
  tierForBalance,
  cleanBadgeColor,
  cleanBadgeIcon,
  cleanEmoji,
  formatUnits2,
  isPremiumUntil,
  limitsFor,
  meetsThreshold,
  resolveBadge,
} from "../src/config/premium.ts";

describe("Threadsium Premium", () => {
  it("requires 1,000,000 whole tokens at the token's decimals", () => {
    assert.equal(PREMIUM.minTokens, 1_000_000);
    const one18 = 10n ** 18n;
    assert.equal(meetsThreshold(1_000_000n * one18, 18), true);
    assert.equal(meetsThreshold(1_000_000n * one18 - 1n, 18), false);
    assert.equal(meetsThreshold(1_000_000n * 10n ** 6n, 6), true);
    assert.equal(meetsThreshold(999_999n * 10n ** 6n, 6), false);
  });

  it("formats balances to two decimals", () => {
    assert.equal(formatUnits2(1_234_567n * 10n ** 18n + 5n * 10n ** 17n, 18), "1234567.50");
    assert.equal(formatUnits2(42n, 0), "42");
  });

  it("premium is active only while premium_until is in the future", () => {
    assert.equal(isPremiumUntil(null), false);
    assert.equal(isPremiumUntil(1000, 999), true);
    assert.equal(isPremiumUntil(1000, 1000), false);
  });

  it("each tier's limits are strictly higher than the one below", () => {
    for (const k of Object.keys(BASIC_LIMITS) as (keyof typeof BASIC_LIMITS)[]) {
      assert.ok(PREMIUM_LIMITS[k] > BASIC_LIMITS[k], k);
      assert.ok(MAX_LIMITS[k] > PREMIUM_LIMITS[k], k);
    }
    assert.equal(limitsFor(null), BASIC_LIMITS);
    assert.equal(limitsFor({ tier: "basic" }), BASIC_LIMITS);
    assert.equal(limitsFor({ tier: "premium" }), PREMIUM_LIMITS);
    assert.equal(limitsFor({ tier: "max" }), MAX_LIMITS);
  });

  it("maps balances to tiers at 1M and 10M", () => {
    assert.equal(PREMIUM.maxMinTokens, 10_000_000);
    const d = 18n;
    const w = (n: bigint) => n * 10n ** d;
    assert.equal(tierForBalance(w(999_999n), 18), "basic");
    assert.equal(tierForBalance(w(1_000_000n), 18), "premium");
    assert.equal(tierForBalance(w(10_000_000n) - 1n, 18), "premium");
    assert.equal(tierForBalance(w(10_000_000n), 18), "max");
  });

  it("only Premium Max can show a picture badge or tinted name", () => {
    const img = "/api/media/badges/1700000000000-abc123.gif";
    assert.equal(isBadgeImageUrl(img), true);
    assert.equal(isBadgeImageUrl("/api/media/avatars/1-a.png"), false);
    assert.equal(isBadgeImageUrl("https://evil.example/x.png"), false);
    assert.deepEqual(resolveBadge("img", "gold", img, true, "max"), { icon: "img", color: "gold", image: img, tintName: true });
    assert.deepEqual(resolveBadge("img", "gold", img, true, "premium"), { icon: "check", color: "gold" });
    assert.deepEqual(resolveBadge("img", "gold", null, false, "max"), { icon: "check", color: "gold" });
    assert.equal(cleanBadgeIcon("img"), "img");
  });

  it("accepts known glyphs and single emoji, rejects everything else", () => {
    assert.equal(cleanBadgeIcon("check"), "check");
    assert.equal(cleanBadgeIcon("crown"), "crown");
    assert.equal(cleanBadgeIcon("e:🔥"), "e:🔥");
    assert.equal(cleanBadgeIcon("e:👨‍👩‍👧"), "e:👨‍👩‍👧");
    assert.equal(cleanBadgeIcon("e:🇺🇸"), "e:🇺🇸");
    assert.equal(cleanBadgeIcon("e:🔥🔥"), null);
    assert.equal(cleanBadgeIcon("e:A"), null);
    assert.equal(cleanBadgeIcon("e:<script>"), null);
    assert.equal(cleanBadgeIcon("skull"), null);
    assert.equal(cleanBadgeIcon(42), null);
    assert.equal(cleanEmoji("  💎 "), "💎");
    assert.equal(cleanBadgeColor("blue"), "blue");
    assert.equal(cleanBadgeColor("constructor"), null);
    assert.equal(cleanBadgeColor("#fff"), null);
  });

  it("falls back to the blue check for unset or stale badge choices", () => {
    assert.deepEqual(resolveBadge(null, null), { icon: "check", color: "blue" });
    assert.deepEqual(resolveBadge("retired-glyph", "mauve"), { icon: "check", color: "blue" });
    assert.deepEqual(resolveBadge("e:🐋", "gold"), { icon: "e:🐋", color: "gold" });
  });
});
