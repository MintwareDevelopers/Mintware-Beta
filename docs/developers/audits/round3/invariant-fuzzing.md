# Round 3 — stateful invariant fuzzing of `MintwareLpGatewayPositionManager`

**Date:** 2026-09-08 · **Branch:** `audit/round3-exploit-replay` · **Measured on:** HEAD `c11d8fd3` with a CLEAN
`contracts-v4/src` (the concurrent, uncommitted working-tree edits to the PM are covered separately in §7).
**Spec:** [`lp-gateway-external-audit-scope.md` §6](../../lp-gateway-external-audit-scope.md) (the 16 invariants).

Every prior round was scenario tests. This is the first **stateful** (multi-actor, randomly interleaved,
ghost-variable) fuzzing of the PM. It found **one real value-creation bug (F1)**, one **spec-level dead guard (F1-b,
same root cause)**, one **source-dependent griefing vector at the adapter seam (F2)**, and a **rounding path by
which the cost-basis cap can be exceeded (F3-b)**. Everything else in scope §6 that was encoded — pro-rata exit,
H-02 fee ordering, principal slice, cost-basis monotonicity, follower band, last-holder clean state, solvency,
share conservation, the exact revert set incl. "withdraw never reverts on third-party failure", `lastKnownIdle`
conservativeness, and the fee-net dilution bound — **held** under the fuzzer, on both decimal pairings.

## 0. Post-fix status (2026-09-08) — re-run against the ROUND-3-FIXED source

The lead fixed the PM/Staging after §3–§4 were written (pool-initialised check + follower anchored at creation,
entry-mark memory, the single-offset `_withdraw`, `StageShortfall`, `DeployNotTwoSided`, deferred re-stage, the
20 % outage haircut, balance-diff `unstage`), and — **second pass, same day** — fixed the two residuals the first
post-fix campaign found (**R3-INV-1** per-leg re-credit, **R3-INV-2** parked quote inside NAV). The §7 harness deltas
plus the §0.3 second-pass deltas were applied to both campaign suites and **everything was re-run at the same depths
as §3** (Suite A 256 × 128 fee-free + 128 × 96 fee source = 32,768 + 12,288 handler calls per invariant; Suite B
8 × 24 per pairing = 192; plus the 3,000- / 800-call deterministic witnesses). Commands unchanged (§1). **Everything
below the §0 line is the ORIGINAL pre-fix analysis, kept as-is.**

### 0.1 Verdicts

| Finding | Status | Evidence (post-fix) |
|---|---|---|
| **F1** per-leg VIRTUAL double count (phantom re-credit) | **FIXED** | A3/A4/A5/B2 green; `nPhantomReCredits == 0` over 315 + 315 + 159 + 159 witness withdraws; `test_R3_F1a_partialExit_…_FIXED` burns exactly 590,214,548 shares (pre-fix 590,212,458), `test_R3_F1a_cycleDrain_…_FIXED` attacker P&L **0** after 200 cycles (pre-fix +$100.24), `test_R3_F1c_…_FIXED` keeps **0** shares (pre-fix 333,330) |
| **F1-b** dead `SourceUnavailable` refusal | **FIXED** | A6 green (refusal predicted for every size); `test_R3_F1b_…_FIXED`: `withdraw(1)` AND `withdraw(15,091,932)` both revert during the outage, the same `withdraw(S)` delivers in full once readable (slot not consumed) |
| **F2** empty-source donation inflation via the adapter | **FIXED** (XR-3) | `test_R3_F2_…_StageShortfall_FIXED`: `deposit(1,312,889,136,061)` reverts `StageShortfall` (0 source shares would mint); every `A ≤ D` refused; first passing deposit loses exactly `r/(m+1) = D/21` = 108,510,846,880 raw (0.23 %, inside the 50 bps gate); the donation is stranded in the source's virtual share |
| **F3** adapter over-delivers < 1 source share | **ACCEPTED** (unchanged, still true) | `test_R3_F3_…` green as before |
| **F3-b** cost basis 1–2 wei over the cap via over-delivery | **ACCEPTED** (wei-level) | `test_R3_F3b_…_ACCEPTED`: still 2 wei over on the pinned sequence, bounded by one source share; B6 tolerance `+ srcP` on the `dp` increment |
| **R3-INV-1** exit weight favoured the exiter when the LP leg was undelivered | **FIXED** (second pass) | `test_R3_INV1_lpLegDeferred_exitWeightAboveSpot_idleLegPricedAtLowMark_FIXED`: same sequence, bob now burns **18,985,019,568** shares for 24,999,958,333 raw of idle cash worth **18,985,010,765** shares at spot (pre-fix **16,666,666,666**) — the 8,803 excess is exactly the virtual-offset term `fair·V·(nav_w−nav_s)/(nav_s·nav_w)`, pool-favourable; bob's spot claim + cash ≤ his whole pre-exit claim; alice 131,682,613,421 → 131,682,619,826 (not diluted). B2 now also asserts the **exact per-leg re-credit shadow** on every fuzzed exit (0 violations, 318 LP-leg exits witnessed incl. 118 deferred) |
| **R3-INV-2** deferred re-stage parked quote OUTSIDE NAV | **FIXED** (second pass) | `test_R3_R32_restageDeferred_leftoverParked_insideNav_paidFirst_consumedFirst_FIXED`: 14,333,618,375 raw parked → `totalNav == staged + parked + LP`; an OUTAGE exit (source unreadable, paired paused) still delivers **5,594,219,258** raw of idle from the parked quote; bob's 50k entry mints 38,232,164,235 shares against the parked-inclusive NAV (43,207,457,132 if parked were outside it); the 1k deploy consumes parked quote first and bob's claim moves by **286,567,531** raw = his share of the owner-donated paired leg only (pre-fix ≥ 4,979,971,247 = his ⅓ of the parked quote). Witness: 4 + 1 exits paid from parked quote, 1 + 1 deploys consumed parked quote |
| **R3-INV-3** unset entry bucket read as the extreme mark | **NEW residual — MEDIUM (bounded window)** | `test_R3_INV3_entryMemoryUnsetBucket_zeroHolderMark_quoteIsCurrency0_depositsUnderMinted_RESIDUAL` (§0.4); campaign in the window (`A3_FORK_PERIOD_PARITY=even`): **B8 fails on both pairings** with 2–3-call shrunk sequences, every other invariant green |
| zero-value exit (harness) | detector gap, closed | fee-source A4 fired on `deposit(16,384) · withdraw(16,383) · withdraw(1)` — the last share is worth 0 and the per-leg rule returns it; `test_R3_zeroValueExit_nothingDelivered_allSharesReturned` pins it as SPECIFIED behaviour (value-neutral, < 1 raw unit) |

