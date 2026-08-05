// GET /api/kyc/status?address=0x… — KYC status for UI gating (WS1, RWA trader gate).
//
// Reads the `kyc_records` mirror. On-chain SPVBeneficiaryRegistry is the true gate; this is a
// UX read so the RWA "trade vRWA" action can show a verification-required state before the user
// bounces off an on-chain revert. `verified` folds in status + expiry.

import { createHandler } from '@/lib/web2/routeHandler'

export const dynamic = 'force-dynamic'

export const GET = createHandler(async (req, ctx) => {
  const address = new URL(req.url).searchParams.get('address')?.trim().toLowerCase()
  if (!address) return ctx.json({ success: false, error: 'address required' }, 400)

  const { data } = await ctx.supabase
    .from('kyc_records')
    .select('status, level, onchain_status, expires_at')
    .eq('address', address)
    .maybeSingle()

  const nowSec = Math.floor(Date.now() / 1000)
  const notExpired = !data?.expires_at || Number(data.expires_at) === 0 || Number(data.expires_at) > nowSec
  const verified = !!data && data.status === 'verified' && notExpired

  return ctx.json({
    address,
    verified,
    status:  data?.status ?? 'none',
    level:   data?.level ?? 0,
    onchain: data?.onchain_status ?? 'none',
  })
}, { rateLimit: { max: 60, windowMs: 60_000 } })
