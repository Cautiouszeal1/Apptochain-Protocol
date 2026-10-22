#!/usr/bin/env bash
# Creates a ready-to-run Expo app that uses the apptochain mobile SDK beta.
#   bash apps/mobile/setup.sh               → creates ~/apptochain-mobile
#   bash apps/mobile/setup.sh ~/Projects/x  → custom location
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${1:-$HOME/apptochain-mobile}"
VENDOR="$ROOT/apps/mobile/vendor"

echo "1/4 Building and packing the apptochain SDK + React hooks…"
cd "$ROOT"
npm run build -w @apptochain/sdk >/dev/null
npm run build -w @apptochain/react >/dev/null
rm -rf "$VENDOR" && mkdir -p "$VENDOR"
npm pack -w @apptochain/sdk -w @apptochain/react --pack-destination "$VENDOR" >/dev/null

echo "2/4 Creating the Expo app at $TARGET…"
npx --yes create-expo-app@latest "$TARGET" --template blank-typescript
cd "$TARGET"

echo "3/4 Installing WalletConnect (Reown AppKit) and apptochain…"
npx expo install @reown/appkit-react-native @reown/appkit-ethers-react-native \
  @walletconnect/react-native-compat @walletconnect/utils \
  @react-native-async-storage/async-storage @react-native-community/netinfo \
  react-native-get-random-values react-native-svg react-native-safe-area-context expo-application
# keep a copy inside the app so it doesn't depend on this repo's location
mkdir -p vendor && cp "$VENDOR"/*.tgz vendor/
npm install ethers@6 ./vendor/apptochain-sdk-*.tgz ./vendor/apptochain-react-*.tgz

echo "4/4 Copying the example screens…"
cp "$ROOT/apps/mobile/App.tsx" App.tsx
mkdir -p src && cp "$ROOT/apps/mobile/src/storage.ts" src/storage.ts
[ -f .env ] || cp "$ROOT/apps/mobile/.env.example" .env
node -e 'const f="app.json",j=require("./"+f);j.expo.scheme="apptochainmobile";require("fs").writeFileSync(f,JSON.stringify(j,null,2)+"\n")'

echo
echo "Done. Next:"
echo "  1. Edit $TARGET/.env  (Reown project ID, API key, module addresses)"
echo "  2. cd $TARGET && npx expo start"
echo "  3. Scan the QR code with the Expo Go app on your phone"
