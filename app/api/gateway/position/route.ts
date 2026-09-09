import { isAddress } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { readGatewayPosition, readGatewayPoolState, serializePoolState } from '@/lib/gateway/positionReader'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { resolveInstanceStrict } from '@/lib/gateway/routeInstance'

export const dynamic = 'force-dynamic'

// GET — PUBLIC (auth:'none'). Returns only chain-derivable position figures (shares, NAV/value, cost
// basis, PnL) for any ?address=. It deliberately does NOT disclose the off-chain spendable-buffer
// balance (card_spend_buffers) — that is private per-wallet money data, so it is only served to a
// caller that proves ownership of the address via the signed POST below (audit L-03). Public callers
// always see `bufferBalanceAtomic: null`.
//
// Chain-first (audit O-1): shares/value come from `sharesOf`/`totalNav`; the DB row is enrichment (cost
// basis) only. Also returns `poolState` — the on-chain inputs the UI's dry quotes need to set
// `depositWithMin` / `withdrawWithMin` floors (C-6). Pool resolution is strict (O-2): 404 on a miss.
export const GET = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const address = req.nextUrl.searchParams.get('address')?.toLowerCase()
  if (!address || !isAddress(address)) {
    return ctx.json({ success: false, error: 'address_required' }, 400)
  }

  // V1-01 fix: a retired pool must still resolve for a chain-derived position read.
  const r = await resolveInstanceStrict(ctx.supabase, cfg, req.nextUrl.searchParams.get('pool'), { includeInactive: true })
  if (!r.ok) return ctx.json({ success: false, error: r.error }, r.status)
  const inst = r.inst

  // Cost basis comes from the DB (populated by the deposit/withdraw record flows); absent ⇒ null PnL.
  // The buffer balance is intentionally NOT read here — it is owner-gated on the POST path.
  const { data: pos } = await ctx.supabase
    .from('gateway_positions')
    .select('id, entry_nav, shares')
    .eq('user_wallet', address)
    .eq('pool_address', inst.poolAddress)
    .eq('chain_id', inst.chainId)
    .maybeSingle()

  const client = gatewayPublicClient(cfg)

  let view
  let poolState = null
  try {
    view = await readGatewayPosition({
      client,
      positionManager: inst.positionManager,
      user: address as `0x${string}`,
      costBasisAtomic: pos?.entry_nav != null ? BigInt(String(pos.entry_nav)) : null,
      bufferBalanceAtomic: 0n,
    })
  } catch (e) {
    ctx.log.warn('gateway.position', 'chain read failed', { error: String(e) })
    return ctx.json({ success: false, error: 'chain_read_failed' }, 502)
  }
  try {
    poolState = serializePoolState(await readGatewayPoolState({ client, positionManager: inst.positionManager, staging: inst.staging }))
  } catch (e) {
    // Quote inputs are best-effort: without them the UI cannot set a floor and must say so (never guess).
    ctx.log.warn('gateway.position', 'pool state read failed', { error: String(e) })
  }

  // Historical value/PnL series (Krystal item 8) — written by the gateway-snapshot cron.
  const { data: snaps } = await ctx.supabase
    .from('gateway_position_snapshots')
    .select('taken_at, position_value_atomic, pnl_atomic')
    .eq('user_wallet', address)
    .eq('pool_address', inst.poolAddress)
    .eq('chain_id', inst.chainId)
    .order('taken_at', { ascending: false })
    .limit(60)

  return ctx.json({
    success: true,
    position: {
      shares: view.shares,
      positionValueAtomic: view.positionValueAtomic,
      costBasisAtomic: view.costBasisAtomic,
      unrealizedPnlAtomic: view.unrealizedPnlAtomic,
      // True when the chain shows shares but no DB row exists — the deposit was never recorded (O-1).
      recorded: pos != null,
      // Off-chain private data — never disclosed on the public path (audit L-03). Owners read it via POST.
      bufferBalanceAtomic: null,
      // Unharvested fees need a V4 fee-growth read — deferred to a later pass (phase-1 shows realized).
      unharvestedFeesAtomic: null,
      // Historical value/PnL series (Krystal item 8) — on-chain-derived, not private; newest first.
      history: (snaps ?? []).map((s: { taken_at: string; position_value_atomic: unknown; pnl_atomic: unknown }) => ({
        takenAt: s.taken_at,
        positionValueAtomic: String(s.position_value_atomic ?? '0'),
        pnlAtomic: String(s.pnl_atomic ?? '0'),
      })),
    },
    poolState, // null when unreadable
    source: inst.source,
    live: inst.live,
  })
})

// POST — OWNER-ONLY (auth:'signed-message', action-bound). Returns the off-chain spendable-buffer
// balance for the wallet that signed the request. The factory recovers the EIP-191 signer and sets
// ctx.user.address; the buffer is read for THAT address only, so a caller can never read another
// wallet's buffer (audit L-03). Body: { address, pool?, authMessage, authSignature, issuedAt } where
// authMessage is buildGatewayBufferMessage(...).
export const POST = createHandler(
  async (req, ctx) => {
    const cfg = gatewayConfig()
    if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

    const owner = ctx.user!.address // proven by signature; already lowercased

    let pool: string | null = null
    try {
      const body = (await req.clone().json()) as { pool?: string | null }
      pool = body.pool ?? null
    } catch {
      // no body pool ⇒ strict resolver picks the single instance or refuses
    }

    // V1-01 fix: an owner's own buffer balance must still be readable for a retired pool.
    const r = await resolveInstanceStrict(ctx.supabase, cfg, pool, { includeInactive: true })
    if (!r.ok) return ctx.json({ success: false, error: r.error }, r.status)
    const inst = r.inst

    const { data: pos } = await ctx.supabase
      .from('gateway_positions')
      .select('id')
      .eq('user_wallet', owner)
      .eq('pool_address', inst.poolAddress)
      .eq('chain_id', inst.chainId)
      .maybeSingle()

    let bufferBalanceAtomic = 0n
    if (pos?.id) {
      const { data: buf } = await ctx.supabase
        .from('card_spend_buffers')
        .select('buffer_balance_atomic')
        .eq('gateway_position_id', pos.id)
        .maybeSingle()
      if (buf?.buffer_balance_atomic != null) bufferBalanceAtomic = BigInt(String(buf.buffer_balance_atomic))
    }

    return ctx.json({ success: true, bufferBalanceAtomic })
  },
  { auth: 'signed-message', action: 'mintware-gateway-buffer' },
)
