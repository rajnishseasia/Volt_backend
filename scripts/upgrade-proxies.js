const hre = require('hardhat');
const { ethers, upgrades } = hre;

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
}

function short(addr) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : 'N/A';
}

async function getImplementationAddress(proxyAddress) {
  const impl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  return impl;
}

async function validateUpgradeSafe(proxyAddress, newImplFactory, name) {
  process.stdout.write(`Validating storage layout for ${name} ... `);
  await upgrades.validateUpgrade(proxyAddress, newImplFactory);
  console.log('OK');
}

async function upgradeOne({ label, proxyAddress, newContractName }) {
  console.log(`\n=== Upgrading ${label} ===`);

  if (!proxyAddress) {
    throw new Error(`${label}: proxy address is required.`);
  }

  const beforeImpl = await getImplementationAddress(proxyAddress).catch(() => undefined);
  console.log(`Proxy:         ${proxyAddress} (${short(proxyAddress)})`);
  if (beforeImpl) console.log(`Impl (before): ${beforeImpl} (${short(beforeImpl)})`);

  const NewImplFactory = await ethers.getContractFactory(newContractName);

  await validateUpgradeSafe(proxyAddress, NewImplFactory, label);

  console.log(`Sending upgrade transaction for ${label} → ${newContractName} ...`);
  const upgraded = await upgrades.upgradeProxy(proxyAddress, NewImplFactory, { kind: 'uups' });
  await upgraded.deployed();

  const afterImpl = await getImplementationAddress(proxyAddress);
  console.log(`Impl (after):  ${afterImpl} (${short(afterImpl)})`);

  try {
    if (label.toLowerCase().includes('token') && upgraded.name) {
      const n = await upgraded.name();
      console.log(`Post-check: name() = ${n}`);
    }
  } catch (e) {
    console.warn(`Post-check skipped for ${label}: ${e.message}`);
  }

  console.log(`✔ ${label} upgraded successfully.`);
}

async function main() {
  console.log('Starting UUPS upgrade process...');
  console.log(`Network: ${hre.network.name}`);

  const tokenProxy = getArg('--token-proxy') || process.env.VOLT_TOKEN_PROXY;
  const platformProxy = getArg('--platform-proxy') || process.env.VOLT_PLATFORM_PROXY;

  console.log('Resolved proxy addresses:');
  console.log(`- VoltToken proxy:    ${tokenProxy || 'N/A'}`);
  console.log(`- VoltPlatform proxy: ${platformProxy || 'N/A'}`);

  await upgradeOne({
    label: 'VoltToken',
    proxyAddress: tokenProxy,
    newContractName: 'VoltTokenV2',
  });

  await upgradeOne({
    label: 'VoltPlatform',
    proxyAddress: platformProxy,
    newContractName: 'VoltPlatformV2',
  });

  console.log('\nAll upgrades completed successfully.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nUpgrade process failed:');
    console.error(err);
    process.exit(1);
  });