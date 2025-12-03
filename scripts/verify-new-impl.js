const { run } = require("hardhat");

async function main() {
  console.log("\n=== Verifying New Implementation on Etherscan ===\n");

  const newImplAddress = "0xA625A98c38D7886baCF92229d9793C5Ddf0657A1";
  
  console.log(`Implementation address: ${newImplAddress}`);
  console.log("Verifying...\n");

  try {
    await run("verify:verify", {
      address: newImplAddress,
      constructorArguments: [],
    });
    console.log("\n✅ VoltPlatform implementation verified successfully!");
  } catch (error) {
    if (error.message.includes("already verified")) {
      console.log("\n✅ Contract already verified on Etherscan");
    } else {
      console.error("\n❌ Verification failed:");
      console.error(error.message);
    }
  }

  console.log(`\n🔗 View on Etherscan: https://sepolia.etherscan.io/address/${newImplAddress}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

