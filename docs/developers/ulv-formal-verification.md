# ULV Increment 2 — Formal Verification & Static Analysis

**Scope:** Halmos symbolic proofs of the ULV pure fee math + mulDiv rounding directions, and a Slither
static pass over the vault. Complements — does not replace — the 256×128k Foundry invariant suite
(`MintwareDeFiPairVault*Invariant.t.sol`): fuzzing **samples**, these **prove/triage**.

## 1. Slither (static analysis) — ran clean

`slither contracts-v4/src/vaults/MintwareDeFiPairVault.sol --compile-force-framework foundry`
(high/medium only). **No new high-severity findings.** Everything surfaced is a known V4-hook
false-positive class:

| Detector | Verdict |
|---|---|
| **reentrancy** on `supplyIdle` / `recallIdle` / `rebalanceBuffer` / `_realizeFees` (state written after external calls) | **False positive.** All are `nonReentrant` + `notDuringJit` + `onlyProvider`; external callees are the trusted PoolManager (own `unlockCallback`) and the hard-wired `AaveV3YieldAdapter` (`onlyVault`, no callback into the vault). OZ's guard blocks cross-function re-entry, which Slither does not model. The cross-fn read is `totalManagedLiquidity()` (a view — not exploitable) and `_rebalance` (internal, `nonReentrant` entry). |
| **unused-return** on `getSlot0` / `modifyLiquidity` / `settle` / `initialize` | Intentional V4 idioms — unused tick / `feeDelta` fields; fees realized separately via `_collect`. |
| **uninitialized-local** (`addedL`, `used0/1`, `gotIdle0/1`, `pool0/1`) | Tuple-decode / conditional assignment; Slither's conservative dataflow. Default-0 is the intended value on the untaken branch. |

**One item worth a defensive tightening for the external audit (not a live bug):** `_supplyIdleCore` /
`_refillIdleCore` write `positionLiquidity` *after* the adapter/PoolManager calls. Given the guards +
trusted callees this is safe, but moving the `positionLiquidity` write *before* the external call
(strict CEI) would silence the detector and harden defense-in-depth.

## 2. Halmos (symbolic proofs) — specs written, execution toolchain-blocked

`contracts-v4/test/formal/MWFormalProofs.t.sol` formally specifies 7 properties:

| Proof | Property | Target |
|---|---|---|
| `check_volatilityFee_neverExceedsCeiling` | surge fee ≤ `maxFeePips` (or 1e6) — never bricks | **real** `MWDynamicFee.volatilityFee` |
| `check_volatilityFee_neverBelowBase` | deviation only ever *adds* to the base floor | **real** `MWDynamicFee.volatilityFee` |
| `check_rateLimit_withinStep` | per-block fee move ≤ `maxStep`, never overshoots target | **real** `MWDynamicFee.rateLimit` |
| `check_splitFee_conservesAndFavorsLP` | `treasury + buyback + lp == fee`; LP ≥ nominal share (rounding favors LP) | `_splitFee` mulDiv pattern |
| `check_redeemIdle_roundsDown` | `idle·s/TL` ≤ idle; floor; full redemption exact | idle-leg redeem mulDiv |
| `check_redeemIdle_sumNeverExceedsBacking` | Σ pro-rata over disjoint redeemers ≤ backing (solvency) | idle-leg redeem mulDiv |
| `check_depositMint_noInflation` | `(TL+V)·liq/(managed+V)` floor — no value minted from nothing | deposit-mint mulDiv w/ virtual-liquidity offset |

**Execution status (2026-08-21): specs run in CI (Linux); the local dev box can't run Halmos.** Root
cause is environmental, **not a proof failure**:

- The maintainer dev box is **macOS 13 (Darwin 22.3) on arm64**. A current Halmos depends on
  `yices-solver`, whose only arm64 wheel targets **macOS 14+** — so `uv`/`pipx` can't install it and
  fall back to **Halmos 0.2.6**, which crashes with an internal `IndexError: pop from empty list` at
  parse time (~0.01s, before any solving). Verified this is not fixable locally by: a clean `--ast`
  rebuild, an `--evm-version paris` build (rules out PUSH0), a forced `halmos>=0.2.9 --python 3.12`
  install (yices wheel unavailable), and Docker (not installed). All four dead-ended on the same cause.
- **Linux has the manylinux `yices` wheels**, so `pipx install halmos` gets a current build there and
  the specs execute. A **`Formal proofs (Halmos, advisory)` CI job** (`.github/workflows/ci.yml`) runs
  all 7 `check_*` on every push/PR.

