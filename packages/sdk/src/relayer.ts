export interface ForwardRequestData {
  from: string;
  to: string;
  value: string;
  gas: string;
  deadline: number;
  data: string;
  signature: string;
}

export interface RelayResult {
  id: string;
  hash: string;
  status: "submitted" | "confirmed" | "failed";
}

export class RelayerError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = "RelayerError";
  }
}

/** Thin HTTP client for the apptochain relayer. */
export class RelayerClient {
  constructor(private url: string, private apiKey?: string, private appId?: string) {
    this.url = url.replace(/\/$/, "");
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) h["x-api-key"] = this.apiKey;
    if (this.appId) h["x-app-id"] = this.appId;
    return h;
  }

  async relay(request: ForwardRequestData): Promise<RelayResult> {
    const res = await fetch(`${this.url}/v1/relay`, { method: "POST", headers: this.headers(), body: JSON.stringify({ request }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new RelayerError(body.error || `Relayer error ${res.status}`, res.status, body.code);
    return body as RelayResult;
  }

  async status(hash: string): Promise<RelayResult & { blockNumber?: number }> {
    const res = await fetch(`${this.url}/v1/status/${hash}`, { headers: this.headers() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new RelayerError(body.error || `Relayer error ${res.status}`, res.status, body.code);
    return body;
  }

  async health(): Promise<{ ok: boolean; chainId: number; relayer: string; balance: string; lowBalance: boolean }> {
    const res = await fetch(`${this.url}/health`);
    return res.json();
  }
}
