const { expect } = require("chai");
const { ethers } = require("hardhat");
const { setup, deployModule, signForward, K } = require("./helpers");

const MEMBERSHIP_T = ["string", "string", "string", "uint256", "uint64", "uint256"];

describe("ATCFactory", () => {
  it("deploys a module, records the owner and sends the deployment fee to the treasury", async () => {
    const fee = ethers.parseEther("0.01");
    const { factory, treasury, appOwner } = await setup({ deploymentFee: fee });
    const before = await ethers.provider.getBalance(await treasury.getAddress());
    const m = await deployModule(factory, appOwner, "MEMBERSHIP", MEMBERSHIP_T, ["Club", "CLB", "ipfs://x/", 0, 0, 0], fee);
    expect(await m.owner()).to.equal(appOwner.address);
    expect(await factory.isApp(await m.getAddress())).to.equal(true);
    expect(await factory.appsOf(appOwner.address)).to.deep.equal([await m.getAddress()]);
    expect(await ethers.provider.getBalance(await treasury.getAddress()) - before).to.equal(fee);
  });

  it("rejects the wrong fee, unknown kinds and fees above the 5% cap", async () => {
    const { factory, appOwner } = await setup({ deploymentFee: 1n });
    await expect(factory.connect(appOwner).deploy(K("MEMBERSHIP"), "0x", "a")).to.be.revertedWithCustomError(factory, "WrongFee");
    await expect(factory.connect(appOwner).deploy(K("NOPE"), "0x", "a", { value: 1n })).to.be.revertedWithCustomError(factory, "UnknownKind");
    await expect(factory.setFees(0, 501)).to.be.revertedWithCustomError(factory, "FeeTooHigh");
  });

  it("only the owner can change fees or templates", async () => {
    const { factory, other } = await setup();
    await expect(factory.connect(other).setFees(0, 10)).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
  });

  it("templates and clones cannot be re-initialised", async () => {
    const { factory, appOwner, implementations } = await setup();
    const m = await deployModule(factory, appOwner, "MEMBERSHIP", MEMBERSHIP_T, ["A", "A", "", 0, 0, 0]);
    await expect(m.initialize(appOwner.address, appOwner.address, "0x")).to.be.revertedWithCustomError(m, "InvalidInitialization");
    const impl = await ethers.getContractAt("ATCMembership", implementations.MEMBERSHIP);
    await expect(impl.initialize(appOwner.address, appOwner.address, "0x")).to.be.revertedWithCustomError(impl, "InvalidInitialization");
  });
});

describe("Gasless actions via ATCForwarder", () => {
  it("user signs, relayer pays gas, user owns the pass", async () => {
    const { factory, forwarder, appOwner, user, relayer } = await setup();
    const m = await deployModule(factory, appOwner, "MEMBERSHIP", MEMBERSHIP_T, ["Club", "CLB", "", 0, 0, 0]);
    const userBal = await ethers.provider.getBalance(user.address);
    const req = await signForward(forwarder, user, await m.getAddress(), m.interface.encodeFunctionData("mint"));
    expect(await forwarder.verify(req)).to.equal(true);
    await (await forwarder.connect(relayer).execute(req)).wait();
    expect(await m.ownerOf(1)).to.equal(user.address);
    expect(await ethers.provider.getBalance(user.address)).to.equal(userBal); // user spent no gas
  });

  it("rejects replayed and tampered requests", async () => {
    const { factory, forwarder, appOwner, user, relayer } = await setup();
    const m = await deployModule(factory, appOwner, "MEMBERSHIP", MEMBERSHIP_T, ["Club", "CLB", "", 0, 0, 0]);
    const req = await signForward(forwarder, user, await m.getAddress(), m.interface.encodeFunctionData("mint"));
    await forwarder.connect(relayer).execute(req);
    await expect(forwarder.connect(relayer).execute(req)).to.be.reverted; // nonce used
    const req2 = await signForward(forwarder, user, await m.getAddress(), m.interface.encodeFunctionData("mint"));
    const forged = { ...req2, from: relayer.address };
    expect(await forwarder.verify(forged)).to.equal(false);
  });

  it("owner-only actions work gasless when the owner signs", async () => {
    const { factory, forwarder, appOwner, user, relayer } = await setup();
    const r = await deployModule(factory, appOwner, "REWARDS", ["string", "string", "bool"], ["Points", "PTS", false]);
    const data = r.interface.encodeFunctionData("award", [user.address, 50, ethers.id("signup")]);
    await forwarder.connect(relayer).execute(await signForward(forwarder, appOwner, await r.getAddress(), data));
    expect(await r.balanceOf(user.address)).to.equal(50n);
    // a stranger signing the same call is rejected by the template
    const bad = await signForward(forwarder, user, await r.getAddress(), data);
    await expect(forwarder.connect(relayer).execute(bad)).to.be.reverted;
  });
});

