import { describe, it, expect } from 'vitest'
import { putStandingPermit, getStandingPermit } from './permitStore'

// A tiny in-memory fake of the supabase query surface these two functions use:
//   .from(table).upsert(row, { onConflict })         → { error }
//   .from(table).select(cols).eq().eq().maybeSingle() → { data, error }
// Keyed by (payer, gateway) exactly like the unique index, so upsert overwrites.
function fakeSupabase() {
  const rows = new Map<string, Record<string, unknown>>()
  const key = (p: string, g: string) => `${p}::${g}`
  return {
    rows,
    from() {
      return {
        upsert(row: Record<string, unknown>) {
          rows.set(key(row.payer as string, row.gateway as string), { ...row })
          return Promise.resolve({ error: null })
        },
        select() {
          const filters: Record<string, string> = {}
          const builder = {
            eq(col: string, val: string) {
              filters[col] = val
              return builder
            },
            maybeSingle() {
              const row = rows.get(key(filters.payer, filters.gateway))
              return Promise.resolve({ data: row ?? null, error: null })
            },
          }
          return builder
        },
      }
    },
  }
}

const PAYER = '0xAAaAAaAAaAaAaAaAAaaAAaAaAaaAaaAaAaAaAAAA'
const GATEWAY = '0xBbBBbBbbBBBbBBbBBBBBbBBbbbBbBbbbBBbBBbBB'

const input = {
  payer: PAYER,
  gateway: GATEWAY,
  chainId: 84532,
  user: PAYER,
  maxDailySpendUsdc: '2000000',
  nonce: '7',
  deadline: '1999999999',
  signature: '0x' + 'ab'.repeat(65),
}

describe('x402 permitStore', () => {
  it('round-trips a stored permit in the relayer SettleParams.permit wire shape', async () => {
    const sb = fakeSupabase()
    const put = await putStandingPermit(sb as never, input)
    expect(put).toEqual({ ok: true })

    // lookup is case-insensitive on payer/gateway (stored lowercased)
    const got = await getStandingPermit(sb as never, PAYER.toUpperCase(), GATEWAY.toUpperCase())
    expect(got).toEqual({
      user: PAYER.toLowerCase(),
      max_daily_spend_usdc: '2000000',
      nonce: '7',
      deadline: '1999999999',
      signature: input.signature,
    })
  })

  it('returns null when no permit is registered for (payer, gateway)', async () => {
    const sb = fakeSupabase()
    expect(await getStandingPermit(sb as never, PAYER, GATEWAY)).toBeNull()
  })

  it('re-registering overwrites the prior permit (newest wins, keyed by payer+gateway)', async () => {
    const sb = fakeSupabase()
    await putStandingPermit(sb as never, input)
    await putStandingPermit(sb as never, { ...input, nonce: '8', maxDailySpendUsdc: '5000000' })
    const got = await getStandingPermit(sb as never, PAYER, GATEWAY)
    expect(got?.nonce).toBe('8')
    expect(got?.max_daily_spend_usdc).toBe('5000000')
    expect(sb.rows.size).toBe(1)
  })

  it('fails closed (null) on a query error', async () => {
    const erroring = {
      from() {
        return {
          select() {
            const b = {
              eq() { return b },
              maybeSingle() { return Promise.resolve({ data: null, error: { message: 'boom' } }) },
            }
            return b
          },
        }
      },
    }
    expect(await getStandingPermit(erroring as never, PAYER, GATEWAY)).toBeNull()
  })
})
