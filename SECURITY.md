# Security policy and bug bounty

apptochain treats security as a product feature. If you find a vulnerability, report it privately and we'll work with you to fix it and reward you.

## How to report

Use **GitHub private vulnerability reporting**: go to this repository's **Security** tab and choose **Report a vulnerability**. Your report stays private between you and the maintainers.

Please include:
- the affected contract or service, and the network
- a clear description and its impact
- steps or a proof of concept (a Hardhat test is ideal)
- your wallet address for the reward

**Please don't** open a public issue, post on social media, or test against other people's modules or funds.

We aim to acknowledge reports within **72 hours**, give a first assessment within **7 days**, and keep you updated until it's fixed.

## Scope

**In scope**

| Component | Where |
|---|---|
| Core contracts | `ATCFactory`, `ATCForwarder`, `ATCTreasury` |
| Templates | `ATCMembership`, `ATCAssets`, `ATCRewards`, `ATCPayments`, `ATCTemplateBase` |
| Relayer service | `packages/relayer`: request validation, API keys, dashboard sign-in |
| SDK | `packages/sdk`: anything that could make a user sign something other than what they intended |

Live deployments on **Base Sepolia**, listed in the README.

**Out of scope**
- OpenZeppelin library code (report to OpenZeppelin), and third-party services: Base, wallets, Render, Vercel, Supabase
- The public sandbox being rate-limited, or test ETH running out
- Denial of service needing traffic floods, spam or social engineering
- Missing best-practice headers, clickjacking on pages without sensitive actions, self-XSS
- Issues already listed in `docs/security-review.md` as accepted risks
- Anything requiring a compromised owner key, a malicious module owner acting against their own module, or physical access

## Severity and rewards

Severity follows impact and likelihood, with a CVSS-style judgement by the maintainers.

| Severity | Examples | Reward (testnet phase) |
|---|---|---|
| Critical | Steal or freeze funds in modules or the treasury; make the relayer pay gas for arbitrary contracts; forge another user's signed action | **TBD** |
| High | Bypass API-key ownership checks; mint passes or items without paying; sign in as another wallet | **TBD** |
| Medium | Grief a module (block mints or payments); exceed rate limits or quotas at scale; leak another builder's usage data | **TBD** |
| Low | Incorrect events, accounting off by small amounts, information leaks with no direct impact | **TBD** |

Rewards are paid in USDC on Base. Amounts during the testnet phase are set by the core team and published here before the programme opens. The programme moves to a larger mainnet pool (for example on Immunefi) after the Phase 4 audit.

## Rules (safe harbour)

If you follow this policy in good faith, we won't pursue legal action against you, and we'll treat your research as authorised. In return:
- Test only on **Base Sepolia** or a local fork, never on mainnet funds.
- Use your own wallets and your own modules.
- Don't access, change or delete other people's data.
- Give us reasonable time to fix the issue before you disclose it publicly; 90 days is the default.
- One report per issue. The first clear report gets the reward.

## Our commitments

- Credit in release notes (if you want it)
- A published post-mortem for any Critical or High issue
- Fixes released in stages, starting with small limits, as described in the whitepaper
