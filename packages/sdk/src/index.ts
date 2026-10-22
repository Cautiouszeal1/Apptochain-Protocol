import {
  AbiCoder, BrowserProvider, Contract, JsonRpcProvider, getAddress, hexlify, id as keccakId, parseEther, randomBytes,
  type Signer, type Eip1193Provider, type InterfaceAbi, type ContractTransactionReceipt,
} from "ethers";
import { ATCAssetsAbi, ATCFactoryAbi, ATCForwarderAbi, ATCMembershipAbi, ATCPaymentsAbi, ATCRewardsAbi } from "./abi/index.js";
import { resolveNetwork, type NetworkConfig, type NetworkInput } from "./networks.js";
import { RelayerClient, type ForwardRequestData, type RelayResult } from "./relayer.js";
import { discoverWallets, type DetectedWallet } from "./wallets.js";

export * from "./networks.js";
export * from "./relayer.js";
export * from "./wallets.js";
export * from "./builder.js";
export * as abi from "./abi/index.js";

export type ModuleKind = "membership" | "assets" | "rewards" | "payments";

const KIND_ID: Record<ModuleKind, string> = {
  membership: keccakId("MEMBERSHIP"),
  assets: keccakId("ASSETS"),
  rewards: keccakId("REWARDS"),
  payments: keccakId("PAYMENTS"),
};
const ABI: Record<ModuleKind, InterfaceAbi> = {
  membership: ATCMembershipAbi as unknown as InterfaceAbi,
  assets: ATCAssetsAbi as unknown as InterfaceAbi,
  rewards: ATCRewardsAbi as unknown as InterfaceAbi,
  payments: ATCPaymentsAbi as unknown as InterfaceAbi,
};

/** One on-chain action, mapped from a feature in your app. */
export interface ActionDef {
  kind: ModuleKind;
  /** Address of the deployed module (from deploy.* or your dashboard). */
  module: string;
  /** Contract method to call, e.g. "mint", "award", "payToken". */
  method: string;
  /** Send through the relayer so the user pays no gas. Must not carry value. Default true. */
  gasless?: boolean;
}

export interface AppToChainOptions {
  network: NetworkInput;
  /** Addresses from packages/contracts/deployments/<network>.json */
  deployment?: { factory?: string; forwarder?: string; chainId?: number };
  relayerUrl?: string;
  apiKey?: string;
  appId?: string;
  actions?: Record<string, ActionDef>;
}

export interface RunResult {
  via: "relayer" | "wallet";
  hash: string;
  wait: () => Promise<{ status: "confirmed" | "failed"; blockNumber?: number }>;
}

/** Event methods most EIP-1193 providers expose (optional). */
type EventSource = {
  on?: (event: string, cb: (...a: any[]) => void) => void;
  removeListener?: (event: string, cb: (...a: any[]) => void) => void;
};

/** Random id that works in browsers, Node and React Native (with react-native-get-random-values). */
function randomId(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return hexlify(randomBytes(16)).slice(2);
}

const FORWARD_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
};

export class AppToChain {
  readonly network: NetworkConfig;
  readonly readProvider: JsonRpcProvider;
  private signer?: Signer;
  private eip1193?: Eip1193Provider;
  private relayer?: RelayerClient;
  private actions: Record<string, ActionDef> = {};
  private listeners = new Set<(address: string | null) => void>();
  address: string | null = null;

  constructor(opts: AppToChainOptions) {
    this.network = resolveNetwork(opts.network, opts.deployment);
    this.readProvider = new JsonRpcProvider(this.network.rpcUrl, this.network.chainId, { staticNetwork: true });
    if (opts.relayerUrl) this.relayer = new RelayerClient(opts.relayerUrl, opts.apiKey, opts.appId);
    if (opts.actions) this.map(opts.actions);
  }

  // ───────────────────────── 1. CONNECT ─────────────────────────

  /** List installed browser wallets so you can show your own picker. */
  listWallets(): Promise<DetectedWallet[]> {
    return discoverWallets();
  }

  /**
   * Connect a browser wallet. Pass one from listWallets() or let the SDK pick the first.
   * Switches (or adds) the configured Base network automatically.
   */
  async connect(wallet?: DetectedWallet): Promise<string> {
    const chosen = wallet ?? (await discoverWallets())[0];
    if (!chosen) throw new Error("No wallet found. Install MetaMask, Rabby or Coinbase Wallet, or open this app in a wallet browser.");
    return this.connectProvider(chosen.provider);
  }

