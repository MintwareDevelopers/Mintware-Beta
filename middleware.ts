// =============================================================================
// middleware.ts — Edge rate limiting for sensitive API endpoints
//
// Protects:
//   POST /api/campaigns/swap-event  — 10 req/min per IP
//   POST /api/campaigns/join        — 5  req/min per IP
//   POST /api/swap/quote            — 20 req/min per IP
//
// Implementation note: In-memory sliding window. Serverless instances don't
// share memory so this limits burst within a single instance (still effective
// against simple bots). For full cross-instance rate limiting, replace the
// store with Upstash Redis (@upstash/ratelimit).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'

interface WindowEntry {
  count:     number
  resetTime: number
}

// In-memory store — shared across requests on the same serverless instance
const store = new Map<string, WindowEntry>()

// Clean up expired entries every 500 requests to prevent unbounded growth
let cleanupCounter = 0
function maybeCleanup() {
  cleanupCounter++
  if (cleanupCounter % 500 !== 0) return
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (entry.resetTime < now) store.delete(key)
  }
}

/**
 * Returns true if the request should be rate-limited (limit exceeded).
 * @param key      Unique key (IP + route)
 * @param limit    Max requests allowed per window
 * @param windowMs Window size in milliseconds
 */
function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  maybeCleanup()
  const now     = Date.now()
  const entry   = store.get(key)

  if (!entry || entry.resetTime < now) {
    store.set(key, { count: 1, resetTime: now + windowMs })
    return false
  }

  entry.count++
  if (entry.count > limit) return true

  return false
}

// Route → { limit, windowMs }
const RATE_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  '/api/campaigns/swap-event': { limit: 10, windowMs: 60_000 },
  '/api/campaigns/join':       { limit:  5, windowMs: 60_000 },
  '/api/swap/quote':           { limit: 20, windowMs: 60_000 },
}

function getClientIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname
  const rule     = RATE_LIMITS[pathname]

  if (!rule) return NextResponse.next()
  if (req.method !== 'POST') return NextResponse.next()

  const ip  = getClientIP(req)
  const key = `${ip}:${pathname}`

  if (isRateLimited(key, rule.limit, rule.windowMs)) {
    return NextResponse.json(
      { error: 'too many requests', retry_after: Math.ceil(rule.windowMs / 1000) },
      {
        status:  429,
        headers: { 'Retry-After': String(Math.ceil(rule.windowMs / 1000)) },
      }
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/api/campaigns/swap-event',
    '/api/campaigns/join',
    '/api/swap/quote',
  ],
}
