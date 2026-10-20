const { ethers } = require("hardhat");
const { deployCore } = require("../scripts/lib");

const coder = ethers.AbiCoder.defaultAbiCoder();
const K = (k) => ethers.id(k);

async function setup({ deploymentFee = 0n, feeBps = 100 } = {}) {
  const [admin, appOwner, user, relayer, other] = await ethers.getSigners();
  const core = await deployCore(ethers, { owner: admin.address, deploymentFee, feeBps });
  return { admin, appOwner, user, relayer, other, ...core };
}

async function deployModule(factory, signer, kind, types, values, fee = 0n) {
  const config = coder.encode(types, values);
  const tx = await factory.connect(signer).deploy(K(kind), config, "test-app", { value: fee });
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "AppDeployed");
  const names = { MEMBERSHIP: "ATCMembership", ASSETS: "ATCAssets", REWARDS: "ATCRewards", PAYMENTS: "ATCPayments" };
  return ethers.getContractAt(names[kind], ev.args.app);
}

/** Sign an ERC-2771 ForwardRequest as `signer` and return the struct the relayer submits. */
async function signForward(forwarder, signer, to, data, { gas = 500000n, ttl = 3600 } = {}) {
  const { chainId } = await ethers.provider.getNetwork();
  const nonce = await forwarder.nonces(signer.address);
  const deadline = (await ethers.provider.getBlock("latest")).timestamp + ttl;
  const req = { from: signer.address, to, value: 0n, gas, nonce, deadline, data };
  const domain = { name: "apptochain", version: "1", chainId, verifyingContract: await forwarder.getAddress() };
  const types = {
    ForwardRequest: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "value", type: "uint256" }, { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" },
      { name: "data", type: "bytes" },
    ],
  };
  const signature = await signer.signTypedData(domain, types, req);
  return { from: req.from, to, value: 0n, gas, deadline, data, signature };
}

module.exports = { setup, deployModule, signForward, coder, K };
