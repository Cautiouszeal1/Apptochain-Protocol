# Deploying to Base Sepolia (and later Base)

## 1. Wallets you need

| Wallet | Purpose | Funding |
|---|---|---|
| Deployer | Sends the deploy transactions | ~0.05 Sepolia ETH (faucet) |
| Owner | A Safe multisig on Base that owns the factory and treasury (app.safe.global). Use at least 2-of-3 signers | none |
| Relayer | Hot wallet that pays gas for users | Small float only, topped up as needed |

Never reuse the deployer or relayer key for anything else, and never commit a `.env` file.

## 2. Deploy the contracts

```powershell
cd packages\contracts
copy .env.example .env      # fill in DEPLOYER_PRIVATE_KEY, OWNER_ADDRESS, PROTOCOL_FEE_BPS
npm run deploy:sepolia
```

Addresses are saved to `packages/contracts/deployments/baseSepolia.json`. Commit this file: the SDK and dashboards read it.

If `OWNER_ADDRESS` is a Safe, open the Safe and execute `acceptOwnership()` on the factory. Ownership uses a two-step transfer so it can't be sent to a wrong address by accident.

Verify the source on Basescan so anyone can read it:

```powershell
npx hardhat verify --network baseSepolia <FACTORY> <deployer> <treasury> <deploymentFeeWei> <feeBps>
npx hardhat verify --network baseSepolia <TREASURY> <owner>
npx hardhat verify --network baseSepolia <FORWARDER>
npx hardhat verify --network baseSepolia <TEMPLATE> <FORWARDER>   # for each of the 4 templates
```

## 3. Run the relayer

```powershell
cd packages\relayer
copy .env.example .env      # RPC_URL, RELAYER_PRIVATE_KEY, FORWARDER_ADDRESS, FACTORY_ADDRESS, API_KEYS, CORS_ORIGINS
npm start
```

It runs on any Node host (Railway, Render, Fly.io or a small VPS). Put it behind HTTPS. Set `CORS_ORIGINS` to your real app domains, and set `API_KEYS` before any public use.

> The relayer is a long-running server with a private key, so it does **not** belong on Vercel. Vercel is fine for the demo and the website.

## 4. Point the demo at Base Sepolia

`apps/demo/.env.local`:

```
VITE_NETWORK=baseSepolia
VITE_RELAYER_URL=https://relay.yourdomain.com
VITE_FACTORY_ADDRESS=<from baseSepolia.json>
VITE_FORWARDER_ADDRESS=<from baseSepolia.json>
VITE_APP_ID=demo
VITE_API_KEY=<demo key>
```

Run `npm run build -w @apptochain/demo`, then deploy `apps/demo/dist` to Vercel. Set the root directory to `apps/demo`, the build command to `npm run build`, and add the same `VITE_*` variables there.

## 5. Mainnet

Wait for the Phase 4 audit before mainnet. Then run `npm run deploy:base` with the same steps.
