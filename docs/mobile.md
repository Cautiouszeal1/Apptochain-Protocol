# Mobile SDK beta (React Native / Expo)

apptochain runs in React Native with the same SDK as the web, plus `@apptochain/react` hooks. Wallet connection on phones uses **WalletConnect via Reown AppKit**: users pick MetaMask, Trust, Rainbow, Coinbase Wallet or any other mobile wallet, approve in that app, and come back.

Gasless actions work the same as on the web: the user only signs, and the relayer pays the gas.

**Status:** beta. The example app type-checks and bundles for Android on Expo SDK 58 / React Native 0.88. It has not been tested on physical devices yet, so please report what you find.

## Try the example app (about 10 minutes)

You need: Node 20+, the **Expo Go** app on your phone, and a mobile wallet (MetaMask mobile works) on Base Sepolia with a little test ETH.

1. **Get a free WalletConnect project ID:** sign up at dashboard.reown.com, create a project, and copy its Project ID.
2. **Create the app** from the project folder on your Mac:
   ```bash
   cd ~/Downloads/apptochain
   bash apps/mobile/setup.sh
   ```
   This creates `~/apptochain-mobile`. It takes a few minutes.
3. **Fill in `~/apptochain-mobile/.env`:**
   - `EXPO_PUBLIC_REOWN_PROJECT_ID`: from step 1
   - `EXPO_PUBLIC_ATC_API_KEY`: from your dashboard → API keys
   - `EXPO_PUBLIC_MEMBERSHIP_ADDRESS` and `EXPO_PUBLIC_REWARDS_ADDRESS`: from your dashboard → Modules
4. **Run it:**
   ```bash
   cd ~/apptochain-mobile
   npx expo start
   ```
   Scan the QR code with your phone's camera (iPhone) or with Expo Go (Android). Your phone and Mac must be on the same Wi-Fi.
5. In the app: **Connect**, pick your wallet and approve, then go back to the app and tap **Claim free pass**. Approve the free signature, and the pass appears with no gas paid.

> `EXPO_PUBLIC_*` values are compiled into the app, so treat the API key as public. That's safe by design: a key only sponsors **your own** modules, and the relayer rate-limits it. Revoke it from the dashboard at any time.

> In Expo Go, coming back from the wallet sometimes needs a manual switch back to Expo Go. A development build (`npx expo run:android` / `run:ios`) uses the app's own link scheme (`apptochainmobile://`) and returns automatically.

## Add it to your own React Native app

```bash
npx expo install @reown/appkit-react-native @reown/appkit-ethers-react-native \
  @walletconnect/react-native-compat @walletconnect/utils \
  @react-native-async-storage/async-storage @react-native-community/netinfo \
  react-native-get-random-values react-native-svg react-native-safe-area-context expo-application
npm install ethers@6 @apptochain/sdk @apptochain/react
```

Until the packages are published to npm, use the `.tgz` files that `setup.sh` creates in `apps/mobile/vendor`.

```tsx
import "@walletconnect/react-native-compat"; // first line of your entry file
import { AppKitProvider, AppKit, AppKitButton, createAppKit, useProvider } from "@reown/appkit-react-native";
import { EthersAdapter } from "@reown/appkit-ethers-react-native";
import { AppToChainProvider, useWalletProvider, useAction, usePass } from "@apptochain/react";

const appKit = createAppKit({ projectId, metadata, adapters: [new EthersAdapter()], networks: [baseSepolia], storage });

export default function App() {
  return (
    <SafeAreaProvider>
      <AppKitProvider instance={appKit}>
        <AppToChainProvider config={{ network: "baseSepolia", deployment, relayerUrl, apiKey,
          actions: { claimPass: { kind: "membership", module: CLUB, method: "mint" } } }}>
          <Screen />
          <AppKit />
        </AppToChainProvider>
      </AppKitProvider>
    </SafeAreaProvider>
  );
}

function Screen() {
  useWalletProvider(useProvider().provider);     // links the WalletConnect session to apptochain
  const claim = useAction("claimPass");            // status: idle → signing → relaying → confirmed
  const pass = usePass(CLUB);                      // true if the user holds a valid, unexpired pass
  return <><AppKitButton /><Button title="Claim" onPress={() => claim.run()} /></>;
}
```

The full working version is `apps/mobile/App.tsx`.

## Hooks reference (`@apptochain/react`)

These work in React Native **and** web React.

| Hook | Returns |
|---|---|
| `useAppToChain()` | `{ atc, address, isConnected, connecting, error, connect, connectProvider, disconnect }` |
| `useWalletProvider(provider)` | Keeps apptochain linked to an external EIP-1193 provider (AppKit, embedded wallets) |
| `useAction(name)` | `{ run(args?, {value?}), status, busy, hash, error, errorCode, reset }` |
| `useRead(kind, module, method, args, {refreshMs?})` | `{ data, loading, error, refresh }` for any view function |
| `usePass(membership, user?)` | `useRead` of `hasPass`, which checks expiry |
| `usePoints(rewards, user?)` | `useRead` of `balanceOf` |

`useAction` statuses: `idle` → `signing` (waiting for the wallet) → `relaying` (gasless) or `sending` (paid, from the wallet) → `confirmed` / `failed`. A cancelled signature shows as "You cancelled the request in your wallet."
