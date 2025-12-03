const { run, ethers } = require("hardhat");

const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function getImplementationAddress(proxyAddress) {
  const implementationAddress = await ethers.provider.getStorageAt(
    proxyAddress,
    IMPLEMENTATION_SLOT
  );

  return "0x" + implementationAddress.slice(-40);
}

async function main() {
  console.log("Starting verification process...\n");

  const mockUSDTAddress = "0x3654aed5B44791cBB3b52d04435B2Ca5A8f40EB4";
  console.log("Verifying MockUSDT (regular contract)...");
  try {
    await run("verify:verify", {
      address: mockUSDTAddress,
      constructorArguments: [],
    });
    console.log("✓ MockUSDT verified successfully!\n");
  } catch (error) {
    if (error.message.includes("already verified")) {
      console.log("✓ MockUSDT already verified\n");
    } else {
      console.error("✗ MockUSDT verification failed:", error.message, "\n");
    }
  }

  const voltTokenProxyAddress = "0xd776bFCffCDe870C7328c80023356061849218f7";
  console.log("Verifying VoltToken (UUPS proxy)...");
  try {
    const voltTokenImplAddress = await getImplementationAddress(voltTokenProxyAddress);
    console.log(`  Implementation address: ${voltTokenImplAddress}`);
    
    await run("verify:verify", {
      address: voltTokenImplAddress,
      constructorArguments: [],
    });
    console.log("✓ VoltToken implementation verified successfully!\n");
  } catch (error) {
    if (error.message.includes("already verified")) {
      console.log("✓ VoltToken implementation already verified\n");
    } else {
      console.error("✗ VoltToken verification failed:", error.message, "\n");
    }
  }

  const voltPlatformProxyAddress = "0x476cAC41cEd54f75577cc52C0CD24DE24E91B22E";
  console.log("Verifying VoltPlatform (UUPS proxy)...");
  try {
    const voltPlatformImplAddress = await getImplementationAddress(voltPlatformProxyAddress);
    console.log(`  Implementation address: ${voltPlatformImplAddress}`);
    
    const usdtAddress = "0x3654aed5B44791cBB3b52d04435B2Ca5A8f40EB4";
    const voltAddress = "0xd776bFCffCDe870C7328c80023356061849218f7";
    
    const platformContract = await ethers.getContractAt("VoltPlatform", voltPlatformProxyAddress);
    const ownerAddress = await platformContract.owner();
    console.log(`  Constructor args: usdt=${usdtAddress}, volt=${voltAddress}, owner=${ownerAddress}`);
    
    await run("verify:verify", {
      address: voltPlatformImplAddress,
      constructorArguments: [],
    });
    console.log("✓ VoltPlatform implementation verified successfully!\n");
  } catch (error) {
    if (error.message.includes("already verified")) {
      console.log("✓ VoltPlatform implementation already verified\n");
    } else {
      console.error("✗ VoltPlatform verification failed:", error.message, "\n");
    }
  }

  console.log("Verification process completed!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
