// GET /api/gateway/position — manager-generation cost-basis fix (independent Codex audit, round-4
// pass-2, 2026-09-09). This route had no prior test coverage at all; added alongside the fix that gives
// its DB basis lookup a real reason to need one: `inst` already resolves to the EXACT PositionManager
// generation (via `?pm=`), but the query used to ignore position_manager entirely, so a wallet with
// deposits in two generations of the same pool always read whichever row happened to match first.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const USER = '0x' + '11'.repeat(20)
const PM_OLD = '0x' + '55'.repeat(20)
const PM_NEW = '0x' + '66'.repeat(20)
const POOL = '0x' + 'ab'.repeat(32)

type Row = { pool_address: string; chain_id: number; user_wallet: string; position_manager: string | null; entry_nav: string; shares: string }

// Minimal query-builder mock covering exactly the chain this route uses:
// .from('gateway_positions').select(...).eq(...).eq(...).eq(...).or(...).order(...).limit(...).maybeSingle()
function fakeSupabaseFor(rows: Row[]) {
  return {
    from: (table: string) => {
      if (table !== 'gateway_positions') {
        // gateway_position_snapshots — always empty for these tests, not the point being tested.
        const b = { select: () => b, eq: () => b, order: () => b, limit: () => b, then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res) }
        return b
      }
      const filters: Array<(r: Row) => boolean> = []
      const b = {
        select: () => b,
        eq: (col: string, val: unknown) => { filters.push((r) => String((r as Record<string, unknown>)[col]).toLowerCase() === String(val).toLowerCase()); return b },
        or: (expr: string) => {
          // Parse PostgREST-style "col.eq.val,col.is.null" — exactly what the route emits.
          const clauses = expr.split(',')
          filters.push((r) => clauses.some((c) => {
            const [col, op, val] = c.split('.')
            if (op === 'eq') return String((r as Record<string, unknown>)[col] ?? '').toLowerCase() === String(val).toLowerCase()
            if (op === 'is' && val === 'null') return (r as Record<string, unknown>)[col] == null
            return false
          }))
          return b
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          const dir = opts?.ascending === false ? -1 : 1
          rows = [...rows].sort((a, bb) => {
            const av = (a as Record<string, unknown>)[col], bv = (bb as Record<string, unknown>)[col]
            if (av == null && bv == null) return 0
            if (av == null) return 1 // nulls last regardless of direction, matching nullsFirst:false
            if (bv == null) return -1
            return av < bv ? -dir : av > bv ? dir : 0
          })
          return b
        },
        limit: () => b,
        maybeSingle: async () => {
          const hit = rows.filter((r) => filters.every((f) => f(r)))
          return { data: hit[0] ?? null, error: null }
        },
      }
      return b
    },
  }
}

const state = vi.hoisted(() => ({ supabase: null as unknown, inst: null as unknown }))
vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => state.supabase }))
vi.mock('@/lib/gateway/chain', () => ({
  gatewayConfig: () => ({ chainId: 46630, rpcUrl: 'https://rpc.example' }),
  gatewayPublicClient: () => ({}),
}))
vi.mock('@/lib/gateway/routeInstance', () => ({ resolveInstanceStrict: async () => ({ ok: true, inst: state.inst }) }))
vi.mock('@/lib/gateway/positionReader', () => ({
  readGatewayPosition: async ({ costBasisAtomic }: { costBasisAtomic: bigint | null }) => ({
    shares: '1000000', positionValueAtomic: '1000000', costBasisAtomic: (costBasisAtomic ?? 0n).toString(),
    unrealizedPnlAtomic: '0', sourceReadable: true,
  }),
  readGatewayPoolState: async () => ({ deployed: false }),
  serializePoolState: (s: unknown) => s,
}))

function req(url: string) {
  const r = new NextRequest(url)
  return r
}

beforeEach(() => {
  state.inst = { poolAddress: POOL, chainId: 46630, positionManager: PM_NEW, staging: null, source: 'registry', live: true }
})

describe('GET /api/gateway/position — PM-generation-scoped cost basis', () => {
  it('reads the EXACT generation\'s basis, not another generation\'s row for the same pool', async () => {
    state.supabase = fakeSupabaseFor([
      { pool_address: POOL, chain_id: 46630, user_wallet: USER, position_manager: PM_OLD, entry_nav: '999000', shares: '1' },
      { pool_address: POOL, chain_id: 46630, user_wallet: USER, position_manager: PM_NEW, entry_nav: '500000', shares: '1' },
    ])
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/position?address=${USER}&pool=${POOL}&pm=${PM_NEW}`))
    const json = await res.json()
    expect(json.position.costBasisAtomic).toBe('500000') // the NEW generation's basis — not the OLD one's 999000
    expect(json.position.recorded).toBe(true)
  })

  it('the OTHER generation resolves to ITS OWN basis, not the one above', async () => {
    state.inst = { poolAddress: POOL, chainId: 46630, positionManager: PM_OLD, staging: null, source: 'registry', live: false }
    state.supabase = fakeSupabaseFor([
      { pool_address: POOL, chain_id: 46630, user_wallet: USER, position_manager: PM_OLD, entry_nav: '999000', shares: '1' },
      { pool_address: POOL, chain_id: 46630, user_wallet: USER, position_manager: PM_NEW, entry_nav: '500000', shares: '1' },
    ])
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/position?address=${USER}&pool=${POOL}&pm=${PM_OLD}`))
    const json = await res.json()
    expect(json.position.costBasisAtomic).toBe('999000')
  })

  // Manager-generation fix, FINAL design (independent Codex audit, to-do items 3/4, 2026-09-10): an
  // orphaned (position_manager IS NULL) row is genuinely ambiguous — it might belong to THIS generation
  // or a completely different one, so it must NEVER be silently surfaced as if it were this generation's
  // basis (the earlier "adopt-or-create" design got this wrong). Stays invisible until
  // scripts/verify-gateway-pm-attribution.mjs resolves it from real on-chain receipt data.
  it('FIX PROVEN: an unresolved legacy row (position_manager IS NULL) is NEVER surfaced for a specific PM query', async () => {
    state.supabase = fakeSupabaseFor([
      { pool_address: POOL, chain_id: 46630, user_wallet: USER, position_manager: null, entry_nav: '250000', shares: '1' },
    ])
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/position?address=${USER}&pool=${POOL}&pm=${PM_NEW}`))
    const json = await res.json()
    expect(json.position.recorded).toBe(false) // NOT surfaced — never guessed as belonging to PM_NEW
    expect(json.position.costBasisAtomic).toBe('0')
  })

  it('an exact-PM row wins over a legacy NULL row when BOTH exist for this identity', async () => {
    state.supabase = fakeSupabaseFor([
      { pool_address: POOL, chain_id: 46630, user_wallet: USER, position_manager: null, entry_nav: '111', shares: '1' },
      { pool_address: POOL, chain_id: 46630, user_wallet: USER, position_manager: PM_NEW, entry_nav: '222', shares: '1' },
    ])
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/position?address=${USER}&pool=${POOL}&pm=${PM_NEW}`))
    const json = await res.json()
    expect(json.position.costBasisAtomic).toBe('222')
  })

  it('no matching row at all ⇒ recorded:false, null-equivalent cost basis (never fabricated)', async () => {
    state.supabase = fakeSupabaseFor([])
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/position?address=${USER}&pool=${POOL}&pm=${PM_NEW}`))
    const json = await res.json()
    expect(json.position.recorded).toBe(false)
    expect(json.position.costBasisAtomic).toBe('0')
  })
})