### 0.2 Campaign results on the fixed source (second pass)

Suite A (idle-only, production adapter) — **9 / 9 green on both variants**, 0 prediction mismatches, 0 handler reverts:

| # | Invariant | Fee-free 256×128 | 10 bps 128×96 | Pre-fix |
|---|---|---|---|---|
| A1 | Σ `sharesOf` == `totalShares` | PASS | PASS | PASS |
| A2 | Σ floor-claims ≤ NAV + V | PASS | PASS | PASS |
| A2b | `totalShares` ≤ NAV + (scaled) source rounding | PASS | n/a | FAIL (F1/F2) |
| A3 | no value creation per actor | PASS | PASS | FAIL (F1) |
| A4 | re-credit never mints value + **`nPhantomReCredits == 0`** + zero-value exits return every share | PASS | PASS | FAIL (F1) |
| A5 | no principal loss (inflation defence) | PASS | PASS (fee-adj.) | FAIL (F1/F2) |
| A6 | revert set exact, incl. `StageShortfall` + refusal | PASS | PASS | FAIL (F1-b) |
| A7 | `lastKnownIdle` conservative | PASS | PASS | PASS |
| A8 | dilution ≤ fee term + rounding | PASS | PASS | PASS |

Witness (3,000 calls): 219 deposits / 315 withdraws / 237 donations, 213–217 capped-or-stalled withdraws, 209
outage attempts (all refused as predicted), **0 phantom re-credits**, 1 `StageShortfall` (the F2 prefix), 0
mismatches, 0 re-credit / dilution violations, 0 zero-value exits (the branch is reached by the campaign — seed
`0x6012…` — and pinned deterministically in the regression).

Suite B (real v4, Robinhood-testnet fork) — **10 / 10 green on both pairings** at 8 × 24 (B8 is new):

| # | Invariant | 18×18 | 6×18 | Pre-fix |
|---|---|---|---|---|
| B0 | shares + solvency at spot | PASS | PASS | PASS |
| B1 | pro-rata exit: removed == `min(liq, liq·lpEntitled/lpVal_w)`; LP leg fails only on third-party failure | PASS | PASS | PASS |
| B2 | re-credit never mints value (whole-balance, at spot) + F1 detector at `w` + **exact per-leg re-credit shadow** | PASS | PASS | FAIL (F1) |
| B3 | last-holder clean state | PASS | PASS | PASS |
| B6 | cost-basis cap (+ `srcP` for F3-b), `dp` only in deploy/withdraw by the LIQUIDITY fraction, principal (idle incl. parked + LP-at-cost) conserved, leftover parked only when the source had no room | PASS | PASS | FAIL (F3-b) |
| B7 | follower: ≤ band/block, once/block, anchored from creation, untouched by swaps | PASS | PASS | PASS |
| **B8** | **holder mark == spec mark `max(spot, ref, populated entry memory)` on every deposit / exit** (new) | PASS | PASS | — (**FAIL in the R3-INV-3 window**, `A3_FORK_PERIOD_PARITY=even`) |
| B9 | revert set exact incl. `StageShortfall` / source-cap / `DeployNotTwoSided` / band on first deploy / **`WrappedError` for a paused paired token inside a v4 take** | PASS | PASS | PASS |
| B10 | H-02 fee ordering + principal slice exact (idle = source unstage + parked quote) | PASS | PASS | PASS |
| B16 | value out ≤ spot claim (6×18) | PASS | PASS | PASS |

Witness (800 calls + the parked-quote prefix, per pairing): 68 deposits / 159 withdraws (all with an LP leg) /
36–37 deploys / 25 harvests / 80 swaps / 56 pokes, 59 LP-leg deferrals under third-party failure, 16 outage
withdraws (haircut modelled), 112–123 deposits priced at an entry mark ABOVE spot, 144–160 exits weighted above spot,
25 source-cap refusals, 1–2 `RestageDeferred` (max parked 46,377,884,633 raw at 6×18 / 30,000e18 at 18×18), **4 + 1
exits paid from parked quote, 1 + 1 deploys that consumed parked quote first**, 0 prediction mismatches, 0
pro-rata / fee-ordering / principal-slice / cap / follower / mark-spec violations, **0 F1 phantoms, 0 re-credit
violations of ANY class (the R3-INV-1 class went from 49–50 to 0), 0 per-leg re-credit shadow violations, 0 handler
frame reverts, block clock in sync** (all asserted by the witness).

### 0.3 Harness corrections (first pass: two were harness bugs the pre-fix report mis-attributed; second pass: three more)

- **A4 / B2 compared the wrong baseline.** The pinned check was `claim_after(REMAINING shares) + delivered ≤
  claim_before(WITHDRAWN shares)`, which can only hold on a full exit — the fixed-source witness fired it on
  **315 / 315** withdraws with **0** phantom re-credits. It now compares against the actor's WHOLE pre-exit claim
  (`idle` for a last holder), and the F1 property is asserted directly (`nPhantomReCredits == 0`; in Suite B: no
  re-credit when the delivery valued at `w` covers the claim). The §3 A4/B2 FAIL rows were therefore a harness
  artefact layered on F1; F1 itself was real (its exact numbers are in the flipped regressions).
- **A2b's absolute slack was unsound.** Proportional share accounting preserves a rounding deficit as a RATIO: a
  29-unit stage-rounding loss was scaled to 13.9M units by a later 528k-USDG deposit (nobody gained — the depositor's
  claim is exactly their deposit). The bound is now scaled by `(nav_after+V)/(nav_before+V)` on every deposit.
- **Fee source: the retained exit fee is yield.** `Audit3FlakySource.redeem` keeps the fee in the vault, so it
  accrues to the remaining source holders; the ghost now credits it pro-rata (A3 in the fee variant was failing on
  this alone once F1 was fixed — 288M raw on a 2.5e12 exit).
