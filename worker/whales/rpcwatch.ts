// RPC watchdog. Elysium makes about 14 blocks a second, so when neither the chain head we read nor the indexing cursor
// has moved for IDLE_MS (6 s), the endpoint in use is stuck, frozen on an old block, or too slow. Then every endpoint
// is asked for its latest block at once and the indexer moves to the one furthest ahead. Request errors are already
// failed over per request by Rpc.send; this catches the endpoint that keeps answering but stops moving.
//
// Switching rules (to avoid flapping between endpoints that are a few blocks apart):
//   - the current endpoint failed the probe, or answered a head no newer than the last one seen (frozen), and another
//     endpoint is ahead: switch;
//   - otherwise switch only when another endpoint is ahead by more than about 3 s of blocks;
//   - otherwise, prefer speed: move to an endpoint within about 1 s of blocks of the current one that answers at least
//     twice as fast and at least 150 ms sooner, judged on a running average of probe times (at least two samples each),
//     because each tick makes several RPC round trips one after another and a slow endpoint adds seconds of lag.
// A check runs at most once per COOLDOWN_MS (each check costs one subrequest per endpoint).

import type { Probe, Rpc } from "./client.ts";

export const IDLE_MS = 6_000;
export const COOLDOWN_MS = 20_000;

export interface RpcCheck {
  at: number; reason: string; switched: boolean; from: string; to: string;
  probes: { host: string; head: number | null; ms: number; error: string | null }[];
}

export const FASTER_RATIO = 2;
export const FASTER_MIN_MS = 150;
export const MIN_SAMPLES = 2;
export interface Speed { ms: number; samples: number }

/** Picks the endpoint to use from one round of probes; null = stay. Pure, for tests. `speed` holds smoothed probe
 *  times per endpoint index (including this round); without it, no speed-based switch is made. */
export function choose(probes: Probe[], current: number, lastHead: number, blocksPerSecond: number, speed?: Map<number, Speed>): { index: number; why: string } | null {
  const answered = probes.filter((probe) => probe.head !== null) as (Probe & { head: number })[];
  if (!answered.length) return null;
  const best = answered.reduce((a, b) => (b.head > a.head || (b.head === a.head && b.ms < a.ms) ? b : a));
  const mine = probes.find((probe) => probe.index === current);
  if (!mine || mine.head === null) return best.index === current ? null : { index: best.index, why: `current endpoint failed (${mine?.error ?? "no answer"})` };
  if (best.index !== current && mine.head <= lastHead && best.head > lastHead) return { index: best.index, why: `current endpoint frozen at block ${mine.head}` };
  const margin = Math.max(3, Math.round(blocksPerSecond * 3));
  if (best.index !== current && best.head - mine.head > margin) return { index: best.index, why: `current endpoint ${best.head - mine.head} blocks behind` };
  // Speed: among endpoints no more than ~1 s of blocks behind the current one, the fastest on the running average.
  const mySpeed = speed?.get(current);
  if (!speed || !mySpeed || mySpeed.samples < MIN_SAMPLES) return null;
  const tolerance = Math.max(2, Math.round(blocksPerSecond));
  const myHead = mine.head;
  const quick = answered
    .filter((probe) => probe.index !== current && probe.head >= myHead - tolerance)
    .map((probe) => ({ probe, avg: speed.get(probe.index) }))
    .filter((item): item is { probe: Probe & { head: number }; avg: Speed } => Boolean(item.avg && item.avg.samples >= MIN_SAMPLES))
    .sort((a, b) => a.avg.ms - b.avg.ms)[0];
  if (quick && quick.avg.ms * FASTER_RATIO <= mySpeed.ms && mySpeed.ms - quick.avg.ms >= FASTER_MIN_MS) {
    return { index: quick.probe.index, why: `faster: ${Math.round(quick.avg.ms)} ms vs ${Math.round(mySpeed.ms)} ms on average` };
  }
  return null;
}

export class RpcWatch {
  private lastHead = 0;
  private lastCursor = 0;
  private headMovedAt: number;
  private cursorMovedAt: number;
  /** No check yet: the first idle spell may check at once. */
  private lastCheckAt = Number.NEGATIVE_INFINITY;
  switches = 0;
  /** Smoothed probe time per endpoint index (exponential average, half weight to the newest sample). */
  readonly speed = new Map<number, Speed>();
  checks = 0;
  last: RpcCheck | null = null;

  private readonly rpc: Rpc;
  private readonly now: () => number;
  private readonly idleMs: number;
  private readonly cooldownMs: number;
  constructor(rpc: Rpc, now: () => number = Date.now, idleMs = IDLE_MS, cooldownMs = COOLDOWN_MS) {
    this.rpc = rpc; this.now = now; this.idleMs = idleMs; this.cooldownMs = cooldownMs;
    this.headMovedAt = this.cursorMovedAt = now();
  }

  /** Record what the last tick saw. */
  observe(head: number, cursor: number | null) {
    const now = this.now();
    if (head > this.lastHead) { this.lastHead = head; this.headMovedAt = now; }
    if (cursor !== null && cursor > this.lastCursor) { this.lastCursor = cursor; this.cursorMovedAt = now; }
  }

  /** Milliseconds since the head or the cursor last moved, whichever is longer. */
  idleFor() { const now = this.now(); return Math.max(now - this.headMovedAt, now - this.cursorMovedAt); }

  due() { return this.idleFor() > this.idleMs && this.now() - this.lastCheckAt >= this.cooldownMs; }

  /** Probe all endpoints and switch when another is clearly better. Returns true when it switched. */
  async check(blocksPerSecond: number): Promise<boolean> {
    if (this.rpc.endpoints.length < 2) { this.lastCheckAt = this.now(); return false; }
    const idle = this.idleFor();
    this.lastCheckAt = this.now(); this.checks++;
    const current = this.rpc.preferredIndex;
    const probes = await this.rpc.probe();
    for (const probe of probes) {
      if (probe.head === null) { this.speed.delete(probe.index); continue; } // a failure resets its average
      const before = this.speed.get(probe.index);
      this.speed.set(probe.index, before ? { ms: before.ms * 0.5 + probe.ms * 0.5, samples: before.samples + 1 } : { ms: probe.ms, samples: 1 });
    }
    const pick = choose(probes, current, this.lastHead, blocksPerSecond, this.speed);
    if (pick) {
      this.rpc.use(pick.index); this.switches++;
      // The new endpoint gets a fresh idle window.
      this.headMovedAt = this.cursorMovedAt = this.now();
    }
    this.last = {
      at: this.lastCheckAt, reason: `idle ${(idle / 1000).toFixed(1)} s${pick ? `; ${pick.why}` : ""}`, switched: Boolean(pick),
      from: this.rpc.hostOf(current), to: this.rpc.hostOf(pick ? pick.index : current),
      probes: probes.map(({ host, head, ms, error }) => ({ host, head, ms, error })),
    };
    return Boolean(pick);
  }
}
