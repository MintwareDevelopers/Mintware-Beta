// =============================================================================
// lib/eas.ts  —  Server-side EAS offchain attestation helpers
//
// NEVER import this file from client components. It depends on ethers + the
// EAS SDK (ethers v6) and the EAS_ATTESTER_PRIVATE_KEY env variable.
//
// All four attestation functions follow the same pattern:
//   1. Build an ethers signer from EAS_ATTESTER_PRIVATE_KEY
//   2. Create an EAS offchain instance for the configured chain
//   3. ABI-encode the attestation data via SchemaEncoder
//   4. Call offchain.signOffchainAttestation() — free, no gas
//   5. Return the deterministic UID string
//
// Fire-and-forget callers must never await these functions if they're on the
// critical path. Wrap in .catch() to silence errors without blocking.
// =============================================================================

import { EAS, Offchain, SchemaEncoder, OffchainAttestationVersion } from '@ethereum-attestation-service/eas-sdk'
import { ethers } from 'ethers'

// ---------------------------------------------------------------------------
// Config — read from env at call time (not at module load) so Edge/serverless
// cold-start doesn't crash on missing keys.
// ---------------------------------------------------------------------------

const BASE_RPC_URL        = 'https://mainnet.base.org'
const BASE_CHAIN_ID       = 8453

function getAttesterWallet(): ethers.Wallet {
  const key = process.env.EAS_ATTESTER_PRIVATE_KEY
  if (!key) throw new Error('[eas] EAS_ATTESTER_PRIVATE_KEY is not set')
  const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
  return new ethers.Wallet(key, provider)
}

function getEasContract(): string {
  const addr = process.env.EAS_CONTRACT_ADDRESS
  if (!addr) throw new Error('[eas] EAS_CONTRACT_ADDRESS is not set')
  return addr
}

type SchemaName = 'ATTRIBUTION_SCORE' | 'ATTRIBUTION_SCORE_V3' | 'SWAP_ACTIVITY' | 'REFERRAL_LINK' | 'CAMPAIGN_REWARD' | 'ORG_MEMBERSHIP'

function getSchemaUID(name: SchemaName): string {
  const key = `NEXT_PUBLIC_EAS_SCHEMA_${name}`
  const uid = process.env[key]
  if (!uid) throw new Error(`[eas] ${key} is not set`)
  return uid
}

/** True once an operator has registered the v3 schema on-chain and set its UID. */
function v3SchemaConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_EAS_SCHEMA_ATTRIBUTION_SCORE_V3)
}

const ZERO_UID = '0x0000000000000000000000000000000000000000000000000000000000000000'

// ---------------------------------------------------------------------------
// Schema strings — must exactly match what was registered on-chain
// ---------------------------------------------------------------------------

const SCHEMA_ATTRIBUTION_SCORE =
  'uint256 score,uint16 maxScore,uint8 percentile,string tier,uint8 scoreVolume,uint8 scoreTrading,uint8 scoreHolding,uint8 scoreLiquidity,uint8 scoreGovernance,uint16 scoreSharing,uint16 treeSize,uint16 treeQualityBps,uint8 chains,uint32 totalTxCount,string character,bytes32 dataHash,uint64 scoredAt,uint8 schemaVersion'

// ---------------------------------------------------------------------------
// v2 → legacy on-chain field mapping (audit fix, 2026-08-18)
//
// The schema above was registered on-chain for the LEGACY 6-signal engine
// (volume/trading/holding/liquidity/governance/sharing). Engine v2
// (`lib/attribution/signals.ts`) uses 7 different signal keys — trading and
// sharing don't exist anymore (renamed/replaced by activity+longevity and
// network respectively). Because the on-chain schema is immutable once
// registered, we can't add fields for activity/longevity without a new
// schema registration (tracked: `docs/developers/attribution-trust-graph-spec.md`
// §5 — SCHEMA_ATTRIBUTION_SCORE_V3 below is the ready-to-register replacement).
//
// Until that's registered, this is an EXPLICIT, audited mapping into the
// existing legacy fields — not a silent `.find(key === 'trading')` that
// quietly returns undefined for a key that no longer exists (which is what
// this function replaces; that bug caused every attestation to permanently
// zero scoreTrading/scoreSharing and drop activity/longevity/network
// entirely). `scoreTrading` has no v2 equivalent and stays 0 — documented,
// not accidental.
// ---------------------------------------------------------------------------

