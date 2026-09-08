// ROUND-3 EXPLOIT REPLAY — registry misrouting (KyberSwap 2023 / Balancer 2023 DNS-hijack analog: the
// FRONTEND pointed users at an attacker contract). Target: the O-3 trust root in lib/gateway/registry.ts
// and the O-2 strict resolver.
//
// Question 1: `LP_GATEWAY_PM_CODEHASHES` allowlists keccak256(runtime code). A contract with IDENTICAL
// bytecode but different constructor args passes a code-hash check by definition — does registerInstance
// ALSO check the wiring? Answer below: the PM's constructor args (staging, quoteAsset, pairedAsset, ticks,
// band, poolManager, positionManager) are `immutable` in MintwareLpGatewayPositionManager.sol, so they are
// EMBEDDED in the runtime code → a lookalike with a different staging/adapter has a DIFFERENT hash. Only
// `owner_` (Ownable storage) and `harvestRecipient_` (storage) differ without changing the hash — and a
// same-staging clone is stopped by `staging.controller() == pm`. The off-chain check never reads
// `owner()`, `harvestRecipient()` or `staging.adapter()`: the defense is an on-chain accident of
// immutability, not a registry assertion.
import { describe, it, expect } from 'vitest'
import { keccak256 } from 'viem'
import { verifyInstanceOnChain, computePoolId, registerInstance, type ReadClient, type RegistryTrustConfig } from '@/lib/gateway/registry'
import { resolveInstanceStrict } from '@/lib/gateway/routeInstance'
import { fakeSupabase } from '@/lib/gateway/__audit__/fakeSupabase'

const USDG = ('0x' + '11'.repeat(20)) as `0x${string}`
const PONS = ('0x' + '22'.repeat(20)) as `0x${string}`
const KEY = { currency0: USDG, currency1: PONS, fee: 3000, tickSpacing: 60, hooks: ('0x' + '00'.repeat(20)) as `0x${string}` }
const POOL_ID = computePoolId(KEY)
const LEGIT_PM = '0x' + 'aa'.repeat(20)
const LEGIT_STG = '0x' + 'bb'.repeat(20)
const ATTACKER_PM = '0x' + 'cc'.repeat(20)
const ATTACKER_STG = '0x' + 'dd'.repeat(20)
const ATTACKER = '0x' + 'ee'.repeat(20)
const GATEWAY_SEAT = '0x' + '18'.repeat(20)

// "runtime bytecode" stand-ins: identical immutables ⇒ identical bytes; a different staging ⇒ different bytes.
const codeFor = (staging: string) => (`0x6080${'60'.repeat(40)}${staging.slice(2)}${'ff'.repeat(16)}`) as `0x${string}`
const AUDITED_HASH = keccak256(codeFor(LEGIT_STG)).toLowerCase()
const trust: RegistryTrustConfig = { factory: null, pmCodeHashes: [AUDITED_HASH], expectedQuoteAsset: USDG }

type World = {
  pms: Record<string, { staging: string; owner: string; harvestRecipient: string; code: `0x${string}` }>
  stagings: Record<string, { controller: string; quoteAsset: string; adapter: string }>
}
function client(w: World, reads: string[] = []): ReadClient {
  return {
    async readContract(a: { address: string; functionName: string }) {
      const addr = a.address.toLowerCase()
      reads.push(`${addr === LEGIT_PM ? 'legitPM' : addr === ATTACKER_PM ? 'attackerPM' : addr === LEGIT_STG ? 'legitSTG' : addr === ATTACKER_STG ? 'attackerSTG' : addr}.${a.functionName}`)
      const pm = w.pms[addr]
      if (pm) {
        if (a.functionName === 'quoteAsset') return USDG
        if (a.functionName === 'poolKey') return KEY
        if (a.functionName === 'staging') return pm.staging
        if (a.functionName === 'owner') return pm.owner
        if (a.functionName === 'harvestRecipient') return pm.harvestRecipient
      }
      const st = w.stagings[addr]
      if (st) {
        if (a.functionName === 'controller') return st.controller
        if (a.functionName === 'quoteAsset') return st.quoteAsset
        if (a.functionName === 'adapter') return st.adapter
      }
      throw new Error(`no such read ${addr}.${a.functionName}`)
    },
    async getCode({ address }) { return w.pms[address.toLowerCase()]?.code ?? '0x' },
  }
}
const legitWorld = (): World => ({
  pms: { [LEGIT_PM]: { staging: LEGIT_STG, owner: GATEWAY_SEAT, harvestRecipient: GATEWAY_SEAT, code: codeFor(LEGIT_STG) } },
  stagings: { [LEGIT_STG]: { controller: LEGIT_PM, quoteAsset: USDG, adapter: '0x' + '99'.repeat(20) } },
})

