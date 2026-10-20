import type { Eip1193Provider } from "ethers";

export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}
export interface DetectedWallet {
  info: WalletInfo;
  provider: Eip1193Provider & { on?: (e: string, cb: (...a: any[]) => void) => void };
}

/**
 * Discover installed browser wallets via EIP-6963 (MetaMask, Rabby, Coinbase, Trust, ...).
 * Falls back to window.ethereum for older wallets and in-app wallet browsers.
 */
export function discoverWallets(timeoutMs = 300): Promise<DetectedWallet[]> {
  const w: any = typeof window !== "undefined" ? window : undefined;
  if (!w) return Promise.resolve([]);
  return new Promise((resolve) => {
    const found = new Map<string, DetectedWallet>();
    const onAnnounce = (e: any) => found.set(e.detail.info.uuid, e.detail);
    w.addEventListener("eip6963:announceProvider", onAnnounce);
    w.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      w.removeEventListener("eip6963:announceProvider", onAnnounce);
      const list = [...found.values()];
      if (!list.length && w.ethereum) {
        list.push({ info: { uuid: "injected", name: "Browser wallet", icon: "", rdns: "injected" }, provider: w.ethereum });
      }
      resolve(list);
    }, timeoutMs);
  });
}