- New witness prefix (donate → dust deposit) so `StageShortfall` is provably exercised; new Suite-B lever
  `setSourceSupplyCap` (hard-closed / tight) so the source-cap refusal and `RestageDeferred` are reachable.
- Value checks in Suite B are at SPOT (the slice's composition is whatever v4 returned at spot; valuing it at `w`
  over-states it by convexity — the tangent at `w` lies below the constant-L curve).
- **(2nd pass) B7 / B9 after the R3-INV-1/2 fixes were HARNESS false alarms, not regressions.** Shrunk: B7 "clamped
  follower stepped wrong" and B9 "`SameBlockAction` predicted but `SlippageExceeded` thrown" both reduced to the PM's
  clock being ONE BLOCK AHEAD of the handler's `blk` counter. Cause: a handler FRAME that reverted after its
  `_roll(1)` had `blk += 1` rolled back by the EVM while the `vm.roll` cheatcode's `block.number` change persisted —
  from then on every "new block" the handler rolled landed on the block the PM had already seen. The frame reverts
  were themselves a harness bug: with the holder mark at 0 (R3-INV-3, below) `_p2q(pairedOut, w = 0)` hit v4
  `FullMath`'s empty `revert(0,0)` (division by zero). Fix: `_roll` re-syncs from `vm.getBlockNumber()` (an external
  call — via-IR cannot CSE it across `vm.roll`), every gateway action re-reads it first, the `deploy` handler no
  longer mints a paused paired token to itself, `_p2q` is guarded at mark 0, and the witness **asserts 0 handler frame
  reverts and `vm.getBlockNumber() == h.blk()`** so the desync can never recur silently.
