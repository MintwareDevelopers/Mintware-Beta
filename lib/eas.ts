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

function getSchemaUID(name: 'ATTRIBUTION_SCORE' | 'SWAP_ACTIVITY' | 'REFERRAL_LINK' | 'CAMPAIGN_REWARD'): string {
  const key = `NEXT_PUBLIC_EAS_SCHEMA_${name}`
  const uid = process.env[key]
  if (!uid) throw new Error(`[eas] ${key} is not set`)
  return uid
}

// ---------------------------------------------------------------------------
// Schema strings — must exactly match what was registered on-chain
// ---------------------------------------------------------------------------

const SCHEMA_ATTRIBUTION_SCORE =
  'uint256 score,uint16 maxScore,uint8 percentile,string tier,uint8 scoreVolume,uint8 scoreTrading,uint8 scoreHolding,uint8 scoreLiquidity,uint8 scoreGovernance,uint16 scoreSharing,uint16 treeSize,uint16 treeQualityBps,uint8 chains,uint32 totalTxCount,string character,bytes32 dataHash,uint64 scoredAt,uint8 schemaVersion'

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
}

// ---------------------------------------------------------------------------
// attestScore
//
// Signs an AttributionScore offchain attestation for the given wallet.
// Returns the UID string.
// ---------------------------------------------------------------------------

export async function attestScore(
  wallet:    string,
  scoreData: ScoreAttestData
): Promise<string> {
  const { offchain, signer } = await buildOffchain()
  const schemaUID            = getSchemaUID('ATTRIBUTION_SCORE')

  const scoreVolume     = scoreData.signals.find(s => s.key === 'volume')?.score     ?? 0
  const scoreTrading    = scoreData.signals.find(s => s.key === 'trading')?.score    ?? 0
  const scoreHolding    = scoreData.signals.find(s => s.key === 'holding')?.score    ?? 0
  const scoreLiquidity  = scoreData.signals.find(s => s.key === 'liquidity')?.score  ?? 0
  const scoreGovernance = scoreData.signals.find(s => s.key === 'governance')?.score ?? 0
  const scoreSharing    = scoreData.signals.find(s => s.key === 'sharing')?.score    ?? 0
  const treeQualityBps  = Math.round(parseFloat(scoreData.treeQuality) * 100)
  const dataHash        = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(scoreData)))

  const encoder = new SchemaEncoder(SCHEMA_ATTRIBUTION_SCORE)
  const encoded = encoder.encodeData([
    { name: 'score',          value: BigInt(scoreData.score),        type: 'uint256' },
    { name: 'maxScore',       value: scoreData.maxScore,             type: 'uint16'  },
    { name: 'percentile',     value: scoreData.percentile,           type: 'uint8'   },
    { name: 'tier',           value: scoreData.tier,                 type: 'string'  },
    { name: 'scoreVolume',    value: scoreVolume,                    type: 'uint8'   },
    { name: 'scoreTrading',   value: scoreTrading,                   type: 'uint8'   },
    { name: 'scoreHolding',   value: scoreHolding,                   type: 'uint8'   },
    { name: 'scoreLiquidity', value: scoreLiquidity,                 type: 'uint8'   },
    { name: 'scoreGovernance',value: scoreGovernance,                type: 'uint8'   },
    { name: 'scoreSharing',   value: scoreSharing,                   type: 'uint16'  },
    { name: 'treeSize',       value: scoreData.treeSize,             type: 'uint16'  },
    { name: 'treeQualityBps', value: treeQualityBps,                 type: 'uint16'  },
    { name: 'chains',         value: scoreData.chains,               type: 'uint8'   },
    { name: 'totalTxCount',   value: scoreData.totalTxCount,         type: 'uint32'  },
    { name: 'character',      value: scoreData.character.label,      type: 'string'  },
    { name: 'dataHash',       value: dataHash,                       type: 'bytes32' },
    { name: 'scoredAt',       value: BigInt(Math.floor(Date.now() / 1000)), type: 'uint64' },
    { name: 'schemaVersion',  value: 1,                              type: 'uint8'   },
  ])

  const attestation = await offchain.signOffchainAttestation(
    {
      recipient:      wallet.toLowerCase() as `0x${string}`,
      schema:         schemaUID,
      data:           encoded,
      revocable:      true,
      time:           BigInt(Math.floor(Date.now() / 1000)),
      expirationTime: 0n,
      refUID:         '0x0000000000000000000000000000000000000000000000000000000000000000',
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
  swapData: SwapAttestData
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
      refUID:         '0x0000000000000000000000000000000000000000000000000000000000000000',
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
  refCode:  string
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
      refUID:         '0x0000000000000000000000000000000000000000000000000000000000000000',
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
// Called from POST /api/eas/attest-reward (protected by SWAP_WEBHOOK_SECRET).
// ---------------------------------------------------------------------------

export async function attestReward(
  wallet:     string,
  rewardData: RewardAttestData
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
      refUID:         '0x0000000000000000000000000000000000000000000000000000000000000000',
    },
    signer
  )

  return attestation.uid
}
