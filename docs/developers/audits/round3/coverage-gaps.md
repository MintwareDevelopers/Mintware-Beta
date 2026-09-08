# Round-3 coverage close-out — LP Gateway contracts

**Date:** 2026-09-08 · **Scope:** `contracts-v4/src/gateway/{MintwareLpGatewayPositionManager,MintwareLpGatewayStaging,MintwareLpGatewayFactory}.sol`
**Method:** `forge coverage` over the combined gateway suites, plus a selector-level cross-reference of every
custom `error` against `vm.expectRevert(...selector)` across **all** test directories.
**New tests:** [`contracts-v4/test/audit3/CoverageGapRevertPaths.t.sol`](../../../../contracts-v4/test/audit3/CoverageGapRevertPaths.t.sol) — 21 cases, all green.

> Nothing under `contracts-v4/src/` was modified. No commits, no pushes.

---

## 1. Method — why line coverage alone was not the test

Two signals were combined, because either one alone under-reports:

1. **`forge coverage`** (line / branch / function) over the gateway contracts, run in stages
   (`test/gateway/*`, `test/audit3/*`, `test/audit/*`, `test/fork/MintwareLpGateway*`) and **unioned** —
   a line hit by a fork-only test counts as covered. Staging was necessary because `forge coverage`
   needs `--ir-minimum` on this tree (the payments library hits *stack too deep* with the optimizer
   off) and the full `audit`+`audit3` match set then fails to compile with a Yul stack error of its own.

2. **A selector cross-reference.** For each of the 23 + 5 + 7 custom errors declared in the three
   contracts, grep every test file for `vm.expectRevert(<Contract>.<Error>.selector)` (and the
   `assertEq(sel, ...selector)` form the ExploitReplay harnesses use).

Signal 2 is the sharper one, and it is the reason several gaps below were invisible to signal 1: **a
revert line can be "covered" by a test that triggers it without asserting which error came back**
(a bare `vm.expectRevert()`, or an invariant handler that only records the failure). That is a strictly
weaker guarantee — a refactor can swap the guard for a different or wrong error and nothing fails.
A selector with *zero* asserting test anywhere is a real, reportable gap regardless of line coverage.

The gateway contracts contain **no `require(...)` and no `revert "string"`** — every failure path is a
custom error, so the selector inventory is complete by construction.

---

## 2. Coverage summary

<!--COVERAGE-->

---

## 3. Findings

Every uncovered line reported by the tooling was read in source and classified (a) dead / unreachable,
(b) a revert or edge condition with real behavioural meaning and no asserting test, or (c) a trivial
getter / view not worth a dedicated test. Only (b) was closed.

### 3.1 Category (b) — real gaps, CLOSED

All eleven are guards whose selector was asserted **nowhere** in the combined suite. Each is closed by a
named test in `contracts-v4/test/audit3/CoverageGapRevertPaths.t.sol`.

