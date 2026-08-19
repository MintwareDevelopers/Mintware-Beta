// POST /api/oracle/deploy-weighted-testnet   (route group (admin) is stripped from the URL)
//
// One-click TESTNET deploy of MintwareWeightedDistributor to Base Sepolia, executed FROM the
// configured oracle signer (a Privy server wallet when ORACLE_SIGNER_PROVIDER=privy). It sets that
// same wallet as BOTH the on-chain oracleSigner AND the owner, registers the default USDC vault, and
// reads the signer back to confirm. This proves the Privy wallet is a working on-chain deployer +
// signer end-to-end — no raw deployer key, no old wallets.
//
// Requirements: ORACLE_SIGNER_PROVIDER=privy + the root Privy wallet env, and the wallet must hold a
// little Base Sepolia ETH for gas (fund it from a faucet first). Bearer-gated (CRON_SECRET).
// TESTNET ONLY — the chain + USDC are hardcoded to Base Sepolia so this can't touch mainnet.

import { createPublicClient, createWalletClient, http, keccak256, toBytes } from 'viem'
import { baseSepolia } from 'viem/chains'
import { createHandler } from '@/lib/web2/routeHandler'
import { ADMIN_SECRET } from '@/lib/constants'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import {
  WEIGHTED_DISTRIBUTOR_ABI,
  WEIGHTED_DISTRIBUTOR_BYTECODE,
} from '@/lib/web3/artifacts/weightedDistributor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ZERO = '0x0000000000000000000000000000000000000000' as const
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
const VAULT_ID = keccak256(toBytes('mw-weighted-vault-1'))

export const POST = createHandler(async (_req, ctx) => {
  const account = await getOracleSigner('root') // the Privy wallet in privy mode
  const transport = http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')
  const publicClient = createPublicClient({ chain: baseSepolia, transport })
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport })

  // Pre-flight: the wallet needs gas.
  const balance = await publicClient.getBalance({ address: account.address })
  if (balance === 0n) {
    return ctx.json(
      {
        ok: false,
        step: 'preflight',
        deployer: account.address,
        error: `Deployer ${account.address} holds 0 Base Sepolia ETH — fund it from a faucet, then retry.`,
      },
      400,
    )
  }

  // 1. Deploy — Privy wallet as BOTH oracle signer and owner.
  const deployTx = await walletClient.deployContract({
    abi: WEIGHTED_DISTRIBUTOR_ABI,
    bytecode: WEIGHTED_DISTRIBUTOR_BYTECODE,
    args: [account.address, account.address],
    account,
    chain: baseSepolia,
  })
  const deployRcpt = await publicClient.waitForTransactionReceipt({ hash: deployTx })
  const distributor = deployRcpt.contractAddress
  if (deployRcpt.status !== 'success' || !distributor) {
    return ctx.json({ ok: false, step: 'deploy', deployTx, error: 'deploy reverted or no address' }, 500)
  }

  // 2. Register the default USDC vault (owner bypass on the registrar allowlist).
  const registerTx = await walletClient.writeContract({
    address: distributor,
    abi: WEIGHTED_DISTRIBUTOR_ABI,
    functionName: 'registerVault',
    args: [VAULT_ID, BASE_SEPOLIA_USDC, ZERO],
    account,
    chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: registerTx })

  // 3. Read the on-chain signer back and confirm it equals the Privy wallet.
  const onchainSigner = (await publicClient.readContract({
    address: distributor,
    abi: WEIGHTED_DISTRIBUTOR_ABI,
    functionName: 'oracleSigner',
  })) as string

  return ctx.json({
    ok: true,
    chain: 'base_sepolia',
    deployer: account.address,
    distributor,
    onchainOracleSigner: onchainSigner,
    signerMatchesPrivyWallet: onchainSigner.toLowerCase() === account.address.toLowerCase(),
    vaultId: VAULT_ID,
    deployTx,
    registerTx,
    basescan: `https://sepolia.basescan.org/address/${distributor}`,
  })
}, { auth: 'bearer-token', bearerSecret: ADMIN_SECRET })
