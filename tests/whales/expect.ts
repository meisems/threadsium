// The handful of Vitest matchers the Whale watch indexer tests use, on node:test and node:assert, so those tests run
// under `npm test` with the rest of the suite. Also a node:sqlite adapter for the indexer's SqlStore.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { SqlCursor, SqlExec } from "../../worker/whales/store.ts";

export { describe, it, beforeEach, afterEach } from "node:test";

/** expect.stringContaining(text), for use inside toMatchObject. */
class StringContaining {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
}

function matchObject(actual: unknown, expected: unknown, path = "value"): void {
  if (expected instanceof StringContaining) {
    assert.ok(typeof actual === "string" && actual.includes(expected.text), `${path}: expected a string containing "${expected.text}"`);
    return;
  }
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    assert.ok(actual && typeof actual === "object", `${path} is not an object`);
    for (const [k, v] of Object.entries(expected as Record<string, unknown>)) matchObject((actual as Record<string, unknown>)[k], v, `${path}.${k}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path} is not an array`);
    assert.equal((actual as unknown[]).length, expected.length, `${path} length`);
    expected.forEach((v, i) => matchObject((actual as unknown[])[i], v, `${path}[${i}]`));
  } else assert.deepEqual(actual, expected, path);
}

function matchers(actual: unknown, negate: boolean) {
  const check = (pass: boolean, message: string) => assert.ok(negate ? !pass : pass, negate ? `not: ${message}` : message);
  const deepEq = (a: unknown, b: unknown) => {
    try {
      assert.deepStrictEqual(a, b);
      return true;
    } catch {
      return false;
    }
  };
  return {
    toBe: (expected: unknown) => check(Object.is(actual, expected), `expected ${String(actual)} to be ${String(expected)}`),
    toEqual: (expected: unknown) => check(deepEq(actual, expected), `expected ${JSON.stringify(actual, (_k, v) => (typeof v === "bigint" ? `${v}n` : v))} to equal ${JSON.stringify(expected, (_k, v) => (typeof v === "bigint" ? `${v}n` : v))}`),
    toBeNull: () => check(actual === null, `expected ${String(actual)} to be null`),
    toContain: (item: unknown) => check(typeof actual === "string" ? actual.includes(String(item)) : Array.isArray(actual) && actual.some((x) => deepEq(x, item)), `expected to contain ${String(item)}`),
    toHaveLength: (n: number) => check((actual as { length: number })?.length === n, `expected length ${n}, got ${(actual as { length: number })?.length}`),
    toBeCloseTo: (n: number, digits = 2) => check(Math.abs(Number(actual) - n) < 10 ** -digits / 2, `expected ${String(actual)} to be close to ${n}`),
    toBeGreaterThan: (n: number) => check(Number(actual) > n, `expected ${String(actual)} > ${n}`),
    toMatch: (re: RegExp | string) => check(typeof re === "string" ? String(actual).includes(re) : re.test(String(actual)), `expected ${String(actual)} to match ${String(re)}`),
    toMatchObject: (expected: unknown) => {
      let pass = true;
      try {
        matchObject(actual, expected);
      } catch (e) {
        pass = false;
        if (!negate) throw e;
      }
      if (negate) check(pass, "expected objects not to match");
    },
  };
}

export function expect(actual: unknown) {
  return { ...matchers(actual, false), not: matchers(actual, true) };
}
expect.stringContaining = (text: string) => new StringContaining(text);

/** An in-memory SQLite database behind the SqlStore interface, as the Durable Object's storage.sql provides. */
export function sqlite(path = ":memory:"): SqlExec {
  const db = new DatabaseSync(path);
  return {
    exec(query: string, ...bindings: unknown[]): SqlCursor {
      const statement = db.prepare(query);
      const args = bindings.map((value) => (value === undefined ? null : typeof value === "boolean" ? Number(value) : value)) as (string | number | bigint | null)[];
      if (/^\s*(SELECT|WITH)\b/i.test(query) || /\bRETURNING\b/i.test(query)) {
        const rows = statement.all(...args) as Record<string, unknown>[];
        return { toArray: () => rows, rowsWritten: /\bRETURNING\b/i.test(query) ? rows.length : 0, rowsRead: rows.length };
      }
      const result = statement.run(...args);
      return { toArray: () => [], rowsWritten: Number(result.changes), rowsRead: 0 };
    },
  };
}
