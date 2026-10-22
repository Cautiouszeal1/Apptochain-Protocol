# @apptochain/sdk reference

```ts
import { AppToChain } from "@apptochain/sdk";
```

## Create

```ts
const atc = new AppToChain({
  network: "baseSepolia",          // "base" | "baseSepolia" | "localhost" | custom NetworkConfig
  deployment,                      // { factory, forwarder } from contracts/deployments/<network>.json
  relayerUrl: "https://relay.example.com",
  apiKey: "…",                     // if the relayer has API_KEYS set
  appId: "my-app",
  actions: { /* optional, same as map() */ },
});
```

## 1 · Connect

| Method | What it does |
|---|---|
| `listWallets()` | Installed wallets via EIP-6963, so you can build your own picker |
| `connect(wallet?)` | Requests accounts and switches or adds the Base network. Returns the address |
| `useSigner(signer)` | Server or script use with any ethers `Signer` |
| `signIn(statement?)` | Free message signature proving wallet ownership. Verify it on your backend with `ethers.verifyMessage` |
| `onAccountChange(cb)` | Fires on connect, account switch and disconnect |
| `disconnect()` | Forget the signer locally |

## 2 · Map

```ts
atc.map({
  claimPass:  { kind: "membership", module: "0xPass",   method: "mint" },
  buyItem:    { kind: "assets",     module: "0xShop",   method: "mint", gasless: false }, // paid: wallet pays
  payOrder:   { kind: "payments",   module: "0xPay",    method: "payToken" },             // USDC, gasless
  redeem:     { kind: "rewards",    module: "0xPoints", method: "redeem" },
});

const r = await atc.run("buyItem", [1n, 2n], { value: parseEther("0.2") });
await r.wait(); // { status: "confirmed" | "failed", blockNumber }
```

Rules:
- `gasless` defaults to `true`. Gasless actions **cannot carry ETH**, so any `value > 0` goes from the wallet automatically.
- `map()` throws straight away if the method doesn't exist on that module, so typos never reach users.
- Errors from the relayer are `RelayerError` with a `code`: `WOULD_REVERT`, `BAD_SIGNATURE`, `RATE_LIMITED`, `QUOTA_EXCEEDED`, `TARGET_NOT_ALLOWED`, `UNAUTHORIZED`, `VALUE_NOT_ALLOWED`, `GAS_TOO_HIGH`, `EXPIRED`.

## 3 · Launch

```ts
await atc.deploy.membership({ name, symbol, baseURI?, priceEth?, durationDays?, maxSupply? }, appId?)
await atc.deploy.assets({ name, uri }, appId?)                        // uri may contain {id}
await atc.deploy.rewards({ name, symbol, transferable? }, appId?)     // non-transferable by default
await atc.deploy.payments({ payee, acceptedTokens? }, appId?)         // e.g. USDC on Base
await atc.myModules()                                                 // [{ address, kind }]
atc.module("assets", address)                                         // ethers Contract for anything else
```

Each `deploy.*` returns the new module address. The connected wallet becomes the owner, and the factory deployment fee is paid automatically.

## Module methods (cheat sheet)

| Module | User actions | Owner actions |
|---|---|---|
| membership | `mint()`, `renew(id)` | `adminMint(to)`, `setTerms(price, duration)`, `setBaseURI`, `withdraw(to)` |
| assets | `mint(id, amount)` | `createItem(price, maxSupply)`, `adminMint(to,id,amt)`, `setItemPrice`, `setURI`, `withdraw` |
| rewards | `redeem(amount, rewardId)` | `award(to, amount, reason)` (owner or approved awarders), `setAwarder(addr, bool)` |
| payments | `pay(orderId)` (ETH), `payToken(token, amount, orderId)` | `setPayee`, `setAcceptedToken` |

Reads: `membership.isValid(id)`, `hasPass(user)`, `assets.items(id)`, `payments.paid(orderId)`, plus the standard ERC-721, ERC-1155 and ERC-20 views.

## Advanced

`signForwardRequest(to, data, { gas, ttlSeconds })` returns a signed ERC-2771 request for any call on a module. You can send it with `new RelayerClient(url, apiKey).relay(req)`.

## Builder account API (`BuilderClient`)

Used by the dashboard, and handy for scripts:

```ts
import { BuilderClient } from "@apptochain/sdk";

const builder = new BuilderClient("https://apptochain-relayer.onrender.com");
await builder.signIn(signer);              // free signature, 7-day session
const { key } = await builder.createKey("CI"); // shown once
await builder.listKeys();                  // never includes the secret
await builder.usage(14);                   // { days: [...], total, gasSponsoredEth }
await builder.recentRelays(20);
await builder.revokeKey(id);
```

Save `builder.session` and call `builder.restore(session)` to stay signed in.
