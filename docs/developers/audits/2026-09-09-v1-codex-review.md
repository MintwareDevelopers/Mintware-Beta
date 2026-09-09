# V1 source and integration audit — 2026-09-09

Baseline: `edc03502`, working tree initially clean. Repository: `/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build`.

## Assessment

V1 still has unresolved withdrawal-access, fee-settlement, accounting, and wallet-integration defects. Passing unit tests do not establish end-to-end readiness. This review has not established a new unauthenticated principal-drain exploit; that is not a claim that none exists.

This is a local source/integration audit, not external security certification or verification of deployed production state. Claude Code is installed but `claude auth status` reports `loggedIn: false`; Claude has not contributed to these conclusions.

## Scope and method

Reviewed the V1 discovery, portfolio, pool detail, swap and referral surfaces; gateway API boundaries, signed record and curator authentication; registry routing and trust checks; deploy/harvest orchestration; position reads and cost-basis SQL; gateway staging, position-manager money paths, factory and yield adapters; security headers, cron configuration, and test/build tooling. Existing audit documents were used as context, not proof of current correctness. Other legacy products in this repository (cards, org treasury, x402, attribution, Solana) received only whatever coverage the broad JavaScript test run provides; they are not represented here as fully manually audited.

Three isolated reproductions execute real gateway code with mocked external services in `tests/audit-v1-20260909.test.ts`. They assert the **current defective behavior** and pass when it is reproduced. They are audit evidence, not regression tests certifying a fix. No application or contract implementation was modified.

## Findings

### V1-01 — High: deactivation removes the withdrawal UI and portfolio position

Evidence: `lib/gateway/routeInstance.ts:93`, `:102`; `lib/gateway/registry.ts:327`; `app/api/gateway/positions/route.ts:30`; `app/api/gateway/withdraw/route.ts:42`. The same active-only resolver is used by metadata, position reads, and withdrawal recording. The portfolio enumerates only active instances. Registry deactivation explicitly claims to preserve withdrawal-only resolution, but no such resolution is used in these paths.

Reproduction: one funded inactive instance and another active instance. The inactive pool resolves to `404 pool_not_live` and is absent from the portfolio enumeration (automated PoC). Its on-chain shares and direct contract withdrawal remain intact; the impact is loss of the normal user exit path, not contract confiscation. Replacing a deactivated row with a new PM also loses the old PM from normal resolution.

Remediation: distinguish deposit eligibility from historical position/exit discovery. Retain immutable instance identities including PM, enumerate retired instances for holders, and allow metadata/read/withdraw operations with deposits disabled. A database read failure must not be treated as an empty trust registry and silently reactivate an env fallback.

### V1-02 — Medium: dust optimization prevents settlement of old collected fees

Evidence: `lib/gateway/harvest.ts:160`–`:173` and `:179`–`:186`, before the pending-restake processing at `:256`. When newly collectable fees are below the floor, the function indexes previous events and returns without even reading pending settlement. The deterministic `NotDeployed` early return has the same structure.

Reproduction: simulate `[0, 0]` newly collectable fees with 100 USDG of prior net fees ready for restaking. The indexer is called; `listPendingRestake` and all wallet writes are never called (automated PoC). Withdrawal/deploy sweeps or a previously failed settlement can therefore remain in the fee seat indefinitely if new trading activity stays below the floor. A later sufficiently large harvest can unblock it; operator recovery is also possible.

Remediation: separate collection eligibility from settlement. Always reconcile/index and process durable pending fee balances; apply a separate economic threshold to compounding. Include a recovery test with zero new fees and nonzero historical pending fees.

### V1-03 — Medium: withdrawal quote excludes funds parked in the PM

Evidence: `lib/gateway/positionReader.ts:152` reads only `staging.stagedAssets()` for idle value. The actual contract's `_idle()` includes the PM's quote-token balance (`contracts-v4/src/gateway/MintwareLpGatewayPositionManager.sol:395`). `compoundQuote()` deliberately leaves quote in the PM when staging fails.

Reproduction: 100 USDG total NAV held directly by the PM, 0 in staging, no LP position, sole holder redeeming all shares. The real quote helper reports 0 USDG and `lpQuotable: true` (automated PoC). The contract would include the parked funds. This understates the user estimate and weakens the minimum-output floor. The deploy keeper also sizes only from staging (`lib/gateway/deploy.ts:187`), so parked-only funds are not selected for deployment.

