# Production Readiness Inspection

Last audited: 2026-04-03
Owner: Codex review pass

## Executive Summary

Mintware is much closer to production-ready than the repo drift suggested, but it is not yet at a clean "100% ready" bar. The platform now has the important product work on `main`: Privy onboarding, Ethereum UX upgrades, GitBook-source docs updates, and a live-surface Solana pause. The architecture itself is coherent, but the operating picture is still carrying drift in three places:

- documentation no longer fully matches the live platform
- Supabase migration history no longer cleanly mirrors production
- deployment/build truth still needs to be treated as an operational checklist, not an assumption

The highest-confidence current statement is:

- product direction is EVM-first, Privy-enabled, Solana-paused
- swap/trading, campaigns/claims, vaults, agents, and universal rewards now coexist in one Next.js + Supabase + Vercel system
- the biggest remaining production risk is coordination drift, not a single catastrophic missing feature

## Current Production Truth

### On `main`

- Privy onboarding and embedded-wallet support
- Ethereum UX upgrade for swap, claims, campaign funding, and vault flows
- public GitBook source updates
- Vercel cron schedule fix for hobby-safe deployability
- lockfile refresh for Vercel builds
- Solana removed from live product surfaces

### Platform posture

- EVM is the live transaction rail
- Privy is the preferred onboarding layer when configured
- Solana work is preserved in history, but paused from live user surfaces
- AI agents and universal rewards are now first-class backend/domain surfaces
- vaults remain a gated product area with meaningful backend and cron complexity

## Readiness Scorecard

### Strong / ready enough

- GitHub `main` is again the right source of truth for important product work
- Vercel config is aligned with once-daily cron limits
- Supabase live project is linked and healthy
- live identity model is now coherent: EVM + Privy, not split between active EVM and half-live Solana
- user-facing transaction UX is materially better than before across swap, claim, campaign funding, and vault flows

### Still needs cleanup before "100%"

- Supabase migration history is drifted and duplicated
- the canonical architecture docs are stale
- some route/file comments still describe outdated schedules or older system boundaries
- production deployment still needs to be verified from Vercel state, not inferred from git alone

## Primary Risks

### 1. Schema drift

This is the clearest production-readiness risk.

Observed from `npx supabase migration list`:

- duplicate local migration versions:
  - `20260319000001`
  - `20260320000002`
- local-only migrations:
  - `20260329000003`
  - `20260401000004`
  - `20260401000005`
  - `20260401000006`
  - `20260401000007`
- remote-only migrations:
  - `20260401000001`
  - `20260401000002`
  - `20260401000003`

Why it matters:

- repo schema truth is not a clean mirror of production
- future migration application is risky until history is reconciled
- universal rewards and Solana-era tables are especially likely to confuse later work

Recommended next step:

- do not `db push`
- inspect live schema objects against the repo migrations
- reconstruct the missing April 1 migrations in repo or explicitly document them as production-only history
- normalize duplicate migration numbering before adding more schema work

Additional confirmed live-schema findings:

- `trade_signals`, `trade_signal_sync_state`, `universal_reward_epochs`, and `universal_reward_allocations` already exist in production
- `universal_reward_epochs.distribution_id` and `published_at` also exist in production
- `sol_distributions` does not exist in production
- `trade_signals.settled_epoch_id` does not exist in production

Reference:

- [`docs/developers/supabase-migration-reconciliation.md`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/docs/developers/supabase-migration-reconciliation.md)

### 2. Documentation drift

[`docs/ARCHITECTURE.md`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/docs/ARCHITECTURE.md) still reflects a simpler March system. It does not adequately represent:

- Privy as the onboarding layer
- the universal rewards pipeline
- agent APIs and ERC-8004 surfaces
- the current daily Vercel cron schedule
- Solana as paused rather than co-equal

Recommended next step:

- treat [`docs/developers/platform-system-map.md`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/docs/developers/platform-system-map.md) as the current operational map until the canonical architecture doc is rewritten

### 3. Deploy verification gap

The intended production flow is now clear:

```text
Local repo -> GitHub main -> Vercel production deploy -> mintware.finance
GitHub docs/main -> GitBook sync -> Docs
```

But production truth should still be verified from Vercel, not assumed from pushes.

Recommended next step:

- confirm the current production deployment is serving a commit at or after:
  - `29e3fb62` Solana live pause
  - `0e859b9b` lockfile refresh
  - `92724fae` Ethereum UX upgrade

## What Changed Since The Earlier System Map

The platform is no longer just:

- wallet connect
- campaigns
- claims
- one cron rail

It is now:

- Privy + wagmi identity shell
- swap/trading UX and quote proxy
- campaign attribution and claim settlement
- gated vault product with off-chain bookkeeping and rebalancing
- AI agent registration, metadata, and leaderboard
- universal rewards ingestion, settlement, and bridge crons
- public docs pipeline through GitBook sync

That is why a whole-platform map is needed now; the old “campaign engine plus scoring worker” model is no longer sufficient.

## Recommended Next Actions

### P0

- reconcile Supabase migration history
- verify current Vercel production deploy commit and health
- rewrite [`docs/ARCHITECTURE.md`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/docs/ARCHITECTURE.md) from the newer platform map

### P1

- audit cron comments and stale route headers so code comments match actual schedules
- document which vault routes are intended to be dark when Phase 2 is off
- document which Solana routes remain intentionally paused versus intentionally deleted

### P2

- build a dependency inventory for env vars by subsystem
- add a repeatable launch checklist for GitHub, Vercel, Supabase, and GitBook

## Bottom Line

Mintware now has enough moving parts that “production ready” has to mean more than “the app builds.” The current state is promising: the live product direction is coherent, the largest user-facing UX gaps were improved, and Solana is no longer muddying the active surface. The remaining work is mainly operational rigor:

- one source of schema truth
- one trustworthy system map
- one verified deploy path

Until those are cleaned up, Mintware is close, but not honestly at a 100% production-ready bar.
