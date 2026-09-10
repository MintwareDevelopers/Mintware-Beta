import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/gateway/__audit__/fakeSupabase'

// O-1 closeout: the Portfolio aggregate is CHAIN-FIRST — a wallet with on-chain shares and NO
// gateway_positions row (the pre-fix product wrote none) still sees its position; the DB row only
// adds cost basis. Inactive instances are never enumerated; the env rig only while the registry is empty.

const state = vi.hoisted(() => ({
  supabase: null as unknown,
  cfg: null as unknown,
  sharesByPm: {} as Record<string, bigint>,
  failPm: new Set<string>(), // V1-08 fix test hook: simulate an RPC failure for a specific PM
  sourceReadableOverride: {} as Record<string, boolean>,
}))
vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => state.supabase }))
vi.mock('@/lib/gateway/chain', () => ({
  gatewayConfig: () => state.cfg,
  gatewayPublicClient: () => ({
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      const pm = address.toLowerCase()
      if (state.failPm.has(pm)) throw new Error('rpc unavailable')
      if (functionName === 'sharesOf') return state.sharesByPm[pm] ?? 0n
      if (functionName === 'totalShares') return 2_000_000n
      if (functionName === 'totalNav') return 2_200_000n
      if (functionName === 'sourceReadable') return state.sourceReadableOverride[pm] ?? true // V1-08 fix: readGatewayPosition now reads this too
      throw new Error(functionName)
    },
  }),
}))

const USER = '0x' + '11'.repeat(20)
const ENV_PM = '0x24ff5d2bb29b5448bdf96db0fcdf0553ebda3b11'
const PM_A = '0x00000000000000000000000000000000000000aa'
const PM_B = '0x00000000000000000000000000000000000000bb'
const POOL_A = '0x' + 'ab'.repeat(32)
const POOL_B = '0x' + 'cd'.repeat(32)
const ENV_POOL = '0x' + 'ee'.repeat(32)
const cfg = { chainId: 46630, rpcUrl: 'http://rpc.test', positionManager: ENV_PM, staging: null, poolAddress: ENV_POOL }
const row = (pool: string, pm: string, status = 'active') => ({ pool_address: pool, chain_id: 46630, position_manager: pm, staging: '0x' + '11'.repeat(20), quote_asset: '0x' + '22'.repeat(20), status, pair_label: `${pool.slice(0, 6)} / USDG` })

function req(url: string, ip = '203.0.113.1') {
  const r = new Request(url, { headers: { 'x-forwarded-for': ip } })
  ;(r as unknown as { nextUrl: URL }).nextUrl = new URL(url)
  return r as never
}

beforeEach(() => {
  state.cfg = cfg
  state.sharesByPm = {}
  state.failPm = new Set()
  state.sourceReadableOverride = {}
})

