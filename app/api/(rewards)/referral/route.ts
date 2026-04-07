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
  // Service client: bypasses RLS for consistent reads from the referral_stats view.
  // referral_stats is a read-only view with no sensitive data — safe to expose publicly.
  const { data, error } = await ctx.supabase
    .from('referral_stats')
    .select('*')
    .eq('address', address)
    .single()

  if (error || !data) {
    return ctx.json({ error: error?.message ?? 'not found' }, 404)
  }

  return ctx.json(data)
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
