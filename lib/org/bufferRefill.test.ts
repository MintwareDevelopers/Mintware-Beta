import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { refillCardBuffer } from './bufferRefill'

// Every gate that decides whether a refill's money moves returns BEFORE any chain interaction
// (getOracleSigner / viem), so — like settleSwipe.test.ts — they're testable with a plain fake
// supabase. These lock the dark-launch master switch, the config/enable guards, the "already at
// target" no-op, and the refill-rate circuit breaker. The on-chain refillBuffer path itself is proven
// by the Forge suite (MintwareGatewayBufferRefill.t.sol).

const ORG_ID = 'org-1'
const CARD_ID = 'card-1'
const OK_ORG = { treasury_vault_address: '0xVault', treasury_chain_id: 84532 }

function fakeSupabase(opts: { org?: unknown; buf?: unknown; card?: unknown; begin?: { status: string; allowed: string } }) {
  return {
    rpc: async (fn: string) => {
      if (fn === 'begin_card_refill') return { data: opts.begin ?? { status: 'ok', allowed: '0' }, error: null }
      if (fn === 'end_card_refill') return { data: null, error: null }
      return { data: null, error: null }
    },
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        update: () => chain,
        insert: () => chain,
        maybeSingle: async () => {
          if (table === 'orgs') return { data: opts.org ?? null, error: null }
          if (table === 'card_spend_buffers') return { data: opts.buf ?? null, error: null }
          throw new Error(`unexpected maybeSingle on ${table}`)
        },
        single: async () => {
          if (table === 'org_cards') return { data: opts.card ?? null, error: null }
          if (table === 'card_buffer_refills') return { data: { id: 'ledger-1' }, error: null }
          throw new Error(`unexpected single on ${table}`)
        },
      }
      return chain
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// A fully-configured, refill-ready buffer row (atomic USDC as strings, like supabase numeric()).
const bufRow = (o: Record<string, unknown> = {}) => ({
  id: 'buf-1', org_card_id: CARD_ID, member_wallet: '0xabc', buffer_address: '0xBUFFER', chain_id: 84532,
  auto_refill_enabled: true, service_level_bps: 9500,
  per_tx_cap_atomic: '0', min_refill_atomic: '0', refill_rate_cap_atomic: '0', refill_window_secs: 86400,
  mean_demand_leadtime_atomic: '100000000', demand_stdev_atomic: '0', sigma_period_secs: 86400, lead_time_secs: 60,
  buffer_target_atomic: '0', buffer_balance_atomic: '0', refill_window_start_secs: 0, refilled_in_window_atomic: '0',
  breaker_open: false, ...o,
})

const call = (sb: unknown) => refillCardBuffer({ supabase: sb as never, orgId: ORG_ID, orgCardId: CARD_ID })

describe('refillCardBuffer — dark-launch gates + breaker', () => {
  afterEach(() => { delete process.env.CARD_BUFFER_REFILL_ENABLED })

  it('is OFF by default (master switch): no-ops even with a perfect config', async () => {
    // flag unset
    const res = await call(fakeSupabase({ org: OK_ORG, buf: bufRow({ buffer_balance_atomic: '0' }) }))
    expect(res).toMatchObject({ ok: false, reason: 'disabled', status: 503 })
  })

  describe('with the switch on', () => {
    beforeEach(() => { process.env.CARD_BUFFER_REFILL_ENABLED = 'true' })

    it('config: refuses when the org treasury is unset', async () => {
      const res = await call(fakeSupabase({ org: null }))
      expect(res).toMatchObject({ ok: false, reason: 'config' })
    })

    it('not_found: no buffer configured for the card', async () => {
      const res = await call(fakeSupabase({ org: OK_ORG, buf: null }))
      expect(res).toMatchObject({ ok: false, reason: 'not_found', status: 404 })
    })

    it('not_enabled: auto-refill disabled on the card', async () => {
      const res = await call(fakeSupabase({ org: OK_ORG, buf: bufRow({ auto_refill_enabled: false }) }))
      expect(res).toMatchObject({ ok: false, reason: 'not_enabled' })
    })

    it('no_buffer: on-chain buffer wallet not registered', async () => {
      const res = await call(fakeSupabase({ org: OK_ORG, buf: bufRow({ buffer_address: null }) }))
      expect(res).toMatchObject({ ok: false, reason: 'no_buffer' })
    })

    it('at_target: buffer already at/above the computed target → no-op', async () => {
      // target = mean($100) + safety(σ=0 → 0) = $100; balance $200 ≥ target → nothing to do.
      const res = await call(fakeSupabase({ org: OK_ORG, buf: bufRow({ buffer_balance_atomic: '200000000' }) }))
      expect(res).toMatchObject({ ok: false, reason: 'at_target', status: 200 })
    })

    it('rate_capped: begin_card_refill reports the manual breaker is open', async () => {
      // atomic begin (audit fix M1) decides the breaker; balance 0 → refillPlan wants a refill, so it reaches begin.
      const res = await call(fakeSupabase({ org: OK_ORG, buf: bufRow({ buffer_balance_atomic: '0' }), begin: { status: 'breaker', allowed: '0' } }))
      expect(res).toMatchObject({ ok: false, reason: 'rate_capped', status: 429 })
    })

    it('rate_capped: begin_card_refill reports an in-flight refill or an exhausted window', async () => {
      const res = await call(fakeSupabase({
        org: OK_ORG,
        buf: bufRow({ buffer_balance_atomic: '0' }),
        begin: { status: 'in_flight', allowed: '0' },
      }))
      expect(res).toMatchObject({ ok: false, reason: 'rate_capped' })
    })
  })
})
