# apptochain local dev launcher for Windows PowerShell.
# Opens the local chain, deploys, writes env files, then starts the relayer and demo in their own windows.
# Run from the repo root:  .\scripts\windows-dev.ps1
# If scripts are blocked:  Set-ExecutionPolicy -Scope Process Bypass

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path "$root\node_modules")) { npm install }
if (-not (Test-Path "$root\packages\sdk\dist")) { npm run build }

Write-Host "Starting local chain..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; npm run chain"

# Wait for the chain to answer
$body = '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-RestMethod -Uri "http://127.0.0.1:8545" -Method Post -Body $body -ContentType "application/json" | Out-Null; break }
  catch { Start-Sleep -Milliseconds 500 }
}

Write-Host "Deploying contracts..." -ForegroundColor Cyan
npm run deploy:local
npm run setup:local

Write-Host "Starting relayer and demo..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; npm run relayer"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; npm run demo"

Write-Host ""
Write-Host "Open http://localhost:5173" -ForegroundColor Green
Write-Host "MetaMask: add network RPC http://127.0.0.1:8545, chain ID 31337, symbol ETH."
Write-Host "Import test key (LOCAL ONLY): 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