export function mapV2SignalsToLegacyFields(signals: { key: string; score: number }[]): {
  scoreVolume: number; scoreTrading: number; scoreHolding: number
  scoreLiquidity: number; scoreGovernance: number; scoreSharing: number
} {
  const byKey = (key: string) => signals.find(s => s.key === key)?.score ?? 0
  return {
    scoreVolume:     byKey('volume'),
    scoreTrading:    0, // no v2 equivalent (was a separate signal, now folded into activity/longevity)
    scoreHolding:    byKey('holding'),
    scoreLiquidity:  byKey('liquidity'),
    scoreGovernance: byKey('governance'),
    scoreSharing:    byKey('network'), // v2's renamed, quality-weighted successor to legacy "sharing"
  }
}

// ---------------------------------------------------------------------------
// v3 schema — NOT YET REGISTERED on-chain. Ready for registration via EAS's
// SchemaRegistry once an operator deploys it; set
// NEXT_PUBLIC_EAS_SCHEMA_ATTRIBUTION_SCORE_V3 after registering, and
// attestScore() below will use it automatically (falls back to the legacy
// schema/mapping above until then — see buildScoreEncoding()).
// ---------------------------------------------------------------------------

const SCHEMA_ATTRIBUTION_SCORE_V3 =
  'uint256 score,uint16 maxScore,uint8 percentile,string tier,uint8 scoreVolume,uint8 scoreHolding,uint8 scoreActivity,uint8 scoreLongevity,uint8 scoreLiquidity,uint8 scoreNetwork,uint8 scoreGovernance,uint16 riskPenalty,uint16 treeSize,uint16 treeQualityBps,uint8 chains,uint32 totalTxCount,string character,bytes32 dataHash,uint64 scoredAt,uint8 schemaVersion'

// Flat org membership — deliberately NOT a computed tier or weighted score.
// "This wallet belongs to this org, in this role" — an org's own signer
// attests it; Mintware never issues these. See `attestOrgMembership` below.
const SCHEMA_ORG_MEMBERSHIP =
  'address org,address member,string role,uint64 joinedAt,uint8 schemaVersion'

const SCHEMA_SWAP_ACTIVITY =
  'bytes32 txHash,uint32 fromChain,uint32 toChain,address fromToken,address toToken,uint256 amountIn,bool feeVerified,string campaignId,uint64 swappedAt,uint8 schemaVersion'

const SCHEMA_REFERRAL_LINK =
  'address referrer,string refCode,uint64 linkedAt,uint8 schemaVersion'

const SCHEMA_CAMPAIGN_REWARD =
  'string campaignId,uint32 epochNumber,uint256 amountClaimed,address tokenContract,bytes32 claimTxHash,uint64 claimedAt,uint8 schemaVersion'

// ---------------------------------------------------------------------------
// Shared: build offchain signer
// ---------------------------------------------------------------------------

async function buildOffchain(): Promise<{ offchain: Offchain; signer: ethers.Wallet }> {
  const signer      = getAttesterWallet()
  const eas         = new EAS(getEasContract())
  eas.connect(signer)
  const offchain    = await eas.getOffchain()
  return { offchain, signer }
}

// ---------------------------------------------------------------------------
// Score data shape — mirrors /score API response fields we attest
// ---------------------------------------------------------------------------

export interface ScoreAttestData {
  score:        number
  maxScore:     number
  percentile:   number
  tier:         string
  signals:      { key: string; score: number }[]
  treeSize:     number
  treeQuality:  string           // "0.00" string from API
  chains:       number
  totalTxCount: number
  character:    { label: string }
  /** v2's Risk deduction (≥0, already applied to `score`). Optional for
   *  backward compat with older callers; defaults to 0 if omitted. Only
   *  attested once the v3 schema is registered — see v3SchemaConfigured(). */
  riskPenalty?: number
}

// ---------------------------------------------------------------------------
// attestScore
//
// Signs an AttributionScore offchain attestation for the given wallet.
// Returns the UID string.
// ---------------------------------------------------------------------------

