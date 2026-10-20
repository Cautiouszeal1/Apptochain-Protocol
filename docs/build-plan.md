# Build plan: Phase 2 → Phase 5

## Phase 2 · Builder Alpha (Q1 2027): built in this repo
- [x] Factory, forwarder, treasury and four templates, with 13 tests
- [x] SDK: connect, map, launch, gasless run
- [x] Relayer with verification, simulation, limits and logging
- [x] Sandbox demo app
- [x] End-to-end test of the full stack
- [ ] **You:** deploy to Base Sepolia (see deploy-base.md) and host the relayer and demo
- [ ] **You:** create the GitHub org `apptochain` and push this repo (the site already links to it)
- [ ] **You:** a first security review. Run Slither and Aderyn (free static analysers) and fix the findings
- [ ] Publish the SDK to npm as `@apptochain/sdk@alpha`
- [ ] Recruit 5–10 alpha builders and collect feedback on the SDK

## Phase 3 · Public Testnet (Q2 2027)
- [ ] Relayer: Redis-backed limits, gas-price ceiling, auto top-up alerts, multiple instances
- [ ] Builder dashboard: list modules, issue API keys, view usage from relay logs
- [ ] Mobile SDK beta: React Native wrapper (WalletConnect / Reown AppKit)
- [ ] Embedded wallets (email or social login) for users with no wallet
- [ ] Bug bounty: publish the scope (these contracts plus the relayer) on Immunefi or a simple security page
- [ ] Ambassador programme pages
- [ ] Rename "bridge" to "relayer" on the website and in the whitepaper

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
