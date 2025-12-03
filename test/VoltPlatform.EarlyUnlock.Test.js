const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const ONE_USDT = ethers.BigNumber.from("1000000");
const ONE_DAY = 86400;
const BP = 10000;
const YEAR_DAYS = 365;

describe("VoltPlatform - Early Unlock Testing (Time Check Removed)", function () {
  let owner, user1, user2, user3;
  let usdt, volt, platform;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy MockUSDT
    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    usdt = await MockUSDT.deploy();
    await usdt.deployed();

    // Mint USDT to users
    await usdt.connect(owner).mint(owner.address, ethers.BigNumber.from("10000000").mul(ONE_USDT));
    await usdt.connect(owner).mint(user1.address, ethers.BigNumber.from("10000000").mul(ONE_USDT));
    await usdt.connect(owner).mint(user2.address, ethers.BigNumber.from("10000000").mul(ONE_USDT));
    await usdt.connect(owner).mint(user3.address, ethers.BigNumber.from("10000000").mul(ONE_USDT));

    // Deploy VoltToken
    const VoltToken = await ethers.getContractFactory("VoltToken");
    volt = await upgrades.deployProxy(VoltToken, [owner.address], {
      initializer: "initialize",
    });
    await volt.deployed();

    // Deploy VoltPlatform
    const VoltPlatform = await ethers.getContractFactory("VoltPlatform");
    platform = await upgrades.deployProxy(
      VoltPlatform,
      [usdt.address, volt.address, owner.address],
      { initializer: "initialize", kind: "uups" }
    );
    await platform.deployed();

    await volt.connect(owner).setPlatform(platform.address);

    await usdt.connect(owner).approve(platform.address, ethers.constants.MaxUint256);
    await usdt.connect(user1).approve(platform.address, ethers.constants.MaxUint256);
    await usdt.connect(user2).approve(platform.address, ethers.constants.MaxUint256);
    await usdt.connect(user3).approve(platform.address, ethers.constants.MaxUint256);

    // Whitelist users
    await platform.connect(owner).addToWhitelistWithReferral(
      [user1.address, user2.address, user3.address],
      [owner.address, owner.address, owner.address]
    );

    // Give user1 some VOLT to lock
    await platform.connect(user1).depositUSDT(ethers.BigNumber.from(10000).mul(ONE_USDT));
  });

  describe("Immediate Unlock Tests (No Time Wait)", function () {
    
    it("Should allow immediate unlock after locking (45 days lock)", async function () {
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      const beforeBalance = await volt.balanceOf(user1.address);

      // Lock tokens
      await expect(platform.connect(user1).lock(lockAmount, 45))
        .to.emit(platform, "Locked");

      expect(await volt.balanceOf(user1.address)).to.equal(beforeBalance.sub(lockAmount));
      expect(await platform.getLockedAmount(user1.address)).to.equal(lockAmount);

      // Immediately unlock (no time increase)
      await expect(platform.connect(user1).unlock(0))
        .to.emit(platform, "Unlocked");

      // Verify lock is no longer active
      expect(await platform.getLockedAmount(user1.address)).to.equal(0);
      
      // Verify user received tokens back
      const afterBalance = await volt.balanceOf(user1.address);
      expect(afterBalance).to.be.gt(beforeBalance); // Should have more due to bonus
    });

    it("Should allow immediate unlock after locking (90 days lock)", async function () {
      const lockAmount = ethers.BigNumber.from(2000).mul(ONE_USDT);
      
      await platform.connect(user1).lock(lockAmount, 90);
      
      // Unlock immediately
      const beforeUnlock = await volt.balanceOf(user1.address);
      await platform.connect(user1).unlock(0);
      const afterUnlock = await volt.balanceOf(user1.address);

      // Should receive: original + bonus (20% for 90 days) + interest
      const received = afterUnlock.sub(beforeUnlock);
      const expectedBonus = lockAmount.mul(2000).div(BP); // 20% bonus
      
      expect(received).to.be.gte(lockAmount.add(expectedBonus));
    });

    it("Should allow immediate unlock after locking (180 days lock)", async function () {
      const lockAmount = ethers.BigNumber.from(1500).mul(ONE_USDT);
      
      await platform.connect(user1).lock(lockAmount, 180);
      
      const beforeUnlock = await volt.balanceOf(user1.address);
      await platform.connect(user1).unlock(0);
      const afterUnlock = await volt.balanceOf(user1.address);

      const received = afterUnlock.sub(beforeUnlock);
      const expectedBonus = lockAmount.mul(4000).div(BP); // 40% bonus for 180 days
      
      expect(received).to.be.gte(lockAmount.add(expectedBonus));
    });

    it("Should allow immediate unlock after locking (365 days lock)", async function () {
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      
      await platform.connect(user1).lock(lockAmount, 365);
      
      const beforeUnlock = await volt.balanceOf(user1.address);
      await platform.connect(user1).unlock(0);
      const afterUnlock = await volt.balanceOf(user1.address);

      const received = afterUnlock.sub(beforeUnlock);
      const expectedBonus = lockAmount.mul(11000).div(BP); // 110% bonus for 365 days
      
      expect(received).to.be.gte(lockAmount.add(expectedBonus));
    });

    it("Should allow immediate unlock after locking (1095 days / 3 years lock)", async function () {
      const lockAmount = ethers.BigNumber.from(500).mul(ONE_USDT);
      
      await platform.connect(user1).lock(lockAmount, 1095);
      
      const beforeUnlock = await volt.balanceOf(user1.address);
      await platform.connect(user1).unlock(0);
      const afterUnlock = await volt.balanceOf(user1.address);

      const received = afterUnlock.sub(beforeUnlock);
      const expectedBonus = lockAmount.mul(40000).div(BP); // 400% bonus for 1095 days
      
      expect(received).to.be.gte(lockAmount.add(expectedBonus));
    });

    it("Should allow unlock 1 second after locking", async function () {
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      
      await platform.connect(user1).lock(lockAmount, 90);
      
      // Wait just 1 second
      await time.increase(1);
      
      // Should be able to unlock
      await expect(platform.connect(user1).unlock(0))
        .to.emit(platform, "Unlocked");
    });

    it("Should allow unlock 1 day after locking", async function () {
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      
      await platform.connect(user1).lock(lockAmount, 365);
      
      // Wait 1 day (instead of 365 days)
      await time.increase(ONE_DAY);
      
      // Should be able to unlock
      await expect(platform.connect(user1).unlock(0))
        .to.emit(platform, "Unlocked");
    });
  });

  describe("Bonus and Interest Calculations on Early Unlock", function () {
    
    it("Should calculate correct bonus for 45-day lock unlocked immediately", async function () {
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      const expectedMultiplier = 11000; // 110% = 10% bonus
      const expectedBonus = lockAmount.mul(expectedMultiplier - BP).div(BP);
      
      await platform.connect(user1).lock(lockAmount, 45);
      
      const beforeBalance = await volt.balanceOf(user1.address);
      await platform.connect(user1).unlock(0);
      const afterBalance = await volt.balanceOf(user1.address);
      
      const received = afterBalance.sub(beforeBalance);
      
      // Should receive at least original + bonus
      expect(received).to.be.gte(lockAmount.add(expectedBonus));
      
      console.log(`Locked: ${lockAmount.div(ONE_USDT)} USDT`);
      console.log(`Expected Bonus: ${expectedBonus.div(ONE_USDT)} USDT`);
      console.log(`Received Total: ${received.div(ONE_USDT)} USDT`);
      console.log(`Interest included: ${received.sub(lockAmount).sub(expectedBonus).div(ONE_USDT)} USDT`);
    });

    it("Should calculate correct bonus for 90-day lock unlocked immediately", async function () {
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      const expectedMultiplier = 12000; // 120% = 20% bonus
      const expectedBonus = lockAmount.mul(expectedMultiplier - BP).div(BP);
      const expectedAPR = 350; // 3.5% APR
      
      await platform.connect(user1).lock(lockAmount, 90);
      
      const beforeBalance = await volt.balanceOf(user1.address);
      await platform.connect(user1).unlock(0);
      const afterBalance = await volt.balanceOf(user1.address);
      
      const received = afterBalance.sub(beforeBalance);
      
      // Calculate expected interest for full 90 days
      const expectedInterest = lockAmount.mul(expectedAPR).mul(90).div(BP).div(YEAR_DAYS);
      
      console.log(`\n90-Day Lock Immediate Unlock:`);
      console.log(`Locked: ${lockAmount.div(ONE_USDT)} USDT`);
      console.log(`Expected Bonus: ${expectedBonus.div(ONE_USDT)} USDT (${expectedMultiplier - BP} bp)`);
      console.log(`Expected Interest (90 days): ~${expectedInterest.div(ONE_USDT)} USDT`);
      console.log(`Received Total: ${received.div(ONE_USDT)} USDT`);
      
      // Should receive original + bonus + interest
      expect(received).to.be.gte(lockAmount.add(expectedBonus));
    });

    it("Should provide full 365-day interest even when unlocked early", async function () {
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      const expectedMultiplier = 21000; // 210% = 110% bonus
      const expectedBonus = lockAmount.mul(expectedMultiplier - BP).div(BP);
      const expectedAPR = 1800; // 18% APR
      
      await platform.connect(user1).lock(lockAmount, 365);
      
      // Wait only 1 day but should get full 365 day interest
      await time.increase(ONE_DAY);
      
      const beforeBalance = await volt.balanceOf(user1.address);
      await platform.connect(user1).unlock(0);
      const afterBalance = await volt.balanceOf(user1.address);
      
      const received = afterBalance.sub(beforeBalance);
      
      // Calculate expected interest for full 365 days
      const expectedInterest = lockAmount.mul(expectedAPR).mul(365).div(BP).div(YEAR_DAYS);
      
      console.log(`\n365-Day Lock Unlocked After 1 Day:`);
      console.log(`Locked: ${lockAmount.div(ONE_USDT)} USDT`);
      console.log(`Expected Bonus: ${expectedBonus.div(ONE_USDT)} USDT`);
      console.log(`Expected Interest (365 days): ${expectedInterest.div(ONE_USDT)} USDT`);
      console.log(`Received Total: ${received.div(ONE_USDT)} USDT`);
      
      expect(received).to.be.gte(lockAmount.add(expectedBonus).add(expectedInterest));
    });

    it("Should provide full 1095-day interest even when unlocked immediately", async function () {
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      const expectedMultiplier = 50000; // 500% = 400% bonus
      const expectedBonus = lockAmount.mul(expectedMultiplier - BP).div(BP);
      const expectedAPR = 10000; // 100% APR
      
      await platform.connect(user1).lock(lockAmount, 1095);
      
      // Unlock immediately
      const beforeBalance = await volt.balanceOf(user1.address);
      await platform.connect(user1).unlock(0);
      const afterBalance = await volt.balanceOf(user1.address);
      
      const received = afterBalance.sub(beforeBalance);
      
      // Calculate expected interest for full 1095 days (3 years)
      const expectedInterest = lockAmount.mul(expectedAPR).mul(1095).div(BP).div(YEAR_DAYS);
      
      console.log(`\n1095-Day Lock Immediate Unlock:`);
      console.log(`Locked: ${lockAmount.div(ONE_USDT)} USDT`);
      console.log(`Expected Bonus: ${expectedBonus.div(ONE_USDT)} USDT`);
      console.log(`Expected Interest (1095 days): ${expectedInterest.div(ONE_USDT)} USDT`);
      console.log(`Received Total: ${received.div(ONE_USDT)} USDT`);
      console.log(`Total Return: ${received.mul(100).div(lockAmount)}%`);
      
      expect(received).to.be.gte(lockAmount.add(expectedBonus).add(expectedInterest));
    });
  });

  describe("Multiple Locks and Unlocks", function () {
    
    it("Should handle multiple locks and unlock them immediately", async function () {
      const lockAmount1 = ethers.BigNumber.from(1000).mul(ONE_USDT);
      const lockAmount2 = ethers.BigNumber.from(500).mul(ONE_USDT);
      const lockAmount3 = ethers.BigNumber.from(2000).mul(ONE_USDT);

      // Create multiple locks
      await platform.connect(user1).lock(lockAmount1, 45);
      await platform.connect(user1).lock(lockAmount2, 90);
      await platform.connect(user1).lock(lockAmount3, 180);

      const totalLocked = lockAmount1.add(lockAmount2).add(lockAmount3);
      expect(await platform.getLockedAmount(user1.address)).to.equal(totalLocked);

      // Unlock all immediately
      const beforeBalance = await volt.balanceOf(user1.address);
      
      await platform.connect(user1).unlock(0);
      await platform.connect(user1).unlock(1);
      await platform.connect(user1).unlock(2);

      const afterBalance = await volt.balanceOf(user1.address);
      expect(await platform.getLockedAmount(user1.address)).to.equal(0);
      
      // Should have received more than locked due to bonuses and interest
      expect(afterBalance).to.be.gt(beforeBalance.add(totalLocked));
    });

    it("Should unlock locks in any order", async function () {
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);

      await platform.connect(user1).lock(lockAmount, 45);
      await platform.connect(user1).lock(lockAmount, 90);
      await platform.connect(user1).lock(lockAmount, 180);

      // Unlock middle one first
      await platform.connect(user1).unlock(1);
      expect(await platform.getLockedAmount(user1.address)).to.equal(lockAmount.mul(2));

      // Unlock last one
      await platform.connect(user1).unlock(2);
      expect(await platform.getLockedAmount(user1.address)).to.equal(lockAmount);

      // Unlock first one
      await platform.connect(user1).unlock(0);
      expect(await platform.getLockedAmount(user1.address)).to.equal(0);
    });

    it("Should handle lock and immediate unlock in sequence", async function () {
      const lockAmount = ethers.BigNumber.from(500).mul(ONE_USDT);
      
      for (let i = 0; i < 5; i++) {
        const beforeBalance = await volt.balanceOf(user1.address);
        
        // Lock
        await platform.connect(user1).lock(lockAmount, 90);
        
        // Immediately unlock
        await platform.connect(user1).unlock(i);
        
        const afterBalance = await volt.balanceOf(user1.address);
        
        // Each iteration should give bonus + interest
        expect(afterBalance).to.be.gt(beforeBalance);
      }
    });
  });

  describe("Edge Cases and Validations", function () {
    
    it("Should still revert unlock with invalid lock index", async function () {
      await expect(
        platform.connect(user1).unlock(0)
      ).to.be.revertedWithCustomError(platform, "InvalidAmount");
    });

    it("Should still revert unlock of already unlocked lock", async function () {
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      await platform.connect(user1).lock(lockAmount, 45);
      
      // First unlock - should succeed
      await platform.connect(user1).unlock(0);
      
      // Second unlock of same lock - should fail
      await expect(
        platform.connect(user1).unlock(0)
      ).to.be.revertedWithCustomError(platform, "InvalidAmount");
    });

    it("Should update lastAccrualTime correctly on unlock", async function () {
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      await platform.connect(user1).lock(lockAmount, 90);
      
      const beforeAccrual = await platform.lastAccrualTime(user1.address);
      
      await platform.connect(user1).unlock(0);
      
      const afterAccrual = await platform.lastAccrualTime(user1.address);
      
      // lastAccrualTime should be updated to lock end time
      expect(afterAccrual).to.be.gt(beforeAccrual);
    });

    it("Should correctly emit Unlocked event with all values", async function () {
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      await platform.connect(user1).lock(lockAmount, 90);
      
      const tx = await platform.connect(user1).unlock(0);
      const receipt = await tx.wait();
      
      const event = receipt.events.find(e => e.event === "Unlocked");
      expect(event).to.not.be.undefined;
      expect(event.args.user).to.equal(user1.address);
      expect(event.args.releasedAmount).to.be.gt(lockAmount);
    });

    it("Should handle zero balance user attempting to lock", async function () {
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      
      await expect(
        platform.connect(user2).lock(lockAmount, 45)
      ).to.be.revertedWithCustomError(platform, "InvalidAmount");
    });

    it("Should calculate interest correctly for lock created after last accrual", async function () {
      const depositAmount = ethers.BigNumber.from(5000).mul(ONE_USDT);
      await platform.connect(user2).depositUSDT(depositAmount);
      
      // Wait some time
      await time.increase(30 * ONE_DAY);
      
      // Now create a lock
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      await platform.connect(user2).lock(lockAmount, 180);
      
      // Immediately unlock
      const beforeBalance = await volt.balanceOf(user2.address);
      await platform.connect(user2).unlock(0);
      const afterBalance = await volt.balanceOf(user2.address);
      
      const received = afterBalance.sub(beforeBalance);
      expect(received).to.be.gt(lockAmount);
    });
  });

  describe("Comparison: Immediate vs Waiting Full Duration", function () {
    
    it("Should compare rewards: immediate unlock vs waiting 90 days", async function () {
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      
      // User1: Lock and unlock immediately
      await platform.connect(user1).lock(lockAmount, 90);
      const beforeBalance1 = await volt.balanceOf(user1.address);
      await platform.connect(user1).unlock(0);
      const afterBalance1 = await volt.balanceOf(user1.address);
      const immediateReward = afterBalance1.sub(beforeBalance1);
      
      // User2: Lock and wait full 90 days
      await platform.connect(user2).depositUSDT(ethers.BigNumber.from(10000).mul(ONE_USDT));
      await platform.connect(user2).lock(lockAmount, 90);
      
      await time.increase(91 * ONE_DAY);
      
      const beforeBalance2 = await volt.balanceOf(user2.address);
      await platform.connect(user2).unlock(0);
      const afterBalance2 = await volt.balanceOf(user2.address);
      const fullDurationReward = afterBalance2.sub(beforeBalance2);
      
      console.log(`\nReward Comparison for 90-Day Lock:`);
      console.log(`Immediate unlock reward: ${immediateReward.div(ONE_USDT)} USDT`);
      console.log(`Full duration reward: ${fullDurationReward.div(ONE_USDT)} USDT`);
      console.log(`Difference: ${fullDurationReward.sub(immediateReward).div(ONE_USDT)} USDT`);
      
      // Both should receive same or similar rewards since time check is removed
      // The difference would be minimal (just from different lastAccrualTime)
      expect(immediateReward).to.be.closeTo(fullDurationReward, lockAmount.div(10));
    });
  });

  describe("Integration with Other Features", function () {
    
    it("Should allow withdraw after immediate unlock", async function () {
      // Admin deposit USDT for liquidity
      await platform.connect(owner).adminDepositUSDT(ethers.BigNumber.from(100000).mul(ONE_USDT));
      
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      await platform.connect(user1).lock(lockAmount, 90);
      
      // Immediately unlock
      await platform.connect(user1).unlock(0);
      
      // Should be able to withdraw
      const withdrawAmount = ethers.BigNumber.from(500).mul(ONE_USDT);
      await expect(
        platform.connect(user1).withdrawUSDT(withdrawAmount, false)
      ).to.emit(platform, "Withdrawn");
    });

    it("Should calculate accrued interest correctly with active locks that can be unlocked anytime", async function () {
      const lockAmount = ethers.BigNumber.from(1000).mul(ONE_USDT);
      await platform.connect(user1).lock(lockAmount, 365);
      
      // Wait 1 day
      await time.increase(ONE_DAY);
      
      const accruedInterest = await platform.calculateAccruedInterest(user1.address);
      expect(accruedInterest).to.be.gt(0);
      
      // Can still unlock immediately
      await expect(platform.connect(user1).unlock(0))
        .to.emit(platform, "Unlocked");
    });

    it("Should handle user overview correctly with immediately unlockable locks", async function () {
      const lockAmount = ethers.BigNumber.from(2000).mul(ONE_USDT);
      await platform.connect(user1).lock(lockAmount, 180);
      
      const overview = await platform.getUserOverview(user1.address);
      
      expect(overview.isWhitelisted).to.be.true;
      expect(overview.lockedVolt).to.equal(lockAmount);
      
      // Immediately unlock
      await platform.connect(user1).unlock(0);
      
      const overviewAfter = await platform.getUserOverview(user1.address);
      expect(overviewAfter.lockedVolt).to.equal(0);
      expect(overviewAfter.availableVolt).to.be.gt(overview.availableVolt);
    });
  });
});

