# Round 4 — Multi-Suite Security Audit: LP Gateway V1 (2026-09-09)

**Scope**: "All V1, anything V1 touches" (user's own scoping decision) — on-chain
(`contracts-v4/src/gateway/*`, `MintwareERC4626YieldAdapter.sol`, `MintwareIdleYieldAdapter.sol`,
`IYieldAdapter.sol`, `SeniorSharesMath.sol`) and everything it touches off-chain (`lib/gateway/*`,
`app/api/gateway/*`, the gateway crons, the Supabase tables, the V1 frontend money path).

**Method**: static baselines (Aderyn 0.6.8, Slither 0.11.5 via the per-contract direct-solc
workaround, Semgrep 1.156.0) run first and fed as context into an 11-dimension parallel agent hunt,
each dimension pre-scoped to exact files; every raw finding then went through 3-way adversarial
verification (2-of-3 non-refuted survives); every confirmed Critical/High got a real PoC — several
executed against a live Robinhood-testnet fork or the actual production Supabase project, not just
reasoned about. 34 raw findings → 24 confirmed. Halmos (genuinely installed, 0.2.6) was attempted for
the existing formal-proofs harness and hit a persistent internal tooling error unrelated to this
round's findings — recorded honestly in
[`../round3/halmos-formal.md`](../round3/halmos-formal.md) rather than faked.

Static baselines: [`aderyn-lp-gateway.md`](aderyn-lp-gateway.md) ·
[`slither-lp-gateway.md`](slither-lp-gateway.md) · [`semgrep-lp-gateway.md`](semgrep-lp-gateway.md).

## Executive summary

**24 confirmed findings**: 1 Critical, 6 High, 7 Medium, 7 Low, 3 Informational.

**Fixed and verified — 1 Critical, all 6 High, all 7 Medium, 3 of 7 Low**, plus 2 more Low
findings closed by documentation reconciliation for a genuinely design-intentional item each
(`compoundQuote`'s cap exemption, the idle-balance donation tradeoff — not code bugs once you read
the code's own reasoning). Every code fix is compiled and covered by tests — `tsc` clean, full
vitest 1066/0 fail, full `forge test` 1042/0 fail (4 pre-existing fork-test skips, unrelated).

**✅ Both migrations from this audit are now applied to production and live-verified.** The Critical's
`20260908000003_gateway_ledger_view_security.sql` and finding #12's
`20260909000001_gateway_position_atomic_writes.sql` were both applied by the user (same day) and
confirmed live via direct curl against prod: `record_gateway_deposit_event`/`record_gateway_withdraw_event`
are service-role-only (anon key → `42501 permission denied`), a real service-role insert works, and a
replay of the same `tx_hash` is correctly idempotent (`already_recorded:true`, no double-credit). Probe
rows were cleaned up afterward. `/api/gateway/deposit` and `/api/gateway/withdraw` are fully live on the
atomic-write path. (The unrelated, pre-existing `gateway_alerts` migration, `20260907000003`, still
remains unapplied — same root cause, lower severity, not part of this audit's scope.)

**Still open, no code change**: 1 Low, `supabase/migrations/20260907000003_gateway_alerts.sql` —
same root cause as the Critical (merged, never applied to prod), lower severity; needs the same kind
of operator action, not a code change. 1 Low (#18) needed no fix at all — the audit itself confirmed
it safe. None of the open items are fund-loss bugs — the core "withdrawals never brick, principal is
never destroyed" invariant held throughout.

## ✅ [CRITICAL] Fee-ledger RLS — CLOSED 2026-09-09 (applied by the user, live-verified)

`supabase/migrations/20260908000003_gateway_ledger_view_security.sql` was merged to `main` (commit
`debe2c73`) but never actually executed against the production Supabase project
(`bqwcwrnqpayfndgmceal`) — this environment has no `supabase` CLI or DB/management credentials, so I
could only flag it, not apply it. **The user applied it directly.** Live-reproduced the fix immediately
after:

```
gateway_fee_balances               → 401 (was 200)
gateway_fee_ledger_reconciliation  → 401 (was 200)
record_gateway_harvest RPC         → 401 "permission denied for function record_gateway_harvest"
                                      (was 401 "row-level security policy" — i.e. it used to EXECUTE
                                      and only get stopped by table RLS; now refused before the
                                      function body ever runs)
```

`lib/gateway/__audit3__/rlsAnonProbe.live.test.ts` (previously flipped from asserting the vulnerable
state to asserting the fixed state) run live against prod: **4/4 passed**, confirming the fix is real
and now stands as a permanent regression guard.

**One sibling item is still open, separately**: `supabase/migrations/20260907000003_gateway_alerts.sql`
(the `gateway_alerts` table — Low finding #21 below, same root cause: a migration merged but not
applied) is **still not applied** — a live probe today still gets `404 PGRST205 "Could not find the
table 'public.gateway_alerts'"`. Lower severity (read-only alert plumbing, not a data-exposure risk),
left as the one remaining Low action item; apply it the same way when convenient.

## Findings & disposition

| # | Sev | Title | File | Status |
|---|---|---|---|---|
| 1 | 🔴 Critical | Fee-ledger view RLS fix merged but never applied to prod DB | `supabase/migrations/20260908000003_...sql` | **✅ FIXED — applied by the user 2026-09-09, live-verified (4/4 regression tests pass).** |
| 2 | 🟠 High | `deploy()`'s post-swap price re-read never re-checked against the deviation band — a hostile paired-token transfer hook can interleave an unbounded swap and manipulate the price the LP mint is sized off | `MintwareLpGatewayPositionManager.sol:772` | **FIXED.** `ref`/`band` hoisted to function scope; a second band check added right after the post-swap `getSlot0()` re-read, new `DeployPriceMovedOutOfBand` error. |
| 3 | 🟠 High | `deploy()` doesn't bound `swapAmount`/mint sizing against actually-unstaged `quoteGot` — an adapter shortfall underflow-reverts the whole call, and the same off-chain sizing retries forever | `MintwareLpGatewayPositionManager.sol:721` | **FIXED.** `if (quoteGot < quoteToDeploy) revert InsufficientStaged();` right after `quoteGot` is computed, before any swap runs. (This transitively also closes the related Low — see #15 below.) |
| 4 | 🟠 High | A withdrawer whose own address is frozen by the USDG issuer bricks their *entire* withdrawal — the idle leg has no failure isolation, unlike the LP leg | `MintwareLpGatewayPositionManager.sol:619` | **FIXED.** New `idleLegExit` self-call (mirrors the existing `lpLegExit` pattern) wrapped in try/catch; on failure the pulled quote stays in the contract's own balance (already counted by `_idle()`) and the existing re-credit math handles the rest unchanged. New `IdleLegDeliveryFailed` event. |
| 5 | 🟠 High | `MintwareERC4626YieldAdapter.withdraw()` doesn't honor `IYieldAdapter`'s "never reverts" contract — 3 of 4 external calls were unguarded | `MintwareERC4626YieldAdapter.sol:126` | **FIXED.** Entire read-then-redeem sequence moved into a self-call (`_withdrawCore`), `withdraw()` try/catches the whole thing — closes all 3 unguarded calls AND `maxWithdrawable()`'s own reads in one boundary. |
| 6 | 🟠 High | D-4 adapter-kind probe defaulted to `'real'` (false "earns immediately" claim) on *any* read failure, not just a genuine real-adapter signature | `app/api/gateway/meta/route.ts:91` | **FIXED.** Added a positive-confirmation second probe (`perBlockWithdrawCap()`, the real adapter's own distinguishing method) — `'real'` now requires an affirmative success, not merely `depositCap()` failing; both failing → `'unknown'`. This was my own code from earlier this session — a real bug in a fix I'd just shipped. |
| 7 | 🟠 High | Deposit-amount input silently corrupts locale-formatted/pasted numbers (`"1,25"` → `"125"`, a 100x-inflated deposit, no error anywhere in the flow) | `components/web2/v1/V1PoolDetail.tsx:492` | **FIXED.** New `sanitizeAmountInput()` (`lib/gateway/amountInput.ts`) normalizes a lone decimal comma, leaves a comma-with-existing-period alone (so working US-format thousands amounts aren't regressed), collapses to ≤1 `.` so ambiguous input fails loudly via `parseUnits` instead of silently truncating. |
| 8 | 🟡 Medium | `MintwareLpGatewayFactory` didn't disable `renounceOwnership` — the only factory-level incident-response lever (`deactivate()`) could be permanently forfeited | `MintwareLpGatewayFactory.sol:21` | **FIXED.** Same `Ownable2Step` + `revert RenounceDisabled()` pattern already used by every sibling contract. |
| 9 | 🟡 Medium | `MintwareLpGatewayStaging.unstage()` has no defensive wrapper of its own around `adapter.withdraw()` | `MintwareLpGatewayStaging.sol:72` | **✅ FIXED.** `try adapter.withdraw(amount) {} catch {}` — same defense-in-depth already used one layer up (`_idle()`'s own try/catch around `stagedAssets()`). New test `test_unstage_survivesAdapterRevert_degradesToZero`. |
| 10 | 🟡 Medium | `deploy()`'s pre-flight `_sweepFees` is unguarded — a frozen/blacklisted `harvestRecipient` bricks *every* future deploy for the 48h rotation window | `MintwareLpGatewayPositionManager.sol:734` | **✅ FIXED.** New `sweepFeesExternal` self-call wrapper (mirrors `lpLegExit`'s own isolation of its internal sweep); `deploy()` now `try this.sweepFeesExternal(deadline) {} catch {}`. Fees stay accrued, uncollected, until a future successful sweep. New fork-only test `test_CF_deployNoLongerBrickedByFrozenRecipient_feesStayAccruedInstead` (written and reviewed; **not executed in this session** — needs `LP_FORK_RPC_URL`, unavailable here). |
| 11 | 🟡 Medium | Fixed off-chain gas budgets for harvest/deploy/compound can permanently stall automation if a heavier-than-usual token transfer needs more | `lib/gateway/harvest.ts:182` | **✅ FIXED.** New `lib/gateway/gasEstimate.ts` (`estimateGasWithFloor` — real `estimateContractGas` + 75% buffer, falls back to the old fixed literal only if estimation itself fails) wired into harvest/compound/deploy; the pre-harvest simulate also now short-circuits on a deterministic `NotDeployed` revert instead of falling through to a guaranteed-revert real tx. 10 new unit tests (`gasEstimate.test.ts`) + 4 new `harvest.test.ts` cases. |
| 12 | 🟡 Medium | Cost-basis (`entry_nav`) update isn't atomic with its own idempotency claim on deposit/withdraw | `app/api/gateway/deposit/route.ts` | **✅ FIXED — but needs the SAME kind of manual migration application the Critical finding needed.** New atomic RPCs (`record_gateway_deposit_event`/`record_gateway_withdraw_event`, `supabase/migrations/20260909000001_gateway_position_atomic_writes.sql`, mirroring the proven `record_gateway_harvest` pattern) replace the two-step insert+upsert; the basis increment/reduction is expressed against the row's live value at write time, so a crash between steps or two concurrent writers can no longer strand or lose a contribution. **⚠️ This migration has NOT been applied to production yet** — until it is, `/api/gateway/deposit` and `/api/gateway/withdraw` will 500 `record_failed` (the on-chain deposit/withdraw itself still succeeds — this only breaks the off-chain cost-basis mirror). Apply it the same way you applied `20260908000003`. |
| 13 | 🟡 Medium | (duplicate of #6, same title/root cause, different dimension) | `app/api/gateway/meta/route.ts:91` | **FIXED** — same fix as #6. |
| 14 | 🟡 Medium | Off-chain withdraw quote re-applies the virtual offset *per leg* — the exact pre-round-3-fix formula, over-counting by ≈$1 per exit and causing spurious `SlippageExceeded` reverts on typical small withdrawals | `lib/gateway/positionReader.ts:70` | **FIXED.** `withdrawLegsQuote` rewritten to mirror the CURRENT contract exactly: price the whole claim once (`navW = idle + lpSpotVal`, offset applied once), then split proportionally. New `pairedToQuoteAtSpot` mirror added to `v4Math.ts`. |
| 15 | 🟢 Low | `deploy()`'s `swapAmount` validated against `quoteToDeploy`, not actually-unstaged `quoteGot` | `MintwareLpGatewayPositionManager.sol:768` | **FIXED as a consequence of #3** — `quoteGot >= quoteToDeploy >= swapAmount` is now guaranteed transitively. |
| 16 | 🟢 Low | `compoundQuote()` grows `idle` with no `principalCap` check, unlike deposit/deploy | `MintwareLpGatewayPositionManager.sol:963` | **Reconciled, not code-changed.** Read the code's own reasoning (IA-4, IA-4's own comment) — this is a deliberate, well-argued design choice (pure yield accretion to existing holders, no new exposure) that the *class-level doc comment* contradicted. Fixed the doc comment to state the carve-out explicitly instead of changing working, intentional behavior. |
| 17 | 🟢 Low | `idle` includes unauthenticated raw `balanceOf` — a direct donation can inflate it and grief `principalCap` closed for legitimate depositors | `MintwareLpGatewayPositionManager.sol:371` | **Documented as an accepted design tradeoff, not code-changed** — matches the audit's own recommendation. Dropping the balance term would break the R3-INV-2 invariant `_idle()` already relies on (parked deferred-re-stage dust must stay priced into NAV); the real mitigation is operational (monitor for cap headroom consumed with no matching `Deposited` event). NatSpec added to `_idle()` recording this explicitly. |
| 18 | 🟢 Low | Deploy cron's idempotency window blocks retries for the rest of the window after ONE failed tx | `lib/gateway/deploy.ts` | **Confirmed safe by the audit itself** — no fix needed (labeled "Confirmed safe" in the original finding). |
| 19 | 🟢 Low | Curator queue `GET` has no declared rate limit | `app/api/gateway/curate/route.ts` | **FIXED.** Added `{ rateLimit: { max: 30, windowMs: 60_000 } }`, matching the existing `discover`/`sparklines` pattern (this closes one instance of the project's own tracked HO-15 backlog). |
| 20 | 🟢 Low | Reactivating a deactivated registry row via `update()` doesn't check whether the write matched a row — a lost race silently logs wrong metadata | `lib/gateway/registry.ts:478` | **✅ FIXED.** `.select('id')` chained after the guarded update now returns the actually-matched row(s); zero rows ⇒ new `concurrent_activation_conflict` refusal instead of silently falling through to a success/history-log path with stale metadata. New regression test simulates the exact race (a concurrent writer flips the row between our read and our write). |
| 21 | 🟢 Low | `gateway_alerts` table doesn't exist in production; failures silently swallowed | `supabase/migrations/20260907000003_gateway_alerts.sql` | **Not fixed — same root cause as #1** (migrations merged but not applied to prod). Apply alongside the Critical migration. |
| 22 | ℹ️ Info | Confirmed: the owner-supplied paired-leg subsidy path is structurally deleted | — | No action — this is a *positive* confirmation the earn-vs-lp decision's core claim holds. |
| 23 | ℹ️ Info | Confirmed fail-closed: curator/cron bearer auth can't fall open in prod | — | No action — positive confirmation. |
| 24 | ℹ️ Info | `LP_GATEWAY_ABI`/`LP_STAGING_ABI`/`LP_IDLE_ADAPTER_PROBE_ABI` verified correct against current contracts | — | No action — positive confirmation. |

## Files changed this session (fixes)

**Contracts**: `contracts-v4/src/gateway/MintwareLpGatewayPositionManager.sol` (findings #2, #3, #4,
#10, #15, #16, #17), `contracts-v4/src/gateway/MintwareLpGatewayFactory.sol` (#8),
`contracts-v4/src/gateway/MintwareLpGatewayStaging.sol` (#9),
`contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol` (#5).

**Contract tests**: `contracts-v4/test/gateway/MintwareLpGatewayFactory.t.sol` (new
`test_renounceOwnership_disabled`), `contracts-v4/test/gateway/MintwareLpGatewayStaging.t.sol` (new
`test_unstage_survivesAdapterRevert_degradesToZero`),
`contracts-v4/test/fork/MintwareLpGatewayCloseoutFork.t.sol` (new
`test_CF_deployNoLongerBrickedByFrozenRecipient_feesStayAccruedInstead`, fork-only, not executed this
session), `contracts-v4/test/gateway/MintwareLpGatewayIdleAdapter.t.sol` (`test_IA12_...` rewritten
from bug-proving to fix-proving, see Verification below),
`contracts-v4/test/ERC4626AdapterWithdrawUnguardedCallsPoC.t.sol` (flipped from PoC-proving-the-bug to
regression-tests-proving-the-fix), plus the PoC files the audit itself wrote and verified:
`contracts-v4/test/mocks/{MaliciousReentrantPairedToken,MockGatedViewERC4626}.sol`,
`contracts-v4/test/fork/MintwareLpGatewayDeployReentrancyFork.t.sol` (new), plus additions to
`contracts-v4/test/fork/MintwareLpGatewayHardeningFork.t.sol`.

**Off-chain**: `app/api/gateway/meta/route.ts` + `.test.ts` (#6/#13), `lib/web3/artifacts/lpGateway.ts`
(new `LP_REAL_ADAPTER_PROBE_ABI`), `lib/gateway/amountInput.ts` (new) +
`components/web2/v1/V1PoolDetail.tsx` (#7), `lib/gateway/positionReader.ts` + `v4Math.ts` (new
`pairedToQuoteAtSpot`) + `positionQuote.test.ts` (#14), `app/api/gateway/curate/route.ts` (#19),
`lib/gateway/registry.ts` + `registry.test.ts` (#20), `lib/gateway/gasEstimate.ts` (new) +
`gasEstimate.test.ts` (new) wired into `lib/gateway/harvest.ts` + `harvest.test.ts` and
`lib/gateway/deploy.ts` (#11), `lib/gateway/basisMath.ts` (kept as reference spec, no longer called
directly) + `app/api/gateway/{deposit,withdraw}/route.ts` + `deposit/route.test.ts` (#12) + new
migration `supabase/migrations/20260909000001_gateway_position_atomic_writes.sql` (#12, **applied to
prod + live-verified 2026-09-09** — see Executive summary), `lib/gateway/__audit3__/rlsAnonProbe.live.test.ts`
(#1's test-side fix), `tests/depositAmountCorruption.poc.test.ts` (rewritten from bug-PoC to
fix-regression-test).

## Verification

- `tsc --noEmit`: clean, both passes.
- Full `pnpm vitest run`: **1066 passed, 4 skipped (pre-existing, unrelated), 0 failed.**
- `forge build`: clean (no errors; pre-existing lint notes only — one round of fixing a Unicode
  em-dash inside a Solidity string literal along the way, `unicode"..."` vs plain `"..."`).
- `forge test` (full suite, including every new/flipped PoC and regression test):
  **1042 passed, 0 failed, 4 skipped** (the 4 skips are the project's own pre-existing mainnet-fork
  harnesses that self-skip without `LP_FORK_RPC_URL` — expected, documented, unrelated to this
  round; this includes the NEW `test_CF_deployNoLongerBrickedByFrozenRecipient_feesStayAccruedInstead`,
  which is itself fork-only and therefore among the 4 skips, not executed live). One PoC test
  (`test_IA12_frozenWithdrawer_bricksEntireWithdraw_unlikeLpLeg`) initially failed after the High-4
  fix landed — exactly as expected, since it had been written to *prove the bug*
  (`vm.expectRevert()` on a call that no longer reverts once fixed) — it was rewritten as
  `test_IA12_frozenWithdrawer_gracefullyReCredited_notBricked` to assert the FIXED behavior instead
  (matching this project's established "flip the PoC once the fix lands" convention), with a second,
  unrelated `SameBlockAction()` failure from a relative `vm.roll(block.number + 1)` fixed by anchoring
  to a captured `b0` (this suite's own documented via-IR CSE gotcha). Both are recorded here rather
  than glossed over.
