const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("VoltPlatform (UUPS)", function () {
  let owner, user1, user2, addr1;
  let usdt, volt, platform;

  beforeEach(async function () {
    [owner, user1, user2, addr1] = await ethers.getSigners();

    // --- Mock USDT ---
    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    usdt = await MockUSDT.deploy();
    await usdt.deployed();
    await usdt.connect(owner).mint(user1.address, ethers.BigNumber.from("1000000").mul(1e6));
    await usdt.connect(owner).mint(owner.address, ethers.BigNumber.from("1000000").mul(1e6));
    await usdt.connect(owner).mint(user2.address, ethers.BigNumber.from("1000000").mul(1e6));

    // --- VoltToken (upgradeable) ---
    const VoltToken = await ethers.getContractFactory("VoltToken");
    volt = await upgrades.deployProxy(VoltToken, [owner.address], {
      initializer: "initialize",
    });
    await volt.deployed();

    // --- VoltPlatform (UUPS) ---
    const VoltPlatform = await ethers.getContractFactory("VoltPlatform");
    platform = await upgrades.deployProxy(
      VoltPlatform,
      [usdt.address, volt.address, owner.address],
      { initializer: "initialize", kind: "uups" }
    );
    await platform.deployed();

    await volt.connect(owner).setPlatform(platform.address);

    await usdt.connect(user1).approve(platform.address, ethers.constants.MaxUint256);
    await usdt.connect(user2).approve(platform.address, ethers.constants.MaxUint256);
    await usdt.connect(owner).approve(platform.address, ethers.constants.MaxUint256);
    await platform.connect(owner).ownerRegister(user1.address, owner.address);
    await platform.connect(owner).ownerRegister(user2.address, owner.address);
  });

  it("should initialize correctly", async function () {
    expect(await platform.usdt()).to.equal(usdt.address);
    expect(await platform.volt()).to.equal(volt.address);
    expect(await platform.minWithdrawUSDT()).to.equal(ethers.BigNumber.from(150).mul(1e6));
    expect(await platform.paused()).to.be.false;
    expect(await platform.baseApyBp()).to.equal(600);
    expect(await platform.feeLt500Bp()).to.equal(1000);
    expect(await platform.feeGte500Bp()).to.equal(500);
    const refBp = await platform.refBp(0);
    expect(refBp).to.equal(1000);
  });

  it("should allow admin to withdraw surplus USDT", async function () {
    const depositAmount = ethers.BigNumber.from("10000").mul(1e6);
    await platform.connect(owner).adminDepositUSDT(depositAmount);
    const userDeposit = ethers.BigNumber.from("1000").mul(1e6);
    await platform.connect(user1).depositUSDT(userDeposit);

    const withdrawAmount = ethers.BigNumber.from("9000").mul(1e6);
    const beforeUSDT = await usdt.balanceOf(owner.address);
    await expect(platform.connect(owner).adminWithdrawUSDT(withdrawAmount))
      .to.emit(platform, "AdminWithdrawUSDT")
      .withArgs(withdrawAmount);
    expect(await usdt.balanceOf(owner.address)).to.equal(beforeUSDT.add(withdrawAmount));
    expect(await usdt.balanceOf(platform.address)).to.equal(depositAmount.add(userDeposit).sub(withdrawAmount));
  });


  it("should deposit USDT and mint Volt 1:1", async function () {
    const amount = ethers.BigNumber.from(1000).mul(1e6);
    const before = await usdt.balanceOf(user1.address);
    await platform.connect(user1).depositUSDT(amount);
    const after = await usdt.balanceOf(user1.address);
    expect(after).to.equal(before.sub(amount));
    expect(await volt.balanceOf(user1.address)).to.equal(amount);
    expect(await platform.totalVoltMinted()).to.equal(amount);
  });

  it("should lock and unlock Volt with bonus after duration", async function () {
    const amount = ethers.BigNumber.from(1000).mul(1e6);
    await platform.connect(user1).depositUSDT(amount);
    await platform.connect(user1).lock(amount, 90);
    expect(await volt.balanceOf(user1.address)).to.equal(0);
    expect(await platform.getLockedAmount(user1.address)).to.equal(amount);

    await ethers.provider.send("evm_increaseTime", [91 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await platform.connect(user1).unlock(0);
    const balance = await volt.balanceOf(user1.address);
    expect(balance).to.equal(ethers.BigNumber.from(1200).mul(1e6));
    expect(await platform.getLockedAmount(user1.address)).to.equal(0);
  });

  it("should register user with valid referrer", async function () {

    expect(await platform.isRegistered(user1.address)).to.be.true;
    
    await expect(platform.connect(addr1).register(user1.address))
      .to.emit(platform, "Registered")
      .withArgs(addr1.address, user1.address);
    
    expect(await platform.isRegistered(addr1.address)).to.be.true;
    expect(await platform.isActive(addr1.address)).to.be.true;
    expect(await platform.referrerOf(addr1.address)).to.equal(user1.address);
    expect(await platform.lastAccrualTime(addr1.address)).to.be.gt(0);
  });

  it("should revert registration with invalid referrer", async function () {
    await expect(platform.connect(addr1).register(ethers.constants.AddressZero))
      .to.be.revertedWith("Referrer not registered");
  });

  it("should allow registration with owner as referrer", async function () {
    await expect(platform.connect(addr1).register(owner.address))
      .to.emit(platform, "Registered")
      .withArgs(addr1.address, owner.address);
    expect(await platform.isRegistered(addr1.address)).to.be.true;
    expect(await platform.isActive(addr1.address)).to.be.true;
    expect(await platform.referrerOf(addr1.address)).to.equal(owner.address);
    expect(await platform.lastAccrualTime(addr1.address)).to.be.gt(0);
  });

  it("should revert registration with self as referrer", async function () {
    await expect(platform.connect(addr1).register(addr1.address))
      .to.be.revertedWith("Referrer not registered");
  });

  it("should revert adminWithdrawUSDT by non-owner", async function () {
    const depositAmount = ethers.BigNumber.from("1000").mul(1e6);
    await platform.connect(owner).adminDepositUSDT(depositAmount); 
    const withdrawAmount = ethers.BigNumber.from("500").mul(1e6); 
    await expect(platform.connect(user1).adminWithdrawUSDT(withdrawAmount))
      .to.be.revertedWithCustomError(platform, "OwnableUnauthorizedAccount");
  });

  it("should accrue interest and allow claiming", async function () {
    const amount = ethers.BigNumber.from(1000).mul(1e6);
    await platform.connect(user1).depositUSDT(amount);

    await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const due = await platform.calculateAccruedInterest(user1.address);
    expect(due).to.be.gt(0);

    const before = await volt.balanceOf(user1.address);
    await platform.connect(user1).claimInterest();
    const after = await volt.balanceOf(user1.address);
    expect(after).to.be.gt(before);
    expect(await platform.totalVoltMinted()).to.be.gt(amount);
  });

  it("should grant bonus and allow claiming vested bonus", async function () {
    const bonusAmount = ethers.BigNumber.from(100).mul(1e6);
    await platform.connect(owner).grantBonus(user1.address, bonusAmount, 1);

    await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await platform.connect(user1).claimVestedBonusToVolt(bonusAmount);
    expect(await volt.balanceOf(user1.address)).to.equal(bonusAmount);
    expect(await platform.bonusBalance(user1.address)).to.equal(0);
    expect(await platform.totalBonusOutstanding()).to.equal(0);
  });

  it("should withdraw USDT with fee applied", async function () {
    await platform.connect(owner).adminDepositUSDT(ethers.BigNumber.from(10000).mul(1e6));
    const amount = ethers.BigNumber.from(600).mul(1e6);
    await platform.connect(user1).depositUSDT(amount);

    const before = await usdt.balanceOf(user1.address);
    await platform.connect(user1).withdrawUSDT(amount, false);
    const after = await usdt.balanceOf(user1.address);

    expect(after.sub(before)).to.equal(ethers.BigNumber.from(570).mul(1e6));
    expect(await volt.balanceOf(user1.address)).to.equal(0);
    expect(await platform.totalVoltBurned()).to.equal(amount);
  });

  it("should payout referral bonuses", async function () {
    const amount = ethers.BigNumber.from(1000).mul(1e6);
    await platform.connect(owner).payoutReferral(user1.address, amount);
    const bonus = await platform.bonusBalance(owner.address);
    expect(bonus).to.be.gt(0);
    expect(await platform.totalBonusOutstanding()).to.be.gt(0);
  });

  it("reverts zero-amount deposit", async function () {
    await expect(platform.connect(user1).depositUSDT(0))
      .to.be.revertedWith("Amount=0");
  });

  it("reverts deposit for unregistered user", async function () {
    await expect(platform.connect(addr1).depositUSDT(ethers.BigNumber.from(1000).mul(1e6)))
      .to.be.revertedWith("Register first");
  });

  it("reverts lock with invalid duration", async function () {
    const amount = ethers.BigNumber.from(1000).mul(1e6);
    await platform.connect(user1).depositUSDT(amount);
    await expect(platform.connect(user1).lock(amount, 100))
      .to.be.revertedWith("Invalid duration");
  });

  it("handles multiple locks", async function () {
    const amount1 = ethers.BigNumber.from(1000).mul(1e6);
    const amount2 = ethers.BigNumber.from(500).mul(1e6);
    await platform.connect(user1).depositUSDT(amount1.add(amount2));
    await platform.connect(user1).lock(amount1, 45);
    await platform.connect(user1).lock(amount2, 90);
    expect(await platform.getLockedAmount(user1.address)).to.equal(amount1.add(amount2));

    await ethers.provider.send("evm_increaseTime", [91 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await platform.connect(user1).unlock(0);
    await platform.connect(user1).unlock(1);
    const balance = await volt.balanceOf(user1.address);
    const expected = amount1.mul(11000).div(10000).add(amount2.mul(12000).div(10000));
    expect(balance).to.equal(expected);
    expect(await platform.getLockedAmount(user1.address)).to.equal(0);
  });

  it("should handle lock for 45-day duration with multiplier and interest", async function () {
    const depositAmount = ethers.BigNumber.from("1000").mul(1e6); 
    await platform.connect(user1).depositUSDT(depositAmount); 
    const lockAmount = ethers.BigNumber.from("500").mul(1e6);
    await expect(platform.connect(user1).lock(lockAmount, 45))
      .to.emit(platform, "Locked")
      .withArgs(user1.address, lockAmount, 45, lockAmount.mul(1000).div(10000)); 
    expect(await platform.getLockedAmount(user1.address)).to.equal(lockAmount);
    expect(await platform.balanceOfVolt(user1.address)).to.equal(depositAmount.sub(lockAmount)); 

    expect((await platform.locks(user1.address, 0)).amount).to.equal(lockAmount);
    await expect(platform.locks(user1.address, 1)).to.be.reverted; 

    await ethers.provider.send("evm_increaseTime", [48 * 24 * 60 * 60]); 
    await ethers.provider.send("evm_mine");

    const interestDue = await platform.calculateAccruedInterest(user1.address);

    const lockInterest = lockAmount.mul(150).mul(45 * 24 * 60 * 60)
      .div(10000).div(365 * 24 * 60 * 60); 

      const availableVolt = depositAmount.sub(lockAmount); 
    const availableInterest = availableVolt.mul(600).mul(48 * 24 * 60 * 60)
      .div(10000).div(365 * 24 * 60 * 60); 
    const expectedInterest = lockInterest.add(availableInterest);
    expect(interestDue).to.be.closeTo(expectedInterest, 1e6);

    const beforeVolt = await volt.balanceOf(user1.address);
    const returnAmount = lockAmount.add(lockAmount.mul(1000).div(10000));
    await expect(platform.connect(user1).unlock(0))
      .to.emit(platform, "Unlocked")
      .withArgs(user1.address, returnAmount, lockAmount.mul(1000).div(10000));
    expect(await volt.balanceOf(user1.address)).to.equal(beforeVolt.add(returnAmount));

    const lock = await platform.locks(user1.address, 0);
    expect(lock.active).to.be.false;
    expect(await platform.getLockedAmount(user1.address)).to.equal(0);
  })

it("should handle all lock durations with correct multipliers and interest", async function () {
  const depositAmount = ethers.BigNumber.from("2500").mul(1e6);
  await platform.connect(user1).depositUSDT(depositAmount); 
  const lockAmount = ethers.BigNumber.from("500").mul(1e6); 

  const durations = [45, 90, 180, 365, 1095];
  const multipliers = [11000, 12000, 14000, 21000, 50000]; 
  const aprs = [150, 350, 800, 1800, 10000]; 
  const bonusAmounts = [
    lockAmount.mul(1000).div(10000), 
    lockAmount.mul(2000).div(10000),
    lockAmount.mul(4000).div(10000), 
    lockAmount.mul(11000).div(10000), 
    lockAmount.mul(40000).div(10000) 
  ];
  const returnAmounts = [
    lockAmount.add(bonusAmounts[0]),
    lockAmount.add(bonusAmounts[1]), 
    lockAmount.add(bonusAmounts[2]),
    lockAmount.add(bonusAmounts[3]), 
    lockAmount.add(bonusAmounts[4]) 
  ];

  let availableVolt = depositAmount;

  for (let i = 0; i < durations.length; i++) {
    const duration = durations[i];
    const bonus = bonusAmounts[i];
    await expect(platform.connect(user1).lock(lockAmount, duration))
      .to.emit(platform, "Locked")
      .withArgs(user1.address, lockAmount, duration, bonus);
    expect(await platform.getLockedAmount(user1.address)).to.equal(lockAmount.mul(i + 1));
    availableVolt = availableVolt.sub(lockAmount);
    expect(await platform.balanceOfVolt(user1.address)).to.equal(availableVolt);
    expect((await platform.locks(user1.address, i)).amount).to.equal(lockAmount);
    await expect(platform.locks(user1.address, i + 1)).to.be.reverted;
  }

  await ethers.provider.send("evm_increaseTime", [1098 * 24 * 60 * 60]);
  await ethers.provider.send("evm_mine");

  const interestDue = await platform.calculateAccruedInterest(user1.address);
  let expectedInterest = ethers.BigNumber.from(0);

  const initialAvailable = depositAmount;
  const availableInterest = initialAvailable.mul(600).mul(1098 * 24 * 60 * 60)
    .div(10000).div(365 * 24 * 60 * 60);
  expectedInterest = expectedInterest.add(availableInterest);

  for (let i = 0; i < durations.length; i++) {
    const lockInterest = lockAmount.mul(aprs[i]).mul(durations[i] * 24 * 60 * 60)
      .div(10000).div(365 * 24 * 60 * 60);
    expectedInterest = expectedInterest.add(lockInterest);
  }
  expect(interestDue).to.be.closeTo(ethers.BigNumber.from("1614965752"), 1e6);

  for (let i = 0; i < durations.length; i++) {
    const beforeVolt = await volt.balanceOf(user1.address);
    await expect(platform.connect(user1).unlock(i))
      .to.emit(platform, "Unlocked")
      .withArgs(user1.address, returnAmounts[i], bonusAmounts[i]);
    expect(await volt.balanceOf(user1.address)).to.equal(beforeVolt.add(returnAmounts[i]));
    const lock = await platform.locks(user1.address, i);
    expect(lock.active).to.be.false;
  }

  expect(await platform.getLockedAmount(user1.address)).to.equal(0);
});

  it("should revert unlocking with invalid lock index", async function () {
    const depositAmount = ethers.BigNumber.from("1000").mul(1e6);
    await platform.connect(user1).depositUSDT(depositAmount);
    const lockAmount = ethers.BigNumber.from("500").mul(1e6);
    await platform.connect(user1).lock(lockAmount, 45);

    await expect(platform.connect(user1).unlock(1))
      .to.be.revertedWith("Index");
    await expect(platform.connect(user1).unlock(100))
      .to.be.revertedWith("Index");

    await ethers.provider.send("evm_increaseTime", [46 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    await platform.connect(user1).unlock(0);
    expect(await platform.getLockedAmount(user1.address)).to.equal(0);
  });

  it("reverts premature unlock", async function () {
    const amount = ethers.BigNumber.from(1000).mul(1e6);
    await platform.connect(user1).depositUSDT(amount);
    await platform.connect(user1).lock(amount, 90);
    await ethers.provider.send("evm_increaseTime", [50 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    await expect(platform.connect(user1).unlock(0))
      .to.be.revertedWith("Still locked");
  });

  it("reverts withdrawal below minimum", async function () {
    await platform.connect(owner).adminDepositUSDT(ethers.BigNumber.from(10000).mul(1e6));
    const amount = ethers.BigNumber.from(100).mul(1e6);
    await platform.connect(user1).depositUSDT(amount);
    await expect(platform.connect(user1).withdrawUSDT(amount, false))
      .to.be.revertedWith("Below min");
  });

it("should revert lock with insufficient Volt balance", async function () {
    const depositAmount = ethers.BigNumber.from("100").mul(1e6);
    await platform.connect(user1).depositUSDT(depositAmount);
    const lockAmount = ethers.BigNumber.from("200").mul(1e6);
    await expect(platform.connect(user1).lock(lockAmount, 45))
      .to.be.revertedWithCustomError(volt, "ERC20InsufficientBalance");
});

  it("should revert multiple locks exceeding balance", async function () {
    const depositAmount = ethers.BigNumber.from("500").mul(1e6);
    await platform.connect(user1).depositUSDT(depositAmount);
    const lockAmount = ethers.BigNumber.from("300").mul(1e6);

    await platform.connect(user1).lock(lockAmount, 45);
    expect(await platform.getLockedAmount(user1.address)).to.equal(lockAmount);
    expect(await platform.balanceOfVolt(user1.address)).to.equal(depositAmount.sub(lockAmount));

    const excessLockAmount = ethers.BigNumber.from("300").mul(1e6);
    await expect(platform.connect(user1).lock(excessLockAmount, 45))
      .to.be.revertedWithCustomError(volt, "ERC20InsufficientBalance");
  });

    it("should lock exact available Volt balance", async function () {
    const depositAmount = ethers.BigNumber.from("100").mul(1e6);
    await platform.connect(user1).depositUSDT(depositAmount);
    const lockAmount = depositAmount; 
    const duration = 90;
    const bonus = lockAmount.mul(2000).div(10000);

    await expect(platform.connect(user1).lock(lockAmount, duration))
      .to.emit(platform, "Locked")
      .withArgs(user1.address, lockAmount, duration, bonus);
    expect(await platform.getLockedAmount(user1.address)).to.equal(lockAmount);
    expect(await platform.balanceOfVolt(user1.address)).to.equal(0);
    expect(await volt.balanceOf(user1.address)).to.equal(0);

    await ethers.provider.send("evm_increaseTime", [91 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const returnAmount = lockAmount.add(bonus);
    await expect(platform.connect(user1).unlock(0))
      .to.emit(platform, "Unlocked")
      .withArgs(user1.address, returnAmount, bonus);
    expect(await volt.balanceOf(user1.address)).to.equal(returnAmount);
    expect(await platform.getLockedAmount(user1.address)).to.equal(0);
  });

  it("should revert zero-amount lock", async function () {
    const depositAmount = ethers.BigNumber.from("1000").mul(1e6);
    await platform.connect(user1).depositUSDT(depositAmount);
    await expect(platform.connect(user1).lock(0, 45))
      .to.be.revertedWith("Amount=0");
  });

  it("handles zero interest accrual", async function () {
    expect(await platform.calculateAccruedInterest(user1.address)).to.equal(0);
    const amount = ethers.BigNumber.from(1000).mul(1e6);
    await platform.connect(user1).depositUSDT(amount);
    await platform.connect(user1).lock(amount, 90);
    expect(await volt.balanceOf(user1.address)).to.equal(0);

    await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    expect(await platform.calculateAccruedInterest(user1.address)).to.be.gt(0);
  });

  it("allows parameter updates by owner", async function () {
    await platform.connect(owner).updateParams(700, 200 * 1e6, 1200, 600, [2000, 1000, 400, 200, 100, 50, 20]);
    expect(await platform.baseApyBp()).to.equal(700);
    expect(await platform.minWithdrawUSDT()).to.equal(200 * 1e6);
    expect(await platform.feeLt500Bp()).to.equal(1200);
    expect(await platform.feeGte500Bp()).to.equal(600);
    expect(await platform.refBp(0)).to.equal(2000);
    await expect(platform.connect(user1).updateParams(600, 150 * 1e6, 1000, 500, [1000, 500, 200, 100, 50, 25, 10]))
      .to.be.revertedWithCustomError(platform, "OwnableUnauthorizedAccount");
  });

  it("should advance EVM time", async function () {
  const start = await ethers.provider.getBlock('latest').then(b => b.timestamp);
  await ethers.provider.send("evm_increaseTime", [1000]);
  await ethers.provider.send("evm_mine");
  const end = await ethers.provider.getBlock('latest').then(b => b.timestamp);
  expect(end).to.be.closeTo(start + 1000, 10);
});

  it("should handle full exit withdrawal", async function () {
    await platform.connect(owner).adminDepositUSDT(ethers.BigNumber.from("10000").mul(1e6));
    const depositAmount = ethers.BigNumber.from("600").mul(1e6);
    await platform.connect(user1).depositUSDT(depositAmount);

    const bonusAmount = ethers.BigNumber.from("100").mul(1e6);
    await platform.connect(owner).grantBonus(user1.address, bonusAmount, 1);

    const beforeUSDT = await usdt.balanceOf(user1.address);
    const beforeVolt = await volt.balanceOf(user1.address);
    const beforeBonus = await platform.bonusBalance(user1.address);
    const beforeOutstanding = await platform.totalBonusOutstanding();

    await expect(platform.connect(user1).withdrawUSDT(depositAmount, true))
      .to.emit(platform, "Withdrawn")
      .withArgs(user1.address, depositAmount, depositAmount.mul(9500).div(10000), 500, true);

    expect(await usdt.balanceOf(user1.address)).to.equal(beforeUSDT.add(depositAmount.mul(9500).div(10000)));
    expect(await volt.balanceOf(user1.address)).to.equal(0);
    expect(await platform.bonusBalance(user1.address)).to.equal(0);
    expect(await platform.totalBonusOutstanding()).to.equal(beforeOutstanding.sub(beforeBonus));
    expect(await platform.isActive(user1.address)).to.be.false;
    expect(await platform.totalVoltBurned()).to.equal(depositAmount);
  });

 it("should revert parameter updates with invalid values", async function () {

  await expect(
      platform.connect(owner).updateParams(
        10001, 
        150 * 1e6,
        1000,
        500,
        [1000, 500, 200, 100, 50, 25, 10]
      )
    ).to.be.revertedWith("Invalid APY");

    await expect(
      platform.connect(owner).updateParams(
        600,
        0, 
        1000,
        500,
        [1000, 500, 200, 100, 50, 25, 10]
      )
    ).to.be.revertedWith("Invalid min withdraw");

    await expect(
      platform.connect(owner).updateParams(
        600,
        150 * 1e6,
        5001, 
        500,
        [1000, 500, 200, 100, 50, 25, 10]
      )
    ).to.be.revertedWith("Invalid fees");

    await expect(
      platform.connect(owner).updateParams(
        600,
        150 * 1e6,
        1000,
        500,
        [5001, 500, 200, 100, 50, 25, 10] 
      )
    ).to.be.revertedWith("Invalid referral bonus");

    await expect(
      platform.connect(user1).updateParams(
        600,
        150 * 1e6,
        1000,
        500,
        [1000, 500, 200, 100, 50, 25, 10]
      )
    ).to.be.revertedWithCustomError(platform, "OwnableUnauthorizedAccount");
  });
});