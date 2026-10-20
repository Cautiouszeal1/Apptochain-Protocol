import fs from "node:fs";
import express from "express";
import cors from "cors";
import { Contract, Interface, JsonRpcProvider, Wallet, formatEther, getAddress, isHexString, parseEther } from "ethers";
import { DailyQuota, Mutex, RateLimiter } from "./limits.js";

const FORWARDER_ABI = [
  "function verify((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) view returns (bool)",
  "function execute((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) payable",
  "function nonces(address owner) view returns (uint256)",
];
const FACTORY_ABI = ["function isApp(address) view returns (bool)"];

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
    corsOrigins: (env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
    maxGas: BigInt(env.MAX_GAS_PER_REQUEST || 600000),
    perMinute: Number(env.RATE_LIMIT_PER_MINUTE || 10),
    dailyQuota: Number(env.DAILY_QUOTA_PER_APP || 1000),
    lowBalance: parseEther(env.LOW_BALANCE_ETH || "0.005"),
    logFile: env.LOG_FILE || "relay-log.jsonl",
  };
}

export async function createApp(cfg) {
  const provider = new JsonRpcProvider(cfg.rpcUrl);
  const { chainId } = await provider.getNetwork();
  const wallet = new Wallet(cfg.privateKey, provider);
  const forwarder = new Contract(cfg.forwarder, FORWARDER_ABI, wallet);
  const factory = new Contract(cfg.factory, FACTORY_ABI, provider);

  const perSigner = new RateLimiter(cfg.perMinute, 60_000);
  const perIp = new RateLimiter(cfg.perMinute * 5, 60_000);
  const quota = new DailyQuota(cfg.dailyQuota);
  const sendLock = new Mutex();
  const appCache = new Map(); // target address -> isApp (only positives cached)
  const recent = new Map();   // hash -> record

  const log = (rec) => {
    recent.set(rec.hash || rec.id, rec);
    if (recent.size > 5000) recent.delete(recent.keys().next().value);
    try { fs.appendFileSync(cfg.logFile, JSON.stringify(rec) + "\n"); } catch { /* logging must never break relaying */ }
  };

  async function isRegisteredApp(addr) {
    if (appCache.get(addr)) return true;
    const ok = await factory.isApp(addr);
    if (ok) appCache.set(addr, true);
    return ok;
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

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "64kb" }));
  app.use(cors(cfg.corsOrigins.length ? { origin: cfg.corsOrigins } : {}));

  app.get("/health", async (_req, res) => {
    const bal = await provider.getBalance(wallet.address);
    res.json({
      ok: true,
      chainId: Number(chainId),
      relayer: wallet.address,
      forwarder: cfg.forwarder,
      factory: cfg.factory,
      balance: formatEther(bal),
      lowBalance: bal < cfg.lowBalance,
    });
  });

  app.post("/v1/relay", async (req, res, next) => {
    try {
      // 1. Who is calling
      let appId = req.get("x-app-id") || "sandbox";
      if (cfg.apiKeys.size) {
        const key = req.get("x-api-key");
        if (!key || !cfg.apiKeys.has(key)) throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid API key");
        appId = cfg.apiKeys.get(key);
      }
      if (!perIp.take(req.ip)) throw new HttpError(429, "RATE_LIMITED", "Too many requests from this IP");

      // 2. Shape and policy checks (cheap, no RPC)
      const r = parseRequest(req.body);
      if (r.value !== 0n) throw new HttpError(400, "VALUE_NOT_ALLOWED", "Gasless requests cannot carry ETH. Send paid actions from the wallet.");
      if (r.gas > cfg.maxGas) throw new HttpError(400, "GAS_TOO_HIGH", `gas must be <= ${cfg.maxGas}`);
      if (r.deadline <= Math.floor(Date.now() / 1000)) throw new HttpError(400, "EXPIRED", "Request deadline has passed");
      if (!perSigner.take(r.from)) throw new HttpError(429, "RATE_LIMITED", "Too many actions from this wallet, try again in a minute");

      // 3. Target must be an apptochain module
      if (!(await isRegisteredApp(r.to))) throw new HttpError(403, "TARGET_NOT_ALLOWED", "Target is not a contract deployed through the apptochain factory");

      // 4. Signature and nonce
      if (!(await forwarder.verify(r))) throw new HttpError(400, "BAD_SIGNATURE", "Signature invalid, nonce already used, or request expired");

      // 5. Simulate so we never pay for a failing transaction
      try {
        await forwarder.execute.staticCall(r);
      } catch (e) {
        throw new HttpError(422, "WOULD_REVERT", decodeRevert(e));
      }

      if (!quota.take(appId)) throw new HttpError(429, "QUOTA_EXCEEDED", `Daily quota reached for app ${appId}`);

      // 6. Submit (serialised to keep nonces in order)
      const tx = await sendLock.run(() => forwarder.execute(r, { gasLimit: r.gas + 120_000n }));
      const rec = {
        id: tx.hash, hash: tx.hash, status: "submitted", appId,
        from: r.from, to: r.to, selector: r.data.slice(0, 10), at: new Date().toISOString(),
      };
      log(rec);
      tx.wait().then(
        (rc) => log({ ...rec, status: rc.status === 1 ? "confirmed" : "failed", blockNumber: rc.blockNumber, gasUsed: rc.gasUsed.toString() }),
        () => log({ ...rec, status: "failed" }),
      );
      res.status(202).json({ id: rec.id, hash: rec.hash, status: rec.status });
    } catch (e) {
      next(e);
    }
  });

  app.get("/v1/status/:hash", async (req, res, next) => {
    try {
      const hash = req.params.hash;
      if (!isHexString(hash, 32)) throw new HttpError(400, "BAD_REQUEST", "Invalid hash");
      const rc = await provider.getTransactionReceipt(hash);
      if (rc) return res.json({ id: hash, hash, status: rc.status === 1 ? "confirmed" : "failed", blockNumber: rc.blockNumber });
      const known = recent.get(hash);
      if (!known) throw new HttpError(404, "NOT_FOUND", "Unknown transaction");
      res.json({ id: hash, hash, status: "submitted" });
    } catch (e) {
      next(e);
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON", code: "BAD_REQUEST" });
    console.error("[relayer]", err);
    res.status(500).json({ error: "Internal error", code: "INTERNAL" });
  });

  return { app, wallet, chainId: Number(chainId) };
}
