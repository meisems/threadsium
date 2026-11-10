import { rpcRequest } from "./rpc";
import { SwapSample } from "./candles";
import { CANONICAL_WHYPE, V3_POOL_CREATED_TOPIC, V3_SWAP_TOPIC, V3_VENUES } from "../config/venues";
import { V4_INITIALIZE_TOPIC, V4_MANAGERS, V4_SWAP_TOPIC } from "../config/v4";

function unpadAddr(wordHex: string): string {
  return `0x${wordHex.slice(-40).toLowerCase()}`;
}

function parseSigned256(wordHex: string): bigint {
  const clean = wordHex.replace(/^0x/, "");
  if (!clean) return 0n;
  const val = BigInt(`0x${clean}`);
  const maxPos = (1n << 255n) - 1n;
  return val > maxPos ? val - (1n << 256n) : val;
}

function parseUnsigned(wordHex: string): bigint {
  const clean = wordHex.replace(/^0x/, "");
  return clean ? BigInt(`0x${clean}`) : 0n;
}

function sqrtPriceX96ToPrice(
  sqrtPriceX96: bigint,
  dec0: number,
  dec1: number
): number {
  if (sqrtPriceX96 <= 0n) return 0;
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  const rawPrice = ratio * ratio;
  const decAdj = 10 ** (dec0 - dec1);
  return rawPrice * decAdj;
}

