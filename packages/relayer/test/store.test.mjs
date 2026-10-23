// Tests both storage backends with the same checks.
// Memory always runs. Postgres runs when TEST_DATABASE_URL is set, e.g.
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres node packages/relayer/test/store.test.mjs
import assert from "node:assert/strict";
import { MemoryStore, PgStore } from "../src/store.js";

const OWNER = "0xAbC0000000000000000000000000000000000001";
const OTHER = "0xAbC0000000000000000000000000000000000002";

async function suite(name, store) {
  await store.init();
  await store.init(); // idempotent

  const k = await store.createKey(OWNER, "prod");
  assert.match(k.key, /^atc_[A-Za-z0-9_-]{32}$/);
  assert.equal(k.prefix, k.key.slice(0, 10));
  const listed = await store.listKeys(OWNER.toLowerCase());
  assert.equal(listed.length, 1);
  assert.equal(listed[0].revokedAt, null);
  assert.ok(!("key" in listed[0]) && !("hash" in listed[0]), "secret never listed");
  assert.equal((await store.listKeys(OTHER)).length, 0);

  const found = await store.findKey(k.key);
  assert.equal(found.owner, OWNER.toLowerCase());
  assert.equal(await store.findKey(k.key + "x"), null);

  await store.recordRelay({ hash: "0xa1", owner: OWNER, keyId: k.id, appId: "a", from: "0xf", target: "0xt", selector: "0x12345678", status: "submitted" });
  await store.recordRelay({ hash: "0xa2", owner: OWNER, keyId: null, appId: "s", from: "0xf", target: "0xt", selector: "0x12345678", status: "submitted" });
  await store.recordRelay({ hash: "0xb1", owner: OTHER, keyId: null, appId: "s", from: "0xf", target: "0xu", selector: "0x12345678", status: "submitted" });
  await store.updateRelay("0xa1", "confirmed", "1000");
  await store.updateRelay("0xa2", "failed", "500");

  const u = await store.usage(OWNER, 7);
  assert.equal(u.length, 7);
  const today = u[6];
  assert.equal(today.date, new Date().toISOString().slice(0, 10));
  assert.deepEqual([today.count, today.confirmed, today.failed, today.feeWei], [2, 1, 1, "1500"]);
  assert.equal(u.slice(0, 6).reduce((a, d) => a + d.count, 0), 0);

  const recent = await store.recentRelays(OWNER, 10);
  assert.equal(recent.length, 2);
  assert.ok(recent.every((r) => r.hash.startsWith("0xa")));

  assert.equal(await store.revokeKey(OTHER, k.id), false, "others cannot revoke");
  assert.equal(await store.revokeKey(OWNER, k.id), true);
  assert.equal(await store.revokeKey(OWNER, k.id), false, "double revoke");
  assert.equal(await store.findKey(k.key), null, "revoked key unusable");
  assert.ok((await store.listKeys(OWNER))[0].revokedAt);

  const app = { name: "Ada", email: "ada@example.com", handle: "@ada", country: "Nigeria", role: "Developer", tracks: "Teach, Ship", firstContribution: "A thread on gasless claims", links: "", wallet: "" };
  assert.equal((await store.saveAmbassador(app)).duplicate, false);
  assert.equal((await store.saveAmbassador(app)).duplicate, true, "one application per email");
  assert.equal((await store.listAmbassadors()).length, 1);

  console.log(`  ✔ ${name} store: keys, revocation, usage, recent relays, ambassador applications`);
}

await suite("memory", new MemoryStore());

if (process.env.TEST_DATABASE_URL) {
  const pg = await PgStore.create(process.env.TEST_DATABASE_URL);
  await pg.q("DROP TABLE IF EXISTS atc_api_keys, atc_relays, atc_ambassador_applications");
  await suite("postgres", pg);
  await pg.pool.end();
} else {
  console.log("  - postgres store skipped (set TEST_DATABASE_URL to run)");
}
