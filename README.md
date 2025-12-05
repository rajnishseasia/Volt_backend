

## 🚀 Project Overview

Volt Platform is a DeFi protocol consisting of three main smart contracts:

- **VoltToken** - An upgradeable ERC20 token (6 decimals) with controlled minting/burning and no transfers between users
- **VoltPlatform** - The core staking platform with multi-tier APY, time-locked staking, referral system, and early unlock mechanism
- **MockUSDT** - A mock USDT token for testing purposes

### Key Features

- **USDT Deposits**: Users deposit USDT and receive VOLT tokens at 1:1 ratio
- **Time-Locked Staking**: Lock USDT for 90-1825 days to earn bonus rewards
- **Multi-Tier APY**: Base APY of 6% with tier-based multipliers (1.25x and 1.5x)
- **7-Level Referral System**: Earn rewards from your referral network with decreasing percentages (10%, 5%, 2%, 1%, 0.5%, 0.25%, 0.1%)
- **Early Unlock**: Unlock staked funds before maturity with a penalty
- **Flexible Withdrawals**: Withdraw with configurable fees (10% for <500 USDT, 5% for ≥500 USDT)
- **Admin Controls**: Pause/unpause, upgrade contracts, manage whitelist, and adjust parameters
- **Upgradeable**: UUPS proxy pattern for seamless contract upgrades

## 📋 Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Git

## 🛠️ Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/volt-backend.git
cd volt-backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env
PRIVATE_KEY=your_private_key_here
INFURA_API_KEY=your_infura_api_key_here
ETHERSCAN_API_KEY=your_etherscan_api_key_here
```

## 🏗️ Project Structure

```
volt-backend/
├── contracts/
│   ├── VoltPlatform.sol      # Main staking platform contract
│   ├── VoltToken.sol          # VOLT ERC20 token contract
│   └── MockUSDT.sol           # Mock USDT for testing
├── scripts/
│   ├── deploy.js              # Deployment script
│   ├── upgrade-platform.js    # Platform upgrade script
│   ├── verify.js              # Contract verification
│   └── verify-new-impl.js     # Verify upgraded implementation
├── test/
│   ├── VoltPlatform.Test.js   # Platform main test suite
│   ├── VoltPlatform.EarlyUnlock.Test.js  # Early unlock tests
│   └── VoltToken.Test.js      # Token test suite
├── hardhat.config.js          # Hardhat configuration
└── package.json
```

## 🧪 Testing

Run all tests:
```bash
npm test
```

Run specific test files:
```bash
npx hardhat test test/VoltToken.Test.js
npx hardhat test test/VoltPlatform.Test.js
npx hardhat test test/VoltPlatform.EarlyUnlock.Test.js
```

Run tests with gas reporting:
```bash
REPORT_GAS=true npx hardhat test
```

Run coverage:
```bash
npx hardhat coverage
```

## 🚀 Deployment

### Deploy to Local Network

Start a local Hardhat node:
```bash
npx hardhat node
```

In a new terminal, deploy contracts:
```bash
npx hardhat run scripts/deploy.js --network localhost
```

### Deploy to Sepolia Testnet

Ensure your `.env` file has the required variables, then:
```bash
npx hardhat run scripts/deploy.js --network sepolia
```

### Verify Contracts on Etherscan

After deployment:
```bash
npx hardhat run scripts/verify.js --network sepolia
```

## 📝 Contract Upgrades

The VoltToken and VoltPlatform contracts are upgradeable using the UUPS proxy pattern.

To upgrade the VoltPlatform contract:
```bash
npx hardhat run scripts/upgrade-platform.js --network sepolia
```

## 🔐 Smart Contract Details

### VoltToken

- **Symbol**: VOLT
- **Decimals**: 6
- **Features**:
  - Upgradeable (UUPS)
  - Non-transferable (only mint/burn operations)
  - Platform-controlled minting/burning
  - Owner can also mint/burn

### VoltPlatform

**Constants:**
- Base APY: 6% (600 basis points)
- Tier 1: 50-100 USDT (1.25x multiplier)
- Tier 2: 101-500 USDT (1.5x multiplier)
- Lock periods: 90-1825 days
- Referral levels: 7 (10%, 5%, 2%, 1%, 0.5%, 0.25%, 0.1%)

**Main Functions:**
- `depositUSDT(uint256 amount)` - Deposit USDT and receive VOLT
- `lockUSDT(uint256 amount, uint256 durationDays)` - Lock USDT for bonus
- `unlockStake(uint256 stakeIndex)` - Unlock matured stake
- `earlyUnlock(uint256 stakeIndex)` - Unlock before maturity with penalty
- `claimInterest()` - Claim accrued interest
- `claimBonus()` - Claim vested bonus
- `withdraw(uint256 voltAmount, bool fullExit)` - Withdraw USDT for VOLT

**Admin Functions:**
- `addToWhitelistWithReferral()` - Add users to whitelist
- `removeFromWhitelist()` - Remove users from whitelist
- `setBaseApyBp()` - Update base APY
- `pause()/unpause()` - Emergency pause
- `upgradeTo()` - Upgrade contract implementation

## 🔧 Configuration

The platform parameters can be adjusted by the owner:

- Base APY (basis points)
- Minimum withdrawal amount
- Withdrawal fees
- Referral percentages
- Pause state

## 🧾 Networks

### Hardhat Local Network
- Chain ID: 31337
- Default accounts: 10 test accounts

### Sepolia Testnet
- Chain ID: 11155111
- RPC: Infura
- Explorer: https://sepolia.etherscan.io

## 📊 Technology Stack

- **Solidity** ^0.8.24 - Smart contract language
- **Hardhat** - Development environment
- **OpenZeppelin Contracts** - Security-audited contract libraries
- **Ethers.js** - Ethereum library
- **Chai** - Testing framework
- **TypeChain** - TypeScript bindings for contracts
- **Hardhat Upgrades** - Plugin for upgradeable contracts

## 🔒 Security Features

- ✅ ReentrancyGuard on all critical functions
- ✅ Pausable for emergency stops
- ✅ Two-step ownership transfer
- ✅ SafeERC20 for token transfers
- ✅ Comprehensive test coverage
- ✅ Upgradeable contracts (UUPS pattern)
- ✅ Access control (owner and whitelist)


## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