export async function attestScore(
  wallet:    string,
  scoreData: ScoreAttestData,
  /** UID of another attestation this one references (EAS `refUID` chaining —
   *  see `docs/developers/attribution-trust-graph-spec.md` §5). Omit for a
   *  root attestation. */
  refUID:    string = ZERO_UID
): Promise<string> {
  const { offchain, signer } = await buildOffchain()
  const treeQualityBps       = Math.round(parseFloat(scoreData.treeQuality) * 100)
  const dataHash              = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(scoreData)))
  const scoredAt               = BigInt(Math.floor(Date.now() / 1000))
  const useV3                   = v3SchemaConfigured()

  const schemaUID = getSchemaUID(useV3 ? 'ATTRIBUTION_SCORE_V3' : 'ATTRIBUTION_SCORE')

  const encoder = new SchemaEncoder(useV3 ? SCHEMA_ATTRIBUTION_SCORE_V3 : SCHEMA_ATTRIBUTION_SCORE)
  const byKey = (key: string) => scoreData.signals.find(s => s.key === key)?.score ?? 0

  const encoded = useV3
    ? encoder.encodeData([
        { name: 'score',          value: BigInt(scoreData.score),        type: 'uint256' },
        { name: 'maxScore',       value: scoreData.maxScore,             type: 'uint16'  },
        { name: 'percentile',     value: scoreData.percentile,           type: 'uint8'   },
        { name: 'tier',           value: scoreData.tier,                 type: 'string'  },
        { name: 'scoreVolume',    value: byKey('volume'),                type: 'uint8'   },
        { name: 'scoreHolding',   value: byKey('holding'),               type: 'uint8'   },
        { name: 'scoreActivity',  value: byKey('activity'),              type: 'uint8'   },
        { name: 'scoreLongevity', value: byKey('longevity'),             type: 'uint8'   },
        { name: 'scoreLiquidity', value: byKey('liquidity'),             type: 'uint8'   },
        { name: 'scoreNetwork',   value: byKey('network'),               type: 'uint8'   },
        { name: 'scoreGovernance',value: byKey('governance'),            type: 'uint8'   },
        { name: 'riskPenalty',    value: scoreData.riskPenalty ?? 0,     type: 'uint16'  },
        { name: 'treeSize',       value: scoreData.treeSize,             type: 'uint16'  },
        { name: 'treeQualityBps', value: treeQualityBps,                 type: 'uint16'  },
        { name: 'chains',         value: scoreData.chains,               type: 'uint8'   },
        { name: 'totalTxCount',   value: scoreData.totalTxCount,         type: 'uint32'  },
        { name: 'character',      value: scoreData.character.label,      type: 'string'  },
        { name: 'dataHash',       value: dataHash,                       type: 'bytes32' },
        { name: 'scoredAt',       value: scoredAt,                       type: 'uint64'  },
        { name: 'schemaVersion',  value: 3,                              type: 'uint8'   },
      ])
    : (() => {
        const legacy = mapV2SignalsToLegacyFields(scoreData.signals)
        return encoder.encodeData([
          { name: 'score',          value: BigInt(scoreData.score),        type: 'uint256' },
          { name: 'maxScore',       value: scoreData.maxScore,             type: 'uint16'  },
          { name: 'percentile',     value: scoreData.percentile,           type: 'uint8'   },
          { name: 'tier',           value: scoreData.tier,                 type: 'string'  },
          { name: 'scoreVolume',    value: legacy.scoreVolume,             type: 'uint8'   },
          { name: 'scoreTrading',   value: legacy.scoreTrading,            type: 'uint8'   },
          { name: 'scoreHolding',   value: legacy.scoreHolding,            type: 'uint8'   },
          { name: 'scoreLiquidity', value: legacy.scoreLiquidity,          type: 'uint8'   },
          { name: 'scoreGovernance',value: legacy.scoreGovernance,         type: 'uint8'   },
          { name: 'scoreSharing',   value: legacy.scoreSharing,            type: 'uint16'  },
          { name: 'treeSize',       value: scoreData.treeSize,             type: 'uint16'  },
          { name: 'treeQualityBps', value: treeQualityBps,                 type: 'uint16'  },
          { name: 'chains',         value: scoreData.chains,               type: 'uint8'   },
          { name: 'totalTxCount',   value: scoreData.totalTxCount,         type: 'uint32'  },
          { name: 'character',      value: scoreData.character.label,      type: 'string'  },
          { name: 'dataHash',       value: dataHash,                       type: 'bytes32' },
          { name: 'scoredAt',       value: scoredAt,                       type: 'uint64'  },
          { name: 'schemaVersion',  value: 1,                              type: 'uint8'   },
        ])
      })()

  const attestation = await offchain.signOffchainAttestation(
    {
      recipient:      wallet.toLowerCase() as `0x${string}`,
      schema:         schemaUID,
      data:           encoded,
      revocable:      true,
      time:           scoredAt,
      expirationTime: 0n,
      refUID,
    },
    signer
  )

  return attestation.uid
}

