// GET /api/gateway/fee-reconciliation — V1-07 (independent Codex audit, round-4, 2026-09-09).
// Bearer-gated read of the ALREADY-durable per-log paired-fee ledger (gateway_harvest_logs,
// migration 20260908000002) via its reconciliation view. This is the "expose unconverted income"
// half of V1-07's remediation — the durable-tracking half was already done before this route existed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeSupabase } from '@/lib/gateway/__audit__/fakeSupabase'

const state = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => state.client }))

const req = (auth?: string) =>
  new NextRequest('https://mintware.test/api/gateway/fee-reconciliation', { headers: auth ? { authorization: auth } : {} })

const envSaved: Record<string, string | undefined> = {}
beforeEach(() => {
  envSaved.ADMIN_SECRET = process.env.ADMIN_SECRET
  process.env.ADMIN_SECRET = 'admin-test-secret'
  vi.resetModules()
})
afterEach(() => {
  if (envSaved.ADMIN_SECRET === undefined) delete process.env.ADMIN_SECRET
  else process.env.ADMIN_SECRET = envSaved.ADMIN_SECRET
})

describe('GET /api/gateway/fee-reconciliation', () => {
  it('rejects a missing/wrong bearer (401) and never touches the DB', async () => {
    const s = fakeSupabase({ tables: { gateway_fee_ledger_reconciliation: [] } })
    state.client = s.client
    const { GET } = await import('./route')
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer nope'))).status).toBe(401)
    expect(s.db.calls.length).toBe(0)
  })

  it('exposes gross_paired_atomic (the unconverted paired-token income V1-07 flagged) per position manager', async () => {
    const row = {
      chain_id: 46630, position_manager: '0x' + 'aa'.repeat(20), harvest_logs: 3,
      gross_quote_atomic: '10000000', gross_paired_atomic: '2500000000000000000', // 2.5 paired tokens (18dp) — a DIFFERENT denomination than quote
      skimmed_atomic: '1000000', credited_atomic: '0', unallocated_atomic: '0',
      pending_net_atomic: '9000000', restaked_net_atomic: '0', paid_atomic: '0', expected_seat_quote_atomic: '9000000',
    }
    const s = fakeSupabase({ tables: { gateway_fee_ledger_reconciliation: [row] } })
    state.client = s.client
    const { GET } = await import('./route')
    const res = await GET(req('Bearer admin-test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.pools).toHaveLength(1)
    expect(body.pools[0]).toMatchObject({
      positionManager: row.position_manager,
      grossPairedAtomic: '2500000000000000000',
      grossQuoteAtomic: '10000000',
    })
    // the note must never let a reader mistake this for a quote-denominated (or converted) figure
    expect(body.note).toMatch(/NOT converted/)
  })

  it('the underlying view/migration not existing yet ⇒ 503, not a raw 500 (fail-closed, honest reason)', async () => {
    const s = fakeSupabase({
      tables: {},
      rpc: undefined,
    })
    // simulate the view being absent (a real Postgres error) by overriding select to error
    const client = {
      from: () => ({
        select: () => ({
          order: async () => ({ data: null, error: { message: 'relation "gateway_fee_ledger_reconciliation" does not exist' } }),
        }),
      }),
    }
    state.client = client as unknown
    const { GET } = await import('./route')
    const res = await GET(req('Bearer admin-test-secret'))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('reconciliation_unavailable')
  })
})
