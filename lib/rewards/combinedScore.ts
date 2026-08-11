// =============================================================================
// lib/rewards/combinedScore.ts
//
// Fetches a wallet's Attribution score from the external worker. (This previously
// did cross-chain EVM+Solana signal-pooling via wallet_links; Solana was scrapped,
// so it is now a single-wallet EVM score fetch. The name + 2-arg signature are
// kept so its callers — campaigns/join, campaigns/refresh-score — are untouched.)
// =============================================================================

import { getServerLegacyScore } from '@/lib/attribution/serverScore'

const EVM_RE = /^0x[0-9a-fA-F]{40}$/

// fetchScore — canonical Attribution score for one wallet (in-repo Engine v2,
// same as the UI); fails gracefully to 0.
async function fetchScore(address: string): Promise<number> {
  try {
    const d = await getServerLegacyScore(address)
    return typeof d.score === 'number' ? d.score : 0
  } catch {
    return 0
  }
}

/** The wallet's Attribution score (0 on failure or non-EVM address). */
export async function getCombinedAttributionScore(wallet: string, _supabase?: unknown): Promise<number> {
  if (!EVM_RE.test(wallet)) return 0
  return fetchScore(wallet)
}