describe('GET /api/gateway/positions — chain-first', () => {
  it('on-chain shares with NO DB row → position surfaces, recorded:false, basis null', async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [row(POOL_A, PM_A)] } }).client
    state.sharesByPm[PM_A] = 1_000_000n
    const { GET } = await import('./route')
    const { positions } = await (await GET(req(`https://mw.test/api/gateway/positions?address=${USER}`))).json()
    expect(positions).toHaveLength(1)
    expect(positions[0].poolAddress).toBe(POOL_A)
    expect(positions[0].shares).toBe('1000000')
    expect(positions[0].recorded).toBe(false)
    expect(positions[0].costBasisAtomic).toBeNull()
    expect(positions[0].unrealizedPnlAtomic).toBeNull()
    expect(positions[0].source).toBe('registry')
    expect(positions[0].live).toBe(true)
  })
  it('a DB row enriches with cost basis; a DB row with ZERO on-chain shares is omitted (fully withdrawn)', async () => {
    state.supabase = fakeSupabase({
      tables: {
        gateway_instances: [row(POOL_A, PM_A), row(POOL_B, PM_B)],
        gateway_positions: [
          { user_wallet: USER, pool_address: POOL_A, chain_id: 46630, shares: '1000000', entry_nav: '900000' },
          { user_wallet: USER, pool_address: POOL_B, chain_id: 46630, shares: '5', entry_nav: '5' }, // stale row, chain says 0
        ],
      },
    }).client
    state.sharesByPm[PM_A] = 1_000_000n
    const { GET } = await import('./route')
    const { positions } = await (await GET(req(`https://mw.test/api/gateway/positions?address=${USER}`))).json()
    expect(positions.map((p: { poolAddress: string }) => p.poolAddress)).toEqual([POOL_A])
    expect(positions[0].recorded).toBe(true)
    expect(positions[0].costBasisAtomic).toBe('900000')
    expect(BigInt(positions[0].unrealizedPnlAtomic) > 0n).toBe(true)
  })
  // V1-01 — FIXED 2026-09-09 (independent Codex audit). This test used to assert the BUG as if it were
  // intended behavior: a wallet holding 1,000,000 real shares in a since-deactivated pool's PM simply
  // vanished from the portfolio, with no normal way to see or exit that position (the on-chain shares
  // were always fine — only the app's own routing silently dropped them). Flipped to assert the fix:
  // a retired instance still enumerates, correctly flagged `live:false` (no new deposits).
  it('an inactive instance with a real position IS enumerated (live:false, not invisible)', async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [row(POOL_A, PM_A), row(POOL_B, PM_B, 'inactive')] } }).client
    state.sharesByPm[PM_A] = 1n
    state.sharesByPm[PM_B] = 1_000_000n
    const { GET } = await import('./route')
    const { positions } = await (await GET(req(`https://mw.test/api/gateway/positions?address=${USER}`))).json()
    const byPool = new Map(positions.map((p: { poolAddress: string; live: boolean }) => [p.poolAddress, p.live]))
    expect(byPool.get(POOL_A)).toBe(true)
    expect(byPool.get(POOL_B)).toBe(false) // retired, but still visible/withdrawable — not omitted
    expect(positions).toHaveLength(2)
  })
  it('registry empty → the env rig is enumerated (tagged env-fallback, live false)', async () => {
    state.supabase = fakeSupabase().client
    state.sharesByPm[ENV_PM] = 42n
    const { GET } = await import('./route')
    const { positions } = await (await GET(req(`https://mw.test/api/gateway/positions?address=${USER}`))).json()
    expect(positions).toHaveLength(1)
    expect(positions[0].poolAddress).toBe(ENV_POOL)
    expect(positions[0].source).toBe('env-fallback')
    expect(positions[0].live).toBe(false)
  })
  it('registry populated → the env rig is NOT enumerated', async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [row(POOL_A, PM_A)] } }).client
    state.sharesByPm[ENV_PM] = 42n
    const { GET } = await import('./route')
    const { positions } = await (await GET(req(`https://mw.test/api/gateway/positions?address=${USER}`))).json()
    expect(positions).toEqual([])
  })

  // V1-08 — FIXED 2026-09-09 (independent Codex audit). An RPC failure for one pool used to return
  // `null`, indistinguishable from "genuinely zero shares there" once filtered — a funded position
  // could silently vanish (or the total silently understate) during a chain hiccup. Now the response
  // carries an explicit signal distinguishing the two.
  it('FIXED: an RPC failure for one pool surfaces as failedPools/complete:false — not a silent omission', async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [row(POOL_A, PM_A), row(POOL_B, PM_B)] } }).client
    state.sharesByPm[PM_A] = 1_000_000n
    state.sharesByPm[PM_B] = 500_000n
    state.failPm.add(PM_B.toLowerCase()) // simulate an RPC outage for just this one pool
    const { GET } = await import('./route')
    const body = await (await GET(req(`https://mw.test/api/gateway/positions?address=${USER}`))).json()
    // POOL_A still reads fine and is present — the failure doesn't take down the whole response.
    expect(body.positions.map((p: { poolAddress: string }) => p.poolAddress)).toEqual([POOL_A])
    // But this is explicitly flagged incomplete — NOT the same shape as "you truly have only one position."
    expect(body.complete).toBe(false)
    expect(body.failedPools).toEqual([POOL_B])
  })
  it('FIXED: a fully healthy read reports complete:true with an empty failedPools list', async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [row(POOL_A, PM_A)] } }).client
    state.sharesByPm[PM_A] = 1_000_000n
    const { GET } = await import('./route')
    const body = await (await GET(req(`https://mw.test/api/gateway/positions?address=${USER}`))).json()
    expect(body.complete).toBe(true)
    expect(body.failedPools).toEqual([])
  })
  it('FIXED: sourceReadable:false (a yield-source outage) is threaded through per position, not hidden', async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [row(POOL_A, PM_A)] } }).client
    state.sharesByPm[PM_A] = 1_000_000n
    state.sourceReadableOverride[PM_A.toLowerCase()] = false
    const { GET } = await import('./route')
    const { positions } = await (await GET(req(`https://mw.test/api/gateway/positions?address=${USER}`))).json()
    expect(positions[0].sourceReadable).toBe(false)
  })
  // Manager-generation fix (independent Codex audit, round-4 pass-2, 2026-09-09). Before this fix,
  // basisByPool was keyed by pool+chain ONLY — two gateway_positions rows for the SAME pool (one per
  // PositionManager generation) collapsed into whichever the Map.set() processed last, so BOTH
  // chain-enumerated instances read from that one row's cost basis. Proves each generation now reads
  // its OWN basis.
  it('FIXED: two PM generations of the SAME pool each read their OWN cost basis, not one overwriting the other', async () => {
    const PM_OLD = '0x' + '77'.repeat(20)
    state.supabase = fakeSupabase({
      tables: {
        gateway_instances: [row(POOL_A, PM_OLD, 'inactive'), row(POOL_A, PM_A, 'active')],
        gateway_positions: [
          { user_wallet: USER, pool_address: POOL_A, chain_id: 46630, position_manager: PM_OLD, shares: '1000000', entry_nav: '999000' },
          { user_wallet: USER, pool_address: POOL_A, chain_id: 46630, position_manager: PM_A, shares: '1000000', entry_nav: '500000' },
        ],
      },
    }).client
    state.sharesByPm[PM_OLD] = 1_000_000n
    state.sharesByPm[PM_A] = 1_000_000n
    const { GET } = await import('./route')
    const { positions } = await (await GET(req(`https://mw.test/api/gateway/positions?address=${USER}`))).json()
    expect(positions).toHaveLength(2)
    const byPm = new Map(positions.map((p: { positionManager: string; costBasisAtomic: string }) => [p.positionManager.toLowerCase(), p.costBasisAtomic]))
    expect(byPm.get(PM_OLD.toLowerCase())).toBe('999000')
    expect(byPm.get(PM_A.toLowerCase())).toBe('500000') // NOT 999000 — each generation kept its own basis
  })
  it('FIXED: a not-yet-adopted legacy row (position_manager NULL) still enriches when no exact-PM row exists', async () => {
    state.supabase = fakeSupabase({
      tables: {
        gateway_instances: [row(POOL_A, PM_A)],
        gateway_positions: [{ user_wallet: USER, pool_address: POOL_A, chain_id: 46630, position_manager: null, shares: '1000000', entry_nav: '250000' }],
      },
    }).client
    state.sharesByPm[PM_A] = 1_000_000n
    const { GET } = await import('./route')
    const { positions } = await (await GET(req(`https://mw.test/api/gateway/positions?address=${USER}`))).json()
    expect(positions[0].costBasisAtomic).toBe('250000')
    expect(positions[0].recorded).toBe(true)
  })
  // V1-09 fix (independent Codex audit, 2026-09-09): the MOST expensive of the three position routes
  // (fans out across every instance) had no rate limit at all.
  it('V1-09 fix: per-IP floor returns a 429-shaped JSON without Upstash', async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [row(POOL_A, PM_A)] } }).client
    const { GET } = await import('./route')
    let saw429 = false
    for (let i = 0; i < 60; i++) {
      const r = await GET(req(`https://mw.test/api/gateway/positions?address=${USER}`, '198.51.100.7'))
      if (r.status === 429) { saw429 = true; expect((await r.json()).code).toBe('RATE_LIMITED'); break }
    }
    expect(saw429).toBe(true)
    expect((await GET(req(`https://mw.test/api/gateway/positions?address=${USER}`, '198.51.100.8'))).status).toBe(200)
  })
})
