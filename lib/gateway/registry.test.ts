import { describe, it, expect, vi } from 'vitest'
import { computePoolId, verifyInstanceOnChain, registerInstance, type GatewayPoolKey } from './registry'

const QUOTE = '0x1111111111111111111111111111111111111111' as const
const PAIRED = '0x2222222222222222222222222222222222222222' as const
const PM = '0x00000000000000000000000000000000000000abc' as const

const poolKey: GatewayPoolKey = {
  currency0: QUOTE,
  currency1: PAIRED,
  fee: 3000,
  tickSpacing: 60,
  hooks: '0x0000000000000000000000000000000000000000',
}
const POOL_ID = computePoolId(poolKey)

// A mock read-only client returning the position manager's on-chain view.
function mockClient(over: { quoteAsset?: string; poolKey?: GatewayPoolKey; throwOn?: string } = {}) {
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (over.throwOn === functionName) throw new Error('rpc down')
      if (functionName === 'quoteAsset') return (over.quoteAsset ?? QUOTE) as `0x${string}`
      if (functionName === 'poolKey') return over.poolKey ?? poolKey
      throw new Error(`unexpected read: ${functionName}`)
    }),
  }
}

describe('computePoolId', () => {
  it('is deterministic and 32 bytes', () => {
    expect(computePoolId(poolKey)).toBe(POOL_ID)
    expect(POOL_ID).toMatch(/^0x[0-9a-f]{64}$/)
  })
  it('changes when any pool-key field changes', () => {
    expect(computePoolId({ ...poolKey, fee: 500 })).not.toBe(POOL_ID)
    expect(computePoolId({ ...poolKey, tickSpacing: 10 })).not.toBe(POOL_ID)
  })
})

describe('verifyInstanceOnChain (H-01)', () => {
  it('accepts a manager that fronts the approved pool + quote asset (case-insensitive)', async () => {
    const v = await verifyInstanceOnChain({
      client: mockClient(),
      positionManager: PM,
      expectedQuoteAsset: QUOTE.toUpperCase(),
      expectedPoolAddress: POOL_ID.toUpperCase(),
    })
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.poolId).toBe(POOL_ID)
  })

  it('rejects a quote-asset mismatch (substituted manager)', async () => {
    const v = await verifyInstanceOnChain({
      client: mockClient({ quoteAsset: '0x9999999999999999999999999999999999999999' }),
      positionManager: PM,
      expectedQuoteAsset: QUOTE,
      expectedPoolAddress: POOL_ID,
    })
    expect(v).toEqual({ ok: false, error: 'quote_asset_mismatch' })
  })

  it('rejects when the on-chain poolKey does not hash to the approved pool', async () => {
    const v = await verifyInstanceOnChain({
      client: mockClient(),
      positionManager: PM,
      expectedQuoteAsset: QUOTE,
      expectedPoolAddress: '0x' + 'de'.repeat(32), // a different, arbitrary pool id
    })
    expect(v).toEqual({ ok: false, error: 'pool_mismatch' })
  })

  it('rejects when the quote asset is not a leg of the pool', async () => {
    // manager reports quote==QUOTE, but its poolKey has neither leg equal to QUOTE
    const otherKey: GatewayPoolKey = { ...poolKey, currency0: PAIRED, currency1: '0x3333333333333333333333333333333333333333' }
    const v = await verifyInstanceOnChain({
      client: mockClient({ poolKey: otherKey }),
      positionManager: PM,
      expectedQuoteAsset: QUOTE,
      expectedPoolAddress: computePoolId(otherKey),
    })
    expect(v).toEqual({ ok: false, error: 'quote_not_in_pool' })
  })

  it('fails closed on an RPC read error', async () => {
    const v = await verifyInstanceOnChain({
      client: mockClient({ throwOn: 'poolKey' }),
      positionManager: PM,
      expectedQuoteAsset: QUOTE,
      expectedPoolAddress: POOL_ID,
    })
    expect(v).toEqual({ ok: false, error: 'onchain_read_failed' })
  })
})

describe('registerInstance verification gate (H-01)', () => {
  function mockSupabase() {
    const upsert = vi.fn(async () => ({ error: null }))
    return { client: { from: vi.fn(() => ({ upsert })) } as never, upsert }
  }
  const base = {
    poolAddress: POOL_ID,
    chainId: 4663,
    positionManager: PM,
    staging: '0x0000000000000000000000000000000000000dad',
    quoteAsset: QUOTE,
    pairedAsset: PAIRED,
  }

  it('writes the row when on-chain verification passes', async () => {
    const { client, upsert } = mockSupabase()
    const res = await registerInstance(client, base, { client: mockClient() })
    expect(res.ok).toBe(true)
    expect(upsert).toHaveBeenCalledOnce()
  })

  it('does NOT write the row when verification fails (substitution blocked)', async () => {
    const { client, upsert } = mockSupabase()
    const res = await registerInstance(client, base, {
      client: mockClient({ quoteAsset: '0x9999999999999999999999999999999999999999' }),
    })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('onchain_verify_failed:quote_asset_mismatch')
    expect(upsert).not.toHaveBeenCalled()
  })
})
