// =============================================================================
// lib/web2/routeHandler.ts — Unified route handler factory
//
// Eliminates boilerplate duplicated across 57 routes:
//   - Auth (signed-message EIP-191, bearer-token, none)
//   - Rate limiting (Upstash sliding window, fails open if unconfigured)
//   - BigInt-safe JSON serialization
//   - Standardized error shape { success: false, error, code }
//   - X-Request-Id header on every response
//   - Structured logging bound to requestId
//   - Supabase singleton injected via context
//
// Usage:
//
//   export const POST = createHandler(async (req, ctx) => {
//     const body = await req.json()
//     const { data } = await ctx.supabase.from('campaigns').select()
//     ctx.log.info('campaigns', 'Fetched campaigns', { count: data?.length })
//     return ctx.json({ campaigns: data })
//   }, { auth: 'signed-message', rateLimit: { max: 10, windowMs: 60_000 } })
//
//   export const GET = createHandler(async (req, ctx) => {
//     return ctx.json({ ok: true })
//   }, { auth: 'bearer-token' })
//
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { recoverMessageAddress } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { bindLogger, BoundLogger } from '@/lib/logger'
import { CRON_SECRET, toJsonSafe } from '@/lib/constants'

// ---------------------------------------------------------------------------
// RouteContext — injected into every handler
// ---------------------------------------------------------------------------

