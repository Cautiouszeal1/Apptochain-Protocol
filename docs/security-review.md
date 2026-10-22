# First security review: October 2026

This is the "first security review" from the whitepaper's Phase 2 roadmap. It is an **internal** review: automated static analysis plus a manual line-by-line read. It is **not** a substitute for the independent audit required before mainnet (Phase 4).

## Scope

| In scope | Version |
|---|---|
| `ATCFactory`, `ATCForwarder`, `ATCTreasury` | core |
| `ATCTemplateBase`, `ATCMembership`, `ATCAssets`, `ATCRewards`, `ATCPayments` | templates v1.1.0 |
| Relayer (`packages/relayer`): request validation, API keys, sign-in | 0.1.0-alpha |

Solidity 0.8.24, OpenZeppelin Contracts 5.6.1 (audited library code, out of scope). Target chain: Base (EVM `cancun`).

## Method

1. **Slither** 0.11.6 (Trail of Bits), 102 detectors
2. **Aderyn** 0.6.8 (Cyfrin)
3. **Manual review** of every contract and the relayer's request path
4. **Tests:** 24 contract tests, 97% line and 82% branch coverage (`npm run coverage -w @apptochain/contracts`), plus 28 end-to-end checks against a live local chain

## Results summary

| Severity | Found | Fixed | Accepted (documented) |
|---|---|---|---|
| High | 0 real (2 tool false positives) | – | – |
| Medium | 1 | 1 | 0 |
| Low | 5 | 3 | 2 |
| Informational | 9 | 3 | 6 |

## Findings

### M-1 · `hasPass()` ignored expiry (fixed)
**Found by:** manual review.
`ATCMembership.hasPass(user)` returned true for any holder, including an **expired** pass. An app gating content with `hasPass` would let lapsed members in.
**Fix:** templates v1.1.0 make the collection ERC-721 Enumerable. `hasPass` now returns true only if the user holds a pass that hasn't expired. Added `validUntil(user)`. Tests cover expiry, renewal and transfer.
**Deployed modules:** modules created from v1.0.0 templates keep the old behaviour. Apps using those should gate with `isValid(tokenId)` or redeploy their membership after the upgrade.

### L-1 · No way to recover ERC-20s sent to a module (fixed)
Tokens mistakenly sent to a template were stuck forever. **Fix:** owner-only `rescueToken(token, to, amount)` with an event.

### L-2 · Owner actions without events (fixed)
`setBaseURI`, `setURI` and `withdraw` changed state silently. **Fix:** `BaseURISet`, `URISet` and `Withdrawn` events, plus ERC-4906 `BatchMetadataUpdate` so marketplaces refresh metadata.

### L-3 · `nonReentrant` was not the first modifier on `withdraw` (fixed)
Reordered, and applied the same order to `rescueToken`.

### L-4 · Centralisation (accepted, plan in place)
The factory owner can change fees (hard-capped at 5% in code), the treasury address and templates. The treasury owner can spend. **Mitigation:** two-step ownership transfer. **Before mainnet:** ownership moves to a Safe multisig, then to a Governor with a Timelock in Phase 5.

### L-5 · Fee-on-transfer or rebasing tokens in `ATCPayments` (accepted, documented)
Such tokens would deliver less than `amount`. Only the module owner can whitelist tokens. NatSpec and the SDK docs say to accept only standard tokens such as USDC.

### Informational
- **I-1** Templates now formally implement `IATCTemplate` (fixed).
- **I-2** Address parameters indexed in `TreasurySet`, `PayeeSet` and `TokenAccepted` (fixed).
- **I-3** Template version constant `TEMPLATE_VERSION = "1.1.0"` added (fixed).
- **I-4** Expiry uses `block.timestamp`. This is accepted: validator influence is seconds, and expiries are days.
- **I-5** `_msgData` overrides are reported as dead code. They are required for ERC-2771 inheritance resolution.
- **I-6** `AppDeployed` is emitted after `initialize` on a freshly cloned, trusted template, so there's no reentrancy path.
- **I-7** Free memberships and items can be claimed repeatedly by many wallets (Sybil). By design: use `maxSupply`, the relayer's per-wallet rate limits, or a price.
- **I-8** If the treasury address ever rejects ETH, paid mints revert. The treasury is owner-controlled and `ATCTreasury` accepts ETH.
- **I-9** Unbounded loop in `ATCPayments.initialize` over accepted tokens. The deployer controls its length.

### Tool false positives (no action)
- **Aderyn H-1 "locks Ether without a withdraw function":** every flagged contract forwards or withdraws ETH through `Address.sendValue`, which the tool doesn't recognise.
- **Aderyn H-2 "state change after external call"** in `setImplementation`: owner-only, and the external call is a `pure` read on the template being registered.

## Relayer review

| Check | Status |
|---|---|
| Only factory-deployed modules can be targets | ✅ `factory.isApp` |
| Builder keys sponsor only their own modules | ✅ `owner()` check, tested |
| Requests simulated before paying gas | ✅ `staticCall` |
| No ETH can be forwarded through gasless requests | ✅ `value == 0` |
| Replay protection | ✅ forwarder nonces + EIP-712 domain with chain ID |
| Fast back-to-back relays | ✅ fixed in this review: the relayer now tracks its own nonce |
| API keys stored hashed, shown once | ✅ SHA-256, high-entropy keys |
| Sign-in nonces single-use, 10-minute expiry, sessions HMAC-signed | ✅ tested |
| Gas-price ceiling, low-balance alerts | ✅ optional settings |
| Rate limits survive restarts / multiple instances | ⚠️ In-memory. Run one instance until Redis is added |
| Relayer key separate from the factory owner | ⚠️ Currently the same wallet on testnet. **Must** be separate before mainnet |

## Before mainnet

1. Independent audit of the contracts listed above, with the report published.
2. Factory and treasury ownership → Safe multisig (2-of-3 or better).
3. A dedicated relayer wallet holding only a small float, with low-balance alerts on.
4. Bug bounty live (see `SECURITY.md`).
5. Re-run Slither and Aderyn on the audited commit and attach the output to the release.

## Re-running the tools

```bash
pip install slither-analyzer          # needs Python 3
cd packages/contracts && npx hardhat clean && npx hardhat compile
slither . --hardhat-ignore-compile --filter-paths "node_modules|contracts/test"
npx @cyfrin/aderyn . --src contracts   # run from packages/contracts
```
