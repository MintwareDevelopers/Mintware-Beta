# API

## Base URL

```ts
export const API = 'https://attribution-scorer.ceo-1f9.workers.dev'
```

Import from `lib/web2/api.ts` — **never hardcode**.

## Endpoints

> ⛔ **Campaigns shelved (2026-08-12).** The campaign worker endpoints (`GET /campaigns`,
> `GET /campaign`, `POST /join`, `GET /leaderboard?campaign_id=`) were retired with the campaign
> surface — do not treat them as live. Only `/score` remains in use (via `scoreApiUrl()`).

| Endpoint | Method | Description |
|---|---|---|
| `GET /score?address=` | GET | Full Attribution score profile |

## `/score` Response Shape

```json
{
  "score": 149,
  "tier": "bronze",
  "percentile": 12,
  "walletAge": "117 months",
  "firstSeen": "Jun 2016",
  "chains": 2,
  "totalTxCount": 168,
  "treeSize": 0,
  "treeQuality": "0.00",
  "totalLo": 710,
  "totalHi": 3250,
  "signals": [
    { "key": "volume",     "name": "Volume",     "icon": "⇄", "max": 100, "color": "#3A52CC", "score": 41, "insights": [] },
    { "key": "trading",    "name": "Trading",    "icon": "◈", "max": 75,  "color": "#6B8FFF", "score": 24, "insights": [] },
    { "key": "holding",    "name": "Holding",    "icon": "◆", "max": 100, "color": "#2A9E8A", "score": 39, "insights": [] },
    { "key": "liquidity",  "name": "Liquidity",  "icon": "⬡", "max": 150, "color": "#C27A00", "score": 0,  "insights": [] },
    { "key": "governance", "name": "Governance", "icon": "⊕", "max": 100, "color": "#7B6FCC", "score": 0,  "insights": [] },
    { "key": "sharing",    "name": "Sharing",    "icon": "◉", "max": 400, "color": "#C2537A", "score": 0,  "insights": [] }
  ],
  "character": { "label": "Ghost", "color": "#9898C0", "desc": "...", "icon": "○" },
  "uvOpportunities": [{ "name": "Jupiter", "cat": "Aggr · Solana", "lo": 110, "hi": 500 }],
  "timeline": [{ "date": "2025-04", "score": 40, "events": [] }],
  "projects": [{ "name": "Ether", "symbol": "ETH", "cat": "Token", "deployed": 40 }]
}
```

**Max score** = 100+75+100+150+100+400 = **925**
**Tier strings**: `"bronze"`, `"silver"`, `"gold"` — capitalize for display.

## Shared Helpers (`lib/web2/api.ts`)

| Helper | Usage |
|---|---|
| `fmtUSD(n)` | `$2.7k`, `$1.2M` |
| `daysUntil(iso)` | Days remaining from ISO date |
| `shortAddr(addr)` | `0x1234…abcd` |
| `iconColor(name)` | Deterministic `{ bg, fg }` palette from string |

## Route Handler Pattern

All internal API routes use the `createHandler` factory — see `.claude/rules/route-handler.md` for the full reference. Key points:
- Use `ctx.supabase` (singleton), `ctx.log`, `ctx.json()` (BigInt-safe) inside every handler
- Declare auth + rate limits as options: `{ auth: 'signed-message', rateLimit: { max: 10, windowMs: 60_000 } }`
- Never call `createSupabaseServiceClient()` or `NextResponse.json()` directly in routes

## Internal API Routes

| Route | Method | Notes |
|---|---|---|
| `/api/referral` | GET | `?address=` reads `referral_stats` |
| `/api/referral/apply` | POST | Server-gated referral insert — 24h time-gate |
| `/api/swap/quote` | POST | LI.FI proxy (hides API key, injects fee) |
| `/api/swap/best-route` | POST | MW meta-router quote (flag-gated; falls back to LI.FI) |
| `/api/agents/leaderboard` | GET | AI agent leaderboard |
| `/api/agents/[address]/pending` | GET | Pending actions for agent address |
| `/api/auth/connect` | POST | Wallet connect + basename ref code resolution |
| `/api/waitlist` | POST | Waitlist signup → `waitlist` Supabase table |

> ⛔ **Shelved with the campaign surface (2026-08-12) — these routes no longer exist:**
> `/api/campaigns/swap-event`, `/api/claim`, `/api/claim/status`, `/api/claim/mark-claimed`,
> `/api/eas/attest-reward`. The live rewards path is the universal pipeline
> (`app/api/(rewards)/cron/universal-*`, `/api/universal/trade-signal`) + the vault-weighted
> epoch rails (`/api/vault/weighted-claim`). See `.claude/STATE.md`.
>
> ⛔ **Removed 2026-08-28 with the human-facing Attribution surface:** `/api/eas/attest-score`
> (score-specific EAS attestation — `AttestationBadge` was its only caller, also removed). The
> general offchain-attestation plumbing (`lib/eas.ts`) stays — `attestOrgMembership` still uses
> it — only the score-attestation route/UI is gone. See memory `attribution_review_2026_08_28`.
| `/api/benchmarks/yields` | GET | Live yield benchmarks for `/the-math` — curated real pools from DefiLlama (`apyBase` only), 1h module-memo, fails soft `{ok:false}`. No auth. |
