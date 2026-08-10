import { describe, it, expect, vi } from 'vitest'
import { resolveQuoteAmountUsd } from '@/lib/rewards/resolveQuote'

// Minimal chainable Supabase mock: .from().select().eq().maybeSingle() → result.
function supabaseReturning(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => result),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: vi.fn(() => chain) } as any
}

const WALLET = '0xabc0000000000000000000000000000000000001'
const future = () => new Date(Date.now() + 10 * 60_000).toISOString()
const past = () => new Date(Date.now() - 10 * 60_000).toISOString()

describe('resolveQuoteAmountUsd (audit HIGH #6/#7)', () => {
  it('returns the client value when no quote_id is supplied (backward compatible)', async () => {
    const sb = supabaseReturning({ data: null, error: null })
    const out = await resolveQuoteAmountUsd(sb, { wallet: WALLET, amount_usd: 100 })
    expect(out).toBe(100)
    expect(sb.from).not.toHaveBeenCalled() // no lookup without a quote_id
  })

  it('uses the SERVER-recorded amount_usd when the quote is valid (ignores the inflated client value)', async () => {
    const sb = supabaseReturning({
      data: { wallet: WALLET, amount_usd: 42.5, expires_at: future() },
      error: null,
    })
    // Client claims 9999; recorded quote says 42.5 → server wins.
    const out = await resolveQuoteAmountUsd(sb, { quote_id: 'q1', wallet: WALLET, amount_usd: 9999 })
    expect(out).toBe(42.5)
  })

  it('coerces a numeric-as-string amount_usd (PostgREST returns numeric as string)', async () => {
    const sb = supabaseReturning({
      data: { wallet: WALLET, amount_usd: '73.25', expires_at: future() },
      error: null,
    })
    const out = await resolveQuoteAmountUsd(sb, { quote_id: 'q1', wallet: WALLET, amount_usd: 9999 })
    expect(out).toBe(73.25)
  })

  it('falls back to the client value when the quote belongs to a DIFFERENT wallet', async () => {
    const sb = supabaseReturning({
      data: { wallet: '0xDEAD000000000000000000000000000000000000', amount_usd: 5, expires_at: future() },
      error: null,
    })
    const fb = vi.fn()
    const out = await resolveQuoteAmountUsd(sb, { quote_id: 'q1', wallet: WALLET, amount_usd: 100 }, fb)
    expect(out).toBe(100)
    expect(fb).toHaveBeenCalledWith(expect.objectContaining({ wallet_match: false }))
  })

  it('falls back when the quote has expired', async () => {
    const sb = supabaseReturning({
      data: { wallet: WALLET, amount_usd: 5, expires_at: past() },
      error: null,
    })
    const fb = vi.fn()
    const out = await resolveQuoteAmountUsd(sb, { quote_id: 'q1', wallet: WALLET, amount_usd: 100 }, fb)
    expect(out).toBe(100)
    expect(fb).toHaveBeenCalledWith(expect.objectContaining({ not_expired: false }))
  })

  it('falls back when the quote_id is unknown (no row)', async () => {
    const sb = supabaseReturning({ data: null, error: null })
    const out = await resolveQuoteAmountUsd(sb, { quote_id: 'nope', wallet: WALLET, amount_usd: 100 })
    expect(out).toBe(100)
  })
})
