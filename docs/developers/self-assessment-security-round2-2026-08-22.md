# Mintware — Security Self-Assessment, ROUND 2 (2026-08-22)

> **SELF-REVIEW, not an external audit.** A second, independent pass over the whole `contracts-v4/src`
> suite by 7 fresh reviewers, each doing two jobs: (1) re-verify round-1's fixes adversarially (don't
> trust the `AUDIT` comments), (2) hunt for what round-1 missed — biased to **economic/invariant attacks
> over call sequences**, cross-contract composition, and rounding, the classes a checklist scan misses.

## The headline + the honest lesson

Round-1 fixed the original 6 Highs. Round-2 re-verified **all of them as holding in isolation** — but
found that **three round-1 fixes were incomplete or introduced a new issue** that only shows up under
adversarial *sequence* analysis (which the isolated round-1 re-pass didn't do). That is exactly why a
second, sequence-focused audit matters — and it's the lesson: **a fix isn't done until it's been
attacked as a sequence, not just checked in isolation.**

**Round-2 findings: 3 High · 4 Medium · ~5 Low · Info.** No Critical. Still testnet + unaudited; external
audit remains the gate.

---

## HIGH

**R2-H1 — H1 mint-side NAV is spot-manipulable → same-tx over-issued shares** *(regression from round-1 H1)*
`MintwareTreasuryVault.sol:456-458, 525-528` (deposit prices off `_redeemNav`/`seniorRealizableAssets`).
Round-1 H1 correctly used `min(spot,oracle)` NAV to protect *redemptions* from a high spot — but the same
NAV was (for "fairness") reused on the *mint* path. Attack (1 atomic tx): swap the vault's own pool to
depress spot → `recoverableUSDC()` collapses → deposit mints over-issued shares against the low NAV →
swap price back (cost ≈ fees) → redeem at restored par → extract from existing senior holders.
**Fix:** value the mint-side LP leg with the oracle-resistant value (`max(spot,oracle)` or oracle-only) —
keep `min(spot,oracle)` for redemption only. Deposits must not be fooled by a *low* spot the way
redemptions are protected from a *high* one. (Optionally gate deposits when `|spot−oracle|` > band + ship
a nonzero default `minCoverageBps`.)

**R2-H2 — `sweepJit()` can permanently strand a fully-used JIT slice → senior NAV overstated at par**
`MintwareTreasuryJitHook.sol:509-518` + `MintwareTreasuryVault.sol:427,443,738`.
A fully-utilized JIT slice leaves `jitBorrowed` outstanding; sweeping while spot is outside the oracle band
converts ~nothing → `settleJitReturn` (only called when `usdcReturned>0`) never runs → `jitBorrowed` never
clears → the early-return guard (`:510`) then short-circuits *before* retrying even after the oracle catches
up → team tokens permanently stranded, all future JIT disabled (`:738`), and the phantom slice counts at
**par in both the par AND the realizable NAV** (so H1's haircut can't catch it) → senior pays on
non-existent backing. Permanent, griefable at swap-fee cost.
**Fix:** don't short-circuit while physical balances remain (`... && teamToken.balanceOf(this)==0 &&
usdc.balanceOf(this)==0`); always reconcile `jitBorrowed` via `settleJitReturn` on any sweep; add an
owner/keeper force-settle for a stuck `jitBorrowed`.

**R2-H3 — round-1 H3 is incomplete: `fundRent` + `harvestYield` revert when a distributor is wired**
*(regression from round-1 H3)* `MintwareDeFiPairVault.sol:737` + `lib/MWIdleLib.sol:246`.
H3 removed the standing max distributor approval but added the per-call approve to **only one** of the
**three** `fundFees` call sites (`_realizeFees`). `fundRent` and `harvestYield` now revert on every call
for any distributor-wired vault (rent path DoS'd; Aave yield stranded), and neither has M6's try/catch.
**Fix:** apply the same per-call approve→`fundFees`→reset-to-0 at both sites; add M6-style try/catch →
accumulator fallback to `harvestYield` so a paused distributor can't strand yield.

## MEDIUM

**R2-M1 — H6 activation is griefable into a launch DoS / fund-trap** *(regression from round-1 H6)*
`MintwareMatchedLiquidityVault.sol:722-725` + `activate/abort`. An attacker front-runs every `activate()`
with a free empty-pool swap pushing price outside the ±100bps band → `LaunchPriceMoved` revert; `abort()`
reverts while the threshold is met → the team's committed tokens are trapped. **Fix:** let `activate()`
accept a caller-supplied acceptable price/deviation and atomically re-anchor, OR add a post-window grace
after which the team can reclaim its commitment even when the threshold is met.

**R2-M2 — `batchSettleEth` pins the destination but not cumulative extraction**
`MintwareEthSettlement.sol:282-337`. A rogue relayer with `minUsdcOut=0` can, over repeated calls (each ≤
`maxSettlePerCall`), drain the junior buffer + convert all WETH backing to USDC that leaves to the pinned
rail — no on-chain proof a real charge exists. **Fix:** add a cumulative/windowed cap and/or bind
settlements to a signed hold reference; enforce `minUsdcOut` as a fraction of `totalUsdc` at the oracle
price rather than fully relayer-supplied.

**R2-M3 — `MintwareWeightedDistributor.fundFees` records requested, not received (no balance-diff)**
`MintwareWeightedDistributor.sol:187-196`. A fee-on-transfer token (the community/meme tier) inflates
`pot`, so the signed `total ≤ pot` ceiling (C5) can exceed tokens actually held → cross-epoch/cross-vault
shortfall. Latent (owner-gated registration + honest oracle), but a real correctness gap. **Fix:**
balance-diff — credit `pot += received`.

**R2-M4 — junior first-loss can fully exit at the cliff while senior USDC is still deployed**
`MintwareTreasuryVault.sol:380-406`. `redeemJunior` releases the ETH stake + `juniorUsdcBuffer` whenever
`recoverableUSDC() >= deployedFromSenior` at that instant — it does NOT require the LP be unwound
(`deployedFromSenior == 0`). Team can pull all first-loss while senior remains LP-exposed; a later
team-token drop then impairs senior with zero backstop. **Fix:** require `deployedFromSenior == 0` (or a
residual floor) before releasing junior first-loss capital.

## LOW / INFO (fix or accept, per triage)

- **R2-L1** `MWIdleLib` assumes a fee-free adapter (`idleN += deposited`, not realized) — tail insolvency if a fee-charging 4626 is wired under an MWIdleLib vault. Latent. Fix: credit by realized `totalAssets()` delta, or enforce fee-free adapters.
- **R2-L2** `expectedHook` not enforced at `commitTeam` → a launch can land in an ungated pool. Fix: require `expectedHook != 0` at commit.
- **R2-L3** staged-router per-adapter pool: 1e3 offset + trusted `totalAssets()` → first-staker inflation if the adapter source is externally inflatable. Fix: raise offset to 1e6 / track internal principal.
- **R2-L4** am-AMM `feeMaxPips` not bounded < 1e6 → a misconfig can brick every swap. Fix: reject `feeMaxPips >= 1e6` in `configurePool`.
- **R2-L5** M7 fail-soft lets an am-AMM manager skim 100% of swap fees rent-free while the vault is paused. Fix: suppress the skim when the rent push fails.
- **Info**: redemption seniority-swap invokes the JIT hook (confirm it excludes the vault's own unwind swaps); `jitHook` trusted with a per-block senior slice (force-settle on stuck `jitBorrowed` — ties to R2-H2); `SeniorSharesMath` arg-order footgun; `AttributionToken.setOracleSigner` dead code; MultiVenue can't verify child `asset()`; negative oracle params unchecked; enablement-desync 0-fee; a few stale NatSpec/wrong-error selectors.

## Remediation status (2026-08-22, branch `feat/yield-vision-update`)

Implemented this pass (all `// AUDIT R2-Hx/Mx`-tagged, with regression tests):

| Finding | Status | Where |
|---|---|---|
| R2-H1 | ✅ Fixed | `MintwareTreasuryVault._mintNav()` — mint path (`depositUSDC`/`previewDeposit`/`convertToAssets`) prices at PAR (`totalSeniorAssets()`), not `_redeemNav()`; redeem side unchanged. Test: `MintwareTreasuryVaultMintNav.t.sol`. |
| R2-H2 | ✅ Fixed | `MintwareTreasuryJitHook.sweepJit()` no longer short-circuits while physical balances remain + reconciles on full drain; `MintwareTreasuryVault.forceSettleJit()` owner backstop. Test: `MintwareTreasuryJitStack.t.sol`. |
| R2-H3 | ✅ Fixed | Per-call approve→fundFees→reset + M6 try/catch added at BOTH remaining sites: `MintwareDeFiPairVault.fundRent` + `MWIdleLib._harvestOne` (harvest). Tests: `MintwareDeFiPairVault.t.sol`, `MintwareDeFiPairVaultBuffered.t.sol`. |
| R2-M1 | ✅ Fixed | `MintwareMatchedLiquidityVault.abort()` opens as an escape after `LAUNCH_GRACE_PERIOD` (3d) past the window even when threshold met. Test: `MintwareMatchedLiquidityVault.t.sol`. |
| R2-M2 | ✅ Fixed | `MintwareEthSettlement`: `maxSettlePerWindow`/`settleWindow` cumulative cap + `minSettleOutBps` floor on relayer `minUsdcOut` (both owner-set, default off). |
| R2-M3 | ✅ Fixed | `MintwareWeightedDistributor.fundFees` credits balance-diff received, not requested. |
| R2-M4 | ✅ Fixed | `MintwareTreasuryVault._seniorFullyCovered()` now requires `deployedFromSenior == 0` (LP unwound) before `redeemJunior` releases first-loss. |
| R2-L2 | ✅ Fixed | `MintwareMatchedLiquidityVault.commitTeam` requires `expectedHook != 0`. |
| R2-L4 | ✅ Fixed | `MWAmAuction.configurePool` rejects `feeMaxPips >= 1e6`. |
| R2-L1, R2-L3, R2-L5, Info | ⏸ Deferred | Latent / owner-config; follow-up. |

> ⚠ Pre-existing, unrelated to this pass: `MintwareDeFiPairVault` runtime bytecode is **already over the
> EIP-170 24,576-byte limit on this branch** (committed baseline 25,237 B; the R2-H3 fix adds ~81 B → 25,318 B).
> Needs a size-reduction pass before mainnet deploy — out of scope for this security remediation.

## What HELD (round-1 fixes re-verified sound)

Re-verified across the 7 bundles: **H1 redeem-side** (pro-rata haircut, no double-count of junior buffer),
**H4** (pinned rail + cap + underflow clamp — redirection closed), **H5** (FeeVault gone), **M1/M3/M4/M5/
M6/M7/M9/M10/M11**, the distributor C1/C4/C5/C7/CRIT, factory CREATE2/onlyFactory/two-phase ownership, the
inflation defenses, delegatecall storage-safety, and the migrator spec fixes. The **redeem** side of the
senior tranche is solid; the new Highs are on the **mint** side (R2-H1), the **JIT-sweep** edge (R2-H2),
and the **incomplete H3** rent/harvest paths.