  /**
   * Connect any EIP-1193 provider: an injected wallet, WalletConnect / Reown AppKit on
   * mobile, an embedded wallet, etc. Requests accounts and switches to the configured network.
   */
  async connectProvider(provider: Eip1193Provider & EventSource): Promise<string> {
    this.detach();
    this.eip1193 = provider;
    await provider.request({ method: "eth_requestAccounts" });
    await this.ensureNetwork();
    this.signer = await new BrowserProvider(provider).getSigner();
    this.setAddress(await this.signer.getAddress());
    const onAccounts = async (a: string[]) => {
      if (!a?.[0]) return this.disconnect();
      this.signer = await new BrowserProvider(provider).getSigner();
      this.setAddress(getAddress(a[0]));
    };
    provider.on?.("accountsChanged", onAccounts);
    this.detachFn = () => provider.removeListener?.("accountsChanged", onAccounts);
    return this.address!;
  }

  private detachFn?: () => void;
  private detach() {
    this.detachFn?.();
    this.detachFn = undefined;
  }

  /** Server-side or scripted use: bring your own ethers Signer (e.g. a Wallet). */
  async useSigner(signer: Signer): Promise<string> {
    this.signer = signer.provider ? signer : signer.connect(this.readProvider);
    this.setAddress(await signer.getAddress());
    return this.address!;
  }

  /** The connected ethers Signer (throws if not connected). */
  getSigner(): Signer {
    return this.requireSigner();
  }

  disconnect(): void {
    this.detach();
    this.signer = undefined;
    this.eip1193 = undefined;
    this.setAddress(null);
  }

