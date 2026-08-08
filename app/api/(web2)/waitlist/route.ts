// =============================================================================
// POST /api/waitlist
//
// Inserts an email into the waitlist table.
// Body: { email: string }
// Response: { ok: true } | { error: string }
// =============================================================================

import { createHandler } from '@/lib/web2/routeHandler'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const POST = createHandler(async (req, ctx) => {
  let body: { email?: string }
  try {
    body = await req.json()
  } catch {
    return ctx.json({ error: 'Invalid JSON' }, 400)
  }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!email || !EMAIL_RE.test(email)) {
    return ctx.json({ error: 'Valid email required' }, 400)
  }

  const { error } = await ctx.supabase
    .from('waitlist')
    .upsert({ email, joined_at: new Date().toISOString() }, { onConflict: 'email' })

  if (error) {
    ctx.log.error('waitlist', 'Supabase error', { error })
    return ctx.json({ error: 'Failed to join waitlist' }, 500)
  }

  return ctx.json({ ok: true })
}, { rateLimit: { max: 5, windowMs: 60_000 } })
