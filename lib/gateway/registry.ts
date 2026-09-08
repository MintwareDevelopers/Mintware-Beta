// Multi-pool registry — the app + crons discover every live gateway here instead of a single env
// instance. Pure DB access (takes a service-role client). One isolated gateway per pool.
//
// THE DEPOSIT-ROUTING TRUST ROOT. The registry row is what the app advertises as the deposit target and
// what the deposit route verifies user txs against — so a hostile row = theft of every NEW deposit.
//
// H-01 (2026-09-06) verified only that the candidate *said* it fronted the pool (`quoteAsset()` /
// `poolKey()` echoes). Audit closeout 2026-09-08 (O-3 / R-2 / HO-7 / A-7) hardens `registerInstance`:
//   (a) TRUST ROOT — the candidate must be tied to audited bytecode: either the factory says so
//       (`LP_GATEWAY_FACTORY` → `instanceForPool(poolId) == {staging, positionManager, active}`) or its
//       runtime code hash is on the operator allowlist (`LP_GATEWAY_PM_CODEHASHES`). Neither configured
//       ⇒ FAIL CLOSED (`trust_root_unconfigured`). The current testnet rig was deployed directly (no
//       factory), so the code-hash path is the explicit operator attestation for it.
//   (b) STAGING — `pm.staging()` must equal the supplied staging; `staging.controller()` must be the PM;
//       `staging.quoteAsset()` and `pm.quoteAsset()` must equal the ENV quote (`LP_GATEWAY_USDG`),
//       never the curator's input.
//   (c) hooked pool keys are rejected (the contract constructor does; the off-chain root must too).
//   (d) READ-BEFORE-WRITE — never upsert over an ACTIVE row. Replacing a live instance requires an
//       explicit, logged `deactivateInstance` first. Every write lands in `gateway_instance_history`.
//   (e) the verification path is mandatory: a caller that cannot verify on-chain must pass an explicit
//       `operatorAttestation` (who + why), which is recorded — never silent trust.

import { keccak256, encodeAbiParameters, zeroAddress, isAddress } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import type { GatewayConfig } from '@/lib/gateway/chain'

type SupabaseClient = ReturnType<typeof getServiceClient>

// Structural read-only client: satisfied by a viem PublicClient and by test mocks alike (viem's
// readContract is a deep generic overload; we pin ABIs at the call sites and accept it loosely —
// same pattern as lib/gateway/positionReader.ts).
export type ReadClient = {
  readContract: (args: any) => Promise<unknown> // eslint-disable-line @typescript-eslint/no-explicit-any
  getCode?: (args: { address: `0x${string}` }) => Promise<`0x${string}` | undefined>
}

// Minimal ABIs for the trust-root reads (kept local: lib/web3/artifacts/lpGateway.ts is owned by the
// deposit/withdraw surface and only carries what those routes need).
export const LP_PM_STAGING_ABI = [
  { type: 'function', stateMutability: 'view', name: 'staging', inputs: [], outputs: [{ type: 'address' }] },
] as const
export const LP_STAGING_TRUST_ABI = [
  { type: 'function', stateMutability: 'view', name: 'controller', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', stateMutability: 'view', name: 'quoteAsset', inputs: [], outputs: [{ type: 'address' }] },
] as const
export const LP_FACTORY_ABI = [
  {
    type: 'function', stateMutability: 'view', name: 'instanceForPool',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [{ name: 'staging', type: 'address' }, { name: 'positionManager', type: 'address' }, { name: 'active', type: 'bool' }],
  },
] as const

export type GatewayPoolKey = {
  currency0: `0x${string}`
  currency1: `0x${string}`
  fee: number
  tickSpacing: number
  hooks: `0x${string}`
}

/** Uniswap v4 PoolId = keccak256(abi.encode(PoolKey)) — the canonical on-chain identity of a v4 pool,
 *  matching Solidity `PoolIdLibrary.toId`. GeckoTerminal (and thus `gateway_instances.pool_address`)
 *  keys v4 pools by this id. */
export function computePoolId(k: GatewayPoolKey): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'currency0', type: 'address' },
            { name: 'currency1', type: 'address' },
            { name: 'fee', type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'hooks', type: 'address' },
          ],
        },
      ],
      [k],
    ),
  )
}

