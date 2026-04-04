# Supabase Migration Reconciliation

Last audited: 2026-04-03
Owner: Codex review pass

## Purpose

This document records the current drift between repo migration history and the linked live Supabase project, plus the safest next actions.

It is intentionally non-destructive. Nothing here assumes `db push`, force-repair, or history rewriting without review.

## Linked Project

- project ref: `bqwcwrnqpayfndgmceal`
- project name: `Mintware Project`
- project status: `ACTIVE_HEALTHY`

## History Drift Summary

From `npx supabase migration list`:

### Duplicate local version numbers

- `20260319000001`
- `20260320000002`

These duplicate-version files are already a repo hygiene problem even before considering production drift.

### Local-only migration versions

- `20260329000003`
- `20260401000004`
- `20260401000005`
- `20260401000006`
- `20260401000007`

### Remote-only migration versions

- `20260401000001`
- `20260401000002`
- `20260401000003`

## What The Live Schema Proves

Direct linked-database inspection shows:

### Present in production

- `trade_signals`
- `trade_signal_sync_state`
- `universal_reward_epochs`
- `universal_reward_allocations`
- `universal_reward_epochs.distribution_id`
- `universal_reward_epochs.published_at`
- indexes:
  - `trade_signals_chain_tx_log_uidx`
  - `trade_signals_pool_block_idx`
  - `trade_signals_swapper_idx`
  - `universal_reward_allocations_epoch_idx`
  - `universal_reward_allocations_recipient_idx`
  - `universal_reward_epochs_distribution_uidx`
  - `universal_reward_epochs_pool_epoch_idx`

### Not present in production

- `sol_distributions`
- `trade_signals.settled_epoch_id`

### RLS policy state

No policies were found for:

- `trade_signals`
- `trade_signal_sync_state`
- `universal_reward_epochs`
- `universal_reward_allocations`

That does not automatically mean the tables are unsafe, because service-role access may be the only intended path, but it should be treated as an explicit design choice rather than an accidental default.

## Interpretation

### `20260329000003_sol_distributions.sql`

This migration is local-only and its main table is not present in production.

Practical meaning:

- the Solana distributor rail is not active in the live database
- this is consistent with Solana now being paused from the live product surface

### `20260401000004` through `20260401000007`

These versions are local-only in history, but most of their schema effects are already present remotely.

Practical meaning:

- production likely received equivalent changes through the unknown remote-only April 1 migrations
- migration history and schema reality have diverged
- the bridge columns landed partially:
  - `distribution_id` and `published_at` exist
  - `settled_epoch_id` does not

### `20260401000001` through `20260401000003`

These are remote-only in history, but they almost certainly correspond to the universal-rewards schema that production already has.

Practical meaning:

- we are missing source-of-truth migration files in the repo for at least part of the universal rollout
- the repo should not pretend it fully represents production schema history today

## Safe Next Actions

### P0

- do not run `npx supabase db push`
- do not create more migrations on top of this drift until the numbering/history issue is addressed
- preserve the current linked project and history as evidence

### P1

- reconstruct or recover the missing remote-only migration files:
  - `20260401000001`
  - `20260401000002`
  - `20260401000003`
- determine whether `trade_signals.settled_epoch_id` is still required by the current universal pipeline

### P2

- decide whether `sol_distributions` should:
  - remain local-only and dormant, or
  - be removed from the active migration path entirely while Solana is paused

### P3

- normalize duplicate version numbers in the repo before future schema work
- add explicit documentation on whether the universal tables are intentionally service-role-only or should have RLS policies

## Bottom Line

The live database is healthier than the migration list alone suggests, because the universal rewards schema is already materially present. But the repo cannot currently claim to be a clean canonical record of production schema history.

The most accurate statement is:

- production schema contains most of the universal pipeline tables and bridge fields
- repo migration history is missing part of how production got there
- Solana distributor schema is not live
- future migration work should be treated as reconciliation work first, feature work second
