// apptochain mobile example: WalletConnect (Reown AppKit) + @apptochain/react hooks on Base Sepolia.
// The user connects any mobile wallet, then claims a membership pass and checks points.
// Claims are gasless: the user only signs, the apptochain relayer pays.
import "@walletconnect/react-native-compat"; // must be the first import
import React from "react";
import { ActivityIndicator, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppKit, AppKitButton, AppKitProvider, createAppKit, useProvider } from "@reown/appkit-react-native";
import { EthersAdapter } from "@reown/appkit-ethers-react-native";
import {
  AppToChainProvider, useAction, useAppToChain, usePass, usePoints, useWalletProvider, type AppToChainOptions,
} from "@apptochain/react";
import type { Eip1193Provider } from "ethers";
import { storage } from "./src/storage";

const env = process.env;
const MEMBERSHIP = env.EXPO_PUBLIC_MEMBERSHIP_ADDRESS || undefined;
const REWARDS = env.EXPO_PUBLIC_REWARDS_ADDRESS || undefined;

const baseSepolia = {
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
  blockExplorers: { default: { name: "BaseScan", url: "https://sepolia.basescan.org" } },
  chainNamespace: "eip155" as const,
  caipNetworkId: "eip155:84532" as const,
  testnet: true,
};

const appKit = createAppKit({
  projectId: env.EXPO_PUBLIC_REOWN_PROJECT_ID!,
  metadata: {
    name: "apptochain mobile",
    description: "Gasless on-chain actions with apptochain",
    url: "https://apptochain.vercel.app",
    icons: ["https://apptochain.vercel.app/favicon.ico"],
    redirect: { native: "apptochainmobile://" },
  },
  adapters: [new EthersAdapter()],
  networks: [baseSepolia],
  defaultNetwork: baseSepolia,
  storage,
});

const atcConfig: AppToChainOptions = {
  network: "baseSepolia",
  deployment: { factory: env.EXPO_PUBLIC_FACTORY_ADDRESS, forwarder: env.EXPO_PUBLIC_FORWARDER_ADDRESS },
  relayerUrl: env.EXPO_PUBLIC_RELAYER_URL || "https://apptochain-relayer.onrender.com",
  apiKey: env.EXPO_PUBLIC_ATC_API_KEY || undefined,
  appId: "mobile-example",
  actions: MEMBERSHIP ? { claimPass: { kind: "membership", module: MEMBERSHIP, method: "mint" } } : undefined,
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AppKitProvider instance={appKit}>
        <AppToChainProvider config={atcConfig}>
          <Home />
          <AppKit />
        </AppToChainProvider>
      </AppKitProvider>
    </SafeAreaProvider>
  );
}

function Home() {
  // Bridge the WalletConnect session into apptochain.
  const { provider } = useProvider();
  const { address, connecting, error } = useWalletProvider(provider as unknown as Eip1193Provider | undefined);
  const { atc } = useAppToChain();
  const pass = usePass(MEMBERSHIP);
  const points = usePoints(REWARDS);
  const claim = useAction("claimPass");

  const onClaim = async () => {
    const r = await claim.run();
    if (r?.status === "confirmed") pass.refresh();
  };

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.logo}>app<Text style={s.acc}>to</Text>chain</Text>
        <Text style={s.eyebrow}>MOBILE SDK BETA · BASE SEPOLIA</Text>
        <Text style={s.h1}>Own it. Pay no gas.</Text>

        <View style={s.card}>
          <Text style={s.label}>1 · CONNECT</Text>
          <AppKitButton />
          {connecting && <Text style={s.muted}>Linking wallet…</Text>}
          {address && <Text style={s.mono}>{address}</Text>}
          {error && <Text style={s.err}>{error}</Text>}
        </View>

        <View style={s.card}>
          <Text style={s.label}>2 · MEMBERSHIP</Text>
          {!MEMBERSHIP ? (
            <Text style={s.muted}>Set EXPO_PUBLIC_MEMBERSHIP_ADDRESS in .env (copy it from your dashboard → Modules).</Text>
          ) : (
            <>
              <Text style={s.big}>{pass.data === undefined ? "—" : pass.data ? "Active ✓" : "No pass yet"}</Text>
              <Pressable
                accessibilityRole="button"
                disabled={!address || claim.busy}
                onPress={onClaim}
                style={({ pressed }) => [s.btn, (!address || claim.busy) && s.btnOff, pressed && s.btnDown]}
              >
                {claim.busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Claim free pass</Text>}
              </Pressable>
              <Text style={s.muted}>{statusText(claim.status)}</Text>
              {claim.hash && (
                <Text style={s.link} onPress={() => Linking.openURL(`${atc.network.explorer}/tx/${claim.hash}`)}>
                  View transaction ↗
                </Text>
              )}
              {claim.error && <Text style={s.err}>{claim.error}</Text>}
            </>
          )}
        </View>

        {REWARDS && (
          <View style={s.card}>
            <Text style={s.label}>3 · POINTS</Text>
            <Text style={s.big}>{points.data === undefined ? "—" : points.data.toString()}</Text>
            <Pressable onPress={() => points.refresh()}><Text style={s.link}>Refresh</Text></Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function statusText(st: string) {
  switch (st) {
    case "signing": return "Approve the free signature in your wallet…";
    case "relaying": return "Relayer is submitting it to Base…";
    case "confirmed": return "Confirmed on-chain. You paid no gas.";
    case "failed": return "";
    default: return "Signing is free. The relayer pays the gas.";
  }
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f3efe6" },
  body: { padding: 20, gap: 14 },
  logo: { fontSize: 22, fontWeight: "800", color: "#16150f" },
  acc: { color: "#d94a14" },
  eyebrow: { marginTop: 18, fontSize: 12, letterSpacing: 1, color: "#d94a14", fontWeight: "600" },
  h1: { fontSize: 38, fontWeight: "800", color: "#16150f", letterSpacing: -1 },
  card: { backgroundColor: "#fbf8f0", borderColor: "#d9d3c2", borderWidth: 1, borderRadius: 14, padding: 16, gap: 10 },
  label: { fontSize: 12, color: "#1f6f5c", fontWeight: "600" },
  big: { fontSize: 26, fontWeight: "800", color: "#16150f" },
  mono: { fontFamily: "Courier", fontSize: 12, color: "#3c392f" },
  muted: { color: "#6b6758", fontSize: 14 },
  err: { color: "#b42318", fontSize: 14 },
  link: { color: "#1f6f5c", fontWeight: "600" },
  btn: { backgroundColor: "#d94a14", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  btnOff: { opacity: 0.45 },
  btnDown: { opacity: 0.8 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
