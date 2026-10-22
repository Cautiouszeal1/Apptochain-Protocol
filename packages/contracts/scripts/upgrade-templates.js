// Registers new template versions on an EXISTING factory. Existing app modules are not touched;
// only modules deployed after this run use the new code.
//
//   npx hardhat run scripts/upgrade-templates.js --network baseSepolia
//
// Must be sent from the factory owner (the deployer, until ownership moves to a Safe).
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { KINDS } = require("./lib");

async function main() {
  const { ethers, network } = hre;
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment record at ${file}. Deploy first.`);
  const rec = JSON.parse(fs.readFileSync(file, "utf8"));
  const [signer] = await ethers.getSigners();
  const factory = await ethers.getContractAt("ATCFactory", rec.factory);
  const owner = await factory.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Factory owner is ${owner}, but you are ${signer.address}. Run this from the owner wallet.`);
  }

  console.log(`Upgrading templates on ${network.name} factory ${rec.factory}`);
  const previous = { ...rec.implementations };
  for (const [kind, name] of Object.entries(KINDS)) {
    const F = await ethers.getContractFactory(name);
    const impl = await F.deploy(rec.forwarder);
    await impl.waitForDeployment();
    const addr = await impl.getAddress();
    await (await factory.setImplementation(ethers.id(kind), addr)).wait();
    rec.implementations[kind] = addr;
    console.log(`   ${name}  ${previous[kind] ?? "-"}  →  ${addr}`);
  }

  const version = await (await ethers.getContractAt("ATCMembership", rec.implementations.MEMBERSHIP)).TEMPLATE_VERSION();
  rec.templateVersion = version;
  rec.previousImplementations = [...(rec.previousImplementations || []), { replacedAt: new Date().toISOString(), ...previous }];
  fs.writeFileSync(file, JSON.stringify(rec, null, 2));
  console.log(`Templates now at v${version}. Saved ${file}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
