// Usage:
//   npx hardhat run scripts/deploy.js --network localhost
//   npx hardhat run scripts/deploy.js --network baseSepolia
// Env: OWNER_ADDRESS (multisig, defaults to deployer), DEPLOYMENT_FEE_ETH, PROTOCOL_FEE_BPS
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { deployCore } = require("./lib");

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  const owner = process.env.OWNER_ADDRESS || deployer.address;
  const deploymentFee = ethers.parseEther(process.env.DEPLOYMENT_FEE_ETH || "0");
  const feeBps = Number(process.env.PROTOCOL_FEE_BPS || 100);
  const { chainId } = await ethers.provider.getNetwork();

  console.log(`Deploying apptochain core to ${network.name} (chain ${chainId}) from ${deployer.address}`);
  const out = await deployCore(ethers, {
    owner, deploymentFee, feeBps,
    log: (...a) => console.log("  ", ...a),
  });

  const record = {
    network: network.name,
    chainId: Number(chainId),
    deployedAt: new Date().toISOString(),
    owner,
    deploymentFeeWei: deploymentFee.toString(),
    protocolFeeBps: feeBps,
    treasury: await out.treasury.getAddress(),
    forwarder: await out.forwarder.getAddress(),
    factory: await out.factory.getAddress(),
    implementations: out.implementations,
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  console.log(`Saved ${file}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
