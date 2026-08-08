// =============================================================================
// lib/rewards/combinedScore.ts
//
// Fetches a wallet's Attribution score from the external worker. (This previously
// did cross-chain EVM+Solana signal-pooling via wallet_links; Solana was scrapped,
// so it is now a single-wallet EVM score fetch. The name + 2-arg signature are
// kept so its callers — campaigns/join, campaigns/refresh-score — are untouched.)
// =============================================================================

import { API } from '@/lib/web2/api'

const EVM_RE = /^0x[0-9a-fA-F]{40}$/

// fetchScore — Attribution score for one wallet; fails gracefully to 0.
async function fetchScore(address: string, timeoutMs = 4000): Promise<number> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${API}/score?address=${encodeURIComponent(address)}`, { signal: controller.signal })
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

/** The wallet's Attribution score (0 on failure or non-EVM address). */
export async function getCombinedAttributionScore(wallet: string, _supabase?: unknown): Promise<number> {
  if (!EVM_RE.test(wallet)) return 0
  return fetchScore(wallet)
}
