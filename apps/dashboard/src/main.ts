import { AppToChain, BuilderClient, RelayerError, type ModuleKind, type UsageDay } from "@apptochain/sdk";
import { formatEther, isAddress } from "ethers";

// ───────────────────────── setup ─────────────────────────
const env = import.meta.env;
const RELAYER = (env.VITE_RELAYER_URL || "http://localhost:8787").replace(/\/$/, "");
const atc = new AppToChain({
  network: (env.VITE_NETWORK || "baseSepolia") as "baseSepolia",
  deployment: { factory: env.VITE_FACTORY_ADDRESS, forwarder: env.VITE_FORWARDER_ADDRESS },
  relayerUrl: RELAYER,
});
const api = new BuilderClient(RELAYER);
const SESSION_KEY = `atc-dash:${atc.network.chainId}:session`;
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* blocked */ } },
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const explorer = (kind: "address" | "tx", v: string) => (atc.network.explorer ? `${atc.network.explorer}/${kind}/${v}` : "#");
const ago = (iso: string) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const ethFmt = (wei: bigint | string) => {
  const n = Number(formatEther(BigInt(wei)));
  if (n === 0) return "0 ETH";
  return n < 0.0001 ? "<0.0001 ETH" : `${n.toFixed(4)} ETH`;
};
const errMsg = (e: any) => (e instanceof RelayerError ? e.message : e?.shortMessage || e?.reason || e?.message || String(e));
function toast(msg: string) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout((toast as any).h);
  (toast as any).h = setTimeout(() => (t.hidden = true), 2600);
}
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Copy failed — select and copy manually"); }
}

const KIND_LABEL: Record<string, string> = {
  membership: "Membership", assets: "Items", rewards: "Points", payments: "Checkout", unknown: "Module",
};
const SELECTORS: Record<string, string> = {}; // filled lazily from ABIs
async function actionName(selector: string) {
  if (!Object.keys(SELECTORS).length) {
    for (const k of ["membership", "assets", "rewards", "payments"] as ModuleKind[]) {
      atc.module(k, "0x0000000000000000000000000000000000000001").interface.forEachFunction((f) => {
        SELECTORS[f.selector] = f.name;
      });
    }
  }
  return SELECTORS[selector] || selector;
}

// ───────────────────────── state ─────────────────────────
let modules: { address: string; kind: ModuleKind | "unknown"; name: string }[] = [];
let usageDays = 14;
let lastUsage: UsageDay[] = [];
let resizeTimer: number | undefined;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => { if (lastUsage.length && !$("chart").closest("[hidden]")) drawChart(lastUsage); }, 150);
});

// ───────────────────────── sign in / out ─────────────────────────
function showApp(on: boolean) {
  $("gate").hidden = on;
  $("app").hidden = !on;
  $("account").hidden = !on;
  if (on) $("account").innerHTML = `<span class="addr mono">${short(api.address!)}</span> Sign out`;
}

async function signIn() {
  $("gate-err").textContent = "";
  const btn = $<HTMLButtonElement>("signin");
  btn.disabled = true;
  try {
    btn.textContent = "Connecting…";
    await atc.connect();
    btn.textContent = "Sign the message in your wallet…";
    const s = await api.signIn(atc.getSigner());
    store.set(SESSION_KEY, JSON.stringify(s));
    showApp(true);
    loadAll();
  } catch (e) {
    $("gate-err").textContent = errMsg(e);
  } finally {
    btn.disabled = false;
    btn.textContent = "Connect & sign in";
  }
}

function signOut() {
  api.signOut();
  atc.disconnect();
  store.del(SESSION_KEY);
  showApp(false);
}

/** Make sure a wallet matching the session is connected before sending transactions. */
async function ensureWallet() {
  if (!atc.address) await atc.connect();
  if (atc.address!.toLowerCase() !== api.address!.toLowerCase()) {
    throw new Error(`Your wallet is on ${short(atc.address!)}, but you're signed in as ${short(api.address!)}. Switch accounts in your wallet.`);
  }
}

