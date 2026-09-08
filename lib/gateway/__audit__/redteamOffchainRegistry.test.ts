// RED-TEAM PoC (off-chain, 2026-09-08) — A-7 deepened (R-2 ×4): the registry trust root accepted a LOOKALIKE
// PositionManager and let a curator-secret holder HOT-SWAP the deposit target of an ACTIVE pool.
//
// STATUS AFTER CLOSE-OUT (docs/developers/audits/closeout/registry-ledger.md §1) — the suite is FLIPPED.
// Each test replays the ORIGINAL attack (a hostile contract that echoes every view the old check read) and
// asserts the DEFENSE: the candidate must be tied to audited bytecode (factory record OR code-hash
// allowlist), the quote must equal the ENV USDG (never the curator's input), staging wiring is verified,
// hooked pools are rejected, and an ACTIVE row is NEVER written over (`active_instance_exists`, history row).
import { describe, it, expect, vi } from 'vitest'
import { keccak256 } from 'viem'
import { computePoolId, verifyInstanceOnChain, registerInstance, deactivateInstance, type GatewayPoolKey, type ReadClient, type RegistryTrustConfig } from '../registry'
import { fakeSupabase } from './fakeSupabase'

const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168' as const // real RH-mainnet USDG (public)
const MEME = '0x2222222222222222222222222222222222222222' as const
const REAL_PM = '0x00000000000000000000000000000000000ea1ea' as const
const REAL_STAGING = '0x000000000000000000000000000000000005ea60' as const
const EVIL_PM = '0x00000000000000000000000000000000000000ee' as const
const EVIL_STAGING = '0x000000000000000000000000000000000000dead' as const
const FACTORY = '0x00000000000000000000000000000000000fac70' as const
const ZERO = '0x0000000000000000000000000000000000000000' as const

const key: GatewayPoolKey = { currency0: MEME, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: ZERO }
const POOL_ID = computePoolId(key)

const AUDITED_CODE = '0x6080604052a0d17ed1' as const // stands in for the audited PM build's runtime code
const AUDITED_CODEHASH = keccak256(AUDITED_CODE)
const EVIL_CODE = '0x6080604052ee' as const // the lookalike's own bytecode — trivially different

const trustCodehash: RegistryTrustConfig = { factory: null, pmCodeHashes: [AUDITED_CODEHASH], expectedQuoteAsset: USDG }
const trustFactory: RegistryTrustConfig = { factory: FACTORY, pmCodeHashes: [], expectedQuoteAsset: USDG }
const trustNone: RegistryTrustConfig = { factory: null, pmCodeHashes: [], expectedQuoteAsset: USDG }

/** The ORIGINAL attack, upgraded: a hostile contract that ECHOES every view the old H-01 check read
 *  (`quoteAsset()` / `poolKey()`) AND every view the hardened check reads (`staging()`, the staging's
 *  `controller()` / `quoteAsset()`) — still only a handful of view functions to write — while its
 *  deposit() forwards the user's approved USDG to the attacker. Its bytecode is, of course, not the audited build. */
function lookalikePm(over: { quote?: string; pk?: GatewayPoolKey; code?: `0x${string}`; factoryPm?: string } = {}): ReadClient & { readContract: ReturnType<typeof vi.fn> } {
  const quote = over.quote ?? USDG
  const pk = over.pk ?? key
  const readContract = vi.fn(async ({ address, functionName }: { address: string; functionName: string }) => {
    const a = address.toLowerCase()
    if (a === FACTORY && functionName === 'instanceForPool') return { staging: REAL_STAGING, positionManager: over.factoryPm ?? REAL_PM, active: true }
    if (a === EVIL_STAGING) {
      if (functionName === 'controller') return EVIL_PM
      if (functionName === 'quoteAsset') return quote
    }
    if (functionName === 'quoteAsset') return quote
    if (functionName === 'poolKey') return pk
    if (functionName === 'staging') return EVIL_STAGING
    throw new Error(`unexpected read ${functionName}@${address}`)
  })
  return { readContract, getCode: async () => over.code ?? EVIL_CODE }
}

