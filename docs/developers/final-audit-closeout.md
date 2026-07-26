# Final Audit Closeout

Last updated: 2026-04-05
Owner: Codex review pass

## Purpose

This document closes out the intensive Mintware platform audit and hardening pass completed across:

- application routes and auth boundaries
- Supabase-backed mutation paths
- reward settlement and cron flows
- smart contracts and economic/accounting assumptions
- production deployment verification

Use this as the canonical high-level record of:

- what was reviewed
- what was fixed
- what is live on `main`
- what remains intentionally out of scope or lower priority

## Executive Summary

Mintware is in a materially stronger state than it was at the start of this pass.

The dominant bug class was:

- trusting public wallet strings instead of proving wallet control

That pattern affected claim marking, campaign writes, vault writes, referral/connect flows, wallet linking, agent registration, and several related routes. Those issues were fixed and replayed onto `main`.

The deeper contract and accounting pass also surfaced real correctness issues:

- compounding and claim accounting seams
- fee-routing/accounting mismatches
- epoch progression stalls
- operator-sensitive economic behavior

Those were also fixed and landed on `main`.

## Scope Covered

### Application / API layer

- claim generation and claim marking
- campaign join, create, manage, and score refresh
- referral application and first-connect
- wallet linking
- vault create, deposit, withdraw, and rebalance proposal flows
- agent registration and MWP submission
- swap attribution and reward crediting

### Data / Supabase layer

- service-role mutation paths
- migration drift
- epoch/distribution persistence assumptions
- live schema vs repo schema reconciliation

### Smart contract / protocol layer

- [`contracts/MintwareDistributor.sol`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/contracts/MintwareDistributor.sol)
- [`contracts-v4/src/FeeVault.sol`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/contracts-v4/src/FeeVault.sol)
- [`contracts-v4/src/SocialVault.sol`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/contracts-v4/src/SocialVault.sol)
- [`contracts-v4/src/MWSocialHook.sol`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/contracts-v4/src/MWSocialHook.sol)
- [`contracts-ai/src/AIAttribution.sol`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/contracts-ai/src/AIAttribution.sol)

### Production / deploy layer

- GitHub `main`
- Vercel production deployment and aliasing
- cron auth behavior
- production deployment recency vs hardened `main`

## Major Fix Buckets

### 1. Wallet-proof and write-auth hardening

Fixed:

- public claim-mark secret dependence
- unauthenticated claim-mark mutation
- unauthenticated agent registration / MWP writes
- unauthenticated vault create / deposit / withdraw writes
- unauthenticated campaign create / manage writes
- unauthenticated connect / referral activation
- unauthenticated referral apply
- wallet-link without EVM ownership proof

Result:

- important mutation routes now require wallet-signed authorization or verified on-chain transaction proof

### 2. Reward attribution and settlement hardening

Fixed:

- fail-open swap tx verification
- public swap-event ingestion crediting unverifiable txs
- token-pool pending distributions with no real publish retry
- empty / zero-point epoch stalls
- claim accounting mismatch between `MintwareDistributor` and `FeeVault`
- stale DB mirror dependence for vault epoch pool totals

Result:

- reward settlement now fails closed more often, retries where appropriate, and keeps contract/off-chain accounting better aligned

### 3. Smart contract hardening

Fixed:

- `SocialVault` first-caller seeding risk
- lock-tier downgrade / lock rewrite via small top-up
- stale ERC-8004 reverse links in `AIAttribution`
- `FeeVault.compound()` pretending to work while not actually compounding
- invalid pool/config guard gaps
- compounding enabled in contracts before the off-chain pipeline could safely support it
- fee share changes retroactively affecting the current epoch

Result:

- core contracts now preserve the intended architecture with tighter correctness and safer operator behavior

### 4. MEV capture and fee normalization

Fixed:

- non-USDC captured value being mis-accounted as USDC
- direct fee inflows bypassing `FeeVault` epoch accounting

Shipped design:

- USDC capture goes directly into `FeeVault`
- non-USDC capture stages to treasury
- staged assets can be normalized into USDC and then deposited into `FeeVault`

Result:

- Mintware is not capped to earning only in USDC at the hook layer, while accounting remains USDC-normalized for the current fee-distribution system

### 5. Economic / incentive corrections

Fixed:

- referral squatting via public referred-wallet submission
- referral-trade points using the trader's multiplier instead of the referrer's
- early epoch close and other operator-sensitive epoch timing issues

Result:

- incentives are more aligned to the actual wallet earning them, and operators have less room to retroactively reshape live economics

## Post-Audit Infrastructure — Route Handler Unification (2026-04-07)

Following the audit hardening pass, all 46 non-cron API routes were migrated to a centralized `createHandler` factory (`lib/web2/routeHandler.ts`). This locks in the auth, logging, and error patterns from the audit as structural constraints rather than per-route conventions.

What the migration enforced across every route:

- **Auth is declarative, not optional** — `auth: 'signed-message'`, `auth: 'bearer-token'`, or explicit `auth: 'none'`. No route can omit the choice.
- **Supabase is a singleton** — `ctx.supabase` is injected from a module-level client. No route instantiates its own connection.
- **BigInt serialization is automatic** — `ctx.json()` applies `toJsonSafe()` before every response. No route can accidentally 500 on an on-chain amount.
- **Every response carries `X-Request-Id`** — tied to structured server logs for every request.
- **Error shape is uniform** — `{ success: false, error, code }` across all 46 routes.

This is infrastructure-level enforcement of the security properties the audit fixed at the application level. Internal reference: `.claude/rules/route-handler.md`.

---

## Production Status

### Current branch truth

- `origin/main` includes the application hardening, contract hardening, accounting fixes, and economic fixes from this audit pass

### Production truth

Verified:

- [https://mintware.finance](https://mintware.finance)
- [https://www.mintware.finance](https://www.mintware.finance)

Vercel production deployment:

- `dpl_8PpR18Qw765uaRxJHKK9dnVxzb4t`
- target: `production`
- status: `Ready`

At verification time, production timing matched the latest hardened `main` commit window closely enough to treat the live deployment as caught up to the hardening pass.

## Remaining Open Items

### Not currently treated as critical

- some stale comments and low-severity docs drift may still exist outside the touched paths
- full manual browser-based live wallet execution was not performed for every user flow in this session
- Foundry full `forge test` remained flaky on this machine because of local environment/proxy issues, although compile-level verification succeeded

### Still worth doing

- add more invariant / fuzz coverage around the audit-boundary contracts
- keep cron and settlement monitoring tight
- do one deliberate manual production smoke round with real wallets

## What This Is Not

This was a serious full-platform review pass, but it is not the same thing as:

- a paid third-party formal smart-contract audit
- a proof that zero bugs remain
- a guarantee that future changes can ignore the same rigor

The value of this pass is that it removed a large set of real, production-relevant flaws and converted Mintware from a drift-heavy system into one with a much stronger operational and security baseline.

## Recommended Next Steps

### Immediate

- keep this document and the operator checklist current as the post-audit source of truth
- run one manual live-wallet smoke test across the highest-value flows

### Short term

- add invariant/fuzz tests for the audit-boundary contracts
- narrow and freeze the external-audit boundary before paying for outside review

### Product track after that

- `Privy` embedded-wallet gas-with-token MVP

## Bottom Line

Mintware is in a much stronger position than when this pass started.

The highest-risk off-chain auth problems, reward-settlement seams, fee-accounting issues, and core economic correctness bugs found in this review were fixed and landed on `main`.

The platform is now much closer to:

- safe enough to operate
- clear enough to hand off
- and disciplined enough to keep iterating without pretending the hard parts are solved forever
