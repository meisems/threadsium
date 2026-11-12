// Wallet accounts: Sign-In with Ethereum nonces, signature and domain checks, wallet sign-up, wallet-only account rules,
// and the browser-made wallet (its recovery phrase, key and keystore password must never reach the API).
// The real Worker handlers run against an in-memory node:sqlite database with the real migrations.
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createSiweMessage } from "viem/siwe";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { bytesToHex } from "viem";
import { mnemonicToSeedSync } from "@scure/bip39";
import { HDKey } from "@scure/bip32";
import type { Env, SqlDb, SqlStatement } from "../worker/env.ts";
import { checkSiwe, issueNonce, SIWE_NONCE_TTL_MS, SIWE_STATEMENTS } from "../worker/siwe.ts";
import {
  handleChangePassword,
  handleDeleteAccount,
  handleLogin,
  handleRegister,
  handleSiweNonce,
  handleSiweRegister,
  handleSiweVerify,
  handleUpdateProfile,
  handleWalletChallenge,
  handleAuthMe,
} from "../worker/auth.ts";

const HOST = "threadsium.test";
const ORIGIN = `https://${HOST}`;
const MIGRATIONS = ["0001_threadsium", "0002_social_v2", "0003_message_transfers", "0004_launch_index", "0005_wallet_accounts"];

