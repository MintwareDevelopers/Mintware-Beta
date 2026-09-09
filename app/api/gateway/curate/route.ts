import type { NextRequest } from 'next/server'
import { createHandler, type RouteContext } from '@/lib/web2/routeHandler'
import { registerInstance, deactivateInstance, registryTrustConfigFromEnv } from '@/lib/gateway/registry'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import {
  GATEWAY_CURATE_ACTION,
  buildGatewayCurateMessage,
  parseCuratorAllowlist,
  isAllowlistedCurator,
  type CurateAction,
} from '@/lib/gateway/curateAuth'

export const dynamic = 'force-dynamic'

// Public: the pending curation queue, ranked by risk score (lowest = look first), for the dashboard.
export const GET = createHandler(async (_req, ctx) => {
  const { data } = await ctx.supabase
    .from('gateway_pool_requests')
    .select('id, pool_address, chain_id, pair_label, quote_asset, source, risk_score, risk_signals, hotness, created_at')
    .eq('status', 'pending')
    .order('risk_score', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(100)
  return ctx.json({ success: true, queue: data ?? [] })
}, { rateLimit: { max: 30, windowMs: 60_000 } }) // round-4 audit fix (Low, HO-15): matches discover/sparklines

// ─────────────────────────────────────────────────────────────────────────────────────────────
// POST — curator actions: approve (optionally + register the deployed instance), reject, deactivate.
//
// Audit closeout 2026-09-08 (O-3 / R-2 / HO-7): the curator is a WALLET on the `LP_GATEWAY_CURATORS`
// allowlist proving itself with an EIP-191 signature (`auth: 'signed-message'`, action-bound), not a
// shared bearer typed into the public /curate page. The route rebuilds the exact canonical message from
// the body and strict-compares it, so the signature is bound to the action, request, pool AND candidate
// addresses. Registration is on-chain verified against the trust root (`registerInstance`) and never
// overwrites an active row.
//
// A bearer path remains ONLY for server-to-server automation (`LP_GATEWAY_CURATOR_SECRET`): it may
// approve/reject queue rows but can NOT register an instance or deactivate one — those need a curator
// signature. Unset secret ⇒ 503 in every environment (closes O-12's dev pass-through for this route).
// ─────────────────────────────────────────────────────────────────────────────────────────────

type Body = {
  requestId?: string
  action?: CurateAction
  curatorNote?: string
  reason?: string
  poolAddress?: string
  chainId?: number
  instance?: {
    pairLabel?: string
    positionManager?: string
    staging?: string
    pairedAsset?: string
    tickLower?: number
    tickUpper?: number
  }
  // signed-message envelope
  address?: string
  authMessage?: string
  authSignature?: string
  issuedAt?: number
}

type Actor = { kind: 'curator'; address: string } | { kind: 'server' }

async function curate(b: Body, ctx: RouteContext, actor: Actor) {
  const action = b.action
  if (action !== 'approve' && action !== 'reject' && action !== 'deactivate') {
    return ctx.json({ success: false, error: 'action_required' }, 400)
  }
  const actorLabel = actor.kind === 'curator' ? actor.address : 'server:bearer'

  // ── deactivate: curator-only, explicit reason, logged ───────────────────────────────────────
  if (action === 'deactivate') {
    if (actor.kind !== 'curator') return ctx.json({ success: false, error: 'deactivate_requires_curator_signature' }, 403)
    const poolAddress = String(b.poolAddress ?? '').toLowerCase()
    const chainId = Number(b.chainId ?? 0)
    if (!poolAddress || !chainId) return ctx.json({ success: false, error: 'pool_and_chain_required' }, 400)
    const r = await deactivateInstance(ctx.supabase, { poolAddress, chainId, by: actor.address, reason: String(b.reason ?? '') })
    if (!r.ok) return ctx.json({ success: false, error: r.error }, r.error === 'not_found' ? 404 : 409)
    ctx.log.warn('gateway.curate', 'instance DEACTIVATED', { pool: poolAddress, chainId, by: actor.address, reason: b.reason })
    return ctx.json({ success: true, action: 'deactivated' })
  }

  let request: Record<string, unknown> | null = null
  if (b.requestId) {
    const { data } = await ctx.supabase.from('gateway_pool_requests').select('*').eq('id', b.requestId).maybeSingle()
    if (!data) return ctx.json({ success: false, error: 'request_not_found' }, 404)
    request = data as Record<string, unknown>
    // the signed pool/chain (when present) must be THIS request's — a signature for one request can't resolve another
    if (b.poolAddress && String(request.pool_address).toLowerCase() !== String(b.poolAddress).toLowerCase()) {
      return ctx.json({ success: false, error: 'pool_mismatch' }, 400)
    }
    if (b.chainId != null && Number(request.chain_id) !== Number(b.chainId)) {
      return ctx.json({ success: false, error: 'chain_mismatch' }, 400)
    }
  }

  const resolve = async (status: 'approved' | 'rejected') => {
    if (!request) return
    await ctx.supabase
      .from('gateway_pool_requests')
      .update({ status, curator_note: b.curatorNote ?? null, reviewed_by: actorLabel, reviewed_at: new Date().toISOString() })
      .eq('id', String(request.id))
  }

  if (action === 'reject') {
    await resolve('rejected')
    return ctx.json({ success: true, action: 'rejected' })
  }

  // ── approve — register the deployed instance if its addresses were supplied ─────────────────
  let registered = false
  let verification: string | null = null
  const inst = b.instance
  if (inst?.positionManager || inst?.staging) {
    if (actor.kind !== 'curator') return ctx.json({ success: false, error: 'register_requires_curator_signature' }, 403)
    if (!inst.positionManager || !inst.staging) return ctx.json({ success: false, error: 'position_manager_and_staging_required' }, 400)
    const chainId = Number(request?.chain_id ?? b.chainId ?? 0)
    const poolAddress = String(request?.pool_address ?? b.poolAddress ?? '').toLowerCase()
    if (!chainId || !poolAddress) return ctx.json({ success: false, error: 'pool_and_chain_required' }, 400)

    // Verification needs the gateway chain configured AND matching — that's the chain we can read.
    const cfg = gatewayConfig()
    if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)
    if (chainId !== cfg.chainId) {
      ctx.log.warn('gateway.curate', 'register chain mismatch — cannot verify on-chain', { requested: chainId, configured: cfg.chainId })
      return ctx.json({ success: false, error: 'chain_not_verifiable' }, 400)
    }
    const trust = registryTrustConfigFromEnv()
    if (!trust.factory && trust.pmCodeHashes.length === 0) return ctx.json({ success: false, error: 'trust_root_unconfigured' }, 503)
    if (!trust.expectedQuoteAsset) return ctx.json({ success: false, error: 'quote_env_unset' }, 503)

    const reg = await registerInstance(
      ctx.supabase,
      {
        poolAddress,
        chainId,
        pairLabel: (request?.pair_label as string) ?? inst.pairLabel ?? null,
        positionManager: inst.positionManager,
        staging: inst.staging,
        pairedAsset: inst.pairedAsset ?? null,
        tickLower: inst.tickLower ?? null,
        tickUpper: inst.tickUpper ?? null,
        createdBy: actor.address,
      },
      { client: gatewayPublicClient(cfg), trust },
    )
    if (!reg.ok) {
      ctx.log.warn('gateway.curate', 'instance registration REFUSED', {
        pool: poolAddress, chainId, positionManager: inst.positionManager.toLowerCase(), curator: actor.address, reason: reg.error,
      })
      const verifyFail = reg.error.startsWith('onchain_verify_failed')
      const conflict = reg.error === 'active_instance_exists'
      return ctx.json(
        { success: false, error: verifyFail ? 'onchain_verify_failed' : conflict ? 'active_instance_exists' : 'register_failed', detail: reg.error },
        verifyFail ? 400 : conflict ? 409 : 500,
      )
    }
    ctx.log.info('gateway.curate', 'instance registered (trust-root verified)', {
      pool: poolAddress, chainId, positionManager: inst.positionManager.toLowerCase(), verification: reg.verification, curator: actor.address,
      unchanged: reg.unchanged ?? false,
    })
    registered = true
    verification = reg.verification
  }
  await resolve('approved')
  return ctx.json({ success: true, action: 'approved', registered, verification })
}

