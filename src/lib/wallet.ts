// Minimal injected-wallet helpers (EIP-1193) for sending HYPE on Elysium 99901.
import { CHAIN } from "../config/chain";

export type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

export const injectedWallet = (): Eth | null => (typeof window === "undefined" ? null : ((window as unknown as { ethereum?: Eth }).ethereum ?? null));

/** Switches the wallet to Elysium, adding the network first if the wallet does not know it. */
export async function ensureElysium(eth: Eth): Promise<void> {
  const current = String(await eth.request({ method: "eth_chainId" }).catch(() => "")).toLowerCase();
  if (current === CHAIN.hexId) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.hexId }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN.hexId,
          chainName: CHAIN.name,
          nativeCurrency: CHAIN.native,
          rpcUrls: [CHAIN.walletRpc, ...CHAIN.walletRpcBackups],
          blockExplorerUrls: [CHAIN.explorer],
        },
      ],
    });
  }
}

/** Sends `wei` of native HYPE from `from` to `to`; resolves with the transaction hash. */
export async function sendHype(eth: Eth, from: string, to: string, wei: bigint): Promise<string> {
  await ensureElysium(eth);
  const hash = await eth.request({ method: "eth_sendTransaction", params: [{ from, to, value: `0x${wei.toString(16)}` }] });
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("The wallet did not return a transaction hash.");
  return hash;
}

/** Friendly text for a wallet error. */
export function walletErrorText(e: unknown, fallback: string): string {
  const err = e as { code?: number; message?: string };
  if (err?.code === 4001) return "You declined the request in your wallet. Nothing was sent.";
  return err?.message || fallback;
}
