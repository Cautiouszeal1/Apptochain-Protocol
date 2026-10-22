import "dotenv/config";
import { createApp, loadConfig } from "./app.js";

const cfg = loadConfig();
const { app, wallet, chainId } = await createApp(cfg);
app.listen(cfg.port, () => {
  console.log(`apptochain relayer on :${cfg.port}  chain=${chainId}  relayer=${wallet.address}`);
  console.log(`storage: ${cfg.databaseUrl ? "Postgres" : "in-memory (keys and usage reset on restart; set DATABASE_URL to persist)"}`);
  console.log(`dashboard sign-in: ${cfg.sessionSecret ? "on" : "off (set SESSION_SECRET)"}`);
  console.log(`sandbox (no API key): ${cfg.allowSandbox ? "allowed" : "blocked"}`);
});