// ───────────────────────── tabs ─────────────────────────
function selectTab(name: string) {
  document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
  store.set("atc-dash:tab", name);
  if (name === "usage") loadUsage();
  if (name === "quickstart") renderSnippet();
}
document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => (b.onclick = () => selectTab(b.dataset.tab!)));
document.querySelectorAll<HTMLButtonElement>("[data-goto]").forEach((b) => (b.onclick = () => selectTab(b.dataset.goto!)));

// ───────────────────────── data loading ─────────────────────────
async function loadAll() {
  loadRelayer();
  loadKeys();
  await loadModules(); // overview and quickstart use module names
  await loadOverview();
  renderSnippet();
}

async function loadRelayer() {
  try {
    const h = await api.health();
    const low = h.lowBalance ? `<span class="st failed"><span>Low balance, top up ${esc(short(h.relayer))}</span></span>` : `<span class="st confirmed"><span>Healthy</span></span>`;
    $("relayer-status").innerHTML = `${low}<br>Chain ${h.chainId} · relayer <a href="${explorer("address", h.relayer)}" target="_blank" rel="noopener">${short(h.relayer)}</a> · balance ${Number(h.balance).toFixed(4)} ETH · sandbox ${h.sandbox ? "open" : "closed"}`;
  } catch (e) {
    $("relayer-status").textContent = `Relayer unreachable: ${errMsg(e)}. Free hosting can take up to a minute to wake up.`;
  }
}

async function loadOverview() {
  try {
    const [u, relays] = await Promise.all([api.usage(14), api.recentRelays(8)]);
    $("t-relays").textContent = String(u.total);
    $("t-gas").textContent = ethFmt(u.days.reduce((a, d) => a + BigInt(d.feeWei), 0n));
    const box = $("recent");
    if (!relays.length) {
      box.innerHTML = `<p class="empty">No gasless actions yet. Deploy a module, add the SDK to your app, and your users' actions will show here.</p>`;
      return;
    }
    const names = await Promise.all(relays.map((r) => actionName(r.selector)));
    box.innerHTML = relays.map((r, i) => {
      const mod = modules.find((m) => m.address.toLowerCase() === r.target.toLowerCase());
      return `<div class="item">
        <div class="main"><div class="t">${esc(names[i])}() on ${esc(mod?.name || short(r.target))}</div>
        <div class="s">by ${short(r.from)} · ${ago(r.createdAt)} · <a href="${explorer("tx", r.hash)}" target="_blank" rel="noopener">${short(r.hash)}</a></div></div>
        <span class="st ${r.status}"><span>${r.status}</span></span></div>`;
    }).join("");
  } catch (e) {
    $("recent").innerHTML = `<p class="err">${esc(errMsg(e))}</p>`;
    if (e instanceof RelayerError && e.status === 401) signOut();
  }
}

async function loadModules() {
  const box = $("mods");
  box.innerHTML = `<p class="empty">Loading from ${esc(atc.network.name)}…</p>`;
  try {
    const list = await atc.myModules(api.address!);
    modules = await Promise.all(list.map(async (m) => {
      let name = KIND_LABEL[m.kind];
      if (m.kind !== "payments" && m.kind !== "unknown") {
        try { name = await atc.module(m.kind, m.address).name(); } catch { /* keep label */ }
      }
      return { ...m, name };
    }));
    $("t-modules").textContent = String(modules.length);
    box.innerHTML = modules.length
      ? modules.slice().reverse().map((m) => `<div class="item">
          <span class="pill">${KIND_LABEL[m.kind]}</span>
          <div class="main"><div class="t">${esc(m.name)}</div><div class="s"><a href="${explorer("address", m.address)}" target="_blank" rel="noopener">${m.address}</a></div></div>
          <button class="btn" data-copy="${m.address}">Copy address</button></div>`).join("")
      : `<p class="empty">No modules yet. Deploy your first one below.</p>`;
    box.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((b) => (b.onclick = () => copy(b.dataset.copy!)));
  } catch (e) {
    box.innerHTML = `<p class="err">Couldn't read modules: ${esc(errMsg(e))}</p>`;
  }
}

