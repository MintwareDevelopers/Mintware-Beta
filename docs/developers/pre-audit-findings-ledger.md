# Pre-Audit Findings Ledger — YPN Treasury / ULV / V4 Hook Stack

> **Purpose.** A single map for an external auditor: every finding from the 2026-08-15 external SOTA
> review (4 independent research agents + the RexHook whitepaper), the mechanism that closes it, the
> exact contract location, and the test evidence. This is the *starting point* for the audit, not a
> substitute for it — everything here is **testnet + unaudited**. External audit is the only gate left
> before real value.
>
> **Branch:** `feat/ypn-vault-convergence` (not on `main`). **Suite:** `pnpm forge:test`.
> **Scope of this ledger:** the on-chain YPN/ULV/V4 stack in `contracts-v4/src/{payments,hooks,vaults,lib}`.
> Off-chain settlement (edge-auth / relayer / card float) is tracked separately (finding #6).

## How to read the status column

- **Closed (on-chain)** — a code mechanism prevents the failure; a named test asserts it.
- **Mitigated by design** — the architecture makes the class impossible or loss-free (e.g. revert-not-underpay); test asserts the safe behavior.
- **Out of contract scope** — a business / off-chain control (float facility, BIN sponsor, KYC); named for completeness, tracked on the settlement path.

---

## 🔴 Critical — already-exploited classes

### #1 — Hook callback auth + pool-key binding (Cork, $11M, May 2025)
**Risk.** Anyone can call `PoolManager.unlock()` and re-enter our `beforeSwap`/`afterSwap` with a
forged `PoolKey` / `hookData`, driving JIT logic on a pool we don't control.
**Fix (Closed).** Every hook entrypoint is `onlyPoolManager` **and** binds to an immutable canonical
pool id — a non-canonical key is a no-op, never a revert (so it can't be used to grief either).
- `contracts-v4/src/payments/MintwareTreasuryJitHook.sol` — `canonicalPoolId` (immutable, L80),
  guard in `beforeSwap` (L354) and `afterSwap` (L487).
**Evidence.** `test_nonCanonicalPool_doesNotFireJit` (JitStack suite).

### #2 — Accounting conservation / rounding-sign leak (Bunni v2, $8.3M, Sep 2025)
**Risk.** A PnL breaker that trusts our own position math is blind to a leak that nets ≥0 internally.
**Fix (Mitigated by design).** The breaker measures PnL against **actually-transferred USDC** (not an
internal LDF), and there is no custom liquidity-density math to mis-round. All rounding is against the
vault. Senior principal is asserted non-decreasing absent a booked loss, under fuzz.
**Evidence.** `testFuzz_jitLive_keepsSeniorSolvent` (invariant, 256 runs × 128k depth).

### #3 — Unredeemed ERC-6909 claim window + sandwichable sweep
**Risk.** Claims exposed between position-close and a permissionless sweep; the keeper's team→USDC
unwind is a market order booked to senior — sandwichable.
**Fix (Closed).** The unwind is bounded by the in-pool **truncated-tick oracle** (`MWOracleGuard`):
recoverable value is taken at `min(spot, oracle)` (conservative in both directions), and the unwind
swap's `minAmountOut` is derived from the oracle band, reverting outside it. A same-block spot push
cannot inflate recoverable value.
- `contracts-v4/src/payments/MintwareTreasuryJitHook.sol` — `_oracle` (MWOracleGuard.State, L97),
  advanced once per block; recover/sweep bounded off it.
**Evidence.** `test_spotManipulation_doesNotInflateRecoverable` (warms the oracle, then a same-block
~2M-unit push moving spot ~6710 ticks; asserts the oracle stays frozen and recoverable value doesn't inflate).

---

## 🔴 Model design flaws

### #4 — Seniority swap = MakerDAO Black Thursday ($8.32M → $0)
**Risk.** Defending par by market-selling a thin, volatile junior fails exactly when stressed.
**Fix (Mitigated by design + Closed sizing).**
1. **No fire-sale principal loss:** `_pullSeniorForDeploy` / `_pullUSDC` **revert rather than underpay** —
   senior never takes a principal loss from a thin-market junior sale; the worst case is liveness (skip),
   not loss. (`MintwareTreasuryVault.sol` L562–563.)
2. **Sized buffer, enforced continuously (the #7b coverage gate, this branch):** at-risk senior can't
   grow past what the **junior USDC buffer** covers. See #7 below — this is the mechanism the review
   asked for ("make `juniorUsdcBuffer` mandatory + sized"), implemented as a continuously-enforced floor
   at every risk-increasing op rather than a one-time commit-time check that drifts.

### #5 — Solvency assumes Aave liquidity (Aave 100% util freeze, Apr 2026, ~$5B frozen)
**Risk.** Counting aTokens as recoverable breaks the invariant during an Aave freeze and can DoS the pool.
**Fix (Closed).** JIT borrow is gated on **withdrawable-now** headroom, not deployed balance
(`min(totalAssets, maxWithdrawable)`), and every external leg is **best-effort**: a failed/short
withdraw falls through to "skip JIT, deltas net zero, swap proceeds" — it never reverts the user's swap.
- `MintwareTreasuryVault.sol` — `borrowIdleForJit` headroom gate (L685–690); `_pullUSDC` best-effort (L793, L812).
**Evidence.** `test_deployToLP_neverDrawsJuniorBuffer_whenAaveIlliquid` (JitStack suite).

### #6 — Same-dollar-yield **and** par-spendable (no live product does this)
**Risk.** Card float is T+1–T+3 (incl. weekends); a spendable-while-earning balance needs a segregated
always-liquid hot buffer, a spend circuit-breaker, a named float facility, and a BIN-sponsor / issuing-bank / KYC gate.
**Status (Out of contract scope).** These are off-chain / business controls on the settlement + card
path, not this contract set. Tracked in `.claude/rules/payments-ypn.md` (deploy-gated remainder) and the
Arc settlement runbook. Named here so the auditor knows par-spendability depends on them being in place
before real value — the on-chain vault's job is only to never let a spend un-back senior (see #7).

### #7 — Coverage-ratio gate + junior priced at spot
**Risk.** Without a coverage floor, at-risk senior can outrun the first-loss cushion; valuing junior at
its own AMM spot is circular and read-only-reentrancy-exposed (dForce / LazySummer / Ostium NAV class).
**Fix (Closed — this branch, #7b).** A configurable coverage-ratio floor halts risk-increasing ops when
the junior cushion thins, and the cushion is valued with a **100% haircut on the volatile junior token**
— only the **junior USDC buffer** counts (never the junior token at spot, so there is nothing circular or
manipulable to read).
- `MintwareTreasuryVault.sol`:
  - `minCoverageBps` (L150), `setMinCoverage(uint16)` `onlyOwner` (L303), event `MinCoverageSet`.
  - `coverageBps()` view (L446) — `juniorUsdcBuffer * 10_000 / deployedFromSenior`; `max` when nothing deployed.
  - `_coverageOkAfter(addlDeploy)` (L452) — division-free floor check (no div-by-zero at zero deployed).
  - Gated: `deployToLP` **reverts** `CoverageTooLow` (L554); `borrowIdleForJit` **skips** (returns 0, L688).
  - Default **0 = off** (backward compatible); set at deploy to activate. Recommend a live floor before mainnet.
**Evidence.** `test_coverage_gate_off_by_default`, `test_coverage_gate_halts_deploy_when_junior_thin`,
`test_coverageBps_view_tracks_deployed` (JitStack suite).

---

## 🟡 Hardening (adopted)

| Item | Status | Location / evidence |
|---|---|---|
| NAV from internal principal, not `balanceOf` (donation inflation) | Closed | senior accounting tracks booked principal; a raw donation only gifts holders |
| Virtual offset raised 1e3 → **1e6** + symmetric (dead-shares redundant) | Closed | `VIRTUAL = 1e6` (`MintwareTreasuryVault.sol` L94); `SeniorSharesMath` |
| `nonReentrant` on all state-changing vault ops | Closed | `deployToLP`/`borrowIdleForJit`/deposit/withdraw carry `nonReentrant whenNotPaused` |
| Best-effort external legs never revert the user swap | Closed | `_pullUSDC` / `borrowIdleForJit` fall through to skip-JIT |
| Deploy-assert hook permission bits (incl. RETURNS_DELTA) | Closed | HookMiner CREATE2 salt mining at deploy |
| Min-swap-size / min-fee threshold before JIT (dust-grief) | Closed | JIT slice gated; non-canonical + tiny flow no-op |

## 🟢 Additive upside (MEV engine — PR #261, all levers off/inert by default)

Dynamic / surge / quadratic fee, MEV-tax (Base-only bonus, never counted as solvency), am-AMM
(rent + hook enrollment), and **Diamond-LVR** (a directional surcharge charged **only** on the
gap-closing / arb swap — recaptures LVR to LPs without taxing benign flow). Oracle-free except
Diamond-LVR + dynamic-fee, which read the manipulation-resistant *truncated in-pool* oracle (no CEX feed).
Invariants **7/7** green (256 × 128k). See `.claude/rules/smart-contracts.md` (V4 hooks + MEV engine).

---

## Auditor start-here checklist

1. **Trust boundary of the JIT hook** — confirm `onlyPoolManager` + canonical-pool-id binding on
   *every* externally-reachable entrypoint (#1); look for any path that trusts caller-supplied `PoolKey`/`hookData`.
2. **Conservation under fuzz** — re-run / extend `testFuzz_jitLive_keepsSeniorSolvent`; probe rounding
   direction on the settlement edges (#2).
3. **Oracle band** — stress `MWOracleGuard` truncation window vs. multi-block manipulation; verify the
   sweep `minAmountOut` band can't be widened by a patient attacker (#3).
4. **Coverage floor** — verify `_coverageOkAfter` is on *every* risk-increasing op, and that the gate
   can't be bypassed via a path that grows `deployedFromSenior` without the check (#4/#7).
5. **External-leg failure modes** — force Aave freeze / short withdraw and confirm the user swap always
   proceeds with net-zero deltas, never a revert or a junior draw (#5).
6. **Off-chain settlement** (#6) — out of this contract scope; audit the edge-auth NAV-hold + float
   facility separately before par-spendability goes live.