describe('lookalike PM with the AUDITED bytecode (code-hash allowlist passes by definition)', () => {
  it('baseline: the legit rig verifies via codehash', async () => {
    const r = await verifyInstanceOnChain({ client: client(legitWorld()), positionManager: LEGIT_PM as `0x${string}`, staging: LEGIT_STG as `0x${string}`, expectedPoolAddress: POOL_ID, trust })
    expect(r).toMatchObject({ ok: true, verification: 'codehash' })
  })

  it('MITIGATED (by staging one-controller invariant): clone with identical immutables (same staging ⇒ same hash) but ATTACKER owner → staging_controller_mismatch', async () => {
    const w = legitWorld()
    w.pms[ATTACKER_PM] = { staging: LEGIT_STG, owner: ATTACKER, harvestRecipient: ATTACKER, code: codeFor(LEGIT_STG) } // identical bytes
    expect(keccak256(w.pms[ATTACKER_PM].code).toLowerCase()).toBe(AUDITED_HASH)
    const r = await verifyInstanceOnChain({ client: client(w), positionManager: ATTACKER_PM as `0x${string}`, staging: LEGIT_STG as `0x${string}`, expectedPoolAddress: POOL_ID, trust })
    expect(r).toEqual({ ok: false, error: 'staging_controller_mismatch' }) // legit staging says controller == LEGIT_PM
  })

  it('MITIGATED (by immutability, i.e. accident of the build): clone bound to ITS OWN staging (own adapter, controller == clone) → codehash differs → refused', async () => {
    const w = legitWorld()
    w.pms[ATTACKER_PM] = { staging: ATTACKER_STG, owner: ATTACKER, harvestRecipient: ATTACKER, code: codeFor(ATTACKER_STG) }
    w.stagings[ATTACKER_STG] = { controller: ATTACKER_PM, quoteAsset: USDG, adapter: ATTACKER /* drainable mock adapter */ }
    const r = await verifyInstanceOnChain({ client: client(w), positionManager: ATTACKER_PM as `0x${string}`, staging: ATTACKER_STG as `0x${string}`, expectedPoolAddress: POOL_ID, trust })
    expect(r).toEqual({ ok: false, error: 'codehash_not_allowlisted' })
  })

  it('THE GAP (Medium, latent): the off-chain root never reads owner() / harvestRecipient() / staging.adapter() — if a PM build ever moves `staging` out of an immutable (or an operator allowlists a hash for a factory-less rig whose staging is attacker-wired), an attacker-owned instance passes', async () => {
    const reads: string[] = []
    const w = legitWorld()
    // hypothetical: an attacker PM whose bytecode hash IS allowlisted and whose staging says controller == attacker PM
    // (the exact situation the on-chain immutables currently prevent — modelled here to show the off-chain check alone would accept it)
    w.pms[ATTACKER_PM] = { staging: ATTACKER_STG, owner: ATTACKER, harvestRecipient: ATTACKER, code: codeFor(LEGIT_STG) }
    w.stagings[ATTACKER_STG] = { controller: ATTACKER_PM, quoteAsset: USDG, adapter: ATTACKER }
    const r = await verifyInstanceOnChain({ client: client(w, reads), positionManager: ATTACKER_PM as `0x${string}`, staging: ATTACKER_STG as `0x${string}`, expectedPoolAddress: POOL_ID, trust })
    expect(r).toMatchObject({ ok: true, verification: 'codehash' }) // ← accepted; owner + adapter unverified
    expect(reads.some((x) => x.endsWith('.owner'))).toBe(false)
    expect(reads.some((x) => x.endsWith('.harvestRecipient'))).toBe(false)
    expect(reads.some((x) => x.endsWith('.adapter'))).toBe(false)
  })

  it('factory trust root: whatever `LP_GATEWAY_FACTORY.instanceForPool` returns as active is accepted with NO bytecode check — the env var is the anchor', async () => {
    const w = legitWorld()
    w.pms[ATTACKER_PM] = { staging: ATTACKER_STG, owner: ATTACKER, harvestRecipient: ATTACKER, code: '0xdead' }
    w.stagings[ATTACKER_STG] = { controller: ATTACKER_PM, quoteAsset: USDG, adapter: ATTACKER }
    const FACTORY = ('0x' + 'fa'.repeat(20)) as `0x${string}`
    const c = client(w)
    const base = c.readContract
    c.readContract = async (a: { address: string; functionName: string; args?: unknown[] }) =>
      a.address.toLowerCase() === FACTORY && a.functionName === 'instanceForPool' ? [ATTACKER_STG, ATTACKER_PM, true] : base(a)
    const r = await verifyInstanceOnChain({ client: c, positionManager: ATTACKER_PM as `0x${string}`, staging: ATTACKER_STG as `0x${string}`, expectedPoolAddress: POOL_ID, trust: { ...trust, factory: FACTORY, pmCodeHashes: [] } })
    expect(r).toMatchObject({ ok: true, verification: 'factory' })
  })
})