const verifyEvil = (client: ReadClient, trust: RegistryTrustConfig, pool = POOL_ID) =>
  verifyInstanceOnChain({ client, positionManager: EVIL_PM, staging: EVIL_STAGING, expectedPoolAddress: pool, trust })

describe('A-7 _FIXED: the registry trust root is no longer satisfiable by a lookalike PM', () => {
  it('defense holds: a contract that echoes EVERY view (quoteAsset/poolKey/staging/controller) is still refused — its code hash is not an audited build', async () => {
    const pm = lookalikePm()
    const v = await verifyEvil(pm, trustCodehash)
    expect(v).toEqual({ ok: false, error: 'codehash_not_allowlisted' })
    // …and the SAME echoes with the audited bytecode DO pass — the check is on bytecode, not on echoes
    const genuine = await verifyEvil(lookalikePm({ code: AUDITED_CODE }), trustCodehash)
    expect(genuine).toMatchObject({ ok: true, verification: 'codehash', quoteAsset: USDG })
  })

  it('defense holds: with a factory trust root the factory record must name THIS pm — a lookalike is `factory_pm_mismatch`', async () => {
    const v = await verifyEvil(lookalikePm(), trustFactory)
    expect(v).toEqual({ ok: false, error: 'factory_pm_mismatch' })
    // the factory saying "yes, this is my instance" is what passes
    expect(await verifyEvil(lookalikePm({ factoryPm: EVIL_PM }), trustFactory)).toEqual({ ok: false, error: 'factory_staging_mismatch' }) // and staging must match too
  })

  it('defense holds: NO trust root configured ⇒ `trust_root_unconfigured` before a single RPC call (never silent trust)', async () => {
    const pm = lookalikePm()
    const v = await verifyEvil(pm, trustNone)
    expect(v).toEqual({ ok: false, error: 'trust_root_unconfigured' })
    expect(pm.readContract).not.toHaveBeenCalled()
  })

  it('defense holds: the quote is checked against the PLATFORM USDG (env) — a fake "USDG" that is internally consistent is `quote_asset_mismatch`', async () => {
    const FAKE = '0xfa4efa4efa4efa4efa4efa4efa4efa4efa4efa4e' as const
    const fakeKey = { ...key, currency1: FAKE }
    // the old attack: curator body says quoteAsset = FAKE, the lookalike echoes FAKE, and the pool id matches
    const v = await verifyEvil(lookalikePm({ quote: FAKE, pk: fakeKey, code: AUDITED_CODE }), trustCodehash, computePoolId(fakeKey))
    expect(v).toEqual({ ok: false, error: 'quote_asset_mismatch' })
    // and `registerInstance` ignores the curator-supplied quoteAsset entirely — the env is the only source
    const { db, client } = fakeSupabase({ tables: { gateway_instances: [], gateway_instance_history: [] } })
    const r = await registerInstance(client, { poolAddress: computePoolId(fakeKey), chainId: 4663, positionManager: EVIL_PM, staging: EVIL_STAGING, quoteAsset: FAKE }, { client: lookalikePm({ quote: FAKE, pk: fakeKey, code: AUDITED_CODE }), trust: trustCodehash })
    expect(r).toEqual({ ok: false, error: 'onchain_verify_failed:quote_asset_mismatch' })
    expect(db.tables.gateway_instances).toHaveLength(0)
    expect(db.tables.gateway_instance_history[0]).toMatchObject({ action: 'refused', reason: 'onchain_verify_failed:quote_asset_mismatch' })
  })

  it('defense holds: a hooked pool key is rejected off-chain too (`hooked_pool_rejected`), before any other comparison', async () => {
    const hooked = { ...key, hooks: '0x00000000000000000000000000000000000000c0' as const }
    const v = await verifyEvil(lookalikePm({ pk: hooked, code: AUDITED_CODE }), trustCodehash, computePoolId(hooked))
    expect(v).toEqual({ ok: false, error: 'hooked_pool_rejected' })
  })

  it('defense holds: registerInstance READS BEFORE WRITE — an ACTIVE pool’s deposit target is never replaced (`active_instance_exists`), and the refusal is logged', async () => {
    const { db, client } = fakeSupabase({
      tables: {
        gateway_instances: [{ id: 'live', pool_address: POOL_ID, chain_id: 4663, position_manager: REAL_PM, staging: REAL_STAGING, quote_asset: USDG, status: 'active' }],
        gateway_instance_history: [],
      },
    })
    // the strongest attacker: a lookalike that even carries the AUDITED bytecode (e.g. a re-deploy of the real
    // build with a hostile owner) — verification passes, and the hot-swap is STILL refused
    const r = await registerInstance(
      client,
      { poolAddress: POOL_ID, chainId: 4663, positionManager: EVIL_PM, staging: EVIL_STAGING, quoteAsset: USDG, createdBy: 'curator:0xbad' },
      { client: lookalikePm({ code: AUDITED_CODE }), trust: trustCodehash },
    )
    expect(r).toEqual({ ok: false, error: 'active_instance_exists' })
    const row = db.tables.gateway_instances.find((x) => x.pool_address === POOL_ID)!
    expect(row.position_manager).toBe(REAL_PM) // ← the row every /api/gateway/meta + deposit-verify reads is untouched
    expect(row.staging).toBe(REAL_STAGING)
    expect(row.status).toBe('active')
    expect(db.tables.gateway_instances).toHaveLength(1)
    // no upsert / update / insert ever hit gateway_instances; the only write is the refusal in the history table
    expect(db.calls.filter((c) => c.table === 'gateway_instances').map((c) => c.op)).toEqual(['select'])
    expect(db.tables.gateway_instance_history).toEqual([
      expect.objectContaining({ action: 'refused', reason: 'active_instance_exists', position_manager: EVIL_PM, actor: 'curator:0xbad', meta: { existingPositionManager: REAL_PM } }),
    ])
  })

  it('defense holds: replacing a live instance is an explicit, logged two-step — deactivate (reason required) then register', async () => {
    const { db, client } = fakeSupabase({
      tables: {
        gateway_instances: [{ id: 'live', pool_address: POOL_ID, chain_id: 4663, position_manager: REAL_PM, staging: REAL_STAGING, quote_asset: USDG, status: 'active' }],
        gateway_instance_history: [],
      },
    })
    expect(await deactivateInstance(client, { poolAddress: POOL_ID, chainId: 4663, by: 'ops:0xabc', reason: '' })).toEqual({ ok: false, error: 'reason_required' })
    expect(await deactivateInstance(client, { poolAddress: POOL_ID, chainId: 4663, by: 'ops:0xabc', reason: 'rotating rig' })).toEqual({ ok: true })
    expect(db.tables.gateway_instances[0]).toMatchObject({ status: 'inactive', deactivated_by: 'ops:0xabc', deactivate_reason: 'rotating rig' })
    const r = await registerInstance(client, { poolAddress: POOL_ID, chainId: 4663, positionManager: EVIL_PM, staging: EVIL_STAGING }, { client: lookalikePm({ code: AUDITED_CODE }), trust: trustCodehash })
    expect(r).toMatchObject({ ok: true, verification: 'codehash' })
    expect(db.tables.gateway_instances).toHaveLength(1) // re-activated in place, never a second row
    expect(db.tables.gateway_instances[0]).toMatchObject({ position_manager: EVIL_PM, status: 'active', quote_asset: USDG, verification: 'codehash' })
    expect(db.tables.gateway_instance_history.map((h) => h.action)).toEqual(['deactivate', 'register'])
    expect(db.tables.gateway_instance_history[1]).toMatchObject({ prev_position_manager: REAL_PM, position_manager: EVIL_PM })
  })
})