Remediation: include the PM quote balance and read all quote inputs at one block. Mirror holder/reference-mark semantics as well as virtual-offset math, or use a contract simulation for the exact withdrawal. Add deferred-compound and parked-only keeper coverage.

### V1-04 — Medium: atomic writes still compute incorrect basis for delayed or reordered records

Evidence: `app/api/gateway/withdraw/route.ts:88` reads current `sharesOf`, without a transaction-block constraint. `supabase/migrations/20260909000001_gateway_position_atomic_writes.sql:105` applies `entry_nav * current_shares / (current_shares + shares_burned)` to the current database basis. Transactional SQL prevents lost writes, but does not make those values refer to the same point in chain history.

Concrete arithmetic trace (source analysis, not a live SQL integration test): record a 100 USDG/100-share deposit; execute a 50-share withdrawal, then another 100 USDG/100-share deposit before recording either. Current shares are 150. Recording the withdrawal first reduces the old 100 basis to 75; recording the new deposit increases it to 175. Correct remaining basis is 150. Reordering deposits and withdrawals produces further inconsistencies. Signing the record and tx-hash uniqueness do not prevent this timing scenario.

Remediation: persist block number, transaction index, log index, PM and event deltas, then deterministically fold events in chain order. Do not use latest chain balance as the historical withdrawal denominator. Account for multiple relevant events in one transaction and chain-specific identity.

### V1-05 — Medium: the connected wallet is not the transaction provider

Evidence: `components/web2/v1/V1PoolDetail.tsx:159`–`:177` always obtains the signer transport from `window.ethereum`, while the transaction account comes from Mintware/Privy identity. Login permits email as well as wallet authentication (`:184`–`:186`).

An embedded wallet or WalletConnect session need not expose `window.ethereum`. With multiple wallets, the injected provider can represent a different account from the displayed identity. Deposit, withdrawal, and recording signatures then fail or prompt the wrong provider. The code explicitly acknowledges embedded transactions as unavailable, but does not restrict onboarding to a supported provider.

Remediation: obtain the EIP-1193 provider from the selected connected Privy/wagmi wallet, switch that wallet's chain, and verify its account before review and submission. Browser coverage is needed for email, WalletConnect, injected wallet, account switching, and multiple extensions. These browser scenarios were not executed in this review.

### V1-06 — Medium: a live-pool Swap button has no action

Evidence: `components/web2/v1/V1Swap.tsx:34`–`:37` enables the button for `selected.live` plus a positive amount. The button at `:101` has no `onClick` or form action. It also displays fixed output `0.00` and a slippage value without requesting an executable quote.

Selecting a live pool and entering an amount yields an enabled “Swap” button that does nothing. Registry deposit eligibility is not swap-router readiness.

Remediation: keep the feature explicitly unavailable until executable quotes and wallet submission are wired, or implement the full quote/review/execute/receipt flow with independent routing capability checks.

### V1-07 — Medium, known unresolved feature gap: paired-token fees are never converted

Evidence: `lib/gateway/routerSwap.ts:36`–`:52`. Both the unconfigured and configured branches return zero output; the configured branch is still a TODO. `harvest.ts` calls this function, not the separate `executeV4Swap` implementation.

The contract transfers paired fees to `harvestRecipient`; the default restake path compounds quote proceeds only. Paired income therefore stays outside holder NAV and the automated reinvestment loop. This is already acknowledged in project documentation and is not presented as a newly discovered exploit. Merely setting router environment variables cannot enable it.

Remediation: implement and fork-test conversion, track historical paired fees durably (including withdrawal/deploy sweeps), and reconcile realized proceeds before compounding. Until then expose unconverted income and describe the limitation accurately.

### V1-08 — Medium: read failures look like an empty or smaller portfolio

Evidence: `app/api/gateway/positions/route.ts:50`–`:85` catches an individual chain-read failure and omits that pool, returning a successful aggregate. `components/web2/v1/V1Portfolio.tsx:62`–`:66` maps API failure to an empty list. Neither carries completeness/error state into the balance display. `readGatewayPosition` also reads `totalNav` without the contract's `sourceReadable` freshness indicator.

RPC failure can make funded positions disappear or reduce the displayed total; a yield-source outage can instead show stale NAV as current. Both are significant failures for a portfolio UI even though they do not move funds.

Remediation: return per-instance errors and a completeness flag; retain last-known values with a visible stale status; make total balance unavailable or explicitly partial. Query `sourceReadable` and label cached NAV appropriately.

### V1-09 — Medium, previously documented: expensive public routes have no rate limit

