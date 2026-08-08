// =============================================================================
// Attribution Engine v2 — mock data provider + golden wallets.
//
// This is the v2.0 stand-in for the real data layer. It implements the same
// `getWalletActivity` contract a GoldRush/Alchemy adapter will, so the engine,
// the API route, and the tests all run today on deterministic fixtures. Swapping
// in a live provider means replacing THIS file only — the engine never changes.
//
// The golden wallets encode the archetypes the redesign must rank correctly:
// a genuine long-term LP must beat a referral farmer, a dump-whale, and a
// risk-flagged trader — the exact failure the legacy Sharing=400 weighting had.
// =============================================================================

import type { WalletActivity } from './types'

// Fixed clock so fixtures + snapshots are deterministic (mirrors the engine's
// nowMs parameter — never Date.now() in test paths).
export const NOW_MS = 1_760_000_000_000 // ~Oct 2025
const DAY = 86_400_000
const ago = (days: number) => NOW_MS - days * DAY

const EMPTY: Omit<WalletActivity, 'address'> = {
  firstSeenMs: 0, lastSeenMs: 0, chains: [], totalTxCount: 0, activeWeeks: 0,
  lifetimeVolumeUsd: 0, positions: [], lpPositions: [], govVotes: 0,
  govProposals: 0, delegations: 0, referrals: [], riskFlags: [],
}

// ── The genuine contributor: 4 years on-chain, deep LP, real holdings ─────────
export const GOLDEN_LONG_TERM_LP: WalletActivity = {
  ...EMPTY,
  address: '0xLP',
  firstSeenMs: ago(4 * 365), lastSeenMs: ago(2),
  chains: ['ethereum', 'base', 'arbitrum', 'optimism'],
  totalTxCount: 1840, activeWeeks: 160, lifetimeVolumeUsd: 620_000,
  positions: [
    { symbol: 'ETH', usdValue: 48_000, holdDays: 900 },
    { symbol: 'cbBTC', usdValue: 22_000, holdDays: 400 },
  ],
  lpPositions: [
    { pool: 'ETH/USDC', usdDepth: 40_000, durationDays: 300, active: true },
    { pool: 'ARB/USDC', usdDepth: 15_000, durationDays: 210, active: true },
  ],
  govVotes: 22, govProposals: 1, delegations: 3,
  referrals: [{ referredScore: 410, retained: true }, { referredScore: 260, retained: true }],
}

// ── The referral farmer: 1 day old, no LP/holdings, huge low-quality tree ─────
// Under legacy Sharing=400 this wallet out-scored the LP above. It must not now.
export const GOLDEN_REFERRAL_FARMER: WalletActivity = {
  ...EMPTY,
  address: '0xFARM',
  firstSeenMs: ago(1), lastSeenMs: ago(0),
  chains: ['base'], totalTxCount: 12, activeWeeks: 1, lifetimeVolumeUsd: 200,
  referrals: Array.from({ length: 140 }, () => ({ referredScore: 8, retained: false })),
  riskFlags: [{ type: 'sybil_cluster', severity: 0.7 }],
}

// ── The dump-whale: enormous volume, no conviction, no history ────────────────
export const GOLDEN_DUMP_WHALE: WalletActivity = {
  ...EMPTY,
  address: '0xWHALE',
  firstSeenMs: ago(45), lastSeenMs: ago(1),
  chains: ['ethereum'], totalTxCount: 260, activeWeeks: 6, lifetimeVolumeUsd: 8_500_000,
  positions: [{ symbol: 'PEPE', usdValue: 5_000, holdDays: 3 }],
}

// ── The risk-flagged trader: decent activity, sanctioned exposure ─────────────
export const GOLDEN_SANCTIONED: WalletActivity = {
  ...EMPTY,
  address: '0xBAD',
  firstSeenMs: ago(500), lastSeenMs: ago(4),
  chains: ['ethereum', 'base'], totalTxCount: 400, activeWeeks: 40, lifetimeVolumeUsd: 300_000,
  positions: [{ symbol: 'USDT', usdValue: 30_000, holdDays: 120 }],
  lpPositions: [{ pool: 'ETH/USDC', usdDepth: 12_000, durationDays: 90, active: true }],
  riskFlags: [{ type: 'sanctioned', severity: 0.9 }, { type: 'mixer', severity: 0.6 }],
}

// ── The newcomer: barely any footprint ────────────────────────────────────────
export const GOLDEN_NEWCOMER: WalletActivity = {
  ...EMPTY,
  address: '0xNEW',
  firstSeenMs: ago(10), lastSeenMs: ago(1),
  chains: ['base'], totalTxCount: 5, activeWeeks: 2, lifetimeVolumeUsd: 1_500,
}

export const GOLDEN_WALLETS: Record<string, WalletActivity> = {
  '0xlp': GOLDEN_LONG_TERM_LP,
  '0xfarm': GOLDEN_REFERRAL_FARMER,
  '0xwhale': GOLDEN_DUMP_WHALE,
  '0xbad': GOLDEN_SANCTIONED,
  '0xnew': GOLDEN_NEWCOMER,
}

/**
 * The data-layer contract. v2.0 returns a golden fixture when the address
 * matches one, else a deterministic empty-ish profile. A live adapter
 * (GoldRush/Alchemy/subgraph) implements THIS signature and nothing else changes.
 */
export async function getWalletActivity(address: string): Promise<WalletActivity> {
  const key = address.toLowerCase()
  if (GOLDEN_WALLETS[key]) return GOLDEN_WALLETS[key]
  return { ...EMPTY, address }
}
