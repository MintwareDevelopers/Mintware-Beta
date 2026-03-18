// =============================================================================
// lib/campaigns/swapHook.ts — Point-credit logic for swap events
//
// Called by the swap event handler (app/api/campaigns/swap-event/route.ts)
// when a wallet completes a trade or bridge inside a campaign.
// =============================================================================

import type {
  Campaign,
  SwapEventInput,
  SwapPointsResult,
} from '@/lib/campaigns/types'

/**
 * Compute the points to credit for a single swap/bridge event.
 *
 * The caller is responsible for applying these increments to the participant
 * row in Supabase (trading_points, bridge_points, daily_volume_usd).
 */
export function computeSwapPoints(
  event:    SwapEventInput,
  campaign: Campaign,
): SwapPointsResult {
  const actions     = campaign.actions ?? {}
  let tradingPoints = 0
  let bridgePoints  = 0

  if (event.isBridge) {
    // Fixed bridge points — from campaign.actions.bridge or fallback
    const bridgeAction = actions['bridge']
    bridgePoints       = Math.round(bridgeAction?.points ?? 0)
  } else {
    // Trade: points_per_usd × volume
    const tradeAction = actions['trade']
    const ptsPerUsd   = tradeAction?.points ?? 0  // typically 10 pts per $1
    tradingPoints     = Math.round(ptsPerUsd * event.volumeUsd)
  }

  return {
    tradingPoints,
    bridgePoints,
    volumeUsdIncrement: event.volumeUsd,
  }
}

/**
 * Compute referral bonus points to credit to the referrer
 * when their referred wallet completes a trade.
 *
 * referral_share_pct is applied to the referred wallet's raw points.
 */
export function computeReferralPoints(
  referredPoints:  number,   // raw points from the referred wallet this event
  referralSharePct: number,   // campaign.referral_share_pct (0–100)
): number {
  if (referralSharePct <= 0) return 0
  return Math.round(referredPoints * (referralSharePct / 100))
}

/**
 * Build a Supabase upsert payload for a swap event.
 * Returns only the fields that need updating (increment-style — caller adds to existing).
 */
export function buildParticipantIncrement(
  result: SwapPointsResult,
): {
  trading_points?:  number
  bridge_points?:   number
  daily_volume_usd: number
} {
  return {
    ...(result.tradingPoints > 0 ? { trading_points: result.tradingPoints }  : {}),
    ...(result.bridgePoints  > 0 ? { bridge_points:  result.bridgePoints   } : {}),
    daily_volume_usd: result.volumeUsdIncrement,
  }
}
