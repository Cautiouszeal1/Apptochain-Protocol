import fs from "node:fs";
import express from "express";
import cors from "cors";
import {
  Contract, Interface, JsonRpcProvider, Wallet, formatEther, getAddress, isAddress, isHexString, parseEther, parseUnits,
} from "ethers";
import { DailyQuota, Mutex, RateLimiter } from "./limits.js";
import { createStore } from "./store.js";
import { Auth } from "./auth.js";

const FORWARDER_ABI = [
  "function verify((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) view returns (bool)",
  "function execute((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) payable",
  "function nonces(address owner) view returns (uint256)",
];
const FACTORY_ABI = ["function isApp(address) view returns (bool)"];
const OWNABLE_ABI = ["function owner() view returns (address)"];

// Decode common custom errors so app developers get readable messages.
const ERRORS = new Interface([
  "error ERC2771ForwarderInvalidSigner(address signer, address from)",
  "error ERC2771ForwarderExpiredRequest(uint48 deadline)",
  "error ERC2771ForwarderMismatchedValue(uint256 requestedValue, uint256 msgValue)",
  "error ERC2771UntrustfulTarget(address target, address forwarder)",
  "error FailedCall()",
  "error OwnableUnauthorizedAccount(address account)",
  "error WrongPayment(uint256 expected, uint256 sent)",
  "error SoldOut()",
  "error ExceedsSupply(uint256 id)",
  "error UnknownItem(uint256 id)",
  "error NotAwarder()",
  "error NonTransferable()",
  "error AlreadyPaid(bytes32 orderId)",
  "error TokenNotAccepted(address token)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
]);

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const bool = (v, d) => (v === undefined || v === "" ? d : /^(1|true|yes)$/i.test(v));