- **(2nd pass) B9 "unexpected revert in harvest" was a SELECTOR gap.** A paused paired token failing inside a v4
  `take` (the H-02 sweep's `TAKE_PAIR`, 822,855 wei of fees on the shrunk 6×18 sequence `compound · donate ·
  deploy(9957 raw, 1.03e9 wei) · sell paired · pause · harvest`) surfaces as ERC-7751 **`WrappedError`**
  (`0x90bfb865`, v4-core `CurrencyLibrary.transfer` → `CustomRevert.bubbleUpAndRevertWith`), not `Error(string)`
  (`0x08c379a0`). The PM's OWN `safeTransfer` / `safeTransferFrom` failures (frozen recipient forward, paired leg
  pull) still bubble the raw `Error(string)`. `harvest` / `deploy` now predict the two selectors in the order the
  contract meets them (take of paired fees → forward of quote fees → pull of the paired leg).
- **(2nd pass) A4 "phantom" on a zero-value exit.** `fromIdle == 0` (S shares worth < 1 raw unit, empty /
  fee-drained source): the per-leg rule returns every share; the detector had counted "fully paid (0 ≥ 0) but not
  burned" as a phantom. Now: `fromIdle == 0` ⇒ assert every share returned (`zeroValueExitViolations == 0`), else the
  phantom detector. Same guard in Suite B (`claimTotal == 0`).
- **(2nd pass) Modelled the R3-INV-2 source change exactly**: `_idle()` = staged + parked in every prediction (deposit
  NAV, exit idle leg, deploy cap `principal`), deploy consumes parked first (`fromParked = min(parked, q)`, only the
  remainder unstaged), principal-slice check credits `parkedOut` next to `srcOut`, principal conservation no longer
  double-counts the parked quote, and a deterministic parked-quote PREFIX (stage 200k → hard-close → deploy 60k vs
  30k paired → exit paid from parked → deposit priced parked-inclusive → deploy consuming parked) runs before the
  random witness tail so the three fixed paths are provably reached.
- **(2nd pass) Deterministic entry-period parity.** The PM's two entry-high buckets alternate on
  `block.number / 300` parity, so a live fork block picked R3-INV-3's window at random per run (that is why the first
  post-fix run's counts differed from this one and why the desync was intermittent). Both fork suites now roll to
  the START of the next ODD period before constructing the PM (`A3_FORK_PERIOD_PARITY=even` builds inside the
  window); the regressions do the same via `_buildAt(dec, evenPeriod, forceQ0)`.

### 0.4 Residuals — R3-INV-1 / R3-INV-2 FIXED (flipped), R3-INV-3 NEW (real, pinned)

**R3-INV-1 — FIXED.** `_withdraw`'s re-credit is now per leg: an undelivered idle remainder is re-credited against
the claim at the HIGH mark `w` (`shares·(fromIdle − idleGot)/(fromIdle + lpEntitled_w)`); a FAILED LP leg against
the claim at the LOW mark `min(valueAt(spot), valueAt(ref))` (`shares·lpEntLow/(fromIdle + lpEntLow)`,
`lpEntLow = claimTotal·lpValLow/nav_w`); nothing delivered ⇒ every share back; total capped at `shares`. On the
pinned sequence bob burns `S·idle/nav_low` = **18,985,019,568** shares for the same 24,999,958,333 raw of idle cash
(worth 18,985,010,765 shares at spot; pre-fix 16,666,666,666): the exiter can no longer cash idle out at the holder
mark. Flipped test: `test_R3_INV1_lpLegDeferred_exitWeightAboveSpot_idleLegPricedAtLowMark_FIXED`. The 800-call
witness that produced 49–50 violations of this class now produces **0 of any class**, and the exact per-leg shadow
matches on all 318 LP-leg exits (118 deferred).

**R3-INV-2 — FIXED.** `_idle()` = `stagedAssets() + quoteAsset.balanceOf(pm)`, so a deferred re-stage's leftover is
priced into every NAV; `_withdraw` pays the idle leg from the parked quote FIRST (no source read — it pays during an
outage) and unstages only the remainder while readable; `deploy` consumes parked quote first. Flipped test:
`test_R3_R32_restageDeferred_leftoverParked_insideNav_paidFirst_consumedFirst_FIXED` (numbers in §0.1).

**R3-INV-3 — an UNSET entry-memory bucket is read as the extreme holder mark on a quote-is-currency0 pool —
MEDIUM (bounded window, deterministic, no attacker needed).** `_marksHigher(a, b)` returns `quoteIsCurrency0 ? a < b :
a > b` and guards only `b == 0`. `_entryHigh()` does `h = _entryHighA; if (_marksHigher(_entryHighB, h)) h =
_entryHighB;` — with bucket B still 0 (never written) and A set, `0 < A` is TRUE on a q0 pool and `_entryHigh()`
returns **0**; `_holderMark(spot)` then runs `_marksHigher(0, m)` → `0 < m` → **mark 0**. sqrtPrice 0 puts the
position past its all-quote range edge, so `_deployedQuoteValueAt(0)` = the position's MAXIMUM possible quote
content (2.08× spot value on the ±23,040-tick range: **208,216,667,870 vs 99,999,999,998** raw in the pinned test).
Window: a gateway created in an EVEN period (`block.number / ENTRY_MEMORY_BLOCKS` — the constructor writes bucket A
only) on a pool where `quote < paired`, from creation until the first follower step in the next period (≤ 300 blocks
≈ 1 h at the L1 cadence); once B is written it can never be 0 again, and an ODD-period creation writes B first and
takes the `b == 0` guard (`test_R3_INV3_oddCreationPeriod_noZeroMarkWindow`). ~¼ of gateways (parity × address
order) have the window; it bites only if a deploy happens inside it.

Shrunk sequence (`test_R3_INV3_entryMemoryUnsetBucket_zeroHolderMark_quoteIsCurrency0_depositsUnderMinted_RESIDUAL`,
6-dp quote, real v4, even creation period, `referencePrice().entryHigh == 0` right after construction):
`deposit(alice, 100,000e6)` · `deploy(50,000e6, 50,000e18)` · `deposit(bob, 100,000e6)` → bob is minted
**38,727,404,218** shares where the spec mark (spot = ref, no price move) mints **66,666,888,888** (−42 %); his spot
claim for 100,000 USDG is **69,790,248,337** raw and alice, who did nothing, gains **30,209,449,569** raw. A client
that sets `minSharesOut` off `totalNav()` (spot) is refused `SlippageExceeded` instead — a deposit DoS for the window
rather than a loss. The exit weight is 0 in the window too (E-2 re-credit for an undelivered idle leg is sized against
the maximum LP mark — exiter-unfavourable, pool-favourable). Campaign-level reproduction: `A3_FORK_PERIOD_PARITY=even`
→ **B8 fails on both pairings** (2–3-call sequences: `deposit · deploy · deposit/withdraw`), 128 zero-mark deposits /
166 zero-mark exits in the witness, everything else green. Fix direction (not applied — `src/` out of scope): make
`_marksHigher` treat `a == 0` as "not a price" (`if (a == 0) return false;` before the `b == 0` case), or have
`_entryHigh()` / `_holderMark()` skip unset buckets; the harness's `_specMark` is the reference semantics and B8 will
go green on the even parity when the fix lands (also flip the `_RESIDUAL` test and drop the `even` guard in the
witness). Related, not a finding: the constructor's `_recordEntryHigh(s)` writes ONE bucket, so the "current +
previous period" memory is half-populated for the first period on every gateway regardless of parity.

**Invariant 15 guard exercised.** `test_R3_INV15_outOfRangeDeploy_allQuoteMint_refused_DeployNotTwoSided`: pool
pushed past the all-quote edge, follower walked into band with 40 permissionless `poke()`s, `deploy(10k, 0)` and
`deploy(10k, 10k paired)` both revert `DeployNotTwoSided` (checked on USED amounts — offered paired that is not
used out of range does not satisfy it); staged capital untouched. In-range mints are balanced by construction, so
the guard bites only in the attack shape — which is why the random campaign never hits it (0 refusals in 800 calls).
Dust note: `deploy(9,957 raw, 1.03e9 wei)` passed it with `pairedUsedVal == 0 < 1·bps/1e4 == 0` — at dust scale
the integer check is vacuous (`deployedPrincipal = 1`); immaterial, recorded for completeness.

### 0.5 What changed in the harness files (for the next re-run)

`InvariantMocks.sol` (+ `setSupplyCap` / `maxDeposit`), `InvariantIdleOnly.t.sol` (StageShortfall prediction,
single-offset entitlement capped at `idle`, whole-balance A4 + `nPhantomReCredits`, `deficitBound`, fee-retained
yield, witness prefix; **2nd pass:** zero-value-exit branch in the phantom detector + `nZeroValueExits` /
`zeroValueExitViolations`), `InvariantForkLP.t.sol` (holder-mark deposit NAV via `referencePrice()`, `w`-weighted
exit split + `liqToRemove`, 80 % outage haircut, follower-from-creation, `_predictMint` for
`ZeroShares`/`DeployNotTwoSided` from round-up tick-branch amounts, parked-leftover accounting, source-cap lever,
B2 attribution counters; **2nd pass:** `vm.getBlockNumber()` clock (`_roll`/`_tick`), parked-inclusive `_readable()`,
parked-first `_predictMint`, `parkedOut` in the principal slice, exact per-leg re-credit shadow, `WRAPPED` selector,
`_specMark` + B8, zero-mark guard, deterministic period parity in `setUp` (+ `A3_FORK_PERIOD_PARITY`), parked-quote
witness prefix, `A3_WITNESS_STOP`, `last*` violation diagnostics, witness asserts no frame reverts / clock in sync /
0 re-credit violations of any class), `InvariantRegressions.t.sol` (flipped to `_FIXED`; **2nd pass:** +
`test_R3_zeroValueExit_…`), `InvariantForkRegressions.t.sol` (flipped to `_FIXED` / `_ACCEPTED`, invariant-15 test;
**2nd pass:** R3-INV-1 and R3-INV-2 flipped to `_FIXED`, `_buildAt(dec, evenPeriod, forceQ0)` parity/ordering
control, + `test_R3_INV3_…_RESIDUAL` and its odd-period boundary test). `contracts-v4/src` untouched by this pass.

---

## 1. Files

| File | What |
|---|---|
| `contracts-v4/test/audit3/InvariantMocks.sol` | `Audit3FlakySource` (4626 with donation / stall / preview-revert / exit-fee levers), `Audit3FailableToken` (pause + freeze), `Audit3Stub` |
| `contracts-v4/test/audit3/InvariantIdleOnly.t.sol` | **Suite A** — idle-only rig (Stub v4, PRODUCTION `MintwareERC4626YieldAdapter` over the flaky source). `IdleOnlyHandler` + `InvariantIdleOnlyTest` (fee-free) + `InvariantIdleOnlyFeeSourceTest` (10 bps exit fee). 8 invariants + a 3,000-call deterministic replay witness |
| `contracts-v4/test/audit3/InvariantForkLP.t.sol` | **Suite B** — real v4 on the Robinhood-testnet fork (self-skips without `LP_FORK_RPC_URL`). `ForkLpHandler` + `InvariantForkLP18Test` (18×18) + `InvariantForkLP6x18Test` (6-dp quote = USDG shape). 9 invariants + an 800-call replay witness |
| `contracts-v4/test/audit3/InvariantRegressions.t.sol` | Shrunk Suite-A counterexamples as concrete tests: F1-a (exact numbers), F1-a cycle drain, F1-b, F2, F3 |
| `contracts-v4/test/audit3/InvariantForkRegressions.t.sol` | Shrunk Suite-B counterexamples on the real v4 stack: F1-c (6 dp, deployed state), F3-b (cap exceeded), R3-INV-1 + R3-INV-2 (flipped `_FIXED`), R3-INV-3 (`_RESIDUAL` + odd-period boundary), invariant-15 guard |

Run (repo root, `foundry.toml` is here):

```bash
export PATH="$HOME/.foundry/bin:$PATH"
bash -c 'forge test --match-path "contracts-v4/test/audit3/InvariantIdleOnly.t.sol"'        # ~20 s
LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com \
bash -c 'forge test --match-path "contracts-v4/test/audit3/Invariant*.t.sol" -vv'          # ~30 s incl. fork
```

Inline `/// forge-config:` pins the budget per contract (the repo `[invariant]` section — 256 × 500,
`fail_on_revert = false` — is respected and only overridden per-suite): Suite A 256 runs × 128 depth (fee variant
128 × 96); Suite B 8 runs × 24 depth per pairing. `fail-on-revert = false` everywhere on purpose — reverts are part
of the specification, so the handler records every revert SELECTOR and an invariant asserts the unexpected set is
empty (that is how scope inv. 9 is encoded).

