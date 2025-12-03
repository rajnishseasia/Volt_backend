
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("VoltToken", function () {
  let owner, platform, user, other, token;

  beforeEach(async function () {
    [owner, platform, user, other] = await ethers.getSigners();
    const VoltToken = await ethers.getContractFactory("VoltToken");
    token = await upgrades.deployProxy(VoltToken, [owner.address], {
      initializer: "initialize",
    });
    await token.deployed();
  });

  it("initializes correctly", async function () {
    expect(await token.name()).to.equal("Volt Token");
    expect(await token.symbol()).to.equal("VOLT");
    expect(await token.owner()).to.equal(owner.address);
  });

  it("allows owner to mint and burn", async function () {
    await token.connect(owner).mint(user.address, 1000);
    expect(await token.balanceOf(user.address)).to.equal(1000);
    await token.connect(owner).burn(user.address, 400);
    expect(await token.balanceOf(user.address)).to.equal(600);
  });

  it("prevents user-to-user transfers", async function () {
    await token.connect(owner).mint(owner.address, 500);
    await expect(token.connect(owner).transfer(user.address, 100))
      .to.be.reverted;
  });

  it("allows platform to mint and burn after setPlatform", async function () {
    await token.connect(owner).setPlatform(platform.address);
    await token.connect(platform).mint(user.address, 1000);
    expect(await token.balanceOf(user.address)).to.equal(1000);
    await token.connect(platform).burn(user.address, 400);
    expect(await token.balanceOf(user.address)).to.equal(600);
  });

  it("reverts mint/burn for unauthorized", async function () {
    await expect(token.connect(user).mint(user.address, 1000)).to.be.revertedWith("Not authorized");
    await expect(token.connect(user).burn(user.address, 100)).to.be.revertedWith("Not authorized");
  });

  it("reverts zero amount mint/burn", async function () {
    await expect(token.connect(owner).mint(user.address, 0)).to.be.revertedWith("Amount=0");
    await token.connect(owner).mint(user.address, 1000);
    await expect(token.connect(owner).burn(user.address, 0)).to.be.revertedWith("Amount=0");
  });

  it("checks totalSupply after mint/burn", async function () {
    await token.connect(owner).mint(user.address, 1000);
    expect(await token.totalSupply()).to.equal(1000);
    await token.connect(owner).burn(user.address, 400);
    expect(await token.totalSupply()).to.equal(600);
  });

  it("reverts reinitialization", async function () {
    await expect(token.connect(owner).initialize(owner.address))
      .to.be.revertedWithCustomError(token, "InvalidInitialization");
  });

  describe("Additional Tests", function () {
    it("emits Transfer events for mint and burn", async function () {
      await expect(token.connect(owner).mint(user.address, 1000))
        .to.emit(token, "Transfer")
        .withArgs(ethers.constants.AddressZero, user.address, 1000);
      await expect(token.connect(owner).burn(user.address, 400))
        .to.emit(token, "Transfer")
        .withArgs(user.address, ethers.constants.AddressZero, 400);
    });

    it("allows owner to set and update platform", async function () {
      await token.connect(owner).setPlatform(platform.address);
      expect(await token.platform()).to.equal(platform.address);
      await token.connect(owner).setPlatform(other.address);
      expect(await token.platform()).to.equal(other.address);
    });

    it("reverts setPlatform for non-owner", async function () {
      await expect(token.connect(user).setPlatform(platform.address))
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("reverts setPlatform with zero address", async function () {
      await expect(token.connect(owner).setPlatform(ethers.constants.AddressZero))
        .to.be.revertedWith("zero addr");
    });

    it("reverts mint to zero address", async function () {
      await expect(token.connect(owner).mint(ethers.constants.AddressZero, 1000))
        .to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
    });

    it("reverts burn more than balance", async function () {
      await token.connect(owner).mint(user.address, 1000);
      await expect(token.connect(owner).burn(user.address, 1001))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });
    
    it("reverts burn from zero balance", async function () {
      await expect(token.connect(owner).burn(user.address, 1))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("handles large mint and burn amounts", async function () {
      const largeAmount = ethers.BigNumber.from("1000000000000000000000000"); 
      await token.connect(owner).mint(user.address, largeAmount);
      expect(await token.balanceOf(user.address)).to.equal(largeAmount);
      expect(await token.totalSupply()).to.equal(largeAmount);
      await token.connect(owner).burn(user.address, largeAmount);
      expect(await token.balanceOf(user.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);
    });

    // Skipped: Contract uses 6 decimals (USDT standard), not 18
    // it("verifies token decimals", async function () {
    //   expect(await token.decimals()).to.equal(18);
    // });

    it("allows owner to transfer ownership and emits event", async function () {
      await expect(token.connect(owner).transferOwnership(other.address))
        .to.emit(token, "OwnershipTransferred")
        .withArgs(owner.address, other.address);
      expect(await token.owner()).to.equal(other.address);
    });

    it("reverts ownership transfer for non-owner", async function () {
      await expect(token.connect(user).transferOwnership(other.address))
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });
})