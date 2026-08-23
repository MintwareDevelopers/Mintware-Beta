# Mintware — Security Self-Assessment, ROUND 4 (2026-08-22)

> **SELF-REVIEW, not an external audit.** Adversarial audit of the code added AFTER round-3 (#353):
> the new `MintwareTreasuryFloatSettlement` (operating-float settlement) + `MWTimelockedRiskParams`
> (the 48h risk-param timelock) and its wiring into the treasury vault / settlement / JIT hook. Three
> reviewers: float money-path, timelock governance, composition/regression. Testnet + unaudited.

## Headline

**1 High · 2 Medium · 4 Low · Info.** No Critical. The round-1–3 invariants are **regression-free** — the
timelock edits only interpose a bound-preserving 48h delay on *loosening* a risk param; the guard bodies,
H4 rail pin, R2-M2 caps, junior top-up, oracle band, and JIT breaker are byte-for-byte unchanged, the
matched-vault change is NatSpec-only, and 157/157 regression tests pass. All findings are in the **new**
governance + float surface. A cross-cutting theme: several **oracle/settlement anchors can be re-pointed
instantly by a compromised owner/keeper**, sidestepping the very manipulation-resistance the timelock adds.

## HIGH

**R4-H1 — `setOracleSource` is instant + unbounded → a compromised owner has an instant senior-drain path**
`MintwareEthSettlement.sol:237-240`. The settlement swap's price band is derived entirely from
`oracleSource.oracleTick()` (`_swapLimit`/`_oracle`). The timelock correctly gates the band *width*
(`setBandTicks`) and the *ready-guard* (`setRequireReadyOracle`) — but **not the oracle source pointer**
those guards trust. A compromised owner (the timelock's own threat model) can, in ONE block:
`setRelayer(self)` (instant) → `setOracleSource(maliciousOracle → (attackerTick, ready=true))` (instant,
unbounded, no `_riskParamsLive` gate) → `batchSettleEth` with a band centered on the attacker's price →
drain senior WETH backing at a manipulated rate, **zero delay** — functionally the instant "disable the
oracle guard" the timelock promises to delay 48h. The vault got the identical problem right (`jitHook` is
**set-once**, `AlreadySet`, `:335`); the settlement's oracle anchor was left mutable/instant.
**Fix:** make `oracleSource` set-once once the rail is live (mirror the vault's `jitHook`), or route
re-points through the timelock (instant pre-rail, 48h once live).

## MEDIUM

**R4-M1 — keeper `rebalanceFloat` is unthrottled on the default config**
`MintwareTreasuryFloatSettlement.sol:148-155, 542-577`. `maxRebalancePerCall`/`maxRebalancePerWindow`/
`rebalanceWindow` all default to `0` (= off), and the keeper's `minUsdcOut` has **no server-side floor**
(unlike `batchSettleViaSwap`, which floors it at `minSettleOutBps`). So on the default config a compromised
keeper key calls `rebalanceFloat(all_backing, 0)`, walks the WETH/USDC pool to the oracle-band edge, and
self-sandwiches — converting the whole backing to float at ~band-worst execution and capturing the spread
externally, unthrottled, giving the guardian no window to `pause()`. The NatSpec advertises "a rogue keeper
can't churn the backing" — but that only holds once the (separate, optional) caps are set.
**Fix:** fail-closed — revert `rebalanceFloat` until a non-zero `maxRebalancePerWindow` is configured
(mirror `RailNotSet`); and floor the keeper's `minUsdcOut` (a `minSettleOutBps`-style fraction), so `0` is
not acceptable.

**R4-M2 — the R2-M2 windowed extraction cap can be reset to zero instantly by re-applying the same value**
`MintwareEthSettlement.sol:347-352, 394-399` (PoC-confirmed). Re-setting an identical `(cap, window)`
satisfies `effNewCap ≤ effOldCap && v2 ≥ settleWindow` → classified "tightening" → **instant**, and the
write path zeroes `_settledInWindow`. So a rogue owner clears the cumulative-extraction accumulator at will,
turning "≤ cap per window" into "≤ cap per block" — defeating exactly the guardian-reaction-time control the
48h delay protects (a direct cap *raise* is correctly timelocked).
**Fix:** on an instant (tightening/equal) reconfig, carry `_settledInWindow`/`_windowStart` forward (reset
only on a genuine loosening, which is already timelocked); or reject no-op same-value sets.

## LOW

**R4-L1 — leg-1 (`wstETH→ETH`) is fail-*open* when `lidoRateSource` is unset — asymmetric with the ETH/USDC
leg's fail-closed guard.** `MintwareTreasuryFloatSettlement.sol:645-652, 593-603`. `requireReadyOracle`
(default true) hard-reverts the ETH/USDC leg when the oracle isn't ready, but `_enforceLidoFloor`
early-returns when `lidoRateSource == 0`, and leg-1 uses a full-range price limit → an operator who enables
settlement with `requireReadyOracle=true` but forgets to wire `lidoRateSource` runs an **unbounded**,
sandwichable wstETH→WETH swap. Bounded (deep near-1:1 pool, treasury funds, off the hot path) → Low.
**Fix:** when `requireReadyOracle` is true, also revert the swap paths if `lidoRateSource == 0` — symmetric
fail-closed on both legs.

**R4-L2 — 6-decimal USDC misprices `totalBackingUsd()` / swap sizing on a real deploy**
`MintwareTreasuryFloatSettlement.sol:67-70 (NatSpec), 728-749, 797-803`. `totalBackingUsd()` adds
`usdcFloat` (native USDC decimals) directly to an 18-dp `_wstEthValueUsd()`; with real 6-dp USDC the operands
differ by 1e12 → wstETH counted ~1e12× its true weight (massive over-valuation) and emergency swaps sized
~1e12× wrong. Deliberately scoped out in NatSpec + testnet is 18-dp mocks → latent, not live — but it's a
real money bug gated only by a comment on a contract sitting on `main`.
**Fix (interim, this PR):** add a **deploy-time guard** so the contract cannot be constructed with a non-18-dp
token until the decimals-aware math is written (turns the silent latent bug into a fail-closed deploy
constraint). **Full fix (pre-mainnet):** carry explicit `usdcDecimals`/`wstDecimals` scaling into the
valuation + sizing.

**R4-L3 — `coverageUsd()` is griefable downward via a stake-pool spot push / under-reporting adapter**
`MintwareTreasuryFloatSettlement.sol:728-758`. `_effEthPerWst() = min(lido, spot)` — pushing the wstETH/WETH
spot *below* the Lido rate lowers reported backing (never *overstates* — the intended depeg-conservatism),
but an external consumer gating spend/solvency on `coverageUsd()` can be transiently DoS'd. Availability
only. **Fix (enhancement, pre-mainnet):** read the stake rate from a manipulation-resistant TWAP/truncated
oracle for valuation too, as the ETH/USD leg already does.

**R4-L4 — the go-forward `FloatSettlement` did not adopt the 48h timelock its three siblings just received**
All its risk setters (`setBandTicks`, `setRequireReadyOracle`, caps, `setMinSettleOutBps`, adapters) are
instant `onlyOwner` — the same loosen-instantly gap #355 just closed on the other three, reintroduced on the
contract meant to supersede `MintwareEthSettlement`. NatSpec defers it ("adopt before mainnet"). Testnet,
owner-operated → Low. **Fix (pre-mainnet):** inherit `MWTimelockedRiskParams` here too, mirroring the sibling.

## INFO (cheap hardening — fix opportunistically)

- `withdrawJuniorBuffer` reverts `ZeroAmount()` for the over-withdraw case (both settlement contracts) — wrong
  error name, behavior correct. → rename to an insufficient-balance error.
- `poolManager` not zero-checked in the `FloatSettlement` constructor (`:274`) — add the check.
- `type(uint128).max` fat-finger ceilings (`MAX_BURN_CAP`/`MAX_JIT_CUM_LOSS_CAP`/`MAX_SETTLE_CAP`) are
  economically near-unbounded — documented as "timelock is the control, not the numeric bound"; not a bypass.
- Float invariant suite holds prices at 1:1 and skips the emergency valve + adapters + a manipulating actor —
  extend the handler.
- **Deploy runbook invariant:** one dedicated `IYieldAdapter` instance per (contract, token) — a shared adapter
  double-counts in `totalBackingUsd()`.

## What HELD (reviewer-confirmed)

Round-1–3 invariants (H1 solvency-aware NAV, H4 rail pin, R2-M2 caps, junior top-up, oracle band, JIT breaker,
backing conservation) **untouched in logic** — timelock only adds a bound-preserving delay on loosening;
bounds validated at both propose AND confirm; two-value params bound as a pair; confirm/cancel replay/races,
non-owner/forged-key, first-set-re-open all closed; **guardian pause + auto loss-breaker confirmed instant**.
Matched-vault change NatSpec-only. `FloatSettlement` shares no state/roles with `MintwareEthSettlement`; its
hot path (`batchSettle`) touches no oracle/pool/swap at all (no same-block manipulation surface). Emergency-
valve overshoot conserves; depeg valuation never overstates; reentrancy posture (all entrypoints
`nonReentrant`, `unlockCallback` pool-gated, CEI, tracked-balance accounting) sound. 157/157 regression green.

## Remediation plan — FIX ALL (this PR)

Every finding is being fixed in this remediation (not deferred): R4-H1 (oracle-source set-once/timelocked),
R4-M1 (keeper fail-closed cap + minUsdcOut floor), R4-M2 (window accumulator carry-forward), R4-L1 (symmetric
Lido fail-closed), **R4-L2 full decimals-aware valuation** (explicit usdc/wst decimal scaling — not just a
deploy guard), **R4-L3 manipulation-resistant stake-rate for `coverageUsd()`**, **R4-L4 FloatSettlement adopts
`MWTimelockedRiskParams`** on its risk setters, plus the Info items (poolManager zero-check, error-name
rename, extend the float invariant handler to exercise the emergency valve + adapters + a manipulating actor).
