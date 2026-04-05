# Production Operator Checklist

Last updated: 2026-04-05
Owner: Codex review pass

## Purpose

This is the practical operator-side checklist for running Mintware safely after the audit hardening pass.

Use this before:

- deploying new production code
- enabling new reward rails
- operating vault and epoch settlement
- handing the platform to another operator or reviewer

## Core Assumptions

Mintware currently assumes:

- EVM is the live transaction rail
- Solana live surfaces remain paused
- `FeeVault` accounting is USDC-normalized
- non-USDC MEV capture stages to treasury, then normalizes into USDC
- important write paths require wallet proof or on-chain verification
- cron routes fail closed outside local development when `CRON_SECRET` is missing

## Before Deploying

- confirm the target branch is `main`
- confirm `origin/main` contains the latest hardening commits
- confirm no security-sensitive work is stranded only on `codex/*` branches
- confirm local-only files are not being committed:
  - [/.claude/launch.json](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/.claude/launch.json)
  - [/.claude/rules/deployments.md](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/.claude/rules/deployments.md)
  - [/supabase/.temp/cli-latest](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/supabase/.temp/cli-latest)
  - [/docs/.DS_Store](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/docs/.DS_Store)

## Vercel Checklist

- verify latest production deploy is `Ready`
- verify aliases point to the latest production deploy:
  - `mintware.finance`
  - `www.mintware.finance`
- confirm the live production deploy is on or after the expected `main` commit
- confirm cron routes in `vercel.json` still match the intended live schedule

## Supabase Checklist

- confirm project ref is the intended live project
- confirm migration history is clean enough for the intended change
- never run blind `db push` against production
- for schema changes:
  - prove live schema markers first
  - reconcile migration history deliberately
  - only then apply unapplied migrations

## Contract / Treasury Checklist

- confirm `FeeVault` treasury address is correct
- confirm `FeeVault` oracle signer is correct
- confirm `SocialVault` / `MWSocialHook` addresses are wired as expected
- confirm `mevTreasury` staging address is correct
- confirm fee-share changes are intentional for future epochs only
- remember:
  - current epoch shares are now snapshotted at epoch open
  - `compound()` is intentionally disabled

## Cron / Settlement Checklist

- `epoch-end`
  - expired points epochs should advance even when empty
- `pool-settle`
  - claimable token-pool rewards should settle into distributions
  - pending token-pool roots should retry publication
- `vault-epoch-close`
  - on-chain `FeeVault` totals should be available when configured
- `treasury/normalize-mev`
  - non-USDC staged assets should normalize into USDC and deposit into `FeeVault`
- `universal-pipeline`
  - if enabled, should fail closed when required env is missing

## Live Smoke Test Checklist

### Identity / referral

- connect wallet returns a ref code
- referral apply requires wallet consent
- connect activates only the connecting wallet's pending referral state

### Campaigns

- join works for eligible wallets
- create/manage requires creator wallet proof
- score refresh does not break participant state

### Claims

- claim status loads
- claim proof route returns distribution data for eligible wallets
- mark-claimed only succeeds on matching distributor calldata

### Vaults

- create requires signed auth
- deposit requires signed auth and verified deposit tx
- withdraw requires signed auth and verified withdrawal tx
- rebalance proposal submission only accepts matching on-chain proposal executions

### Rewards / settlement

- swap-event rejects unverifiable txs
- token-pool pending distributions eventually become published
- points epochs advance cleanly

## Operational Rules

- do not assume a cron comment is true unless the route behavior and `vercel.json` agree
- do not assume a database mirror is authoritative if an on-chain source of truth exists
- do not assume a wallet address in a request body proves ownership
- do not enable half-wired economics in production just because the contract surface exists

## External Audit Boundary

If paying for a focused external review later, scope the money-bearing core first:

- [contracts/MintwareDistributor.sol](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/contracts/MintwareDistributor.sol)
- [contracts-v4/src/FeeVault.sol](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/contracts-v4/src/FeeVault.sol)
- [contracts-v4/src/SocialVault.sol](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/contracts-v4/src/SocialVault.sol)
- [contracts-v4/src/MWSocialHook.sol](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/contracts-v4/src/MWSocialHook.sol)
- [contracts-ai/src/AIAttribution.sol](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/contracts-ai/src/AIAttribution.sol)

Everything else should support that boundary, not expand it casually.

## Bottom Line

Mintware is in a stronger place now, but the way it stays that way is simple:

- verify live truth
- keep assumptions explicit
- keep writes authenticated or chain-verified
- keep accounting tied to the real source of truth
- and do not reintroduce convenience shortcuts in production paths