describe("ATCMembership", () => {
  it("paid mint splits protocol fee to treasury and sale to the app", async () => {
    const { factory, treasury, appOwner, user } = await setup({ feeBps: 250 });
    const price = ethers.parseEther("1");
    const m = await deployModule(factory, appOwner, "MEMBERSHIP", MEMBERSHIP_T, ["Club", "CLB", "", price, 30 * 86400, 2]);
    await expect(m.connect(user).mint({ value: 1n })).to.be.revertedWithCustomError(m, "WrongPayment");
    const t0 = await ethers.provider.getBalance(await treasury.getAddress());
    await m.connect(user).mint({ value: price });
    expect(await ethers.provider.getBalance(await treasury.getAddress()) - t0).to.equal(ethers.parseEther("0.025"));
    expect(await ethers.provider.getBalance(await m.getAddress())).to.equal(ethers.parseEther("0.975"));
    expect(await m.isValid(1)).to.equal(true);
    await ethers.provider.send("evm_increaseTime", [31 * 86400]);
    await ethers.provider.send("evm_mine");
    expect(await m.isValid(1)).to.equal(false);
    await m.connect(user).renew(1, { value: price });
    expect(await m.isValid(1)).to.equal(true);
    await m.connect(user).mint({ value: price });
    await expect(m.connect(user).mint({ value: price })).to.be.revertedWithCustomError(m, "SoldOut");
    await expect(m.connect(user).withdraw(user.address)).to.be.revertedWithCustomError(m, "OwnableUnauthorizedAccount");
    await m.connect(appOwner).withdraw(appOwner.address);
    expect(await ethers.provider.getBalance(await m.getAddress())).to.equal(0n);
  });
});

describe("Security review fixes (v1.1.0)", () => {
  it("hasPass respects expiry; validUntil reports the best expiry", async () => {
    const { factory, appOwner, user, other } = await setup();
    const m = await deployModule(factory, appOwner, "MEMBERSHIP", MEMBERSHIP_T, ["Club", "CLB", "", 0, 10 * 86400, 0]);
    expect(await m.hasPass(user.address)).to.equal(false);
    expect(await m.validUntil(user.address)).to.equal(0n);
    await m.connect(user).mint();
    expect(await m.hasPass(user.address)).to.equal(true);
    await ethers.provider.send("evm_increaseTime", [11 * 86400]);
    await ethers.provider.send("evm_mine");
    expect(await m.hasPass(user.address)).to.equal(false, "expired pass must not grant access");
    await m.connect(user).renew(1);
    expect(await m.hasPass(user.address)).to.equal(true);
    // transferring the pass moves access with it
    await m.connect(user).transferFrom(user.address, other.address, 1);
    expect(await m.hasPass(user.address)).to.equal(false);
    expect(await m.hasPass(other.address)).to.equal(true);
    // a never-expiring pass reports max
    const forever = await deployModule(factory, appOwner, "MEMBERSHIP", MEMBERSHIP_T, ["Life", "LIFE", "", 0, 0, 0]);
    await forever.connect(user).mint();
    expect(await forever.validUntil(user.address)).to.equal(2n ** 64n - 1n);
  });

  it("supports ERC-721 Enumerable and ERC-4906, emits metadata events", async () => {
    const { factory, appOwner, user } = await setup();
    const m = await deployModule(factory, appOwner, "MEMBERSHIP", MEMBERSHIP_T, ["Club", "CLB", "", 0, 0, 0]);
    expect(await m.supportsInterface("0x780e9d63")).to.equal(true); // ERC721Enumerable
    expect(await m.supportsInterface("0x49064906")).to.equal(true); // ERC-4906
    expect(await m.TEMPLATE_VERSION()).to.equal("1.1.0");
    await m.connect(user).mint();
    await expect(m.connect(appOwner).setBaseURI("ipfs://new/")).to.emit(m, "BaseURISet").and.to.emit(m, "BatchMetadataUpdate").withArgs(1, 1);
    const a = await deployModule(factory, appOwner, "ASSETS", ["string", "string"], ["Shop", "ipfs://a/{id}"]);
    await expect(a.connect(appOwner).setURI("ipfs://b/{id}")).to.emit(a, "URISet");
  });

  it("owner can withdraw with an event and rescue stray tokens; others cannot", async () => {
    const { factory, appOwner, user, other } = await setup({ feeBps: 0 });
    const m = await deployModule(factory, appOwner, "MEMBERSHIP", MEMBERSHIP_T, ["Club", "CLB", "", ethers.parseEther("1"), 0, 0]);
    await m.connect(user).mint({ value: ethers.parseEther("1") });
    await expect(m.connect(appOwner).withdraw(other.address)).to.emit(m, "Withdrawn").withArgs(other.address, ethers.parseEther("1"));
    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    await usdc.mint(await m.getAddress(), 5_000000n);
    await expect(m.connect(user).rescueToken(await usdc.getAddress(), user.address, 1)).to.be.revertedWithCustomError(m, "OwnableUnauthorizedAccount");
    await expect(m.connect(appOwner).rescueToken(await usdc.getAddress(), appOwner.address, 5_000000n)).to.emit(m, "TokenRescued");
    expect(await usdc.balanceOf(appOwner.address)).to.equal(5_000000n);
  });
});

