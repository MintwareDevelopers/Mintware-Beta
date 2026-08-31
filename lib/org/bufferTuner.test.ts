import { describe, it, expect, beforeEach } from 'vitest'
import { tuneBufferSizing } from './bufferTuner'

const USDC = (n: number): bigint => BigInt(Math.round(n * 1_000_000))
const DAY = 86_400
const NOW = 60 * DAY

let BUF: Record<string, unknown> | null = null
let SWIPES: Array<{ amount_atomic_usdc: string; created_at: string }> = []
let updates: Array<{ table: string; payload: Record<string, unknown> }> = []

function fakeSupabase() {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        limit: async () => ({ data: table === 'card_swipe_events' ? SWIPES : [], error: null }),
        maybeSingle: async () => ({ data: table === 'card_spend_buffers' ? BUF : null, error: null }),
        update: (payload: Record<string, unknown>) => { updates.push({ table, payload }); return chain },
      }
      return chain
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const bufRow = (o: Record<string, unknown> = {}) => ({
  id: 'buf-1', sigma_period_secs: DAY, lead_time_secs: 60, service_level_bps: 9500,
  mean_demand_leadtime_atomic: '0', demand_stdev_atomic: '0', ...o,
})
const swipe = (dollars: number, daysAgo: number) => ({
  amount_atomic_usdc: USDC(dollars).toString(),
  created_at: new Date((NOW - daysAgo * DAY) * 1000).toISOString(),
})
const call = () => tuneBufferSizing({ supabase: fakeSupabase(), orgCardId: 'card-1', nowSecs: NOW })

describe('tuneBufferSizing', () => {
  beforeEach(() => { BUF = null; SWIPES = []; updates = [] })

  it('not_found when the card has no buffer row', async () => {
    BUF = null
    expect(await call()).toEqual({ ok: false, reason: 'not_found' })
  })

  it('insufficient_samples leaves the row UNTOUCHED (new card keeps its seeded defaults)', async () => {
    BUF = bufRow()
    SWIPES = [swipe(10, 1), swipe(12, 2)] // < 5 default min
    expect(await call()).toEqual({ ok: false, reason: 'insufficient_samples' })
    expect(updates).toHaveLength(0)
  })

  it('with enough history, derives + persists new sizing inputs and target', async () => {
    BUF = bufRow() // existing 0 → first measurement taken whole
    SWIPES = [swipe(10, 1), swipe(10, 3), swipe(10, 5), swipe(10, 7), swipe(10, 9), swipe(10, 11)]
    const res = await call()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.sampleCount).toBe(6)
    // a write to card_spend_buffers happened with the three derived fields
    expect(updates).toHaveLength(1)
    expect(updates[0].table).toBe('card_spend_buffers')
    expect(updates[0].payload).toMatchObject({
      mean_demand_leadtime_atomic: res.meanLeadtimeAtomic,
      demand_stdev_atomic: res.demandStdevAtomic,
      buffer_target_atomic: res.targetAtomic,
    })
    // target must be at least the mean lead-time demand (safety stock ≥ 0)
    expect(BigInt(res.targetAtomic)).toBeGreaterThanOrEqual(BigInt(res.meanLeadtimeAtomic))
  })

  it('EMA-blends toward the measurement rather than overwriting (existing value present)', async () => {
    BUF = bufRow({ mean_demand_leadtime_atomic: USDC(1000).toString() }) // large existing bias
    SWIPES = [swipe(10, 1), swipe(10, 3), swipe(10, 5), swipe(10, 7), swipe(10, 9)]
    const res = await call()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // measured μ_L is tiny (cents); blended stays well below the old $1000 but above the measurement →
    // it moved only partway (30% default), proving it's an EMA, not an overwrite.
    expect(BigInt(res.meanLeadtimeAtomic)).toBeGreaterThan(USDC(600))
    expect(BigInt(res.meanLeadtimeAtomic)).toBeLessThan(USDC(1000))
  })
})