function splitSql(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sqliteDb(): SqlDb {
  const d = new DatabaseSync(":memory:");
  for (const m of MIGRATIONS) {
    for (const stmt of splitSql(readFileSync(new URL(`../migrations/${m}.sql`, import.meta.url), "utf8").replace(/\r/g, ""))) d.exec(stmt);
  }
  type P = string | number | null;
  const exec = (text: string, params: P[]) => d.prepare(text).all(...params) as Record<string, unknown>[];
  class Stmt implements SqlStatement {
    readonly text: string;
    readonly params: P[];
    constructor(text: string, params: P[] = []) {
      this.text = text;
      this.params = params;
    }
    bind(...values: unknown[]): SqlStatement {
      return new Stmt(this.text, values.map((v) => (v === undefined ? null : (v as P))));
    }
    async first<T>(): Promise<T | null> {
      return (exec(this.text, this.params)[0] as T) ?? null;
    }
    async all<T>(): Promise<{ results: T[] }> {
      return { results: exec(this.text, this.params) as T[] };
    }
    async run() {
      exec(this.text, this.params);
      return { success: true };
    }
  }
  return {
    prepare: (text) => new Stmt(text),
    async batch(stmts) {
      d.exec("BEGIN");
      try {
        for (const s of stmts as Stmt[]) exec(s.text, s.params);
        d.exec("COMMIT");
      } catch (e) {
        d.exec("ROLLBACK");
        throw e;
      }
      return stmts.length;
    },
  };
}

let env: Env;
beforeEach(() => {
  env = { DB: sqliteDb() } as unknown as Env;
});

function req(path: string, body: unknown, opts: { method?: string; origin?: string | null; cookie?: string; csrf?: string; ip?: string } = {}): Request {
  const headers = new Headers({ "content-type": "application/json", "cf-connecting-ip": opts.ip ?? "203.0.113.7" });
  if (opts.origin !== null) headers.set("origin", opts.origin ?? ORIGIN);
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.csrf) headers.set("x-csrf-token", opts.csrf);
  const method = opts.method ?? "POST";
  return new Request(`${ORIGIN}${path}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body) });
}

type Signer = { address: `0x${string}`; signMessage: (a: { message: string }) => Promise<`0x${string}`> };

function siweMessage(
  address: string,
  nonce: string,
  over: Partial<{ domain: string; uri: string; chainId: number; statement: string; issuedAt: Date; expirationTime: Date }> = {},
): string {
  return createSiweMessage({
    domain: over.domain ?? HOST,
    uri: over.uri ?? ORIGIN,
    address: address as `0x${string}`,
    statement: over.statement ?? SIWE_STATEMENTS.signin,
    version: "1",
    chainId: over.chainId ?? 99901,
    nonce,
    issuedAt: over.issuedAt ?? new Date(),
    ...(over.expirationTime ? { expirationTime: over.expirationTime } : {}),
  });
}

async function nonceFromApi(purpose: "signin" | "reauth" = "signin", auth?: { cookie: string; csrf: string }): Promise<string> {
  const r = await handleSiweNonce(req("/api/auth/siwe/nonce", { purpose }, auth ?? {}), env);
  assert.equal(r.status, 200, await r.clone().text());
  return ((await r.json()) as { nonce: string }).nonce;
}

async function signIn(account: Signer): Promise<Response> {
  const message = siweMessage(account.address, await nonceFromApi());
  return handleSiweVerify(req("/api/auth/siwe/verify", { message, signature: await account.signMessage({ message }) }), env);
}

const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];

async function walletSignUp(account: Signer, username: string): Promise<{ cookie: string; csrf: string; user: Record<string, unknown> }> {
  const v = await signIn(account);
  assert.equal(v.status, 200);
  const ticket = (await v.json()) as { needsUsername: boolean; signupToken: string };
  assert.equal(ticket.needsUsername, true);
  const r = await handleSiweRegister(req("/api/auth/siwe/register", { signupToken: ticket.signupToken, username, avatarPreset: "iris" }), env);
  assert.equal(r.status, 201, await r.clone().text());
  const { user } = (await r.json()) as { user: Record<string, unknown> };
  return { cookie: cookieOf(r), csrf: String(user.csrfToken), user };
}

describe("SIWE nonces", () => {
  it("is single use: the same signed message cannot sign in twice", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const message = siweMessage(acct.address, await nonceFromApi());
    const signature = await acct.signMessage({ message });
    const first = await handleSiweVerify(req("/api/auth/siwe/verify", { message, signature }), env);
    assert.equal(first.status, 200);
    const replay = await handleSiweVerify(req("/api/auth/siwe/verify", { message, signature }), env);
    assert.equal(replay.status, 401);
    assert.match(((await replay.json()) as { error: string }).error, /already used/);
  });

  it("expires: a nonce older than its lifetime is refused even with a good signature", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const t0 = Date.now();
    const { nonce } = await issueNonce(env.DB!, { purpose: "signin", now: t0 });
    const message = siweMessage(acct.address, nonce, { issuedAt: new Date(t0) });
    const r = await checkSiwe(env.DB!, {
      message,
      signature: await acct.signMessage({ message }),
      domains: [HOST],
      purpose: "signin",
      now: t0 + SIWE_NONCE_TTL_MS + 1_000,
    });
    assert.deepEqual(r, { ok: false, status: 401, error: "That sign-in request expired. Try again." });
  });

  it("refuses a nonce the server never issued", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const message = siweMessage(acct.address, "deadbeefdeadbeefdeadbeefdeadbeef");
    const r = await checkSiwe(env.DB!, { message, signature: await acct.signMessage({ message }), domains: [HOST], purpose: "signin" });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 401);
  });

  it("refuses a message whose own expiration time has passed", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const message = siweMessage(acct.address, await nonceFromApi(), { expirationTime: new Date(Date.now() - 1000) });
    const r = await checkSiwe(env.DB!, { message, signature: await acct.signMessage({ message }), domains: [HOST], purpose: "signin" });
    assert.equal(r.ok, false);
  });

  it("keeps purposes apart: a re-authentication nonce cannot sign in", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const { nonce } = await issueNonce(env.DB!, { purpose: "reauth", userId: "u_x" });
    const message = siweMessage(acct.address, nonce);
    const r = await checkSiwe(env.DB!, { message, signature: await acct.signMessage({ message }), domains: [HOST], purpose: "signin" });
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : "", /issued for something else/);
  });

  it("only issues sign-in nonces to this site's pages", async () => {
    const r = await handleSiweNonce(req("/api/auth/siwe/nonce", {}, { origin: "https://evil.example" }), env);
    assert.equal(r.status, 403);
  });
});

describe("SIWE signature and domain checks", () => {
  const verify = async (message: string, signature: string, origin?: string | null) =>
    handleSiweVerify(req("/api/auth/siwe/verify", { message, signature }, { origin }), env);

  it("refuses a message made for another site", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const message = siweMessage(acct.address, await nonceFromApi(), { domain: "evil.example", uri: "https://evil.example" });
    const r = await verify(message, await acct.signMessage({ message }));
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, /different site/);
  });

  it("refuses a URI on another host even when the domain line is right", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const message = siweMessage(acct.address, await nonceFromApi(), { uri: "https://evil.example/login" });
    const r = await verify(message, await acct.signMessage({ message }));
    assert.equal(r.status, 400);
  });

  it("refuses verify calls from another site's page", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const message = siweMessage(acct.address, await nonceFromApi());
    const r = await verify(message, await acct.signMessage({ message }), "https://evil.example");
    assert.equal(r.status, 403);
  });

  it("refuses another chain", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const message = siweMessage(acct.address, await nonceFromApi(), { chainId: 1 });
    const r = await verify(message, await acct.signMessage({ message }));
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, /99901/);
  });

  it("refuses a statement other than the sign-in one", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const message = siweMessage(acct.address, await nonceFromApi(), { statement: "Transfer everything" });
    const r = await verify(message, await acct.signMessage({ message }));
    assert.equal(r.status, 400);
  });

  it("refuses a signature from a different key than the address in the message", async () => {
    const victim = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());
    const message = siweMessage(victim.address, await nonceFromApi());
    const r = await verify(message, await attacker.signMessage({ message }));
    assert.equal(r.status, 401);
    assert.match(((await r.json()) as { error: string }).error, /does not match/);
  });

  it("refuses a message edited after signing", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const message = siweMessage(acct.address, await nonceFromApi());
    const signature = await acct.signMessage({ message });
    const r = await verify(message.replace(/Issued At: .*/, `Issued At: ${new Date(Date.now() - 1000).toISOString()}`), signature);
    assert.equal(r.status, 401);
  });

  it("accepts the dev setup: Vite on localhost:5173 proxying to wrangler on 127.0.0.1", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const nonce = await nonceFromApi();
    const message = siweMessage(acct.address, nonce, { domain: "localhost:5173", uri: "http://localhost:5173" });
    const r = await handleSiweVerify(
      new Request("http://127.0.0.1:8845/api/auth/siwe/verify", {
        method: "POST",
        headers: { origin: "http://localhost:5173", "content-type": "application/json" },
        body: JSON.stringify({ message, signature: await acct.signMessage({ message }) }),
      }),
      env,
    );
    assert.equal(r.status, 200, await r.clone().text());
  });
});

describe("wallet accounts", () => {
  it("first sign-in creates an account after a username is picked; the next sign-in finds it", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const { user, cookie } = await walletSignUp(acct, "wally");
    assert.equal(user.username, "wally");
    assert.equal(user.walletAddress, acct.address.toLowerCase());
    assert.equal(user.walletVerified, true);
    assert.equal(user.hasPassword, false);
    assert.equal(user.avatarPreset, "iris");
    assert.match(cookie, /^threadsium_sid=[0-9a-f]{64}$/);

    const me = (await (await handleAuthMe(req("/api/auth/me", null, { method: "GET", cookie }), env)).json()) as { user: { id: string } };
    assert.equal(me.user.id, user.id);

    const again = await signIn(acct);
    const body = (await again.json()) as { user?: { id: string }; needsUsername?: boolean };
    assert.equal(body.needsUsername, undefined);
    assert.equal(body.user?.id, user.id);
    assert.match(again.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Lax/);
  });

  it("a sign-up ticket creates one account only", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const ticket = (await (await signIn(acct)).json()) as { signupToken: string };
    const a = await handleSiweRegister(req("/api/auth/siwe/register", { signupToken: ticket.signupToken, username: "first_one" }), env);
    assert.equal(a.status, 201);
    const b = await handleSiweRegister(req("/api/auth/siwe/register", { signupToken: ticket.signupToken, username: "second_one" }), env);
    assert.equal(b.status, 400);
  });

  it("a taken username keeps the ticket so the visitor can pick another", async () => {
    await walletSignUp(privateKeyToAccount(generatePrivateKey()), "taken_name");
    const ticket = (await (await signIn(privateKeyToAccount(generatePrivateKey()))).json()) as { signupToken: string };
    const clash = await handleSiweRegister(req("/api/auth/siwe/register", { signupToken: ticket.signupToken, username: "TAKEN_name" }), env);
    assert.equal(clash.status, 409);
    const ok = await handleSiweRegister(req("/api/auth/siwe/register", { signupToken: ticket.signupToken, username: "free_name" }), env);
    assert.equal(ok.status, 201);
  });

  it("wallet accounts cannot be signed in to with a password, and cannot drop their wallet", async () => {
    const { cookie, csrf } = await walletSignUp(privateKeyToAccount(generatePrivateKey()), "nopass");
    const login = await handleLogin(req("/api/auth/login", { username: "nopass", password: "wallet_only" }), env);
    assert.equal(login.status, 401);
    const drop = await handleUpdateProfile(req("/api/auth/profile", { walletAddress: null }, { method: "PATCH", cookie, csrf }), env);
    assert.equal(drop.status, 400);
    const paste = await handleUpdateProfile(
      req("/api/auth/profile", { walletAddress: "0x000000000000000000000000000000000000dead" }, { method: "PATCH", cookie, csrf }),
      env,
    );
    assert.equal(paste.status, 400);
  });

  it("a wallet account adds a password with a wallet confirmation, then password sign-in works too", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const { cookie, csrf, user } = await walletSignUp(acct, "addpass");
    const noProof = await handleChangePassword(req("/api/auth/password", { newPassword: "correct horse" }, { cookie, csrf }), env);
    assert.equal(noProof.status, 403);

    const nonce = await nonceFromApi("reauth", { cookie, csrf });
    const walletMessage = siweMessage(acct.address, nonce, { statement: SIWE_STATEMENTS.reauth });
    const walletSignature = await acct.signMessage({ message: walletMessage });
    const set = await handleChangePassword(req("/api/auth/password", { walletMessage, walletSignature, newPassword: "correct horse" }, { cookie, csrf }), env);
    assert.equal(set.status, 200, await set.clone().text());

    const login = await handleLogin(req("/api/auth/login", { username: "addpass", password: "correct horse" }), env);
    assert.equal(login.status, 200);
    assert.equal(((await login.json()) as { user: { id: string; hasPassword: boolean } }).user.hasPassword, true);
    void user;
  });

  it("a re-authentication signed by another wallet is refused", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const { cookie, csrf } = await walletSignUp(acct, "victim");
    const nonce = await nonceFromApi("reauth", { cookie, csrf });
    const walletMessage = siweMessage(other.address, nonce, { statement: SIWE_STATEMENTS.reauth });
    const r = await handleDeleteAccount(
      req("/api/auth/account", { walletMessage, walletSignature: await other.signMessage({ message: walletMessage }) }, { method: "DELETE", cookie, csrf }),
      env,
    );
    assert.equal(r.status, 403);
  });

  it("a wallet account deletes itself with a wallet confirmation", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const { cookie, csrf } = await walletSignUp(acct, "leaving");
    const nonce = await nonceFromApi("reauth", { cookie, csrf });
    const walletMessage = siweMessage(acct.address, nonce, { statement: SIWE_STATEMENTS.reauth });
    const r = await handleDeleteAccount(
      req("/api/auth/account", { walletMessage, walletSignature: await acct.signMessage({ message: walletMessage }) }, { method: "DELETE", cookie, csrf }),
      env,
    );
    assert.equal(r.status, 200, await r.clone().text());
    const back = (await (await signIn(acct)).json()) as { needsUsername?: boolean };
    assert.equal(back.needsUsername, true);
  });
});

describe("password accounts keep working", () => {
  it("register, sign in, link a wallet in Settings, then that wallet signs in to the same account", async () => {
    const reg = await handleRegister(req("/api/auth/register", { username: "classic", password: "hunter2hunter2", avatarPreset: "tide" }), env);
    assert.equal(reg.status, 201);
    const login = await handleLogin(req("/api/auth/login", { username: "classic", password: "hunter2hunter2" }), env);
    assert.equal(login.status, 200);
    const { user } = (await login.json()) as { user: { id: string; csrfToken: string; hasPassword: boolean } };
    assert.equal(user.hasPassword, true);
    const cookie = cookieOf(login);
    const csrf = user.csrfToken;

    const acct = privateKeyToAccount(generatePrivateKey());
    const ch = (await (await handleWalletChallenge(req("/api/auth/wallet-challenge", {}, { cookie, csrf }), env)).json()) as { message: string };
    const link = await handleUpdateProfile(
      req("/api/auth/profile", { walletAddress: acct.address, walletSignature: await acct.signMessage({ message: ch.message }) }, { method: "PATCH", cookie, csrf }),
      env,
    );
    assert.equal(link.status, 200);

    const viaWallet = (await (await signIn(acct)).json()) as { user?: { id: string } };
    assert.equal(viaWallet.user?.id, user.id);
  });

  it("a verified wallet cannot be claimed by a second account", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    await walletSignUp(acct, "owner1");
    const reg = await handleRegister(req("/api/auth/register", { username: "claimer", password: "hunter2hunter2" }), env);
    const { user } = (await reg.json()) as { user: { csrfToken: string } };
    const cookie = cookieOf(reg);
    const ch = (await (await handleWalletChallenge(req("/api/auth/wallet-challenge", {}, { cookie, csrf: user.csrfToken }), env)).json()) as { message: string };
    const link = await handleUpdateProfile(
      req("/api/auth/profile", { walletAddress: acct.address, walletSignature: await acct.signMessage({ message: ch.message }) }, { method: "PATCH", cookie, csrf: user.csrfToken }),
      env,
    );
    assert.equal(link.status, 409);
  });
});

/* ───────── browser side: the made-in-browser wallet never leaves the browser ───────── */

describe("wallet made in the browser", () => {
  const sent: string[] = [];
  let jar = "";
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};

  before(() => {
    for (const k of ["window", "fetch", "localStorage"]) saved[k] = g[k];
    const store = new Map<string, string>();
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    };
    g.window = { location: { host: HOST, origin: ORIGIN, pathname: "/auth" } };
    // Every API call the page makes goes straight into the real Worker handlers; everything sent is recorded.
    g.fetch = async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("origin", ORIGIN);
      if (jar) headers.set("cookie", jar);
      const body = typeof init.body === "string" ? init.body : "";
      sent.push(`${init.method ?? "GET"} ${path}\n${[...headers].map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${body}`);
      const r = new Request(`${ORIGIN}${path}`, { method: init.method, headers, body: body || undefined });
      const routes: Record<string, (q: Request, e: Env) => Promise<Response>> = {
        "/api/auth/siwe/nonce": handleSiweNonce,
        "/api/auth/siwe/verify": handleSiweVerify,
        "/api/auth/siwe/register": handleSiweRegister,
        "/api/auth/password": handleChangePassword,
        "/api/auth/me": handleAuthMe,
      };
      const res = await routes[path](r, env);
      const c = cookieOf(res);
      if (c) jar = c;
      return res;
    };
  });
  after(() => {
    for (const [k, v] of Object.entries(saved)) g[k] = v;
  });

  it("signs up, saves an encrypted copy, signs in again, and sends only an address, a message and a signature", async () => {
    const { newRecoveryPhrase, signerFromPhrase, encryptPhrase, decryptPhrase, saveWallet, savedWallets, isValidPhrase } = await import("../src/lib/localWallet.ts");
    const { walletSignIn, walletConfirmation } = await import("../src/lib/siwe.ts");
    const { api } = await import("../src/lib/api.ts");

    const phrase = newRecoveryPhrase();
    assert.equal(phrase.split(" ").length, 12);
    assert.ok(isValidPhrase(phrase));
    const keystorePassword = "local only passphrase";

    // Everything secret, in every form it could leak in.
    const hd = HDKey.fromMasterSeed(mnemonicToSeedSync(phrase)).derive("m/44'/60'/0'/0/0");
    const privateKey = bytesToHex(hd.privateKey!);
    const seed = bytesToHex(mnemonicToSeedSync(phrase));
    assert.equal(privateKeyToAccount(privateKey).address, mnemonicToAccount(phrase).address);

    const signer = signerFromPhrase(phrase);
    const first = await walletSignIn(signer);
    assert.ok("needsUsername" in first);
    const me = await api.siweRegister((first as { signupToken: string }).signupToken, "made_here", "dusk");
    assert.equal(me.walletAddress, signer.address);
    assert.equal(me.walletVerified, true);

    const store = await encryptPhrase(phrase, keystorePassword, 100_000);
    saveWallet(store);
    const raw = (globalThis as unknown as { localStorage: Storage }).localStorage.getItem("threadsium.wallets.v1") ?? "";
    const w = phrase.split(" ");
    for (let i = 0; i + 1 < w.length; i++) assert.ok(!raw.includes(`${w[i]} ${w[i + 1]}`), "recovery phrase stored in plaintext");
    assert.ok(!raw.includes(privateKey.slice(2)));
    assert.equal(savedWallets().length, 1);
    await assert.rejects(decryptPhrase(store, "wrong password"), /does not unlock/);

    // Later visit: unlock the saved copy, sign in again, add an account password with a wallet confirmation.
    jar = "";
    const unlocked = signerFromPhrase(await decryptPhrase(savedWallets()[0], keystorePassword));
    const again = await walletSignIn(unlocked);
    assert.ok("user" in again && again.user.username === "made_here");
    await api.changePassword(await walletConfirmation(unlocked), "an account password");

    assert.ok(sent.length >= 7, `expected the whole flow to hit the API, saw ${sent.length} calls`);
    const wire = sent.join("\n----\n").toLowerCase();
    assert.ok(!wire.includes(privateKey.slice(2).toLowerCase()), "private key reached the API");
    assert.ok(!wire.includes(seed.slice(2).toLowerCase()), "BIP-39 seed reached the API");
    assert.ok(!wire.includes(phrase), "recovery phrase reached the API");
    const words = phrase.split(" ");
    for (let i = 0; i + 1 < words.length; i++) assert.ok(!wire.includes(`${words[i]} ${words[i + 1]}`), "part of the recovery phrase reached the API");
    assert.ok(!wire.includes(keystorePassword), "the local keystore password reached the API");
    assert.ok(!wire.includes(store.ciphertext.toLowerCase()), "the encrypted keystore reached the API");
  });

  it("a scripted EIP-1193 browser wallet signs in through personal_sign", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const calls: string[] = [];
    (g.window as Record<string, unknown>).ethereum = {
      async request({ method, params }: { method: string; params?: unknown[] }) {
        calls.push(method);
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [acct.address];
        if (method === "personal_sign") {
          assert.equal(String(params?.[1]).toLowerCase(), acct.address.toLowerCase());
          return acct.signMessage({ message: String(params?.[0]) });
        }
        throw new Error(`unexpected ${method}`);
      },
    };
    const { browserWalletSigner, walletSignIn } = await import("../src/lib/siwe.ts");
    jar = "";
    const r = await walletSignIn(await browserWalletSigner());
    assert.ok("needsUsername" in r);
    assert.deepEqual(calls, ["eth_requestAccounts", "personal_sign"]);
  });
});
