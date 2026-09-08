import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/gateway/__audit__/fakeSupabase'

// O-1 closeout: the Portfolio aggregate is CHAIN-FIRST — a wallet with on-chain shares and NO
// gateway_positions row (the pre-fix product wrote none) still sees its position; the DB row only
// adds cost basis. Inactive instances are never enumerated; the env rig only while the registry is empty.

const state = vi.hoisted(() => ({
  supabase: null as unknown,
  cfg: null as unknown,
  sharesByPm: {} as Record<string, bigint>,
}))
vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => state.supabase }))
vi.mock('@/lib/gateway/chain', () => ({
  gatewayConfig: () => state.cfg,
  gatewayPublicClient: () => ({
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      if (functionName === 'sharesOf') return state.sharesByPm[address.toLowerCase()] ?? 0n
      if (functionName === 'totalShares') return 2_000_000n
      if (functionName === 'totalNav') return 2_200_000n
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

function req(url: string) {
  const r = new Request(url)
  ;(r as unknown as { nextUrl: URL }).nextUrl = new URL(url)
  return r as never
}

beforeEach(() => {
  state.cfg = cfg
  state.sharesByPm = {}
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
  it('inactive instances are not enumerated even if the wallet holds shares there', async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [row(POOL_A, PM_A), row(POOL_B, PM_B, 'inactive')] } }).client
    state.sharesByPm[PM_A] = 1n
    state.sharesByPm[PM_B] = 1_000_000n
    const { GET } = await import('./route')
    const { positions } = await (await GET(req(`https://mw.test/api/gateway/positions?address=${USER}`))).json()
    expect(positions.map((p: { poolAddress: string }) => p.poolAddress)).toEqual([POOL_A])
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
})
