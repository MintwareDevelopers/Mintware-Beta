// =============================================================================
// onchainPublisher.ts — Oracle EIP-712 signer (zero oracle gas)
//
// Replaces the old createDistribution() on-chain transaction with a pure
// off-chain EIP-712 signature. The oracle signs the Merkle root; users submit
// that signature alongside their proof in a single claim() transaction.
//
// Old model (expensive):
//   Oracle txn: createDistribution(root, token, totalAmount) — oracle pays gas
//   User txn:   claim(distributionId, amount, proof)
//
// New model (zero oracle gas):
//   Oracle signs: { campaignId, epochNumber, merkleRoot } with EIP-712 — zero gas
//   User txn:     claim(campaignId, epochNumber, merkleRoot, oracleSig, amount, proof)
//
// What this module does:
//   1. Builds the EIP-712 domain from the contract address + chain (chainId from RPC)
//   2. Signs { campaignId, epochNumber, merkleRoot } with DISTRIBUTOR_PRIVATE_KEY
//   3. Stores oracle_signature in Supabase distributions row → status='published'
//   4. Optionally auto-claims the treasury's fee leaf (token pool campaigns only)
//
// Required env vars:
//   DISTRIBUTOR_PRIVATE_KEY  — 64 hex chars (0x prefix optional)
//                              This is the oracle signing key.
//                              For auto-claim, the derived address must be the
//                              treasury wallet (MINTWARE_TREASURY_ADDRESS).
//   BASE_RPC_URL             — (optional) defaults to https://mainnet.base.org
//   BASE_SEPOLIA_RPC_URL     — (optional) defaults to https://sepolia.base.org
//   CORE_DAO_RPC_URL         — (optional) defaults to https://rpc.coredao.org
//   BNB_RPC_URL              — (optional) defaults to https://bsc-dataseed.binance.org
//
// Security: DISTRIBUTOR_PRIVATE_KEY is a server-side secret. It must NEVER
// appear in client bundles, responses, or logs.
// =============================================================================

import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, bsc } from 'viem/chains'
import { createSupabaseServiceClient } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// ABIs — only what we need from the new contract
// ---------------------------------------------------------------------------

const DISTRIBUTOR_ABI = parseAbi([
  // claim() — used for optional treasury auto-claim after signing
  'function claim(string calldata campaignId, uint256 epochNumber, bytes32 merkleRoot, bytes calldata oracleSignature, uint256 amount, bytes32[] calldata merkleProof)',
  'event Claimed(string campaignId, uint256 indexed epochNumber, address indexed claimant, uint256 amount)',
])

// ---------------------------------------------------------------------------
// Chain definitions
// viem/chains ships base, baseSepolia, bsc. Core DAO needs a custom definition.
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
    case 'base':         return process.env.BASE_RPC_URL         ?? 'https://mainnet.base.org'
    case 'base_sepolia': return process.env.BASE_SEPOLIA_RPC_URL  ?? 'https://sepolia.base.org'
    case 'core_dao':     return process.env.CORE_DAO_RPC_URL      ?? 'https://rpc.coredao.org'
    case 'bnb':          return process.env.BNB_RPC_URL            ?? 'https://bsc-dataseed.binance.org'
    default:             throw new Error(`[onchainPublisher] No RPC URL for chain: "${slug}"`)
  }
}

// ---------------------------------------------------------------------------
// EIP-712 typed data definition
// Must match ROOT_TYPEHASH in MintwareDistributor.sol exactly.
// ---------------------------------------------------------------------------

