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

**24 confirmed findings**: 1 Critical, 6 High, 8 Medium, 6 Low, 3 Informational.

**Fixed and verified this session**: the Critical (partially — see below), all 6 High, 2 Medium,
1 Low, plus a documentation reconciliation for a design-intentional item. Every fix is compiled and
covered by tests — see the per-finding table below and the "Verification" section.

**Not fixed this session** (identified, reasoned, recorded — not silently dropped): 1 Critical
(needs production database access this environment does not have), 6 Medium, 5 Low. Each has a clear
reason in the table: either it needs credentials/access unavailable here, or it's a genuine design
trade-off, or it was judged lower-priority relative to the session's time budget. None are fund-loss
bugs — the core "withdrawals never brick, principal is never destroyed" invariant held throughout.

## ⚠️ ACTION NEEDED FROM YOU (the one thing I could not fix myself)

**[CRITICAL] The fee-ledger RLS fix is merged to `main` but was never applied to the live production
Supabase database.** `supabase/migrations/20260908000003_gateway_ledger_view_security.sql` sets
`security_invoker=on` + revokes anon/authenticated/PUBLIC grants on `gateway_fee_balances` and
`gateway_fee_ledger_reconciliation`, and revokes `EXECUTE` on `record_gateway_harvest()`. The SQL is
correct and already reviewed (round-3, commit `debe2c73`) — it was simply never run against the
project. **Live-reproduced today** (2026-09-09): both views return HTTP 200 to the public anon key
(empty today only because `gateway_fee_credits` hasn't been populated yet — the harvest cron that
populates it is already built and merged), and `record_gateway_harvest` is still anon-callable
(stopped only by the underlying table's RLS, a different, unrelated layer).

**I don't have production database credentials in this environment** (no `supabase` CLI configured, no
`DATABASE_URL`/management token in `.env`/`.env.local`) — I could not execute this myself. **To fix it**,
either:
```bash
supabase db push
```
(if you have the CLI + project linked), or paste this migration's contents into the Supabase SQL
editor for project `bqwcwrnqpayfndgmceal`:
`supabase/migrations/20260908000003_gateway_ledger_view_security.sql`

**I did fix what I could without DB access**: `lib/gateway/__audit3__/rlsAnonProbe.live.test.ts` used
to assert the *vulnerable* state (`expect(status).toBe(200)`) as its expected passing result — it
would have kept passing even if this exact fix regressed again later. Flipped to assert the *fixed*
state instead (401/403), so it will fail — correctly — until you apply the migration, and then stand
as a real regression guard. Run it live with `AUDIT_LIVE=1 NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... npx vitest run lib/gateway/__audit3__/rlsAnonProbe.live.test.ts` after applying the fix to confirm.

## Findings & disposition

