// End-to-end check of the whole Phase 2 stack on a throwaway local chain:
// hardhat node → deploy core → relayer → SDK deploys modules → gasless user actions → abuse checks.
// Run: npm run e2e   (needs `npm run build` first so the SDK dist exists)
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, Wallet, NonceManager } from "ethers";
import { AppToChain, RelayerError } from "@apptochain/sdk";
import { createApp } from "../packages/relayer/src/app.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contractsDir = path.join(root, "packages", "contracts");
const RPC = "http://127.0.0.1:8545";
// Hardhat's well-known test keys. Public knowledge — never use them on a real network.
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  relayer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  builder: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  user: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
};

let pass = 0;
const ok = (cond, msg) => {
  if (!cond) throw new Error("FAIL: " + msg);
  pass++;
  console.log("  ✔", msg);
};
const expectRelayError = async (p, code, msg) => {
  try { await p; } catch (e) { return ok(e instanceof RelayerError && e.code === code, `${msg} (${code})`); }
  throw new Error(`FAIL: ${msg} — expected ${code}, but it succeeded`);
};

async function waitForRpc(provider, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { await provider.getBlockNumber(); return; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error("Local chain did not start");
}

const node = spawn("npx", ["hardhat", "node"], { cwd: contractsDir, stdio: "ignore", shell: process.platform === "win32" });
let server;
try {
  console.log("1. Starting local chain…");
  const provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true, pollingInterval: 250 });
  await waitForRpc(provider);

  console.log("2. Deploying core contracts…");
  execSync("npx hardhat run scripts/deploy.js --network localhost", { cwd: contractsDir, stdio: "ignore" });
  const dep = JSON.parse(fs.readFileSync(path.join(contractsDir, "deployments", "localhost.json"), "utf8"));
  ok(dep.factory && dep.forwarder, "core deployed and recorded in deployments/localhost.json");

  console.log("3. Starting relayer…");
  const { app } = await createApp({
    port: 8788, rpcUrl: RPC, privateKey: KEYS.relayer, forwarder: dep.forwarder, factory: dep.factory,
    apiKeys: new Map([["test-key", "e2e-app"]]), corsOrigins: [], maxGas: 600000n,
    perMinute: 50, dailyQuota: 1000, lowBalance: 1n, logFile: path.join(root, "scripts", ".e2e-relay-log.jsonl"),
  });
  server = await new Promise((r) => { const s = app.listen(8788, () => r(s)); });
  const health = await (await fetch("http://127.0.0.1:8788/health")).json();
  ok(health.ok && health.chainId === 31337, "relayer healthy on chain 31337");

  const opts = { network: "localhost", deployment: dep, relayerUrl: "http://127.0.0.1:8788", apiKey: "test-key" };

  console.log("4. Builder deploys modules through the SDK…");
  const builder = new AppToChain(opts);
  await builder.useSigner(new NonceManager(new Wallet(KEYS.builder, provider)));
  const membership = await builder.deploy.membership({ name: "E2E Club", symbol: "E2E", durationDays: 30 }, "e2e");
  const rewards = await builder.deploy.rewards({ name: "E2E Points", symbol: "PTS" }, "e2e");
  const mine = await builder.myModules();
  ok(mine.length === 2 && mine[0].kind === "membership" && mine[1].kind === "rewards", "factory registry lists both modules with kinds");

  console.log("5. User claims a pass gaslessly…");
  const userWallet = new Wallet(KEYS.user, provider);
  const user = new AppToChain({ ...opts, actions: { claimPass: { kind: "membership", module: membership, method: "mint" } } });
  await user.useSigner(userWallet);
  const balBefore = await provider.getBalance(userWallet.address);
  const r1 = await user.run("claimPass");
  ok(r1.via === "relayer", "action routed through relayer");
  ok((await r1.wait()).status === "confirmed", "relayed mint confirmed");
  ok((await user.module("membership", membership).ownerOf(1)) === userWallet.address, "user (not relayer) owns pass #1");
  ok((await provider.getBalance(userWallet.address)) === balBefore, "user spent zero gas");
  const st = await (await fetch(`http://127.0.0.1:8788/v1/status/${r1.hash}`, { headers: { "x-api-key": "test-key" } })).json();
  ok(st.status === "confirmed", "status endpoint reports confirmed");

  console.log("6. Builder awards points gaslessly…");
  builder.map({ earn: { kind: "rewards", module: rewards, method: "award" } });
  const r2 = await builder.run("earn", [userWallet.address, 25, "0x" + "00".repeat(32)]);
  await r2.wait();
  ok((await user.module("rewards", rewards).balanceOf(userWallet.address)) === 25n, "user holds 25 points");

  console.log("7. Relayer refuses abuse…");
  user.map({ selfAward: { kind: "rewards", module: rewards, method: "award" } });
  await expectRelayError(user.run("selfAward", [userWallet.address, 1000, "0x" + "00".repeat(32)]), "WOULD_REVERT", "user cannot award themselves points");
  const fwdReq = await user.signForwardRequest(dep.treasury, "0x");
  const rc = new (await import("@apptochain/sdk")).RelayerClient("http://127.0.0.1:8788", "test-key");
  await expectRelayError(rc.relay(fwdReq), "TARGET_NOT_ALLOWED", "non-apptochain targets are rejected");
  const good = await user.signForwardRequest(membership, user.module("membership", membership).interface.encodeFunctionData("mint"));
  await rc.relay(good);
  await expectRelayError(rc.relay(good), "BAD_SIGNATURE", "replayed request is rejected");
  await expectRelayError(rc.relay({ ...good, value: "1" }), "VALUE_NOT_ALLOWED", "requests carrying ETH are rejected");
  const noKey = new (await import("@apptochain/sdk")).RelayerClient("http://127.0.0.1:8788");
  await expectRelayError(noKey.relay(good), "UNAUTHORIZED", "missing API key is rejected");

  console.log(`\nE2E PASSED — ${pass} checks`);
} catch (e) {
  console.error("\n" + (e.stack || e));
  process.exitCode = 1;
} finally {
  server?.close();
  node.kill();
  try { fs.unlinkSync(path.join(root, "scripts", ".e2e-relay-log.jsonl")); } catch {}
}
