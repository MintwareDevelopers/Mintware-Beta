# API reference

Internal routes use the `createHandler` factory; see [`route-handler.md`](route-handler.md). Route inventory is
generated in [`../STATE.md`](../STATE.md) and must not be copied by hand.

## Current MarketEngine endpoints

The legacy `/api/gateway/*` route prefix remains for compatibility. These routes now serve Discover, curation,
registry, and MarketEngine activity; they are not the retired LP Gateway contracts or automation.

- `GET /api/gateway/discover` — GeckoTerminal candidate feed with risk ranking. Scores rank candidates; they do
  not certify them.
- `GET /api/gateway/instances`, `GET /api/gateway/meta` — curated instance and configuration reads.
- `GET /api/gateway/position`, `GET /api/gateway/positions` — on-chain MarketEngine share/position reads.
- `POST /api/gateway/deposit`, `POST /api/gateway/withdraw` — receipt-verified transaction event recording for
  on-chain MarketEngine actions.
- `POST /api/gateway/curate` — curator actions and MarketEngine registration.
- `GET /api/gateway/sparklines` — pool chart data.
- `POST /api/gateway/position` returns `410 buffer_not_supported`.

There is no `/v1/portfolio` or `/v1/leaderboard` endpoint. The old stage/deploy/harvest/compound/restake routes,
cost-basis RPCs, fee ledger, and associated crons were retired. Discover refresh remains scheduled; see
[`deployments.md`](deployments.md).

## Other APIs

- Public Attribution scoring is served through `/api/attribution/score-v2`; AI-agent routes are listed in the
  generated route inventory.
- Referral, swap, rewards, organization, RWA-demo, and x402 routes are implemented under `app/api/`.
- Former campaign worker endpoints and legacy LP Gateway portfolio surfaces are not current APIs.

## Supabase and handlers

Use `ctx.supabase`, `ctx.log`, and `ctx.json()` inside route handlers. Declare auth and rate limits through
`createHandler` options; do not instantiate a service client or `NextResponse.json()` directly in a route.
Current retained MarketEngine tables are `gateway_instances`, `gateway_instance_history`,
`gateway_pool_requests`, and `market_engine_tx_events`; retired Gateway position, fee, alert, snapshot, and
cost-basis tables were dropped. See [`schema.md`](schema.md).
