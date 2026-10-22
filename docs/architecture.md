# Architecture

## Contracts (`packages/contracts`)

| Contract | Role | Owner today | Owner in Phase 5 |
|---|---|---|---|
| `ATCFactory` | Clones templates, collects the deployment fee, publishes `feeConfig()`, and keeps the registry the relayer trusts (`isApp`) | Team multisig | Governor |
| `ATCForwarder` | OpenZeppelin ERC-2771 forwarder: EIP-712 signatures, nonces, deadlines | none (immutable) | none |
| `ATCTreasury` | Receives all protocol fees. Every spend carries a public memo | Team multisig | Governor |
| `ATCMembership` | ERC-721 passes with price, expiry and supply cap | App builder | App builder |
| `ATCAssets` | ERC-1155 items with per-item price and supply | App builder | App builder |
| `ATCRewards` | ERC-20 points, 0 decimals, non-transferable by default, burn to redeem | App builder | App builder |
| `ATCPayments` | One-time order settlement in ETH or accepted ERC-20s, with a fee split | App builder | App builder |

Design choices:
- **Minimal clones (EIP-1167).** Each app module costs a fraction of a full deployment. Templates are locked with `_disableInitializers()`.
- **Not upgradeable.** A deployed module never changes under its users. New template versions are registered for new apps only, which is simpler to audit and easier to trust.
- **Fee cap in code.** `protocolFeeBps` can never exceed 500 (5%), whoever owns the factory.
- **Transient reentrancy guard** (EIP-1153, live on Base). It is cheaper and needs no clone initialisation.
- **Voting-agnostic.** Nothing assumes a token. Phase 5 only has to transfer ownership of the factory and treasury to a governor.

## Relayer (`packages/relayer`)

The relayer runs these checks in order, cheapest first:
1. API key and per-IP limit
2. Request shape, `value == 0`, `gas ≤ MAX_GAS`, deadline in the future
3. Per-wallet rate limit
4. The target must be a module deployed by the factory, so it can never be used to call arbitrary contracts
5. `forwarder.verify()`: signature, nonce, deadline
6. `staticCall` simulation, so the relayer never pays for a failing transaction (revert reasons are decoded)
7. Daily quota per app, then submit through a mutex so nonces stay ordered

Every request is logged to `relay-log.jsonl` and, when `DATABASE_URL` is set, to Postgres for the dashboard. Watch `/health` for `lowBalance`, or set `ALERT_WEBHOOK_URL` to be pinged.

### API keys and the dashboard (Phase 3)

- Builders sign in with a free wallet signature (`/v1/auth/nonce` then `/v1/auth/verify`). Nonces are single-use and expire after 10 minutes. Sessions are HMAC-signed tokens valid for 7 days.
- Keys look like `atc_…`. Only a SHA-256 hash is stored, so the full key is shown once at creation.
- **A key only sponsors modules owned by the builder who created it.** The relayer reads `owner()` on the target module. A leaked key can't be used to spend gas on someone else's contracts.
- Every relay is recorded against the module owner, which powers the usage chart and the gas-sponsored total.
- `ALLOW_SANDBOX=true` lets requests without a key through (the public demo). Set it to `false` when you're ready to require keys.

Known limits: rate limits and sign-in nonces are in memory, so run **one** relayer instance until they move to Redis. That's a Phase 3 item.

## Why "relayer", not "bridge"

In crypto, "bridge" means cross-chain bridges, which are the most-exploited category. The website and whitepaper should say **relayer**. See the Phase 3 checklist.
