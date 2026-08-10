// =============================================================================
// rangeProposer.ts — T4.2 — AI Range Optimizer: proposal algorithm + EIP-712
//
// Responsibilities:
//   1. Decide whether to rebalance based on VolatilityMetrics from T4.1
//   2. Build a RangeProposal struct with the new tick range
//   3. Sign it with the oracle key using EIP-712
//   4. Store the signed proposal in Supabase vault_rebalance_proposals
//
// Flow: cron/trigger → fetch metrics (T4.1) → assessRebalanceNeed
//         → if needed: signRangeProposal → store → return SignedRangeProposal
//
// T4.3 wires the stored proposal to SocialVault.rebalanceWithProposal()
// so that anyone (permissionless) can submit the signed proposal on-chain.
//
// EIP-712 domain: MWSocialVault / version 1 / chainId / verifyingContract
// Typed data must match RANGE_TYPEHASH in SocialVault.sol (added in T4.3):
//   keccak256("RangeProposal(bytes32 vaultId,int24 tickLower,int24 tickUpper,uint256 validUntil,uint256 nonce)")
//
// Required env vars (server-side only):
//   ORACLE_PRIVATE_KEY         — 64 hex chars (0x optional). Falls back to DISTRIBUTOR_PRIVATE_KEY.
//   NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS — deployed SocialVault contract address
//
// Architecture: Web3 layer — oracle signing, contract interaction
// =============================================================================

import { createWalletClient, http, keccak256, toBytes } from 'viem'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { base, baseSepolia } from 'viem/chains'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import type { VolatilityMetrics } from './volatilityMonitor'

// ─── Constants ────────────────────────────────────────────────────────────────

// Proposal validity window: 4 hours from signing.
// Long enough to batch multiple vaults; short enough to stay fresh.
const PROPOSAL_VALIDITY_SECS = 4 * 60 * 60

