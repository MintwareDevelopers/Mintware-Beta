import { describe, it, expect, vi, afterEach } from 'vitest'
import { decideCardSwipe } from './cardAuthorize'
import type { EdgeAuthorizer } from '@/lib/x402/facilitator'

const ORG_ID = 'org-1'
const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const OWNER_WALLET = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' // distinct from WALLET by default,
// so the existing "member" tests below exercise the org_members path, not the owner bypass.
const CARD_TOKEN = 'card-token-1'

/** Minimal fake of the three `.from(...)` chains decideCardSwipe touches — org_cards, orgs, then
 *  (non-owner only) org_members — keyed so each table returns its own fixture, same spirit as the
 *  facilitator tests' plain-object port fakes (no real supabase-js involved). */
function fakeSupabase(opts: {
  card?: { org_id: string; member_wallet: string; state: string } | null
  cardError?: boolean
  orgOwnerWallet?: string
  orgError?: boolean
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
        single: async () => {
          if (table === 'orgs') {
            return opts.orgError
              ? { data: null, error: new Error('boom') }
              : { data: { owner_wallet: opts.orgOwnerWallet ?? OWNER_WALLET }, error: null }
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

  it('the org owner can swipe their own card with NO org_members row at all (issuance already lets them hold one without membership)', async () => {
    const edge: EdgeAuthorizer = { authorize: vi.fn(async () => ({ approved: true, holdId: 'hold-owner' })) }
    const res = await decideCardSwipe({
      supabase: fakeSupabase({ card: OPEN_CARD, orgOwnerWallet: WALLET, member: null }), // no membership row
      provider: 'lithic', providerCardToken: CARD_TOKEN,
      amountAtomicUsdc: 1_000_000_000_000n, ref: 'evt-owner-1', edge,
    })
    expect(res).toMatchObject({ approved: true, holdId: 'hold-owner' })
  })

  it('declines when the org lookup itself fails', async () => {
    const res = await decideCardSwipe({
      supabase: fakeSupabase({ card: OPEN_CARD, orgError: true }),
      provider: 'lithic', providerCardToken: CARD_TOKEN,
      amountAtomicUsdc: 1_000_000n, ref: 'evt-org-err', edge: approveEdge,
    })
    expect(res).toMatchObject({ approved: false, reason: 'org_lookup_failed' })
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

  // ─── Standing perks — widen-only within existing hard caps, fail-safe to today's behavior ──────
  describe('standing perks', () => {
    it('BASE/unknown standing (no tier injected, empty history) = today’s EXACT behavior: $2,500 over the $2k contributor cap still declines', async () => {
      const res = await decideCardSwipe({
        supabase: fakeSupabase({ card: OPEN_CARD, member: ACTIVE_CONTRIBUTOR }),
        provider: 'lithic', providerCardToken: CARD_TOKEN,
        amountAtomicUsdc: 2_500_000_000n, ref: 'evt-std-1', edge: approveEdge,
        // no standingTier → computed on-read → the fake has no settled history → `none`
      })
      expect(res).toMatchObject({ approved: false, reason: 'over_role_daily_cap' })
    })

    it('Perk #1 (Trusted): the SAME $2,500 swipe now passes the belt (cap widened ×1.5 → $3,000) and reaches edge-auth', async () => {
      const edge: EdgeAuthorizer = { authorize: vi.fn(async () => ({ approved: true, holdId: 'hold-trusted' })) }
      const res = await decideCardSwipe({
        supabase: fakeSupabase({ card: OPEN_CARD, member: ACTIVE_CONTRIBUTOR }),
        provider: 'lithic', providerCardToken: CARD_TOKEN,
        amountAtomicUsdc: 2_500_000_000n, ref: 'evt-std-2', edge, standingTier: 'trusted',
      })
      expect(res).toMatchObject({ approved: true, holdId: 'hold-trusted' })
      expect(edge.authorize).toHaveBeenCalledOnce()
    })

    it('Perk #1 does NOT remove the cap: a Trusted contributor spending above the raised $3,000 still declines', async () => {
      const res = await decideCardSwipe({
        supabase: fakeSupabase({ card: OPEN_CARD, member: ACTIVE_CONTRIBUTOR }),
        provider: 'lithic', providerCardToken: CARD_TOKEN,
        amountAtomicUsdc: 3_000_000_001n, ref: 'evt-std-3', edge: approveEdge, standingTier: 'trusted',
      })
      expect(res).toMatchObject({ approved: false, reason: 'over_role_daily_cap' })
    })

    describe('Perk #2 (Established headroom soft ceiling)', () => {
      const prev = process.env.CARD_SOFT_HEADROOM_BASE_FRACTION
      afterEach(() => {
        if (prev === undefined) delete process.env.CARD_SOFT_HEADROOM_BASE_FRACTION
        else process.env.CARD_SOFT_HEADROOM_BASE_FRACTION = prev
      })

      it('DISABLED by default: a $200 swipe (over the $125 soft floor, under the $250 hard) is NOT blocked by headroom — reaches edge-auth', async () => {
        delete process.env.CARD_SOFT_HEADROOM_BASE_FRACTION
        const edge: EdgeAuthorizer = { authorize: vi.fn(async () => ({ approved: true, holdId: 'h' })) }
        const res = await decideCardSwipe({
          supabase: fakeSupabase({ card: OPEN_CARD, member: ACTIVE_CONTRIBUTOR }),
          provider: 'lithic', providerCardToken: CARD_TOKEN,
          amountAtomicUsdc: 200_000_000n, ref: 'evt-std-4', edge, standingTier: 'none',
        })
        expect(res).toMatchObject({ approved: true })
        expect(edge.authorize).toHaveBeenCalledOnce()
      })

      it('ENGAGED (floor 0.5): a base/none tier is soft-capped at $125 → a $200 swipe declines, never reaching edge-auth', async () => {
        process.env.CARD_SOFT_HEADROOM_BASE_FRACTION = '0.5'
        const edge: EdgeAuthorizer = { authorize: vi.fn(async () => ({ approved: true })) }
        const res = await decideCardSwipe({
          supabase: fakeSupabase({ card: OPEN_CARD, member: ACTIVE_CONTRIBUTOR }),
          provider: 'lithic', providerCardToken: CARD_TOKEN,
          amountAtomicUsdc: 200_000_000n, ref: 'evt-std-5', edge, standingTier: 'none',
        })
        expect(res).toMatchObject({ approved: false, reason: 'over_headroom_soft_cap' })
        expect(edge.authorize).not.toHaveBeenCalled()
      })

      it('ENGAGED (floor 0.5): Trusted widens the soft ceiling to the full $250 → the SAME $200 swipe passes headroom', async () => {
        process.env.CARD_SOFT_HEADROOM_BASE_FRACTION = '0.5'
        const edge: EdgeAuthorizer = { authorize: vi.fn(async () => ({ approved: true, holdId: 'h2' })) }
        const res = await decideCardSwipe({
          supabase: fakeSupabase({ card: OPEN_CARD, member: ACTIVE_CONTRIBUTOR }),
          provider: 'lithic', providerCardToken: CARD_TOKEN,
          amountAtomicUsdc: 200_000_000n, ref: 'evt-std-6', edge, standingTier: 'trusted',
        })
        expect(res).toMatchObject({ approved: true, holdId: 'h2' })
      })

      it('ENGAGED: even a widened tier can NEVER exceed the hard $250 ceiling — $300 declines for Trusted too', async () => {
        process.env.CARD_SOFT_HEADROOM_BASE_FRACTION = '0.5'
        const res = await decideCardSwipe({
          supabase: fakeSupabase({ card: OPEN_CARD, member: ACTIVE_CONTRIBUTOR }),
          provider: 'lithic', providerCardToken: CARD_TOKEN,
          amountAtomicUsdc: 300_000_000n, ref: 'evt-std-7', edge: approveEdge, standingTier: 'trusted',
        })
        expect(res).toMatchObject({ approved: false, reason: 'over_headroom_soft_cap' })
      })
    })
  })
})
