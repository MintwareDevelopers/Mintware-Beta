import { describe, it, expect, vi, beforeEach } from 'vitest'
import { keccak256 } from 'viem'
import {
  computePoolId,
  verifyInstanceOnChain,
  registerInstance,
  deactivateInstance,
  registryTrustConfigFromEnv,
  type GatewayPoolKey,
  type RegistryTrustConfig,
  type ReadClient,
} from './registry'

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────
const QUOTE = '0x1111111111111111111111111111111111111111' as const // the platform USDG (env)
const PAIRED = '0x2222222222222222222222222222222222222222' as const
const PM = '0x00000000000000000000000000000000000000ab' as const
const STAGING = '0x0000000000000000000000000000000000000dad' as const
const FACTORY = '0x00000000000000000000000000000000000fac70' as const
const EVIL_PM = '0x00000000000000000000000000000000000000e1' as const
const EVIL_STAGING = '0x000000000000000000000000000000000000dead' as const
const ZERO = '0x0000000000000000000000000000000000000000' as const
const SEAT = '0x000000000000000000000000000000000000005e' as const // our gateway seat (owner + fee recipient)
const ADAPTER = '0x0000000000000000000000000000000000000ada' as const

const poolKey: GatewayPoolKey = { currency0: QUOTE, currency1: PAIRED, fee: 3000, tickSpacing: 60, hooks: ZERO }
const POOL_ID = computePoolId(poolKey)

const PM_CODE = '0x6080604052deadbeef' as const
const PM_CODEHASH = keccak256(PM_CODE)

const trustFactory: RegistryTrustConfig = { factory: FACTORY, pmCodeHashes: [], expectedQuoteAsset: QUOTE }
const trustCodehash: RegistryTrustConfig = { factory: null, pmCodeHashes: [PM_CODEHASH], expectedQuoteAsset: QUOTE }

/** A mock chain: the candidate PM, its staging, the factory, and the code at the PM. Every field
 *  overridable so each invariant can be violated in isolation. */
function mockChain(over: {
  pmQuote?: string
  pmPoolKey?: GatewayPoolKey
  pmStaging?: string
  stagingController?: string
  stagingQuote?: string
  factoryInstance?: { staging: string; positionManager: string; active: boolean }
  code?: `0x${string}`
  throwOn?: string
  noGetCode?: boolean
} = {}): ReadClient & { readContract: ReturnType<typeof vi.fn> } {
  const readContract = vi.fn(async ({ address, functionName }: { address: string; functionName: string }) => {
    if (over.throwOn === functionName) throw new Error('rpc down')
    const a = address.toLowerCase()
    if (a === FACTORY) {
      if (functionName === 'instanceForPool') return over.factoryInstance ?? { staging: STAGING, positionManager: PM, active: true }
    }
    if (a === STAGING || a === EVIL_STAGING) {
      if (functionName === 'controller') return over.stagingController ?? PM
      if (functionName === 'quoteAsset') return over.stagingQuote ?? QUOTE
    }
    // round-3 F-5 seat identity reads (only hit when the trust config carries `seat`, i.e. the env builder)
    if (functionName === 'owner' || functionName === 'harvestRecipient') return SEAT
    if (functionName === 'adapter') return ADAPTER
    if (a === ADAPTER.toLowerCase() && functionName === 'vault') return STAGING
    // the candidate PM
    if (functionName === 'quoteAsset') return over.pmQuote ?? QUOTE
    if (functionName === 'poolKey') return over.pmPoolKey ?? poolKey
    if (functionName === 'staging') return over.pmStaging ?? STAGING
    throw new Error(`unexpected read: ${functionName}@${address}`)
  })
  const client: ReadClient & { readContract: ReturnType<typeof vi.fn> } = { readContract }
  if (!over.noGetCode) client.getCode = async () => over.code ?? PM_CODE
  return client
}

const baseVerify = (client: ReadClient, trust: RegistryTrustConfig = trustFactory) =>
  verifyInstanceOnChain({ client, positionManager: PM, staging: STAGING, expectedPoolAddress: POOL_ID, trust })