// ---------------------------------------------------------------------------
// SwapData — fields from verifySwapTx + campaign context
// ---------------------------------------------------------------------------

export interface SwapAttestData {
  txHash:     string
  fromChain:  number
  toChain:    number
  fromToken:  string
  toToken:    string
  amountIn:   bigint
  feeVerified: boolean
  campaignId: string
}

// ---------------------------------------------------------------------------
// attestSwap
//
// Signs a SwapActivity offchain attestation for a verified swap.
// ---------------------------------------------------------------------------

export async function attestSwap(
  wallet:   string,
  swapData: SwapAttestData,
  /** e.g. the wallet's latest AttributionScore attestation UID, so a swap can
   *  be chained to the reputation it fed into. */
  refUID:   string = ZERO_UID
): Promise<string> {
  const { offchain, signer } = await buildOffchain()
  const schemaUID            = getSchemaUID('SWAP_ACTIVITY')

  // Pad txHash to bytes32
  const txHashBytes = ethers.zeroPadValue(swapData.txHash as `0x${string}`, 32)

  const encoder = new SchemaEncoder(SCHEMA_SWAP_ACTIVITY)
  const encoded = encoder.encodeData([
    { name: 'txHash',       value: txHashBytes,                        type: 'bytes32'  },
    { name: 'fromChain',    value: swapData.fromChain,                 type: 'uint32'   },
    { name: 'toChain',      value: swapData.toChain,                   type: 'uint32'   },
    { name: 'fromToken',    value: swapData.fromToken as `0x${string}`, type: 'address' },
    { name: 'toToken',      value: swapData.toToken as `0x${string}`,   type: 'address' },
    { name: 'amountIn',     value: swapData.amountIn,                  type: 'uint256'  },
    { name: 'feeVerified',  value: swapData.feeVerified,               type: 'bool'     },
    { name: 'campaignId',   value: swapData.campaignId,                type: 'string'   },
    { name: 'swappedAt',    value: BigInt(Math.floor(Date.now() / 1000)), type: 'uint64' },
    { name: 'schemaVersion',value: 1,                                  type: 'uint8'    },
  ])

  const attestation = await offchain.signOffchainAttestation(
    {
      recipient:      wallet.toLowerCase() as `0x${string}`,
      schema:         schemaUID,
      data:           encoded,
      revocable:      false,
      time:           BigInt(Math.floor(Date.now() / 1000)),
      expirationTime: 0n,
      refUID,
    },
    signer
  )

  return attestation.uid
}

// ---------------------------------------------------------------------------
// attestReferral
//
// Signs a ReferralLink offchain attestation.
// Called fire-and-forget from POST /api/referral/apply after a successful upsert.
// ---------------------------------------------------------------------------

export async function attestReferral(
  referrer: string,
  referred: string,
  refCode:  string,
  /** e.g. the referrer's own AttributionScore attestation UID. */
  refUID:   string = ZERO_UID
): Promise<string> {
  const { offchain, signer } = await buildOffchain()
  const schemaUID            = getSchemaUID('REFERRAL_LINK')

  const encoder = new SchemaEncoder(SCHEMA_REFERRAL_LINK)
  const encoded = encoder.encodeData([
    { name: 'referrer',      value: referrer.toLowerCase() as `0x${string}`, type: 'address' },
    { name: 'refCode',       value: refCode,                                  type: 'string'  },
    { name: 'linkedAt',      value: BigInt(Math.floor(Date.now() / 1000)),    type: 'uint64'  },
    { name: 'schemaVersion', value: 1,                                        type: 'uint8'   },
  ])

  const attestation = await offchain.signOffchainAttestation(
    {
      recipient:      referred.toLowerCase() as `0x${string}`,
      schema:         schemaUID,
      data:           encoded,
      revocable:      false,
      time:           BigInt(Math.floor(Date.now() / 1000)),
      expirationTime: 0n,
      refUID,
    },
    signer
  )

  return attestation.uid
}