// ── trust-root configuration ──────────────────────────────────────────────────────────────────

export type RegistryTrustConfig = {
  /** `LP_GATEWAY_FACTORY` — the curated on-chain factory; when set it is THE trust root. */
  factory: `0x${string}` | null
  /** `LP_GATEWAY_PM_CODEHASHES` — allowlisted keccak256(runtime code) of audited PM builds (direct deploys). */
  pmCodeHashes: string[]
  /** `LP_GATEWAY_USDG` — the platform quote asset. The ONLY quote a registry row may carry. */
  expectedQuoteAsset: `0x${string}` | null
  /**
   * Round-3 audit F-5 — IDENTITY checks beyond bytecode. A code-hash allowlist is per-BUILD, not per-instance: an
   * attacker can deploy the audited bytecode with their own constructor args (owner, staging, pool) and the hash
   * matches by definition. The staging one-controller invariant happened to stop the PoC, but nothing asserted
   * WHO owns the PM or where its fees go. `undefined` = caller opted out (hand-built test configs);
   * `registryTrustConfigFromEnv` ALWAYS populates it, with `expectedOwner: null` when the env is unset →
   * `owner_env_unset` (fail closed) at verify time.
   */
  seat?: {
    /** `LP_GATEWAY_OWNER` ?? `GATEWAY_ORACLE_PRIVY_ADDRESS` — the only address allowed to own a registered PM. */
    expectedOwner: `0x${string}` | null
    /** `LP_GATEWAY_HARVEST_RECIPIENTS` (comma) ∪ {expectedOwner} — where a registered PM may route fees. */
    allowedHarvestRecipients: string[]
  }
}

export function registryTrustConfigFromEnv(env: Record<string, string | undefined> = process.env): RegistryTrustConfig {
  const f = env.LP_GATEWAY_FACTORY
  const q = env.LP_GATEWAY_USDG
  const o = env.LP_GATEWAY_OWNER ?? env.GATEWAY_ORACLE_PRIVY_ADDRESS
  const expectedOwner = o && isAddress(o, { strict: false }) ? (o.toLowerCase() as `0x${string}`) : null
  const recipients = (env.LP_GATEWAY_HARVEST_RECIPIENTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => isAddress(s, { strict: false }))
  if (expectedOwner && !recipients.includes(expectedOwner)) recipients.push(expectedOwner)
  // strict:false — every value is lower-cased for comparison, so checksum casing is irrelevant here
  return {
    factory: f && isAddress(f, { strict: false }) ? (f.toLowerCase() as `0x${string}`) : null,
    pmCodeHashes: (env.LP_GATEWAY_PM_CODEHASHES ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^0x[0-9a-f]{64}$/.test(s)),
    expectedQuoteAsset: q && isAddress(q, { strict: false }) ? (q.toLowerCase() as `0x${string}`) : null,
    seat: { expectedOwner, allowedHarvestRecipients: recipients },
  }
}

