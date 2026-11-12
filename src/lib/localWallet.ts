// A wallet made in this browser for people who sign up without one.
//
// - The 12-word recovery phrase (BIP-39, 128 bits from crypto.getRandomValues) and the key derived from it
//   (m/44'/60'/0'/0/0, the path MetaMask, Rabby and most wallets use, so the phrase can be imported there) exist only in
//   this page's memory. Nothing in this file talks to the network; the only thing that leaves the browser is a signature.
// - Optionally an encrypted copy is kept in this browser's localStorage, so signing in again needs a password instead of
//   the 12 words. The key that encrypts it comes from that password through PBKDF2-SHA-256 (600,000 iterations,
//   random 16-byte salt) and encrypts with AES-256-GCM (random 12-byte IV, the address as associated data).
//   The password is never stored or sent anywhere. Plaintext is never written to storage.
import { generateMnemonic as bip39Generate, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { mnemonicToAccount } from "viem/accounts";
import type { WalletSigner } from "./siwe.ts";

export const KEYSTORE_KEY = "threadsium.wallets.v1";
export const KDF_ITERATIONS = 600_000;
export const KEYSTORE_PASSWORD_MIN = 8;

export interface Keystore {
  v: 1;
  address: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  ciphertext: string;
  createdAt: number;
}

/** Words separated by single spaces, lower case: the form BIP-39 checksums are computed over. */
export function normalizePhrase(text: string): string {
  return text.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

export function isValidPhrase(text: string): boolean {
  const p = normalizePhrase(text);
  const n = p.split(" ").length;
  return (n === 12 || n === 24) && validateMnemonic(p, wordlist);
}

export function newRecoveryPhrase(): string {
  return bip39Generate(wordlist, 128);
}

export function addressOfPhrase(phrase: string): string {
  return mnemonicToAccount(normalizePhrase(phrase)).address.toLowerCase();
}

/** A signer backed by the phrase. The account object (and its key) lives only in this closure. */
export function signerFromPhrase(phrase: string): WalletSigner {
  const p = normalizePhrase(phrase);
  if (!isValidPhrase(p)) throw new Error("Those words are not a valid recovery phrase. Check the spelling and the order.");
  const account = mnemonicToAccount(p);
  return {
    address: account.address.toLowerCase(),
    kind: "local",
    signMessage: (message: string) => account.signMessage({ message }),
  };
}

/* ───────── encrypted copy in this browser ───────── */

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const utf8 = new TextEncoder();

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", utf8.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptPhrase(phrase: string, password: string, iterations = KDF_ITERATIONS): Promise<Keystore> {
  if (password.length < KEYSTORE_PASSWORD_MIN) throw new Error(`Use at least ${KEYSTORE_PASSWORD_MIN} characters for this password.`);
  const p = normalizePhrase(phrase);
  const address = addressOfPhrase(p);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: utf8.encode(address) }, key, utf8.encode(p));
  return {
    v: 1,
    address,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: b64(salt) },
    cipher: { name: "AES-GCM", iv: b64(iv) },
    ciphertext: b64(new Uint8Array(ct)),
    createdAt: Date.now(),
  };
}

export async function decryptPhrase(store: Keystore, password: string): Promise<string> {
  let plain: ArrayBuffer;
  try {
    const key = await deriveKey(password, unb64(store.kdf.salt), store.kdf.iterations);
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(store.cipher.iv) as BufferSource, additionalData: utf8.encode(store.address) },
      key,
      unb64(store.ciphertext) as BufferSource,
    );
  } catch {
    throw new Error("That password does not unlock this wallet.");
  }
  const phrase = new TextDecoder().decode(plain);
  if (addressOfPhrase(phrase) !== store.address) throw new Error("This saved wallet is damaged. Restore it from your recovery phrase.");
  return phrase;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isKeystore(v: unknown): v is Keystore {
  const k = v as Keystore;
  return (
    !!k &&
    k.v === 1 &&
    /^0x[0-9a-f]{40}$/.test(k.address) &&
    k.kdf?.name === "PBKDF2" &&
    typeof k.kdf.salt === "string" &&
    Number.isInteger(k.kdf.iterations) &&
    k.kdf.iterations >= 100_000 &&
    k.cipher?.name === "AES-GCM" &&
    typeof k.cipher.iv === "string" &&
    typeof k.ciphertext === "string"
  );
}

export function savedWallets(): Keystore[] {
  try {
    const raw = storage()?.getItem(KEYSTORE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter(isKeystore) : [];
  } catch {
    return [];
  }
}

export function saveWallet(store: Keystore): void {
  const s = storage();
  if (!s) throw new Error("This browser does not allow saving data for this site.");
  const rest = savedWallets().filter((k) => k.address !== store.address);
  s.setItem(KEYSTORE_KEY, JSON.stringify([...rest, store]));
}

export function forgetWallet(address: string): void {
  const s = storage();
  if (!s) return;
  const rest = savedWallets().filter((k) => k.address !== address.toLowerCase());
  if (rest.length) s.setItem(KEYSTORE_KEY, JSON.stringify(rest));
  else s.removeItem(KEYSTORE_KEY);
}