describe('poisoned gateway_instances row (assume service-role DB write) — THEORETICAL, accepted by design', () => {
  it('resolveInstanceStrict trusts the row: an attacker PM in an ACTIVE row is served live:true with zero RPC verification', async () => {
    const { client: sb } = fakeSupabase({ tables: { gateway_instances: [{ id: 'r1', pool_address: POOL_ID, chain_id: 46630, position_manager: ATTACKER_PM, staging: ATTACKER_STG, quote_asset: USDG, status: 'active' }] } })
    const r = await resolveInstanceStrict(sb, { chainId: 46630, rpcUrl: 'x', positionManager: LEGIT_PM as `0x${string}`, staging: LEGIT_STG as `0x${string}`, poolAddress: POOL_ID }, POOL_ID)
    expect(r).toMatchObject({ ok: true, inst: { positionManager: ATTACKER_PM, live: true, source: 'registry' } })
    // The only on-chain cross-check downstream is /api/gateway/meta's `registry quote_asset == pm.quoteAsset()` (409 on mismatch),
    // which an attacker PM trivially echoes. The UI then sends deposit() to inst.positionManager.
  })

  it('MITIGATED: the only sanctioned write path refuses to overwrite an ACTIVE row, and records the refusal', async () => {
    const { client: sb, db } = fakeSupabase({ tables: { gateway_instances: [{ id: 'r1', pool_address: POOL_ID, chain_id: 46630, position_manager: LEGIT_PM, staging: LEGIT_STG, quote_asset: USDG, status: 'active' }] } })
    const w = legitWorld()
    w.pms[ATTACKER_PM] = { staging: LEGIT_STG, owner: ATTACKER, harvestRecipient: ATTACKER, code: codeFor(LEGIT_STG) }
    const r = await registerInstance(sb, { poolAddress: POOL_ID, chainId: 46630, positionManager: ATTACKER_PM, staging: LEGIT_STG, createdBy: ATTACKER }, { client: client(w), trust })
    expect(r.ok).toBe(false)
    expect(db.tables.gateway_instances[0].position_manager).toBe(LEGIT_PM)
    expect(db.tables.gateway_instance_history.at(-1)).toMatchObject({ action: 'refused' })
  })
})

describe('legacy resolver residual', () => {
  it('INFO: /api/gateway/alerts still uses resolveRouteInstance — an unknown ?pool falls back to the env PM (read-only; prod probe returned 200 {alerts:[]} for ?pool=not-a-pool while /meta 404s)', async () => {
    const { resolveRouteInstance } = await import('@/lib/gateway/registry')
    const { client: sb } = fakeSupabase({ tables: { gateway_instances: [] } })
    const r = await resolveRouteInstance(sb, { chainId: 46630, rpcUrl: 'x', positionManager: LEGIT_PM as `0x${string}`, staging: null, poolAddress: POOL_ID }, 'not-a-pool')
    expect(r?.positionManager).toBe(LEGIT_PM)
  })
})
