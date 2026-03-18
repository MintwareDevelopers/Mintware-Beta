// =============================================================================
// hardhat.config.cts
//
// TypeScript CommonJS config for MintwareDistributor.sol
//
// Uses .cts extension because:
//   1. package.json has "type": "module" — .ts configs can't be loaded as CJS
//   2. .cts forces CommonJS loading regardless of package type
//   3. Hardhat's isRunningWithTypescript() recognises .cts → TypeScript test
//      files (*.ts, *.cts) are included in test discovery automatically
//   4. Hardhat calls loadTsNode() automatically for .cts configs
//
// TypeScript for tests/scripts uses tsconfig.hardhat.json (module: commonjs,
// moduleResolution: node) to avoid conflicts with the Next.js root tsconfig.
//
// Networks:
//   - hardhat     : Local in-process network (testing only)
//   - base_sepolia: Base Sepolia testnet (chain 84532) — primary test target
//   - base        : Base mainnet (chain 8453)
//   - core_dao    : Core DAO mainnet (chain 1116)
//   - bnb         : BNB Chain mainnet (chain 56)
//
// Block explorer verification:
//   - Base / Base Sepolia → Basescan (BASESCAN_API_KEY)
//   - Core DAO           → CoreScan (CORESCAN_API_KEY)
//   - BNB Chain          → BscScan  (BSCSCAN_API_KEY)
//
// Required env vars (add to .env.local, never commit):
//   DEPLOYER_PRIVATE_KEY  — 64 hex chars, no 0x prefix
//   BASE_SEPOLIA_RPC_URL  — default: https://sepolia.base.org
//   BASE_RPC_URL          — default: https://mainnet.base.org
//   CORE_DAO_RPC_URL      — already in .env.local (https://rpc.coredao.org)
//   BNB_RPC_URL           — default: https://bsc-dataseed.binance.org
//   BASESCAN_API_KEY
//   CORESCAN_API_KEY
//   BSCSCAN_API_KEY
//
// Usage:
//   npx hardhat compile --config hardhat.config.cts
//   npx hardhat test    --config hardhat.config.cts
//   npx hardhat run scripts/deploy.cjs --network base_sepolia --config hardhat.config.cts
// =============================================================================

import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import * as path from 'path'
import * as dotenv from 'dotenv'

// Load .env.local (Next.js convention) as well as .env
dotenv.config({ path: path.resolve(__dirname, '.env.local') })
dotenv.config({ path: path.resolve(__dirname, '.env') })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the deployer private key with 0x prefix */
function deployerKey(): string {
  const raw = process.env.DEPLOYER_PRIVATE_KEY ?? ''
  if (!raw) {
    // Hardhat built-in test account #0 — safe for local testing only, never use in production
    return '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  }
  return raw.startsWith('0x') ? raw : `0x${raw}`
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  paths: {
    sources: './contracts',
    tests: './contracts/test',
    cache: './hardhat-cache',
    artifacts: './hardhat-artifacts',
  },

  typechain: {
    outDir: './hardhat-artifacts/typechain-types',
    target: 'ethers-v6',
    alwaysGenerateOverloads: false,
    externalArtifacts: [],
  },

  networks: {
    // -----------------------------------------------------------------------
    // Local in-process network — fast, no gas, default for `npx hardhat test`
    // -----------------------------------------------------------------------
    hardhat: {
      chainId: 31337,
    },

    // -----------------------------------------------------------------------
    // Base Sepolia — primary testnet deployment target (chain 84532)
    // -----------------------------------------------------------------------
    base_sepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
      chainId: 84532,
      accounts: [deployerKey()],
    },

    // -----------------------------------------------------------------------
    // Base mainnet (chain 8453)
    // -----------------------------------------------------------------------
    base: {
      url: process.env.BASE_RPC_URL ?? 'https://mainnet.base.org',
      chainId: 8453,
      accounts: [deployerKey()],
    },

    // -----------------------------------------------------------------------
    // Core DAO mainnet (chain 1116)
    // -----------------------------------------------------------------------
    core_dao: {
      url: process.env.CORE_DAO_RPC_URL ?? 'https://rpc.coredao.org',
      chainId: 1116,
      accounts: [deployerKey()],
    },

    // -----------------------------------------------------------------------
    // BNB Chain mainnet (chain 56)
    // -----------------------------------------------------------------------
    bnb: {
      url: process.env.BNB_RPC_URL ?? 'https://bsc-dataseed.binance.org',
      chainId: 56,
      accounts: [deployerKey()],
    },
  },

  // ---------------------------------------------------------------------------
  // Block explorer verification
  // ---------------------------------------------------------------------------
  etherscan: {
    apiKey: {
      base_sepolia: process.env.BASESCAN_API_KEY ?? '',
      base: process.env.BASESCAN_API_KEY ?? '',
      core_dao: process.env.CORESCAN_API_KEY ?? '',
      bnb: process.env.BSCSCAN_API_KEY ?? '',
      bsc: process.env.BSCSCAN_API_KEY ?? '',
    },
    customChains: [
      {
        network: 'base_sepolia',
        chainId: 84532,
        urls: {
          apiURL: 'https://api-sepolia.basescan.org/api',
          browserURL: 'https://sepolia.basescan.org',
        },
      },
      {
        network: 'base',
        chainId: 8453,
        urls: {
          apiURL: 'https://api.basescan.org/api',
          browserURL: 'https://basescan.org',
        },
      },
      {
        network: 'core_dao',
        chainId: 1116,
        urls: {
          apiURL: 'https://openapi.coredao.org/api',
          browserURL: 'https://scan.coredao.org',
        },
      },
    ],
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    currency: 'USD',
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  },
}

export default config
