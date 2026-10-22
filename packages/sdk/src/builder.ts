import type { Signer } from "ethers";
import { RelayerError } from "./relayer.js";

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
}
export interface NewApiKey extends ApiKeyInfo {
  /** Full secret key. Shown once, store it now. */
  key: string;
}
export interface UsageDay {
  date: string;
  count: number;
  confirmed: number;
  failed: number;
  feeWei: string;
}
export interface Usage {
  days: UsageDay[];
  total: number;
  gasSponsoredEth: string;
}
export interface RelayRecord {
  hash: string;
  status: "submitted" | "confirmed" | "failed";
  target: string;
  selector: string;
  keyId: string | null;
  createdAt: string;
  feeWei: string;
  from: string;
}

/**
 * Builder account API: sign in with a wallet, manage API keys, read usage.
 * Used by the apptochain dashboard; also handy for scripts and CI.
 */
export class BuilderClient {
  private token: string | null = null;
  address: string | null = null;
  expiresAt: string | null = null;

  constructor(private url: string) {
    this.url = url.replace(/\/$/, "");
  }

  /** Restore a saved session (e.g. from localStorage). */
  restore(session: { token: string; address: string; expiresAt: string } | null): boolean {
    if (!session || new Date(session.expiresAt).getTime() < Date.now() + 60_000) return false;
    this.token = session.token;
    this.address = session.address;
    this.expiresAt = session.expiresAt;
    return true;
  }

  get session() {
    return this.token ? { token: this.token, address: this.address!, expiresAt: this.expiresAt! } : null;
  }

  /** Free signature that proves wallet ownership. Returns a 7-day session. */
  async signIn(signer: Signer) {
    const address = await signer.getAddress();
    const { message } = await this.req<{ message: string }>(`/v1/auth/nonce?address=${address}`, { auth: false });
    const signature = await signer.signMessage(message);
    const s = await this.req<{ token: string; address: string; expiresAt: string }>(`/v1/auth/verify`, {
      method: "POST", body: { message, signature }, auth: false,
    });
    this.restore(s);
    return s;
  }

  signOut() {
    this.token = this.address = this.expiresAt = null;
  }

  listKeys() { return this.req<{ keys: ApiKeyInfo[] }>("/v1/keys").then((r) => r.keys); }
  createKey(name: string) { return this.req<NewApiKey>("/v1/keys", { method: "POST", body: { name } }); }
  revokeKey(id: string) { return this.req<{ ok: boolean }>(`/v1/keys/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  usage(days = 14) { return this.req<Usage>(`/v1/usage?days=${days}`); }
  recentRelays(limit = 20) { return this.req<{ relays: RelayRecord[] }>(`/v1/relays?limit=${limit}`).then((r) => r.relays); }
  health() {
    return this.req<{ ok: boolean; chainId: number; relayer: string; balance: string; lowBalance: boolean; sandbox: boolean; dashboard: boolean }>(
      "/health", { auth: false },
    );
  }

  private async req<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.auth !== false) {
      if (!this.token) throw new RelayerError("Not signed in", 401, "UNAUTHORIZED");
      headers.authorization = `Bearer ${this.token}`;
    }
    const res = await fetch(this.url + path, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && opts.auth !== false) this.signOut();
      throw new RelayerError(body.error || `Request failed (${res.status})`, res.status, body.code);
    }
    return body as T;
  }
}
