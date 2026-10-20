// After `npm run deploy:local`, writes the relayer .env and demo .env.local for the local chain.
// Uses Hardhat's public test keys — local only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const depFile = path.join(root, "packages", "contracts", "deployments", "localhost.json");
if (!fs.existsSync(depFile)) {
  console.error("No local deployment found. Run `npm run chain` in one terminal, then `npm run deploy:local`.");
  process.exit(1);
}
const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));

fs.writeFileSync(path.join(root, "packages", "relayer", ".env"), [
  "PORT=8787",
  "RPC_URL=http://127.0.0.1:8545",
  "# Hardhat test account #1 (public key, local only)",
  "RELAYER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  `FORWARDER_ADDRESS=${dep.forwarder}`,
  `FACTORY_ADDRESS=${dep.factory}`,
  "API_KEYS=",
  "CORS_ORIGINS=",
  "RATE_LIMIT_PER_MINUTE=30",
  "",
].join("\n"));

fs.writeFileSync(path.join(root, "apps", "demo", ".env.local"), [
  "VITE_NETWORK=localhost",
  "VITE_RELAYER_URL=http://localhost:8787",
  `VITE_FACTORY_ADDRESS=${dep.factory}`,
  `VITE_FORWARDER_ADDRESS=${dep.forwarder}`,
  "VITE_APP_ID=demo",
  "",
].join("\n"));

console.log("Wrote packages/relayer/.env and apps/demo/.env.local for the local chain.");
console.log(`Factory ${dep.factory}\nForwarder ${dep.forwarder}`);