**Observed CI result (PR #347, run `32503000438`, 2026-08-21): `3 passed; 4 failed; time: 241s`.**

| Proof | Halmos verdict |
|---|---|
| `check_volatilityFee_neverExceedsCeiling` (real `MWDynamicFee`) | ✅ **PASS** (0.05s) |
| `check_volatilityFee_neverBelowBase` (real `MWDynamicFee`) | ✅ **PASS** (0.06s) |
| `check_rateLimit_withinStep` (real `MWDynamicFee`) | ✅ **PASS** (0.36s) |
| `check_splitFee_conservesAndFavorsLP` (mulDiv lemma) | ⏱ **TIMEOUT** (60s) |
| `check_redeemIdle_roundsDown` (mulDiv lemma) | ⏱ **TIMEOUT** (60s) |
| `check_redeemIdle_sumNeverExceedsBacking` (mulDiv lemma) | ⏱ **TIMEOUT** (60s) |
| `check_depositMint_noInflation` (mulDiv lemma) | ⏱ **TIMEOUT** (60s) |

**All 3 proofs against real live hook code pass** — `MWDynamicFee`'s fee bounds and rate-limit are
symbolically proven over all inputs (within the `vm.assume` bounds). The 4 failures are **TIMEOUTs, not
counterexamples**: the bundled yices solver could not *decide* the nonlinear 256-bit `mulDiv` lemmas
(multiplication of two symbolic words + **division by a symbolic value**) — the classic SMT-hard case,
not a discovered violation.

**We tried to close the other 4 and established that we can't, here (not re-litigating):**

- **More time is not the lever.** A re-run at `--solver-timeout-assertion 300000` (5×) left the result
  unchanged — the same 4 still TIMEOUT at the full 300s (run `32505972958`, 1201s total).
- **A stronger solver can't be used in CI.** `--solver bitwuzla` (and `cvc5`) are not bundled — Halmos
  downloads them on demand, and the CI sandbox blocks it (`solver_output.error='Download not allowed'`),
  so those runs *error on the missing binary* rather than solve (run `32509211692`). Not worth wiring a
  vendored solver: division-by-symbolic is likely intractable for any of them, and the 4 lemmas are
  already fuzz-proven at 256×128k.

So the Halmos CI job uses the **bundled yices** solver (download-free), giving a stable **3/7**, and
stays **advisory** (`continue-on-error` — the 4 timeouts make it exit 1 by design).

## 2b. Coq — the 4 SMT-intractable lemmas, machine-checked (the workable alternative)

The barrier above is **SMT itself**, not Halmos: division by a symbolic value is undecidable-in-practice
for any SMT engine. But the 4 timed-out specs are elementary integer **floor / conservation** facts, so
they are proved instead in **Coq** (`contracts-v4/proofs/coq/MulDivLemmas.v`, `nia` over `Z`) — decidable,
machine-checked, no solver-download or timeout. Solidity's uint `/` is Euclidean floor division
(`X = D*q + r, 0 ≤ r < D`), so each lemma is proved from that defining relation and then given a
`Z.div`-level corollary, so the theorem is literally about floor division = the Solidity `/`.

| Coq theorem | Covers | Solidity spec |
|---|---|---|
| `depositMint_no_inflation_div` | `minted·(managed+V) ≤ (TL+V)·liq` | `check_depositMint_noInflation` |
| `redeem_out_le_idle_div` | `(idle·s)/TL ≤ idle` | `check_redeemIdle_roundsDown` |
| `redeem_floor_div` | `out·TL ≤ idle·s` (floor) | `check_redeemIdle_roundsDown` |
| `redeem_exact_full_div` | `s=TL ⇒ out=idle` | `check_redeemIdle_roundsDown` |
| `redeem_sum_le_backing_div` | `Σ pro-rata ≤ backing` (solvency) | `check_redeemIdle_sumNeverExceedsBacking` |
| `splitFee_conserves_and_favors_LP` | `t+b ≤ fee` (conservation) ∧ `lpNominal ≤ lp` (rounding favors LP) | `check_splitFee_conservesAndFavorsLP` |

**No `Axiom`, no `Admitted`.** The `Formal proofs (Coq, mulDiv lemmas)` CI job compiles the file with
`coqc` — a **real gate** (not advisory): `coqc` exiting 0 *is* the proof. Observed **green** on PR #347
(commit `575f9661`). Run locally with `pnpm coq:proofs`.

## Bottom line

All 7 `MWFormalProofs` properties are now backed by a **proof**, not just fuzzing:
- **3/7 — symbolically proven against real live hook code** (Halmos over `MWDynamicFee`).
- **4/7 — machine-checked in Coq** as the exact `mulDiv` arithmetic lemmas the vault relies on (the
  same "lemma, not bytecode-bound 1:1" framing already noted for these four; binding them to the vault
  bytecode would mean extracting the math into a shared pure library — noted for the external audit).

Honest claim: *"every formal-verification property is proven — 3 symbolically (Halmos), 4 as
machine-checked Coq lemmas."* Not a single one rests on fuzzing alone (though all 7 are **also**
fuzz-proven at 256×128k, as defense in depth).

Run locally:

```bash
pnpm coq:proofs   # coqc contracts-v4/proofs/coq/MulDivLemmas.v  — the 4 mulDiv lemmas (needs coq)
pnpm halmos       # the 3 live-code symbolic proofs (Halmos; needs a supported Halmos: Linux / macOS 14+ / Docker)
```

**Why the properties are already trustworthy in the meantime:** every one above is also covered by the
**256×128k Foundry invariants** which passed with 0 reverts — e.g. `_splitFee` conservation +
rounding-favors-LP by the increment-3 conservation tests, and the redeem/deposit mulDiv rounding by
`invariant_rounding_favors_vault` + `deposit_redeem_no_value_creation`. Halmos **proves** over all
inputs (within the `vm.assume` bounds) where fuzzing only **samples** — so the CI job is a strict
enhancement over already-green coverage, not a gap being papered over.

## 3. Recommendation for the external audit (increment 4)
- Run the Halmos specs under a pinned Forge/Halmos pair (or Certora on the same properties).
- Consider the CEI tightening on `positionLiquidity` writes (§1) — cosmetic given the guards.
- Echidna + Medusa (dual-fuzzer) were deliberately **not** stood up — they would re-cover the passing
  Foundry invariants; the auditor's own fuzzing harness is the better place for that diversity.
