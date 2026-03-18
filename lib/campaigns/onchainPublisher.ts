// =============================================================================
// onchainPublisher.ts — Publish a Merkle root on-chain + record onchain_id
//
// Called from the epoch-end cron AFTER runMerkleBuilder() has written the
// distribution row to Supabase with status='pending'.
//
// Flow:
//   1. Read DISTRIBUTOR_PRIVATE_KEY from env → create viem account
//   2. Spin up a public + wallet client for the target chain
//   3. Check ERC-20 allowance → approve distributor if insufficient
//   4. Call MintwareDistributor.createDistribution(root, token, totalAmount)
//   5. Wait for receipt → parse DistributionCreated event for uint256 distributionId
//   6. UPDATE distributions SET onchain_id=?, status='published', tx_hash=?, published_at=?
//
// Required env vars:
//   DISTRIBUTOR_PRIVATE_KEY   — 64 hex chars (0x prefix optional)
//                               This wallet must hold the reward tokens.
//   BASE_RPC_URL              — (optional) defaults to https://mainnet.base.org
//   BASE_SEPOLIA_RPC_URL      — (optional) defaults to https://sepolia.base.org
//   CORE_DAO_RPC_URL          — (optional) defaults to https://rpc.coredao.org
//   BNB_RPC_URL               — (optional) defaults to https://bsc-dataseed.binance.org
//
// Security: DISTRIBUTOR_PRIVATE_KEY is a server-side secret. It must NEVER
// appear in client bundles, responses, or logs.
// =============================================================================

import {
  createWalletClient,
  createPublicClient,
  http,
  decodeEventLog,
  parseAbi,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, bsc } from 'viem/chains'
import { createSupabaseServiceClient } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// ABIs — minimal surface, only functions + events we call
// ---------------------------------------------------------------------------

const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])

const DISTRIBUTOR_ABI = parseAbi([
  'function createDistribution(bytes32 merkleRoot, address token, uint256 totalAmount) returns (uint256)',
  'event DistributionCreated(uint256 indexed distributionId, bytes32 indexed merkleRoot, address indexed token, uint256 totalAmount)',
])

// ---------------------------------------------------------------------------
// Chain definitions
// viem/chains ships base, baseSepolia, bsc. Core DAO requires a custom definition.
// ---------------------------------------------------------------------------

const CORE_DAO: Chain = {
  id: 1116,
  name: 'Core DAO',
  nativeCurrency: { name: 'CORE', symbol: 'CORE', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.coredao.org'] },
    public:  { http: ['https://rpc.coredao.org'] },
  },
  blockExplorers: {
    default: { name: 'CoreScan', url: 'https://scan.coredao.org' },
  },
}

function getChain(slug: string): Chain {
  switch (slug) {
    case 'base':         return base
    case 'base_sepolia': return baseSepolia
    case 'core_dao':     return CORE_DAO
    case 'bnb':          return bsc
    default:             throw new Error(`[onchainPublisher] Unknown chain slug: "${slug}"`)
  }
}