// ── computePoolId ──────────────────────────────────────────────────────────────────────────────
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

// ── env parsing ────────────────────────────────────────────────────────────────────────────────
describe('registryTrustConfigFromEnv', () => {
  it('parses factory, code-hash allowlist and USDG; drops malformed entries', () => {
    const c = registryTrustConfigFromEnv({
      LP_GATEWAY_FACTORY: FACTORY.toUpperCase().replace('0X', '0x'),
      LP_GATEWAY_PM_CODEHASHES: ` ${PM_CODEHASH.toUpperCase().replace('0X', '0x')} , junk, 0x12`,
      LP_GATEWAY_USDG: QUOTE,
    })
    expect(c.factory).toBe(FACTORY)
    expect(c.pmCodeHashes).toEqual([PM_CODEHASH])
    expect(c.expectedQuoteAsset).toBe(QUOTE)
  })
  it('is empty (⇒ fail closed) when nothing is set', () => {
    // round-3 F-5: `seat` is always present; a null owner makes verify fail closed (owner_env_unset)
    expect(registryTrustConfigFromEnv({})).toEqual({
      factory: null, pmCodeHashes: [], expectedQuoteAsset: null,
      seat: { expectedOwner: null, allowedHarvestRecipients: [] },
    })
  })
})

// ── verifyInstanceOnChain ──────────────────────────────────────────────────────────────────────
describe('verifyInstanceOnChain — trust root (O-3 / A-7)', () => {
  it('FACTORY path: accepts when instanceForPool(poolId) == {staging, pm, active}', async () => {
    const v = await baseVerify(mockChain())
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.poolId).toBe(POOL_ID)
      expect(v.verification).toBe('factory')
      expect(v.quoteAsset.toLowerCase()).toBe(QUOTE)
    }
  })

  it('FACTORY path: accepts a tuple-shaped instanceForPool return', async () => {
    const v = await baseVerify(mockChain({ factoryInstance: [STAGING, PM, true] as never }))
    expect(v.ok).toBe(true)
  })

  it('LOOKALIKE PM (R-2): a contract that echoes quoteAsset()/poolKey()/staging() but is NOT the factory instance is rejected', async () => {
    // the factory says the pool's real PM is `PM`; the candidate is EVIL_PM echoing everything
    const client = mockChain({ stagingController: EVIL_PM })
    const v = await verifyInstanceOnChain({ client, positionManager: EVIL_PM, staging: STAGING, expectedPoolAddress: POOL_ID, trust: trustFactory })
    expect(v).toEqual({ ok: false, error: 'factory_pm_mismatch' })
  })

  it('FACTORY path: rejects a staging that differs from the factory record', async () => {
    const v = await baseVerify(mockChain({ factoryInstance: { staging: EVIL_STAGING, positionManager: PM, active: true } }))
    expect(v).toEqual({ ok: false, error: 'factory_staging_mismatch' })
  })

  it('FACTORY path: rejects a factory-deactivated instance', async () => {
    const v = await baseVerify(mockChain({ factoryInstance: { staging: STAGING, positionManager: PM, active: false } }))
    expect(v).toEqual({ ok: false, error: 'factory_inactive' })
  })

  it('FACTORY path: fails closed when the factory read errors', async () => {
    const v = await baseVerify(mockChain({ throwOn: 'instanceForPool' }))
    expect(v).toEqual({ ok: false, error: 'factory_read_failed' })
  })

  it('CODEHASH path (direct deploy): accepts when keccak256(code) is allowlisted', async () => {
    const v = await baseVerify(mockChain(), trustCodehash)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.verification).toBe('codehash')
      expect(v.meta).toEqual({ codeHash: PM_CODEHASH })
    }
  })

  it('CODEHASH path: rejects an un-allowlisted bytecode (the lookalike)', async () => {
    const v = await baseVerify(mockChain({ code: '0x6080deadbeef00' }), trustCodehash)
    expect(v).toEqual({ ok: false, error: 'codehash_not_allowlisted' })
  })

  it('CODEHASH path: rejects an EOA / empty code', async () => {
    expect(await baseVerify(mockChain({ code: '0x' }), trustCodehash)).toEqual({ ok: false, error: 'no_code_at_pm' })
  })

  it('CODEHASH path: fails closed when the client cannot read code', async () => {
    expect(await baseVerify(mockChain({ noGetCode: true }), trustCodehash)).toEqual({ ok: false, error: 'codehash_unavailable' })
  })

  it('FAILS CLOSED when neither factory nor code-hash allowlist is configured (no silent trust)', async () => {
    const client = mockChain()
    const v = await baseVerify(client, { factory: null, pmCodeHashes: [], expectedQuoteAsset: QUOTE })
    expect(v).toEqual({ ok: false, error: 'trust_root_unconfigured' })
    expect(client.readContract).not.toHaveBeenCalled()
  })

  it('FAILS CLOSED when LP_GATEWAY_USDG is unset — the quote is never taken from the request', async () => {
    const v = await baseVerify(mockChain(), { ...trustFactory, expectedQuoteAsset: null })
    expect(v).toEqual({ ok: false, error: 'quote_env_unset' })
  })

  it('rejects a PM quoting in a "fake USDG" even when internally consistent (quote compared to ENV)', async () => {
    const FAKE = '0xfa4efa4efa4efa4efa4efa4efa4efa4efa4efa4e' as const
    const fakeKey = { ...poolKey, currency0: FAKE }
    const v = await verifyInstanceOnChain({
      client: mockChain({ pmQuote: FAKE, pmPoolKey: fakeKey, stagingQuote: FAKE }),
      positionManager: PM, staging: STAGING, expectedPoolAddress: computePoolId(fakeKey), trust: trustFactory,
    })
    expect(v).toEqual({ ok: false, error: 'quote_asset_mismatch' })
  })

  it('rejects a HOOKED pool key', async () => {
    const hooked = { ...poolKey, hooks: '0x00000000000000000000000000000000000000c0' as const }
    const v = await verifyInstanceOnChain({
      client: mockChain({ pmPoolKey: hooked }), positionManager: PM, staging: STAGING,
      expectedPoolAddress: computePoolId(hooked), trust: trustFactory,
    })
    expect(v).toEqual({ ok: false, error: 'hooked_pool_rejected' })
  })

  it('rejects when the on-chain poolKey does not hash to the approved pool', async () => {
    const v = await verifyInstanceOnChain({ client: mockChain(), positionManager: PM, staging: STAGING, expectedPoolAddress: '0x' + 'de'.repeat(32), trust: trustFactory })
    expect(v).toEqual({ ok: false, error: 'pool_mismatch' })
  })

  it('rejects when the quote asset is not a leg of the pool', async () => {
    const otherKey: GatewayPoolKey = { ...poolKey, currency0: PAIRED, currency1: '0x3333333333333333333333333333333333333333' }
    const v = await verifyInstanceOnChain({
      client: mockChain({ pmPoolKey: otherKey }), positionManager: PM, staging: STAGING,
      expectedPoolAddress: computePoolId(otherKey), trust: trustFactory,
    })
    expect(v).toEqual({ ok: false, error: 'quote_not_in_pool' })
  })

  it('rejects when pm.staging() != the supplied staging', async () => {
    expect(await baseVerify(mockChain({ pmStaging: EVIL_STAGING }))).toEqual({ ok: false, error: 'staging_mismatch' })
  })

  it('rejects when staging.controller() != the PM', async () => {
    expect(await baseVerify(mockChain({ stagingController: EVIL_PM }))).toEqual({ ok: false, error: 'staging_controller_mismatch' })
  })

  it('rejects when staging.quoteAsset() != LP_GATEWAY_USDG', async () => {
    expect(await baseVerify(mockChain({ stagingQuote: PAIRED }))).toEqual({ ok: false, error: 'staging_quote_mismatch' })
  })

  it('fails closed on an RPC read error (PM reads)', async () => {
    expect(await baseVerify(mockChain({ throwOn: 'poolKey' }))).toEqual({ ok: false, error: 'onchain_read_failed' })
  })

  it('fails closed on an RPC read error (staging reads)', async () => {
    expect(await baseVerify(mockChain({ throwOn: 'controller' }))).toEqual({ ok: false, error: 'staging_read_failed' })
  })

  it('is case-insensitive on every address input', async () => {
    const v = await verifyInstanceOnChain({
      client: mockChain(), positionManager: PM.toUpperCase().replace('0X', '0x') as `0x${string}`,
      staging: STAGING.toUpperCase().replace('0X', '0x') as `0x${string}`,
      expectedPoolAddress: POOL_ID.toUpperCase(), trust: trustFactory,
    })
    expect(v.ok).toBe(true)
  })
})

