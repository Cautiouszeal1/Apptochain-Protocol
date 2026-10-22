# Build plan: Phase 2 → Phase 5

## Phase 2 · Builder Alpha (Q1 2027): built in this repo
- [x] Factory, forwarder, treasury and four templates, with 13 tests
- [x] SDK: connect, map, launch, gasless run
- [x] Relayer with verification, simulation, limits and logging
- [x] Sandbox demo app
- [x] End-to-end test of the full stack
- [x] Deployed to Base Sepolia; relayer on Render, demo on Vercel
- [x] Code on GitHub (`Cautiouszeal1/Apptochain-Protocol`)
- [x] First security review: Slither + Aderyn + manual review, fixes in templates v1.1.0 (docs/security-review.md)
- [ ] **You:** register v1.1.0 templates on Sepolia: `npm run upgrade-templates:sepolia -w @apptochain/contracts`
- [ ] Publish the SDK to npm as `@apptochain/sdk@alpha`
- [ ] Recruit 5–10 alpha builders and collect feedback on the SDK

## Phase 3 · Public Testnet (Q2 2027)
- [x] Builder dashboard: wallet sign-in, list and deploy modules, API keys, usage chart, quickstart
- [x] Relayer: per-builder API keys (hashed, owner-bound), Postgres storage, gas-price ceiling, low-balance webhook alerts, local nonce tracking
- [ ] **You:** Supabase database + dashboard on Vercel (see deploy-phase3.md)
- [ ] Relayer: Redis-backed rate limits so it can run on several instances
- [ ] Separate relayer wallet from the deployer wallet; move factory ownership to a Safe
- [x] Mobile SDK beta: `@apptochain/react` hooks + Expo example with WalletConnect (Reown AppKit), bundles for Android (docs/mobile.md)
- [ ] **You:** test the example on a real phone and report back
- [ ] Embedded wallets (email or social login) for users with no wallet
- [x] Bug bounty scope and safe-harbour policy (SECURITY.md)
- [ ] **You:** set reward amounts in SECURITY.md and turn on GitHub private vulnerability reporting
- [ ] Ambassador programme pages
- [x] Website says "relayer", links the demo, dashboard and code, and shows roadmap progress
- [ ] Whitepaper v1.1: say "relayer" instead of "bridge"

## Phase 4 · Mainnet (Q3 2027)
- [ ] Independent audit (budget roughly $15k–40k for this contract size), with fixes and a published report
- [ ] Mainnet deploy, owned by a Safe multisig
- [ ] Pro plans: paid API keys with higher quotas. Billing in fiat or USDC
- [ ] Plugin marketplace: listing contract with commission to the treasury, plus a UI
- [ ] Legal review of terms, privacy, and Nigeria SEC digital-asset rules before taking fees

## Phase 5 · Governance (Q4 2027)
- [ ] Choose the voting basis: governance token **or** verified-builder membership NFT. This is the main legal decision, so take advice first
- [ ] Deploy an OpenZeppelin Governor with a Timelock
- [ ] Transfer ownership of `ATCFactory` and `ATCTreasury` to the Timelock (no contract changes needed)
- [ ] Proposal and voting UI, plus a grants flow paid from the treasury

## Rules of thumb
- Testnet until audited. No exceptions.
- Mainnet ownership always sits with a multisig, never a single key.
- Keep the relayer wallet float small. It is a hot key on a server.