| # | Contract | Guard (source line) | Why it matters | Closing test |
|---|---|---|---|---|
| B-1 | PositionManager | `QuoteNotInPool` (L214) | **Zero assertions anywhere.** Stops a curator wiring a gateway whose quote asset is in neither pool slot — an instance that can stage capital but could never price or deploy it (`LiquidityAmounts` would size the wrong leg). | `test_ctor_rejectsQuoteAssetNotInPool` + `test_ctor_acceptsQuoteAssetInPool` (the mirror, so the guard is shown to reject on *membership*, not an incidental key property) |
| B-2 | PositionManager | `ZeroAddress`, six-arg ctor check (L201–205) | Only the *native-ETH-paired* branch (L221) and `proposeHarvestRecipient(0)` were asserted; the six-way arg check that runs first had none. A zero `harvestRecipient_` is the money case — `_sweepFees` transfers every collected fee to it unconditionally, so the whole fee stream of the instance would burn. | `test_ctor_rejectsZero{PoolManager,PositionManager,Permit2,Staging,QuoteAsset,HarvestRecipient}` (6 tests) |
| B-3 | PositionManager | owner seat `address(0)` | Guarded by OZ `Ownable`, **not** by the gateway's own `ZeroAddress` — an undocumented asymmetry. Pinned so the distinction stays deliberate. | `test_ctor_rejectsZeroOwner_viaOwnable` |
| B-4 | PositionManager | `ZeroAmount` in `compoundQuote` (L786) | `ZeroAmount` was asserted for `deposit` / `withdraw` / `deploy` only. Every existing `compoundQuote` caller (both invariant handlers, the outage rig, the unit suite) bounds the amount to ≥ 1, so the accretion path's guard was never exercised. Without it a zero compound falls through to `staging.stage(0)` and surfaces the *staging* error instead. | `test_compoundQuote_zeroAmount_reverts` |
| B-5 | Staging | `ZeroAddress` ctor, both args (L42) | Zero assertions. `MintwareLpGatewayStaging.t.sol` covers the controller/deployer seats and best-effort unstage, never the zero cases. | `test_staging_ctor_rejectsZeroQuoteAsset`, `test_staging_ctor_rejectsZeroAdapter` |
| B-6 | Staging | `ZeroAddress` in `setController` (L51) | Zero assertions. Stops an operator typo wiring a dead sink; the test also asserts **no partial write** on the rejected path and that the seat stays settable afterwards. | `test_staging_setController_rejectsZero` |
| B-7 | Staging | `ZeroAmount` in `stage` (L57) | Zero assertions. | `test_staging_stage_zeroAmount_reverts` |
| B-8 | Staging | `ZeroAmount` in `unstage` (L67) | Zero assertions. | `test_staging_unstage_zeroAmount_reverts` |
| B-9 | Staging | `unstage`'s `returned > 0` **false** branch (L74) | Not a revert — an *edge condition*, and a load-bearing one. Round-3 X-3 measures what actually landed rather than trusting the adapter's return value; a **fully** illiquid source must return 0 without reverting and without transferring. This is exactly the branch the gateway's best-effort withdraw leg relies on to re-credit shares instead of bricking. The existing staging test only ever exercised a **partial** cap (30k of 100k). | `test_staging_unstage_fullyIlliquidSource_returnsZeroWithoutReverting` (asserts return 0, no transfer, principal untouched, `Unstaged(amount, 0)` emitted) |
| B-10 | Factory | `ZeroAddress` ctor, all three args (L61–63) | Zero assertions; line 62 was flatly uncovered. | `test_factory_ctor_rejectsZero{PoolManager,PositionManager,Permit2}` (3 tests) |
| B-11 | Factory | `deactivate` owner gate (L127) | Untested. Only `createGateway`'s gate was covered, and with a bare `vm.expectRevert()` (no selector). Retiring an instance is a curation decision — the app layer routes deposits off the registry's `active` flag, so a stranger flipping it is a real availability lever. | `test_factory_deactivate_onlyOwner` (asserts `OwnableUnauthorizedAccount`, that `active` is untouched by the failed attempt, and that the owner still can) |

### 3.2 Category (a) — DEAD CODE finding

**Finding CG-1 — three unreachable `_refSqrtPrice == 0` branches, and a stale comment that still describes
the pre-round-3 behaviour.** Informational; no fix applied (`src/` is out of scope for this pass).

Round-3 XR-2 made the constructor read `getSlot0`, revert `PoolNotInitialized` when it answers zero, and
anchor `_refSqrtPrice` to it (L245–250). That makes the follower reference **non-zero from creation, forever**,
which in turn makes three defensive branches unreachable:

| Site | Branch | Status |
|---|---|---|
| `_anchorFollow` L345–351 | `if (ref == 0) { … }` — the "no reference yet" bootstrap | unreachable |
| `_refOrSpot` L368–369 | `ref == 0 ? spot : ref` — the `spot` arm | unreachable |
| `deploy` L680–684 | `if (ref != 0)` — its implicit `else`, i.e. an **unbanded first deploy** | unreachable |

`_refSqrtPrice` is written in exactly two places (the constructor and `_anchorFollow`) and can never return
to zero afterwards: `maxStep = ref × maxDeviationBps / 10_000` with `maxDeviationBps ≤ 5000`, so `maxStep ≤ ref/2`
and the worst-case step lands at `ref − ref/2 > 0`. Even a spot of 1 wei only walks it down by half per block.

