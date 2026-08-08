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

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/

export type ActivitySource = 'zerion' | 'mock'

export async function resolveWalletActivity(
  address: string,
  nowMs: number,
): Promise<{ activity: WalletActivity; source: ActivitySource; degraded?: string }> {
  if (zerionConfigured() && ADDR_RE.test(address)) {
    try {
      const activity = await fetchZerionActivity(address, nowMs)
      return { activity, source: 'zerion' }
    } catch (err) {
      // On any provider error, fall back to the mock rather than 500 — and say so.
      return {
        activity: await getMockActivity(address),
        source: 'mock',
        degraded: err instanceof Error ? err.message : 'zerion fetch failed',
      }
    }
  }
  return { activity: await getMockActivity(address), source: 'mock' }
}