## 2. Method

**Handler design (both suites).** Four depositor actors; every PM call is a low-level call whose revert selector is
compared to a prediction computed from PRE-state (paused / zero / same-block / source-unreadable / zero-shares /
slippage / cap / band / third-party pause or freeze). A mismatch in either direction (unexpected selector, or a
predicted revert that succeeded) increments a counter. Every successful call is checked against a **shadow
computation**: minted shares vs `mulDiv(amt, ts+V, nav+V)` (Suite B: NAV with the LP leg at `max(spot, ref)`),
liquidity removed vs `floor(S·(liq+V)/(ts+V))`, recipient deltas vs fees derived from `feeGrowthInside − last`,
withdrawer deltas vs `SqrtPriceMath` amounts for the removed liquidity (branch selected by TICK, as v4 does),
`deployedPrincipal` vs a shadow, and the follower (`vm.load` slot 7, `_refSqrtPrice` low 160 bits / `_refBlock`
next 64) vs the exact clamped step. Block progression is a handler-owned counter (`blk`) rolled with `vm.roll` —
never `block.number + 1` (via-IR CSEs `block.number` across `vm.roll`).

**Ghosts (Suite A).** Per actor: `deposited`, `withdrawn`, `yieldCredit` (pro-rata by `sharesOf/ts`, CEIL, of every
donation + compound — an over-credit, hence sound for an upper bound), `swept` (virtual-offset dust a LAST holder
collects: `idle − floor(S·(idle+V)/(ts+V))`), `ownLoss` (rounding the actor's own ops can cost them: ≤ 1 PM share
per mint / re-credit + 1 unit per floor). Global: `globalSlack` (rounding left IN the pool by anyone: ≤ 1 PM share
per deposit, + the adapter's over-delivery unit per withdraw) and `globalLossSlack` (rounding taken FROM the pool:
1 source share per stage, the over-delivery per withdraw). Every slack term is derived from the contract math, not
tuned to make anything pass.

**Levers.** Suite A: deposit / depositWithMin (min = predicted, or predicted+1 → must revert), withdraw /
withdrawWithMin, donation to the source (inflation primitive), owner `compoundQuote`, `setPaused`, adapter
`setPerBlockWithdrawCap`, source `setFailWithdrawals` (stalled Morpho), `setRevertPreview` (unreadable source),
roll. Suite B adds owner `deploy` (within / just over the cap), `harvest`, `poke`, third-party swaps both ways
(`PoolSwapTest`), third-party LP add/remove (`PoolModifyLiquidityTest`, salt 1), paired-token pause, quote-issuer
freeze of `harvestRecipient`.

## 3. Results — HEAD `c11d8fd3`, clean `src`

Calls achieved: Suite A **32,768** (fee-free) + **12,288** (fee) handler calls per invariant campaign, 0 handler
reverts; Suite B **192** per invariant per pairing (8 × 24) — plus the deterministic replays (3,000 / 800 calls).

### 3.1 Suite A — idle-only, production adapter (scope §6 inv. 1, 2, 4, 5, 9, 11 + solvency/conservation)

| # | Invariant (scope ref) | Fee-free | 10 bps fee | Verdict |
|---|---|---|---|---|
| A1 | Σ `sharesOf` == `totalShares` | PASS | PASS | holds |
| A2 | Σ floor-claims ≤ NAV + VIRTUAL (solvency) | PASS | PASS | holds |
| A2b | `totalShares` ≤ NAV + source-mint rounding (par-or-better) | **FAIL** | n/a | **F1** (phantom shares) / F2 |
| A3 | No value creation: `withdrawn + claim ≤ deposited + pro-rata yield + sweep + rounding` | **FAIL** | **FAIL** | **F1** |
| A4 | Scope inv. 2: `claim_after + delivered ≤ claim_before + tol`; `sharesOf` never rises on a withdraw | **FAIL** | **FAIL** | **F1** |
| A5 | Scope inv. 4 (inflation defence / no principal loss): `withdrawn + claim + rounding ≥ deposited` | **FAIL** | PASS (fee-adjusted) | **F1** (co-depositors pay) + F2 |
| A6 | Scope inv. 9 (idle slice): revert set exact; predicted reverts revert | **FAIL** | **FAIL** | **F1-b** (dead `SourceUnavailable` guard) |
| A7 | Scope inv. 11: `lastKnownIdle` ≤ live `stagedAssets` while readable | PASS | PASS | holds (yield direction — see §5 for the loss direction) |
| A8 | Scope inv. 5 quantified: a holder's claim falls on someone else's deposit by ≤ `amt·fee·s/(ts'+V)` + source rounding | PASS | PASS | holds — L-05 dilution is one-directional and bounded exactly by the fee term |