// Curator path — signed-message + allowlist + strict message rebuild.
const curatorPost = createHandler(
  async (req, ctx) => {
    const b = (await req.clone().json().catch(() => ({}))) as Body
    const address = ctx.user!.address
    const allow = parseCuratorAllowlist(process.env.LP_GATEWAY_CURATORS)
    if (allow.length === 0) return ctx.json({ success: false, error: 'curators_not_configured' }, 503)
    if (!isAllowlistedCurator(address, allow)) {
      ctx.log.warn('gateway.curate', 'non-allowlisted wallet attempted a curator action', { address })
      return ctx.json({ success: false, error: 'not_a_curator' }, 403)
    }
    if (b.action !== 'approve' && b.action !== 'reject' && b.action !== 'deactivate') {
      return ctx.json({ success: false, error: 'action_required' }, 400)
    }
    // Gold standard: rebuild the exact message from the body and strict-compare — the signature is bound
    // to the action + request + pool + candidate addresses, not just to "some curate call".
    const expected = buildGatewayCurateMessage({
      address,
      issuedAt: Number(b.issuedAt),
      curateAction: b.action,
      requestId: b.requestId ?? null,
      poolAddress: b.poolAddress ?? null,
      chainId: b.chainId ?? null,
      positionManager: b.instance?.positionManager ?? null,
      staging: b.instance?.staging ?? null,
    })
    if (expected !== b.authMessage) {
      ctx.log.warn('gateway.curate', 'signed message does not match body (payload binding)', { address })
      return ctx.json({ success: false, error: 'AUTH_MISMATCH' }, 401)
    }
    return curate(b, ctx, { kind: 'curator', address })
  },
  { auth: 'signed-message', action: GATEWAY_CURATE_ACTION, rateLimit: { max: 30, windowMs: 60_000 } },
)

// Server-to-server path — bearer, approve/reject only. Built per request so the secret is read at
// request time and an unset secret fails closed everywhere (never the dev pass-through).
function serverPost(secret: string) {
  return createHandler(
    async (req, ctx) => {
      if (!secret) return ctx.json({ success: false, error: 'curator_secret_unset' }, 503)
      const b = (await req.clone().json().catch(() => ({}))) as Body
      return curate(b, ctx, { kind: 'server' })
    },
    { auth: 'bearer-token', bearerSecret: secret },
  )
}

export async function POST(req: NextRequest) {
  const header = req.headers.get('authorization') ?? ''
  if (header.startsWith('Bearer ')) return serverPost(process.env.LP_GATEWAY_CURATOR_SECRET ?? '')(req)
  return curatorPost(req)
}
