// Persistence for API keys and relay records.
// - No DATABASE_URL  → in-memory store (local dev, tests). Data is lost on restart.
// - DATABASE_URL set → Postgres (e.g. Supabase). Tables are created automatically.
import crypto from "node:crypto";

export const hashKey = (key) => crypto.createHash("sha256").update(key).digest("hex");
const newKey = () => "atc_" + crypto.randomBytes(24).toString("base64url");
const lc = (a) => a.toLowerCase();

function dayRange(days) {
  const out = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function fillDays(days, rows) {
  const map = new Map(rows.map((r) => [r.date, r]));
  return dayRange(days).map((date) => {
    const r = map.get(date);
    return {
      date,
      count: Number(r?.count ?? 0),
      confirmed: Number(r?.confirmed ?? 0),
      failed: Number(r?.failed ?? 0),
      feeWei: String(r?.fee_wei ?? r?.feeWei ?? "0"),
    };
  });
}

class MemoryStore {
  constructor() {
    this.keys = [];
    this.relays = [];
    this.ambassadors = [];
    this.seq = 0;
  }
  async init() {}
  async createKey(owner, name) {
    const key = newKey();
    const rec = { id: String(++this.seq), owner: lc(owner), name, hash: hashKey(key), prefix: key.slice(0, 10), createdAt: new Date().toISOString(), revokedAt: null };
    this.keys.push(rec);
    return { id: rec.id, name, prefix: rec.prefix, createdAt: rec.createdAt, key };
  }
  async listKeys(owner) {
    return this.keys.filter((k) => k.owner === lc(owner)).map(({ id, name, prefix, createdAt, revokedAt }) => ({ id, name, prefix, createdAt, revokedAt }));
  }
  async revokeKey(owner, id) {
    const k = this.keys.find((x) => x.id === String(id) && x.owner === lc(owner) && !x.revokedAt);
    if (!k) return false;
    k.revokedAt = new Date().toISOString();
    return true;
  }
  async findKey(plain) {
    const h = hashKey(plain);
    const k = this.keys.find((x) => x.hash === h && !x.revokedAt);
    return k ? { id: k.id, owner: k.owner, name: k.name } : null;
  }
  async recordRelay(r) {
    this.relays.push({ ...r, owner: r.owner ? lc(r.owner) : null, createdAt: new Date().toISOString(), feeWei: "0" });
    if (this.relays.length > 50000) this.relays.shift();
  }
  async updateRelay(hash, status, feeWei) {
    const r = this.relays.find((x) => x.hash === hash);
    if (r) Object.assign(r, { status, feeWei: feeWei ?? r.feeWei });
  }
  async usage(owner, days) {
    const o = lc(owner);
    const since = dayRange(days)[0];
    const by = new Map();
    for (const r of this.relays) {
      const date = r.createdAt.slice(0, 10);
      if (r.owner !== o || date < since) continue;
      const row = by.get(date) || { date, count: 0, confirmed: 0, failed: 0, feeWei: 0n };
      row.count++;
      if (r.status === "confirmed") row.confirmed++;
      if (r.status === "failed") row.failed++;
      row.feeWei += BigInt(r.feeWei || 0);
      by.set(date, row);
    }
    return fillDays(days, [...by.values()].map((r) => ({ ...r, feeWei: r.feeWei.toString() })));
  }
  async saveAmbassador(a) {
    if (this.ambassadors.some((x) => x.email === a.email)) return { duplicate: true };
    this.ambassadors.push({ ...a, id: this.ambassadors.length + 1, createdAt: new Date().toISOString() });
    return { duplicate: false };
  }
  async listAmbassadors() { return [...this.ambassadors]; }
  async recentRelays(owner, limit) {
    const o = lc(owner);
    return this.relays.filter((r) => r.owner === o).slice(-limit).reverse()
      .map(({ hash, status, target, selector, keyId, createdAt, feeWei, from }) => ({ hash, status, target, selector, keyId, createdAt, feeWei, from }));
  }
}

class PgStore {
  constructor(url, pool) {
    this.pool = pool;
    this.url = url;
  }
  static async create(url) {
    const pg = await import("pg");
    const local = /localhost|127\.0\.0\.1/.test(url);
    const pool = new pg.default.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
    return new PgStore(url, pool);
  }
  q(text, params) { return this.pool.query(text, params); }
  async init() {
    await this.q(`CREATE TABLE IF NOT EXISTS atc_api_keys (
      id SERIAL PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at TIMESTAMPTZ
    )`);
    await this.q(`CREATE TABLE IF NOT EXISTS atc_relays (
      hash TEXT PRIMARY KEY,
      owner TEXT,
      key_id TEXT,
      app_id TEXT,
      from_addr TEXT,
      target TEXT,
      selector TEXT,
      status TEXT NOT NULL,
      fee_wei NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await this.q(`CREATE INDEX IF NOT EXISTS atc_relays_owner_time ON atc_relays (owner, created_at)`);
    await this.q(`CREATE TABLE IF NOT EXISTS atc_ambassador_applications (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      handle TEXT,
      country TEXT NOT NULL,
      role TEXT NOT NULL,
      tracks TEXT NOT NULL,
      first_contribution TEXT NOT NULL,
      links TEXT,
      wallet TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  }
  async createKey(owner, name) {
    const key = newKey();
    const { rows } = await this.q(
      `INSERT INTO atc_api_keys (owner, name, key_hash, prefix) VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
      [lc(owner), name, hashKey(key), key.slice(0, 10)],
    );
    return { id: String(rows[0].id), name, prefix: key.slice(0, 10), createdAt: new Date(rows[0].created_at).toISOString(), key };
  }
  async listKeys(owner) {
    const { rows } = await this.q(`SELECT id, name, prefix, created_at, revoked_at FROM atc_api_keys WHERE owner=$1 ORDER BY id DESC`, [lc(owner)]);
    return rows.map((r) => ({ id: String(r.id), name: r.name, prefix: r.prefix, createdAt: new Date(r.created_at).toISOString(), revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null }));
  }
  async revokeKey(owner, id) {
    const { rowCount } = await this.q(`UPDATE atc_api_keys SET revoked_at=now() WHERE id=$1 AND owner=$2 AND revoked_at IS NULL`, [Number(id), lc(owner)]);
    return rowCount > 0;
  }
  async findKey(plain) {
    const { rows } = await this.q(`SELECT id, owner, name FROM atc_api_keys WHERE key_hash=$1 AND revoked_at IS NULL`, [hashKey(plain)]);
    return rows[0] ? { id: String(rows[0].id), owner: rows[0].owner, name: rows[0].name } : null;
  }
  async recordRelay(r) {
    await this.q(
      `INSERT INTO atc_relays (hash, owner, key_id, app_id, from_addr, target, selector, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (hash) DO NOTHING`,
      [r.hash, r.owner ? lc(r.owner) : null, r.keyId ?? null, r.appId ?? null, r.from, r.target, r.selector, r.status],
    );
  }
  async updateRelay(hash, status, feeWei) {
    await this.q(`UPDATE atc_relays SET status=$2, fee_wei=COALESCE($3, fee_wei) WHERE hash=$1`, [hash, status, feeWei ?? null]);
  }
  async usage(owner, days) {
    const since = dayRange(days)[0];
    const { rows } = await this.q(
      `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
              count(*) AS count,
              count(*) FILTER (WHERE status='confirmed') AS confirmed,
              count(*) FILTER (WHERE status='failed') AS failed,
              COALESCE(sum(fee_wei),0)::text AS fee_wei
       FROM atc_relays WHERE owner=$1 AND created_at >= $2::date
       GROUP BY 1`,
      [lc(owner), since],
    );
    return fillDays(days, rows);
  }
  async saveAmbassador(a) {
    const { rowCount } = await this.q(
      `INSERT INTO atc_ambassador_applications (name, email, handle, country, role, tracks, first_contribution, links, wallet)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (email) DO NOTHING`,
      [a.name, a.email, a.handle, a.country, a.role, a.tracks, a.firstContribution, a.links, a.wallet],
    );
    return { duplicate: rowCount === 0 };
  }
  async listAmbassadors() {
    const { rows } = await this.q(`SELECT * FROM atc_ambassador_applications ORDER BY id`);
    return rows;
  }
  async recentRelays(owner, limit) {
    const { rows } = await this.q(
      `SELECT hash, status, target, selector, key_id, created_at, fee_wei::text AS fee_wei, from_addr FROM atc_relays WHERE owner=$1 ORDER BY created_at DESC LIMIT $2`,
      [lc(owner), limit],
    );
    return rows.map((r) => ({ hash: r.hash, status: r.status, target: r.target, selector: r.selector, keyId: r.key_id, createdAt: new Date(r.created_at).toISOString(), feeWei: r.fee_wei, from: r.from_addr }));
  }
}

export async function createStore(databaseUrl) {
  const store = databaseUrl ? await PgStore.create(databaseUrl) : new MemoryStore();
  await store.init();
  return store;
}

export { MemoryStore, PgStore };
