// POST /api/rwa/unlock — V2-RWAs partner access. Validates RWA_ACCESS_PASSWORD and sets an http-only cookie that
// holds a hash of it (lib/rwa/gate.ts). Fail-closed: unset password ⇒ 503 for everyone. Rate-limited.
import { createHandler } from '@/lib/web2/routeHandler'
import { V2_COOKIE } from '@/lib/v2/gate'
import { isV2RwaVisible } from '@/lib/v2/rwaGate'
import { RWA_ACCESS_PASSWORD, RWA_COOKIE, rwaToken } from '@/lib/rwa/gate'

export const dynamic = 'force-dynamic'

export const POST = createHandler(async (req, ctx) => {
  if (!isV2RwaVisible(req.cookies.get(V2_COOKIE)?.value)) return ctx.json({ ok: false, error: 'not_found' }, 404)
  if (!RWA_ACCESS_PASSWORD) return ctx.json({ ok: false, error: 'gate_not_configured' }, 503)
  const body = (await req.json().catch(() => ({}))) as { password?: string }
  if (String(body.password ?? '') !== RWA_ACCESS_PASSWORD) return ctx.json({ ok: false, error: 'wrong_password' }, 401)
  const res = ctx.json({ ok: true })
  res.cookies.set(RWA_COOKIE, rwaToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return res
}, { rateLimit: { max: 10, windowMs: 60_000 } })