async function loadKeys() {
  const box = $("keys");
  try {
    const keys = await api.listKeys();
    $("t-keys").textContent = String(keys.filter((k) => !k.revokedAt).length);
    box.innerHTML = keys.length
      ? keys.map((k) => `<div class="item">
          <div class="main"><div class="t">${esc(k.name)}</div>
          <div class="s mono">${esc(k.prefix)}… · created ${ago(k.createdAt)}${k.revokedAt ? ` · revoked ${ago(k.revokedAt)}` : ""}</div></div>
          ${k.revokedAt ? `<span class="st failed"><span>Revoked</span></span>` : `<button class="btn danger" data-revoke="${k.id}" data-name="${esc(k.name)}">Revoke</button>`}
        </div>`).join("")
      : `<p class="empty">No keys yet. Create one above.</p>`;
    box.querySelectorAll<HTMLButtonElement>("[data-revoke]").forEach((b) => (b.onclick = async () => {
      if (!confirm(`Revoke "${b.dataset.name}"? Apps using it will stop getting gasless actions immediately.`)) return;
      try { await api.revokeKey(b.dataset.revoke!); toast("Key revoked"); loadKeys(); } catch (e) { toast(errMsg(e)); }
    }));
  } catch (e) {
    box.innerHTML = `<p class="err">${esc(errMsg(e))}</p>`;
  }
}

// ───────────────────────── API keys ─────────────────────────
$<HTMLFormElement>("key-form").onsubmit = async (ev) => {
  ev.preventDefault();
  const form = ev.target as HTMLFormElement;
  const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
  $("key-err").textContent = "";
  try {
    const k = await api.createKey(name);
    $("new-key-value").textContent = k.key;
    $("new-key").hidden = false;
    form.reset();
    lastNewKey = k.key;
    renderSnippet();
    loadKeys();
  } catch (e) {
    $("key-err").textContent = errMsg(e);
  }
};
$("copy-key").onclick = () => copy($("new-key-value").textContent || "");
let lastNewKey = "";

// ───────────────────────── deploy ─────────────────────────
const FIELDS: Record<ModuleKind, string> = {
  membership: `<div class="grid2"><label>Name<input name="name" required placeholder="Gold Club" /></label>
    <label>Symbol<input name="symbol" required placeholder="GOLD" maxlength="11" /></label></div>
    <div class="grid2"><label>Price (ETH, 0 = free)<input name="priceEth" type="number" min="0" step="any" value="0" /></label>
    <label>Valid for (days, 0 = forever)<input name="durationDays" type="number" min="0" step="1" value="30" /></label></div>
    <label>Max supply (0 = unlimited)<input name="maxSupply" type="number" min="0" step="1" value="0" /></label>`,
  assets: `<label>Collection name<input name="name" required placeholder="Sword Shop" /></label>
    <label>Metadata URI (use {id} for item number)<input name="uri" required placeholder="ipfs://…/{id}.json" /></label>`,
  rewards: `<div class="grid2"><label>Name<input name="name" required placeholder="Loyalty Points" /></label>
    <label>Symbol<input name="symbol" required placeholder="PTS" maxlength="11" /></label></div>
    <label style="flex-direction:row;align-items:center;gap:8px;font-weight:500"><input type="checkbox" name="transferable" style="width:auto" /> Allow users to transfer points to each other</label>`,
  payments: `<label>Payee address (receives payments)<input name="payee" required placeholder="0x…" /></label>
    <label>Accepted tokens (comma-separated, optional)<input name="tokens" placeholder="USDC address on Base" /></label>`,
};
function renderFields() {
  $("kind-fields").innerHTML = FIELDS[$<HTMLSelectElement>("kind").value as ModuleKind];
  if ($<HTMLSelectElement>("kind").value === "payments" && api.address) {
    ($("kind-fields").querySelector('[name="payee"]') as HTMLInputElement).value = api.address;
  }
}
$("kind").onchange = renderFields;

