// End-to-end check of the whole Phase 2 stack on a throwaway local chain:
// hardhat node → deploy core → relayer → SDK deploys modules → gasless user actions → abuse checks.
// Run: npm run e2e   (needs `npm run build` first so the SDK dist exists)
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, Wallet, NonceManager } from "ethers";
import { AppToChain, BuilderClient, RelayerClient, RelayerError } from "@apptochain/sdk";
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
  otherBuilder: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
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

// Own process group (Mac/Linux) so stopping it also stops the Hardhat child that npx starts.
const isWin = process.platform === "win32";
const node = spawn("npx", ["hardhat", "node"], { cwd: contractsDir, stdio: "ignore", shell: isWin, detached: !isWin });
const stopNode = () => {
  try {
    if (isWin) spawn("taskkill", ["/pid", String(node.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-node.pid, "SIGTERM");
  } catch { /* already stopped */ }
};
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
    perMinute: 50, dailyQuota: 1000, lowBalance: 1n,
    databaseUrl: process.env.TEST_DATABASE_URL || "", allowSandbox: false, sessionSecret: "e2e-session-secret-0123456789", maxGasPriceGwei: "", logFile: path.join(root, "scripts", ".e2e-relay-log.jsonl"),
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

  console.log("8. Builder dashboard: sign in, API keys, usage…");
  const URL = "http://127.0.0.1:8788";
  const builderWallet = new Wallet(KEYS.builder, provider);
  const dash = new BuilderClient(URL);
  const session = await dash.signIn(builderWallet);
  ok(session.address === builderWallet.address && session.token.includes("."), "builder signs in with wallet signature");
  const key = await dash.createKey("Production app");
  ok(key.key.startsWith("atc_") && key.prefix === key.key.slice(0, 10), "API key created and shown once");
  const listed = await dash.listKeys();
  ok(listed.length === 1 && !("key" in listed[0]) && !("hash" in listed[0]), "key list never exposes the secret");

  const keyed = new AppToChain({ ...opts, apiKey: key.key, actions: { claimPass: { kind: "membership", module: membership, method: "mint" } } });
  await keyed.useSigner(userWallet);
  const r3 = await keyed.run("claimPass");
  ok((await r3.wait()).status === "confirmed", "builder key sponsors a gasless action on its own module");

  const other = new BuilderClient(URL);
  await other.signIn(new Wallet(KEYS.otherBuilder, provider));
  const otherKey = await other.createKey("Not yours");
  const req2 = await keyed.signForwardRequest(membership, keyed.module("membership", membership).interface.encodeFunctionData("mint"));
  await expectRelayError(new RelayerClient(URL, otherKey.key).relay(req2), "KEY_NOT_FOR_TARGET", "another builder's key cannot sponsor your modules");
  ok((await other.listKeys()).length === 1 && (await dash.listKeys()).length === 1, "each builder only sees their own keys");

  await new Promise((r) => setTimeout(r, 500)); // let confirmation callbacks record fees
  const usage = await dash.usage(7);
  const today = usage.days[usage.days.length - 1];
  ok(usage.days.length === 7 && usage.total >= 4 && today.count === usage.total, "usage counts relays to the builder's modules");
  ok(Number(usage.gasSponsoredEth) > 0 && today.confirmed >= 3, "usage tracks confirmations and gas sponsored");
  const relays = await dash.recentRelays(10);
  ok(relays.length === usage.total && relays[0].hash === r3.hash, "recent relays list newest first");

  await dash.revokeKey(key.id);
  await expectRelayError(new RelayerClient(URL, key.key).relay(req2), "UNAUTHORIZED", "revoked key stops working immediately");
  await expectRelayError(new BuilderClient(URL).listKeys(), "UNAUTHORIZED", "key management needs a session");
  const forged = new BuilderClient(URL);
  forged.restore({ token: session.token.split(".")[0] + ".forged", address: session.address, expiresAt: session.expiresAt });
  await expectRelayError(forged.listKeys(), "UNAUTHORIZED", "tampered session token is rejected");
  const n = await (await fetch(`${URL}/v1/auth/nonce?address=${builderWallet.address}`)).json();
  const sig = await builderWallet.signMessage(n.message);
  await fetch(`${URL}/v1/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: n.message, signature: sig }) });
  const replay = await fetch(`${URL}/v1/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: n.message, signature: sig }) });
  ok(replay.status === 401, "a sign-in signature cannot be reused");
  const stranger = new Wallet(KEYS.user);
  const n2 = await (await fetch(`${URL}/v1/auth/nonce?address=${builderWallet.address}`)).json();
  const bad = await fetch(`${URL}/v1/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: n2.message, signature: await stranger.signMessage(n2.message) }) });
  ok(bad.status === 401, "cannot sign in as someone else's address");

  console.log("9. React / React Native hooks…");
  const React = (await import("react")).default;
  const TR = (await import("react-test-renderer")).default;
  const hooks = await import("@apptochain/react");
  const h = React.createElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  // An EIP-1193 provider like the one WalletConnect / Reown AppKit hands a mobile app.
  let rejectNext = false;
  const fakeProvider = {
    async request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts": case "eth_accounts": return [userWallet.address];
        case "eth_chainId": return "0x7a69";
        case "eth_signTypedData_v4": {
          if (rejectNext) { rejectNext = false; throw Object.assign(new Error("User rejected"), { code: 4001 }); }
          const t = JSON.parse(params[1]); delete t.types.EIP712Domain;
          return userWallet.signTypedData(t.domain, t.types, t.message);
        }
        default: return provider.send(method, params || []);
      }
    },
    on() {}, removeListener() {},
  };

  const hookKey = await dash.createKey("Mobile app");
  const state = {};
  function Probe({ wallet }) {
    const conn = hooks.useWalletProvider(wallet);
    state.conn = conn;
    state.claim = hooks.useAction("claimPass");
    state.bad = hooks.useAction("selfAward");
    state.pass = hooks.usePass(membership);
    state.points = hooks.usePoints(rewards);
    return null;
  }
  const config = {
    network: "localhost", deployment: dep, relayerUrl: "http://127.0.0.1:8788", apiKey: hookKey.key,
    actions: {
      claimPass: { kind: "membership", module: membership, method: "mint" },
      selfAward: { kind: "rewards", module: rewards, method: "award" },
    },
  };
  const until = async (fn, ms = 15000) => {
    const t0 = Date.now();
    while (!fn()) {
      if (Date.now() - t0 > ms) throw new Error("FAIL: timed out waiting in hooks test");
      await TR.act(() => new Promise((r) => setTimeout(r, 100)));
    }
  };
  let tree;
  await TR.act(async () => { tree = TR.create(h(hooks.AppToChainProvider, { config }, h(Probe, { wallet: undefined }))); });
  ok(state.conn.address === null && state.claim.status === "idle", "hooks render before a wallet is connected");
  await TR.act(async () => { tree.update(h(hooks.AppToChainProvider, { config }, h(Probe, { wallet: fakeProvider }))); });
  await until(() => state.conn.address === userWallet.address);
  ok(true, "useWalletProvider connects a WalletConnect-style provider");
  await until(() => state.pass.data !== undefined && state.points.data !== undefined);
  ok(state.points.data === 25n, "usePoints reads the user's balance");

  let res;
  await TR.act(async () => { res = await state.claim.run(); });
  ok(res?.status === "confirmed" && state.claim.status === "confirmed" && state.claim.hash === res.hash, "useAction runs a gasless action to confirmation");
  await TR.act(async () => { await state.pass.refresh(); });
  ok(state.pass.data === true, "usePass reports a valid pass");

  await TR.act(async () => { await state.bad.run([userWallet.address, 5, "0x" + "00".repeat(32)]); });
  ok(state.bad.status === "failed" && state.bad.errorCode === "WOULD_REVERT", "useAction surfaces relayer errors with a code");
  rejectNext = true;
  await TR.act(async () => { await state.claim.run(); });
  ok(state.claim.status === "failed" && /cancelled/.test(state.claim.error), "a wallet rejection shows a friendly message");

  await TR.act(async () => { tree.update(h(hooks.AppToChainProvider, { config }, h(Probe, { wallet: null }))); });
  ok(state.conn.address === null, "removing the wallet provider disconnects");
  await TR.act(async () => tree.unmount());

  console.log(`\nE2E PASSED — ${pass} checks`);
} catch (e) {
  console.error("\n" + (e.stack || e));
  process.exitCode = 1;
} finally {
  server?.close();
  stopNode();
  try { fs.unlinkSync(path.join(root, "scripts", ".e2e-relay-log.jsonl")); } catch {}
}
