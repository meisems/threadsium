import { describe, expect, it } from "./expect.ts";
import { classifyTx } from "../../worker/whales/classify.ts";
import type { LaunchpadBook } from "../../worker/whales/config.ts";
import { LaunchpadResolver } from "../../worker/whales/launchpads.ts";
import { Rpc } from "../../worker/whales/client.ts";
import type { Address } from "../../worker/whales/types.ts";
import { A, buy, ctx, HYPE, POOL, ROUTER, TOKEN, transfer, tx, USER, WHYPE } from "./fixtures.ts";

const PM = A(0x4d); const HOOK = A(0x40c); const FACTORY = A(0xfac); const PAD_PM = A(0x99); const V3POOL = A(0x33);
const book: LaunchpadBook = {
  venues: new Map([[PAD_PM, "PadV4"], [FACTORY, "PadV3"]]),
  sharedPoolManagers: new Map([[PM, "Uniswap V4"]]),
  hooks: new Map([[HOOK, "HookPad"]]),
  routers: new Map([[ROUTER, "RouterPad"]]),
};
const word = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;

/** A fake JSON-RPC endpoint: factory() answers per pool, Initialize logs per token. */
function fake(factories: Record<string, string>, hooks: Record<string, string>, calls: string[] = []) {
  return async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); const list = Array.isArray(body) ? body : [body];
    const out = list.map((request: { id: number; method: string; params: { to?: string; topics?: (string | null)[] }[] }) => {
      calls.push(request.method);
      if (request.method === "eth_call") { const f = factories[request.params[0].to!]; return f ? { id: request.id, result: word(f) } : { id: request.id, error: { message: "execution reverted" } }; }
      if (request.method === "eth_getLogs") {
        const topic = request.params[0].topics![3] ?? request.params[0].topics![2];
        const token = Object.keys(hooks).find((key) => word(key) === topic);
        return { id: request.id, result: token ? [{ data: `0x${"0".repeat(128)}${word(hooks[token]).slice(2)}${"0".repeat(128)}` }] : [] };
      }
      return { id: request.id, error: { message: "unexpected" } };
    });
    return new Response(JSON.stringify(Array.isArray(body) ? out : out[0]));
  };
}
const resolver = (factories: Record<string, string> = {}, hooks: Record<string, string> = {}, calls: string[] = []) => {
  const rpc = new Rpc(["https://x.test"], { fetcher: fake(factories, hooks, calls) as typeof fetch });
  return new LaunchpadResolver(book, rpc, rpc, { maxHistoryLookups: 4, now: () => 0 });
};

describe("classifier venue", () => {
  it("records the pool a bought token came from and the pool a sold token went to", () => {
    const bought = classifyTx(tx({ value: `0x${HYPE.toString(16)}` }), [transfer(TOKEN, POOL, ROUTER, 5n), transfer(TOKEN, ROUTER, USER, 5n)], 0, ctx());
    expect(bought[0].venue).toBe(POOL);
    const sold = classifyTx(tx(), [transfer(TOKEN, USER, POOL, 5n), transfer(WHYPE, POOL, USER, HYPE)], 0, ctx());
    expect(sold[0].venue).toBe(POOL);
  });
});

describe("LaunchpadResolver", () => {
  it("names a listed pool manager or pad directly", async () => {
    const trade = buy({ venue: PAD_PM, txTo: A(0x123) });
    await resolver().resolve([trade]);
    expect(trade.launchpad).toBe("PadV4");
  });
  it("reads a V3 pool's factory()", async () => {
    const trade = buy({ venue: V3POOL, txTo: A(0x123) });
    await resolver({ [V3POOL]: FACTORY }).resolve([trade]);
    expect(trade.launchpad).toBe("PadV3");
  });
  it("finds the hook of a shared V4 pool; a hookless pool takes the manager's name", async () => {
    const hooked = buy({ venue: PM, token: A(0xd7) }); const plain = buy({ venue: PM, token: A(0xd8) });
    await resolver({}, { [A(0xd7)]: HOOK, [A(0xd8)]: "0x0000000000000000000000000000000000000000" }).resolve([hooked, plain]);
    expect(hooked.launchpad).toBe("HookPad");
    expect(plain.launchpad).toBe("Uniswap V4");
  });
  it("venue wins over tx.to; tx.to is the fallback; otherwise unknown", async () => {
    const both = buy({ venue: PAD_PM, txTo: ROUTER, token: A(0xe1) });
    const routerOnly = buy({ venue: A(0x555), txTo: ROUTER, token: A(0xe2) });
    const none = buy({ venue: A(0x556), txTo: A(0x557), token: A(0xe3) });
    await resolver().resolve([both, routerOnly, none]);
    expect([both.launchpad, routerOnly.launchpad, none.launchpad]).toEqual(["PadV4", "RouterPad", "unknown"]);
  });
  it("caches per token: the second trade of a token makes no RPC call", async () => {
    const calls: string[] = []; const r = resolver({ [V3POOL]: FACTORY }, {}, calls);
    await r.resolve([buy({ venue: V3POOL, token: TOKEN })]);
    const before = calls.length;
    const again = buy({ venue: V3POOL, token: TOKEN as Address });
    await r.resolve([again]);
    expect(again.launchpad).toBe("PadV3");
    expect(calls.length).toBe(before);
  });
});
