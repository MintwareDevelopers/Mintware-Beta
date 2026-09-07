import { createHandler } from '@/lib/web2/routeHandler'
import { gatewayConfig } from '@/lib/gateway/chain'

export const dynamic = 'force-dynamic'

// GET — PUBLIC. The V1 leaderboard: ranks OBSERVABLE on-chain / off-chain activity only — capital at work
// (net USDG provided across pools) and referrals brought — never a trust/credit signal or the Attribution
// score. Testnet "Season 0": standings are illustrative and may reset. Cheap DB aggregation (no chain
// reads); scaled for testnet volumes. `?me=<addr>` also returns the caller's own rank on each board even
// when they're off the visible top-N.

const TOP_N = 50
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export const GET = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  const me = req.nextUrl.searchParams.get('me')?.toLowerCase() || null

  // ── Providers: net capital at work (Σ entry_nav) + pools, from gateway_positions ──
  let providers: { wallet: string; label: string; capitalAtomic: string; pools: number }[] = []
  {
    let q = ctx.supabase.from('gateway_positions').select('user_wallet, entry_nav, pool_address')
    if (cfg?.chainId) q = q.eq('chain_id', cfg.chainId)
    const { data } = await q
    const byWallet = new Map<string, { cap: bigint; pools: Set<string> }>()
    for (const r of (data ?? []) as { user_wallet: string; entry_nav: unknown; pool_address: string }[]) {
      const w = String(r.user_wallet).toLowerCase()
      const cap = (() => { try { return BigInt(String(r.entry_nav ?? '0')) } catch { return 0n } })()
      if (cap <= 0n) continue
      const e = byWallet.get(w) ?? { cap: 0n, pools: new Set<string>() }
      e.cap += cap
      e.pools.add(String(r.pool_address))
      byWallet.set(w, e)
    }
    providers = [...byWallet.entries()]
      .map(([wallet, e]) => ({ wallet, label: short(wallet), capitalAtomic: e.cap.toString(), pools: e.pools.size }))
      .sort((a, b) => (BigInt(b.capitalAtomic) > BigInt(a.capitalAtomic) ? 1 : BigInt(b.capitalAtomic) < BigInt(a.capitalAtomic) ? -1 : 0))
  }

  // ── Referrers: wallets by referrals brought (tree_size), from the referral_stats view ──
  let referrers: { wallet: string; label: string; referrals: number; sharingScore: number }[] = []
  {
    const { data } = await ctx.supabase
      .from('referral_stats')
      .select('address, tree_size, sharing_score')
      .gt('tree_size', 0)
      .order('tree_size', { ascending: false })
      .limit(TOP_N)
    referrers = ((data ?? []) as { address: string; tree_size: number; sharing_score: number }[])
      .map((r) => ({ wallet: String(r.address).toLowerCase(), label: short(String(r.address)), referrals: Number(r.tree_size) || 0, sharingScore: Number(r.sharing_score) || 0 }))
  }

  // caller's own rank on each board (even if off the top-N)
  const myProviderRank = me ? providers.findIndex((p) => p.wallet === me) : -1
  const myReferrerRank = me ? referrers.findIndex((p) => p.wallet === me) : -1

  return ctx.json({
    success: true,
    season: 'Season 0',
    providers: providers.slice(0, TOP_N).map((p, i) => ({ rank: i + 1, ...p })),
    referrers: referrers.map((p, i) => ({ rank: i + 1, ...p })),
    me: me
      ? {
          provider: myProviderRank >= 0 ? { rank: myProviderRank + 1, ...providers[myProviderRank] } : null,
          referrer: myReferrerRank >= 0 ? { rank: myReferrerRank + 1, ...referrers[myReferrerRank] } : null,
        }
      : null,
    updatedAt: Date.now(),
  })
})