export async function fetchTokenSwapSamples(
  tokenAddress: string,
  decimals = 18
): Promise<{
  samples: SwapSample[];
  latestPriceHype: number | null;
  activeVenues: string[];
}> {
  const target = tokenAddress.toLowerCase();
  const whypeSet = new Set<string>([
    CANONICAL_WHYPE.toLowerCase(),
    "0x0000000000000000000000000000000000000000",
    ...V3_VENUES.map((v) => v.whype.toLowerCase()),
  ]);

  const hexLatest = await rpcRequest<string>("eth_blockNumber", []);
  const latestBlock = parseInt(hexLatest, 16);
  const toBlockHex = `0x${latestBlock.toString(16)}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const blockTimeSec = 1.0; // Elysium ~1s block cadence

  const samples: SwapSample[] = [];
  const activeVenues = new Set<string>();

  // 1. Discover V3 pools pairing target token with WHYPE
  const factories = V3_VENUES.map((v) => v.factory);
  const v3CreateLogs = await rpcRequest<any[]>("eth_getLogs", [
    {
      fromBlock: "0x1",
      toBlock: toBlockHex,
      address: factories,
      topics: [V3_POOL_CREATED_TOPIC],
    },
  ]).catch(() => []);

  const matchedPools: Array<{
    pool: string;
    token0: string;
    token1: string;
    venueName: string;
  }> = [];

  for (const log of v3CreateLogs || []) {
    if (!Array.isArray(log.topics) || log.topics.length < 3) continue;
    const t0 = unpadAddr(log.topics[1]);
    const t1 = unpadAddr(log.topics[2]);
    if (t0 !== target && t1 !== target) continue;
    const other = t0 === target ? t1 : t0;
    if (!whypeSet.has(other)) continue;
    const data = String(log.data || "").replace(/^0x/, "");
    if (data.length < 128) continue;
    const pool = `0x${data.slice(88, 128).toLowerCase()}`;
    const fac = String(log.address || "").toLowerCase();
    const venue = V3_VENUES.find((v) => v.factory.toLowerCase() === fac);
    matchedPools.push({
      pool,
      token0: t0,
      token1: t1,
      venueName: venue ? venue.shortName : "V3 Pool",
    });
  }

  // Fetch recent swaps from matched V3 pools
  if (matchedPools.length > 0) {
    const fromBlock = Math.max(1, latestBlock - 9500);
    const swapLogs = await rpcRequest<any[]>("eth_getLogs", [
      {
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: toBlockHex,
        address: matchedPools.map((p) => p.pool),
        topics: [V3_SWAP_TOPIC],
      },
    ]).catch(() => []);

    const poolMap = new Map(matchedPools.map((p) => [p.pool, p]));
    for (const log of swapLogs || []) {
      const p = poolMap.get(String(log.address || "").toLowerCase());
      if (!p) continue;
      const data = String(log.data || "").replace(/^0x/, "");
      if (data.length < 192) continue;
      const amount0 = parseSigned256(data.slice(0, 64));
      const amount1 = parseSigned256(data.slice(64, 128));
      const sqrtPriceX96 = parseUnsigned(data.slice(128, 192));
      const isToken0 = p.token0 === target;
      const rawP = sqrtPriceX96ToPrice(
        sqrtPriceX96,
        isToken0 ? decimals : 18,
        isToken0 ? 18 : decimals
      );
      const priceHype = isToken0 ? rawP : rawP > 0 ? 1 / rawP : 0;
      if (!Number.isFinite(priceHype) || priceHype <= 0) continue;

      const whypeDelta = isToken0 ? amount1 : amount0;
      const volWhype = Math.abs(Number(whypeDelta)) / 1e18;
      const side: "buy" | "sell" = whypeDelta > 0n ? "buy" : "sell";
      const blk = parseInt(String(log.blockNumber || "0x0"), 16);
      const logIdx = parseInt(String(log.logIndex || "0x0"), 16);
      const estTs = Math.max(
        nowSec - 86400 * 14,
        Math.round(nowSec - Math.max(0, latestBlock - blk) * blockTimeSec)
      );

      activeVenues.add(p.venueName);
      samples.push({
        txHash: String(log.transactionHash || "0x"),
        blockNumber: blk,
        logIndex: logIdx,
        timestamp: estTs,
        priceHype,
        volumeWhype: volWhype,
        side,
        venue: p.venueName,
      });
    }
  }

  // 2. Discover V4 pools pairing target token with WHYPE/native HYPE
  const v4Addresses = V4_MANAGERS.map((m) => m.poolManager);
  const v4InitLogs = await rpcRequest<any[]>("eth_getLogs", [
    {
      fromBlock: "0x1",
      toBlock: toBlockHex,
      address: v4Addresses,
      topics: [V4_INITIALIZE_TOPIC],
    },
  ]).catch(() => []);

  const matchedV4Ids: Array<{
    poolId: string;
    manager: string;
    c0: string;
    c1: string;
    venueName: string;
  }> = [];

  for (const log of v4InitLogs || []) {
    if (!Array.isArray(log.topics) || log.topics.length < 4) continue;
    const poolId = String(log.topics[1]).toLowerCase();
    const c0 = unpadAddr(log.topics[2]);
    const c1 = unpadAddr(log.topics[3]);
    if (c0 !== target && c1 !== target) continue;
    const other = c0 === target ? c1 : c0;
    if (!whypeSet.has(other)) continue;
    const mgrAddr = String(log.address || "").toLowerCase();
    const mgr = V4_MANAGERS.find((m) => m.poolManager.toLowerCase() === mgrAddr);
    matchedV4Ids.push({
      poolId,
      manager: mgrAddr,
      c0,
      c1,
      venueName: mgr ? mgr.shortName : "V4 Pool",
    });
  }

  if (matchedV4Ids.length > 0) {
    const fromBlock = Math.max(1, latestBlock - 9500);
    const v4SwapLogs = await rpcRequest<any[]>("eth_getLogs", [
      {
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: toBlockHex,
        address: Array.from(new Set(matchedV4Ids.map((m) => m.manager))),
        topics: [V4_SWAP_TOPIC, matchedV4Ids.map((m) => m.poolId)],
      },
    ]).catch(() => []);

    const v4Map = new Map(matchedV4Ids.map((m) => [m.poolId, m]));
    for (const log of v4SwapLogs || []) {
      if (!Array.isArray(log.topics) || log.topics.length < 2) continue;
      const poolId = String(log.topics[1]).toLowerCase();
      const meta = v4Map.get(poolId);
      if (!meta) continue;
      const data = String(log.data || "").replace(/^0x/, "");
      if (data.length < 192) continue;
      const amount0 = parseSigned256(data.slice(0, 64));
      const amount1 = parseSigned256(data.slice(64, 128));
      const sqrtPriceX96 = parseUnsigned(data.slice(128, 192));
      const isToken0 = meta.c0 === target;
      const rawP = sqrtPriceX96ToPrice(
        sqrtPriceX96,
        isToken0 ? decimals : 18,
        isToken0 ? 18 : decimals
      );
      const priceHype = isToken0 ? rawP : rawP > 0 ? 1 / rawP : 0;
      if (!Number.isFinite(priceHype) || priceHype <= 0) continue;

      const whypeDelta = isToken0 ? amount1 : amount0;
      const volWhype = Math.abs(Number(whypeDelta)) / 1e18;
      // In V4 Swap event, negative delta on output currency means pool sent out currency
      const side: "buy" | "sell" = whypeDelta < 0n ? "sell" : "buy";
      const blk = parseInt(String(log.blockNumber || "0x0"), 16);
      const logIdx = parseInt(String(log.logIndex || "0x0"), 16);
      const estTs = Math.max(
        nowSec - 86400 * 14,
        Math.round(nowSec - Math.max(0, latestBlock - blk) * blockTimeSec)
      );

      activeVenues.add(meta.venueName);
      samples.push({
        txHash: String(log.transactionHash || "0x"),
        blockNumber: blk,
        logIndex: logIdx,
        timestamp: estTs,
        priceHype,
        volumeWhype: volWhype,
        side,
        venue: meta.venueName,
      });
    }
  }

  samples.sort((a, b) => a.timestamp - b.timestamp || a.logIndex - b.logIndex);
  const latestPriceHype =
    samples.length > 0 ? samples[samples.length - 1].priceHype : null;

  return {
    samples,
    latestPriceHype,
    activeVenues: Array.from(activeVenues),
  };
}
