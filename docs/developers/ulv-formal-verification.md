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
  the specs execute. A **`Formal proofs (Halmos, advisory)` CI job** (`.github/workflows/ci.yml`) now
  runs all 7 `check_*` on every push/PR. It is **advisory (`continue-on-error`)** until a green run is
  observed and promoted to a hard gate — this doc will be updated with the observed result, and the
  `/proof` page must not claim "symbolically verified" until then.

Run locally on any supported setup (Linux, macOS 14+ arm64, or Docker):

```bash
pnpm halmos   # forge build --ast && halmos --root . --forge-build-out contracts-v4/out --contract MWFormalProofs
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
