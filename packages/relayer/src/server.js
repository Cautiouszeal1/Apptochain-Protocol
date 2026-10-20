import "dotenv/config";
import { createApp, loadConfig } from "./app.js";

const cfg = loadConfig();
const { app, wallet, chainId } = await createApp(cfg);
app.listen(cfg.port, () => {
  console.log(`apptochain relayer on :${cfg.port}  chain=${chainId}  relayer=${wallet.address}`);
  console.log(cfg.apiKeys.size ? `API keys required (${cfg.apiKeys.size} apps)` : "WARNING: open sandbox mode, no API keys set");
});