describe("ATCAssets", () => {
  it("creates items, sells within supply, owner airdrops", async () => {
    const { factory, appOwner, user } = await setup({ feeBps: 0 });
    const a = await deployModule(factory, appOwner, "ASSETS", ["string", "string"], ["Sword Shop", "ipfs://items/{id}.json"]);
    await a.connect(appOwner).createItem(ethers.parseEther("0.1"), 3);
    await a.connect(user).mint(1, 2, { value: ethers.parseEther("0.2") });
    expect(await a.balanceOf(user.address, 1)).to.equal(2n);
    await expect(a.connect(user).mint(1, 2, { value: ethers.parseEther("0.2") })).to.be.revertedWithCustomError(a, "ExceedsSupply");
    await expect(a.connect(user).mint(9, 1)).to.be.revertedWithCustomError(a, "UnknownItem");
    await a.connect(appOwner).adminMint(user.address, 1, 1);
    expect(await a.balanceOf(user.address, 1)).to.equal(3n);
  });
});

describe("ATCRewards", () => {
  it("is non-transferable by default and redeemable by burning", async () => {
    const { factory, appOwner, user, other } = await setup();
    const r = await deployModule(factory, appOwner, "REWARDS", ["string", "string", "bool"], ["Points", "PTS", false]);
    await r.connect(appOwner).award(user.address, 100, ethers.id("purchase"));
    await expect(r.connect(user).transfer(other.address, 1)).to.be.revertedWithCustomError(r, "NonTransferable");
    await expect(r.connect(user).redeem(40, ethers.id("free-coffee"))).to.emit(r, "Redeemed");
    expect(await r.balanceOf(user.address)).to.equal(60n);
    await expect(r.connect(other).award(other.address, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(r, "NotAwarder");
  });
});

describe("ATCPayments", () => {
  it("settles ETH orders once with fee split", async () => {
    const { factory, treasury, appOwner, user, other } = await setup({ feeBps: 100 });
    const p = await deployModule(factory, appOwner, "PAYMENTS", ["address", "address[]"], [other.address, []]);
    const order = ethers.id("order-1");
    const payee0 = await ethers.provider.getBalance(other.address);
    const t0 = await ethers.provider.getBalance(await treasury.getAddress());
    await p.connect(user).pay(order, { value: ethers.parseEther("1") });
    expect(await ethers.provider.getBalance(other.address) - payee0).to.equal(ethers.parseEther("0.99"));
    expect(await ethers.provider.getBalance(await treasury.getAddress()) - t0).to.equal(ethers.parseEther("0.01"));
    await expect(p.connect(user).pay(order, { value: 1n })).to.be.revertedWithCustomError(p, "AlreadyPaid");
  });

  it("settles stablecoin orders gaslessly", async () => {
    const { factory, forwarder, treasury, appOwner, user, relayer, other } = await setup({ feeBps: 100 });
    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const p = await deployModule(factory, appOwner, "PAYMENTS", ["address", "address[]"], [other.address, [await usdc.getAddress()]]);
    await usdc.mint(user.address, 100_000000n);
    await usdc.connect(user).approve(await p.getAddress(), ethers.MaxUint256);
    const data = p.interface.encodeFunctionData("payToken", [await usdc.getAddress(), 50_000000n, ethers.id("o-2")]);
    await forwarder.connect(relayer).execute(await signForward(forwarder, user, await p.getAddress(), data));
    expect(await usdc.balanceOf(other.address)).to.equal(49_500000n);
    expect(await usdc.balanceOf(await treasury.getAddress())).to.equal(500000n);
    expect(await p.paid(ethers.id("o-2"))).to.equal(true);
  });
});

describe("ATCTreasury", () => {
  it("only the owner spends, every spend has a memo", async () => {
    const { treasury, admin, other } = await setup();
    await admin.sendTransaction({ to: await treasury.getAddress(), value: ethers.parseEther("1") });
    await expect(treasury.connect(other).spendNative(other.address, 1, "x")).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
    await expect(treasury.spendNative(other.address, ethers.parseEther("0.5"), "Q1 audit deposit"))
      .to.emit(treasury, "Spent").withArgs(ethers.ZeroAddress, other.address, ethers.parseEther("0.5"), "Q1 audit deposit");
  });
});
