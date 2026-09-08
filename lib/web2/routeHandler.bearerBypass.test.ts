// O-12 (round-2 audit): the bearer-token auth mode used to fall OPEN whenever the secret was unset on a
// `NODE_ENV=development` box — curate/register-class routes were unauthenticated in local dev. It now
// fails CLOSED unless the operator sets ALLOW_DEV_BEARER_BYPASS=true explicitly (development only).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => ({}) }))

const saved: Record<string, string | undefined> = {}
const KEYS = ['NODE_ENV', 'ALLOW_DEV_BEARER_BYPASS', 'CRON_SECRET'] as const
beforeEach(() => { for (const k of KEYS) saved[k] = process.env[k]; delete process.env.CRON_SECRET; delete process.env.ALLOW_DEV_BEARER_BYPASS })
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else (process.env as Record<string, string>)[k] = saved[k] as string } })

async function handler(bearerSecret?: string) {
  const { createHandler } = await import('./routeHandler')
  return createHandler(async (_req, ctx) => ctx.json({ ok: true }), { auth: 'bearer-token', ...(bearerSecret !== undefined ? { bearerSecret } : {}) })
}
const req = (auth?: string) => new NextRequest('https://mintware.test/api/x', { method: 'POST', headers: auth ? { authorization: auth } : {} })

describe('bearer-token auth — unset secret', () => {
  it('NODE_ENV=development WITHOUT the opt-in → 500 MISSING_SECRET (fails closed)', async () => {
    ;(process.env as Record<string, string>).NODE_ENV = 'development'
    const res = await (await handler())(req())
    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('MISSING_SECRET')
  })

  it('an EMPTY explicit bearerSecret (the curate route\'s `?? \'\'` pattern) also fails closed in development', async () => {
    ;(process.env as Record<string, string>).NODE_ENV = 'development'
    const res = await (await handler(''))(req('Bearer anything'))
    expect(res.status).toBe(500)
  })

  it('NODE_ENV=development WITH ALLOW_DEV_BEARER_BYPASS=true → allowed (explicit, logged opt-in)', async () => {
    ;(process.env as Record<string, string>).NODE_ENV = 'development'
    process.env.ALLOW_DEV_BEARER_BYPASS = 'true'
    const res = await (await handler())(req())
    expect(res.status).toBe(200)
  })

  it('the opt-in is ignored outside development (production / test) → still 500', async () => {
    process.env.ALLOW_DEV_BEARER_BYPASS = 'true'
    for (const env of ['production', 'test']) {
      ;(process.env as Record<string, string>).NODE_ENV = env
      const res = await (await handler())(req())
      expect(res.status).toBe(500)
    }
  })

  it('a set secret behaves as before: wrong → 401, right → 200', async () => {
    ;(process.env as Record<string, string>).NODE_ENV = 'development'
    process.env.CRON_SECRET = 's3cret'
    const h = await handler()
    expect((await h(req('Bearer wrong'))).status).toBe(401)
    expect((await h(req('Bearer s3cret'))).status).toBe(200)
  })
})
