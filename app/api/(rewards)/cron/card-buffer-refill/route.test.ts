import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

// Fake supabase whose card_spend_buffers scan returns a configurable row set.
let SCAN_ROWS: unknown[] = []
vi.mock('@/lib/web2/supabase', () => ({
  getServiceClient: () => ({
    rpc: async () => ({ data: '0', error: null }), // reconcile_card_reservations
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        limit: async () => ({ data: SCAN_ROWS, error: null }),
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/org/bufferMonitor', () => ({ syncBufferBalance: vi.fn(async () => ({ ok: true, balanceAtomic: 0n })) }))
vi.mock('@/lib/org/bufferTuner', () => ({ tuneBufferSizing: vi.fn(async () => ({ ok: false, reason: 'insufficient_samples' })) }))
vi.mock('@/lib/org/bufferRefill', () => ({ refillCardBuffer: vi.fn() }))

import { POST } from '@/app/api/(rewards)/cron/card-buffer-refill/route'
import { refillCardBuffer } from '@/lib/org/bufferRefill'
import { syncBufferBalance } from '@/lib/org/bufferMonitor'
import { tuneBufferSizing } from '@/lib/org/bufferTuner'

const SECRET = 'cron-secret'
const authed = () =>
  new Request('http://localhost/api/cron/card-buffer-refill', { method: 'POST', headers: { authorization: `Bearer ${SECRET}` } })
const row = (orgCardId: string, orgId: string | null) => ({ org_card_id: orgCardId, org_cards: orgId ? { org_id: orgId } : null })

describe('POST /api/cron/card-buffer-refill', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(syncBufferBalance).mockResolvedValue({ ok: true, balanceAtomic: 0n })
    process.env.CRON_SECRET = SECRET
    SCAN_ROWS = []
  })
  afterEach(() => { delete process.env.CARD_BUFFER_REFILL_ENABLED })

  it('rejects an unauthorized request', async () => {
    process.env.CARD_BUFFER_REFILL_ENABLED = 'true'
    const res = await POST(new Request('http://localhost/api/cron/card-buffer-refill', { method: 'POST' }) as never)
    expect(res.status).toBe(401)
  })

  it('no-ops (enabled:false) when the feature flag is off — even authorized', async () => {
    // flag unset
    const res = await POST(authed() as never)
    const body = await res.json()
    expect(body).toMatchObject({ enabled: false, scanned: 0, refilled: 0 })
    expect(refillCardBuffer).not.toHaveBeenCalled()
  })

  it('syncs then refills each enabled buffer, tallying outcomes', async () => {
    process.env.CARD_BUFFER_REFILL_ENABLED = 'true'
    SCAN_ROWS = [row('card-A', 'org-1'), row('card-B', 'org-1'), row('card-C', 'org-2')]
    vi.mocked(refillCardBuffer)
      .mockResolvedValueOnce({ ok: true, txHash: '0xabc', explorerUrl: 'u', refilledAtomic: 10n, breakerTripped: false })
      .mockResolvedValueOnce({ ok: false, status: 200, error: 'at target', reason: 'at_target' })
      .mockResolvedValueOnce({ ok: false, status: 429, error: 'capped', reason: 'rate_capped' })

    const res = await POST(authed() as never)
    const body = await res.json()
    expect(body).toMatchObject({ enabled: true, scanned: 3, refilled: 1, skipped: 2, failed: 0 })
    expect(body.refilledCards).toEqual(['card-A'])
    // each buffer is adaptively tuned + reconciled before the refill decision
    expect(tuneBufferSizing).toHaveBeenCalledTimes(3)
    expect(syncBufferBalance).toHaveBeenCalledTimes(3)
    expect(refillCardBuffer).toHaveBeenCalledTimes(3)
    expect(vi.mocked(refillCardBuffer).mock.calls[0][0]).toMatchObject({ orgId: 'org-1', orgCardId: 'card-A', trigger: 'cron' })
  })

  it('counts a row with no resolvable org_id as failed, without calling refill', async () => {
    process.env.CARD_BUFFER_REFILL_ENABLED = 'true'
    SCAN_ROWS = [row('card-orphan', null)]
    const res = await POST(authed() as never)
    const body = await res.json()
    expect(body).toMatchObject({ enabled: true, scanned: 1, refilled: 0, skipped: 0, failed: 1 })
    expect(refillCardBuffer).not.toHaveBeenCalled()
  })

  it('a hard refill failure (e.g. tx) counts as failed, not skipped', async () => {
    process.env.CARD_BUFFER_REFILL_ENABLED = 'true'
    SCAN_ROWS = [row('card-x', 'org-1')]
    vi.mocked(refillCardBuffer).mockResolvedValue({ ok: false, status: 502, error: 'reverted', reason: 'tx' })
    const res = await POST(authed() as never)
    const body = await res.json()
    expect(body).toMatchObject({ scanned: 1, refilled: 0, skipped: 0, failed: 1 })
  })
})
