export interface NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorer?: string;
  /** Filled in after you run the contracts deploy script for this network. */
  factory?: string;
  forwarder?: string;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  base: {
    name: "Base",
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    explorer: "https://basescan.org",
  },
  baseSepolia: {
    name: "Base Sepolia",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
  },
  localhost: {
    name: "Local Hardhat",
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
  },
};

export type NetworkInput = keyof typeof NETWORKS | NetworkConfig;

/** Merge a preset (or custom config) with addresses from a deployments/<network>.json file. */
export function resolveNetwork(
  input: NetworkInput,
  deployment?: { factory?: string; forwarder?: string; chainId?: number },
): NetworkConfig {
  const base = typeof input === "string" ? NETWORKS[input] : input;
  if (!base) throw new Error(`Unknown network "${String(input)}". Use base, baseSepolia, localhost or a custom config.`);
  if (deployment?.chainId && deployment.chainId !== base.chainId) {
    throw new Error(`Deployment file is for chain ${deployment.chainId}, but network is ${base.chainId}.`);
  }
  return { ...base, factory: deployment?.factory ?? base.factory, forwarder: deployment?.forwarder ?? base.forwarder };
}
