// POST /api/oracle/deploy-campaign-testnet   (route group (admin) is stripped from the URL)
//
// One-click TESTNET deploy of MintwareDistributor v2 — the campaign / daily-earn payout contract —
// to Base Sepolia, executed FROM the configured oracle signer (a Privy server wallet when
// ORACLE_SIGNER_PROVIDER=privy). It sets that same wallet as BOTH the on-chain oracleSigner AND the
// owner (so it is an implicit campaign registrar), then reads the signer back to confirm. This is the
// same Privy-native flow used for the weighted distributor + pair vault — no raw deployer key, no old
// wallets.
//
// Post-deploy wiring (operator): set NEXT_PUBLIC_DISTRIBUTOR_ADDRESS_BASE_SEPOLIA + the server-side
// DISTRIBUTOR_ADDRESS_BASE_SEPOLIA to the returned address, and (optionally) authorize the backend
// signer as a registrar via setAuthorizedRegistrar — though the owner is already an implicit
// registrar, so /api/campaigns/create can register campaigns out of the box.
//
// Requirements: ORACLE_SIGNER_PROVIDER=privy + the root Privy wallet env, and the wallet must hold a
// little Base Sepolia ETH for gas. Bearer-gated (CRON_SECRET). TESTNET ONLY — Base Sepolia hardcoded.

import { createPublicClient, createWalletClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'
import { createHandler } from '@/lib/web2/routeHandler'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import {
  CAMPAIGN_DISTRIBUTOR_ABI,
  CAMPAIGN_DISTRIBUTOR_BYTECODE,
} from '@/lib/web3/artifacts/campaignDistributor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

  // 1. Deploy — Privy wallet as BOTH oracle signer and owner (owner = implicit registrar).
  const deployTx = await walletClient.deployContract({
    abi: CAMPAIGN_DISTRIBUTOR_ABI,
    bytecode: CAMPAIGN_DISTRIBUTOR_BYTECODE,
    args: [account.address, account.address],
    account,
    chain: baseSepolia,
  })
  const deployRcpt = await publicClient.waitForTransactionReceipt({ hash: deployTx })
  const distributor = deployRcpt.contractAddress
  if (deployRcpt.status !== 'success' || !distributor) {
    return ctx.json({ ok: false, step: 'deploy', deployTx, error: 'deploy reverted or no address' }, 500)
  }

  // 2. Read the on-chain signer + owner back and confirm they equal the Privy wallet.
  const [onchainSigner, onchainOwner] = await Promise.all([
    publicClient.readContract({ address: distributor, abi: CAMPAIGN_DISTRIBUTOR_ABI, functionName: 'oracleSigner' }) as Promise<string>,
    publicClient.readContract({ address: distributor, abi: CAMPAIGN_DISTRIBUTOR_ABI, functionName: 'owner' }) as Promise<string>,
  ])

  return ctx.json({
    ok: true,
    chain: 'base_sepolia',
    deployer: account.address,
    distributor,
    onchainOracleSigner: onchainSigner,
    onchainOwner,
    signerMatchesPrivyWallet: onchainSigner.toLowerCase() === account.address.toLowerCase(),
    ownerMatchesPrivyWallet: onchainOwner.toLowerCase() === account.address.toLowerCase(),
    deployTx,
    envToSet: {
      NEXT_PUBLIC_DISTRIBUTOR_ADDRESS_BASE_SEPOLIA: distributor,
      DISTRIBUTOR_ADDRESS_BASE_SEPOLIA: distributor,
    },
    basescan: `https://sepolia.basescan.org/address/${distributor}`,
  })
}, { auth: 'bearer-token' })
