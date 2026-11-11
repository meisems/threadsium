// Sign-In with Ethereum (EIP-4361) in the browser. The server hands out a single-use nonce; the message is built here
// for this site and chain 99901 and signed by either the visitor's own browser wallet (EIP-1193 personal_sign) or a
// wallet made in this browser (localWallet.ts). Only the message and the signature are sent back.
import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";
import { api, type Me } from "./api.ts";

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
const provider = (): Eip1193 | null =>
  typeof window === "undefined" ? null : ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null);

/** True when the page has an injected browser wallet (MetaMask, Rabby, OKX, a wallet's in-app browser…). */
export const hasBrowserWallet = (): boolean => !!provider();

export const SIWE_CHAIN_ID = 99901;

export interface WalletSigner {
  address: string;
  kind: "browser" | "local";
  signMessage(message: string): Promise<string>;
}

export type WalletSignIn = { user: Me } | { needsUsername: true; address: string; signupToken: string };

function site(): { domain: string; uri: string } {
  if (typeof window === "undefined" || !window.location) throw new Error("Wallet sign-in needs a browser page.");
  return { domain: window.location.host, uri: window.location.origin };
}

/** The visitor's own browser wallet. Asks it to share an address (one prompt) and signs with personal_sign. */
export async function browserWalletSigner(): Promise<WalletSigner> {
  const eth = provider();
  if (!eth) throw new Error("No browser wallet was found. Install or unlock one (MetaMask, Rabby, OKX…) and reload.");
  const list = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const address = list?.[0];
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("The wallet did not share an address.");
  return {
    address: address.toLowerCase(),
    kind: "browser",
    async signMessage(message: string) {
      return String(await eth.request({ method: "personal_sign", params: [message, address] }));
    },
  };
}

async function signedMessage(signer: WalletSigner, purpose: "signin" | "reauth", where = site()): Promise<{ message: string; signature: string }> {
  const n = await api.siweNonce(purpose);
  const message = createSiweMessage({
    domain: where.domain,
    uri: where.uri,
    address: getAddress(signer.address),
    statement: n.statement,
    version: "1",
    chainId: SIWE_CHAIN_ID,
    nonce: n.nonce,
    issuedAt: new Date(n.issuedAt),
    expirationTime: new Date(n.expiresAt),
  });
  const signature = await signer.signMessage(message);
  return { message, signature };
}

/** Signs in with a wallet. A wallet no account knows yet comes back with a sign-up ticket to finish with a username. */
export async function walletSignIn(signer: WalletSigner, where?: { domain: string; uri: string }): Promise<WalletSignIn> {
  const { message, signature } = await signedMessage(signer, "signin", where);
  return api.siweVerify(message, signature);
}

/** Proof for a sensitive change (adding a password, deleting the account), signed by the account's own wallet. */
export async function walletConfirmation(signer: WalletSigner, where?: { domain: string; uri: string }): Promise<{ walletMessage: string; walletSignature: string }> {
  const { message, signature } = await signedMessage(signer, "reauth", where);
  return { walletMessage: message, walletSignature: signature };
}
