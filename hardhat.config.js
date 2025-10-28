// require("@openzeppelin/hardhat-upgrades");
// require("@nomicfoundation/hardhat-toolbox");

// module.exports = {
//   solidity: {
//     version: "0.8.24",
//     settings: { optimizer: { enabled: true, runs: 200 } },
//   },

//   networks: {
//     hardhat: {
//       chainId: 31337,
//       accounts: {
//         mnemonic: "test test test test test test test test test test test junk",
//         count: 10,
//       },
//     },
//   },
// };


require("@openzeppelin/hardhat-upgrades");
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },

  networks: {
    hardhat: {
      chainId: 31337,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        count: 10,
      },
    },

    sepolia: {
      url: `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
      accounts: [process.env.PRIVATE_KEY],
      chainId: 11155111,
    },
  },

  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};