function getRpcUrl(slug: string): string {
  switch (slug) {
    case 'base':         return process.env.BASE_RPC_URL        ?? 'https://mainnet.base.org'
    case 'base_sepolia': return process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'
    case 'core_dao':     return process.env.CORE_DAO_RPC_URL     ?? 'https://rpc.coredao.org'
    case 'bnb':          return process.env.BNB_RPC_URL           ?? 'https://bsc-dataseed.binance.org'
    default:             throw new Error(`[onchainPublisher] No RPC URL for chain: "${slug}"`)
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublishParams {
  /** Supabase UUID of the distributions row (NOT the on-chain uint256) */
  distribution_db_id: string
  /** '0x...' Merkle root produced by StandardMerkleTree.root */
  merkle_root: string
  /** ERC-20 token contract address to distribute */
  token_address: string
  /** Total payout in token base units (bigint as string) */
  total_amount_wei: string
  /** Deployed MintwareDistributor contract address */
  contract_address: string
  /** Chain slug: 'base' | 'base_sepolia' | 'core_dao' | 'bnb' */
  chain: string
}

export interface PublishResult {
  /** uint256 distributionId from the DistributionCreated event (as string) */
  onchain_id: string
  /** Transaction hash of the createDistribution() call */
  tx_hash: string
}

// ---------------------------------------------------------------------------
// publishDistribution — the main export
// ---------------------------------------------------------------------------

export async function publishDistribution(params: PublishParams): Promise<PublishResult> {
  const {
    distribution_db_id,
    merkle_root,
    token_address,
    total_amount_wei,
    contract_address,
    chain: chainSlug,
  } = params

  // ── Wallet setup ──────────────────────────────────────────────────────────
  const rawKey = process.env.DISTRIBUTOR_PRIVATE_KEY
  if (!rawKey) {
    throw new Error(
      '[onchainPublisher] DISTRIBUTOR_PRIVATE_KEY is not set. ' +
      'Add it to .env.local: DISTRIBUTOR_PRIVATE_KEY=<64 hex chars, no 0x prefix>'
    )
  }

  const privateKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`
  const account = privateKeyToAccount(privateKey)

  const chain = getChain(chainSlug)
  const transport = http(getRpcUrl(chainSlug))

  const publicClient = createPublicClient({ chain, transport })
  const walletClient = createWalletClient({ account, chain, transport })

  const distributorAddr  = contract_address as `0x${string}`
  const tokenAddr        = token_address as `0x${string}`
  const totalWei         = BigInt(total_amount_wei)
  const merkleRootBytes32 = (
    merkle_root.startsWith('0x') ? merkle_root : `0x${merkle_root}`
  ) as `0x${string}`

  console.log(
    `[onchainPublisher] Publishing distribution ${distribution_db_id}` +
    ` on ${chainSlug} | root=${merkle_root.slice(0, 10)}... | amount=${totalWei}`
  )

  // ── Step 1: Check allowance → approve if needed ───────────────────────────
  const allowance = await publicClient.readContract({
    address: tokenAddr,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, distributorAddr],
  })

  if (allowance < totalWei) {
    console.log(
      `[onchainPublisher] Allowance ${allowance} < ${totalWei}. ` +
      `Approving distributor for exact amount...`
    )
    const approveTxHash = await walletClient.writeContract({
      address: tokenAddr,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [distributorAddr, totalWei],
    })
    await publicClient.waitForTransactionReceipt({ hash: approveTxHash })
    console.log(`[onchainPublisher] Approval confirmed: ${approveTxHash}`)
  } else {
    console.log(`[onchainPublisher] Allowance sufficient (${allowance} >= ${totalWei}), skipping approve`)
  }

  // ── Step 2: Call createDistribution() ────────────────────────────────────
  const txHash = await walletClient.writeContract({
    address: distributorAddr,
    abi: DISTRIBUTOR_ABI,
    functionName: 'createDistribution',
    args: [merkleRootBytes32, tokenAddr, totalWei],
  })

  console.log(`[onchainPublisher] createDistribution tx submitted: ${txHash}`)

  // ── Step 3: Wait for receipt + parse DistributionCreated event ────────────
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

  if (receipt.status !== 'success') {
    throw new Error(
      `[onchainPublisher] Transaction ${txHash} reverted. ` +
      `Check: deployer balance, token allowance, merkle root validity.`
    )
  }

  let onchainId: string | null = null

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: DISTRIBUTOR_ABI,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'DistributionCreated') {
        // distributionId is a uint256 — use toString() to avoid serialisation issues
        onchainId = (decoded.args.distributionId as bigint).toString()
        break
      }
    } catch {
      // Log from a different contract in the same block — skip
    }
  }

  if (!onchainId) {
    throw new Error(
      `[onchainPublisher] DistributionCreated event not found in receipt for tx ${txHash}. ` +
      `The contract may have emitted a different event signature — check the ABI.`
    )
  }

  console.log(
    `[onchainPublisher] ✓ DistributionCreated: onchain_id=${onchainId}, tx=${txHash}`
  )

  // ── Step 4: Write onchain_id back to Supabase ──────────────────────────────
  const supabase = createSupabaseServiceClient()

  const { error: updateErr } = await supabase
    .from('distributions')
    .update({
      onchain_id:   onchainId,
      status:       'published',
      tx_hash:      txHash,
      published_at: new Date().toISOString(),
    })
    .eq('id', distribution_db_id)

  if (updateErr) {
    // CRITICAL: on-chain is live but DB update failed.
    // The distribution IS published and claimable, but our DB says 'pending'.
    // The operator MUST run the recovery query below manually.
    const recovery =
      `UPDATE distributions ` +
      `SET onchain_id=${onchainId}, status='published', tx_hash='${txHash}', ` +
      `published_at=NOW() WHERE id='${distribution_db_id}';`

    console.error(
      `[onchainPublisher] CRITICAL: on-chain published (onchain_id=${onchainId}) ` +
      `but Supabase UPDATE failed for distribution ${distribution_db_id}: ${updateErr.message}. ` +
      `Recovery query: ${recovery}`
    )

    // Still throw so the cron logs the failure — do NOT silently swallow this
    throw new Error(`[onchainPublisher] Supabase update failed after publish: ${updateErr.message}`)
  }

  console.log(
    `[onchainPublisher] ✓ distributions.${distribution_db_id} updated: ` +
    `onchain_id=${onchainId}, status=published`
  )

  return { onchain_id: onchainId, tx_hash: txHash }
}
