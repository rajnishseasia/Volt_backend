const { ethers, upgrades } = require("hardhat");
const { utils } = ethers;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const balance = await deployer.getBalance();
  console.log("Balance:", utils.formatEther(balance), "ETH\n");

  const MockUSDT = await ethers.getContractFactory("MockUSDT");
  const usdt = await MockUSDT.deploy();
  await usdt.deployed(); 
  console.log("MockUSDT deployed →", usdt.address);

  const VoltToken = await ethers.getContractFactory("VoltToken");
  const volt = await upgrades.deployProxy(
    VoltToken,
    [deployer.address],
    { initializer: "initialize", kind: "uups" }
  );
  await volt.deployed();
  console.log("VoltToken deployed →", volt.address);

  const VoltPlatform = await ethers.getContractFactory("VoltPlatform");
  const platform = await upgrades.deployProxy(
    VoltPlatform,
    [usdt.address, volt.address, deployer.address],
    { initializer: "initialize", kind: "uups" }
  );
  await platform.deployed();
  console.log("VoltPlatform deployed →", platform.address);

  const tx = await volt.setPlatform(platform.address);
  await tx.wait();
  console.log("VoltToken linked to Platform");

  const mintTx = await usdt.mint(deployer.address, ethers.utils.parseUnits("1000000", 6));
  await mintTx.wait();
  console.log("Minted 1,000,000 USDT");

  console.log("\n✅ DEPLOYMENT SUCCESSFUL!");
  console.log("USDT        :", usdt.address);
  console.log("VoltToken   :", volt.address);
  console.log("VoltPlatform:", platform.address);
}

main().catch(error => {
  console.error("Deploy failed:", error);
  process.exit(1);
});
