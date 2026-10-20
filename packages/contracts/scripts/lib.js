// Shared deploy logic, used by scripts/deploy.js and the test suite.
const KINDS = {
  MEMBERSHIP: "ATCMembership",
  ASSETS: "ATCAssets",
  REWARDS: "ATCRewards",
  PAYMENTS: "ATCPayments",
};

async function deployCore(ethers, { owner, deploymentFee = 0n, feeBps = 100, log = () => {} }) {
  const Treasury = await ethers.getContractFactory("ATCTreasury");
  const treasury = await Treasury.deploy(owner);
  await treasury.waitForDeployment();
  log("ATCTreasury", await treasury.getAddress());

  const Forwarder = await ethers.getContractFactory("ATCForwarder");
  const forwarder = await Forwarder.deploy();
  await forwarder.waitForDeployment();
  log("ATCForwarder", await forwarder.getAddress());

  const Factory = await ethers.getContractFactory("ATCFactory");
  // Deployer is temporary owner so it can register templates; ownership handed over at the end.
  const [deployer] = await ethers.getSigners();
  const factory = await Factory.deploy(deployer.address, await treasury.getAddress(), deploymentFee, feeBps);
  await factory.waitForDeployment();
  log("ATCFactory", await factory.getAddress());

  const implementations = {};
  for (const [kind, name] of Object.entries(KINDS)) {
    const F = await ethers.getContractFactory(name);
    const impl = await F.deploy(await forwarder.getAddress());
    await impl.waitForDeployment();
    const addr = await impl.getAddress();
    await (await factory.setImplementation(ethers.id(kind), addr)).wait();
    implementations[kind] = addr;
    log(name, addr);
  }

  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    // Ownable2Step: the new owner (your multisig) must call acceptOwnership().
    await (await factory.transferOwnership(owner)).wait();
    log("Factory ownership offered to", owner, "(call acceptOwnership from that address)");
  }

  return { treasury, forwarder, factory, implementations };
}

module.exports = { KINDS, deployCore };
