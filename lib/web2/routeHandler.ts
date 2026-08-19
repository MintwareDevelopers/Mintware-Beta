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
import { timingSafeEqual } from 'node:crypto'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { recoverMessageAddress } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { bindLogger, BoundLogger } from '@/lib/logger'
import { toJsonSafe } from '@/lib/constants'

// Constant-time string compare for bearer secrets — avoids the per-character early-out of `!==`
// that leaks token bytes via timing (audit LOW). Length mismatch is not the secret's protected
// property, so an early false there is fine.
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

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
   *   'bearer-token'   — Authorization: Bearer <secret> (cron jobs, webhooks)
   *   'none'           — No auth (read-only public endpoints)
   */
  auth?: AuthMode

  /**
   * Override the bearer secret for 'bearer-token' auth.
   * Defaults to CRON_SECRET. Use for routes that need a different secret
   * (e.g. CLAIM_MARK_SECRET for mark-claimed, SWAP_WEBHOOK_SECRET for webhooks).
   */
  bearerSecret?: string

  /**
   * Upstash rate limiting. Key is derived automatically:
   *   'signed-message' routes — keyed by recovered wallet address
   *   All other routes        — keyed by IP (x-forwarded-for)
   * Fails open if UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are unset.
   */
  rateLimit?: RateLimitConfig

  /**
   * For `auth: 'signed-message'` only. The expected `action` tag inside the signed message
   * (e.g. 'mintware-referral-apply'). When set, the factory verifies the signed payload's
   * `action` matches — binding the signature to THIS route so a signature captured for one
   * action can't be replayed against another. Strongly recommended for every signed-message route.
   */
  action?: string
}

// ---------------------------------------------------------------------------
// Error shape
// ---------------------------------------------------------------------------

type ApiError = { success: false; error: string; code?: string }

// ---------------------------------------------------------------------------
// Upstash Redis — module-level singleton (connection reused across requests)
// ---------------------------------------------------------------------------

let _redis: Redis | null = null
let _redisResolved = false

function getRedis(): Redis | null {
  if (_redisResolved) return _redis
  _redisResolved = true
  // Accept BOTH the Upstash-native var names and the Vercel KV / Marketplace names. The old
  // `Redis.fromEnv()` reads ONLY `UPSTASH_REDIS_REST_URL`/`_TOKEN`, so a project provisioned
  // through Vercel KV (which injects `KV_REST_API_URL`/`_TOKEN`) silently fell open — every
  // declared limit became a no-op. Read explicitly so provisioning method doesn't matter.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.KV_REST_API_URL ??
    process.env.STORAGE_REST_API_URL
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.KV_REST_API_TOKEN ??
    process.env.STORAGE_REST_API_TOKEN
  if (url && token) {
    try {
      _redis = new Redis({ url, token })
      // Observable on cold start — grep Vercel logs for this line instead of probing.
      console.info('[routeHandler] rate limiter ACTIVE — Redis configured')
    } catch (err) {
      _redis = null
      console.warn('[routeHandler] rate limiter INACTIVE — Redis init failed:', String(err))
    }
  } else {
    _redis = null
    console.warn(
      '[routeHandler] rate limiter INACTIVE — no Redis env found ' +
        '(set UPSTASH_REDIS_REST_URL/_TOKEN or KV_REST_API_URL/_TOKEN). Declared limits are no-ops.'
    )
  }
  return _redis
}

// ---------------------------------------------------------------------------
// createHandler
// ---------------------------------------------------------------------------

export function createHandler(
  fn: (req: NextRequest, ctx: RouteContext) => Promise<NextResponse>,
  opts: HandlerOptions = {}
) {
  const { auth = 'none', rateLimit, action: expectedAction } = opts

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
    // Request-size guard — cheap DoS hardening. Reject an oversized body up front,
    // before any parsing/auth. No JSON API route here legitimately exceeds 256 KB.
    // (Content-Length can be absent for chunked bodies; the platform caps those.)
    // -------------------------------------------------------------------------
    const MAX_BODY_BYTES = 256 * 1024
    const contentLength = Number(req.headers.get('content-length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      log.warn('request', 'Body too large', { contentLength })
      return errorResponse('Payload too large', 413, 'PAYLOAD_TOO_LARGE')
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
      // Read the default secret from process.env at REQUEST time, not from a
      // module-load constant — otherwise env changes (incl. tests setting it in
      // beforeEach) never take effect. Prod sets CRON_SECRET before load, so no
      // behavior change there. An explicit opts.bearerSecret still wins.
      const secret = opts.bearerSecret ?? process.env.CRON_SECRET ?? ''
      const header = req.headers.get('authorization')
      if (!secret) {
        if (process.env.NODE_ENV !== 'development') {
          log.error('auth', 'Bearer secret env var not set in production')
          return errorResponse('Server misconfigured', 500, 'MISSING_SECRET')
        }
        // In development with no secret set — allow through
      } else if (!constantTimeEqual(header ?? '', `Bearer ${secret}`)) {
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

      // Bind the freshness-checked issuedAt (and the action) to the SIGNATURE. The signed message
      // is canonical JSON (see lib/web3/signedActionMessages.ts) that embeds `issuedAt` and
      // `action`. Without this, the body's issuedAt is unbound from the signature, so a captured
      // signature replays forever with a fresh body issuedAt, and across any route (audit MED:
      // signed-message replay / no action binding). We require the signed payload's issuedAt to
      // equal the freshness-checked body issuedAt, and — when the route declares one — its action.
      let signedPayload: Record<string, unknown>
      try {
        signedPayload = JSON.parse(authMessage as string)
      } catch {
        return errorResponse('Malformed signed authorization', 401, 'AUTH_MALFORMED')
      }
      if (signedPayload.issuedAt !== issuedAt) {
        log.warn('auth', 'Signed issuedAt does not match body issuedAt (replay guard)')
        return errorResponse('Authorization payload mismatch', 401, 'AUTH_MISMATCH')
      }
      if (expectedAction && signedPayload.action !== expectedAction) {
        log.warn('auth', 'Signed action does not match route (cross-action replay guard)', {
          expected: expectedAction, got: signedPayload.action,
        })
        return errorResponse('Authorization payload mismatch', 401, 'AUTH_MISMATCH')
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
      // Lazy: instantiate the service client only when a handler actually reads
      // ctx.supabase. Routes that never touch the DB (e.g. some cron pipelines)
      // don't pay for it — and don't need Supabase env set in tests. Backed by
      // the same memoized singleton, so repeated access is cheap.
      get supabase() { return getServiceClient() },
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
