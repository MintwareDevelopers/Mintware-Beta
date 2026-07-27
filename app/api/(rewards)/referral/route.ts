import { createHandler } from '@/lib/web2/routeHandler'

// ---------------------------------------------------------------------------
// Address validation
// Must be a valid Ethereum address: 0x + 40 hex chars = 42 total
// ---------------------------------------------------------------------------
function isValidAddress(raw: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(raw)
}

// GET /api/referral?address=0x...
export const GET = createHandler(async (req, ctx) => {
  const raw = req.nextUrl.searchParams.get('address')
  if (!raw) {
    return ctx.json({ error: 'address required' }, 400)
  }
  if (!isValidAddress(raw)) {
    return ctx.json(
      { error: 'invalid address — must be 0x followed by 40 hex characters' },
      400
    )
  }

  const address = raw.toLowerCase()
  // Service client: bypasses RLS for consistent reads. referral_stats is a
  // read-only view with no sensitive data — safe to expose publicly. This is
  // the single referral-read endpoint (the browser anon key can't read these
  // tables client-side), so it returns stats + the referrer's tree + referred_by.
  const [statsRes, recordsRes, referredByRes] = await Promise.all([
    ctx.supabase.from('referral_stats').select('*').eq('address', address).maybeSingle(),
    ctx.supabase.from('referral_records').select('*').eq('referrer', address).order('status', { ascending: true }).limit(10),
    ctx.supabase.from('referral_records').select('referrer').eq('referred', address).maybeSingle(),
  ])

  const stats = statsRes.data ?? {
    address, ref_code: null, ref_link: null, tree_size: 0, tree_quality: 0, sharing_score: 0,
  }

  return ctx.json({
    ...stats,
    records:     recordsRes.data ?? [],
    referred_by: referredByRes.data?.referrer ?? null,
  })
})

// POST /api/referral
// Legacy mutation route removed in favor of POST /api/auth/connect, which
// requires a fresh wallet-signed authorization message.
export const POST = createHandler(async (_req, ctx) => {
  return ctx.json(
    { error: 'deprecated — use POST /api/auth/connect with wallet authorization' },
    410
  )
})