Replay witness (3,000 calls, fee-free): 217 deposits, 445 withdraws, 236 donations, 219 capped/stalled withdraws
(re-credit path), 209 withdraw attempts during a preview outage, 202 phantom re-credits (max 586,374,812,559 shares
on a dust-scale pool), max adapter over-delivery 227,955 raw units (F3-a), 0 prediction mismatches.

### 3.2 Suite B — real v4 fork (scope §6 inv. 1, 2, 3, 6, 7, 9, 10, 16)

| # | Invariant (scope ref) | 18×18 | 6×18 | Verdict |
|---|---|---|---|---|
| B0 | Σ shares == total; Σ claims ≤ NAV(spot) + VIRTUAL | PASS | PASS | holds |
| B1 | Inv. 1 pro-rata exit: liquidity removed == `floor(S·(liq+V)/(ts+V))` (all when last holder), no price input; LP leg only fails under a third-party failure | PASS | PASS | holds |
| B2 | Inv. 2 re-credit never mints value | **FAIL** | **FAIL** | **F1** (both counterexamples are idle-only phantoms; F1-c shows the deployed 6-dp case) |
| B3 | Inv. 3 last-holder clean state (`liq == 0`, `deployedPrincipal == 0`; harvest/deploy/deposit recover) | PASS | PASS | holds (recovery covered by B9: no unexpected reverts after clean-outs) |
| B6 | Inv. 6 cost-basis cap monotone; `dp` moves only in deploy (+used ≤ requested) / withdraw (−pro-rata); principal conserved across deploy | PASS | **FAIL** (run 1: 18×18 FAIL, run 2: 6×18 FAIL) | **F3-b** — `dp` increment exceeds the cap-checked request via adapter over-delivery |
| B7 | Inv. 7 follower: ≤ `ref·band/1e4` per block, toward spot, once per block, first anchor == spot, untouched by swaps | PASS | PASS | holds |
| B9 | Inv. 9 revert set exact; **withdraw never reverted** under paired pause / frozen recipient / stalled source / capped adapter / preview outage (LP leg deferred + re-credited instead) | PASS | PASS | holds |
| B10 | Inv. 10 H-02: recipient delta == accrued fees (exact) on withdraw / deploy / harvest; withdrawer gets exactly `idleOut + amounts(removed liq)` | PASS | PASS | holds — exact equality, no tolerance |
| B16 | Inv. 16 value out at cached spot ≤ pre-exit claim + rounding (6 dp × 18 dp); `_pairedToQuote` never reverted | PASS | PASS | holds |

Replay witness (800 calls, 6×18): 87 deposits, 154 withdraws (all with a live LP leg), 30 deploys, 25 harvests,
80 swaps, 56 pokes, 111 follower steps, 60 LP-leg deferrals under third-party failure, 16 outage withdraws, 0
prediction mismatches, 0 pro-rata / fee-ordering / principal-slice / follower violations; 139 re-credit violations
(F1), 2 cap violations (F3-b).

## 4. Findings (each reproduced as a concrete regression; assertions currently PIN the buggy behaviour — flip them when fixed, do not delete)

### F1 — per-leg VIRTUAL double count → phantom LP entitlement → unbacked share re-credit on every partial exit — **HIGH at 6 dp**

**Minimal counterexample (fuzzer, shrunk to 3 calls; exact numbers in `test_R3_F1a_partialExit_reCreditsPhantomShares_idleLegPaidInFull`):**
`deposit(carol, 68,719,476,735)` · `deposit(bob, 213,526,339,862)` · `withdraw(carol, 590,214,548)`. Price is exactly 1
(no yield, no fee). The trace shows `staging.unstage(590,214,548)` → adapter delivers `590,214,548` → carol receives
`590,214,548` — the FULL idle entitlement — yet only **590,212,458** shares are burned: **2,090 shares re-credited
with nothing undelivered.**

**Root cause** (`_withdraw`, `MintwareLpGatewayPositionManager.sol:418-422, 465-474`):
```
fromIdle    = toAssets(shares, idle,      ts, VIRTUAL)   // S·(idle+V)/(ts+V)
lpEntitled  = toAssets(shares, lpSpotVal, ts, VIRTUAL)   // S·(lpVal+V)/(ts+V)   ← +V AGAIN
liqToRemove = toAssets(shares, liq,       ts, VIRTUAL)   // S·(liq+V)/(ts+V)     ← +V on LIQUIDITY UNITS
claim = fromIdle + lpEntitled = S·(idle + lpVal + 2V)/(ts+V)
```
The deposit side prices ONE virtual offset (`toShares(amt, ts, idle + lpVal, V)`); the exit side prices two. With
no position, `lpEntitled = floor(S·V/(ts+V)) > 0` although the LP leg is worth exactly 0, so `claim > delivered`
and `reCredit = S·(claim−delivered)/claim ≈ S·V/(ts+V)` shares come back although the whole entitlement was paid.
With a position (6-dp quote), the liquidity slice's own `+V` is in L-units (≈ 0 quote), so the same gap remains
(`test_R3_F1c_deployedState_6dpQuote_partialExitReCreditsPhantomShares`: phantom entitlement 499,997 raw, bob keeps
333,330 shares worth 499,992 raw after a fully-paid exit). At 18×18 the L-unit phantom is also ≈ 1e6 wei, so the
two roughly cancel — the withdrawer is instead slightly over-paid (wei-scale). **The double count is the bug; the
decimal pairing decides which symptom shows.**