/** Round-3 F-5 identity reads: PM owner + fee recipient, staging → adapter → vault binding. */
export const LP_PM_SEAT_ABI = [
  { type: 'function', stateMutability: 'view', name: 'owner', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', stateMutability: 'view', name: 'harvestRecipient', inputs: [], outputs: [{ type: 'address' }] },
] as const
export const LP_STAGING_ADAPTER_ABI = [
  { type: 'function', stateMutability: 'view', name: 'adapter', inputs: [], outputs: [{ type: 'address' }] },
] as const
export const LP_ADAPTER_VAULT_ABI = [
  { type: 'function', stateMutability: 'view', name: 'vault', inputs: [], outputs: [{ type: 'address' }] },
] as const

export type VerificationKind = 'factory' | 'codehash' | 'operator_attested'

export type VerifyResult =
  | { ok: true; poolId: `0x${string}`; quoteAsset: `0x${string}`; verification: VerificationKind; meta: Record<string, unknown> }
  | { ok: false; error: string }

/** The trust anchor. Reads the candidate positionManager + its staging on-chain and asserts every
 *  invariant above. Rejects (never throws) on any mismatch or read failure — fail-closed. */
export async function verifyInstanceOnChain(opts: {
  client: ReadClient
  positionManager: `0x${string}`
  staging: `0x${string}`
  expectedPoolAddress: string // the approved pool / poolId the registry keys by (lowercased or not)
  trust: RegistryTrustConfig
}): Promise<VerifyResult> {
  const { client, trust } = opts
  const pm = opts.positionManager.toLowerCase() as `0x${string}`
  const stagingWant = opts.staging.toLowerCase()
  const wantPool = opts.expectedPoolAddress.toLowerCase()

  // (a-pre) trust root must be configured BEFORE we spend RPC calls — fail closed, never silent.
  if (!trust.factory && trust.pmCodeHashes.length === 0) return { ok: false, error: 'trust_root_unconfigured' }
  // (b-pre) the platform quote must come from env, never from the request.
  if (!trust.expectedQuoteAsset) return { ok: false, error: 'quote_env_unset' }
  const wantQuote = trust.expectedQuoteAsset

  let quoteAsset: string
  let poolKey: GatewayPoolKey
  let pmStaging: string
  let stagingController: string
  let stagingQuote: string
  try {
    quoteAsset = String(await client.readContract({ address: pm, abi: LP_GATEWAY_ABI, functionName: 'quoteAsset' })).toLowerCase()
    const pk = (await client.readContract({ address: pm, abi: LP_GATEWAY_ABI, functionName: 'poolKey' })) as GatewayPoolKey
    poolKey = {
      currency0: pk.currency0,
      currency1: pk.currency1,
      fee: Number(pk.fee),
      tickSpacing: Number(pk.tickSpacing),
      hooks: pk.hooks,
    }
    pmStaging = String(await client.readContract({ address: pm, abi: LP_PM_STAGING_ABI, functionName: 'staging' })).toLowerCase()
  } catch {
    return { ok: false, error: 'onchain_read_failed' }
  }

  // (c) hooked pools are out of scope for V1 (no on-chain TWAP; hook can re-enter / re-price)
  if (poolKey.hooks.toLowerCase() !== zeroAddress) return { ok: false, error: 'hooked_pool_rejected' }

  // (b) quote asset vs ENV, and internal consistency with the pool legs
  if (quoteAsset !== wantQuote) return { ok: false, error: 'quote_asset_mismatch' }
  const c0 = poolKey.currency0.toLowerCase()
  const c1 = poolKey.currency1.toLowerCase()
  if (quoteAsset !== c0 && quoteAsset !== c1) return { ok: false, error: 'quote_not_in_pool' }

  const poolId = computePoolId(poolKey)
  if (poolId.toLowerCase() !== wantPool) return { ok: false, error: 'pool_mismatch' }

  // (b) staging wiring: PM → staging → PM, and staging quotes in the platform asset
  if (pmStaging !== stagingWant) return { ok: false, error: 'staging_mismatch' }
  try {
    stagingController = String(await client.readContract({ address: stagingWant, abi: LP_STAGING_TRUST_ABI, functionName: 'controller' })).toLowerCase()
    stagingQuote = String(await client.readContract({ address: stagingWant, abi: LP_STAGING_TRUST_ABI, functionName: 'quoteAsset' })).toLowerCase()
  } catch {
    return { ok: false, error: 'staging_read_failed' }
  }
  if (stagingController !== pm) return { ok: false, error: 'staging_controller_mismatch' }
  if (stagingQuote !== wantQuote) return { ok: false, error: 'staging_quote_mismatch' }

  // (d) Round-3 F-5 — IDENTITY, not just bytecode: who owns this PM, where do its fees go, and is the staging's
  //     adapter really bound to this staging. A bytecode-identical PM with attacker constructor args passes the
  //     code-hash root by definition; these reads are what actually pin the instance to OUR seat.
  if (trust.seat !== undefined) {
    const seat = trust.seat
    if (!seat.expectedOwner) return { ok: false, error: 'owner_env_unset' }
    let pmOwner: string
    let pmRecipient: string
    let stagingAdapter: string
    let adapterVault: string
    try {
      pmOwner = String(await client.readContract({ address: pm, abi: LP_PM_SEAT_ABI, functionName: 'owner' })).toLowerCase()
      pmRecipient = String(await client.readContract({ address: pm, abi: LP_PM_SEAT_ABI, functionName: 'harvestRecipient' })).toLowerCase()
      stagingAdapter = String(await client.readContract({ address: stagingWant, abi: LP_STAGING_ADAPTER_ABI, functionName: 'adapter' })).toLowerCase()
    } catch {
      return { ok: false, error: 'seat_read_failed' }
    }
    if (pmOwner !== seat.expectedOwner) return { ok: false, error: 'owner_mismatch' }
    if (!seat.allowedHarvestRecipients.includes(pmRecipient)) return { ok: false, error: 'recipient_not_allowlisted' }
    if (stagingAdapter === zeroAddress) return { ok: false, error: 'adapter_unbound' }
    try {
      adapterVault = String(await client.readContract({ address: stagingAdapter as `0x${string}`, abi: LP_ADAPTER_VAULT_ABI, functionName: 'vault' })).toLowerCase()
    } catch {
      return { ok: false, error: 'seat_read_failed' }
    }
    if (adapterVault !== stagingWant) return { ok: false, error: 'adapter_vault_mismatch' }
  }

  // (a) TRUST ROOT — factory first (the curated, onlyOwner deployer of audited bytecode); else the
  //     operator's code-hash allowlist for directly-deployed rigs.
  if (trust.factory) {
    let inst: { staging: string; positionManager: string; active: boolean }
    try {
      const r = (await client.readContract({ address: trust.factory, abi: LP_FACTORY_ABI, functionName: 'instanceForPool', args: [poolId] })) as
        | readonly [string, string, boolean]
        | { staging: string; positionManager: string; active: boolean }
      inst = Array.isArray(r)
        ? { staging: String(r[0]), positionManager: String(r[1]), active: Boolean(r[2]) }
        : { staging: String((r as { staging: string }).staging), positionManager: String((r as { positionManager: string }).positionManager), active: Boolean((r as { active: boolean }).active) }
    } catch {
      return { ok: false, error: 'factory_read_failed' }
    }
    if (inst.positionManager.toLowerCase() !== pm) return { ok: false, error: 'factory_pm_mismatch' }
    if (inst.staging.toLowerCase() !== stagingWant) return { ok: false, error: 'factory_staging_mismatch' }
    if (!inst.active) return { ok: false, error: 'factory_inactive' }
    return { ok: true, poolId, quoteAsset: quoteAsset as `0x${string}`, verification: 'factory', meta: { factory: trust.factory } }
  }

  if (!client.getCode) return { ok: false, error: 'codehash_unavailable' }
  let code: `0x${string}` | undefined
  try {
    code = await client.getCode({ address: pm })
  } catch {
    return { ok: false, error: 'codehash_unavailable' }
  }
  if (!code || code === '0x') return { ok: false, error: 'no_code_at_pm' }
  const codeHash = keccak256(code).toLowerCase()
  if (!trust.pmCodeHashes.includes(codeHash)) return { ok: false, error: 'codehash_not_allowlisted' }
  return { ok: true, poolId, quoteAsset: quoteAsset as `0x${string}`, verification: 'codehash', meta: { codeHash } }
}

// ── read side ─────────────────────────────────────────────────────────────────────────────────

export type RouteInstance = { positionManager: `0x${string}`; poolAddress: string; chainId: number }

/** Resolve the gateway a route should act on: registry match by pool, else the single-env fallback. */
export async function resolveRouteInstance(
  supabase: SupabaseClient,
  cfg: GatewayConfig,
  poolParam?: string | null,
): Promise<RouteInstance | null> {
  if (poolParam) {
    const inst = await resolveGatewayByPool(supabase, poolParam, cfg.chainId)
    if (inst) return { positionManager: inst.positionManager, poolAddress: inst.poolAddress, chainId: inst.chainId }
  }
  if (cfg.positionManager && cfg.poolAddress) {
    return { positionManager: cfg.positionManager, poolAddress: cfg.poolAddress, chainId: cfg.chainId }
  }
  return null
}

export type GatewayInstance = {
  id: string
  poolAddress: string
  chainId: number
  pairLabel: string | null
  positionManager: `0x${string}`
  staging: `0x${string}`
  quoteAsset: `0x${string}`
  pairedAsset: string | null
  tickLower: number | null
  tickUpper: number | null
  status: 'active' | 'inactive'
  verification: VerificationKind | null
}

function map(r: Record<string, unknown>): GatewayInstance {
  return {
    id: String(r.id),
    poolAddress: String(r.pool_address),
    chainId: Number(r.chain_id),
    pairLabel: (r.pair_label as string) ?? null,
    positionManager: String(r.position_manager) as `0x${string}`,
    staging: String(r.staging) as `0x${string}`,
    quoteAsset: String(r.quote_asset) as `0x${string}`,
    pairedAsset: (r.paired_asset as string) ?? null,
    tickLower: r.tick_lower != null ? Number(r.tick_lower) : null,
    tickUpper: r.tick_upper != null ? Number(r.tick_upper) : null,
    status: r.status === 'inactive' ? 'inactive' : 'active',
    verification: (r.verification as VerificationKind) ?? null,
  }
}

export async function listActiveInstances(supabase: SupabaseClient, chainId?: number): Promise<GatewayInstance[]> {
  let q = supabase.from('gateway_instances').select('*').eq('status', 'active')
  if (chainId != null) q = q.eq('chain_id', chainId)
  const { data } = await q
  return (data ?? []).map(map)
}

/** Every instance incl. inactive (withdraw-only resolution + curator views). */
export async function listAllInstances(supabase: SupabaseClient, chainId?: number): Promise<GatewayInstance[]> {
  let q = supabase.from('gateway_instances').select('*')
  if (chainId != null) q = q.eq('chain_id', chainId)
  const { data } = await q
  return (data ?? []).map(map)
}

export async function resolveGatewayByPool(
  supabase: SupabaseClient,
  poolAddress: string,
  chainId: number,
): Promise<GatewayInstance | null> {
  const { data } = await supabase
    .from('gateway_instances')
    .select('*')
    .eq('pool_address', poolAddress.toLowerCase())
    .eq('chain_id', chainId)
    .eq('status', 'active')
    .maybeSingle()
  return data ? map(data as Record<string, unknown>) : null
}

// ── write side ────────────────────────────────────────────────────────────────────────────────

export type RegisterVerify =
  /** Normal path (the curate route): verify on-chain against the configured trust root. */
  | { client: ReadClient; trust?: RegistryTrustConfig }
  /** Explicit, LOGGED operator attestation (backfill scripts only). Never silent. */
  | { operatorAttestation: { by: string; reason: string } }

export type RegisterResult =
  | { ok: true; unchanged?: boolean; verification: VerificationKind }
  | { ok: false; error: string }

async function history(
  supabase: SupabaseClient,
  row: {
    pool_address: string; chain_id: number; action: 'register' | 'deactivate' | 'refused'
    position_manager?: string | null; staging?: string | null; prev_position_manager?: string | null
    verification?: string | null; actor?: string | null; reason?: string | null; meta?: Record<string, unknown> | null
  },
) {
  // Best-effort: the history table is observability; a failure here must never mask the primary result.
  try { await supabase.from('gateway_instance_history').insert(row) } catch { /* noop */ }
}

export async function registerInstance(
  supabase: SupabaseClient,
  i: {
    poolAddress: string
    chainId: number
    pairLabel?: string | null
    positionManager: string
    staging: string
    quoteAsset?: string | null // informational only — the row's quote is the VERIFIED on-chain/env quote
    pairedAsset?: string | null
    tickLower?: number | null
    tickUpper?: number | null
    createdBy?: string | null
  },
  verify: RegisterVerify,
): Promise<RegisterResult> {
  const pool = i.poolAddress.toLowerCase()
  const pm = i.positionManager.toLowerCase()
  const stg = i.staging.toLowerCase()
  const actor = i.createdBy ?? null
  const refuse = async (error: string, extra?: Record<string, unknown>): Promise<RegisterResult> => {
    await history(supabase, { pool_address: pool, chain_id: i.chainId, action: 'refused', position_manager: pm, staging: stg, actor, reason: error, meta: extra ?? null })
    return { ok: false, error }
  }

  if (!isAddress(i.positionManager, { strict: false }) || !isAddress(i.staging, { strict: false })) return refuse('bad_address')

  // (e) verification — mandatory. Either on-chain against the trust root, or an explicit attestation.
  let verification: VerificationKind
  let quoteAsset: string
  let meta: Record<string, unknown>
  if ('operatorAttestation' in verify) {
    const a = verify.operatorAttestation
    if (!a?.by || !a?.reason) return refuse('attestation_incomplete')
    const envQuote = registryTrustConfigFromEnv().expectedQuoteAsset
    if (!envQuote) return refuse('quote_env_unset')
    verification = 'operator_attested'
    quoteAsset = envQuote
    meta = { attestedBy: a.by, reason: a.reason }
  } else {
    const trust = verify.trust ?? registryTrustConfigFromEnv()
    const v = await verifyInstanceOnChain({
      client: verify.client,
      positionManager: pm as `0x${string}`,
      staging: stg as `0x${string}`,
      expectedPoolAddress: pool,
      trust,
    })
    if (!v.ok) return refuse(`onchain_verify_failed:${v.error}`)
    verification = v.verification
    quoteAsset = v.quoteAsset.toLowerCase()
    meta = v.meta
  }

  // (d) READ-BEFORE-WRITE — never write over an ACTIVE row.
  const { data: existing } = await supabase
    .from('gateway_instances')
    .select('id, position_manager, staging, status')
    .eq('pool_address', pool)
    .eq('chain_id', i.chainId)
    .maybeSingle()
  const ex = existing as { id: string; position_manager: string; staging: string; status: string } | null
  const prevPm = ex ? String(ex.position_manager).toLowerCase() : null // captured BEFORE any write

  if (ex && ex.status === 'active') {
    if (String(ex.position_manager).toLowerCase() === pm && String(ex.staging).toLowerCase() === stg) {
      // identical re-register: idempotent no-op (nothing is overwritten)
      return { ok: true, unchanged: true, verification }
    }
    return refuse('active_instance_exists', { existingPositionManager: ex.position_manager })
  }

  const row = {
    pool_address: pool,
    chain_id: i.chainId,
    pair_label: i.pairLabel ?? null,
    position_manager: pm,
    staging: stg,
    quote_asset: quoteAsset,
    paired_asset: i.pairedAsset?.toLowerCase() ?? null,
    tick_lower: i.tickLower ?? null,
    tick_upper: i.tickUpper ?? null,
    status: 'active' as const,
    created_by: actor,
    verification,
    verified_by: actor,
    verification_meta: meta,
    deactivated_at: null,
    deactivated_by: null,
    deactivate_reason: null,
    updated_at: new Date().toISOString(),
  }

  let error: { message: string } | null
  if (ex) {
    // re-activating a deactivated pool with (possibly) new addresses — guarded so a concurrent
    // activation can't race us past the read above
    ;({ error } = await supabase.from('gateway_instances').update(row).eq('id', ex.id).eq('status', 'inactive'))
  } else {
    ;({ error } = await supabase.from('gateway_instances').insert(row))
  }
  if (error) return refuse(`write_failed:${error.message}`)

  await history(supabase, {
    pool_address: pool, chain_id: i.chainId, action: 'register', position_manager: pm, staging: stg,
    prev_position_manager: prevPm, verification, actor, meta,
  })
  return { ok: true, verification }
}

/** Explicit, logged deactivation — the only way an active instance stops being the deposit target.
 *  The row is kept (withdraw-only resolution keeps working); a later register may re-activate it. */
export async function deactivateInstance(
  supabase: SupabaseClient,
  i: { poolAddress: string; chainId: number; by: string; reason: string },
): Promise<{ ok: boolean; error?: string }> {
  const pool = i.poolAddress.toLowerCase()
  if (!i.reason?.trim()) return { ok: false, error: 'reason_required' }
  const { data: existing } = await supabase
    .from('gateway_instances')
    .select('id, position_manager, status')
    .eq('pool_address', pool)
    .eq('chain_id', i.chainId)
    .maybeSingle()
  const ex = existing as { id: string; position_manager: string; status: string } | null
  if (!ex) return { ok: false, error: 'not_found' }
  if (ex.status !== 'active') return { ok: false, error: 'not_active' }
  const { error } = await supabase
    .from('gateway_instances')
    .update({ status: 'inactive', deactivated_at: new Date().toISOString(), deactivated_by: i.by, deactivate_reason: i.reason, updated_at: new Date().toISOString() })
    .eq('id', ex.id)
    .eq('status', 'active')
  if (error) return { ok: false, error: error.message }
  await history(supabase, {
    pool_address: pool, chain_id: i.chainId, action: 'deactivate', position_manager: ex.position_manager,
    prev_position_manager: ex.position_manager, actor: i.by, reason: i.reason,
  })
  return { ok: true }
}
