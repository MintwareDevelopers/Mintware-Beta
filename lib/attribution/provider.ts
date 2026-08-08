// =============================================================================
// Attribution Engine v2 — composite data provider.
//
// The single entry point the API route uses. Resolves a wallet's activity from
// the best available source: with a Zerion key + a real address → live on-chain
// data; otherwise the deterministic golden-wallet mock. As the other adapters
// land (referral-DB Network, Chainalysis/Nansen Risk), they enrich the Zerion
// backbone HERE — the engine never changes.
// =============================================================================

import type { WalletActivity } from './types'
import { getWalletActivity as getMockActivity } from './mockProvider'
import { fetchZerionActivity, zerionConfigured } from './providers/zerion'
import type { ReferralFetcher } from './providers/referrals'

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/

export type ActivitySource = 'zerion' | 'mock'

export interface ResolveOptions {
  // Injected by the route (backed by ctx.supabase). Fills the Network signal +
  // referral-farm Risk from our own referral DB, independent of Zerion.
  referralFetcher?: ReferralFetcher
}

export async function resolveWalletActivity(
  address: string,
  nowMs: number,
  opts: ResolveOptions = {},
): Promise<{ activity: WalletActivity; source: ActivitySource; degraded?: string }> {
  // 1. Base activity: live Zerion for real addresses, else the golden-wallet mock.
  let activity: WalletActivity
  let source: ActivitySource
  let degraded: string | undefined
  if (zerionConfigured() && ADDR_RE.test(address)) {
    try {
      activity = await fetchZerionActivity(address, nowMs)
      source = 'zerion'
    } catch (err) {
      activity = await getMockActivity(address)
      source = 'mock'
      degraded = err instanceof Error ? err.message : 'zerion fetch failed'
    }
  } else {
    activity = await getMockActivity(address)
    source = 'mock'
  }

  // 2. Enrich Network + referral-farm Risk from our own DB (real addresses only —
  // golden fixtures keep their own referrals). Enrichment never fails the request.
  if (opts.referralFetcher && ADDR_RE.test(address)) {
    try {
      const { referrals, sybilFlag } = await opts.referralFetcher(address, nowMs)
      if (referrals.length) activity = { ...activity, referrals }
      if (sybilFlag) activity = { ...activity, riskFlags: [...activity.riskFlags, sybilFlag] }
    } catch {
      // referral enrichment is best-effort; the base score still stands
    }
  }

  return { activity, source, degraded }
}