export function loadConfig(env = process.env) {
  const req = (k) => {
    if (!env[k]) throw new Error(`Missing ${k} in environment (see .env.example)`);
    return env[k];
  };
  const keys = new Map();
  for (const pair of (env.API_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [appId, key] = pair.split(":");
    if (appId && key) keys.set(key, appId);
  }
  return {
    port: Number(env.PORT || 8787),
    rpcUrl: req("RPC_URL"),
    privateKey: req("RELAYER_PRIVATE_KEY"),
    forwarder: getAddress(req("FORWARDER_ADDRESS")),
    factory: getAddress(req("FACTORY_ADDRESS")),
    apiKeys: keys,
    allowSandbox: bool(env.ALLOW_SANDBOX, true),
    databaseUrl: env.DATABASE_URL || "",
    sessionSecret: env.SESSION_SECRET || "",
    corsOrigins: (env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
    maxGas: BigInt(env.MAX_GAS_PER_REQUEST || 600000),
    maxGasPriceGwei: env.MAX_GAS_PRICE_GWEI || "",
    perMinute: Number(env.RATE_LIMIT_PER_MINUTE || 10),
    dailyQuota: Number(env.DAILY_QUOTA_PER_APP || 1000),
    lowBalance: parseEther(env.LOW_BALANCE_ETH || "0.005"),
    alertWebhook: env.ALERT_WEBHOOK_URL || "",
    logFile: env.LOG_FILE || "relay-log.jsonl",
  };
}

export async function createApp(cfg) {
  const provider = new JsonRpcProvider(cfg.rpcUrl);
  const { chainId } = await provider.getNetwork();
  const wallet = new Wallet(cfg.privateKey, provider);
  const forwarder = new Contract(cfg.forwarder, FORWARDER_ABI, wallet);
  const factory = new Contract(cfg.factory, FACTORY_ABI, provider);
  const store = cfg.store ?? (await createStore(cfg.databaseUrl));
  const auth = cfg.sessionSecret ? new Auth(cfg.sessionSecret, { chainId: Number(chainId) }) : null;
  const maxGasPrice = cfg.maxGasPriceGwei ? parseUnits(cfg.maxGasPriceGwei, "gwei") : null;

  const perSigner = new RateLimiter(cfg.perMinute, 60_000);
  const perIp = new RateLimiter(cfg.perMinute * 5, 60_000);
  const authLimiter = new RateLimiter(20, 60_000);
  const quota = new DailyQuota(cfg.dailyQuota);
  const sendLock = new Mutex();
  const appCache = new Map();   // module -> true (only positives cached)
  const ownerCache = new Map(); // module -> { owner, at }
  const recent = new Map();     // hash -> record
  let lastAlert = 0;
  let nextNonce = null; // tracked locally so fast back-to-back relays never reuse a nonce

  /** Send inside the mutex with an explicit nonce (bypasses the provider's short response cache). */
  async function sendRelay(r) {
    return sendLock.run(async () => {
      const pending = BigInt(await provider.send("eth_getTransactionCount", [wallet.address, "pending"]));
      const nonce = nextNonce !== null && nextNonce > pending ? nextNonce : pending;
      try {
        const tx = await forwarder.execute(r, { gasLimit: r.gas + 120_000n, nonce });
        nextNonce = nonce + 1n;
        return tx;
      } catch (e) {
        nextNonce = null; // resync from chain next time
        throw e;
      }
    });
  }

  const log = (rec) => {
    recent.set(rec.hash, rec);
    if (recent.size > 5000) recent.delete(recent.keys().next().value);
    try { fs.appendFileSync(cfg.logFile, JSON.stringify(rec) + "\n"); } catch { /* logging must never break relaying */ }
  };
  const safe = (p) => p.catch((e) => console.error("[relayer] store error:", e.message));

  async function isRegisteredApp(addr) {
    if (appCache.get(addr)) return true;
    const ok = await factory.isApp(addr);
    if (ok) appCache.set(addr, true);
    return ok;
  }

  async function ownerOf(addr) {
    const c = ownerCache.get(addr);
    if (c && Date.now() - c.at < 5 * 60_000) return c.owner;
    const owner = getAddress(await new Contract(addr, OWNABLE_ABI, provider).owner());
    ownerCache.set(addr, { owner, at: Date.now() });
    return owner;
  }

  async function checkBalance() {
    const bal = await provider.getBalance(wallet.address);
    const low = bal < cfg.lowBalance;
    if (low && cfg.alertWebhook && Date.now() - lastAlert > 3600_000) {
      lastAlert = Date.now();
      const text = `⚠️ apptochain relayer low balance: ${formatEther(bal)} ETH on chain ${chainId} (${wallet.address}). Top it up.`;
      fetch(cfg.alertWebhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, content: text }), // Slack/Telegram-bridge use "text", Discord uses "content"
      }).catch(() => {});
    }
    return { bal, low };
  }

  function parseRequest(body) {
    const r = body && body.request;
    if (!r) throw new HttpError(400, "BAD_REQUEST", "Body must be { request: ForwardRequestData }");
    try {
      const out = {
        from: getAddress(r.from),
        to: getAddress(r.to),
        value: BigInt(r.value ?? 0),
        gas: BigInt(r.gas),
        deadline: Number(r.deadline),
        data: r.data,
        signature: r.signature,
      };
      if (!isHexString(out.data) || !isHexString(out.signature, 65)) throw new Error("hex");
      return out;
    } catch {
      throw new HttpError(400, "BAD_REQUEST", "Malformed request fields");
    }
  }

  function decodeRevert(e) {
    const data = e?.data || e?.info?.error?.data || e?.error?.data;
    if (typeof data === "string" && data.length >= 10) {
      try {
        const parsed = ERRORS.parseError(data);
        if (parsed) return `${parsed.name}(${parsed.args.map(String).join(", ")})`;
      } catch { /* unknown error */ }
    }
    return e?.shortMessage || e?.reason || "Execution reverted";
  }

  /** Resolve who is calling: a dashboard key, a static env key, or the open sandbox. */
  async function identify(req) {
    const key = req.get("x-api-key");
    if (key) {
      if (cfg.apiKeys.has(key)) return { kind: "static", appId: cfg.apiKeys.get(key), keyId: `env:${cfg.apiKeys.get(key)}` };
      const found = await store.findKey(key);
      if (found) return { kind: "builder", appId: `key:${found.id}`, keyId: found.id, owner: getAddress(found.owner) };
      throw new HttpError(401, "UNAUTHORIZED", "Invalid or revoked API key");
    }
    if (cfg.allowSandbox) return { kind: "sandbox", appId: `sandbox:${req.get("x-app-id") || "anon"}`, keyId: null };
    throw new HttpError(401, "UNAUTHORIZED", "An API key is required. Create one in the apptochain dashboard.");
  }

  function requireSession(req) {
    if (!auth) throw new HttpError(503, "AUTH_DISABLED", "Dashboard sign-in is not configured on this relayer (set SESSION_SECRET)");
    const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const addr = auth.check(token);
    if (!addr) throw new HttpError(401, "UNAUTHORIZED", "Sign in again");
    return addr;
  }

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "64kb" }));
  app.use(cors(cfg.corsOrigins.length ? { origin: cfg.corsOrigins } : {}));
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ───────────── public ─────────────
  app.get("/health", wrap(async (_req, res) => {
    const { bal, low } = await checkBalance();
    res.json({
      ok: true,
      chainId: Number(chainId),
      relayer: wallet.address,
      forwarder: cfg.forwarder,
      factory: cfg.factory,
      balance: formatEther(bal),
      lowBalance: low,
      sandbox: cfg.allowSandbox,
      dashboard: !!auth,
    });
  }));

  app.post("/v1/relay", wrap(async (req, res) => {
    // 1. Who is calling
    if (!perIp.take(req.ip)) throw new HttpError(429, "RATE_LIMITED", "Too many requests from this IP");
    const caller = await identify(req);

    // 2. Shape and policy checks (cheap, no RPC)
    const r = parseRequest(req.body);
    if (r.value !== 0n) throw new HttpError(400, "VALUE_NOT_ALLOWED", "Gasless requests cannot carry ETH. Send paid actions from the wallet.");
    if (r.gas > cfg.maxGas) throw new HttpError(400, "GAS_TOO_HIGH", `gas must be <= ${cfg.maxGas}`);
    if (r.deadline <= Math.floor(Date.now() / 1000)) throw new HttpError(400, "EXPIRED", "Request deadline has passed");
    if (!perSigner.take(r.from)) throw new HttpError(429, "RATE_LIMITED", "Too many actions from this wallet, try again in a minute");

    // 3. Target must be an apptochain module; builder keys only sponsor their own modules
    if (!(await isRegisteredApp(r.to))) throw new HttpError(403, "TARGET_NOT_ALLOWED", "Target is not a contract deployed through the apptochain factory");
    const moduleOwner = await ownerOf(r.to);
    if (caller.kind === "builder" && moduleOwner !== caller.owner) {
      throw new HttpError(403, "KEY_NOT_FOR_TARGET", "This API key can only sponsor modules owned by its builder");
    }

    // 4. Signature and nonce
    if (!(await forwarder.verify(r))) throw new HttpError(400, "BAD_SIGNATURE", "Signature invalid, nonce already used, or request expired");

    // 5. Simulate so we never pay for a failing transaction
    try {
      await forwarder.execute.staticCall(r);
    } catch (e) {
      throw new HttpError(422, "WOULD_REVERT", decodeRevert(e));
    }

    // 6. Network fee ceiling
    if (maxGasPrice) {
      const fee = await provider.getFeeData();
      const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
      if (price > maxGasPrice) throw new HttpError(503, "GAS_TOO_EXPENSIVE", "Network fees are unusually high right now, try again shortly");
    }

    if (!quota.take(caller.appId)) throw new HttpError(429, "QUOTA_EXCEEDED", "Daily quota reached for this API key");

    // 7. Submit (serialised to keep nonces in order)
    const tx = await sendRelay(r);
    const rec = {
      hash: tx.hash, status: "submitted", appId: caller.appId, keyId: caller.keyId, owner: moduleOwner,
      from: r.from, target: r.to, selector: r.data.slice(0, 10), at: new Date().toISOString(),
    };
    log(rec);
    safe(store.recordRelay(rec));
    tx.wait().then(
      (rc) => {
        const status = rc.status === 1 ? "confirmed" : "failed";
        const feeWei = (rc.gasUsed * (rc.gasPrice ?? 0n)).toString();
        log({ ...rec, status, blockNumber: rc.blockNumber, gasUsed: rc.gasUsed.toString(), feeWei });
        safe(store.updateRelay(tx.hash, status, feeWei));
        checkBalance().catch(() => {});
      },
      () => { log({ ...rec, status: "failed" }); safe(store.updateRelay(tx.hash, "failed")); },
    );
    res.status(202).json({ id: rec.hash, hash: rec.hash, status: rec.status });
  }));

  app.get("/v1/status/:hash", wrap(async (req, res) => {
    const hash = req.params.hash;
    if (!isHexString(hash, 32)) throw new HttpError(400, "BAD_REQUEST", "Invalid hash");
    const rc = await provider.getTransactionReceipt(hash);
    if (rc) return res.json({ id: hash, hash, status: rc.status === 1 ? "confirmed" : "failed", blockNumber: rc.blockNumber });
    if (!recent.get(hash)) throw new HttpError(404, "NOT_FOUND", "Unknown transaction");
    res.json({ id: hash, hash, status: "submitted" });
  }));

  // ───────────── dashboard: sign in ─────────────
  app.get("/v1/auth/nonce", wrap(async (req, res) => {
    if (!auth) throw new HttpError(503, "AUTH_DISABLED", "Dashboard sign-in is not configured on this relayer (set SESSION_SECRET)");
    if (!authLimiter.take(req.ip)) throw new HttpError(429, "RATE_LIMITED", "Too many sign-in attempts");
    const address = String(req.query.address || "");
    if (!isAddress(address)) throw new HttpError(400, "BAD_REQUEST", "Pass ?address=0x…");
    res.json(auth.issue(address));
  }));

  app.post("/v1/auth/verify", wrap(async (req, res) => {
    if (!auth) throw new HttpError(503, "AUTH_DISABLED", "Dashboard sign-in is not configured");
    try {
      res.json(auth.verify(req.body?.message, req.body?.signature));
    } catch (e) {
      throw new HttpError(401, "BAD_SIGNATURE", e.message);
    }
  }));

  // ───────────── dashboard: keys and usage ─────────────
  app.get("/v1/keys", wrap(async (req, res) => {
    res.json({ keys: await store.listKeys(requireSession(req)) });
  }));

  app.post("/v1/keys", wrap(async (req, res) => {
    const owner = requireSession(req);
    const name = String(req.body?.name || "").trim().slice(0, 48) || "Untitled key";
    const active = (await store.listKeys(owner)).filter((k) => !k.revokedAt);
    if (active.length >= 10) throw new HttpError(400, "TOO_MANY_KEYS", "Revoke an old key first (limit 10 active keys)");
    res.status(201).json(await store.createKey(owner, name));
  }));

  app.delete("/v1/keys/:id", wrap(async (req, res) => {
    const ok = await store.revokeKey(requireSession(req), req.params.id);
    if (!ok) throw new HttpError(404, "NOT_FOUND", "Key not found or already revoked");
    res.json({ ok: true });
  }));

  app.get("/v1/usage", wrap(async (req, res) => {
    const owner = requireSession(req);
    const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
    const series = await store.usage(owner, days);
    const total = series.reduce((a, d) => a + d.count, 0);
    const feeWei = series.reduce((a, d) => a + BigInt(d.feeWei), 0n);
    res.json({ days: series, total, gasSponsoredEth: formatEther(feeWei) });
  }));

  app.get("/v1/relays", wrap(async (req, res) => {
    const owner = requireSession(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    res.json({ relays: await store.recentRelays(owner, limit) });
  }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON", code: "BAD_REQUEST" });
    console.error("[relayer]", err);
    res.status(500).json({ error: "Internal error", code: "INTERNAL" });
  });

  return { app, wallet, chainId: Number(chainId), store };
}
