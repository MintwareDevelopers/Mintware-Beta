// =============================================================================
// proxy.ts — Edge rate limiting for sensitive API endpoints
//
// Protects:
//   POST /api/campaigns/swap-event      — 10 req/min per IP
//   POST /api/campaigns/sol-swap-event  — 10 req/min per IP
//   POST /api/campaigns/join            — 5  req/min per IP
//   POST /api/swap/quote                — 20 req/min per IP
//   POST /api/wallet-link               — 5  req/min per IP
//   GET  /api/claim                     — 10 req/min per IP
//   GET  /api/claim/sol                 — 10 req/min per IP
//   (+ agent and claim endpoints — see RATE_LIMITS below)
//
// Implementation:
//   Primary:  Upstash Redis sliding window — cross-instance, global limits
//   Fallback: In-memory sliding window — used if UPSTASH_REDIS_REST_URL not set
//             (effective against simple bots within a single serverless instance)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'

interface RuleConfig { limit: number; windowMs: number; method?: string }

// method: undefined = POST only (default), 'GET' = GET only, 'ANY' = all methods
const RATE_LIMITS: Record<string, RuleConfig> = {
  '/api/campaigns/swap-event':          { limit: 10, windowMs: 60_000 },
  '/api/campaigns/sol-swap-event':      { limit: 10, windowMs: 60_000 },
  '/api/campaigns/join':                { limit:  5, windowMs: 60_000 },
  '/api/campaigns/refresh-score':       { limit:  5, windowMs: 60_000 },
  '/api/swap/quote':                    { limit: 20, windowMs: 60_000 },
  '/api/wallet-link':                   { limit:  5, windowMs: 60_000 },
  '/api/agents/campaigns/record':       { limit: 10, windowMs: 60_000 },
  '/api/agents/register':               { limit:  5, windowMs: 60_000 },
  '/api/agents/mwp':                    { limit: 10, windowMs: 60_000 },
  '/api/claim/mark-claimed':            { limit: 20, windowMs: 60_000 },
  '/api/claim/sol':                     { limit: 10, windowMs: 60_000, method: 'GET' },
  '/api/claim':                         { limit: 10, windowMs: 60_000, method: 'GET' },
  '/api/referral/apply':                { limit: 10, windowMs: 60_000 },
}

function getClientIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

async function checkUpstash(
  key: string,
  rule: RuleConfig
): Promise<boolean> {
  const { Ratelimit } = await import('@upstash/ratelimit')
  const { Redis } = await import('@upstash/redis/cloudflare')

  const redis = new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })

  const windowSec = Math.ceil(rule.windowMs / 1000)
  const limiter = new Ratelimit({
    redis,
    limiter:        Ratelimit.slidingWindow(rule.limit, `${windowSec} s`),
    prefix:         'mw_rl',
    ephemeralCache: new Map(),
  })

  const { success } = await limiter.limit(key)
  return !success
}

interface WindowEntry { count: number; resetTime: number }
const store = new Map<string, WindowEntry>()
let cleanupCounter = 0

function maybeCleanup() {
  if (++cleanupCounter % 500 !== 0) return
  const now = Date.now()
  for (const [k, e] of store.entries()) {
    if (e.resetTime < now) store.delete(k)
  }
}

function checkMemory(key: string, rule: RuleConfig): boolean {
  maybeCleanup()
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetTime < now) {
    store.set(key, { count: 1, resetTime: now + rule.windowMs })
    return false
  }

  entry.count++
  return entry.count > rule.limit
}

export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname
  const rule = RATE_LIMITS[pathname]

  if (!rule) return NextResponse.next()

  const targetMethod = rule.method ?? 'POST'
  if (targetMethod !== 'ANY' && req.method !== targetMethod) return NextResponse.next()

  const ip = getClientIP(req)
  const key = `${ip}:${pathname}`

  let limited = false

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      limited = await checkUpstash(key, rule)
    } catch (err) {
      console.warn('[proxy] Upstash error, falling back to memory:', err)
      limited = checkMemory(key, rule)
    }
  } else {
    limited = checkMemory(key, rule)
  }

  if (limited) {
    return NextResponse.json(
      { error: 'too many requests', retry_after: Math.ceil(rule.windowMs / 1000) },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rule.windowMs / 1000)) },
      }
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/api/campaigns/swap-event',
    '/api/campaigns/sol-swap-event',
    '/api/campaigns/join',
    '/api/campaigns/refresh-score',
    '/api/swap/quote',
    '/api/wallet-link',
    '/api/agents/campaigns/record',
    '/api/agents/register',
    '/api/agents/mwp',
    '/api/claim/mark-claimed',
    '/api/claim/sol',
    '/api/claim',
    '/api/referral/apply',
  ],
}
