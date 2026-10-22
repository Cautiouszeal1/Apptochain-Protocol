# Deploying Phase 3: builder dashboard

You already have the Phase 2 pieces live: contracts on Base Sepolia, the relayer on Render, and the demo on Vercel. Phase 3 adds three things:

1. **A database**, so API keys and usage survive restarts. We use Supabase's free Postgres.
2. **Dashboard sign-in** on the relayer, which needs a `SESSION_SECRET`.
3. **The dashboard site** on Vercel.

No contract changes and no redeploys on-chain.

## 1. Database (Supabase, free)

1. Go to supabase.com → **New project**. Name it `apptochain`, set a strong database password and save it in your password manager. Region: **Europe (Frankfurt)**, so it sits near the Render relayer.
2. Once it's ready, click **Connect** at the top → **Connection string** → choose the **Session pooler** URI. It looks like:
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
3. Replace `[YOUR-PASSWORD]` with your database password. That full string is your `DATABASE_URL`. It is a secret.

The relayer creates its two tables (`atc_api_keys`, `atc_relays`) automatically on first start.

> Use the **Session pooler** string, not "Direct connection". Direct connections need IPv6, which Render's free plan doesn't support.

## 2. Relayer settings (Render)

Render → **Apptochain-relayer → Environment → Edit** → add:

| Key | Value |
|---|---|
| `DATABASE_URL` | the Supabase Session pooler string from step 1 |
| `SESSION_SECRET` | a long random string. On your Mac: `openssl rand -hex 32` |
| `ALLOW_SANDBOX` | `true` for now, so the public demo keeps working without a key |
| `CORS_ORIGINS` | `https://apptochain-sandbox.vercel.app,https://apptochain-dashboard.vercel.app` |

Optional:

| Key | Value |
|---|---|
| `MAX_GAS_PRICE_GWEI` | e.g. `1`. Refuses to relay when Base fees spike |
| `ALERT_WEBHOOK_URL` | a Discord or Slack incoming-webhook URL. Pings you when the relayer wallet runs low |
| `LOW_BALANCE_ETH` | alert threshold, default `0.005` |

**Save and deploy**. Render redeploys from the latest GitHub commit, so push this code first (step 4). Then check `/health`. It should now show `"dashboard": true`, and the logs should say `storage: Postgres`.

## 3. Dashboard site (Vercel)

Vercel → **Add New → Project** → import **Apptochain-Protocol** again → choose **apps/dashboard**.

| Setting | Value |
|---|---|
| Project name | `apptochain-dashboard` |
| Root Directory | `apps/dashboard` |
| Framework | Vite |
| Install Command | `cd ../.. && npm install` |
| Build Command | `cd ../.. && npm run build -w @apptochain/sdk && npm run build -w @apptochain/dashboard` |
| Output Directory | `dist` |

Environment variables (public values):
```
VITE_NETWORK=baseSepolia
VITE_RELAYER_URL=https://apptochain-relayer.onrender.com
VITE_FACTORY_ADDRESS=0x2bD0b6DC3E47c199510c399076fF18356a768cd5
VITE_FORWARDER_ADDRESS=0xb04971fcB54192613eE45249390B653E2B0D4963
```

Deploy, then open `https://apptochain-dashboard.vercel.app`. If Vercel gave it a different address, put that exact address in `CORS_ORIGINS` on Render.

## 4. Getting the new code onto GitHub

Unzip `apptochain-phase3-update.zip` in Downloads. That creates an `apptochain-update` folder. Merge it into your project with Terminal, **not** Finder, because Finder's "Replace" would delete your `.env` keys and Git history:

```bash
cp -R ~/Downloads/apptochain-update/ ~/Downloads/apptochain/
cd ~/Downloads/apptochain
npm install
npm run build
npm test
```

All tests should pass. Then open **GitHub Desktop**: it lists the changed files. Check that **no `.env` file** is in the list, write a summary such as "Phase 3: builder dashboard", click **Commit to main**, then **Push origin**. Render and the demo on Vercel redeploy automatically.

## 5. Register the v1.1.0 templates (security fixes)

The first security review fixed `hasPass` so it respects expiry, plus several smaller items (see `docs/security-review.md`). Register the new template code on your existing factory. Your factory, forwarder and treasury addresses stay the same:

```bash
cd ~/Downloads/apptochain
npm run upgrade-templates:sepolia -w @apptochain/contracts
```

This uses the deployer key already in `packages/contracts/.env` and costs a little Sepolia ETH. It updates `deployments/baseSepolia.json`; commit that file. Modules deployed before this keep working on the old code. New deploys from the demo and dashboard use v1.1.0.

## 6. Try it

1. Open the dashboard and click **Connect & sign in**. Sign the free message.
2. **Modules** should list what you deployed from the demo. Deploy a new one if you like.
3. **API keys → Create key** and copy it straight away; it's shown only once.
4. **Quickstart** shows code with your key and module addresses filled in.
5. Do a few actions in the demo, then check **Usage**.

## Later: close the sandbox

Once real builders use API keys, set `ALLOW_SANDBOX=false` on Render. After that, every gasless action needs a key, and each key only pays gas for modules owned by the builder who created it.
