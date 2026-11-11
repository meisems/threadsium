// Sign-In with Ethereum (EIP-4361) for Threadsium accounts on Elysium (chain 99901).
//
// The browser builds the message (viem createSiweMessage) around a nonce from issueNonce(), the visitor's wallet signs it,
// and checkSiwe() decides whether to trust it:
//   - the nonce exists, was issued for this purpose (and account, for re-authentication), has not expired, and is deleted
//     in the same statement that reads it, so a signed message can be used once and only once;
//   - the message's domain is this site (the host the request reached, or the Origin the browser vouched for) and its URI
//     points at the same host, so a message signed for another site is refused;
//   - chain ID 99901, version 1, the expected statement, and the message's own time window;
//   - the signature recovers to the address in the message (viem verifyMessage, plain ECDSA / EIP-191).
//
// Pure: depends only on viem and the SqlDb interface, so tests run it against node:sqlite.
import { getAddress, verifyMessage, type Hex } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import type { SqlDb } from "./env.ts";

export const SIWE_CHAIN_ID = 99901;
export const SIWE_NONCE_TTL_MS = 5 * 60_000;
/** How far a client clock may run ahead of ours before an "Issued At" in the future is refused. */
const CLOCK_SKEW_MS = 2 * 60_000;
const MAX_MESSAGE_CHARS = 2_000;

export type SiwePurpose = "signin" | "reauth";

/** The sentence the wallet shows. The server insists on it, so a message signed for a different action is refused. */
export const SIWE_STATEMENTS: Record<SiwePurpose, string> = {
  signin: "Sign in to Threadsium. Signing is free and sends no transaction.",
  reauth: "Confirm it is you to change your Threadsium account. Signing is free and sends no transaction.",
};

export type SiweResult = { ok: true; address: string } | { ok: false; status: number; error: string };

function randomNonce(): string {
  // EIP-4361 nonces are at least 8 alphanumeric characters; 32 hex characters carry 128 bits.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function issueNonce(
  db: SqlDb,
  opts: { purpose: SiwePurpose; userId?: string | null; now?: number },
): Promise<{ nonce: string; expiresAt: number }> {
  const now = opts.now ?? Date.now();
  const nonce = randomNonce();
  const expiresAt = now + SIWE_NONCE_TTL_MS;
  await db
    .prepare("INSERT INTO siwe_nonces (nonce, purpose, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(nonce, opts.purpose, opts.userId ?? null, expiresAt, now)
    .run();
  return { nonce, expiresAt };
}

const fail = (status: number, error: string): SiweResult => ({ ok: false, status, error });

/** Hosts a SIWE message may name: the host this request reached and, when the Origin passed the site's origin check, that host. */
export function expectedDomains(req: Request, originOk: boolean): string[] {
  const out = [new URL(req.url).host];
  const origin = req.headers.get("origin");
  if (origin && originOk) {
    try {
      const h = new URL(origin).host;
      if (!out.includes(h)) out.push(h);
    } catch {
      /* ignore */
    }
  }
  return out;
}

export async function checkSiwe(
  db: SqlDb,
  input: {
    message: unknown;
    signature: unknown;
    domains: string[];
    purpose: SiwePurpose;
    /** For "reauth": the signed-in account the nonce was issued to. */
    userId?: string | null;
    now?: number;
  },
): Promise<SiweResult> {
  const now = input.now ?? Date.now();
  const { message, signature } = input;
  if (typeof message !== "string" || !message || message.length > MAX_MESSAGE_CHARS) return fail(400, "The sign-in message could not be read.");
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return fail(400, "The signature could not be read.");

  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch {
    return fail(400, "The sign-in message could not be read.");
  }
  const { address, domain, uri, version, chainId, nonce, statement, issuedAt } = parsed;
  if (!address || !domain || !uri || !nonce || !issuedAt) return fail(400, "The sign-in message is missing a field.");
  if (version !== "1") return fail(400, "Unsupported sign-in message version.");
  if (chainId !== SIWE_CHAIN_ID) return fail(400, `The sign-in message must be for Elysium (chain ${SIWE_CHAIN_ID}).`);

  // Domain binding: the message must name this site, and its URI must point at the same host.
  if (!input.domains.includes(domain)) return fail(400, "The sign-in message was made for a different site.");
  let uriHost = "";
  try {
    uriHost = new URL(uri).host;
  } catch {
    /* handled below */
  }
  if (uriHost !== domain) return fail(400, "The sign-in message was made for a different site.");
  if ((statement ?? "") !== SIWE_STATEMENTS[input.purpose]) return fail(400, "The sign-in message has an unexpected statement.");

  const t = new Date(now);
  if (!validateSiweMessage({ message: parsed, domain, nonce, time: t })) return fail(400, "The sign-in message has expired or is not valid yet.");
  const issued = issuedAt.getTime();
  if (Number.isNaN(issued) || issued > now + CLOCK_SKEW_MS || issued < now - SIWE_NONCE_TTL_MS - CLOCK_SKEW_MS) {
    return fail(400, "The sign-in message has expired. Try again.");
  }

  // Single use: the nonce row is deleted by the same statement that reads it, so two requests racing with one signed
  // message cannot both succeed. A bad signature below still burns the nonce, which is intended.
  const row = await db
    .prepare("DELETE FROM siwe_nonces WHERE nonce = ? RETURNING purpose, user_id, expires_at")
    .bind(nonce)
    .first<{ purpose: string; user_id: string | null; expires_at: number }>();
  if (!row) return fail(401, "That sign-in request was already used or never issued. Try again.");
  if (row.expires_at <= now) return fail(401, "That sign-in request expired. Try again.");
  if (row.purpose !== input.purpose) return fail(401, "That sign-in request was issued for something else. Try again.");
  if (input.purpose === "reauth" && (!input.userId || row.user_id !== input.userId)) {
    return fail(401, "That confirmation was issued to a different account.");
  }

  let ok = false;
  try {
    ok = await verifyMessage({ address: address as Hex, message, signature: signature as Hex });
  } catch {
    ok = false;
  }
  if (!ok) return fail(401, "The signature does not match the address in the message.");
  return { ok: true, address: getAddress(address).toLowerCase() };
}
