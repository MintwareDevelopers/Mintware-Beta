// =============================================================================
// Attribution Engine v2 — sybil-risk scorer (the anti-farming brain).
//
// Turns a per-wallet behavioral feature vector into a GRADED `sybil_cluster`
// risk flag (severity 0..1) plus auditable reasons — the research-backed
// upgrade from a boolean flag. Runs in the RISK LAYER: a data adapter extracts
// these features (funding graph, referral graph, tx timeline) and calls this to
// produce the flag that computeScore() then deducts.
//
// Design (grounded in Trusta TrustScan two-phase, SybilRank, and airdrop
// farmer-clustering literature — see docs/developers/attribution-engine-v2-spec.md §10):
//   • Individual heuristics are SOFT (high precision — never nuke a real user on
//     one weak signal); each adds capped severity.
//   • A graph-CONFIRMED ring (shared funder + behavioral similarity + temporal
//     batching all firing together) is the only path to near-certain severity.
//   • Every firing heuristic is returned as a reason for appeals/auditability.
// =============================================================================

import { clamp01 } from './normalize'
import type { RiskFlag } from './types'

export interface SybilFeatures {
  // ── funding-graph (shared-funder clustering — highest-ROI detector) ──
  sharedFunderCount: number       // wallets sharing this wallet's funder root within N hops (CEX hot-wallets excluded)
  // ── solo behavioral fingerprints ──
  activeRatio: number             // activeWeeks / (ageDays/7); low = dormant burst wallet
  burstScore: number              // max txs in any 10-min window ÷ total txs (0..1); high = scripted batch
  counterpartyDiversity: number   // distinct counterparties ÷ tx count (0..1); low = single-purpose farm wallet
  roundtripRatio: number          // value returned to counterparties you funded ÷ outflow (0..1); high = wash/ping-pong
  bridgeDump: boolean             // bridged in → minimal activity → bridged/withdrew out fast
  // ── referral-graph (our #1 exposure) ──
  referralCount: number
  oneShotRefereePct: number       // referees that transacted once then went dormant (0..1)
  referralTreeEntropy: number     // normalized Shannon entropy of the sub-referrer distribution (0..1); low = one root spamming
  temporalBatchFraction: number   // share of the tree created within the same short window (0..1)
  // ── cross-wallet similarity (Trusta phase-2 refinement) ──
  seqSimilarity: number           // avg intra-cluster action-sequence (contract,method) similarity (0..1)
}

export const NO_SYBIL_SIGNAL: SybilFeatures = {
  sharedFunderCount: 0, activeRatio: 1, burstScore: 0, counterpartyDiversity: 1,
  roundtripRatio: 0, bridgeDump: false, referralCount: 0, oneShotRefereePct: 0,
  referralTreeEntropy: 1, temporalBatchFraction: 0, seqSimilarity: 0,
}

// Soft-heuristic contributions to severity. Kept individually small so no single
// weak signal condemns a wallet; the ring override below is the decisive path.
const SOFT = {
  sharedFunder: 0.20,   // scaled by cluster size
  dormantBurst: 0.15,
  batchScripting: 0.15,
  lowDiversity: 0.10,
  wash: 0.20,
  bridgeDump: 0.10,
  referralFarm: 0.30,   // scaled by farm-shape of the referral tree
} as const

export interface SybilAssessment {
  severity: number
  reasons: { code: string; detail: string }[]
  confirmedRing: boolean
}

export function assessSybil(f: SybilFeatures): SybilAssessment {
  const reasons: { code: string; detail: string }[] = []
  let severity = 0
  const add = (code: string, amount: number, detail: string) => {
    if (amount <= 0) return
    severity += amount
    reasons.push({ code, detail })
  }

  // Shared funder — soft alone, scaled by how many wallets share the root.
  const funderScale = clamp01(f.sharedFunderCount / 40)
  add('shared_funder', SOFT.sharedFunder * funderScale,
    `${f.sharedFunderCount} wallets share this wallet's funding root`)

  // Dormant-burst: old-enough wallet active in only a sliver of its lifetime.
  if (f.activeRatio < 0.2) add('dormant_burst', SOFT.dormantBurst * (1 - f.activeRatio / 0.2),
    `active in only ${Math.round(f.activeRatio * 100)}% of its lifetime`)

  // Scripted batching: most txs in one tight window.
  if (f.burstScore > 0.5) add('batch_scripting', SOFT.batchScripting * clamp01((f.burstScore - 0.5) / 0.5),
    `${Math.round(f.burstScore * 100)}% of activity in a single 10-min window`)

  // Single-purpose wallet: near-zero counterparty diversity.
  if (f.counterpartyDiversity < 0.15) add('low_diversity', SOFT.lowDiversity,
    'interacts with almost no distinct counterparties')

  // Wash / round-trip.
  if (f.roundtripRatio > 0.4) add('wash_roundtrip', SOFT.wash * clamp01((f.roundtripRatio - 0.4) / 0.6),
    `${Math.round(f.roundtripRatio * 100)}% of value round-trips to funded counterparties`)

  if (f.bridgeDump) add('bridge_dump', SOFT.bridgeDump, 'bridged in, minimal activity, bridged/withdrew out quickly')

  // Referral-farm shape: a big tree of one-shot referees with low structural
  // entropy is the signature of one operator spinning up wallets.
  if (f.referralCount >= 20) {
    const farmShape = clamp01(0.5 * f.oneShotRefereePct + 0.5 * (1 - f.referralTreeEntropy))
    add('referral_farm', SOFT.referralFarm * farmShape,
      `${f.referralCount} referrals · ${Math.round(f.oneShotRefereePct * 100)}% one-shot · tree entropy ${f.referralTreeEntropy.toFixed(2)}`)
  }

  // ── Graph-confirmed ring: the only near-certain path. Requires MULTIPLE
  // independent farm signatures to co-occur (shared funder + behavioral
  // similarity + temporal batching), mirroring Trusta's two-phase confirmation.
  const confirmedRing =
    f.sharedFunderCount >= 5 && f.seqSimilarity >= 0.8 && f.temporalBatchFraction >= 0.6
  if (confirmedRing) {
    severity = Math.max(severity, 0.9)
    reasons.push({
      code: 'confirmed_ring',
      detail: `graph-confirmed farm ring: shared funder + ${Math.round(f.seqSimilarity * 100)}% action similarity + ${Math.round(f.temporalBatchFraction * 100)}% batched creation`,
    })
  }

  return { severity: clamp01(severity), reasons, confirmedRing }
}

/**
 * Convenience: produce the `sybil_cluster` RiskFlag (or none) a data adapter
 * appends to WalletActivity.riskFlags before scoring. Below `minSeverity` the
 * signal is too weak to deduct on — it lands in a `needs_review` band instead
 * of penalizing a possibly-real user.
 */
export function sybilRiskFlag(f: SybilFeatures, minSeverity = 0.15): {
  flag: RiskFlag | null
  needsReview: boolean
  assessment: SybilAssessment
} {
  const assessment = assessSybil(f)
  if (assessment.severity >= minSeverity) {
    return { flag: { type: 'sybil_cluster', severity: assessment.severity }, needsReview: false, assessment }
  }
  return { flag: null, needsReview: assessment.severity > 0, assessment }
}
