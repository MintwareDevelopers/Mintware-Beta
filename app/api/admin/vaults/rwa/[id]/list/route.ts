// POST /api/admin/vaults/rwa/[id]/list — record an RWA deal's on-chain deployment
// and list its vRWA/USDC pool on the meta-router.
//
// After DeployRwaFlow.s.sol stands up the connected stack (vault + vRWA + oracle
// hook + seeded pool), an admin posts the logged addresses here. This:
//   1. records vault/vRWA/hook + pool key on the RWA vault row (social_vaults),
//   2. inserts a `router_pools` row so /api/swap/best-route can route vRWA↔USDC
//      through MWRouter (the RWA secondary market goes live),
//   3. flips the vault status to 'live'.
// Admin-gated. Reads/writes Supabase → dynamic.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { verifyAdmin } from '@/lib/web2/admin'

export const dynamic = 'force-dynamic'

interface ListBody {
  chain_id: number
  vault_address: string
  vrwa_address: string
  hook_address: string
  router_address: string
  pool_currency0: string
  pool_currency1: string
  pool_fee: number
  pool_tick_spacing: number
}

const isAddr = (v: unknown): v is string =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)

function validate(b: unknown): b is ListBody {
  if (!b || typeof b !== 'object') return false
  const p = b as Record<string, unknown>
  return (
    typeof p.chain_id === 'number' &&
    isAddr(p.vault_address) && isAddr(p.vrwa_address) && isAddr(p.hook_address) &&
    isAddr(p.router_address) && isAddr(p.pool_currency0) && isAddr(p.pool_currency1) &&
    typeof p.pool_fee === 'number' && typeof p.pool_tick_spacing === 'number'
  )
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(async (r, ctx) => {
    const admin = await verifyAdmin(r)
    if (!admin) return ctx.json({ error: 'unauthorized' }, 401)

    const body = await r.clone().json().catch(() => null)
    if (!validate(body)) return ctx.json({ error: 'invalid deployment payload' }, 400)

    // Guard: the target vault must exist and be an RWA vault.
    const { data: vault } = await ctx.supabase
      .from('social_vaults')
      .select('id, surface')
      .eq('id', id)
      .maybeSingle()
    if (!vault) return ctx.json({ error: 'vault not found' }, 404)
    if (vault.surface !== 'rwa') return ctx.json({ error: 'not an RWA vault' }, 400)

    const c0 = body.pool_currency0.toLowerCase()
    const c1 = body.pool_currency1.toLowerCase()

    // 1) record the on-chain deployment on the vault row
    const { error: vErr } = await ctx.supabase
      .from('social_vaults')
      .update({
        vault_address:     body.vault_address.toLowerCase(),
        vrwa_address:      body.vrwa_address.toLowerCase(),
        hook_address:      body.hook_address.toLowerCase(),
        pool_currency0:    c0,
        pool_currency1:    c1,
        pool_fee:          body.pool_fee,
        pool_tick_spacing: body.pool_tick_spacing,
        status:            'live',
        listed_at:         new Date().toISOString(),
      })
      .eq('id', id)
    if (vErr) {
      ctx.log.error('admin/rwa/list', 'vault update failed', { id, error: vErr.message })
      return ctx.json({ error: 'vault update failed' }, 500)
    }

    // 2) list the pair on the meta-router (idempotent on the pair per chain)
    const { error: rErr } = await ctx.supabase
      .from('router_pools')
      .upsert(
        {
          chain_id:     body.chain_id,
          router:       body.router_address.toLowerCase(),
          hooks:        body.hook_address.toLowerCase(),
          currency0:    c0,
          currency1:    c1,
          fee:          body.pool_fee,
          tick_spacing: body.pool_tick_spacing,
          active:       true,
        },
        { onConflict: 'chain_id,currency0,currency1' },
      )
    if (rErr) {
      ctx.log.error('admin/rwa/list', 'router_pools upsert failed', { id, error: rErr.message })
      return ctx.json({ error: 'router listing failed' }, 500)
    }

    ctx.log.info('admin/rwa/list', 'RWA pool listed', { id, admin, chain: body.chain_id })
    return ctx.json({ ok: true, id, status: 'live', listed: true })
  })(req)
}