| # | Sev | Title | File | Status |
|---|---|---|---|---|
| 1 | 🔴 Critical | Fee-ledger view RLS fix merged but never applied to prod DB | `supabase/migrations/20260908000003_...sql` | **NOT FIXED — needs your action, see above.** Test assertions flipped to catch it going forward. |
| 2 | 🟠 High | `deploy()`'s post-swap price re-read never re-checked against the deviation band — a hostile paired-token transfer hook can interleave an unbounded swap and manipulate the price the LP mint is sized off | `MintwareLpGatewayPositionManager.sol:772` | **FIXED.** `ref`/`band` hoisted to function scope; a second band check added right after the post-swap `getSlot0()` re-read, new `DeployPriceMovedOutOfBand` error. |
| 3 | 🟠 High | `deploy()` doesn't bound `swapAmount`/mint sizing against actually-unstaged `quoteGot` — an adapter shortfall underflow-reverts the whole call, and the same off-chain sizing retries forever | `MintwareLpGatewayPositionManager.sol:721` | **FIXED.** `if (quoteGot < quoteToDeploy) revert InsufficientStaged();` right after `quoteGot` is computed, before any swap runs. (This transitively also closes the related Low — see #15 below.) |
| 4 | 🟠 High | A withdrawer whose own address is frozen by the USDG issuer bricks their *entire* withdrawal — the idle leg has no failure isolation, unlike the LP leg | `MintwareLpGatewayPositionManager.sol:619` | **FIXED.** New `idleLegExit` self-call (mirrors the existing `lpLegExit` pattern) wrapped in try/catch; on failure the pulled quote stays in the contract's own balance (already counted by `_idle()`) and the existing re-credit math handles the rest unchanged. New `IdleLegDeliveryFailed` event. |
| 5 | 🟠 High | `MintwareERC4626YieldAdapter.withdraw()` doesn't honor `IYieldAdapter`'s "never reverts" contract — 3 of 4 external calls were unguarded | `MintwareERC4626YieldAdapter.sol:126` | **FIXED.** Entire read-then-redeem sequence moved into a self-call (`_withdrawCore`), `withdraw()` try/catches the whole thing — closes all 3 unguarded calls AND `maxWithdrawable()`'s own reads in one boundary. |
| 6 | 🟠 High | D-4 adapter-kind probe defaulted to `'real'` (false "earns immediately" claim) on *any* read failure, not just a genuine real-adapter signature | `app/api/gateway/meta/route.ts:91` | **FIXED.** Added a positive-confirmation second probe (`perBlockWithdrawCap()`, the real adapter's own distinguishing method) — `'real'` now requires an affirmative success, not merely `depositCap()` failing; both failing → `'unknown'`. This was my own code from earlier this session — a real bug in a fix I'd just shipped. |
| 7 | 🟠 High | Deposit-amount input silently corrupts locale-formatted/pasted numbers (`"1,25"` → `"125"`, a 100x-inflated deposit, no error anywhere in the flow) | `components/web2/v1/V1PoolDetail.tsx:492` | **FIXED.** New `sanitizeAmountInput()` (`lib/gateway/amountInput.ts`) normalizes a lone decimal comma, leaves a comma-with-existing-period alone (so working US-format thousands amounts aren't regressed), collapses to ≤1 `.` so ambiguous input fails loudly via `parseUnits` instead of silently truncating. |
| 8 | 🟡 Medium | `MintwareLpGatewayFactory` didn't disable `renounceOwnership` — the only factory-level incident-response lever (`deactivate()`) could be permanently forfeited | `MintwareLpGatewayFactory.sol:21` | **FIXED.** Same `Ownable2Step` + `revert RenounceDisabled()` pattern already used by every sibling contract. |
| 9 | 🟡 Medium | `MintwareLpGatewayStaging.unstage()` has no defensive wrapper of its own around `adapter.withdraw()` | `MintwareLpGatewayStaging.sol:72` | **Not separately fixed — substantially mitigated by #5.** The adapter itself now genuinely honors "never reverts", closing the root cause; a standalone Staging-level wrapper would be pure defense-in-depth on top of that, judged lower priority this pass. |
| 10 | 🟡 Medium | `deploy()`'s pre-flight `_sweepFees` is unguarded — a frozen/blacklisted `harvestRecipient` bricks *every* future deploy for the 48h rotation window | `MintwareLpGatewayPositionManager.sol:734` | **Not fixed.** Real finding, distinct from #4. `_sweepFees` is shared by withdraw/harvest/deploy, so isolating it safely needs more care than this session's remaining time allowed — flagging for a follow-up pass rather than rushing a shared-code-path change. |
| 11 | 🟡 Medium | Fixed off-chain gas budgets for harvest/deploy/compound can permanently stall automation if a heavier-than-usual token transfer needs more | `lib/gateway/harvest.ts:182` | **Not fixed.** Off-chain ops tuning, no fund risk (cron just fails and can be re-run with a manual gas override); lower priority this pass. |
| 12 | 🟡 Medium | Cost-basis (`entry_nav`) update isn't atomic with its own idempotency claim on deposit/withdraw | `app/api/gateway/deposit/route.ts` | **Not fixed.** Needs a DB transaction/RPC redesign, not a quick patch — recorded for a dedicated follow-up. |
| 13 | 🟡 Medium | (duplicate of #6, same title/root cause, different dimension) | `app/api/gateway/meta/route.ts:91` | **FIXED** — same fix as #6. |
| 14 | 🟡 Medium | Off-chain withdraw quote re-applies the virtual offset *per leg* — the exact pre-round-3-fix formula, over-counting by ≈$1 per exit and causing spurious `SlippageExceeded` reverts on typical small withdrawals | `lib/gateway/positionReader.ts:70` | **FIXED.** `withdrawLegsQuote` rewritten to mirror the CURRENT contract exactly: price the whole claim once (`navW = idle + lpSpotVal`, offset applied once), then split proportionally. New `pairedToQuoteAtSpot` mirror added to `v4Math.ts`. |
| 15 | 🟢 Low | `deploy()`'s `swapAmount` validated against `quoteToDeploy`, not actually-unstaged `quoteGot` | `MintwareLpGatewayPositionManager.sol:768` | **FIXED as a consequence of #3** — `quoteGot >= quoteToDeploy >= swapAmount` is now guaranteed transitively. |
| 16 | 🟢 Low | `compoundQuote()` grows `idle` with no `principalCap` check, unlike deposit/deploy | `MintwareLpGatewayPositionManager.sol:963` | **Reconciled, not code-changed.** Read the code's own reasoning (IA-4, IA-4's own comment) — this is a deliberate, well-argued design choice (pure yield accretion to existing holders, no new exposure) that the *class-level doc comment* contradicted. Fixed the doc comment to state the carve-out explicitly instead of changing working, intentional behavior. |
| 17 | 🟢 Low | `idle` includes unauthenticated raw `balanceOf` — a direct donation can inflate it and grief `principalCap` closed for legitimate depositors | `MintwareLpGatewayPositionManager.sol:371` | **Not fixed.** Real, but Low/owner-recoverable (raise the cap or deploy/compound) per the audit's own severity framing, matching the project's own precedent for the sibling IA-3/IDLE-2 finding. Recorded, not actioned this pass. |
| 18 | 🟢 Low | Deploy cron's idempotency window blocks retries for the rest of the window after ONE failed tx | `lib/gateway/deploy.ts` | **Confirmed safe by the audit itself** — no fix needed (labeled "Confirmed safe" in the original finding). |
| 19 | 🟢 Low | Curator queue `GET` has no declared rate limit | `app/api/gateway/curate/route.ts` | **FIXED.** Added `{ rateLimit: { max: 30, windowMs: 60_000 } }`, matching the existing `discover`/`sparklines` pattern (this closes one instance of the project's own tracked HO-15 backlog). |
| 20 | 🟢 Low | Reactivating a deactivated registry row via `update()` doesn't check whether the write matched a row — a lost race silently logs wrong metadata | `lib/gateway/registry.ts:478` | **Not fixed.** Needs a `count`-aware Supabase call + a new refusal path; judged lower priority than the Highs/Criticals this pass. |
| 21 | 🟢 Low | `gateway_alerts` table doesn't exist in production; failures silently swallowed | `supabase/migrations/20260907000003_gateway_alerts.sql` | **Not fixed — same root cause as #1** (migrations merged but not applied to prod). Apply alongside the Critical migration. |
| 22 | ℹ️ Info | Confirmed: the owner-supplied paired-leg subsidy path is structurally deleted | — | No action — this is a *positive* confirmation the earn-vs-lp decision's core claim holds. |
| 23 | ℹ️ Info | Confirmed fail-closed: curator/cron bearer auth can't fall open in prod | — | No action — positive confirmation. |
| 24 | ℹ️ Info | `LP_GATEWAY_ABI`/`LP_STAGING_ABI`/`LP_IDLE_ADAPTER_PROBE_ABI` verified correct against current contracts | — | No action — positive confirmation. |

## Files changed this session (fixes)

**Contracts**: `contracts-v4/src/gateway/MintwareLpGatewayPositionManager.sol` (findings #2, #3, #4,
#15, #16), `contracts-v4/src/gateway/MintwareLpGatewayFactory.sol` (#8),
`contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol` (#5).

**Contract tests**: `contracts-v4/test/gateway/MintwareLpGatewayFactory.t.sol` (new
`test_renounceOwnership_disabled`), `contracts-v4/test/ERC4626AdapterWithdrawUnguardedCallsPoC.t.sol`
(flipped from PoC-proving-the-bug to regression-tests-proving-the-fix), plus the PoC files the audit
itself wrote and verified: `contracts-v4/test/mocks/{MaliciousReentrantPairedToken,
MockGatedViewERC4626}.sol`, `contracts-v4/test/fork/MintwareLpGatewayDeployReentrancyFork.t.sol`
(new), plus additions to `contracts-v4/test/fork/MintwareLpGatewayHardeningFork.t.sol` and
`contracts-v4/test/gateway/MintwareLpGatewayIdleAdapter.t.sol`.

**Off-chain**: `app/api/gateway/meta/route.ts` + `.test.ts` (#6/#13), `lib/web3/artifacts/lpGateway.ts`
(new `LP_REAL_ADAPTER_PROBE_ABI`), `lib/gateway/amountInput.ts` (new) +
`components/web2/v1/V1PoolDetail.tsx` (#7), `lib/gateway/positionReader.ts` + `v4Math.ts` (new
`pairedToQuoteAtSpot`) + `positionQuote.test.ts` (#14), `app/api/gateway/curate/route.ts` (#19),
`lib/gateway/__audit3__/rlsAnonProbe.live.test.ts` (#1's test-side fix), `tests/depositAmountCorruption.poc.test.ts` (rewritten from bug-PoC to fix-regression-test).

## Verification

- `tsc --noEmit`: clean.
- Full `pnpm vitest run`: **1053 passed, 4 skipped (pre-existing, unrelated), 0 failed.**
- `forge build`: clean (no errors; pre-existing lint notes only — one round of fixing a Unicode
  em-dash inside a Solidity string literal along the way, `unicode"..."` vs plain `"..."`).
- `forge test` (full suite, including every new/flipped PoC and regression test):
  **1040 passed, 0 failed, 4 skipped** (the 4 skips are the project's own pre-existing mainnet-fork
  harnesses that self-skip without `LP_FORK_RPC_URL` — expected, documented, unrelated to this
  round). One PoC test (`test_IA12_frozenWithdrawer_bricksEntireWithdraw_unlikeLpLeg`) initially
  failed after the High-4 fix landed — exactly as expected, since it had been written to *prove the
  bug* (`vm.expectRevert()` on a call that no longer reverts once fixed) — it was rewritten as
  `test_IA12_frozenWithdrawer_gracefullyReCredited_notBricked` to assert the FIXED behavior instead
  (matching this project's established "flip the PoC once the fix lands" convention), with a second,
  unrelated `SameBlockAction()` failure from a relative `vm.roll(block.number + 1)` fixed by anchoring
  to a captured `b0` (this suite's own documented via-IR CSE gotcha). Both are recorded here rather
  than glossed over.
