# apptochain

Bring an existing web or mobile app on-chain on **Base**: wallets, gasless actions, memberships, digital assets, loyalty points and payments, without rebuilding the app.

```
Your app ──► @apptochain/sdk ──► relayer (pays gas) ──► ATCForwarder ──► your modules ──► Base
                │                    ▲                                     ▲
                │                    └── API key from the builder dashboard │
                └──────────── paid actions go straight from the wallet ─────┘
```

| Package | What it is |
|---|---|
| `packages/contracts` | Solidity: `ATCFactory`, `ATCForwarder`, `ATCTreasury`, and four templates: `ATCMembership`, `ATCAssets`, `ATCRewards`, `ATCPayments` |
| `packages/sdk` | `@apptochain/sdk`: connect wallets (EIP-6963), map app features to on-chain actions, deploy modules, run gasless actions, plus `BuilderClient` for the dashboard API |
| `packages/react` | `@apptochain/react`: hooks for React **and React Native** (`useAction`, `usePass`, `useWalletProvider`…) |
| `packages/relayer` | Express service: verifies signed requests, enforces API keys and limits, simulates, then submits and pays gas. Also serves the dashboard API (wallet sign-in, keys, usage) |
| `apps/demo` | Public sandbox: Connect → Launch → gasless actions |
| `apps/mobile` | **Mobile SDK beta:** Expo example with WalletConnect (Reown AppKit) and a setup script. See [docs/mobile.md](docs/mobile.md) |
| `apps/dashboard` | **Builder dashboard (Phase 3):** sign in with a wallet, see and deploy modules, manage API keys, track usage and gas sponsored, copy a quickstart |
| `docs/` | Guides, SDK reference, deployment and the build plan |

**Status:** 24 contract tests (97% line coverage), storage tests (memory + Postgres) and 36 end-to-end checks (including the React hooks) pass. First internal security review done: see [docs/security-review.md](docs/security-review.md). The contracts are **not independently audited**, so use testnet only until the Phase 4 audit. Found a bug? See [SECURITY.md](SECURITY.md).

## Live (Base Sepolia)

| | |
|---|---|
| Demo | https://apptochain-sandbox.vercel.app |
| Relayer | https://apptochain-relayer.onrender.com/health |
| Factory | `0x2bD0b6DC3E47c199510c399076fF18356a768cd5` |
| Forwarder | `0xb04971fcB54192613eE45249390B653E2B0D4963` |

## Run it locally

Needs Node 20+ and a browser wallet such as MetaMask. Run these commands **inside the `apptochain` folder**.

**Mac / Linux**
```bash
npm install
npm run build
npm test                    # contracts + storage + full end-to-end check
bash scripts/dev.sh         # chain + relayer + demo + dashboard. Ctrl+C stops everything
```

**Windows (PowerShell)**
```powershell
npm install; npm run build; npm test
.\scripts\windows-dev.ps1
```

Then open the demo at http://localhost:5173 and the dashboard at http://localhost:5174. In MetaMask, add network `http://127.0.0.1:8545` with chain ID `31337` and import Hardhat test account #2:
`0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a`. That key is public, so use it **for local only**.

To also test the Postgres storage locally: `TEST_DATABASE_URL=postgres://… node packages/relayer/test/store.test.mjs`.

## Deploy

- Phase 2 (contracts, relayer, demo): [docs/deploy-base.md](docs/deploy-base.md)
- Phase 3 (database, dashboard sign-in, API keys): [docs/deploy-phase3.md](docs/deploy-phase3.md)

## Use the SDK in your app

```ts
import { AppToChain } from "@apptochain/sdk";

const atc = new AppToChain({
  network: "baseSepolia",
  deployment: { factory: "0x2bD0…8cd5", forwarder: "0xb049…4963" },
  relayerUrl: "https://apptochain-relayer.onrender.com",
  apiKey: "atc_…",                                   // from the dashboard
});
await atc.connect();                                 // 1. Connect
atc.map({ claimPass: { kind: "membership", module: "0xYourPass", method: "mint" } }); // 2. Map
const r = await atc.run("claimPass");                // 3. User signs, relayer pays
await r.wait();
```

The dashboard's **Quickstart** tab generates this with your own addresses. Full reference: [docs/sdk.md](docs/sdk.md).

## Revenue, as built

| Stream (whitepaper) | Where it lives |
|---|---|
| A · Deployment fees | `ATCFactory.deploymentFee`, sent to the treasury on every `deploy` |
| B · Pro subscriptions | API keys and daily quotas per key (`DAILY_QUOTA_PER_APP`). Paid tiers and billing come in Phase 4 |
| C · Transaction share | `ATCFactory.protocolFeeBps`, hard-capped at 5% and taken on every paid mint, sale and checkout |
| D · Marketplace | Phase 4 |

Every fee lands in `ATCTreasury`, and each withdrawal emits a public memo. Ownership of the factory and treasury moves to governance in Phase 5.