const ROOT_TYPED_DATA = {
  types: {
    RootPublication: [
      { name: 'campaignId',   type: 'string'  },
      { name: 'epochNumber',  type: 'uint256' },
      { name: 'merkleRoot',   type: 'bytes32' },
    ],
  },
  primaryType: 'RootPublication' as const,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublishParams {
  /** Supabase UUID of the distributions row */
  distribution_db_id: string
  /** Supabase campaign UUID — used as campaignId in claim() */
  campaign_id_str: string
  /** Epoch number (1-indexed) — scopes double-claim protection per epoch */
  epoch_number: number
  /** '0x...' Merkle root from StandardMerkleTree.root */
  merkle_root: string
  /** Deployed MintwareDistributor contract address */
  contract_address: string
  /** Chain slug: 'base' | 'base_sepolia' | 'core_dao' | 'bnb' */
  chain: string
  /**
   * Optional: auto-claim the treasury's fee reward immediately after signing.
   *
   * Only applies to token pool campaigns (points campaigns have no fee leaf).
   * The DISTRIBUTOR_PRIVATE_KEY wallet must equal MINTWARE_TREASURY_ADDRESS for
   * the claim to land in the right place — claim() transfers to msg.sender.
   *
   * If auto-claim fails: non-fatal. Oracle signature is already stored.
   * Treasury can call claim() manually at any time using the stored signature.
   */
  treasury_claim?: {
    amount_wei: string    // treasury's token allocation (string bigint)
    proof: string[]       // Merkle inclusion proof from StandardMerkleTree
  }
}

export interface PublishResult {
  /** EIP-712 signature — returned to /api/claim, submitted by users in claim() */
  oracle_signature: string
  /** Treasury auto-claim tx hash, if it ran and succeeded */
  treasury_claim_tx?: string
}

// ---------------------------------------------------------------------------
// publishDistribution — the main export
//
// Signs the Merkle root off-chain (zero gas), stores the signature in Supabase,
// and optionally auto-claims the treasury fee.
// ---------------------------------------------------------------------------

export async function publishDistribution(params: PublishParams): Promise<PublishResult> {
  const {
    distribution_db_id,
    campaign_id_str,
    epoch_number,
    merkle_root,
    contract_address,
    chain: chainSlug,
  } = params

  // ── Oracle wallet setup ────────────────────────────────────────────────────
  const rawKey = process.env.DISTRIBUTOR_PRIVATE_KEY
  if (!rawKey) {
    throw new Error(
      '[onchainPublisher] DISTRIBUTOR_PRIVATE_KEY is not set. ' +
      'Add it to .env.local: DISTRIBUTOR_PRIVATE_KEY=<64 hex chars>'
    )
  }

  const privateKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`
  const account    = privateKeyToAccount(privateKey)

  const chain     = getChain(chainSlug)
  const transport = http(getRpcUrl(chainSlug))

  // publicClient is needed to read chainId for the EIP-712 domain
  // and for waitForTransactionReceipt during auto-claim
  const publicClient = createPublicClient({ chain, transport })
  const walletClient = createWalletClient({ account, chain, transport })

  const distributorAddr  = contract_address as `0x${string}`
  const merkleRootBytes32 = (
    merkle_root.startsWith('0x') ? merkle_root : `0x${merkle_root}`
  ) as `0x${string}`

  console.log(
    `[onchainPublisher] Signing root for distribution ${distribution_db_id} ` +
    `campaign=${campaign_id_str} epoch=${epoch_number} ` +
    `chain=${chainSlug} root=${merkle_root.slice(0, 10)}...`
  )

  // ── Step 1: Sign the Merkle root with EIP-712 (zero gas) ─────────────────
  // The EIP-712 domain includes chainId (from chain.id) and verifyingContract.
  // This makes signatures chain-specific — replay across chains is impossible.
  const domain = {
    name:              'MintwareDistributor',
    version:           '1',
    chainId:           chain.id,
    verifyingContract: distributorAddr,
  }

  const oracleSignature = await walletClient.signTypedData({
    account,
    domain,
    types:       ROOT_TYPED_DATA.types,
    primaryType: ROOT_TYPED_DATA.primaryType,
    message: {
      campaignId:  campaign_id_str,
      epochNumber: BigInt(epoch_number),
      merkleRoot:  merkleRootBytes32,
    },
  })

  console.log(
    `[onchainPublisher] ✓ Root signed: distribution=${distribution_db_id} ` +
    `oracle=${account.address} sig=${oracleSignature.slice(0, 12)}...`
  )

  // ── Step 2: Store oracle_signature in Supabase → status='published' ───────
  const supabase = createSupabaseServiceClient()

  const { error: updateErr } = await supabase
    .from('distributions')
    .update({
      oracle_signature: oracleSignature,
      status:           'published',
      published_at:     new Date().toISOString(),
    })
    .eq('id', distribution_db_id)

  if (updateErr) {
    // CRITICAL: signature is valid but DB update failed.
    // The distribution IS ready to claim — users just need the signature.
    // Operator must run the recovery query below manually.
    const recovery =
      `UPDATE distributions ` +
      `SET oracle_signature='${oracleSignature}', status='published', ` +
      `published_at=NOW() WHERE id='${distribution_db_id}';`

    console.error(
      `[onchainPublisher] CRITICAL: root signed (sig=${oracleSignature.slice(0, 12)}...) ` +
      `but Supabase UPDATE failed for distribution ${distribution_db_id}: ${updateErr.message}. ` +
      `Recovery query: ${recovery}`
    )

    throw new Error(`[onchainPublisher] Supabase update failed after signing: ${updateErr.message}`)
  }

  console.log(
    `[onchainPublisher] ✓ distributions.${distribution_db_id} updated: ` +
    `oracle_signature stored, status=published`
  )

  // ── Step 3: Auto-claim treasury fee (optional) ────────────────────────────
  // Only for token pool campaign fee settlements. Points campaigns never pass this
  // (no fee logic runs for points campaigns per spec).
  // If auto-claim fails: non-fatal. Signature is stored. Treasury claims manually.
  //
  // GUARD: claim() sends tokens to msg.sender (the oracle wallet). For fees to land
  // in MINTWARE_TREASURY_ADDRESS the oracle wallet MUST equal the treasury address.
  // If they differ, skip auto-claim and log a warning — treasury claims manually.
  let treasury_claim_tx: string | undefined

  if (params.treasury_claim) {
    const treasuryAddr = (process.env.MINTWARE_TREASURY_ADDRESS ?? '').toLowerCase()
    if (treasuryAddr && account.address.toLowerCase() !== treasuryAddr) {
      console.warn(
        `[onchainPublisher] Skipping treasury auto-claim for distribution ${distribution_db_id}: ` +
        `oracle wallet (${account.address}) ≠ MINTWARE_TREASURY_ADDRESS (${treasuryAddr}). ` +
        `claim() sends to msg.sender — fees would land in the oracle wallet, not the treasury. ` +
        `Treasury must call claim() manually using the stored oracle_signature.`
      )
      return { oracle_signature: oracleSignature }
    }
  }

  if (params.treasury_claim) {
    const { amount_wei, proof } = params.treasury_claim
    try {
      const claimTxHash = await walletClient.writeContract({
        address: distributorAddr,
        abi:     DISTRIBUTOR_ABI,
        functionName: 'claim',
        args: [
          campaign_id_str,
          BigInt(epoch_number),
          merkleRootBytes32,
          oracleSignature,
          BigInt(amount_wei),
          proof as `0x${string}`[],
        ],
      })
      await publicClient.waitForTransactionReceipt({ hash: claimTxHash })
      treasury_claim_tx = claimTxHash
      console.log(
        `[onchainPublisher] ✓ Treasury auto-claim: distribution=${distribution_db_id} ` +
        `amount=${amount_wei} tx=${claimTxHash}`
      )
    } catch (claimErr) {
      const msg = claimErr instanceof Error ? claimErr.message : String(claimErr)
      console.error(
        `[onchainPublisher] ⚠ Treasury auto-claim failed for distribution ${distribution_db_id}: ${msg}. ` +
        `Claim manually: contract.claim(${campaign_id_str}, ${epoch_number}, ${merkle_root}, oracleSig, ${amount_wei}, proof)`
      )
    }
  }

  return { oracle_signature: oracleSignature, treasury_claim_tx }
}
