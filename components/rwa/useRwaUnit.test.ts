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
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useEffect: (fn: () => (() => void)) => { hooks.effects.push(fn) },
}))
const snapshot = {
  ok: true, source: 'live', block: 123, blockTime: 1_000,
  appraisal: { tick: 0, usd: 1, at: 1_000, fresh: true, oracleReady: true, maxAgeSecs: 60, minUpdateSecs: 1 },
  spot: { tick: 0, usd: 1, deviationTicks: 0, inCore: true, inSpec: true },
  tradingPaused: false,
  vault: { seniorUsd: 1000, deployedUsd: 100, juniorUnits: 10, juniorUsd: 50, lockExpiry: 2000 },
  lending: { balanceUsd: 1_000, pendingUsd: 2, aprPct: 10, interestMintedUsd: 3, simulated: true },
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

it.each(['network', 'payload', 'http', 'cached', 'recorded'])('MW-06: %s failure stops interest and replaces current appraisal status', async (failure) => {
  await renderHook().reload()
  let result = renderHook()
  expect(result.failed).toBe(false)
  expect(result.interest).toBeGreaterThan(5)
  expect(rwaStatus(result.unit)?.tone).toBe('good')
  if (failure === 'network') vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
  else vi.mocked(fetch).mockResolvedValueOnce({ ok: failure !== 'http', json: async () => failure === 'payload' ? { ok: false } : { ...snapshot, source: failure === 'http' ? 'live' : failure } } as Response)
  await result.reload()
  result = renderHook()
  expect(result.failed).toBe(true)
  expect(result.unit?.source).toBe(failure === 'recorded' ? 'recorded' : 'cached')
  expect(rwaStatus(result.unit)?.t).toMatch(/unavailable|Recorded/)
  expect(result.interest).toBe(5)
  // The hook's clock keeps ticking during the outage; the cached estimate must not.
  hooks.values[2] = 100_000
  expect(renderHook().interest).toBe(5)
  await result.reload()
  result = renderHook()
  expect(result.failed).toBe(false)
  expect(result.unit?.source).toBe('live')
  expect(result.interest).toBeGreaterThan(5)
})

it('MW-06: cached interest is labelled as a snapshot', () => {
  const html = renderToStaticMarkup(createElement(LiquidityMap, { unit: { ...snapshot, source: 'cached' }, interest: 5, symbol: 'RWA' }))
  expect(html).toContain('at snapshot')
  expect(html).not.toContain('liquidity, live')
})
