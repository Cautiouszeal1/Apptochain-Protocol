require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ quiet: true });
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Use the solc-js compiler shipped in node_modules so builds work offline and on any OS.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === "0.8.24") {
    return { compilerPath: require.resolve("solc/soljson.js"), isSolcJs: true, version: "0.8.24", longVersion: "0.8.24+commit.e11b9ed9" };
  }
  return runSuper();
});

const PK = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = PK ? [PK] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    localhost: { url: "http://127.0.0.1:8545" },
    baseSepolia: { url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org", chainId: 84532, accounts },
    base: { url: process.env.BASE_RPC || "https://mainnet.base.org", chainId: 8453, accounts },
  },
  etherscan: {
    apiKey: process.env.BASESCAN_API_KEY || "",
  },
};
