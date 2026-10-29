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
  let body: { email?: string; source?: string }
  try {
    body = await req.json()
  } catch {
    return ctx.json({ error: 'Invalid JSON' }, 400)
  }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!email || !EMAIL_RE.test(email)) {
    return ctx.json({ error: 'Valid email required' }, 400)
  }

  const source = typeof body.source === 'string' ? body.source.trim().slice(0, 80) || null : null
  const payload = { email, joined_at: new Date().toISOString(), ...(source ? { source } : {}) }
  let { error } = await ctx.supabase.from('waitlist').upsert(payload, { onConflict: 'email' })

  if (error && source && isMissingSourceColumn(error)) {
    ;({ error } = await ctx.supabase.from('waitlist').upsert({ email, joined_at: payload.joined_at }, { onConflict: 'email' }))
  }

  if (error) {
    ctx.log.error('waitlist', 'Supabase error', { error })
    return ctx.json({ error: 'Failed to join waitlist' }, 500)
  }

  return ctx.json({ ok: true })
}, { rateLimit: { max: 5, windowMs: 60_000 } })

function isMissingSourceColumn(error: { code?: string; message?: string; details?: string; hint?: string }) {
  const text = [error.message, error.details, error.hint].filter(Boolean).join(' ').toLowerCase()
  return (error.code === '42703' || error.code === 'PGRST204') && text.includes('source')
}
