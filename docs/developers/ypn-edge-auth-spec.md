# YPN Edge-Auth Engine — spec

> The head of the YPN off-chain pipeline: answer a card authorization in **<150 ms** off a cached
> vault NAV, without touching the chain in the hot path. Rust service. This doc + the `services/edge-auth`
> crate are increment 1 — the **authorization decision core** (pure risk logic + tests). HTTP (axum),
> Redis-backed holds, on-chain NAV refresh, and the EDGE_SIGNER are the next increments.

## The flow (where this sits)

```
card swipe ─▶ Rain ─▶ POST /authorize {user, amountUSDC, ...}
                         │  (edge, <150ms, no chain call)
                         ├─ read cached NAV + user shares + active holds + daily spend
                         ├─ compute AVAILABLE, decide APPROVE / DECLINE
                         └─ on APPROVE: create a HOLD (Redis, TTL) ─▶ return {approved, holdId}
                                                     │
capture ─▶ Rain webhook ─▶ relayer ─▶ gateway.settleSpend(hold) ─▶ burnForPayment ─▶ USDC to rail
                                                     └─ hold marked settled; expired holds auto-release
```

The edge NEVER moves funds — it only reserves spending capacity (a hold). Settlement is the on-chain
Gateway (already live on testnet), driven later by the relayer.

## The availability model (the crux — `ledger.rs`)

The user's equity is their vault shares valued at the **cached** NAV, using the *same* price-free math
as `MintwareYieldVault` (symmetric virtual offset `V`):

```
equity_usdc = shares · (total_assets + V) / (total_shares + V)          // convertToAssets, floor
```

A charge is approved only if it clears **all** of these (each is a distinct decline reason):

| Gate | Rule | Why |
|---|---|---|
| Amount | `amount > 0` | reject dust/zero |
| **Per-user equity** | `amount ≤ equity_usdc − user_active_holds` | can't spend more than you hold |
| **Daily cap** | `amount ≤ daily_cap − daily_spent` | mirrors Gateway `_checkAndUpdateDailyLimit` |
| **Global liquidity** | `amount ≤ idle_buffer − total_active_holds` | every hold must be settleable; Gateway settle reverts if `vault.idleBuffer() < assets` |

`available = min(equity − user_holds, daily_cap − daily_spent, idle_buffer − total_holds)`.
Approve ⟺ `0 < amount ≤ available`. On approve, a hold of `amount` is created (reducing both the
user's and the global available until it settles or its TTL expires).

## Hold lifecycle

`created → (settled | expired | cancelled)`. A hold reserves `amount` against availability for its TTL
(default 10 min, matching the Gateway hold window). Settlement (relayer) flips it `settled`; TTL lapse
auto-releases it (Redis expiry). `holdId` is the same key the Gateway settles under.

## NAV freshness (`nav.rs`)

The cache holds `{total_assets, total_shares, virtual_offset, idle_buffer, observed_at}` refreshed from
chain on an interval (next increment). The hot path reads it in O(1). A **staleness guard** declines
(fails safe) if the snapshot is older than `max_nav_age` — better to decline than authorize against a
stale NAV. NAV is price-free (single-asset USDC vault), so it only rises with yield absent an Aave loss.

## Increments

1. **(this)** `services/edge-auth` crate — `nav` + `ledger` decision core + types, pure, unit-tested. No I/O.
2. axum server: `/authorize`, `/health`, `/holds/:id`; wire the ledger behind it.
3. Redis hold store + per-user daily-spend counters (atomic reserve/release).
4. On-chain NAV refresher (poll vault `totalAssets`/`totalShares`/`idleBuffer`) + staleness guard.
5. EDGE_SIGNER: sign `ShortLivedHoldAuth` for ≥$250 charges (the Gateway's high-value branch).
6. Relayer + Rain webhooks (separate crates), then E2E against the live testnet Gateway.
