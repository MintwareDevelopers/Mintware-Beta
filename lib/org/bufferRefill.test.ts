import { afterEach, describe, expect, it, vi } from 'vitest'

const { syncBufferBalance } = vi.hoisted(() => ({
  syncBufferBalance: vi.fn(async (): Promise<{ ok: boolean; balanceAtomic?: bigint; reason?: 'no_buffer' }> => ({ ok: true, balanceAtomic: 0n })),
}))
vi.mock('@/lib/org/bufferMonitor', () => ({ syncBufferBalance }))
import { refillCardBuffer } from './bufferRefill'

const ORG_ID = 'org-1'
const CARD_ID = 'card-1'
const OK_ORG = { card_funding_vault_address: '0xFundingVault', card_funding_chain_id: 84532, treasury_vault_address: '0xTreasury' }
const bufRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'buffer-1', org_card_id: CARD_ID, member_wallet: '0xabc', auto_refill_enabled: true,
  buffer_target_atomic: '100000000', buffer_balance_atomic: '0', ...overrides,
})
function fakeSupabase(opts: { org?: unknown; buf?: unknown }) {
  return {
    from(table: string) {
      const query: Record<string, unknown> = {}
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === 'orgs' ? (opts.org ?? OK_ORG) : (opts.buf ?? null), error: null }),
      }
      return Object.assign(chain, query)
    },
  } as never
}
const call = (supabase: unknown) => refillCardBuffer({ supabase: supabase as never, orgId: ORG_ID, orgCardId: CARD_ID })

describe('refillCardBuffer — configuration and chain-synced gates', () => {
  afterEach(() => {
    delete process.env.CARD_BUFFER_REFILL_ENABLED
    syncBufferBalance.mockReset()
    syncBufferBalance.mockResolvedValue({ ok: true, balanceAtomic: 0n })
  })

  it('requires a separate card-funding Earn vault', async () => {
    const result = await call(fakeSupabase({ org: { ...OK_ORG, card_funding_vault_address: null } }))
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'config' })
    expect(syncBufferBalance).not.toHaveBeenCalled()
  })

  it('returns not_found when the card has no buffer row', async () => {
    const result = await call(fakeSupabase({ buf: null }))
    expect(result).toMatchObject({ ok: false, status: 404, reason: 'not_found' })
  })

  it('synchronizes chain balance even while refill execution is disabled', async () => {
    const result = await call(fakeSupabase({ buf: bufRow() }))
    expect(result).toMatchObject({ ok: false, status: 503, reason: 'disabled' })
    expect(syncBufferBalance).toHaveBeenCalledOnce()
  })

  it('refuses an unregistered member destination', async () => {
    syncBufferBalance.mockResolvedValue({ ok: false, reason: 'no_buffer' })
    const result = await call(fakeSupabase({ buf: bufRow() }))
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'no_buffer' })
  })
})
