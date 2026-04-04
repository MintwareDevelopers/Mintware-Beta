// =============================================================================
// lib/rewards/combinedScore.ts
//
// Phase 6 — Signal Pooling: combined Attribution score across linked wallets.
//
// When an EVM wallet and a Solana wallet are linked (via wallet_links), the
// combined Attribution score is:
//
//   combined = max(evm_score, sol_score) + min(evm_score, sol_score) * 0.4
//
// This is used when:
//   1. A wallet joins a campaign (attribution_score in participants)
//   2. attribution_score is refreshed after wallet linking (refresh-score API)
//
// Score is fetched from the Attribution API (external Cloudflare Worker).
// Fails gracefully: returns the single-wallet score if the linked wallet has
// no score or the wallet_links lookup fails.
// =============================================================================

import { API } from '@/lib/web2/api'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { solanaEnabled } from '@/lib/web3/featureFlags'

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>

const EVM_RE    = /^0x[0-9a-fA-F]{40}$/
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

// ---------------------------------------------------------------------------
// fetchScore — fetch Attribution score for one wallet, fail gracefully
// ---------------------------------------------------------------------------
async function fetchScore(address: string, timeoutMs = 4000): Promise<number> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(
        `${API}/score?address=${encodeURIComponent(address)}`,
        { signal: controller.signal }
      )
      if (!res.ok) return 0
      const d = await res.json()
      return typeof d.score === 'number' ? d.score : 0
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// mergeScores — combine EVM + Solana scores into one Attribution score
// Exported so the profile page can use the same formula client-side.
// ---------------------------------------------------------------------------
export function mergeScores(scoreA: number, scoreB: number): number {
  if (scoreA <= 0 && scoreB <= 0) return 0
  if (scoreA <= 0) return scoreB
  if (scoreB <= 0) return scoreA
  return Math.round(Math.max(scoreA, scoreB) + Math.min(scoreA, scoreB) * 0.4)
}

// ---------------------------------------------------------------------------
// getCombinedAttributionScore
//
// Given a wallet (EVM or Solana) and a service-role Supabase client:
//   1. Fetch the wallet's Attribution score
//   2. Look up wallet_links for a linked wallet
//   3. Fetch the linked wallet's score (if found)
//   4. Return mergeScores(primary, linked)
//
// The Supabase client must be a service-role client — wallet_links has RLS
// enabled with public read, but the service role is used here for consistency
// (this runs server-side in API routes).
// ---------------------------------------------------------------------------
export async function getCombinedAttributionScore(
  wallet:   string,
  supabase: SupabaseServiceClient
): Promise<number> {
  const isEvm    = EVM_RE.test(wallet)
  const isSolana = !isEvm && SOLANA_RE.test(wallet)

  if (!isEvm && !isSolana) return 0
  if (!solanaEnabled) return fetchScore(wallet)

  // Fetch primary score and linked wallet lookup in parallel
  const [primaryScore, linkedAddress] = await Promise.all([
    fetchScore(wallet),
    findLinkedWallet(wallet, isEvm, supabase),
  ])

  if (!linkedAddress) return primaryScore

  const linkedScore = await fetchScore(linkedAddress)
  return mergeScores(primaryScore, linkedScore)
}

// ---------------------------------------------------------------------------
// findLinkedWallet — look up the paired wallet address from wallet_links
// Returns null if no link exists or on DB error.
// ---------------------------------------------------------------------------
async function findLinkedWallet(
  wallet:  string,
  isEvm:   boolean,
  supabase: SupabaseServiceClient
): Promise<string | null> {
  try {
    if (isEvm) {
      // EVM → look for linked Solana address
      const { data } = await supabase
        .from('wallet_links')
        .select('linked_address')
        .eq('primary_address', wallet.toLowerCase())
        .eq('status', 'verified')
        .maybeSingle()
      return data?.linked_address ?? null
    } else {
      // Solana → look for the EVM address it was linked to
      const { data } = await supabase
        .from('wallet_links')
        .select('primary_address')
        .eq('linked_address', wallet)
        .eq('status', 'verified')
        .maybeSingle()
      return data?.primary_address ?? null
    }
  } catch {
    return null
  }
}