// ── registerInstance / deactivateInstance ──────────────────────────────────────────────────────
type Row = Record<string, unknown>
/** Minimal in-memory supabase for gateway_instances + gateway_instance_history. */
function fakeDb(seed: Row[] = []) {
  const tables: Record<string, Row[]> = { gateway_instances: seed.map((r) => ({ ...r })), gateway_instance_history: [] }
  const calls: { table: string; op: string; payload?: unknown }[] = []
  let seq = 0
  function from(table: string) {
    const rows = (tables[table] ??= [])
    const filters: [string, unknown][] = []
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
    let payload: Row | undefined
    const hit = () => rows.filter((r) => filters.every(([c, v]) => String(r[c]).toLowerCase() === String(v).toLowerCase()))
    const exec = async () => {
      calls.push({ table, op, payload })
      if (op === 'select') return { data: hit(), error: null }
      if (op === 'insert') { rows.push({ id: `row-${++seq}`, ...payload }); return { data: null, error: null } }
      // Mimics real Supabase/PostgREST: an update with a WHERE clause that matches zero rows returns
      // `data: []`, not an error — the production code's `.select('id')` after `.update()` relies on
      // exactly this shape to detect a lost-race concurrent-write conflict (round-4 audit fix).
      if (op === 'update') { const matched = hit(); for (const r of matched) Object.assign(r, payload); return { data: matched, error: null } }
      throw new Error('upsert is forbidden — the registry must never upsert (O-3 d)')
    }
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return b },
      insert: (p: Row) => { op = 'insert'; payload = p; return b },
      update: (p: Row) => { op = 'update'; payload = p; return b },
      upsert: (p: Row) => { op = 'upsert'; payload = p; return b },
      maybeSingle: async () => { const r = await exec(); return { data: (r.data as Row[])?.[0] ?? null, error: null } },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    }
    return b
  }
  return { client: { from } as never, tables, calls }
}

