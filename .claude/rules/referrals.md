# Referral System

## Supabase Tables

- `wallet_profiles` — `address`, `ref_code`, `last_seen_at`
- `referral_records` — `referrer`, `referred`, `ref_code`, `status` (`pending` | `active`)
- `referral_stats` — VIEW: `address`, `ref_code`, `ref_link`, `tree_size`, `tree_quality`, `sharing_score`

## ref_code Convention

**Deterministic** — `"mw_" + address.slice(2, 8).toLowerCase()`

Never depends on Supabase to compute it. `InviteTab` renders immediately from wallet address.

See also: basename-first ref codes via `lib/referral-code.ts` and `app/api/auth/connect`.

## `useReferral(address)` Hook Flow

1. Captures `?ref=` URL param → `sessionStorage["mw_pending_ref"]`
2. Upserts `wallet_profiles` on connect
3. If pending ref exists → calls `POST /api/referral/apply` (NOT direct Supabase insert)
4. Fetches `referral_stats` view
5. Subscribes to Supabase Realtime on `referral_records`

## Components

**`InviteTab`** — renders immediately from wallet address. Supabase stats load as enhancement. Never shows error state.

**`ReferralSheet`** — slides up 1.5s after first wallet connect. Dismissed state in `sessionStorage["mw_ref_sheet_dismissed"]` (not localStorage).

## API Routes

| Route | Notes |
|---|---|
| `GET /api/referral?address=` | Reads `referral_stats` (anon key) |
| `POST /api/referral/apply` | Server-gated — checks referrer `last_seen_at ≥ 24h`. Returns `referrer_too_new` if fresh. |

## Security Rules

- Browser client **never** writes directly to `referral_records` — always via `POST /api/referral/apply`
- 24h referrer time-gate prevents bots pre-seeding ref codes
- `sessionStorage` for ref sheet dismissed state (not `localStorage`)