$<HTMLFormElement>("deploy-form").onsubmit = async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target as HTMLFormElement);
  const kind = f.get("kind") as ModuleKind;
  const v = (k: string) => String(f.get(k) ?? "").trim();
  const btn = $<HTMLButtonElement>("deploy-btn");
  $("deploy-err").textContent = "";
  btn.disabled = true;
  btn.textContent = "Confirm in your wallet…";
  try {
    await ensureWallet();
    let addr: string;
    if (kind === "membership") {
      addr = await atc.deploy.membership({ name: v("name"), symbol: v("symbol"), priceEth: v("priceEth") || "0", durationDays: Number(v("durationDays") || 0), maxSupply: Number(v("maxSupply") || 0) }, "dashboard");
    } else if (kind === "assets") {
      addr = await atc.deploy.assets({ name: v("name"), uri: v("uri") }, "dashboard");
    } else if (kind === "rewards") {
      addr = await atc.deploy.rewards({ name: v("name"), symbol: v("symbol"), transferable: f.get("transferable") === "on" }, "dashboard");
    } else {
      const tokens = v("tokens").split(",").map((t) => t.trim()).filter(Boolean);
      if (!isAddress(v("payee")) || tokens.some((t) => !isAddress(t))) throw new Error("Check the addresses: each must be 0x followed by 40 characters.");
      addr = await atc.deploy.payments({ payee: v("payee"), acceptedTokens: tokens }, "dashboard");
    }
    toast(`${KIND_LABEL[kind]} deployed at ${short(addr)}`);
    (ev.target as HTMLFormElement).reset();
    renderFields();
    await loadModules();
    renderSnippet();
  } catch (e) {
    $("deploy-err").textContent = errMsg(e);
  } finally {
    btn.disabled = false;
    btn.textContent = "Deploy";
  }
};

// ───────────────────────── usage chart ─────────────────────────
document.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) => (b.onclick = () => {
  usageDays = Number(b.dataset.days);
  document.querySelectorAll<HTMLButtonElement>(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  store.set("atc-dash:days", String(usageDays));
  loadUsage();
}));

async function loadUsage() {
  try {
    const u = await api.usage(usageDays);
    const failed = u.days.reduce((a, d) => a + d.failed, 0);
    $("usage-sum").textContent = `${u.total} gasless action${u.total === 1 ? "" : "s"} in ${usageDays} days · ${ethFmt(u.days.reduce((a, d) => a + BigInt(d.feeWei), 0n))} gas sponsored${failed ? ` · ${failed} failed` : ""}`;
    lastUsage = u.days;
    drawChart(u.days);
    $("usage-table").innerHTML = `<table><thead><tr><th>Date</th><th>Actions</th><th>Confirmed</th><th>Failed</th><th>Gas sponsored</th></tr></thead><tbody>${
      u.days.slice().reverse().map((d) => `<tr><td>${d.date}</td><td>${d.count}</td><td>${d.confirmed}</td><td>${d.failed}</td><td>${ethFmt(d.feeWei)}</td></tr>`).join("")
    }</tbody></table>`;
  } catch (e) {
    $("chart").innerHTML = `<p class="err">${esc(errMsg(e))}</p>`;
  }
}