  onAccountChange(cb: (address: string | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Ask the wallet to switch to the configured chain, adding it if needed. */
  async ensureNetwork(): Promise<void> {
    const p = this.eip1193;
    if (!p) return;
    const want = "0x" + this.network.chainId.toString(16); // MetaMask requires unpadded hex (0x14a34, not 0x014a34)
    const current = await p.request({ method: "eth_chainId" });
    if (parseInt(current, 16) === this.network.chainId) return;
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
    } catch (e: any) {
      if (e?.code !== 4902) throw e;
      await p.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: want,
          chainName: this.network.name,
          rpcUrls: [this.network.rpcUrl],
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          blockExplorerUrls: this.network.explorer ? [this.network.explorer] : [],
        }],
      });
    }
  }

  /** Sign a free, human-readable message to prove wallet ownership (no funds move). */
  async signIn(statement = "Sign in to this app with apptochain."): Promise<{ address: string; message: string; signature: string }> {
    const s = this.requireSigner();
    const message = `${statement}\nAddress: ${this.address}\nChain: ${this.network.chainId}\nNonce: ${randomId()}\nIssued: ${new Date().toISOString()}\nThis signature is free and does not move funds.`;
    return { address: this.address!, message, signature: await s.signMessage(message) };
  }

  // ───────────────────────── 2. MAP ─────────────────────────

  /** Register named actions: which app features become on-chain. */
  map(actions: Record<string, ActionDef>): this {
    for (const [name, a] of Object.entries(actions)) {
      if (!ABI[a.kind]) throw new Error(`Action "${name}": unknown kind "${a.kind}"`);
      new Contract(a.module, ABI[a.kind]).interface.getFunction(a.method); // throws if the method doesn't exist
      this.actions[name] = { gasless: true, ...a, module: getAddress(a.module) };
    }
    return this;
  }

  /** Run a mapped action. Gasless actions are signed by the user and paid by the relayer. */
  async run(action: string, args: unknown[] = [], opts: { value?: bigint } = {}): Promise<RunResult> {
    const def = this.actions[action];
    if (!def) throw new Error(`Unknown action "${action}". Register it with map() first.`);
    const iface = new Contract(def.module, ABI[def.kind]).interface;
    const data = iface.encodeFunctionData(def.method, args);
    const value = opts.value ?? 0n;

    if (def.gasless && value === 0n) {
      if (!this.relayer) throw new Error("Gasless action needs relayerUrl in the AppToChain options.");
      const req = await this.signForwardRequest(def.module, data);
      const r = await this.relayer.relay(req);
      return { via: "relayer", hash: r.hash, wait: () => this.waitRelay(r) };
    }
    const tx = await this.requireSigner().sendTransaction({ to: def.module, data, value });
    return {
      via: "wallet",
      hash: tx.hash,
      wait: async () => {
        const rc = await tx.wait();
        return { status: rc?.status === 1 ? "confirmed" : "failed", blockNumber: rc?.blockNumber };
      },
    };
  }

  /** Build and sign an ERC-2771 ForwardRequest for any call (advanced use). */
  async signForwardRequest(to: string, data: string, { gas = 400_000n, ttlSeconds = 600 } = {}): Promise<ForwardRequestData> {
    const s = this.requireSigner();
    const forwarderAddr = this.requireAddr("forwarder");
    const fwd = new Contract(forwarderAddr, ATCForwarderAbi as unknown as InterfaceAbi, this.readProvider);
    const from = this.address!;
    const nonce: bigint = await fwd.nonces(from);
    const deadline = Math.floor(Date.now() / 1000) + ttlSeconds;
    const domain = { name: "apptochain", version: "1", chainId: this.network.chainId, verifyingContract: forwarderAddr };
    const message = { from, to: getAddress(to), value: 0n, gas, nonce, deadline, data };
    const signature = await s.signTypedData(domain, FORWARD_TYPES, message);
    return { from, to: message.to, value: "0", gas: gas.toString(), deadline, data, signature };
  }

  private async waitRelay(r: RelayResult, timeoutMs = 120_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const rc = await this.readProvider.getTransactionReceipt(r.hash);
      if (rc) return { status: rc.status === 1 ? ("confirmed" as const) : ("failed" as const), blockNumber: rc.blockNumber };
      await new Promise((res) => setTimeout(res, 1500));
    }
    throw new Error(`Timed out waiting for ${r.hash}`);
  }

  // ───────────────────────── 3. LAUNCH ─────────────────────────

  /** Deploy app modules through the factory. The connected wallet becomes the owner. */
  readonly deploy = {
    membership: (c: { name: string; symbol: string; baseURI?: string; priceEth?: string; durationDays?: number; maxSupply?: number }, appId = "app") =>
      this.deployModule("membership", ["string", "string", "string", "uint256", "uint64", "uint256"],
        [c.name, c.symbol, c.baseURI ?? "", parseEther(c.priceEth ?? "0"), BigInt((c.durationDays ?? 0) * 86400), BigInt(c.maxSupply ?? 0)], appId),
    assets: (c: { name: string; uri: string }, appId = "app") =>
      this.deployModule("assets", ["string", "string"], [c.name, c.uri], appId),
    rewards: (c: { name: string; symbol: string; transferable?: boolean }, appId = "app") =>
      this.deployModule("rewards", ["string", "string", "bool"], [c.name, c.symbol, c.transferable ?? false], appId),
    payments: (c: { payee: string; acceptedTokens?: string[] }, appId = "app") =>
      this.deployModule("payments", ["address", "address[]"], [getAddress(c.payee), (c.acceptedTokens ?? []).map(getAddress)], appId),
  };

  private async deployModule(kind: ModuleKind, types: string[], values: unknown[], appId: string): Promise<string> {
    const factory = this.factory(true);
    const fee: bigint = await factory.deploymentFee();
    const config = AbiCoder.defaultAbiCoder().encode(types, values);
    const tx = await factory.deploy(KIND_ID[kind], config, appId, { value: fee });
    const rc: ContractTransactionReceipt = await tx.wait();
    for (const log of rc.logs) {
      try {
        const ev = factory.interface.parseLog(log);
        if (ev?.name === "AppDeployed") return getAddress(ev.args.app);
      } catch { /* other contract's log */ }
    }
    throw new Error("Deployment succeeded but AppDeployed event was not found.");
  }

  /** All modules deployed by an address (defaults to the connected wallet). */
  async myModules(owner = this.address): Promise<{ address: string; kind: ModuleKind | "unknown" }[]> {
    if (!owner) throw new Error("Connect a wallet or pass an owner address.");
    const f = this.factory(false);
    const addrs: string[] = await f.appsOf(owner);
    const byId = Object.fromEntries(Object.entries(KIND_ID).map(([k, v]) => [v, k]));
    return Promise.all(addrs.map(async (a) => ({ address: a, kind: (byId[await f.kindOf(a)] ?? "unknown") as ModuleKind })));
  }

  /** Get an ethers Contract for a module, connected to the signer if available. */
  module(kind: ModuleKind, address: string): Contract {
    return new Contract(address, ABI[kind], this.signer ?? this.readProvider);
  }

  // ───────────────────────── helpers ─────────────────────────

  private factory(write: boolean): Contract {
    return new Contract(this.requireAddr("factory"), ATCFactoryAbi as unknown as InterfaceAbi, write ? this.requireSigner() : this.readProvider);
  }
  private requireSigner(): Signer {
    if (!this.signer) throw new Error("Not connected. Call connect() or useSigner() first.");
    return this.signer;
  }
  private requireAddr(k: "factory" | "forwarder"): string {
    const a = this.network[k];
    if (!a) throw new Error(`No ${k} address for ${this.network.name}. Pass deployment: require("deployments/<network>.json").`);
    return a;
  }
  private setAddress(a: string | null) {
    this.address = a;
    this.listeners.forEach((cb) => cb(a));
  }
}
