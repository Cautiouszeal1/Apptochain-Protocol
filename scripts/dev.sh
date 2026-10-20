#!/usr/bin/env bash
# apptochain local dev launcher for macOS / Linux.
# Starts the local chain, deploys, writes env files, starts the relayer, then runs the demo.
# Run from the project folder:  bash scripts/dev.sh      Stop everything with Ctrl+C.
set -e
cd "$(dirname "$0")/.."

[ -d node_modules ] || npm install
[ -d packages/sdk/dist ] || npm run build

pids=()
cleanup() { echo; echo "Stopping chain and relayer..."; kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "Starting local chain..."
npm run chain > chain.log 2>&1 &
pids+=($!)

for i in $(seq 1 60); do
  curl -s -X POST -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
    http://127.0.0.1:8545 > /dev/null && break
  sleep 0.5
done

echo "Deploying contracts..."
npm run deploy:local
npm run setup:local

echo "Starting relayer..."
npm run relayer > relayer.log 2>&1 &
pids+=($!)

echo
echo "Open http://localhost:5173"
echo "MetaMask: add network RPC http://127.0.0.1:8545, chain ID 31337, symbol ETH."
echo "Import test key (LOCAL ONLY): 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
echo
npm run demo
