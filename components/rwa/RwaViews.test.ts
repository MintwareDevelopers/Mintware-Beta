import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RwaOverview } from './RwaOverview'
import { RwaMarket } from './RwaMarket'
import { RwaIssuerConsole } from './RwaIssuerConsole'
import { RwaProof } from './RwaProof'
import RwaUnitPage from '@/app/app/(personal)/rwas/[unit]/page'
import RwaProofPage from '@/app/app/(personal)/rwas/proof/page'
import RwaHow from '@/app/app/(personal)/rwas/how/page'
import { useRwaUnit, type RwaUnitLive } from './useRwaUnit'
import { RWA_QUOTE_ASSET } from '@/lib/rwa/units'

const account = '0x1111111111111111111111111111111111111111'
vi.mock('wagmi', () => ({ useAccount: () => ({ address: account }) }))
vi.mock('./useRwaUnit', async (original) => ({ ...await original<typeof import('./useRwaUnit')>(), useRwaUnit: vi.fn() }))

const snapshot: RwaUnitLive = {
  ok: true, source: 'live', block: 123, blockTime: 1_000,
  engine: {
    address: account, activated: true, nav: '120000000', supply: '2000000000000000000', shares: '500000000000000000',
    balances: [
      { token: RWA_QUOTE_ASSET, decimals: 6, engine: '12000000', idle: '8000000', wallet: null },
      { token: account, decimals: 18, engine: '500000000000000000', idle: '500000000000000000', wallet: null },
    ],
    position: { liquidity: '100', tickLower: -600, tickUpper: 600 },
  },
  hook: {
    address: account, adapter: account, priceWad: '100000000000000000000', observedAt: 1000,
    spotTick: 100, appraisalTick: 0, deviationTicks: 100, coreBandTicks: 500, specBandTicks: 1500,
    maxAgeSecs: 60, coreFeePips: 3000, specFeePips: 10000, fresh: true, oracleReady: true, inCore: true, inSpec: true, paused: false,
    permissions: { swappingEnabled: true, engineWrapper: true, engineLiquidity: false, accountSwap: false, accountLiquidity: true },
  },
}
const setRead = (unit: RwaUnitLive | null, failed = false) => vi.mocked(useRwaUnit).mockReturnValue({ unit, failed, now: 1010, reload: vi.fn() })
const views = [
  ['overview', () => createElement(RwaOverview)],
  ['market', () => createElement(RwaMarket, { slug: 'wcp7' })],
  ['issuer', () => createElement(RwaIssuerConsole)],
] as const

beforeEach(() => { vi.clearAllMocks(); setRead(structuredClone(snapshot)) })

describe.each(views)('%s owned-engine view', (_name, view) => {
  it('renders the engine-only payload, canonical links and one disclosure', () => {
    const html = renderToStaticMarkup(view())
    expect(html).toContain('mw-raise')
    expect(html).toContain('non-transferable')
    expect(html).toContain('1970-01-01 00:16:40 UTC')
    expect(html).toContain('href="/app/rwas/')
    expect(html.match(/Testnet demonstration/g)).toHaveLength(1)
    expect(html.match(/unaudited/g)).toHaveLength(1)
    expect(html).not.toMatch(/senior|junior|first.loss|fixed APY|simulated|\/v1\/rwas|dUSD|deposits?|savings|guaranteed/i)
  })

  it('shows installation pending without presenting archive values as live', () => {
    setRead({ ok: true, source: 'undeployed', engine: null, hook: null, block: null, blockTime: null })
    const html = renderToStaticMarkup(view())
    expect(html).toContain('Not deployed yet')
    expect(html).not.toContain('animate-ping')
    expect(html).not.toContain('1970-01-01')
    expect(html).not.toContain('Connecting')
  })

  it('labels cached data and suppresses current or live claims', () => {
    setRead({ ...snapshot, source: 'cached' }, true)
    const html = renderToStaticMarkup(view())
    expect(html).toContain('at snapshot')
    expect(html).toContain('cached block 123')
    expect(html).toContain('Current appraisal status unavailable')
    expect(html).not.toContain('animate-ping')
    expect(html).not.toContain('Trading inside the core band')
  })

  it('handles an unavailable read without claiming an empty deployed market', () => {
    setRead(null, true)
    const html = renderToStaticMarkup(view())
    expect(html).toContain('Current engine data is unavailable')
    expect(html).not.toContain('animate-ping')
    expect(html).not.toContain('No trades yet')
  })
})

it('reads wallet permissions and keeps a stale NAV unavailable while showing in-kind holdings', () => {
  setRead({ ...snapshot, engine: { ...snapshot.engine!, nav: null }, hook: { ...snapshot.hook!, fresh: false } })
  const html = renderToStaticMarkup(createElement(RwaMarket, { slug: 'wcp7' }))
  expect(useRwaUnit).toHaveBeenCalledWith('wcp7', 12_000, account)
  expect(html).toContain('Appraisal stale')
  expect(html).toContain('Unavailable — appraisal may be stale')
  expect(html).toContain('Your trading permission</td><td class="px-5 py-3">Not allowed')
  expect(html).toContain('Your liquidity permission</td><td class="px-5 py-3">Allowed')
  expect(html).toContain('Your shares')
  expect(html).toContain('Full in-kind exits need no appraisal')
})

it('relocated pages select the owned unit and archived proof independently', async () => {
  const market = await RwaUnitPage({ params: Promise.resolve({ unit: 'WCP7' }) })
  expect(market.type).toBe(RwaMarket)
  expect(market.props.slug).toBe('wcp7')
  const proof = await RwaProofPage({ searchParams: Promise.resolve({ unit: 'wcp7' }) })
  expect(proof.type).toBe(RwaProof)
  const html = renderToStaticMarkup(proof)
  expect(useRwaUnit).not.toHaveBeenCalled()
  expect(html).toContain('Archived proof · previous model')
  expect(html).toContain('https://sepolia.basescan.org/tx/')
  expect(html).toContain('href="/app/rwas/wcp7"')
})

it('the relocated explanation retains the diagram and covers permissioned in-kind exits', () => {
  const html = renderToStaticMarkup(createElement(RwaHow))
  expect(html).toContain('One engine, one pool, one share class')
  expect(html).toContain('Incomplete delivery needs a valid grace-period mark')
  expect(html).not.toMatch(/senior|junior|first.loss|dUSD|\/v1\/rwas/)
  expect(html.match(/Testnet demonstration/g)).toHaveLength(1)
})