export type RouteContext = {
  /** Unique per-request UUID. Appears as X-Request-Id response header. */
  requestId: string

  /** Supabase service-role singleton — bypasses RLS. Never use in client code. */
  supabase: ReturnType<typeof getServiceClient>

  /** Structured logger pre-bound to requestId. Use instead of console.log. */
  log: BoundLogger

  /**
   * Authenticated user. Populated only when auth: 'signed-message' succeeds.
   * Guaranteed non-null inside handlers that use signed-message auth.
   */
  user?: { address: string }

  /**
   * BigInt-safe JSON response helper. Use instead of NextResponse.json().
   * Automatically:
   *   - Serializes BigInt values to strings
   *   - Attaches X-Request-Id header
   */
  json: <T>(data: T, status?: number) => NextResponse
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type AuthMode = 'signed-message' | 'bearer-token' | 'none'

export type RateLimitConfig = {
  /** Maximum requests allowed within the window */
  max: number
  /** Window size in milliseconds */
  windowMs: number
}

export type HandlerOptions = {
  /**
   * Auth mode:
   *   'signed-message' — EIP-191 signed message, 15-min window, recovers wallet address
   *   'bearer-token'   — Authorization: Bearer <CRON_SECRET> (cron jobs)
   *   'none'           — No auth (read-only public endpoints)
   */
  auth?: AuthMode

  /**
   * Upstash rate limiting. Key is derived automatically:
   *   'signed-message' routes — keyed by recovered wallet address
   *   All other routes        — keyed by IP (x-forwarded-for)
   * Fails open if UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are unset.
   */
  rateLimit?: RateLimitConfig
}

// ---------------------------------------------------------------------------
// Error shape
// ---------------------------------------------------------------------------

type ApiError = { success: false; error: string; code?: string }

// ---------------------------------------------------------------------------
// Upstash Redis — module-level singleton (connection reused across requests)
// ---------------------------------------------------------------------------

let _redis: Redis | null = null

function getRedis(): Redis | null {
  if (_redis) return _redis
  try {
    _redis = Redis.fromEnv()
    return _redis
  } catch {
    // UPSTASH_REDIS_REST_URL / TOKEN not set — rate limiting disabled
    return null
  }
}

// ---------------------------------------------------------------------------
// createHandler
// ---------------------------------------------------------------------------

export function createHandler(
  fn: (req: NextRequest, ctx: RouteContext) => Promise<NextResponse>,
  opts: HandlerOptions = {}
) {
  const { auth = 'none', rateLimit } = opts

  // Ratelimit instance created once per handler at module load (not per request).
  // Redis connection is the shared singleton above.
  const rl = rateLimit
    ? (() => {
        const redis = getRedis()
        if (!redis) return null
        return new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(rateLimit.max, `${rateLimit.windowMs}ms`),
          prefix: 'mw_rl',
        })
      })()
    : null

  return async (req: NextRequest): Promise<NextResponse> => {
    const requestId = crypto.randomUUID()
    const log = bindLogger(requestId)

    // Helpers scoped to this request
    const makeResponse = <T>(data: T, status = 200): NextResponse =>
      NextResponse.json(toJsonSafe(data), {
        status,
        headers: { 'X-Request-Id': requestId },
      })

    const errorResponse = (error: string, status: number, code?: string): NextResponse => {
      const body: ApiError = { success: false, error, ...(code ? { code } : {}) }
      return NextResponse.json(body, {
        status,
        headers: { 'X-Request-Id': requestId },
      })
    }

    // -------------------------------------------------------------------------
    // Rate limiting
    // -------------------------------------------------------------------------

    if (rl) {
      const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
      try {
        const { success } = await rl.limit(ip)
        if (!success) {
          log.warn('ratelimit', 'Rate limit exceeded', { ip })
          return errorResponse('Too many requests', 429, 'RATE_LIMITED')
        }
      } catch (err) {
        // Fail open — Upstash unavailable should never block legitimate traffic
        log.warn('ratelimit', 'Rate limit check failed, failing open', { err: String(err) })
      }
    }

    // -------------------------------------------------------------------------
    // Auth
    // -------------------------------------------------------------------------

    let user: { address: string } | undefined

    if (auth === 'bearer-token') {
      const header = req.headers.get('authorization')
      if (!CRON_SECRET) {
        if (process.env.NODE_ENV !== 'development') {
          log.error('auth', 'CRON_SECRET not set in production')
          return errorResponse('Server misconfigured', 500, 'MISSING_SECRET')
        }
        // In development with no secret set — allow through
      } else if (header !== `Bearer ${CRON_SECRET}`) {
        log.warn('auth', 'Bearer token mismatch')
        return errorResponse('Unauthorized', 401, 'UNAUTHORIZED')
      }
    }

    if (auth === 'signed-message') {
      let body: Record<string, unknown>
      try {
        // Clone so the original request body is still readable in fn()
        body = await req.clone().json()
      } catch {
        return errorResponse('Invalid JSON', 400, 'INVALID_JSON')
      }

      const { authMessage, authSignature, issuedAt, address } = body

      if (!authMessage || !authSignature || typeof issuedAt !== 'number' || !address) {
        return errorResponse('Signed authorization required', 401, 'AUTH_REQUIRED')
      }

      if (Math.abs(Date.now() - (issuedAt as number)) > 15 * 60 * 1000) {
        return errorResponse('Authorization expired', 401, 'AUTH_EXPIRED')
      }

      try {
        const recovered = await recoverMessageAddress({
          message: authMessage as string,
          signature: authSignature as `0x${string}`,
        })
        if (recovered.toLowerCase() !== (address as string).toLowerCase()) {
          log.warn('auth', 'Signature recovered address mismatch', { claimed: address })
          return errorResponse('Invalid signature', 401, 'INVALID_SIG')
        }
        user = { address: (address as string).toLowerCase() }

        // Re-key rate limiter to wallet address now that we have it
        if (rl) {
          try {
            const { success } = await rl.limit(`addr:${user.address}`)
            if (!success) {
              log.warn('ratelimit', 'Per-address rate limit exceeded', { address: user.address })
              return errorResponse('Too many requests', 429, 'RATE_LIMITED')
            }
          } catch (err) {
            log.warn('ratelimit', 'Per-address rate limit check failed, failing open', { err: String(err) })
          }
        }
      } catch {
        return errorResponse('Signature verification failed', 401, 'SIG_FAILED')
      }
    }

    // -------------------------------------------------------------------------
    // Inner handler
    // -------------------------------------------------------------------------

    const ctx: RouteContext = {
      requestId,
      supabase: getServiceClient(),
      log,
      user,
      json: makeResponse,
    }

    try {
      return await fn(req, ctx)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('handler', 'Unhandled error in route handler', { error: message })
      return errorResponse(message, 500, 'INTERNAL_ERROR')
    }
  }
}
