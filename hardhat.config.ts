import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import type { HardhatUserConfig } from "hardhat/config";
import "solidity-coverage";

import "./tasks/accounts";
import "./tasks/FHECounter";
import "./tasks/CipherVault";

import * as dotenv from "dotenv";
dotenv.config();

const INFURA_API_KEY: string | undefined = process.env.INFURA_API_KEY;
const PRIVATE_KEY_RAW: string | undefined = process.env.PRIVATE_KEY;

function normalizePrivateKey(privateKey: string | undefined): string | undefined {
  if (!privateKey) return undefined;
  const trimmed = privateKey.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

const PRIVATE_KEY = normalizePrivateKey(PRIVATE_KEY_RAW);
const sepoliaUrl = INFURA_API_KEY
  ? `https://sepolia.infura.io/v3/${INFURA_API_KEY}`
  : "https://eth-sepolia.public.blastapi.io";

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: 0,
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY ?? "",
    },
  },
  gasReporter: {
    currency: "USD",
    enabled: process.env.REPORT_GAS ? true : false,
    excludeContracts: [],
  },
  networks: {
    hardhat: {
      chainId: 31337,
      ...(PRIVATE_KEY
        ? {
            accounts: [
              {
                privateKey: PRIVATE_KEY,
                balance: "10000000000000000000000",
              },
            ],
          }
        : {}),
    },
    anvil: {
      chainId: 31337,
      url: "http://localhost:8545",
      ...(PRIVATE_KEY ? { accounts: [PRIVATE_KEY] } : {}),
    },
    localhost: {
      chainId: 31337,
      url: "http://127.0.0.1:8545",
      ...(PRIVATE_KEY ? { accounts: [PRIVATE_KEY] } : {}),
    },
    sepolia: {
      chainId: 11155111,
      url: sepoliaUrl,
      ...(PRIVATE_KEY ? { accounts: [PRIVATE_KEY] } : {}),
    },
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },
  solidity: {
    version: "0.8.27",
    settings: {
      metadata: {
        // Not including the metadata hash
        // https://github.com/paulrberg/hardhat-template/issues/31
        bytecodeHash: "none",
      },
      // Disable the optimizer when debugging
      // https://hardhat.org/hardhat-network/#solidity-optimizer-support
      optimizer: {
        enabled: true,
        runs: 800,
      },
      evmVersion: "cancun",
    },
  },
  typechain: {
    outDir: "types",
    target: "ethers-v6",
  },
};

export default config;