const base = { poolAddress: POOL_ID, chainId: 4663, positionManager: PM, staging: STAGING, pairedAsset: PAIRED, createdBy: '0xc0ffee' }
const liveRow = (over: Row = {}): Row => ({ id: 'live', pool_address: POOL_ID, chain_id: 4663, position_manager: PM, staging: STAGING, quote_asset: QUOTE, status: 'active', ...over })

describe('registerInstance — verified, read-before-write, logged (O-3 d/e)', () => {
  beforeEach(() => {
    delete process.env.LP_GATEWAY_FACTORY
    delete process.env.LP_GATEWAY_OWNER
    delete process.env.GATEWAY_ORACLE_PRIVY_ADDRESS
    delete process.env.LP_GATEWAY_HARVEST_RECIPIENTS
    delete process.env.LP_GATEWAY_PM_CODEHASHES
    delete process.env.LP_GATEWAY_USDG
  })

  it('inserts a verified row (never upserts) and writes a history entry with the evidence', async () => {
    const { client, tables, calls } = fakeDb()
    const res = await registerInstance(client, base, { client: mockChain(), trust: trustFactory })
    expect(res).toEqual({ ok: true, verification: 'factory' })
    expect(calls.map((c) => c.op)).not.toContain('upsert')
    const row = tables.gateway_instances[0]
    expect(row).toMatchObject({ position_manager: PM, staging: STAGING, quote_asset: QUOTE, status: 'active', verification: 'factory', verified_by: '0xc0ffee' })
    expect(tables.gateway_instance_history).toHaveLength(1)
    expect(tables.gateway_instance_history[0]).toMatchObject({ action: 'register', position_manager: PM, verification: 'factory', actor: '0xc0ffee' })
  })

  it('writes the ENV/on-chain quote asset, ignoring a curator-supplied quoteAsset', async () => {
    const { client, tables } = fakeDb()
    await registerInstance(client, { ...base, quoteAsset: '0xfa4efa4efa4efa4efa4efa4efa4efa4efa4efa4e' }, { client: mockChain(), trust: trustFactory })
    expect(tables.gateway_instances[0].quote_asset).toBe(QUOTE)
  })

  it('does NOT write when verification fails (substitution blocked) and logs the refusal', async () => {
    const { client, tables } = fakeDb()
    const res = await registerInstance(client, base, { client: mockChain({ pmQuote: '0x9999999999999999999999999999999999999999' }), trust: trustFactory })
    expect(res).toEqual({ ok: false, error: 'onchain_verify_failed:quote_asset_mismatch' })
    expect(tables.gateway_instances).toHaveLength(0)
    expect(tables.gateway_instance_history[0]).toMatchObject({ action: 'refused', reason: 'onchain_verify_failed:quote_asset_mismatch' })
  })

  it('fails closed with NO env trust root configured (reads env when no explicit trust is passed)', async () => {
    const { client, tables } = fakeDb()
    const res = await registerInstance(client, base, { client: mockChain() })
    expect(res).toEqual({ ok: false, error: 'onchain_verify_failed:trust_root_unconfigured' })
    expect(tables.gateway_instances).toHaveLength(0)
  })

  it('resolves the trust root from env (LP_GATEWAY_PM_CODEHASHES + LP_GATEWAY_USDG + LP_GATEWAY_OWNER) when none is passed', async () => {
    process.env.LP_GATEWAY_PM_CODEHASHES = PM_CODEHASH
    process.env.LP_GATEWAY_USDG = QUOTE
    process.env.LP_GATEWAY_OWNER = SEAT // round-3 F-5: the env-built trust root also pins the seat
    const { client, tables } = fakeDb()
    const res = await registerInstance(client, base, { client: mockChain() })
    expect(res).toEqual({ ok: true, verification: 'codehash' })
    expect(tables.gateway_instances[0].verification).toBe('codehash')
  })

  it('HOT-SWAP BLOCKED (R-2 / HO-3): refuses to write over an ACTIVE row with a different PM, logs it', async () => {
    const { client, tables } = fakeDb([liveRow()])
    // a *verified* candidate (the factory has been repointed / a second audited build) — still refused
    const chain = mockChain({ factoryInstance: { staging: EVIL_STAGING, positionManager: EVIL_PM, active: true }, stagingController: EVIL_PM, pmStaging: EVIL_STAGING })
    const res = await registerInstance(client, { ...base, positionManager: EVIL_PM, staging: EVIL_STAGING }, { client: chain, trust: trustFactory })
    expect(res).toEqual({ ok: false, error: 'active_instance_exists' })
    expect(tables.gateway_instances[0].position_manager).toBe(PM) // untouched
    expect(tables.gateway_instance_history.at(-1)).toMatchObject({ action: 'refused', reason: 'active_instance_exists', position_manager: EVIL_PM, meta: { existingPositionManager: PM } })
  })

  it('identical re-register of the active row is an idempotent no-op (no write)', async () => {
    const { client, tables, calls } = fakeDb([liveRow()])
    const res = await registerInstance(client, base, { client: mockChain(), trust: trustFactory })
    expect(res).toEqual({ ok: true, unchanged: true, verification: 'factory' })
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0)
    expect(tables.gateway_instance_history).toHaveLength(0)
  })

  // V1 pass-2 fix (independent Codex audit, 2026-09-09, finding D): a DIFFERENT incoming PM than the
  // retired row's now INSERTS a new row instead of updating the retired one in place — updating in
  // place silently destroyed the retired PM's own identity, breaking V1-01's fix for its depositors
  // (nothing left to find via listAllInstances/resolveInstanceStrict(includeInactive) once overwritten).
  it('a DIFFERENT PM than the retired row inserts a NEW row, preserving the retired one', async () => {
    const { client, tables, calls } = fakeDb([liveRow({ status: 'inactive', position_manager: EVIL_PM })])
    const res = await registerInstance(client, base, { client: mockChain(), trust: trustFactory })
    expect(res).toEqual({ ok: true, verification: 'factory' })
    expect(calls.find((c) => c.op === 'insert')).toBeTruthy()
    expect(calls.find((c) => c.op === 'update')).toBeFalsy() // nothing overwritten in place
    expect(tables.gateway_instances).toHaveLength(2)
    expect(tables.gateway_instances.find((r) => r.position_manager === EVIL_PM)).toMatchObject({ status: 'inactive' })
    expect(tables.gateway_instances.find((r) => r.position_manager === PM)).toMatchObject({ status: 'active', deactivated_at: null })
    expect(tables.gateway_instance_history.at(-1)).toMatchObject({ action: 'register', prev_position_manager: EVIL_PM })
  })
  // The exact SAME PM + staging as an existing retired row is still a genuine in-place reactivation —
  // there's no identity to lose, it's literally the same instance coming back.
  it('the EXACT SAME PM + staging as a retired row reactivates it in place (no second row)', async () => {
    const { client, tables, calls } = fakeDb([liveRow({ status: 'inactive' })]) // liveRow() defaults to PM/STAGING == `base`
    const res = await registerInstance(client, base, { client: mockChain(), trust: trustFactory })
    expect(res).toEqual({ ok: true, verification: 'factory' })
    const instanceCalls = calls.filter((c) => c.table === 'gateway_instances')
    expect(instanceCalls.find((c) => c.op === 'update')).toBeTruthy()
    expect(instanceCalls.find((c) => c.op === 'insert')).toBeFalsy() // the history-table insert is a separate table, expected either way
    expect(tables.gateway_instances).toHaveLength(1)
    expect(tables.gateway_instances[0]).toMatchObject({ status: 'active', position_manager: PM, deactivated_at: null })
    expect(tables.gateway_instance_history.at(-1)).toMatchObject({ action: 'register', prev_position_manager: PM })
  })

  // V1 pass-2 fix (independent Codex audit, 2026-09-09): the read-before-write step now fetches ALL
  // rows for this pool (no `.maybeSingle()`) so it can tell an active row apart from any number of
  // retired ones — this race-detection mechanism only still applies to the GUARDED-UPDATE path (an
  // EXACT reactivation, same PM+staging as the retired row); a DIFFERENT PM now inserts a brand new
  // row instead (see the tests above), where the database's own partial unique index
  // (gateway_instances_active_pool_uidx, migration 20260909000002) is the concurrency safety net.
  it('round-4 audit fix (Low): a concurrent race that flips an EXACT-match retired row to active between our read and write is detected as a conflict, not silently reported as success with stale metadata', async () => {
    const { client: rawBaseClient, tables } = fakeDb([liveRow({ status: 'inactive' })]) // same PM/staging as `base` — exact-match reactivation
    const baseClient = rawBaseClient as unknown as { from: (t: string) => { then: (res: (v: unknown) => unknown) => unknown } }
    let fromCalls = 0
    const client = {
      from: (table: string) => {
        const b = baseClient.from(table)
        if (table === 'gateway_instances' && ++fromCalls === 1) {
          // This IS the read-before-write call (a plain SELECT, awaited via `then` — no `.maybeSingle()`
          // any more). As a side effect, simulate another writer's concurrent activation landing in the
          // gap between our read and our own write below — exactly the race window PostgREST's silent
          // zero-row update used to hide.
          const origThen = b.then
          b.then = (res: (v: unknown) => unknown) => {
            return origThen((r) => {
              // Replace (not mutate in place) — a real read returns a SNAPSHOT, so registerInstance's
              // `ex`/`activeRow` must keep seeing the stale 'inactive' value it already read, exactly
              // like a real race: the row changes in the DB, but the in-flight caller's local copy
              // doesn't know yet.
              tables.gateway_instances[0] = { ...tables.gateway_instances[0], status: 'active' }
              return res(r)
            })
          }
        }
        return b
      },
    }
    const res = await registerInstance(client as never, base, { client: mockChain(), trust: trustFactory })
    expect(res).toEqual({ ok: false, error: 'concurrent_activation_conflict' })
    // The row is left exactly as the OTHER writer left it — our metadata was never applied.
    expect(tables.gateway_instances[0]).toMatchObject({ status: 'active', position_manager: PM })
    expect(tables.gateway_instance_history.at(-1)).toMatchObject({ action: 'refused', reason: 'concurrent_activation_conflict' })
  })

  it('operator attestation path: explicit + logged, never silent; still needs LP_GATEWAY_USDG', async () => {
    const { client, tables } = fakeDb()
    expect(await registerInstance(client, base, { operatorAttestation: { by: 'operator:nic', reason: 'backfill' } })).toEqual({ ok: false, error: 'quote_env_unset' })
    process.env.LP_GATEWAY_USDG = QUOTE
    expect(await registerInstance(client, base, { operatorAttestation: { by: '', reason: '' } })).toEqual({ ok: false, error: 'attestation_incomplete' })
    const res = await registerInstance(client, base, { operatorAttestation: { by: 'operator:nic', reason: 'direct-deploy rig 2026-09-07b' } })
    expect(res).toEqual({ ok: true, verification: 'operator_attested' })
    expect(tables.gateway_instances[0]).toMatchObject({ verification: 'operator_attested', verification_meta: { attestedBy: 'operator:nic', reason: 'direct-deploy rig 2026-09-07b' } })
  })

  it('rejects malformed addresses before any chain read', async () => {
    const { client } = fakeDb()
    const chain = mockChain()
    const res = await registerInstance(client, { ...base, positionManager: 'not-an-address' }, { client: chain, trust: trustFactory })
    expect(res).toEqual({ ok: false, error: 'bad_address' })
    expect(chain.readContract).not.toHaveBeenCalled()
  })
})

