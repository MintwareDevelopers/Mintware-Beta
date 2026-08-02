# API

## Base URL

```ts
export const API = 'https://attribution-scorer.ceo-1f9.workers.dev'
```

Import from `lib/web2/api.ts` — **never hardcode**.

## Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `GET /campaigns` | GET | All campaigns |
| `GET /campaign?id=&address=` | GET | Single campaign + participant data |
| `POST /join` | POST | Join a campaign `{ campaign_id, address }` |
| `GET /leaderboard?campaign_id=` | GET | Leaderboard for a campaign |
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
| `/api/swap/best-route` | POST | Best-execution meta-router — MW V4 pool (via V4 quoter + `router_pools` registry) vs LI.FI; returns the winning route. Flag-gated (`NEXT_PUBLIC_MW_ROUTER_ENABLED`), fail-safe to LI.FI. See `lib/web2/router/`. |
| `/api/swap/quote` | POST | LI.FI proxy — legacy/unused (live LI.FI quote runs client-side in `lib/web2/providers/lifi.ts`) |
| `/api/campaigns/swap-event` | POST | On-chain tx verification before reward credit (LI.FI **and** `MWRouter` allowlisted) |
| `/api/claim` | POST | Merkle proof + oracle sig — fetches `deadline` from DB |
| `/api/claim/status` | GET | Returns `deadline` in distribution shape |
| `/api/claim/mark-claimed` | POST | Bearer-auth — marks pending_rewards as claimed |
| `/api/agents/leaderboard` | GET | AI agent leaderboard |
| `/api/agents/[address]/pending` | GET | Pending actions for agent address |
| `/api/eas/attest-score` | POST | EAS offchain score attestation |
| `/api/eas/attest-reward` | POST | EAS offchain reward attestation |
| `/api/auth/connect` | POST | Wallet connect + basename ref code resolution |
| `/api/waitlist` | POST | Waitlist signup → `waitlist` Supabase table |
| `/api/vaults/deals` | GET | Approved RWA deals for the campaign creator surface picker (R1) |
