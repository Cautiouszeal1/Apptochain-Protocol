// React + React Native hooks for apptochain. No DOM APIs, so the same code runs on web and mobile.
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { AppToChain, RelayerError, type AppToChainOptions, type ModuleKind } from "@apptochain/sdk";
import type { Eip1193Provider, Signer } from "ethers";

export type { AppToChainOptions, ModuleKind } from "@apptochain/sdk";

// ───────────────────────── provider ─────────────────────────

interface Ctx {
  atc: AppToChain;
  address: string | null;
}
const AppToChainContext = createContext<Ctx | null>(null);

export interface AppToChainProviderProps {
  /** Same options as `new AppToChain(...)`. Read once on mount. */
  config: AppToChainOptions;
  /** Optional: an existing instance instead of `config` (useful for tests or sharing). */
  client?: AppToChain;
  children: ReactNode;
}

/** Wrap your app once, near the root. */
export function AppToChainProvider({ config, client, children }: AppToChainProviderProps) {
  const atc = useMemo(() => client ?? new AppToChain(config), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [address, setAddress] = useState<string | null>(atc.address);
  useEffect(() => atc.onAccountChange(setAddress), [atc]);
  const value = useMemo(() => ({ atc, address }), [atc, address]);
  return <AppToChainContext.Provider value={value}>{children}</AppToChainContext.Provider>;
}

function useCtx(): Ctx {
  const c = useContext(AppToChainContext);
  if (!c) throw new Error("apptochain hooks must be used inside <AppToChainProvider>.");
  return c;
}

// ───────────────────────── connection ─────────────────────────

export interface UseAppToChain {
  atc: AppToChain;
  address: string | null;
  isConnected: boolean;
  connecting: boolean;
  error: string | null;
  /** Web: connect the first installed browser wallet. */
  connect: () => Promise<string | null>;
  /** Any EIP-1193 provider, e.g. from Reown AppKit's `useProvider()` on mobile. */
  connectProvider: (provider: Eip1193Provider) => Promise<string | null>;
  /** Scripts/tests: an ethers Signer. */
  useSigner: (signer: Signer) => Promise<string | null>;
  disconnect: () => void;
}

export function useAppToChain(): UseAppToChain {
  const { atc, address } = useCtx();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrap = useCallback(async (fn: () => Promise<string>) => {
    setConnecting(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(message(e));
      return null;
    } finally {
      setConnecting(false);
    }
  }, []);

  return {
    atc,
    address,
    isConnected: !!address,
    connecting,
    error,
    connect: useCallback(() => wrap(() => atc.connect()), [atc, wrap]),
    connectProvider: useCallback((p: Eip1193Provider) => wrap(() => atc.connectProvider(p)), [atc, wrap]),
    useSigner: useCallback((s: Signer) => wrap(() => atc.useSigner(s)), [atc, wrap]),
    disconnect: useCallback(() => atc.disconnect(), [atc]),
  };
}

/**
 * Keep apptochain connected to an external wallet provider.
 * On mobile: `useWalletProvider(useProvider().provider)` with Reown AppKit.
 * Connects when the provider appears and disconnects when it goes away.
 */
export function useWalletProvider(provider: Eip1193Provider | undefined | null) {
  const { connectProvider, disconnect, address, connecting, error } = useAppToChain();
  const last = useRef<Eip1193Provider | null>(null);
  useEffect(() => {
    if (provider && provider !== last.current) {
      last.current = provider;
      connectProvider(provider);
    } else if (!provider && last.current) {
      last.current = null;
      disconnect();
    }
  }, [provider, connectProvider, disconnect]);
  return { address, connecting, error };
}

// ───────────────────────── actions ─────────────────────────

export type ActionStatus = "idle" | "signing" | "relaying" | "sending" | "confirmed" | "failed";

export interface UseAction {
  run: (args?: unknown[], opts?: { value?: bigint }) => Promise<{ status: "confirmed" | "failed"; hash: string } | null>;
  status: ActionStatus;
  /** True while waiting for the wallet or the chain. */
  busy: boolean;
  hash: string | null;
  error: string | null;
  /** Relayer error code, e.g. RATE_LIMITED, WOULD_REVERT. */
  errorCode: string | null;
  reset: () => void;
}

/** Run an action registered with `atc.map(...)` (or passed in `config.actions`). */
export function useAction(name: string): UseAction {
  const { atc } = useCtx();
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const mounted = useMounted();

  const run = useCallback(async (args: unknown[] = [], opts: { value?: bigint } = {}) => {
    setError(null);
    setErrorCode(null);
    setHash(null);
    setStatus("signing");
    try {
      const r = await atc.run(name, args, opts);
      if (!mounted.current) return null;
      setHash(r.hash);
      setStatus(r.via === "relayer" ? "relaying" : "sending");
      const done = await r.wait();
      if (mounted.current) setStatus(done.status);
      return { status: done.status, hash: r.hash };
    } catch (e) {
      if (mounted.current) {
        setStatus("failed");
        setError(message(e));
        setErrorCode(e instanceof RelayerError ? e.code ?? null : null);
      }
      return null;
    }
  }, [atc, name, mounted]);

  const reset = useCallback(() => {
    setStatus("idle");
    setHash(null);
    setError(null);
    setErrorCode(null);
  }, []);

  return { run, status, busy: status === "signing" || status === "relaying" || status === "sending", hash, error, errorCode, reset };
}

// ───────────────────────── reads ─────────────────────────

export interface UseRead<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Read any view function on a module and keep it fresh.
 * Example: `useRead<boolean>("membership", club, "hasPass", [address])`
 * Pass `args` containing `undefined`/`null` (e.g. before connecting) to skip the read.
 */
export function useRead<T = unknown>(
  kind: ModuleKind,
  module: string | undefined,
  method: string,
  args: unknown[] = [],
  opts: { refreshMs?: number } = {},
): UseRead<T> {
  const { atc } = useCtx();
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();
  const key = JSON.stringify(args, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const ready = !!module && args.every((a) => a !== undefined && a !== null);

  const refresh = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const c = atc.module(kind, module!);
      const v = (await c.getFunction(method).staticCall(...args)) as T;
      if (mounted.current) { setData(v); setError(null); }
    } catch (e) {
      if (mounted.current) setError(message(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [atc, kind, module, method, key, ready, mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refresh();
    if (!opts.refreshMs) return;
    const t = setInterval(refresh, opts.refreshMs);
    return () => clearInterval(t);
  }, [refresh, opts.refreshMs]);

  return { data, loading, error, refresh };
}

/** Convenience: does `user` (default: connected wallet) hold a valid, unexpired pass? */
export function usePass(membership: string | undefined, user?: string | null) {
  const { address } = useCtx();
  const who = user ?? address;
  return useRead<boolean>("membership", membership, "hasPass", [who ?? undefined]);
}

/** Convenience: points balance of `user` (default: connected wallet). */
export function usePoints(rewards: string | undefined, user?: string | null) {
  const { address } = useCtx();
  const who = user ?? address;
  return useRead<bigint>("rewards", rewards, "balanceOf", [who ?? undefined]);
}

// ───────────────────────── helpers ─────────────────────────

function useMounted() {
  const m = useRef(true);
  useEffect(() => {
    m.current = true;
    return () => { m.current = false; };
  }, []);
  return m;
}

function message(e: unknown): string {
  const x = e as any;
  if (x?.code === 4001 || x?.code === "ACTION_REJECTED") return "You cancelled the request in your wallet.";
  return x?.shortMessage || x?.reason || x?.message || String(e);
}
