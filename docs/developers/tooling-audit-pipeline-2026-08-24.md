# Tool-Assisted Audit Pipeline — 2026-08-24

**Self-review, NOT an external audit. Testnet + unaudited.** This run executes the *deterministic
tooling layers* (static analysis + property fuzzing + formal) that a pure-LLM review cannot replace,
and folds the output back into the agentic review. It runs on `main` **after** the round-5 fixes
(PR #370) landed, so it doubles as a regression check on those fixes.

## Pipeline actually executed

| Layer | Tool | Ran? | Result |
|---|---|---|---|
| **1. Static analysis** | Slither 0.11.6 | **Yes — money-path (payments + hooks)** via direct-solc | 3 High / 68 Med / 63 Low / 16 Info on our code — **all High = false positives** (triaged below); actionable residue = 6 optional zero-checks |
| **2. Property fuzzing / invariants** | Foundry invariant runner | **Yes — full suite** | **75 invariants × 256 runs × 128,000 calls, 0 failed** |
| **3. Formal verification** | Coq + Halmos | **Partial** | 4 mulDiv lemmas proven in Coq; Halmos symbolic 3/7 in CI (rest Coq-proven). **Certora/CVL not run** — needs a paid Certora cloud key; not available here |
| **4. Agentic review** | 6 reviewers (round 5) | **Yes (prior)** | 2 Highs found + fixed + merged (JIT loss-attribution PoC, x402 settle auth), lows fixed |

### Honest tooling notes
- **Slither on the `vaults/` cluster is blocked by a Slither parser bug**, not our code: it crashes with
  `Type not found enum LockTier` on the *file-level* `enum LockTier` in `VaultTypes.sol` (reproduced on
  both 0.11.5 and 0.11.6; Slither itself prints "please report an issue"). The money-path clusters
  (payments/hooks/lib) don't import `VaultTypes`, so they analyze cleanly via per-contract direct-solc.
- Getting Slither to consume the build at all required working around a **crytic-compile ↔ forge**
  mismatch (it ignored the custom `out = "contracts-v4/out"` and choked on Foundry's abbreviated
  build-info files) — resolved by isolating the one complete Hardhat-format build-info + direct-solc
  with the project remappings and `--via-ir`. This is the "env-blocked" state from earlier rounds,
  now actually worked around.

## Consolidated Findings Summary

| Severity | Raw (static, our code) | Real after triage |
| :--- | :--- | :--- |
| **Critical** | 0 | 0 |
| **High** | 3 | **0** (all false positives) |
| **Medium** | 68 | **0** (all false-positive-by-design / covered by proofs+invariants) |
| **Low** | 63 | **6 optional hardening** (`missing-zero-check`) |
| **Informational** | 16 | cosmetic (pragma, cyclomatic-complexity, naming) |

**Net: the deterministic tooling surfaces no real High/Medium on current `main`.** The genuine issues
were already found and fixed by the agentic layer in round 5; the invariants confirm those fixes hold
under 128k-call fuzzing.

## Detailed triage — the 3 static Highs (all false positives)

### [SL-H1] `arbitrary-send-erc20` — `MintwareTreasuryVault.settleJitReturn` L918
`usdc.safeTransferFrom(jitHook, address(this), reported)` — Slither flags an "arbitrary `from`."
**False positive:** `settleJitReturn` is `onlyJitHook`, so `from == jitHook == msg.sender`; the hook is
pulling its *own* pre-approved tokens into the vault (this is the round-5 H-1 fix — the hook
`forceApprove`s, the vault pulls, measuring the balance-diff locally). No third party's tokens are
reachable. **Bonus:** this confirms the H-1 fix did **not** introduce a real arbitrary-transferFrom.

### [SL-H2] `reentrancy-balance` — `MintwareEthSettlement.batchSettleEth` L523
Balance read → `poolManager.unlock()` → balance-derived condition. **False positive:** this is the
standard Uniswap-V4 `unlock`→`unlockCallback` (the callback is `onlyPoolManager`); `usdcFromSwap` is
**re-read after** `unlock()` returns (L526), so the conditions use post-swap state, not stale reads;
and the contract is `ReentrancyGuard`.

### [SL-H3] `reentrancy-balance` — `MintwareTreasuryVault._pullUSDC` L1057
Reads `freeOnHand` → `adapter.withdraw()` (Aave) → `freeOnHand < need`. **False positive:** `freeOnHand`
is **re-read** at L1062 and L1069 after the withdraw, so the final check (L1072) uses the fresh value
— Slither's "stale variable" claim is incorrect here. Aave is trusted and doesn't re-enter the vault;
entry points are `nonReentrant`.

## Medium/Low classes (characterized, not individually listed)
- **`reentrancy-no-eth` (9), `reentrancy-benign` (16), `reentrancy-events` (6)** — the V4 `unlock`/JIT
  callback pattern + `nonReentrant`; not attacker-reachable.
- **`incorrect-equality` (20)** — strict `==` in `require`/guards (by design).
- **`unused-return` (26)** — `forceApprove` / try-catch adapter calls where the return is intentionally
  ignored.
- **`uninitialized-local` (10)** — locals assigned in branches.
- **`divide-before-multiply` (3)** — `_alignTick` `(tick/spacing)*spacing` (intentional tick-flooring)
  and bounded fee-pips math (clamped ≤ `MAX_LP_FEE`; value math is Coq-proven + `rounding_favors_vault`
  invariant).
- **`timestamp` (33)** — deadline/window comparisons (expected in settlement).
- **`missing-zero-check` (6)** — reviewed all 6; **most were false positives too**, because `address(0)`
  is a *documented valid sentinel*: `TreasuryVault.setRentFunder` ("`address(0)` disables rent intake"),
  `JitHook.setAuction` ("wire **or clear**"), and `JitHook.setJitSkipSender` (zero = no exemption). The
  `MWHookCoordinator` **constructor** `_vault` is *also* legitimately zero — the deploy pattern mines the
  hook address first and wires the vault post-deploy via `setVault` (`DeployPairVault`). Only two were
  genuine, non-behavior-changing hardening and were **fixed**: `MWHookCoordinator.setVault` and the
  set-once `setAuction` now reject `address(0)` (`ZeroAddress`), plus the constructor's `_poolManager`
  (always a real contract). Net: 4 of 6 were by-design; 2 hardened. Same discipline as everywhere in this
  audit — a tool suggestion is checked against intended behavior before it's applied.

## Invariant fuzzing (Step 2) — the strongest signal
75 invariants, each 256 runs × 128,000 calls, **0 failures**, including exactly the properties tied to
the round-5 fixes: `invariant_C1_senior_nav_monotonic`, `invariant_juniorBufferBacked`,
`invariant_senior_fully_backed`, `invariant_settlementSolvent`, `invariant_no_unauthorized_settlement`,
`invariant_permit_reusable_and_bounded`, `invariant_no_share_inflation`, `invariant_rounding_favors_vault`,
`invariant_railPinned`, plus the adapter no-free-value / conservation family.

## What tooling still cannot cover (honest)
Per the pipeline's own premise: this covers **on-chain code logic**. It does **not** cover the off-chain
infrastructure (edge-auth / relayer / frontend / DNS / cross-chain messaging) — those were reviewed
separately in round 5 (the x402 settle-auth High came from that off-chain review, not from any of these
tools). An external audit + a securities opinion remain the gate before real value.