This is *harmless* defensive code, and there is a reasonable argument for leaving it as belt-and-braces. Two
things are worth acting on separately:

1. **The comment at L674–677 in `deploy` is now false.** It reads "No reference exists before the first deploy
   (the first deploy sets the anchor) — there the caller's `minLiquidity` is the guard". Since XR-2 the
   reference *does* exist before the first deploy, and the first deploy **is** banded like every later one. A
   reader relying on that comment would conclude the first deploy is unbanded and reason about `minLiquidity`
   as the sole guard, which is the pre-XR-2 threat model. Recommend updating the comment when `src/` next opens.
2. **The invariant is now untested.** Nothing asserted that the constructor leaves the follower anchored, so
   removing the ctor anchor would silently resurrect an unbanded first deploy with no test failing.
   `test_refAnchoredAtConstruction_makesZeroRefBranchesUnreachable` pins it: the reference and the entry-mark
   memory are non-zero at construction, the anchor block is the creation block, and 50 bounded follow-steps
   against a spot driven to 1 wei still leave the reference strictly positive.

### 3.3 Category (c) — not worth a dedicated test

Left alone deliberately: `poolKey()`, `referencePrice()`, `sourceReadable()`, `totalNav()`, `poolCount()`,
the `poolIds` / `instanceForPool` / `adapterUsed` / `sharesOf` public getters, and the internal V4 calldata
encoders (`_mintCalls`, `_increaseCalls`, `_permit`, `_revokePermit`, `_modify`). These are either pure
accessors or thin encoding wrappers whose behaviour is asserted transitively by every fork test that
successfully mints, increases, harvests and exits a real position — a dedicated unit test would assert the
encoding against itself.

### 3.4 Not a gap (checked and dismissed)

- **`SlippageExceeded` on the deposit side** looked thin (most hits are withdraw-side), but
  `InvariantIdleOnly.t.sol:260` asserts it for `depositWithMin` and `:348` for `withdrawWithMin`. Both covered.
- **`ZeroShares` in `deploy` (L689, `liquidity == 0`)** is distinct from the `_deposit` site (L443); both are
  asserted (`InvariantForkLP.t.sol:829` and `:545` respectively).
- **`NotSelf`** is asserted, but via `assertEq(a.err, …selector)` in `ExploitReplayIntegrationA.t.sol:205`
  rather than `vm.expectRevert` — the grep had to cover that form too.
- **No `require(...)` and no `revert "string"`** exist in `src/gateway/`, so the custom-error inventory
  (23 + 5 + 7) is the complete failure-path surface. The 23 PositionManager errors match the list this pass
  started from — none have been added since.

---

## 4. New tests

`contracts-v4/test/audit3/CoverageGapRevertPaths.t.sol` — **21 cases, 21 passed, 0 failed**.

```
test_ctor_rejectsQuoteAssetNotInPool                        test_staging_ctor_rejectsZeroQuoteAsset
test_ctor_acceptsQuoteAssetInPool                           test_staging_ctor_rejectsZeroAdapter
test_ctor_rejectsZeroPoolManager                            test_staging_setController_rejectsZero
test_ctor_rejectsZeroPositionManager                        test_staging_stage_zeroAmount_reverts
test_ctor_rejectsZeroPermit2                                test_staging_unstage_zeroAmount_reverts
test_ctor_rejectsZeroStaging                                test_staging_unstage_fullyIlliquidSource_returnsZeroWithoutReverting
test_ctor_rejectsZeroQuoteAsset                             test_factory_ctor_rejectsZeroPoolManager
test_ctor_rejectsZeroHarvestRecipient                       test_factory_ctor_rejectsZeroPositionManager
test_ctor_rejectsZeroOwner_viaOwnable                       test_factory_ctor_rejectsZeroPermit2
test_compoundQuote_zeroAmount_reverts                       test_factory_deactivate_onlyOwner
test_refAnchoredAtConstruction_makesZeroRefBranchesUnreachable
```

No file under `contracts-v4/src/` was touched; no existing test was modified.

