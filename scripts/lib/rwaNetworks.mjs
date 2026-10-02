// V2-RWAs — per-network presets for the demo scripts (deploy / lifecycle / verify).
//
// Pick one with RWA_NETWORK (default `base-sepolia`, so the original Base Sepolia commands are unchanged).
// Every field can still be overridden by its own env var (RWA_RPC_URL, V4_POOL_MANAGER, RWA_DEPLOYMENT_OUT,
// RWA_DEMO_OUT, RWA_DEMO_WALLETS, RWA_EXPLORER_URL, RWA_GAS_FUND_WEI).
//
// TESTNETS ONLY. `assertTestnet()` refuses any chain id other than the preset's testnet id (a local anvil fork
// keeps the forked chain id, so rehearsals pass), so a mis-pointed RPC can never broadcast this stack to a mainnet.

import { join } from 'node:path'

export const NETWORKS = {
  'base-sepolia': {
    chainId: 84532,
    name: 'Base Sepolia',
    rpc: 'https://sepolia.base.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorer: 'https://sepolia.basescan.org',
    // canonical Uniswap v4 PoolManager (Uniswap's own deployment)
    poolManager: '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408',
    verifier: { kind: 'etherscan', url: 'https://api.etherscan.io/v2/api?chainid=84532' },
    files: { deployment: 'rwaDemo.deployment.json', demo: 'rwaDemo.json', wallets: '.rwa-demo-wallets.json' },
    gasFundWei: 120_000_000_000_000n, // 0.00012 ETH per demo wallet
    minRunWei: 0n, // unchanged behaviour on Base Sepolia (no pre-flight floor)
    faucet: null,
  },
  // XRPL EVM sidechain TESTNET (Cosmos-SDK EVM, PoA). Native gas = XRP, 18 dp on the EVM side; EIP-1559 supported
  // (blocks carry baseFeePerGas). Sources: docs.xrplevm.org "Connect MetaMask to the XRPL EVM", chainlist 1449000.
  'xrpl-evm-testnet': {
    chainId: 1449000,
    name: 'XRPL EVM Testnet',
    rpc: 'https://rpc.testnet.xrplevm.org',
    nativeCurrency: { name: 'XRP', symbol: 'XRP', decimals: 18 },
    explorer: 'https://explorer.testnet.xrplevm.org',
    // Uniswap has NOT deployed v4 here (absent from Uniswap's v4 deployments list; no code at any canonical v4
    // address). 'deploy' ⇒ deploy-rwa-demo.mjs deploys v4-core's PoolManager from the Forge artifacts, owner = the
    // signer. v4-core is BUSL-1.1 — this is a testnet / non-production deployment.
    poolManager: 'deploy',
    verifier: { kind: 'blockscout', url: 'https://explorer.testnet.xrplevm.org/api/' },
    files: { deployment: 'rwaDemo.xrpl.deployment.json', demo: 'rwaDemo.xrpl.json', wallets: '.rwa-demo-wallets.xrpl.json' },
    gasFundWei: 20_000_000_000_000_000n, // 0.02 XRP per demo wallet (gas ≈ 1 gwei here vs ≈ 0.001 gwei on Base Sepolia)
    minRunWei: 500_000_000_000_000_000n, // 0.5 XRP: deploy + lifecycle + 6 × demo-wallet gas, with headroom
    faucet: 'https://faucet.xrplevm.org (select Testnet)',
  },
}

/** Resolve the active network: preset (RWA_NETWORK) + per-field env overrides. */
export function resolveNetwork(root) {
  const id = process.env.RWA_NETWORK ?? 'base-sepolia'
  const n = NETWORKS[id]
  if (!n) throw new Error(`unknown RWA_NETWORK "${id}" — one of: ${Object.keys(NETWORKS).join(', ')}`)
  return {
    id,
    ...n,
    rpc: process.env.RWA_RPC_URL ?? n.rpc,
    explorer: process.env.RWA_EXPLORER_URL ?? n.explorer,
    poolManager: process.env.V4_POOL_MANAGER ?? n.poolManager,
    gasFundWei: BigInt(process.env.RWA_GAS_FUND_WEI ?? n.gasFundWei),
    minRunWei: BigInt(process.env.RWA_MIN_RUN_WEI ?? n.minRunWei),
    deploymentFile: process.env.RWA_DEPLOYMENT_OUT ?? join(root, 'config', n.files.deployment),
    demoFile: process.env.RWA_DEMO_OUT ?? join(root, 'config', n.files.demo),
    walletsFile: process.env.RWA_DEMO_WALLETS ?? join(root, n.files.wallets),
  }
}

/** Refuse to run against anything but the preset's testnet chain id. */
export function assertTestnet(net, chainId) {
  if (chainId !== net.chainId) {
    throw new Error(`RPC is chain ${chainId}, but RWA_NETWORK=${net.id} expects ${net.chainId} — refusing (testnets only)`)
  }
}

/** The chain block every proof file carries, so a UI can build explorer links per chain. */
export const chainMeta = (net) => ({ id: net.chainId, name: net.name, explorer: net.explorer, nativeSymbol: net.nativeCurrency.symbol, network: net.id })