// Rebalance triggers — tuned conservatively to avoid thrash on normal noise
export const THRESHOLDS = {
  // Trigger if price has exited the current range entirely
  OUT_OF_RANGE: true,

  // Trigger if current range midpoint has drifted > 8% from current price
  // (range is still valid but increasingly off-center)
  DRIFT_PCT: 8,

  // Trigger if proposed range width > 50% wider than current range
  // (volatility regime has expanded, range is now too tight)
  NARROW_RATIO: 0.60,

  // Trigger if proposed range width < 40% of current range
  // (volatility regime has compressed, range is unnecessarily wide → fees diluted)
  WIDE_RATIO: 2.5,
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type RebalanceReason =
  | 'price_out_of_range'   // price exited current tick range entirely
  | 'range_drifted'        // midpoint drifted > DRIFT_PCT from current price
  | 'range_too_narrow'     // volatility expanded, proposed range significantly wider
  | 'range_too_wide'       // volatility compressed, range wastes fee concentration
  | 'scheduled'            // epoch-boundary scheduled rebalance (caller-forced)
  | 'none'                 // no rebalance needed

export interface CurrentTickRange {
  tickLower: number
  tickUpper: number
}

export interface RebalanceDecision {
  shouldRebalance: boolean
  reason:          RebalanceReason
  currentRange:    CurrentTickRange
  proposedTicks:   { tickLower: number; tickUpper: number }
  metrics:         Pick<VolatilityMetrics, 'currentPrice' | 'atrPct' | 'bollinger' | 'confidence'>
}

export interface RangeProposalParams {
  /** Supabase UUID of the social_vaults row */
  vaultDbId:        string
  /** Chain slug — 'base' | 'base_sepolia' */
  chain:            'base' | 'base_sepolia'
  /** Proposed tick range from assessRebalanceNeed */
  tickLower:        number
  tickUpper:        number
  /** Why this proposal was triggered */
  reason:           RebalanceReason
  /**
   * Monotonically increasing per vault — prevents replay.
   * Caller supplies from DB (count of prior proposals + 1).
   */
  nonce:            number
}

export interface SignedRangeProposal {
  vaultDbId:       string
  tickLower:       number
  tickUpper:       number
  reason:          RebalanceReason
  nonce:           number
  validUntil:      number   // Unix timestamp
  oracleSignature: string   // EIP-712 signature
  signerAddress:   string   // oracle public address (for contract verification)
}

// ─── EIP-712 typed data ───────────────────────────────────────────────────────
// Must match RANGE_TYPEHASH added to SocialVault.sol in T4.3.
// "RangeProposal(bytes32 vaultId,int24 tickLower,int24 tickUpper,uint256 validUntil,uint256 nonce)"

const RANGE_TYPED_DATA = {
  types: {
    RangeProposal: [
      { name: 'vaultId',    type: 'bytes32' },
      { name: 'tickLower',  type: 'int24'   },
      { name: 'tickUpper',  type: 'int24'   },
      { name: 'validUntil', type: 'uint256' },
      { name: 'nonce',      type: 'uint256' },
    ],
  },
  primaryType: 'RangeProposal' as const,
}

// ─── Chain setup ─────────────────────────────────────────────────────────────

function getChainForSlug(slug: 'base' | 'base_sepolia') {
  return slug === 'base' ? base : baseSepolia
}

function getRpcForSlug(slug: 'base' | 'base_sepolia'): string {
  return slug === 'base'
    ? (process.env.BASE_RPC_URL ?? 'https://mainnet.base.org')
    : (process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org')
}

// ─── assessRebalanceNeed ──────────────────────────────────────────────────────
// Pure function — no I/O. Takes the current on-chain tick range + latest
// volatility metrics and returns whether to rebalance and why.

export function assessRebalanceNeed(
  current:   CurrentTickRange,
  metrics:   VolatilityMetrics,
  forced?:   boolean,
): RebalanceDecision {
  const { currentPrice, suggestedTicks } = metrics

  const decision = (reason: RebalanceReason): RebalanceDecision => ({
    shouldRebalance: reason !== 'none',
    reason,
    currentRange:    current,
    proposedTicks:   suggestedTicks,
    metrics: {
      currentPrice:  metrics.currentPrice,
      atrPct:        metrics.atrPct,
      bollinger:     metrics.bollinger,
      confidence:    metrics.confidence,
    },
  })

  // Scheduled (forced by caller — e.g. epoch boundary)
  if (forced) return decision('scheduled')

  // Tick → price: 1.0001^tick (inlined to avoid circular dep with volatilityMonitor)
  const priceLower = Math.pow(1.0001, current.tickLower)
  const priceUpper = Math.pow(1.0001, current.tickUpper)
  // Geometric midpoint: tickToPrice(midTick) — correct for log-scale tick ranges.
  // Arithmetic mean of priceLower + priceUpper skews high due to log scale.
  const midTick  = (current.tickLower + current.tickUpper) / 2
  const midPrice = Math.pow(1.0001, midTick)
  const currentWidth = current.tickUpper - current.tickLower
  const proposedWidth = suggestedTicks.tickUpper - suggestedTicks.tickLower

  // 1. Price out of current range
  if (currentPrice < priceLower || currentPrice > priceUpper) {
    return decision('price_out_of_range')
  }

  // 2. Range midpoint has drifted too far from current price
  const driftPct = Math.abs(midPrice - currentPrice) / currentPrice * 100
  if (driftPct > THRESHOLDS.DRIFT_PCT) {
    return decision('range_drifted')
  }

  // 3. Volatility expanded — proposed range is significantly wider
  if (proposedWidth > currentWidth / THRESHOLDS.NARROW_RATIO) {
    return decision('range_too_narrow')
  }

  // 4. Volatility compressed — proposed range is significantly narrower
  if (proposedWidth * THRESHOLDS.WIDE_RATIO < currentWidth) {
    return decision('range_too_wide')
  }

  return decision('none')
}

// ─── signRangeProposal ────────────────────────────────────────────────────────
// Signs the range proposal with the oracle key using EIP-712.
// Stores the signed proposal in Supabase vault_rebalance_proposals.
// Returns the full SignedRangeProposal (including signature).

export async function signRangeProposal(params: RangeProposalParams): Promise<SignedRangeProposal> {
  const { vaultDbId, chain: chainSlug, tickLower, tickUpper, reason, nonce } = params

  // ── Oracle wallet (range role — audit C2: no longer falls back to the root key)
  const socialVaultAddress = process.env.NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS
  if (!socialVaultAddress) {
    throw new Error('[rangeProposer] NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS is not set.')
  }

  const account    = await getOracleSigner('range')
  const chain      = getChainForSlug(chainSlug)
  const transport  = http(getRpcForSlug(chainSlug))
  const client     = createWalletClient({ account, chain, transport })

  const validUntil = Math.floor(Date.now() / 1000) + PROPOSAL_VALIDITY_SECS

  // vaultId in the contract = keccak256(bytes(uuid)) — same pattern as campaignId
  const vaultIdBytes32 = keccak256(toBytes(vaultDbId)) as `0x${string}`

  const domain = {
    name:              'MintwareVault', // must match MintwareBaseVault4626 EIP712("MintwareVault","1")
    version:           '1',
    chainId:           chain.id,
    verifyingContract: socialVaultAddress as `0x${string}`,
  }

  console.log(
    `[rangeProposer] Signing range proposal vault=${vaultDbId} ` +
    `ticks=[${tickLower},${tickUpper}] reason=${reason} nonce=${nonce} ` +
    `validUntil=${validUntil} chain=${chainSlug}`
  )

  const oracleSignature = await client.signTypedData({
    account,
    domain,
    types:       RANGE_TYPED_DATA.types,
    primaryType: RANGE_TYPED_DATA.primaryType,
    message: {
      vaultId:    vaultIdBytes32,
      tickLower:  tickLower,
      tickUpper:  tickUpper,
      validUntil: BigInt(validUntil),
      nonce:      BigInt(nonce),
    },
  })

  console.log(
    `[rangeProposer] ✓ Signed: oracle=${account.address} sig=${oracleSignature.slice(0, 12)}...`
  )

  // ── Store in Supabase ───────────────────────────────────────────────────────
  const supabase = createSupabaseServiceClient()

  const { error: insertErr } = await supabase
    .from('vault_rebalance_proposals')
    .insert({
      vault_id:         vaultDbId,
      tick_lower:       tickLower,
      tick_upper:       tickUpper,
      reason,
      oracle_signature: oracleSignature,
      signer_address:   account.address,
      valid_until:      validUntil,
      nonce,
      status:           'pending',
    })

  if (insertErr) {
    console.error(
      `[rangeProposer] CRITICAL: proposal signed but DB insert failed for vault ${vaultDbId}: ` +
      `${insertErr.message}. sig=${oracleSignature.slice(0, 12)}...{REDACTED}`
    )
    throw new Error(`[rangeProposer] Supabase insert failed after signing: ${insertErr.message}`)
  }

  return {
    vaultDbId,
    tickLower,
    tickUpper,
    reason,
    nonce,
    validUntil,
    oracleSignature,
    signerAddress: account.address,
  }
}

// ─── proposeRebalance — top-level orchestrator ────────────────────────────────
// Fetches the next nonce from DB, runs decision logic, and signs if needed.
// Used by the rebalance API route.

export async function proposeRebalance(
  vaultDbId:    string,
  currentRange: CurrentTickRange,
  metrics:      VolatilityMetrics,
  chain:        'base' | 'base_sepolia',
  forced?:      boolean,
): Promise<{ decision: RebalanceDecision; proposal?: SignedRangeProposal }> {
  const decision = assessRebalanceNeed(currentRange, metrics, forced)

  if (!decision.shouldRebalance) {
    return { decision }
  }

  // Get next nonce: count of existing proposals for this vault + 1
  const supabase = createSupabaseServiceClient()
  const { count, error: countErr } = await supabase
    .from('vault_rebalance_proposals')
    .select('*', { count: 'exact', head: true })
    .eq('vault_id', vaultDbId)

  if (countErr) {
    throw new Error(`[rangeProposer] Failed to fetch proposal count: ${countErr.message}`)
  }

  const nonce = (count ?? 0) + 1

  const proposal = await signRangeProposal({
    vaultDbId,
    chain,
    tickLower: decision.proposedTicks.tickLower,
    tickUpper: decision.proposedTicks.tickUpper,
    reason:    decision.reason,
    nonce,
  })

  return { decision, proposal }
}
