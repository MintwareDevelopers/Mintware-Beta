import { afterEach, describe, expect, it, vi } from 'vitest'
import { tickToUsd, RWA_DEMO } from './demo'

describe('V2-RWAs demo data', () => {
  it('converts a pool tick to the property token USD price for both currency orders', () => {
    // $100 per 18-dp unit in 6-dp USD ⇒ raw price 1e-10 ⇒ tick ±230270
    expect(tickToUsd(230_270, false)).toBeCloseTo(100, 1)
    expect(tickToUsd(-230_270, true)).toBeCloseTo(100, 1)
    // +200 ticks on the property-is-currency1 orientation is −200 in pool space ⇒ +2% value
    expect(tickToUsd(230_070, false) / tickToUsd(230_270, false)).toBeCloseTo(1.0202, 3)
  })

  it('records two deliberately refused proof transactions, mined as reverted', () => {
    const reverted = RWA_DEMO.legs.flatMap((l) => l.txs).filter((t) => t.status === 'reverted')
    expect(reverted.map((t) => t.label).sort()).toEqual([
      'Dana tries a 2,500 dUSD buy (would leave the band)',
      'Fox (unverified) tries to buy with 100 dUSD',
    ])
    for (const t of RWA_DEMO.legs.flatMap((l) => l.txs)) expect(t.hash).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

describe('V2-RWAs live-trade sizing', () => {
  it('leans toward the appraisal and stays small', async () => {
    const { planTrade } = await import('./liveTrade')
    const below = planTrade(97, 102, 19_000, 0.5)
    expect(below.side).toBe('buy')
    expect(below.usd!).toBeGreaterThanOrEqual(40)
    expect(below.usd!).toBeLessThanOrEqual(250)
    const above = planTrade(108, 102, 19_000, 0.5)
    expect(above.side).toBe('sell')
    expect(above.units! * 108).toBeLessThanOrEqual(250.0001)
    expect(planTrade(102, 102, 19_000, 0.2).side).toBe('buy')
    expect(planTrade(102, 102, 19_000, 0.8).side).toBe('sell')
  })
})

describe('V2-RWAs gate', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
  const jar = (m: Record<string, string>) => ({ get: (n: string) => (n in m ? { value: m[n] } : undefined) })

  it('does not exist unless the flag is on', async () => {
    vi.stubEnv('NEXT_PUBLIC_V2_RWA_ENABLED', '')
    vi.stubEnv('V2_PASSWORD', 'pw')
    const { isV2RwaVisible, canSeeRwa } = await import('@/lib/v2/rwaGate')
    const { v2Token, V2_COOKIE } = await import('@/lib/v2/gate')
    expect(isV2RwaVisible()).toBe(false)
    expect(canSeeRwa(jar({ [V2_COOKIE]: v2Token() }))).toBe(false)
  })

  it('opens only with a real V2 unlock — even while the site-wide V1/V2 split is off (V2 shown to all)', async () => {
    vi.stubEnv('NEXT_PUBLIC_V2_RWA_ENABLED', 'true')
    vi.stubEnv('NEXT_PUBLIC_V1_MODE_ENABLED', '')
    vi.stubEnv('V2_PASSWORD', 'pw')
    const { canSeeRwa } = await import('@/lib/v2/rwaGate')
    const { v2Token, V2_COOKIE, isV2FromCookie } = await import('@/lib/v2/gate')
    expect(isV2FromCookie(undefined)).toBe(true) // the site default is open…
    expect(canSeeRwa(jar({}))).toBe(false) // …but RWA is not
    expect(canSeeRwa(jar({ [V2_COOKIE]: 'wrong' }))).toBe(false)
    expect(canSeeRwa(jar({ [V2_COOKIE]: v2Token() }))).toBe(true)
  })

  it('fails closed when V2_PASSWORD is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_V2_RWA_ENABLED', 'true')
    vi.stubEnv('V2_PASSWORD', '')
    const { canSeeRwa } = await import('@/lib/v2/rwaGate')
    const { V2_COOKIE } = await import('@/lib/v2/gate')
    expect(canSeeRwa(jar({}))).toBe(false)
    expect(canSeeRwa(jar({ [V2_COOKIE]: '' }))).toBe(false)
  })
})
