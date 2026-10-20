# apptochain — Phase 2 · Builder Alpha

Bring an existing web or mobile app on-chain on **Base**: wallets, gasless actions, memberships, digital assets, loyalty points and payments, without rebuilding the app.

```
Your app ──► @apptochain/sdk ──► relayer (pays gas) ──► ATCForwarder ──► your modules ──► Base
                │                                                         ▲
                └──────────── paid actions go straight from the wallet ───┘
```

| Package | What it is |
|---|---|
| `packages/contracts` | Solidity: `ATCFactory`, `ATCForwarder`, `ATCTreasury`, and four templates: `ATCMembership`, `ATCAssets`, `ATCRewards`, `ATCPayments` |
| `packages/sdk` | `@apptochain/sdk`: connect wallets (EIP-6963), map app features to on-chain actions, deploy modules, run gasless actions |
| `packages/relayer` | Express service that verifies signed requests, applies limits, simulates, then submits and pays gas |
| `apps/demo` | Sandbox app that walks through Connect → Launch → gasless actions |
| `docs/` | Guides, SDK reference, deployment and the Phase 3–5 build plan |

**Status:** all 13 contract tests and 14 end-to-end checks pass. These contracts are **not audited**. Use testnet only until the Phase 4 audit is done.

## Run it locally

Needs Node 20+ and a browser wallet such as MetaMask. Run these commands **inside the `apptochain` folder**.

**Mac / Linux**
```bash
cd ~/Downloads/apptochain   # wherever you unzipped it
npm install
npm run build
npm test                    # contract tests + full end-to-end check
bash scripts/dev.sh         # chain + relayer + demo. Ctrl+C stops everything
```

**Windows (PowerShell)**
```powershell
npm install; npm run build; npm test
.\scripts\windows-dev.ps1
```

Then open http://localhost:5173. In MetaMask, add network `http://127.0.0.1:8545` with chain ID `31337` and import Hardhat test account #2:
`0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a`. That key is public, so use it **for local only**.

<details><summary>Same thing by hand (any OS)</summary>

```bash
npm run chain          # terminal 1: local chain
npm run deploy:local   # terminal 2
npm run setup:local    # writes relayer .env and demo .env.local
npm run relayer        # terminal 2 (keeps running)
npm run demo           # terminal 3
```
</details>

## Deploy to Base Sepolia

See [docs/deploy-base.md](docs/deploy-base.md). In short: fill in `packages/contracts/.env`, run `npm run deploy:sepolia -w @apptochain/contracts`, then point the relayer and demo at the addresses saved in `deployments/baseSepolia.json`.

## Use the SDK in your app

```ts
import { AppToChain } from "@apptochain/sdk";
import deployment from "./baseSepolia.json";

const atc = new AppToChain({ network: "baseSepolia", deployment, relayerUrl: "https://relay.yourdomain.com", apiKey: "…" });
await atc.connect();                                   // 1. Connect
atc.map({ claimPass: { kind: "membership", module: "0xYourPass", method: "mint" } }); // 2. Map
const r = await atc.run("claimPass");                  // gasless: user signs, relayer pays
await r.wait();
```

Full reference: [docs/sdk.md](docs/sdk.md).

## Revenue, as built

| Stream (whitepaper) | Where it lives |
|---|---|
| A · Deployment fees | `ATCFactory.deploymentFee`, sent to the treasury on every `deploy` |
| B · Pro subscriptions | Relayer API keys and daily quotas (`DAILY_QUOTA_PER_APP`). Billing comes in Phase 4 |
| C · Transaction share | `ATCFactory.protocolFeeBps`, hard-capped at 5% and taken on every paid mint, sale and checkout |
| D · Marketplace | Phase 4 |

Every fee lands in `ATCTreasury`, and each withdrawal emits a public memo. Ownership of the factory and treasury moves to governance in Phase 5.
