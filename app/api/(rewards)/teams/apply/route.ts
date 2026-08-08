// =============================================================================
// POST /api/teams/apply
//
// Submits a team application for points campaign access.
//
// Body: {
//   wallet, protocol_name, website?, contact_email,
//   pool_size_usd?, description?
// }
//
// Responses:
//   200 { success: true, status: 'pending' }       — new application inserted
//   200 { status: 'pending', message: string }      — already pending
//   200 { status: 'approved' }                      — already approved
//   400 { error: string }                           — validation failure
//   500 { error: string }                           — DB error
//
// Auth: none. Uses service role for DB writes.
// =============================================================================

import { createHandler } from '@/lib/web2/routeHandler'

function isValidAddress(raw: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(raw)
}

function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)
}

export const POST = createHandler(async (req, ctx) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return ctx.json({ error: 'Invalid JSON body' }, 400)
  }

  const {
    wallet,
    protocol_name,
    website,
    contact_email,
    pool_size_usd,
    description,
  } = body as Record<string, string>

  // -- Validate required fields -----------------------------------------------
  if (!wallet || !protocol_name || !contact_email) {
    return ctx.json(
      { error: 'wallet, protocol_name, and contact_email are required' },
      400
    )
  }
  if (!isValidAddress(wallet)) {
    return ctx.json(
      { error: 'invalid wallet — must be 0x followed by 40 hex characters' },
      400
    )
  }
  if (!isValidEmail(contact_email)) {
    return ctx.json({ error: 'invalid contact_email' }, 400)
  }

  const normalWallet = wallet.toLowerCase()

  // -- Check whitelist first (already approved?) --------------------------------
  const { data: whitelisted } = await ctx.supabase
    .from('whitelisted_teams')
    .select('status')
    .eq('wallet', normalWallet)
    .maybeSingle()

  if (whitelisted?.status === 'approved') {
    return ctx.json({ status: 'approved' })
  }

  // -- Check existing application -----------------------------------------------
  const { data: existing } = await ctx.supabase
    .from('team_applications')
    .select('id, status')
    .eq('wallet', normalWallet)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'pending' || existing.status === 'reviewed') {
      return ctx.json({
        status: 'pending',
        message: 'Your application is under review',
      })
    }
    if (existing.status === 'approved') {
      return ctx.json({ status: 'approved' })
    }
    // rejected — allow reapplication (fall through)
  }

  // -- Insert new application ---------------------------------------------------
  const { error: insertErr } = await ctx.supabase
    .from('team_applications')
    .insert({
      wallet:        normalWallet,
      protocol_name: protocol_name.trim(),
      website:       website?.trim() || null,
      contact_email: contact_email.trim().toLowerCase(),
      pool_size_usd: pool_size_usd?.trim() || null,
      description:   description?.trim() || null,
    })

  if (insertErr) {
    ctx.log.error('teams/apply', 'Insert error', { error: insertErr })
    return ctx.json({ error: 'Failed to submit application' }, 500)
  }

  return ctx.json({ success: true, status: 'pending' })
}, { rateLimit: { max: 5, windowMs: 60_000 } })