Evidence: `app/api/gateway/meta/route.ts`, `position/route.ts`, `positions/route.ts` invoke `createHandler` without `rateLimit`. `proxy.ts` does not include gateway paths in its limiter rules. Metadata performs numerous RPC reads; the portfolio fans out across every active instance. Signed record routes also omit rate limits.

Public callers can repeatedly trigger database/RPC work without an application-level bound on these routes. Actual upstream/platform protections were not inspected, so deployed exploit capacity and monetary cost are unmeasured. Existing audit notes already identify the missing public-route limits.

Remediation: add route-specific limits, bounded fan-out, caching/coalescing for common reads, and an observable fallback when distributed rate limiting is unavailable. Preserve withdrawal usability during abuse.

### V1-10 — Low: the advertised lint check cannot run

`pnpm lint` exits 1 with `sh: eslint: command not found`. `package.json` defines `eslint .` but does not declare ESLint. This is a reproduced tooling defect, not a security exploit.

Remediation: choose and configure a supported linter, declare it directly, and exercise the same command in CI.

### V1-11 — Dependency triage required: production graph has unresolved advisories

`pnpm audit --prod --json` reports severity totals of **2 critical, 60 high, 77 moderate and 8 low** across the production dependency graph (131 advisory entries in the response). These are dependency-scan totals, **not 147 demonstrated exploitable application bugs**. A portable record of affected paths is saved in `2026-09-09-v1-dependencies.json` beside this report.

Both critical reports concern the direct `next@16.2.12` dependency. One requires Windows-hosted servers ([GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36)); the other concerns AVIF image optimization ([GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4)). Both advisories identify 16.3.3 as a patched 16.x release. This workspace is macOS, deployment config targets Vercel, and `next.config.mjs` sets `images.unoptimized: true`; those facts limit these particular attack paths, but are not a substitute for checking deployed runtime/configuration. No RCE was attempted or established. The other advisory paths have not received individual reachability analysis.

Remediation: prioritize direct framework updates and reachable high-severity dependencies, document non-applicable conditions with evidence, then rerun build, wallet integration, and advisory checks. Do not blindly force transitive overrides across the wallet SDK dependency graph.

## Validation

- Baseline Vitest: 121 files passed, 1 skipped; 1,068 tests passed, 4 skipped.
- New audit reproductions: 3 passed, demonstrating V1-01, V1-02 and V1-03.
- TypeScript: `pnpm exec tsc --noEmit --incremental false` passed on the baseline and again with the new audit tests.
- Lint: failed as described in V1-10.
- Dependency advisory check completed against the npm registry; see V1-11. Initial sandbox DNS failure was resolved by rerunning with approved network access.
- Production build: `pnpm exec next build --webpack` passed. The initial sandboxed attempt could not resolve Google Fonts; it was interrupted and rerun with approved network access.
- Foundry: the complete `forge test --offline` run finished with **1,040 passed, 1 failed, 4 skipped** across 119 suites. Solc 0.8.26 compiled successfully with warnings in 2,283.26 seconds; test execution took 262.21 seconds. Earlier parser diagnostics did not prevent successful Solidity compilation. The sole failure was `Mintwarev3ToV4MigratorForkTest.setUp()` in `contracts-v4/test/fork/Mintwarev3ToV4MigratorFork.t.sol`: sandbox DNS resolution failed for `mainnet.base.org`. This legacy migrator is outside the V1 gateway money path. Network-enabled targeted and `--rerun` attempts both triggered new compilation and were interrupted; **the online fork retry remains unverified**, not passed. The four skips also remain unverified. Do not describe this as an entirely green full suite. Use the final Forge summary above, not a count of individual `[PASS]` lines, which overcounted the interim output.

## Limits and next review

No deployment, production database write, token transfer, or implementation fix was performed. Production environment flags, deployed bytecode equality, live RLS/migration application, wallet-browser behavior, load handling, and current upstream service availability remain unverified. Checked-in deployment/audit assertions are not fresh evidence of those properties. Formal proof was not rerun; the repository itself records an unresolved Halmos tool failure. A full external contract audit remains a separate activity.

Prioritize restoring exit access and reconciling fee settlement, then align accounting/quotes with transaction history and connect the selected wallet provider. Reproduce the fixes end-to-end before assessing readiness again. Claude's independent pass should challenge these findings and focus on deployment/withdrawal economics, event ordering and recovery after interrupted transactions; it must not assume these passing PoCs mean the defects are fixed.
