import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LiveDot, LiquidityMap } from './RwaVisuals'
import { useRwaUnit, rwaStatus, type RwaUnitLive } from './useRwaUnit'

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => (() => void))[] }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++
    if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[i], (value: unknown) => { hooks.values[i] = typeof value === 'function' ? value(hooks.values[i]) : value }]
  },
  useRef: (initial: unknown) => {
    const i = hooks.cursor++
    if (!(i in hooks.values)) hooks.values[i] = { current: initial }
    return hooks.values[i]
  },
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useEffect: (fn: () => (() => void)) => { hooks.effects.push(fn) },
}))
const snapshot = {
  ok: true, source: 'live', block: 123, blockTime: 1_000,
  engine: { address: '0x1111111111111111111111111111111111111111', activated: true, nav: '1000000000', supply: '1000000000000000000', shares: null, balances: [], position: { liquidity: '100', tickLower: -600, tickUpper: 600 } },
  hook: { address: '0x2222222222222222222222222222222222222222', adapter: '0x3333333333333333333333333333333333333333', priceWad: '1000000000000000000', observedAt: 1000, spotTick: 0, appraisalTick: 0, deviationTicks: 0, coreBandTicks: 500, specBandTicks: 1500, maxAgeSecs: 60, coreFeePips: 3000, specFeePips: 10000, fresh: true, oracleReady: true, inCore: true, inSpec: true, paused: false, permissions: { swappingEnabled: true, engineWrapper: true, engineLiquidity: true, accountSwap: null, accountLiquidity: null } },
} as RwaUnitLive
// eslint-disable-next-line react-hooks/rules-of-hooks -- This test supplies a deterministic hook dispatcher without a DOM.
const renderHook = () => { hooks.cursor = 0; return useRwaUnit('test', 12_000) }

beforeEach(() => {
  hooks.values = []; hooks.cursor = 0; hooks.effects = []
  vi.useFakeTimers(); vi.setSystemTime(1_010_000)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => structuredClone(snapshot) }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('MW-06: a failed cached-block badge is unavailable and has no live animation', () => {
  const html = renderToStaticMarkup(createElement(LiveDot, { failed: true, block: 123 }))
  expect(html).toContain('unavailable')
  expect(html).toContain('123')
  expect(html).not.toContain('animate-ping')
  expect(html).not.toContain('Live ·')
})

it.each(['network', 'payload', 'http', 'cached'])('MW-06: %s failure freezes the engine snapshot and replaces current appraisal status', async (failure) => {
  await renderHook().reload()
  let result = renderHook()
  expect(result.failed).toBe(false)
  expect(result.unit?.engine?.nav).toBe("1000000000")
  expect(rwaStatus(result.unit)?.tone).toBe('good')
  if (failure === 'network') vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
  else vi.mocked(fetch).mockResolvedValueOnce({ ok: failure !== 'http', json: async () => failure === 'payload' ? { ok: false } : { ...snapshot, source: failure === 'http' ? 'live' : failure } } as Response)
  await result.reload()
  result = renderHook()
  expect(result.failed).toBe(true)
  expect(result.unit?.source).toBe('cached')
  expect(rwaStatus(result.unit)?.t).toMatch(/unavailable/)
  expect(result.unit?.engine?.nav).toBe("1000000000")
  // The clock keeps ticking during the outage; holdings remain the last observed values.
  hooks.values[2] = 100_000
  expect(renderHook().unit?.engine?.nav).toBe("1000000000")
  await result.reload()
  result = renderHook()
  expect(result.failed).toBe(false)
  expect(result.unit?.source).toBe('live')
  expect(result.unit?.engine?.nav).toBe("1000000000")
})

it('MW-06: cached holdings are labelled as a snapshot', () => {
  const html = renderToStaticMarkup(createElement(LiquidityMap, { unit: { ...snapshot, source: 'cached' } }))
  expect(html).toContain('at snapshot')
  expect(html).not.toContain('liquidity, live')
})

it('undeployed is explicit and never replaced by archived data', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, source: 'undeployed', engine: null, hook: null, block: null, blockTime: null }) } as Response)
  await renderHook().reload()
  const result = renderHook()
  expect(result.failed).toBe(false)
  expect(result.unit?.engine).toBeNull()
  expect(rwaStatus(result.unit)?.t).toBe('Not deployed yet')
})