**Impact.** Unbacked shares ≈ `V·f` per exit (`f` = exiter's share fraction) — at 6 dp up to **1e6 raw = $1 per
exit**, independent of pool size, repeatable every 2 blocks (`SameBlockAction` is the only rate limit), paid by
the remaining holders. Measured (`test_R3_F1a_cycleDrain_attackerExtractsFromVictim`): victim 10,000 USDG,
attacker cycling 10,000 USDG deposit/withdraw (never last holder) nets **+$100.24 after 200 cycles ($0.50/cycle)**,
victim's claim 9,899.77. Value is conserved (transfer, not a token mint) — which is exactly why the existing
"never mints tokens" scenario tests did not catch it; the stateful ghost `withdrawn + claim ≤ deposited + yield`
did. On tiny pools (`ts ≪ V`) the phantom is ~100 % of the withdrawn shares (A2b/A3 shrunk sequences with 3,156-unit
deposits) — the pool is worth < $1 there, so it is the same bug at a scale where the offset dominates.

**F1-b (same root cause) — scope inv. 9's deliberate refusal is dead code.** `!idleOk && liqToRemove == 0 →
SourceUnavailable` never fires for `shares ≥ (ts+V)/V` because the phantom `liqToRemove` is ≥ 1 with no position;
the exit "succeeds" with 0 delivered, 0 burned, sets `_lastActionBlock` and emits Withdrawn/IdleLegUnavailable/
LpLegUnavailable (`test_R3_F1b_sourceOutage_refusalBypassed_exitSucceedsWithZeroDelivery`). Every A6 failure
(both "predicted revert did not revert" and `SlippageExceeded` where `SourceUnavailable` was due) traces here.

**Fix direction.** Add VIRTUAL once: `claim = toAssets(S, idle + lpSpotVal, ts, V)`; split the legs by their
un-offset weights (`fromIdle = claim·idle/(idle+lpSpotVal)`, `lpEntitled = claim − fromIdle`); size the liquidity
slice as `mulDiv(liq, S, ts)` (no offset on L-units; the last holder still takes all); the refusal then works as
documented. Re-run Suite A after the fix: A2b/A3/A4/A5/A6 must go green with the SAME tolerances.

### F2 — the adapter inherits the yield source's first-depositor inflation attack (griefing) — **MEDIUM, source-dependent**

**Counterexample:** `donate(2,278,727,784,463)` to the EMPTY source · `deposit(alice, 1,312,889,136,061)` ·
`deposit(bob, …)`. `MintwareERC4626YieldAdapter.deposit` ignores the shares the 4626 mints; against an offset-0
4626 (OZ default — this repo's `MockERC4626`, i.e. the testnet rig) alice's stage mints `floor(A·1/(D+1)) = 0`
source shares, `totalAssets()` stays 0, the PM still mints `A` shares at NAV 0, and the next depositor is priced
at ~0 (3.15e16 shares for 2.4e10 units) — alice's stake is diluted to < 0.1 % permanently
(`test_R3_F2_emptySourceDonation_firstStageMintsZeroSourceShares_nextDepositorTakesAll`). **Griefing, not theft:**
the OZ `+1` virtual share strands `~totalAssets/(supply+1)` (the donation and alice's deposit) — the griefer's own
exit returns LESS than donation + stage (measured cost 3.18M units for a 1.31M loss). Re-armed every time the
adapter's source balance returns to zero (after a full exit).

**Realism.** Needs an offset-0 source with (near-)zero supply. MetaMorpho v1.1 has offset 18 − 6 = 12; the
Robinhood "Morpho" vaults are **Vault V2** (see `closeout/mainnet-yield-sources.md`) whose virtual-share math
should also make the donation infeasible — verify on the actual vault code before relying on it. The adapter has
no guard of its own (`sharesMinted > 0` or `Δ totalAssets ≥ amount − ε`); the curated-source list is the only
defence. (The working-tree PM adds a `StageShortfall` check — §7.)

### F3 — adapter over-delivers by up to one source share per unstage (F3-a) and that excess becomes cost basis past the cap (F3-b) — **LOW / informational**

`previewWithdraw(want)` rounds source shares UP, `redeem(shares)` pays `floor(shares·price)` → delivered ∈
`[want, want + price − 1]` (`test_R3_F3_adapterCeilSharesOverDelivery_boundedByOneSourceShare`; replay max
227,955 raw units on a donation-pumped mock). Nil for an 18-dp-share source, one raw unit for Morpho at
price ≈ 1. **F3-b:** `deploy` checks `dp + quoteToDeploy ≤ 50 %` on the REQUEST but sizes the mint on `quoteGot`
(the delivery) and adds `quoteUsed` to `deployedPrincipal`; with ample paired the whole over-delivery becomes cost
basis (`test_R3_F3b_deployCostBasisExceedsRequest_viaAdapterOverDelivery`: request 18,499,999,999,999,999,999,999 =
exactly the cap → `dp` 18,500,000,000,000,000,000,001, **2 wei over the cap**). Bounded by one source share; the cap
is otherwise intact (B6 held on 18×18 in the pinned run and the breach is ≤ `srcPrice − 1`). Derivation of why a
cap-sized request on an EVEN source supply never shows it (`ceil`/`floor` cancel when `cap·(tS+1)/(tA+1)` sits
just under an integer) is in the test comment. Fix: clamp `quoteGot` to `quoteToDeploy` before the mint (re-stage
the excess), or check the cap on `quoteUsed` post-mint.

## 5. Scope §6 coverage — what was NOT encoded, and why

| Inv. | Status | Note |
|---|---|---|
| 1 | encoded (B1) | exact liquidity slice; price-independence is structural (no price input to the shadow) |
| 2 | encoded (A4, B2) | **FAIL — F1** |
| 3 | encoded (B3 + B9) | |
| 4 | encoded (A5 lower bound + A2b) | **FAIL — F1 (phantom), F2 (empty-source donation)**. The sub-claim "an ERC-20 donation to the ADAPTER cannot change `totalAssets`" was not fuzzed (true by code reading: `previewRedeem(balanceOf(this))`); "rounding never favours the caller across dust cycles" IS covered — and is exactly what F1 violates |
| 5 | encoded (A8, fee variant) | bound is `amt·φ·s/(ts'+V)` + source rounding, one-directional; held |
| 6 | encoded (B6) | **FAIL — F3-b** (cost basis can exceed the request by < 1 source share); monotonicity / only-in-deploy-and-withdraw held |
| 7 | encoded (B7) | exact step, once per block, swaps never move it; held. "No function can set the reference arbitrarily" is structural (no setter exists) |
| 8 | partial | `predictionMismatch == 0` with NAV = idle + `max(valueAt(spot), valueAt(ref))` confirms the mark as implemented under random swaps; the same-block-manipulation property `sharesMinted(p') ≤ sharesMinted(p_ref)` was not fuzzed as an attacker sequence (scenario-tested in round 2, `test_R2_RT1a_depositWithMin_blocksSandwich`) |
| 9 | encoded (A6, B9) | withdraw never reverted under any third-party failure (held); the documented refusal is **dead (F1-b)**. Reentrancy from source `redeem` / paired hooks was NOT fuzzed (no reentrant token in the handlers; `RedTeamOnchain*` covers it) |
| 10 | encoded (B10) | exact equality on fees and principal, partial + full exits, incl. zero-liquidity early return; held |
| 11 | encoded (A7) | yield direction only. The LOSS direction is R3-1 in `fable-independent-review.md` (a loss during an outage lets the exiter offload it) — not re-encoded here |
| 12 | not encoded | timelocked rotation is owner-only, time-driven, and already unit-tested; a stateful handler adds nothing beyond `vm.warp` sequencing |
| 13 | not encoded | one-time `setVault`/`setController` are single transitions (unit-tested); not a stateful property |
| 14 | not encoded | Permit2 allowance hygiene would need `permit2.allowance(pm, token, posm)` reads after every deploy — straightforward to add to `ForkLpHandler.deploy` as a follow-up |
| 15 | partial | owner actions (deploy / harvest / compound / setPaused / adapter cap / recipient freeze) are in Suite B; B10 + B16 bound what leaves the PM to exactly fees + principal slices; the "enumerate every owner transition and quantify the worst case" is analysis, not an invariant |
| 16 | encoded (B16 + the whole 6×18 suite) | held |

## 6. Harness notes (so the next run is not re-learned)

- **Do not put asserts in `afterInvariant`.** The shrinker treats ANY failing candidate as "still failing", so a
  non-vacuity assert made every counterexample shrink to a meaningless 1-call sequence. Coverage is witnessed by
  the deterministic replay tests instead (invariant-campaign `console.log` output is not printed by forge).
- `forge test --match-path` compiles sparsely — a compile error in one audit3 file does not block another.
- **A handler frame must never revert.** `vm.roll` is an env change that SURVIVES the EVM revert of the frame that
  made it, while the handler's own `blk += n` is rolled back — one such revert leaves `block.number` a block ahead of
  the counter for the rest of the run (`SameBlockAction` mispredictions, follower `refBlock` "wrong"). Re-sync from
  `vm.getBlockNumber()` in `_roll` and at the start of every action, keep every pre-call computation revert-free
  (v4 `FullMath` reverts with EMPTY data on a zero denominator — a `_p2q(x, 0)` looks like nothing in the trace), and
  have the witness assert `frameReverts == 0` + `vm.getBlockNumber() == h.blk()`.
- **Two revert shapes for the same third-party failure.** A token failing INSIDE a v4 `take`/`settle` surfaces as
  ERC-7751 `WrappedError(address,bytes4,bytes,bytes)` (`0x90bfb865`); the PM's own `safeTransfer(From)` bubbles the
  raw `Error(string)`. Predict by WHERE the contract meets the failure, not by which token failed.
- **Entry-memory parity.** The PM's two entry-high buckets alternate on `block.number / 300`; a live fork block picks
  the creation parity at random per run. Roll to a known period start BEFORE constructing the PM (`_buildAt`,
  `A3_FORK_PERIOD_PARITY`), or the campaign's counts — and R3-INV-3's window — change from run to run.
- `vm.load(pm, 7)` = `_refSqrtPrice` (low 160 bits) + `_refBlock` (bits 160–223); `deployedPrincipal` = slot 6
  (verified with `forge inspect … storage-layout`).
- v4 selects the amounts branch by `tick`, the PM by `sqrtPrice`; the principal-slice shadow uses the tick branch
  and matched exactly — no boundary mismatch was hit in 192 + 800 exits per pairing.
- The 6×18 pool is initialised at tick ±276,300 (`ln(1e12)/ln(1.0001)` aligned to spacing 60) with range ±23,040.

## 7. Re-run against the concurrent working-tree source (uncommitted, not on HEAD)

While this suite was being written another agent edited `contracts-v4/src/gateway/*` in the same tree
(PM sha1 `2c7d0f5d…`, Staging `dea4e876…` at the time of the re-run — vs HEAD PM `3dc06d25…`): pool-initialised
check + follower anchored at CREATION, an entry-high memory mark used as the holder-favourable weight `w` for
the LP leg, `liqToRemove = min(liq, …)`, `StageShortfall` (stage must credit ≥ amount − 50 bps), a 20 % outage
haircut on `lastKnownIdle`, `DeployNotTwoSided`, deferred re-stage. Re-running everything on that tree:

- **Fixed there:** F1-b (refusal fires again — `test_R3_F1b_…` now reverts `SourceUnavailable`, flip its assert
  when this lands) and F2 (`test_R3_F2_…` now reverts `StageShortfall`).
- **Still open there:** **F1** (A3/A4/A5/B2 still fail — the two-offset `claim` is unchanged) and **F3-b**
  (`test_R3_F3b_…` still passes, i.e. the cap is still exceeded by 2 wei).
- Harness deltas needed for that source (not applied — this report is pinned to HEAD): accept `StageShortfall`
  as a predicted deposit revert when `previewRedeem(bal + previewDeposit(amt)) < idle + amt·(1 − 50 bps)`; drop
  the "no reference without a position" rule in `_folPost` (anchor at creation); model the entry-high mark in the
  deposit share prediction (117 mismatches otherwise).

> **Superseded by §0 (2026-09-08):** the deltas above were applied, the F1 fix landed in the same source, and both
> campaigns were re-run — see §0 for the post-fix verdicts, the two harness corrections, and the residuals.
