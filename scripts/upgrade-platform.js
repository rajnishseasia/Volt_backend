const { ethers, upgrades } = require('hardhat');

async function main() {
  console.log(`Network: ${hre.network.name}`);
  
  const voltPlatformProxyAddress = "0x476cAC41cEd54f75577cc52C0CD24DE24E91B22E";
  const [signer] = await ethers.getSigners();
  
  console.log(`Signer:  ${signer.address}`);
  console.log(`Proxy:   ${voltPlatformProxyAddress}\n`);
  
  // Get current implementation
  const currentImpl = await upgrades.erc1967.getImplementationAddress(voltPlatformProxyAddress);
  console.log(`Current implementation: ${currentImpl}\n`);
  
  // Get contract factory
  console.log('Loading VoltPlatform contract factory...');
  const VoltPlatform = await ethers.getContractFactory("VoltPlatform");
  
  // Validate upgrade
  console.log('Validating storage layout...');
  await upgrades.validateUpgrade(voltPlatformProxyAddress, VoltPlatform);
  console.log('✓ Storage layout compatible\n');
  
  // Prepare upgrade (deploys new implementation)
  console.log('Preparing upgrade (deploying new implementation)...');
  const newImplAddress = await upgrades.prepareUpgrade(
    voltPlatformProxyAddress,
    VoltPlatform,
    { kind: 'uups' }
  );
  console.log(`✓ New implementation deployed: ${newImplAddress}\n`);
  
  // Now manually call upgradeTo on the proxy
  console.log('Calling upgradeTo on proxy...');
  const proxy = await ethers.getContractAt("VoltPlatform", voltPlatformProxyAddress);
  
  try {
    // Try with upgradeToAndCall (UUPS standard)
    const tx = await proxy.upgradeToAndCall(newImplAddress, "0x", {
      gasLimit: 500000 // Manual gas limit
    });
    console.log(`Transaction hash: ${tx.hash}`);
    console.log('Waiting for confirmation...');
    
    const receipt = await tx.wait();
    console.log(`✓ Transaction confirmed in block ${receipt.blockNumber}\n`);
    
    // Verify upgrade
    const finalImpl = await upgrades.erc1967.getImplementationAddress(voltPlatformProxyAddress);
    console.log('=== Upgrade Summary ===');
    console.log(`Proxy:              ${voltPlatformProxyAddress}`);
    console.log(`Old implementation: ${currentImpl}`);
    console.log(`New implementation: ${finalImpl}`);
    console.log(`Success:            ${finalImpl.toLowerCase() === newImplAddress.toLowerCase() ? 'YES ✓' : 'NO ✗'}\n`);
    
    if (finalImpl.toLowerCase() === newImplAddress.toLowerCase()) {
      console.log('✅ Upgrade completed successfully!\n');
    }
    
  } catch (error) {
    console.error('❌ upgradeTo call failed:');
    console.error(error.message);
    
    // Try to decode the revert reason
    if (error.data) {
      console.log('\nRevert data:', error.data);
    }
    
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Upgrade process failed');
    process.exit(1);
  });

