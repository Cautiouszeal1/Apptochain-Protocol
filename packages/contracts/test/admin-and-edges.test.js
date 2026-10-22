// Admin functions and failure paths. Every revert branch should be exercised before an audit.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { setup, deployModule, K } = require("./helpers");

const MEMBERSHIP_T = ["string", "string", "string", "uint256", "uint64", "uint256"];
const ZERO = ethers.ZeroAddress;

describe("Factory admin", () => {
  it("rejects zero addresses, wrong kinds and fee caps at construction and later", async () => {
    const { factory, treasury, admin, other, implementations } = await setup();
    const F = await ethers.getContractFactory("ATCFactory");
    await expect(F.deploy(admin.address, ZERO, 0, 0)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    await expect(F.deploy(admin.address, await treasury.getAddress(), 0, 501)).to.be.revertedWithCustomError(factory, "FeeTooHigh");

    await expect(factory.setTreasury(ZERO)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    await expect(factory.setTreasury(other.address)).to.emit(factory, "TreasurySet").withArgs(other.address);
    expect((await factory.feeConfig())[0]).to.equal(other.address);
    await expect(factory.connect(other).setTreasury(other.address)).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");

    await expect(factory.setImplementation(K("MEMBERSHIP"), ZERO)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    // registering a template under the wrong kind is refused
    await expect(factory.setImplementation(K("ASSETS"), implementations.MEMBERSHIP)).to.be.revertedWithCustomError(factory, "UnknownKind");
    await expect(factory.setImplementation(K("MEMBERSHIP"), implementations.MEMBERSHIP)).to.emit(factory, "ImplementationSet");
    await expect(factory.setFees(5, 500)).to.emit(factory, "FeesUpdated").withArgs(5, 500);
  });

  it("ownership moves only in two steps", async () => {
    const { factory, admin, other } = await setup();
    await factory.transferOwnership(other.address);
    expect(await factory.owner()).to.equal(admin.address);
    await factory.connect(other).acceptOwnership();
    expect(await factory.owner()).to.equal(other.address);
  });
});

describe("Treasury", () => {
  it("spends tokens with a memo, only by the owner", async () => {
    const { treasury, admin, other } = await setup();
    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    await usdc.mint(await treasury.getAddress(), 100n);
    await expect(treasury.connect(other).spendToken(await usdc.getAddress(), other.address, 1, "x")).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
    await expect(treasury.connect(admin).spendToken(await usdc.getAddress(), other.address, 60n, "Grant #1"))
      .to.emit(treasury, "Spent").withArgs(await usdc.getAddress(), other.address, 60n, "Grant #1");
    expect(await usdc.balanceOf(other.address)).to.equal(60n);
    await expect(admin.sendTransaction({ to: await treasury.getAddress(), value: 1n })).to.emit(treasury, "Received");
  });
});

describe("Template edge cases", () => {
  it("templates reject zero owner / factory and bad init", async () => {
    const { factory, appOwner } = await setup();
    const coder = ethers.AbiCoder.defaultAbiCoder();
    await expect(factory.connect(appOwner).deploy(K("PAYMENTS"), coder.encode(["address", "address[]"], [ZERO, []]), "x"))
      .to.be.revertedWithCustomError(await ethers.getContractAt("ATCPayments", ZERO), "ZeroAddress");
  });

  it("membership: admin mint, terms, renew of missing pass, withdraw guards", async () => {
    const { factory, appOwner, user } = await setup({ feeBps: 0 });
    const m = await deployModule(factory, appOwner, "MEMBERSHIP", MEMBERSHIP_T, ["Club", "CLB", "ipfs://c/", 0, 0, 0]);
    await expect(m.connect(user).adminMint(user.address)).to.be.revertedWithCustomError(m, "OwnableUnauthorizedAccount");
    await m.connect(appOwner).adminMint(user.address);
    expect(await m.tokenURI(1)).to.equal("ipfs://c/1");
    await expect(m.connect(appOwner).setTerms(ethers.parseEther("0.1"), 3600)).to.emit(m, "TermsUpdated");
    await expect(m.connect(user).setTerms(0, 0)).to.be.revertedWithCustomError(m, "OwnableUnauthorizedAccount");
    await expect(m.connect(user).renew(99, { value: ethers.parseEther("0.1") })).to.be.revertedWithCustomError(m, "ERC721NonexistentToken");
    await expect(m.connect(user).renew(1, { value: 1n })).to.be.revertedWithCustomError(m, "WrongPayment");
    await expect(m.connect(appOwner).withdraw(ZERO)).to.be.revertedWithCustomError(m, "ZeroAddress");
    await expect(m.connect(appOwner).rescueToken(ZERO, ZERO, 0)).to.be.revertedWithCustomError(m, "ZeroAddress");
    expect(await m.isValid(99)).to.equal(false);
    // setting the base URI before any mint emits no batch refresh
    const fresh = await deployModule(factory, appOwner, "MEMBERSHIP", MEMBERSHIP_T, ["N", "N", "", 0, 0, 0]);
    await expect(fresh.connect(appOwner).setBaseURI("x")).to.emit(fresh, "BaseURISet").and.not.to.emit(fresh, "BatchMetadataUpdate");
  });

  it("assets: price updates, unknown items, payment checks, owner-only", async () => {
    const { factory, appOwner, user } = await setup();
    const a = await deployModule(factory, appOwner, "ASSETS", ["string", "string"], ["Shop", "ipfs://a/{id}"]);
    await expect(a.connect(user).createItem(0, 0)).to.be.revertedWithCustomError(a, "OwnableUnauthorizedAccount");
    await a.connect(appOwner).createItem(ethers.parseEther("0.01"), 0);
    await expect(a.connect(appOwner).setItemPrice(9, 1)).to.be.revertedWithCustomError(a, "UnknownItem");
    await expect(a.connect(appOwner).setItemPrice(1, 0)).to.emit(a, "ItemPriceSet").withArgs(1, 0);
    await a.connect(user).mint(1, 5); // free now, unlimited supply
    expect(await a.balanceOf(user.address, 1)).to.equal(5n);
    await a.connect(appOwner).setItemPrice(1, 10n);
    await expect(a.connect(user).mint(1, 2, { value: 10n })).to.be.revertedWithCustomError(a, "WrongPayment");
    await expect(a.connect(appOwner).adminMint(user.address, 9, 1)).to.be.revertedWithCustomError(a, "UnknownItem");
    await expect(a.connect(user).setURI("x")).to.be.revertedWithCustomError(a, "OwnableUnauthorizedAccount");
  });

  it("rewards: awarders can be added and removed; transferable mode works", async () => {
    const { factory, appOwner, user, other } = await setup();
    const r = await deployModule(factory, appOwner, "REWARDS", ["string", "string", "bool"], ["P", "P", true]);
    expect(await r.decimals()).to.equal(0n);
    await expect(r.connect(user).setAwarder(user.address, true)).to.be.revertedWithCustomError(r, "OwnableUnauthorizedAccount");
    await expect(r.connect(appOwner).setAwarder(other.address, true)).to.emit(r, "AwarderSet").withArgs(other.address, true);
    await r.connect(other).award(user.address, 10, ethers.ZeroHash);
    await r.connect(user).transfer(other.address, 4); // transferable programme
    expect(await r.balanceOf(other.address)).to.equal(4n);
    await r.connect(appOwner).setAwarder(other.address, false);
    await expect(r.connect(other).award(user.address, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(r, "NotAwarder");
    await expect(r.connect(user).redeem(100, ethers.ZeroHash)).to.be.revertedWithCustomError(r, "ERC20InsufficientBalance");
  });

  it("payments: token whitelist, zero amounts, payee changes", async () => {
    const { factory, appOwner, user, other } = await setup({ feeBps: 0 });
    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const p = await deployModule(factory, appOwner, "PAYMENTS", ["address", "address[]"], [other.address, []]);
    await expect(p.connect(user).pay(ethers.id("a"))).to.be.revertedWithCustomError(p, "ZeroAmount");
    await expect(p.connect(user).payToken(await usdc.getAddress(), 1, ethers.id("a"))).to.be.revertedWithCustomError(p, "TokenNotAccepted");
    await expect(p.connect(user).setAcceptedToken(await usdc.getAddress(), true)).to.be.revertedWithCustomError(p, "OwnableUnauthorizedAccount");
    await expect(p.connect(appOwner).setAcceptedToken(await usdc.getAddress(), true)).to.emit(p, "TokenAccepted").withArgs(await usdc.getAddress(), true);
    await expect(p.connect(user).payToken(await usdc.getAddress(), 0, ethers.id("a"))).to.be.revertedWithCustomError(p, "ZeroAmount");
    await expect(p.connect(appOwner).setPayee(ZERO)).to.be.revertedWithCustomError(p, "ZeroAddress");
    await expect(p.connect(appOwner).setPayee(appOwner.address)).to.emit(p, "PayeeSet").withArgs(appOwner.address);
    // fee 0: payee receives the full amount
    await usdc.mint(user.address, 100n);
    await usdc.connect(user).approve(await p.getAddress(), 100n);
    await p.connect(user).payToken(await usdc.getAddress(), 100n, ethers.id("b"));
    expect(await usdc.balanceOf(appOwner.address)).to.equal(100n);
    const before = await ethers.provider.getBalance(appOwner.address);
    await p.connect(user).pay(ethers.id("c"), { value: 7n });
    expect(await ethers.provider.getBalance(appOwner.address) - before).to.equal(7n);
  });
});
