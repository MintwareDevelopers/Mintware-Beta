# Campaigns — SHELVED (2026-08-12)

The **Campaigns** product (reward pools + points campaigns) was removed from the Mintware
platform on 2026-08-12. Mintware's live surface is reputation-first DeFi: **Attribution**
(scoring), **Vaults** (reputation-weighted V4 LP), plus **Swap** and the **Leaderboard** as
reputation utilities. Referrals and the `universal/*` reward-settlement rail were **kept**.

This is a **shelf, not a delete** — every line of campaign code and all campaign data are
preserved and recoverable.

## Where the work is preserved

- **Archive branch:** `archive/campaigns-surface` — pinned at `main@30b77c62` (the last commit
  before removal). It contains the *entire* campaign engine, UI, API, contracts, and tests exactly
  as they were live. To read or restore any part, check out that branch.
- **Git history:** the removal PRs (#177+) show precisely what was removed, file by file.
- **Supabase data:** the campaign tables were **NOT dropped** (see below) — historical rows remain.

## What Campaigns were

Two campaign types (full spec preserved on the archive branch under `.claude/rules/rewards.md`):

| | Token Reward Pool | Points Campaign |
|---|---|---|
| Created by | Anyone (self-serve) | Whitelisted teams |
| Reward trigger | Per swap transaction | Per epoch distribution |
| Score multipliers | No | Yes (Attribution × Sharing, max 1.95×) |
| Pool | Depletes until empty | Fixed, epoch-split |

Epoch payout: `wallet_payout = (epoch_pool / epoch_count) × (wallet_points / total_points) × combined_multiplier`.

## File inventory (all on `archive/campaigns-surface`)

**Pages:** `app/app/rewards/`, `app/app/create-campaign/`, `app/app/manage/[campaign_id]/`,
`app/(rewards)/campaign/[id]/`.
**Components:** `components/rewards/campaigns/*` (CampaignCard, CampaignHeader, ClaimCard,
ActionsPanel, JoinButton, Leaderboard, ParticipantStats), `components/rewards/creator/*`
(5-step campaign builder), `components/rewards/swap/CampaignBanner.tsx` + `RewardPreview.tsx`.
**API:** `app/api/(rewards)/campaigns/*` (create/join/manage/mine/participant/refresh-score/swap-event),
`app/api/(rewards)/claim/*` (claim/status/mark-claimed), `app/api/(web3)/agents/campaigns/*`,
`app/api/(rewards)/cron/epoch-end`, `.../cron/pool-settle`, `.../eas/attest-reward`,
`app/api/(admin)/oracle/deploy-campaign-testnet`, `.../smoke-campaign-round`.
**Engine (`lib/rewards/`):** `calc`, `creator`, `epochProcessor`, `merkleBuilder`, `poolSettler`,
`swapHook` (+ tests).
**Contracts:** `MintwareDistributor.sol` (v2) + `lib/web3/artifacts/campaignDistributor.ts`.
**Docs:** `docs/campaigns/*`.
**Crons removed from `vercel.json`:** `/api/cron/epoch-end`, `/api/cron/pool-settle`.

**KEPT (not part of the shelf):** referrals (`lib/rewards/referral/*`), vaults
(`lib/rewards/vault/*`), the `universal/*` reward-settlement pipeline + its cron, treasury,
Attribution, Swap (de-campaigned to a plain LI.FI swap), Leaderboard (de-campaigned to an
Attribution board).

## Supabase tables — PRESERVED, not dropped

`campaigns`, `pending_rewards`, `distributions`, `epoch_state`, `activity`, `participants`,
`token_pool_deductions`, `swap_quotes`. No migration drops them; historical data is intact. If
un-shelving, they are ready to use as-is. (Note: `activity.action_type` CHECK and the RWA-era
columns remain.)

## How to un-shelf

1. `git checkout archive/campaigns-surface` and cherry-pick / merge the surfaces you want back,
   OR branch from it and re-integrate against current `main`.
2. Re-add the campaign crons to `vercel.json`.
3. Re-wire the nav ("Rewards"), the swap reward-crediting layer, and the leaderboard points metric.
4. The Supabase tables are already present — no data migration needed.

See also `.claude/rules/rewards.md`, `.claude/rules/smart-contracts.md`, `.claude/rules/schema.md`
on the archive branch for the full engine, contract, and schema references.
