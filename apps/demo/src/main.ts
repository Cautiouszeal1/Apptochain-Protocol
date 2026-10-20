import { AppToChain, RelayerError } from "@apptochain/sdk";

const env = import.meta.env;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

const atc = new AppToChain({
  network: (env.VITE_NETWORK || "localhost") as "localhost",
  deployment: { factory: env.VITE_FACTORY_ADDRESS, forwarder: env.VITE_FORWARDER_ADDRESS },
  relayerUrl: env.VITE_RELAYER_URL || "http://localhost:8787",
  appId: env.VITE_APP_ID || "demo",
  apiKey: env.VITE_API_KEY || undefined,
});

const key = (k: string) => `atc-demo:${atc.network.chainId}:${k}`;
let membership = store.get(key("membership"));
let rewards = store.get(key("rewards"));

function log(msg: string, cls = "") {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  if (cls) li.className = cls;
  $("log").prepend(li);
}

function short(a: string) { return a.slice(0, 6) + "…" + a.slice(-4); }

/** Map the app's features to on-chain actions. This is step 2 of the SDK. */
function mapActions() {
  const actions: Parameters<typeof atc.map>[0] = {};
  if (membership) actions.claimPass = { kind: "membership", module: membership, method: "mint", gasless: true };
  if (rewards) actions.earnPoints = { kind: "rewards", module: rewards, method: "award", gasless: true };
  atc.map(actions);
}

function paint() {
  const on = !!atc.address;
  $("connect").textContent = on ? short(atc.address!) : "Connect wallet";
  $("who").textContent = on ? atc.address! : "Not connected.";
  ($("signin") as HTMLButtonElement).disabled = !on;
  ($("dep-m") as HTMLButtonElement).disabled = !on || !!membership;
  ($("dep-r") as HTMLButtonElement).disabled = !on || !!rewards;
  ($("claim") as HTMLButtonElement).disabled = !on || !membership;
  ($("earn") as HTMLButtonElement).disabled = !on || !rewards;
  $("mods").textContent = [
    membership ? `membership ${membership}` : "",
    rewards ? `points ${rewards}` : "",
  ].filter(Boolean).join("  ·  ");
  refresh();
}

async function refresh() {
  if (!atc.address) return;
  try {
    if (membership) $("passes").textContent = String(await atc.module("membership", membership).balanceOf(atc.address));
    if (rewards) $("points").textContent = String(await atc.module("rewards", rewards).balanceOf(atc.address));
  } catch { /* module from another chain or not deployed yet */ }
}

async function guard(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e: any) {
    const msg = e instanceof RelayerError ? `${e.code}: ${e.message}` : e?.shortMessage || e?.message || String(e);
    log(`${label} failed — ${msg}`, "err");
  }
}

$("connect").onclick = () => guard("Connect", async () => {
  if (atc.address) return;
  await atc.connect();
  log(`Connected ${short(atc.address!)} on ${atc.network.name}`, "ok");
});

$("signin").onclick = () => guard("Sign in", async () => {
  const s = await atc.signIn("Sign in to the apptochain sandbox.");
  log(`Signed in, signature ${s.signature.slice(0, 18)}…`, "ok");
});

$("dep-m").onclick = () => guard("Deploy membership", async () => {
  log("Deploying membership pass… confirm in your wallet");
  membership = await atc.deploy.membership({ name: "Sandbox Club", symbol: "CLUB", durationDays: 30 }, "sandbox");
  store.set(key("membership"), membership);
  mapActions();
  log(`Membership live at ${membership}`, "ok");
  paint();
});

$("dep-r").onclick = () => guard("Deploy points", async () => {
  log("Deploying points program… confirm in your wallet");
  rewards = await atc.deploy.rewards({ name: "Sandbox Points", symbol: "PTS" }, "sandbox");
  store.set(key("rewards"), rewards);
  mapActions();
  log(`Points program live at ${rewards}`, "ok");
  paint();
});

$("claim").onclick = () => guard("Claim pass", async () => {
  log("Sign the request (free, no gas)…");
  const r = await atc.run("claimPass");
  log(`Relayed ${short(r.hash)}, waiting…`);
  const done = await r.wait();
  log(`Pass ${done.status} in block ${done.blockNumber}`, done.status === "confirmed" ? "ok" : "err");
  refresh();
});

$("earn").onclick = () => guard("Earn points", async () => {
  // In a real app your backend (an approved awarder) signs this. Here the builder wallet does.
  log("Sign the award (free, no gas)…");
  const r = await atc.run("earnPoints", [atc.address, 10, "0x" + "00".repeat(31) + "01"]);
  const done = await r.wait();
  log(`+10 points ${done.status}`, done.status === "confirmed" ? "ok" : "err");
  refresh();
});

atc.onAccountChange(paint);
mapActions();
paint();
$("net").textContent = `${atc.network.name} · chain ${atc.network.chainId} · factory ${atc.network.factory ? short(atc.network.factory) : "not set"}`;
if (!atc.network.factory) log("Factory address missing. Copy apps/demo/.env.example to .env.local and fill it in.", "err");
