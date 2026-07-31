# Security (MintGuard)

## Hardening Checklist

| # | Item | Status |
|---|---|---|
| 1 | Source maps off in production | ✅ `productionBrowserSourceMaps: false` in `next.config.mjs` |
| 2 | CSP headers + `frame-ancestors: none` | ✅ `next.config.mjs` |
| 3 | LI.FI quote proxy | ✅ `POST /api/swap/quote` — API key server-only, fee server-injected |
| 4 | On-chain tx verification | ✅ `verifySwapTx()` in `swap-event/route.ts` |
| 5 | Fee enforcement in calldata | ✅ Treasury must appear in `tx.input` |
| 6 | Rate limiting | ⚠️ Declarative `createHandler` `rateLimit` (Upstash). **Fails OPEN — `UPSTASH_REDIS_REST_URL`/`_TOKEN` unset in prod → limits currently INACTIVE.** Old `middleware.ts` limiter removed in 2026-04-07 route-handler migration (no `middleware.ts` exists). |
| 7 | Referral time-gate | ✅ `POST /api/referral/apply` — referrer ≥ 24h old |
| 8 | sessionStorage for ref sheet | ✅ not localStorage |
| 9 | Server component migration | ⏸ Phase 2 |
| 10 | Bot farming / Sybil resistance | ⏸ Campaign hardening sprint |

## Rate Limits (`createHandler` `rateLimit` option)

Rate limiting is declared per-route via the `createHandler` factory's `rateLimit: { max, windowMs }`
option (`lib/web2/routeHandler.ts`), keyed by wallet address (signed-message routes) or IP,
using an Upstash Redis sliding window.

⚠️ **Currently INACTIVE in production.** `createHandler` **fails open** when
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are unset — and they are unset in Vercel.
Set both to activate. There is **no `middleware.ts`** — the old in-memory limiter was removed in
the 2026-04-07 route-handler migration.

Representative declared limits (advisory until Upstash is set):

| Route | Key | Limit |
|---|---|---|
| `POST /api/campaigns/swap-event` | IP | 10 req/min |
| `POST /api/campaigns/join` | IP | 5 req/min |
| `POST /api/swap/quote` | IP | 20 req/min |
| `POST /api/claim` | address + IP | 10/min + 30/min |

## LI.FI Quote Proxy

- Client → `POST /api/swap/quote` (NOT `li.quest` directly)
- Server injects `fee: 0.005` + `referrer: MINTWARE_TREASURY_ADDRESS`
- If user strips fee before `executeRoute()`, calldata check in `swap-event` denies reward: `skip_reason: 'fee_not_paid'`

## `verifySwapTx()` Checks

1. `eth_getTransactionReceipt` — tx must exist and `status === 0x1`
2. `receipt.from === wallet` — prevents wallet spoofing
3. `tx.to` must be in `LIFI_ROUTERS` set (multiple known routers — not single address)
4. Treasury address in `tx.input` — matches 40-char raw AND 64-char ABI-padded forms
5. `campaigns.closed` flag checked in addition to `status !== 'live'`
- Fail-open on RPC error (logs warning, allows through)
- `skip_reason: 'router_mismatch'` returned when `tx.to` not in router set

## Referral Security

- Browser never writes to `referral_records` directly
- All inserts via `POST /api/referral/apply` — server-side 24h time-gate

## Mark-Claimed

- `POST /api/claim/mark-claimed` — requires Bearer token (`CLAIM_MARK_SECRET`)

## `pending_rewards` Anti-Abuse

- Unique index: `(campaign_id, tx_hash, reward_type)` — campaign-scoped prevents double-crediting
- `amount_usd` capped at $10k per reward