// ---------------------------------------------------------------------------
// attestOrgMembership
//
// Signs an OrgMembership offchain attestation — "this wallet belongs to this
// org, in this role." Deliberately flat: no tier, no weighted score, no
// pluggable trust source. Org tiering (if an org wants it) reads this
// attestation as raw input; it is not computed here.
//
// ⚠ v1 scoping note: signed by MINTWARE'S attester key (same as every other
// function in this file), on the org admin's authenticated request — NOT by
// the org's own key. A fully org-signed flow (the org holding its own
// attestation authority) is real future work, not implemented here; see
// `docs/developers/attribution-trust-graph-spec.md` §5. The route calling
// this MUST verify the caller is authorized to invite for `org` before
// calling it — this function does not check that itself.
// ---------------------------------------------------------------------------

export interface OrgMembershipAttestData {
  org:    string   // the org's identifying wallet/treasury address
  member: string   // the wallet being attested as a member
  role:   string   // org-defined, e.g. "admin" | "contributor" — free text, not an enum Mintware enforces
}

export async function attestOrgMembership(
  data:   OrgMembershipAttestData,
  refUID: string = ZERO_UID
): Promise<string> {
  const { offchain, signer } = await buildOffchain()
  const schemaUID            = getSchemaUID('ORG_MEMBERSHIP')
  const joinedAt              = BigInt(Math.floor(Date.now() / 1000))

  const encoder = new SchemaEncoder(SCHEMA_ORG_MEMBERSHIP)
  const encoded = encoder.encodeData([
    { name: 'org',           value: data.org.toLowerCase()    as `0x${string}`, type: 'address' },
    { name: 'member',        value: data.member.toLowerCase() as `0x${string}`, type: 'address' },
    { name: 'role',          value: data.role,                                  type: 'string'  },
    { name: 'joinedAt',      value: joinedAt,                                   type: 'uint64'  },
    { name: 'schemaVersion', value: 1,                                          type: 'uint8'   },
  ])

  const attestation = await offchain.signOffchainAttestation(
    {
      recipient:      data.member.toLowerCase() as `0x${string}`,
      schema:         schemaUID,
      data:           encoded,
      revocable:      true, // an org must be able to revoke membership on offboarding
      time:           joinedAt,
      expirationTime: 0n,
      refUID,
    },
    signer
  )

  return attestation.uid
}

// ---------------------------------------------------------------------------
// RewardData — fields from the on-chain Claimed event
// ---------------------------------------------------------------------------

export interface RewardAttestData {
  campaignId:      string
  epochNumber:     number
  amountClaimed:   bigint
  tokenContract:   string
  claimTxHash:     string
}

// ---------------------------------------------------------------------------
// attestReward
//
// Signs a CampaignReward offchain attestation after a Claimed event.
// ⚠ Dead code as of the campaign engine shelving (2026-08-12,
// `.claude/rules/rewards.md`) — zero callers repo-wide. Kept (not deleted)
// because the schema is registered on-chain and existing CampaignReward
// attestations still resolve against it; revisit if a future rewards
// surface needs it again.
// ---------------------------------------------------------------------------

export async function attestReward(
  wallet:     string,
  rewardData: RewardAttestData,
  refUID:     string = ZERO_UID
): Promise<string> {
  const { offchain, signer } = await buildOffchain()
  const schemaUID            = getSchemaUID('CAMPAIGN_REWARD')

  const claimTxHashBytes = ethers.zeroPadValue(rewardData.claimTxHash as `0x${string}`, 32)

  const encoder = new SchemaEncoder(SCHEMA_CAMPAIGN_REWARD)
  const encoded = encoder.encodeData([
    { name: 'campaignId',     value: rewardData.campaignId,             type: 'string'   },
    { name: 'epochNumber',    value: rewardData.epochNumber,            type: 'uint32'   },
    { name: 'amountClaimed',  value: rewardData.amountClaimed,          type: 'uint256'  },
    { name: 'tokenContract',  value: rewardData.tokenContract as `0x${string}`, type: 'address' },
    { name: 'claimTxHash',    value: claimTxHashBytes,                  type: 'bytes32'  },
    { name: 'claimedAt',      value: BigInt(Math.floor(Date.now() / 1000)), type: 'uint64' },
    { name: 'schemaVersion',  value: 1,                                 type: 'uint8'    },
  ])

  const attestation = await offchain.signOffchainAttestation(
    {
      recipient:      wallet.toLowerCase() as `0x${string}`,
      schema:         schemaUID,
      data:           encoded,
      revocable:      false,
      time:           BigInt(Math.floor(Date.now() / 1000)),
      expirationTime: 0n,
      refUID,
    },
    signer
  )

  return attestation.uid
}
