# Route Handler Factory (`createHandler`)

**File:** `lib/web2/routeHandler.ts`
**Status:** Complete — all `route.ts` files use `createHandler` (75 route files as of 2026-08-23; a couple of cron routes still read `NextResponse.json` directly — migrate when convenient).

## What It Does

`createHandler` is a factory that wraps every API route handler, injecting a `RouteContext` that eliminates per-route boilerplate:

| Concern | Before | After |
|---|---|---|
| Supabase client | `createSupabaseServiceClient()` in each route | `ctx.supabase` — module-level singleton |
| BigInt JSON | manual `toJsonSafe()` calls | `ctx.json()` — applied automatically |
| Request ID | none | `ctx.requestId` — UUID on every request |
| Logging | `console.log` | `ctx.log.info/warn/error` — bound to requestId |
| Auth | duplicated inline | declarative `auth` option |
| Rate limiting | scattered middleware | declarative `rateLimit` option |
| Error shape | inconsistent | `{ success: false, error, code }` always |

## Basic Usage

```ts
import { createHandler } from '@/lib/web2/routeHandler'

// Public GET — no auth
export const GET = createHandler(async (req, ctx) => {
  const { data } = await ctx.supabase.from('campaigns').select()
  return ctx.json({ campaigns: data })
})

// Authenticated POST — EIP-191 signed message
export const POST = createHandler(async (req, ctx) => {
  // ctx.user.address is guaranteed non-null here
  const body = await req.clone().json()  // clone because auth also reads body
  ctx.log.info('campaigns', 'Creating campaign', { address: ctx.user!.address })
  return ctx.json({ success: true })
}, { auth: 'signed-message' })

// Cron/webhook — bearer token (defaults to CRON_SECRET)
export const POST = createHandler(async (_req, ctx) => {
  return ctx.json({ ok: true })
}, { auth: 'bearer-token' })

// Custom bearer secret
export const POST = createHandler(async (_req, ctx) => {
  return ctx.json({ ok: true })
}, { auth: 'bearer-token', bearerSecret: CLAIM_MARK_SECRET })
```

## `RouteContext` Reference

| Field | Type | Description |
|---|---|---|
| `ctx.requestId` | `string` | UUID per request; appears as `X-Request-Id` response header |
| `ctx.supabase` | `SupabaseClient` | Service-role singleton — bypasses RLS. Server-only. |
| `ctx.log` | `BoundLogger` | `.info(tag, msg, meta?)` / `.warn(...)` / `.error(...)` |
| `ctx.user` | `{ address: string } \| undefined` | Set only when `auth: 'signed-message'` succeeds |
| `ctx.json(data, status?)` | `NextResponse` | BigInt-safe response with `X-Request-Id` header |

## `HandlerOptions` Reference

```ts
type HandlerOptions = {
  auth?: 'signed-message' | 'bearer-token' | 'none'  // default: 'none'
  bearerSecret?: string                               // default: CRON_SECRET
  rateLimit?: { max: number; windowMs: number }       // Upstash sliding window
  action?: string                                     // signed-message: bind the signed `action` tag
}
```

### Auth Modes

| Mode | Mechanism | `ctx.user` |
|---|---|---|
| `'none'` | No auth check | `undefined` |
| `'bearer-token'` | `Authorization: Bearer <secret>` | `undefined` |
| `'signed-message'` | EIP-191, 15-min window, recovers wallet | `{ address }` |

**Signed-message replay/action binding (audit MED).** The signed `authMessage` is canonical JSON
(`lib/web3/signedActionMessages.ts`) embedding `action` + `issuedAt`. The factory parses it and
requires the signed `issuedAt` to equal the freshness-checked body `issuedAt` (so a captured
signature can't be replayed with a fresh body timestamp) and — when the route passes `action:
'mintware-…'` — the signed `action` to match (so a signature for one action can't be replayed on
another). **Always pass `action` on a generic signed-message route.** Routes that do *inline* auth
(profile, vault deposit/withdraw, vaults/create, agents/mwp, wallet-link) already rebuild the exact
message server-side and strict-compare — the gold standard; keep doing that for domain-specific fields.

### Rate Limiting

- Keyed by **wallet address** when `auth: 'signed-message'`; by **IP** otherwise.
- Uses Upstash Redis sliding window. **Fails open** if `UPSTASH_REDIS_REST_URL` / `TOKEN` are unset.
- Rate limit instance created once at module load (not per request).

## Dynamic Route Segments (`[address]`, `[id]`, etc.)

App Router passes `params` as the second argument to route handlers. `createHandler` returns a
`(req: NextRequest) => Promise<NextResponse>` function — it doesn't accept params. Use a wrapper:

```ts
// app/api/(web3)/agents/[address]/route.ts
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params
  return createHandler(async (_req, ctx) => {
    // use `address` from outer closure
    const { data } = await ctx.supabase
      .from('ai_agent_scores')
      .select()
      .eq('address', address)
      .single()
    return ctx.json({ agent: data })
  })(req)
}
```

## Body Parsing — Clone Rule

**When `auth: 'signed-message'`**, the factory reads the request body to verify the signature.
Any handler that also needs to parse the body must clone first:

```ts
export const POST = createHandler(async (req, ctx) => {
  const body = await req.clone().json()  // ← clone required
  ...
}, { auth: 'signed-message' })
```

For `auth: 'none'` or `auth: 'bearer-token'`, cloning is optional (no prior body read).

## Routes That Do Manual Auth

Some routes implement their own multi-step auth (e.g. dual EVM + Ed25519 for `wallet-link`,
`buildVaultDepositMessage` for vault deposit). These use `auth: 'none'` and call
`recoverMessageAddress()` / `nacl.sign.detached.verify()` directly inside the handler.
`ctx.supabase`, `ctx.log`, and `ctx.json` are still used normally.

## Env Vars

All bearer secrets live in `lib/constants.ts` — never inline in routes:

| Constant | Env Var | Used By |
|---|---|---|
| `CRON_SECRET` | `CRON_SECRET` | All cron routes (default) |
| `CLAIM_MARK_SECRET` | `CLAIM_MARK_SECRET` | `/api/claim/mark-claimed` |
| `TRADE_SIGNAL_INGEST_SECRET` | `TRADE_SIGNAL_INGEST_SECRET` | `/api/universal/trade-signal` |
| `AI_ATTRIBUTION_ORACLE_SECRET` | `AI_ATTRIBUTION_ORACLE_SECRET` | `/api/agents/campaigns/record` |

## Supporting Infrastructure

| File | Purpose |
|---|---|
| `lib/web2/routeHandler.ts` | Factory — `createHandler`, `RouteContext`, `HandlerOptions` |
| `lib/web2/supabase.ts` | `getServiceClient()` — module-level Supabase singleton |
| `lib/logger.ts` | `bindLogger(requestId)` — returns `BoundLogger` |
| `lib/constants.ts` | All env vars + `toJsonSafe()` |
