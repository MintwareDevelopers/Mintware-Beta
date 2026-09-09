import { isAddress } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { readGatewayPosition } from '@/lib/gateway/positionReader'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { listResolvableInstances } from '@/lib/gateway/routeInstance'
import { createTokenBucket } from '@/lib/gateway/sparkline'

export const dynamic = 'force-dynamic'

// V1-09 fix (independent Codex audit, 2026-09-09): public, unauthenticated, and the MOST expensive of
// the three (fans out an RPC read across every resolvable instance) — same in-memory per-IP floor as
// discover/sparklines/meta/position (O-8); createHandler's declarative rateLimit fails open without
// Upstash (unset in prod today).
const ipBucket = createTokenBucket({ capacity: 30, refillPerSec: 0.5, maxKeys: 5_000 })

// GET — PUBLIC (auth:'none'). The cross-pool aggregate: every LP-gateway position a wallet holds, for the
// Portfolio view. CHAIN-FIRST (audit O-1 / HO-1): enumerate every resolvable instance (active registry
// rows, or the env rig while the registry is empty), read `sharesOf` for the wallet on each, and surface
// every pool with shares > 0. The wallet's `gateway_positions` rows are ENRICHMENT only (cost basis +
// whether the deposit was recorded) — a depositor whose record call failed still sees their position.
// Like the single-pool GET, it discloses only chain-derivable figures. Earn-vs-LP decision (2026-09-08):
// the off-chain spendable-buffer reveal (POST /api/gateway/position, L-03) is no longer called by the
// frontend — the A-4 buffer-credit path is dropped, so it would always answer 0. Left in place as inert.
export const GET = createHandler(async (req, ctx) => {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown'
  if (!ipBucket.take(ip)) return ctx.json({ success: false, error: 'Too many requests', code: 'RATE_LIMITED' }, 429)

  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const address = req.nextUrl.searchParams.get('address')?.toLowerCase()
  if (!address || !isAddress(address)) {
    return ctx.json({ success: false, error: 'address_required' }, 400)
  }

  const instances = await listResolvableInstances(ctx.supabase, cfg)
  if (instances.length === 0) return ctx.json({ success: true, positions: [], complete: true, failedPools: [] })

  // DB enrichment: cost basis per pool (may be absent when a record call never landed).
  const { data: rows } = await ctx.supabase
    .from('gateway_positions')
    .select('pool_address, chain_id, entry_nav, shares')
    .eq('user_wallet', address)
  const basisByPool = new Map<string, { entry_nav: unknown }>()
  for (const r of (rows ?? []) as { pool_address: string; chain_id: number; entry_nav: unknown }[]) {
    basisByPool.set(`${String(r.pool_address).toLowerCase()}:${Number(r.chain_id)}`, r)
  }

  const client = gatewayPublicClient(cfg)

  // V1-08 fix (independent Codex audit, 2026-09-09): an RPC read failure for one pool used to return
  // `null`, indistinguishable from "genuinely zero shares there" once filtered — a wallet with real
  // funded positions could see them silently vanish (or the total quietly understate) during a chain
  // hiccup, with nothing in the response saying so. Each outcome now carries which case it is; the
  // caller gets both the (possibly partial) position list AND an explicit `complete`/`failedPools`
  // signal instead of a result that looks identical to "you have nothing here."
  const outcomes = await Promise.all(
    instances.map(async (inst) => {
      const row = basisByPool.get(`${inst.poolAddress}:${inst.chainId}`)
      try {
        const view = await readGatewayPosition({
          client,
          positionManager: inst.positionManager,
          user: address as `0x${string}`,
          costBasisAtomic: row?.entry_nav != null ? BigInt(String(row.entry_nav)) : null,
          bufferBalanceAtomic: 0n,
        })
        if (BigInt(view.shares) <= 0n) return { ok: true as const, position: null } // genuinely nothing here
        return {
          ok: true as const,
          position: {
            poolAddress: inst.poolAddress,
            // V1-01 pass-2 residual fix (independent Codex audit, 2026-09-09): a pool can have more
            // than one PositionManager in its history (a retired one + a replacement) — the pool
            // address alone can no longer identify WHICH generation this position belongs to. Carried
            // through so the Portfolio can build a link that resolves to the right one specifically.
            positionManager: inst.positionManager,
            pairLabel: inst.pairLabel,
            chainId: inst.chainId,
            shares: view.shares,
            positionValueAtomic: view.positionValueAtomic,
            costBasisAtomic: view.costBasisAtomic,
            unrealizedPnlAtomic: view.unrealizedPnlAtomic,
            recorded: row != null, // false ⇒ chain shows shares but no record row (O-1) — cost basis unknown
            source: inst.source,
            live: inst.live,
            // Off-chain private data — owner-gated on POST /api/gateway/position (L-03).
            bufferBalanceAtomic: null,
            // V1-08 fix: false ⇒ cached NAV (yield-source outage), not a fresh read.
            sourceReadable: view.sourceReadable,
          },
        }
      } catch (e) {
        ctx.log.warn('gateway.positions', 'chain read failed for pool', { pool: inst.poolAddress, error: String(e) })
        return { ok: false as const, poolAddress: inst.poolAddress }
      }
    }),
  )
  const positions = outcomes.flatMap((o) => (o.ok && o.position ? [o.position] : []))
  const failedPools = outcomes.filter((o): o is { ok: false; poolAddress: string } => !o.ok).map((o) => o.poolAddress)
  const complete = failedPools.length === 0

  // Value history for per-pool sparklines (Krystal item 8) — one query for the wallet, grouped by pool.
  // On-chain-derived series, not private; oldest→newest so the sparkline reads left-to-right.
  const { data: snaps } = await ctx.supabase
    .from('gateway_position_snapshots')
    .select('pool_address, taken_at, position_value_atomic')
    .eq('user_wallet', address)
    .order('taken_at', { ascending: true })
    .limit(600)
  const seriesByPool = new Map<string, number[]>()
  for (const s of (snaps ?? []) as { pool_address: string; position_value_atomic: unknown }[]) {
    const k = String(s.pool_address).toLowerCase()
    const v = Number(s.position_value_atomic ?? 0) / 1e6
    if (!Number.isFinite(v)) continue
    const arr = seriesByPool.get(k) ?? []
    arr.push(v)
    seriesByPool.set(k, arr)
  }

  const withHistory = positions.map((p) => ({ ...p, valueSeries: seriesByPool.get(p.poolAddress.toLowerCase()) ?? [] }))

  return ctx.json({ success: true, positions: withHistory, complete, failedPools })
})
