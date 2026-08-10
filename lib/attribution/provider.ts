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
import { fetchEtherscanActivity, etherscanConfigured } from './providers/etherscan'
import type { ReferralFetcher } from './providers/referrals'
import type { SanctionsFetcher } from './providers/chainalysis'
import type { RiskFetcher } from './providers/nansen'

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/

export type ActivitySource = 'etherscan' | 'zerion' | 'mock'

export interface ResolveOptions {
  // Injected by the route (backed by ctx.supabase). Fills the Network signal +
  // referral-farm Risk from our own referral DB, independent of Zerion.
  referralFetcher?: ReferralFetcher
  // Sanctions hard-gate via the free Chainalysis on-chain oracle. Fails open.
  sanctionsFetcher?: SanctionsFetcher
  // Graded illicit-exposure (mixer/scam) via a paid vendor. Inert without a key.
  riskFetcher?: RiskFetcher
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
  if (etherscanConfigured() && ADDR_RE.test(address)) {
    // Preferred: free Etherscan V2 multichain backbone.
    try {
      activity = await fetchEtherscanActivity(address, nowMs)
      source = 'etherscan'
    } catch (err) {
      const why = err instanceof Error ? err.message : 'etherscan fetch failed'
      if (zerionConfigured()) {
        try {
          activity = await fetchZerionActivity(address, nowMs)
          source = 'zerion'
          degraded = `etherscan failed (${why}) — using zerion`
        } catch (e2) {
          activity = await getMockActivity(address)
          source = 'mock'
          degraded = e2 instanceof Error ? e2.message : 'all providers failed'
        }
      } else {
        activity = await getMockActivity(address)
        source = 'mock'
        degraded = why
      }
    }
  } else if (zerionConfigured() && ADDR_RE.test(address)) {
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

  // 2. Enrich from our own sources for real addresses (golden fixtures keep their
  // own referrals/flags). All enrichment is best-effort — never fails the request.
  if (ADDR_RE.test(address)) {
    if (opts.referralFetcher) {
      try {
        const { referrals, sybilFlag } = await opts.referralFetcher(address, nowMs)
        if (referrals.length) activity = { ...activity, referrals }
        if (sybilFlag) activity = { ...activity, riskFlags: [...activity.riskFlags, sybilFlag] }
      } catch {
        // referral enrichment is best-effort; the base score still stands
      }
    }
    if (opts.sanctionsFetcher) {
      try {
        const flag = await opts.sanctionsFetcher(address)
        if (flag) activity = { ...activity, riskFlags: [...activity.riskFlags, flag] }
      } catch {
        // sanctions oracle fails open — never block a score on an RPC error
      }
    }
    if (opts.riskFetcher) {
      try {
        const flags = await opts.riskFetcher(address)
        if (flags.length) activity = { ...activity, riskFlags: [...activity.riskFlags, ...flags] }
      } catch {
        // graded-risk vendor is best-effort — inert/failing never blocks a score
      }
    }
  }

  return { activity, source, degraded }
}