describe('deactivateInstance — the explicit, logged step before any replacement', () => {
  it('flips an active row to inactive with who/why and logs it', async () => {
    const { client, tables } = fakeDb([liveRow()])
    const res = await deactivateInstance(client, { poolAddress: POOL_ID, chainId: 4663, by: '0xc0ffee', reason: 'migrating to factory rig' })
    expect(res).toEqual({ ok: true })
    expect(tables.gateway_instances[0]).toMatchObject({ status: 'inactive', deactivated_by: '0xc0ffee', deactivate_reason: 'migrating to factory rig' })
    expect(tables.gateway_instance_history[0]).toMatchObject({ action: 'deactivate', prev_position_manager: PM, actor: '0xc0ffee' })
  })
  it('requires a reason; refuses unknown / already-inactive rows', async () => {
    const { client } = fakeDb([liveRow({ status: 'inactive' })])
    expect(await deactivateInstance(client, { poolAddress: POOL_ID, chainId: 4663, by: 'x', reason: ' ' })).toEqual({ ok: false, error: 'reason_required' })
    expect(await deactivateInstance(client, { poolAddress: POOL_ID, chainId: 4663, by: 'x', reason: 'r' })).toEqual({ ok: false, error: 'not_active' })
    expect(await deactivateInstance(client, { poolAddress: '0x' + 'ff'.repeat(32), chainId: 4663, by: 'x', reason: 'r' })).toEqual({ ok: false, error: 'not_found' })
  })
})
