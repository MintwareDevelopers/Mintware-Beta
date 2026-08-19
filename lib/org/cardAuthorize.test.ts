import { describe, it, expect, vi } from 'vitest'
import { decideCardSwipe } from './cardAuthorize'
import type { EdgeAuthorizer } from '@/lib/x402/facilitator'

const ORG_ID = 'org-1'
const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const CARD_TOKEN = 'card-token-1'

/** Minimal fake of the two `.from(...)` chains decideCardSwipe touches — org_cards then
 *  org_members — keyed so each table returns its own fixture, same spirit as the facilitator
 *  tests' plain-object port fakes (no real supabase-js involved). */
function fakeSupabase(opts: {
  card?: { org_id: string; member_wallet: string; state: string } | null
  cardError?: boolean
  member?: { role: string; status: string } | null
  memberError?: boolean
}) {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (table === 'org_cards') {
            return opts.cardError ? { data: null, error: new Error('boom') } : { data: opts.card ?? null, error: null }
          }
          if (table === 'org_members') {
            return opts.memberError ? { data: null, error: new Error('boom') } : { data: opts.member ?? null, error: null }
          }
          throw new Error(`unexpected table ${table}`)
        },
      }
      return chain
    },
  } as any
}

const OPEN_CARD = { org_id: ORG_ID, member_wallet: WALLET, state: 'OPEN' }
const ACTIVE_CONTRIBUTOR = { role: 'contributor', status: 'active' } // $2,000/day cap
const approveEdge: EdgeAuthorizer = { authorize: vi.fn(async () => ({ approved: true, holdId: 'hold-1' })) }
const declineEdge: EdgeAuthorizer = { authorize: async () => ({ approved: false, reason: 'insufficient_equity' }) }

describe('decideCardSwipe', () => {
  it('approves a small swipe for an active contributor when edge-auth approves', async () => {
    const res = await decideCardSwipe({
      supabase: fakeSupabase({ card: OPEN_CARD, member: ACTIVE_CONTRIBUTOR }),
      provider: 'lithic', providerCardToken: CARD_TOKEN,
      amountAtomicUsdc: 50_000_000n, ref: 'evt-1', edge: approveEdge,
    })
    expect(res).toMatchObject({ approved: true, holdId: 'hold-1' })
  })

  it('declines an unknown card without calling edge-auth', async () => {
    const edge: EdgeAuthorizer = { authorize: vi.fn(async () => ({ approved: true })) }
    const res = await decideCardSwipe({
      supabase: fakeSupabase({ card: null }),
      provider: 'lithic', providerCardToken: 'nope',
      amountAtomicUsdc: 1_000_000n, ref: 'evt-2', edge,
    })
    expect(res).toMatchObject({ approved: false, reason: 'unknown_card' })
    expect(edge.authorize).not.toHaveBeenCalled()
  })

  it('declines a paused card', async () => {
    const res = await decideCardSwipe({
      supabase: fakeSupabase({ card: { ...OPEN_CARD, state: 'PAUSED' }, member: ACTIVE_CONTRIBUTOR }),
      provider: 'lithic', providerCardToken: CARD_TOKEN,
      amountAtomicUsdc: 1_000_000n, ref: 'evt-3', edge: approveEdge,
    })
    expect(res).toMatchObject({ approved: false, reason: 'card_not_open' })
  })

  it('declines an inactive member', async () => {
    const res = await decideCardSwipe({
      supabase: fakeSupabase({ card: OPEN_CARD, member: { role: 'contributor', status: 'invited' } }),
      provider: 'lithic', providerCardToken: CARD_TOKEN,
      amountAtomicUsdc: 1_000_000n, ref: 'evt-4', edge: approveEdge,
    })
    expect(res).toMatchObject({ approved: false, reason: 'member_not_active' })
  })

  it('enforces the role daily cap (belt) before ever calling edge-auth', async () => {
    const edge: EdgeAuthorizer = { authorize: vi.fn(async () => ({ approved: true })) }
    const res = await decideCardSwipe({
      supabase: fakeSupabase({ card: OPEN_CARD, member: ACTIVE_CONTRIBUTOR }),
      provider: 'lithic', providerCardToken: CARD_TOKEN,
      amountAtomicUsdc: 2_000_000_001n, // $2,000.000001 — one atomic unit over the $2k contributor cap
      ref: 'evt-5', edge,
    })
    expect(res).toMatchObject({ approved: false, reason: 'over_role_daily_cap' })
    expect(edge.authorize).not.toHaveBeenCalled()
  })

  it('a vendor (receive-only, 0 cap) can never swipe', async () => {
    const res = await decideCardSwipe({
      supabase: fakeSupabase({ card: OPEN_CARD, member: { role: 'vendor', status: 'active' } }),
      provider: 'lithic', providerCardToken: CARD_TOKEN,
      amountAtomicUsdc: 1n, ref: 'evt-6', edge: approveEdge,
    })
    expect(res).toMatchObject({ approved: false, reason: 'over_role_daily_cap' })
  })

  it('an owner (uncapped) passes the belt regardless of amount', async () => {
    const res = await decideCardSwipe({
      supabase: fakeSupabase({ card: OPEN_CARD, member: { role: 'owner', status: 'active' } }),
      provider: 'lithic', providerCardToken: CARD_TOKEN,
      amountAtomicUsdc: 1_000_000_000_000n, ref: 'evt-7', edge: approveEdge,
    })
    expect(res).toMatchObject({ approved: true })
  })

  it('surfaces an edge-auth decline (suspenders) even when the belt passes', async () => {
    const res = await decideCardSwipe({
      supabase: fakeSupabase({ card: OPEN_CARD, member: ACTIVE_CONTRIBUTOR }),
      provider: 'lithic', providerCardToken: CARD_TOKEN,
      amountAtomicUsdc: 50_000_000n, ref: 'evt-8', edge: declineEdge,
    })
    expect(res).toMatchObject({ approved: false, reason: 'insufficient_equity' })
  })

  it('fails CLOSED when edge-auth is unconfigured — never default-approve', async () => {
    const res = await decideCardSwipe({
      supabase: fakeSupabase({ card: OPEN_CARD, member: ACTIVE_CONTRIBUTOR }),
      provider: 'lithic', providerCardToken: CARD_TOKEN,
      amountAtomicUsdc: 1_000_000n, ref: 'evt-9', edge: null,
    })
    expect(res).toMatchObject({ approved: false, reason: 'edge_auth_unconfigured' })
  })

  it('rejects a non-positive amount before any lookup', async () => {
    const res = await decideCardSwipe({
      supabase: fakeSupabase({}),
      provider: 'lithic', providerCardToken: CARD_TOKEN,
      amountAtomicUsdc: 0n, ref: 'evt-10', edge: approveEdge,
    })
    expect(res).toMatchObject({ approved: false, reason: 'non_positive_amount' })
  })
})
