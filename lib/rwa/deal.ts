// =============================================================================
// RWA Deal metadata — the team-authored deal page content (Centrifuge-modeled).
//
// Types only; reads live in lib/rwa/db.ts (server) and are surfaced through
// getVault() in lib/vaults/discovery.ts (deal attached to VaultDetail).
// =============================================================================

export type DealReviewStatus = 'draft' | 'in_review' | 'approved' | 'rejected'
export type DocKind = 'term_sheet' | 'legal_opinion' | 'spv_structure' | 'audit' | 'data_room' | 'other'
export type DocReviewStatus = 'pending' | 'approved' | 'rejected'
export type KycTier = 'NONE' | 'BASIC' | 'ACCREDITED' | 'INSTITUTIONAL'

export interface DealDocument {
  id: string
  label: string
  url: string
  kind: DocKind
  reviewStatus: DocReviewStatus
}

export interface DealMeta {
  vaultId: string
  issuerId: string | null
  description: string | null
  yieldSourceExplainer: string | null
  priceExplainer: string | null
  underlyingAssetClass: string | null
  targetApyPct: number | null
  minInvestmentUsd: number
  reservePct: number
  yieldPct: number
  priceBand: string
  settleDays: number
  kycTierRequired: KycTier
  reviewStatus: DealReviewStatus
  documents: DealDocument[]
}