function niceMax(n: number) {
  if (n <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

function drawChart(days: UsageDay[]) {
  const box = $("chart");
  const W = Math.max(300, Math.round(box.clientWidth || 720)), H = W < 500 ? 200 : 240, L = 32, R = 8, T = 12, B = 28;
  const max = niceMax(Math.max(...days.map((d) => d.count)));
  const iw = W - L - R, ih = H - T - B;
  const step = iw / days.length;
  const bw = Math.max(4, Math.min(28, step - 2 * Math.max(2, step * 0.18))); // thin bars, >= 2px gap
  const y = (v: number) => T + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(56 / step)); // ~56px per date label at real size
  const fmtDay = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gasless actions per day, last ${days.length} days">`;
  for (const t of ticks) {
    svg += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text class="axis" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${Number.isInteger(t) ? t : t.toFixed(1)}</text>`;
  }
  days.forEach((d, i) => {
    const cx = L + step * i + step / 2;
    const h = (d.count / max) * ih;
    const x = cx - bw / 2, top = T + ih - h, r = Math.min(4, bw / 2, h);
    // rounded data-end, square at the baseline
    const path = h > 0
      ? `M${x},${T + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${T + ih} Z`
      : "";
    svg += `<g data-i="${i}"><rect class="hit" x="${L + step * i}" y="${T}" width="${step}" height="${ih}"/>${path ? `<path class="barmark" d="${path}"/>` : ""}</g>`;
    if ((days.length - 1 - i) % labelEvery === 0) { // count back from today so labels never collide
      svg += `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${fmtDay(d.date)}</text>`;
    }
  });
  svg += `<line x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}" stroke="var(--line)" stroke-width="1"/></svg>`;
  box.innerHTML = svg;

  const tip = $("tip");
  box.querySelectorAll<SVGGElement>("g[data-i]").forEach((g) => {
    const d = days[Number(g.dataset.i)];
    const show = (ev: MouseEvent) => {
      box.querySelectorAll("g.on").forEach((x) => x.classList.remove("on"));
      g.classList.add("on");
      tip.innerHTML = `${fmtDay(d.date)}<br><b>${d.count}</b> action${d.count === 1 ? "" : "s"}<br>${d.confirmed} confirmed${d.failed ? ` · ${d.failed} failed` : ""}<br>${ethFmt(d.feeWei)} gas`;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.min(window.innerWidth - tw - 8, ev.clientX + 12)}px`;
      tip.style.top = `${ev.clientY - tip.offsetHeight - 12}px`;
    };
    g.addEventListener("mousemove", show);
    g.addEventListener("mouseleave", () => { tip.hidden = true; g.classList.remove("on"); });
    g.addEventListener("touchstart", (e) => show(e.touches[0] as unknown as MouseEvent), { passive: true });
  });
}

// ───────────────────────── quickstart ─────────────────────────
function renderSnippet() {
  const first = (k: ModuleKind) => modules.find((m) => m.kind === k)?.address;
  const membership = first("membership"), rewards = first("rewards");
  const actions: string[] = [];
  if (membership) actions.push(`    claimPass: { kind: "membership", module: "${membership}", method: "mint" },`);
  if (rewards) actions.push(`    redeem:    { kind: "rewards",    module: "${rewards}", method: "redeem" },`);
  if (!actions.length) actions.push(`    // Deploy a module in the Modules tab and it appears here`);
  const net = env.VITE_NETWORK || "baseSepolia";
  const code = `import { AppToChain } from "@apptochain/sdk";

const atc = new AppToChain({
  network: "${net}",
  deployment: {
    factory: "${atc.network.factory ?? "0x…"}",
    forwarder: "${atc.network.forwarder ?? "0x…"}",
  },
  relayerUrl: "${RELAYER}",
  apiKey: "${lastNewKey || "YOUR_API_KEY"}",
  actions: {
${actions.join("\n")}
  },
});

// 1. Connect: picks the user's wallet and switches to ${atc.network.name}
await atc.connect();

// 2. Run a mapped action: the user signs, the relayer pays the gas
${membership ? `const r = await atc.run("claimPass");
const { status } = await r.wait(); // "confirmed"` : `// const r = await atc.run("claimPass");`}`;
  $("snippet").textContent = code;
}
$("copy-snippet").onclick = () => copy($("snippet").textContent || "");

// ───────────────────────── boot ─────────────────────────
$("signin").onclick = signIn;
$("account").onclick = signOut;
$("net").textContent = `${atc.network.name}${atc.network.factory ? "" : " · factory not set"}`;
renderFields();
const savedDays = Number(store.get("atc-dash:days"));
if ([7, 14, 30].includes(savedDays)) {
  usageDays = savedDays;
  document.querySelectorAll<HTMLButtonElement>(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(Number(x.dataset.days) === savedDays)));
}

try {
  const saved = JSON.parse(store.get(SESSION_KEY) || "null");
  if (api.restore(saved)) {
    showApp(true);
    selectTab(store.get("atc-dash:tab") || "overview");
    loadAll();
  }
} catch { /* no saved session */ }
atc.onAccountChange((a) => {
  if (a && api.address && a.toLowerCase() !== api.address.toLowerCase()) toast("Wallet account changed. Sign out and back in to manage that account.");
});
