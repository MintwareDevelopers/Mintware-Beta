import { describe, it, expect } from 'vitest'
import { settleSwipeEvent, CARD_HIGH_VALUE_THRESHOLD } from './settleSwipe'

// The money-safety guards in settleSwipeEvent all return BEFORE any chain interaction
// (getOracleSigner / viem), so they're testable with a plain fake supabase — no on-chain mock needed.
// The actual settleSpend() is exercised by the manual button + proven live (proof leg 3); these tests
// lock the auto-settle VALVE and the pre-flight refusals that decide whether money ever moves.

const ORG_ID = 'org-1'
const OK_ORG = { treasury_vault_address: '0xVault', treasury_chain_id: 84532 }

function fakeSupabase(opts: { org?: unknown; event?: unknown; card?: unknown }) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        update: () => chain,
        maybeSingle: async () => {
          if (table === 'orgs') return { data: opts.org ?? null, error: null }
          if (table === 'card_swipe_events') return { data: opts.event ?? null, error: null }
          throw new Error(`unexpected maybeSingle on ${table}`)
        },
        single: async () => {
          if (table === 'org_cards') return { data: opts.card ?? null, error: null }
          throw new Error(`unexpected single on ${table}`)
        },
      }
      return chain
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const approved = (amount: string, extra: Record<string, unknown> = {}) => ({
  id: 'evt-1', org_card_id: 'card-1', member_wallet: '0xabc',
  amount_atomic_usdc: amount, decision: 'approved', settled: false, ...extra,
})

describe('settleSwipeEvent — money-safety guards', () => {
  it('SAFETY VALVE: refuses an approved swipe above the auto-settle ceiling', async () => {
    const res = await settleSwipeEvent({
      supabase: fakeSupabase({ org: OK_ORG, event: approved('60000000') }), // $60
      orgId: ORG_ID, eventId: 'evt-1', maxAtomicUsdc: 50_000_000n, // $50 cap
    })
    expect(res).toMatchObject({ ok: false, reason: 'over_auto_cap', status: 409 })
  })

  it('hard-refuses >= $250 even with no auto cap (edge-sig boundary)', async () => {
    const res = await settleSwipeEvent({
      supabase: fakeSupabase({ org: OK_ORG, event: approved(CARD_HIGH_VALUE_THRESHOLD.toString()) }),
      orgId: ORG_ID, eventId: 'evt-1',
    })
    expect(res).toMatchObject({ ok: false, reason: 'over_threshold', status: 501 })
  })

  it('the auto ceiling is INCLUSIVE — an at-cap amount passes the valve (then stops at activation)', async () => {
    const res = await settleSwipeEvent({
      supabase: fakeSupabase({ org: OK_ORG, event: approved('50000000'), card: { permit_signature: null } }),
      orgId: ORG_ID, eventId: 'evt-1', maxAtomicUsdc: 50_000_000n, // == amount → allowed past the valve
    })
    // It cleared the cap check and reached the permit check — proving `>` is strict, not `>=`.
    expect(res).toMatchObject({ ok: false, reason: 'not_activated' })
  })

  it('refuses a declined swipe', async () => {
    const res = await settleSwipeEvent({
      supabase: fakeSupabase({ org: OK_ORG, event: approved('1000000', { decision: 'declined' }) }),
      orgId: ORG_ID, eventId: 'evt-1',
    })
    expect(res).toMatchObject({ ok: false, reason: 'not_approved' })
  })

  it('refuses an already-settled swipe (idempotency)', async () => {
    const res = await settleSwipeEvent({
      supabase: fakeSupabase({ org: OK_ORG, event: approved('1000000', { settled: true }) }),
      orgId: ORG_ID, eventId: 'evt-1',
    })
    expect(res).toMatchObject({ ok: false, reason: 'already_settled' })
  })

  it('refuses an unknown event', async () => {
    const res = await settleSwipeEvent({
      supabase: fakeSupabase({ org: OK_ORG, event: null }),
      orgId: ORG_ID, eventId: 'nope',
    })
    expect(res).toMatchObject({ ok: false, reason: 'not_found' })
  })

  it('refuses when the org has no treasury configured', async () => {
    const res = await settleSwipeEvent({
      supabase: fakeSupabase({ org: null, event: approved('1000000') }),
      orgId: ORG_ID, eventId: 'evt-1',
    })
    expect(res).toMatchObject({ ok: false, reason: 'config' })
  })
})
