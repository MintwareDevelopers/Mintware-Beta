# Phase 0 — Conservation Invariants on the Idle↔Active Vault Accounting Seam

**Status:** research + buildable plan (do NOT commit unless asked). Testnet/unaudited stack; the only
mainnet contract is AIAttribution v3. Ground truth is the code in `contracts-v4/src/**` as read on
branch `docs/yield-strategy`, 2026-08-20.

**Goal.** Specify a Foundry invariant suite that would catch a **Bunni-class rounding/accounting
exploit** (the idle↔active conservation-of-value bug that drained Bunni V2 for ~$8.3M on 2025-09-02)
in our rehypothecating vaults, and flag any rounding-direction issues found in our actual code.

**One-line finding.** Our two *vault* cores (`MintwareYieldVault`, `MintwareTreasuryVault`) and the
DeFi pair vault already carry strong conservation invariant suites, and every rounding site I audited
favors the vault. The **real Bunni-shaped gap is the yield *adapters***
(`MintwareERC4626YieldAdapter`, `MintwareMultiVenueYieldAdapter`, `AaveV3YieldAdapter`): they inherit
the external source's `previewRedeem`/`convertToAssets` rounding and have **only unit tests, no fuzzed
conservation invariant suite** against an adversarial-rounding source. That seam is exactly where
Bunni's bug lived.

---

## Part 0 — What Bunni got wrong (the failure class we are defending against)

> Sourced from the Bunni team post-mortem (via The Block / CryptoRank), Coinspect, Halborn, Dynamis,
> QuillAudits, Verichains, Rekt. The exact Solidity line is reconstructed + cross-corroborated (their
> blog + Wayback were unreachable to the research pass), so treat variable names as very-likely-not-
> 100%-verbatim; the *operation and rounding direction* are solidly corroborated. URLs in Part 5.

### 0.1 The mechanism (and an important correction to the seam framing)

Bunni V2 is a Uniswap V4 hook that manages LP via a custom **Liquidity Distribution Function (LDF)**.
Each pool balance is split into an **active balance** (the in-curve swap liquidity) and an **idle
balance** (held out of the curve). The bug lived in `BunniHubLogic::withdraw()`, in the proportional
reduction of that balance on LP-share redemption:

```solidity
// BunniHubLogic::withdraw() — reconstructed/corroborated, not verbatim
uint256 newBalance = balance - balance.mulDiv(shares, currentTotalSupply); // deduction rounded DOWN
```

`balance.mulDiv(shares, currentTotalSupply)` **rounds the deducted amount down**. Bunni's own words:

> "The decrease amount was intentionally rounded down … with the assumption that this would round up
> the idle balance and thus round down the active balance, which was considered the safe rounding
> direction … However, this assumption was unfortunately wrong, and the attacker used the rounding
> direction to their advantage." … "all of the rounding directions involved were safe in isolation,
> but when multiple operations are involved they led to an exploit."

**Correction that matters for us:** Bunni's "idle" is the **out-of-curve pool balance**, and the
exploited seam was the **active⇄idle split inside `withdraw`** — **not** rehypothecation. Per the
post-mortem, rehypothecated funds (lent to Euler) were *locked in lending positions and therefore safe
from the exploit* — rehypothecation actually **limited** losses. So the user-facing "idle↔active
vault accounting seam" for this Phase-0 work is precisely the **par/liquidity-split accounting inside
the vault** (our `deployedFromSenior` vs backing; our `idleN` vs pooled/JIT units), and the external
lending adapter is a *separate, secondary* surface (still worth hardening — see Groups A/Flag ②).

### 0.2 Why "round down = safe" was wrong here

Two coupled reasons:
1. **Active and idle are coupled, not independent.** Rounding the *deduction* down does not cleanly
   "round idle up / active down" once chained with the other roundings in the LDF's active-balance and
   total-liquidity recomputation. The lesson is *composition*: each rounding was safe alone.
2. **Adversarial small-balance amplification.** The attacker flash-loaned ~3M USDT and swapped to crush
   the pool's active USDC to **~28 wei**. At that scale the fixed ±1-wei rounding quantum is a *multi-
   percent* error per op, not dust. **44 sequential micro-withdrawals** then ratcheted the active
   balance down disproportionately to shares burned (active USDC **28 → 4 wei, −85.7%** while recorded
   total liquidity fell only **−84.4%**), corrupting the LDF's `min(totalLiquidityEstimate0,
   totalLiquidityEstimate1)` selection so a follow-up swap/reverse-swap extracted real tokens.

### 0.3 The invariants that would have caught it

- **Monotone proportionality:** a `withdraw(shares)` may never remove a *larger fraction* of the active
  balance than the fraction of shares burned — `Δactive ≤ ceil(activeBefore · shares / totalSupply)`.
  The bug is exactly a violation of this in the sub-100-wei regime.
- **Conservation under composition (not single calls):** `Σ(out) ≤ Σ(in) + yield` across arbitrary
  sequences, and per-holder round-trip `out ≤ in`, **fuzzed specifically with balances driven to
  single/double-digit wei and many tiny withdrawals** — the state normal fuzzing won't reach and that
  Bunni's own tests "did not cover."
- **Rounding-direction under composition:** assert the safe direction holds when operations are
  chained, not just in isolation.

---

## Part 1 — How OUR code tracks idle vs active (ground truth)

Two independent vault universes rehypothecate idle capital; both are in scope.

### 1.1 `MintwareYieldVault` (v1 flat-senior USDC vault) — `src/payments/MintwareYieldVault.sol`
- **Active/idle model:** single asset (USDC). `totalAssets() = adapter.totalAssets() +
  usdc.balanceOf(this)` (L101-103). Idle = supplied to `IYieldAdapter` (Aave); active = the
  un-supplied on-hand buffer. No pool, no price.
- **Shares↔assets:** all via `SeniorSharesMath` with symmetric virtual offset `VIRTUAL = 1e3`.
  deposit/mint Floor (L152), `previewWithdraw` Ceil (L114), `convertToAssets`/redeem Floor (L119).
- **Withdraw seam:** `_pullUSDC(need)` (L238-244) — on-hand buffer first, then best-effort
  `adapter.withdraw(need - onHand)`, then `require balance >= need` or revert.

### 1.2 `MintwareTreasuryVault` (v2 tranche vault) — `src/payments/MintwareTreasuryVault.sol`
- **Senior claim (price-free), the crux (L406-408):**
  `totalSeniorAssets() = adapter.totalAssets()  // idle in Aave`
  `                     + _freeSeniorBuffer()    // on-hand senior USDC (bal − junior/protocol earmarks)`
  `                     + deployedFromSenior      // senior USDC out in the LP, at PAR`
  `                     + jitBorrowed`            // senior USDC out in a JIT loan, at PAR`
  So **idle** = `adapter.totalAssets()`; **active** = `deployedFromSenior + jitBorrowed` (par-counted),
  plus the free buffer. No pool price appears in the senior NAV.
- **The active leg's real value** is `recoverableUSDC()` (L437-441) = `min(spot, oracle)` MTM of the LP,
  delegated to `MWTreasuryPositionLib._recoverable`. The solvency invariant is
  `deployedFromSenior ≤ recoverableUSDC() + juniorUsdcBuffer`.
- **Shares↔assets:** `SeniorSharesMath` with `VIRTUAL = 1e6`; same rounding directions as v1.
- **Idle→active transitions:** `deployToLP` (idle→LP, L542-575, pulls from senior sources only via
  `_pullSeniorForDeploy`), `recoverFromLP` (LP→idle, L578-581), `borrowIdleForJit`/`settleJitReturn`
  (idle→JIT loan→idle, L673-722). `accrueFees`/`fundRent` add USDC to the senior buffer.
- **Withdraw waterfall:** `_pullUSDC(need)` (L807-828) — free senior buffer → Aave → unwind LP (junior
  leg) → junior USDC buffer (first-loss) → revert. Never underpays the senior below par.

### 1.3 `MintwareDeFiPairVault` (dual-sided LP) — idle seam in `MWJitLib`
- `idle0`/`idle1` (L200-201) are the **settled principal the vault supplied to each adapter** —
  explicitly *"NEVER derived from `adapter.totalAssets()`"* (comment L195), the correct
  self-accounted design. On JIT open, `s.idleN -= got` (MWJitLib L99); on close, taken proceeds are
  re-idled (`_reIdle`). Redeem pro-rates `idleOut = idleN * s / TL` (Floor, vault L526-527).

### 1.4 The adapters (the external-source seam — the Bunni surface)
- `IYieldAdapter` (L11-31): `deposit`, best-effort `withdraw` (returns actual, **never reverts**),
  `totalAssets`, `maxWithdrawable`, `maxSuppliable`.
- `AaveV3YieldAdapter`: `totalAssets() = aToken.balanceOf(this)` (rebasing, L142-144). Supply-only, no
  leverage. aToken verified against asset+pool in ctor (Bunni-class mis-wire guard, L81-84).
- `MintwareERC4626YieldAdapter`: **inherits the external 4626's rounding.** `totalAssets() =
  yieldSource.previewRedeem(balanceOf(this))` (L136-138, fee-net/conservative); `withdraw` sizes shares
  via `previewWithdraw(want)`, caps to balance + `maxRedeem`, exits via `redeem(shares)` in try/catch
  (L108-128); `asset()` verified in ctor (L70).
- `MintwareMultiVenueYieldAdapter`: `totalAssets() = Σ children.totalAssets() + idle` (L176-180);
  `_deploy` splits by weight `(amount * weightBps)/BPS` Floor (L136); `withdraw` serves idle then
  children best-effort (L151-173).

---

## Part 2 — The invariant set to implement

Legend: **[NEW]** = not currently asserted anywhere; **[EXTEND]** = strengthen/port an existing one.
Existing coverage is real and strong — see the "already covered" note under each so we don't rebuild it.

### Group A — Adapter conservation (the primary Bunni gap) — **[NEW], highest priority**
New suite `contracts-v4/test/invariant/adapters/` driving each **real** adapter against
adversarial sources (`MockFeeERC4626`, a new `MockRoundingAdverseERC4626`, `MockHostileYieldAdapter`,
a tunable-illiquidity Aave mock).

- **A1 `invariant_adapter_no_free_value` (round-trip out ≤ in).** For a ghost of cumulative underlying
  supplied (`gIn`) and returned (`gOut`) plus source-realized yield (`gYield`), assert
  `gOut ≤ gIn + gYield`. *Catches Bunni directly:* value cannot be minted from the deposit→withdraw
  seam. Exercises `deposit`/`withdraw`.
- **A2 `invariant_adapter_totalAssets_not_overstated`.** `adapter.totalAssets() ≤` the assets actually
  realizable now = what a full `redeem` of held shares would net. Against `MockFeeERC4626` and
  `MockRoundingAdverseERC4626`, this proves our `previewRedeem`-based NAV never over-reports the value
  backing senior par (the trap the ERC4626 adapter's NatSpec claims to avoid — make it a *proven*
  claim, not a comment). Exercises `totalAssets`, `maxWithdrawable`.
- **A3 `invariant_adapter_withdraw_never_reverts` (liveness).** No `withdraw` in the fuzzed sequence
  reverts (a bricked best-effort withdraw is a settlement-brick). Ghost `bool reverted`. Exercises the
  hot path against paused/illiquid/hostile sources.
- **A4 `invariant_multivenue_conserves`.** For the router: `totalAssets() ≥ Σ idle credited` and
  round-trip `gOut ≤ gIn + gYield` across venues, including after `rebalance()` and `setVenues()`
  re-weights. Catches per-venue floor-rounding drift creating/destroying value.

### Group B — Vault micro-withdrawal loop (the explicit Bunni regression) — **[NEW]**
A dedicated handler burst, added to the existing v1 + v2 suites (or a focused suite).

- **B1 `invariant_micro_withdraw_no_extraction`.** A handler that records a holder's claim
  `c0 = convertToAssets(sharesBefore)`, performs **N=100–1000 dust redeems** (1 wei..$0.01 of shares
  each) interleaved with other actors' ops, and asserts `Σ assetsOut ≤ c0 + creditedYield`. This is
  the direct analog of Bunni's 44-micro-withdrawal loop. *Neither existing suite has an explicit
  dust-burst probe;* the current conservation invariants are cumulative and would catch gross theft but
  not necessarily assert the per-holder round-trip identity under a dust loop with witness of
  non-vacuity (assert the loop actually executed ≥N redeems).
- **B2 `invariant_deposit_withdraw_roundtrip`.** For a fresh actor: deposit `x`, immediately redeem all
  minted shares → `out ≤ x` (no yield in between). Asserts the shares-math seam alone cannot leak.
  Mirrors crytic/properties' "shares never minted for free / tokens never withdrawn for free" and
  a16z's round-trip properties.
- **B3 `invariant_monotone_proportionality` (the direct Bunni analog).** For every LP/par reduction,
  the fraction of the *active* leg removed must not exceed the fraction of shares/liquidity burned:
  `Δactive ≤ ceil(activeBefore · burned / supplyBefore)`. For the treasury vault the "active leg" is
  `deployedFromSenior` (and the LP units in `MWTreasuryPositionLib.recover`); for the DeFi pair vault
  it is `positionLiquidity` vs `totalLiquidity`. Compute in the handler around each `recoverFromLP` /
  redeem and trip a `bool disproportionate` ghost. **Crucially, fuzz the small-balance regime:** add a
  handler that drives the active leg down to single/double-digit wei (via a large clamped swap or
  near-full recover) before a burst of dust redeems — the exact state Bunni's tests never reached.

### Group C — Share-price monotonicity — **[EXTEND to v2]**
- **C1 `invariant_senior_nav_monotonic` (treasury vault).** Port the v1 `navDecreased` ghost
  (`MintwareYieldVaultInvariant.t.sol` L134-139, 447-449) into the **treasury** suite, which currently
  lacks it. Track senior pps `= (totalSeniorAssets + VIRTUAL)·1e27 / (totalSeniorShares + VIRTUAL)`
  after every state-changing call; assert it never decreases **on op types that must not dilute**
  (deposit/redeem/burn/JIT-settle/fee-accrue). *Caveat:* an IL write-down in `_recoverFromLP` legitimately
  lowers `deployedFromSenior`-backed value only via the junior; senior pps is designed to be price-free,
  so this ghost is meaningful for the senior side specifically. Bunni was a share-price-drifts-down bug;
  the treasury vault should assert this directly, not by argument.
  - **Recallable-capital caveat (from the ERC-4626 invariant literature):** state monotonicity and any
    `totalAssets ≥ Σ convertToAssets(balances)` check against **recallable** value, not raw idle
    balance, and **gate the monotonicity ghost to relax only on explicit loss-injecting handler
    actions** (an IL write-down in `_recoverFromLP`, a realized Aave/source loss). Otherwise legitimate
    rehypothecation/LP flows trip false positives. Model deployed/rehypothecated funds + any haircut as
    ghosts.

### Group D — Idle↔active identity & backing — **[EXTEND / already strong]**
- **D1 (already covered, keep):** DeFi pair vault `invariant_rounding_favors_vault`
  (`MintwareDeFiPairVaultJitInvariant.t.sol` L444-448) already asserts `idleN ≤ adapterN.totalAssets()`
  — the Bunni-safe direction (the vault never claims more idle principal than the adapter holds), plus
  `invariant_jit_roundtrip_conserves` (L421-426) and `invariant_solvency_incl_open_jit` (L410-415).
  **Do not rebuild.**
- **D2 (already covered, keep):** treasury `invariant_senior_price_free` (L460-466) is the idle+active
  accounting identity `totalSeniorAssets == adapter + freeBuffer + deployedFromSenior + jitBorrowed`;
  `invariant_senior_par_covered` (L442-448) and `invariant_senior_fully_backed` (L451-457) tie the
  active leg to `recoverableUSDC()`.
- **D3 [NEW, treasury] `invariant_idle_active_conserves_under_rebalance`.** The current treasury suite's
  `deployToLP`/`recoverFromLP` handlers move idle↔active, but there is **no ghost asserting the *par*
  identity survives a deploy→recover round-trip losslessly** apart from the coverage bound. Add a ghost
  that a `deployToLP(x)` immediately followed by `recoverFromLP(x)` under a flat mark returns
  `deployedFromSenior` to its prior value ± the documented seniority-swap slippage (charged to junior,
  per AUDIT M4, vault L776-786), and that senior par is never *silently* written up. This exercises the
  exact seam (idle→LP→idle) where a rounding inversion in `MWTreasuryPositionLib.recover`'s
  `lrem = mulDiv(liq, give, rec)` (L115) would compound.

### Group E — Rounding-favors-vault spot checks — **[EXTEND]**
- **E1 (already covered, keep):** v1 `invariant_rounding_favors_vault` (L478-488) asserts no phantom
  shares + `previewWithdraw` never under-quotes. **Port the `previewWithdraw`/`previewDeposit` probe to
  the treasury suite** (currently only checks share-sum via `invariant_no_share_inflation` L469-478).

---

## Part 3 — Test harness design

### 3.1 Reuse the established pattern
Our suites already use the canonical Foundry pattern: a `Handler is Test` with `bound()`ed actions each
wrapped in try/catch, ghost variables, `targetSelector(FuzzSelector{...})` + `targetContract`, an
`afterInvariant()` non-vacuity witness, run at **256 runs × 128,000 depth, 0 reverts**. New suites
follow it verbatim.

### 3.2 New files
```
contracts-v4/test/invariant/adapters/
    ERC4626AdapterInvariant.t.sol        // A1–A3 vs MockFeeERC4626 + MockRoundingAdverseERC4626 + hostile
    MultiVenueAdapterInvariant.t.sol     // A4
    AaveAdapterInvariant.t.sol           // A1–A3 vs MockAavePool (tunable illiquidity, already exists)
contracts-v4/test/invariant/seam/
    MicroWithdrawInvariant.t.sol         // B1–B2 (can target either vault via a shared handler)
contracts-v4/test/mocks/
    MockRoundingAdverseERC4626.sol       // NEW — see §3.5
```
Extensions (C1, D3, E1) are added into the existing
`test/payments/MintwareTreasuryVaultInvariant.t.sol` handler + invariant contract.

### 3.3 Adapter handler (Group A) — action set & ghosts
Handler owns the adapter, a `MockERC20` underlying, and the source. Actions (all `bound()`ed,
try/catch):
`supply(amtSeed)` (mints underlying to the vault-actor, approves, `adapter.deposit`; `gIn += amt`) ·
`withdrawSome(amtSeed)` (`out = adapter.withdraw(amt)`; `gOut += out`) ·
`accrueYield(amtSeed)` (`source.simulateYield`; `gYield += amt`) ·
`makeIlliquid(seed)` / `restore(seed)` (source liquidity knob) ·
`setFee`/`setAdverseRounding` (once, at setUp, per run configuration).
Ghosts: `gIn, gOut, gYield, bool reverted, uint256 nWithdraws`. `afterInvariant`: `assertGt(nWithdraws,
0)` non-vacuity. The handler models the **vault** (single authorized `vault` address = the handler,
since adapters are `onlyVault`).

### 3.4 Micro-withdraw handler (Group B)
Reuse the v1/v2 deposit/redeem handlers; add `microBurst(uSeed)`: snapshot `c0 =
convertToAssets(shares(u))`, loop `k in 1..N` doing `redeem(1..dust)` accumulating `sumOut`, assert
`sumOut ≤ c0 + tolerance` inline (or set a `bool extracted` ghost checked by the invariant). N chosen so
depth×N stays tractable (N≈50, depth 128k → still exercises the boundary millions of times).

### 3.5 Adversarial mocks — inventory & one new build
Already present and reusable: `MockFeeERC4626` (exit-fee, over-reporting `convertToAssets`/`maxWithdraw`,
XyloVault-shaped — `test/mocks/MockFeeERC4626.sol`), `MockHostileYieldAdapter` (short-pull, short-send,
phantom `reportedExtra` yield), `MockYieldAdapter` (tunable `withdrawableCap` illiquidity),
`MockAavePool`/`MockAToken` (rebasing + `simulateBorrow` illiquidity), `MockVenueAdapter`.
**New: `MockRoundingAdverseERC4626`** — a 4626 whose `previewRedeem`/`convertToAssets` round **UP** (in
the redeemer's favor, the Bunni direction) by 1 wei/share, to prove our adapter's `totalAssets()` (which
trusts the source's `previewRedeem`) cannot be pushed to over-state NAV, and that A2 fails loudly if we
ever drop the conservative view.

### 3.6 Run config
`foundry.toml` `[invariant]`: `runs = 256`, `depth = 128000`, `fail_on_revert = true` (matches the gate
standard so a best-effort adapter revert is caught, not swallowed by the runner). Fork tests stay out
(self-skip pattern) — these are all local-mock.

---

## Part 4 — Rounding-direction audit of our actual code

Every division/`mulDiv` site in the eight in-scope files, with direction and verdict. **No Bunni-shaped
inversion found; all sites favor the vault or are conservative valuations.** Two items flagged for a
second look (not bugs) noted at the end.

### `SeniorSharesMath.sol` (shared by both payment vaults)
| Line | Site | Rounding | Verdict |
|---|---|---|---|
| 27 | `toShares = assets·(ts+v)/(ta+v)` | caller's | Safe — callers pass Floor on mint (fewer shares to user) |
| 34 | `toAssets = shares·(ta+v)/(ts+v)` | caller's | Safe — callers pass Floor on redeem (fewer assets out) |

### `MintwareYieldVault.sol`
| Line | Site | Rounding | Verdict |
|---|---|---|---|
| 107 | `previewDeposit` | Floor | ✅ favors vault |
| 114 | `previewWithdraw` | Ceil | ✅ burns ≥ enough shares |
| 119 | `convertToAssets`/redeem | Floor | ✅ pays ≤ fair |
| 152 | deposit mint | Floor | ✅ |

### `MintwareTreasuryVault.sol`
| Line | Site | Rounding | Verdict |
|---|---|---|---|
| 411 | `previewDeposit` | Floor | ✅ |
| 417 | `previewWithdraw` | Ceil | ✅ |
| 421 | `convertToAssets` | Floor | ✅ |
| 447 | `coverageBps = juniorUsdcBuffer·BPS / deployedFromSenior` | Floor (int div) | ✅ under-reports coverage → gate trips earlier (conservative) |
| 480 | deposit mint | Floor | ✅ |
| 550 | `minIdle = base·idleBufferTargetBps/BPS` | **Ceil** | ✅ keeps *more* idle (conservative) |
| 595-596 | fee cuts `toJunior`,`toProtocol` | Floor | ✅ junior/protocol get less; senior keeps remainder |
| 651-652 | `fundRent` cuts | Floor | ✅ same — favors senior |
| 682 | JIT `perBlockCap` | Floor | ✅ lends less |

### `MWTreasuryPositionLib.sol` (LP deploy/recover/valuation)
| Line | Site | Rounding | Verdict |
|---|---|---|---|
| 115 | `lrem = mulDiv(liq, give, rec)` (liquidity to remove for `give` USDC) | Floor | ✅ removes ≤ needed → recovers ≤ wanted; `_pullUSDC` reverts rather than underpay. **Flag ①** (see below) |
| 188-193 | `getAmount{0,1}Delta(..., false)` in `_valueAt` | round **down** (roundUp=false) | ✅ position value understated → `recoverableUSDC()` (solvency RHS) is conservative |
| 206-211 | `_valueTeamInUsdc` staged `FullMath.mulDiv` | Floor | ✅ team leg valued down → conservative backing |

### `MintwareERC4626YieldAdapter.sol`
No local `mulDiv`. **Inherits the source 4626's rounding** via `previewRedeem` (L137, totalAssets),
`previewWithdraw` (L111, share sizing), `maxRedeem`/`maxWithdraw` (L114/146). `previewRedeem` for NAV is
the conservative (fee-net) choice; `convertToAssets` was deliberately *not* used (NatSpec L131-135). ✅
**but see Flag ②** — correctness is only as good as the source's own rounding, which is unverified for an
arbitrary Arc 4626.

### `AaveV3YieldAdapter.sol`
No division except supply-cap scaling (L171 `cap * 10**decimals`, exact). `totalAssets = aToken.balanceOf`
(exact rebasing). ✅

### `MintwareMultiVenueYieldAdapter.sol`
| Line | Site | Rounding | Verdict |
|---|---|---|---|
| 136 | `want = amount·weightBps / BPS` | Floor | ✅ under-deploys; remainder stays idle in router, still counted + withdrawable (no value lost) |

### `MWJitLib.sol` (DeFi pair vault idle↔active)
| Line | Site | Rounding | Verdict |
|---|---|---|---|
| 99 | `s.idleN -= got` before sizing L | exact | See **Flag ③** |
| 118-119 | `getLiquidityForAmount{0,1}(sLo,sHi,got)` | round down | ✅ provisions ≤ `got`; surplus stays as physical backing |

**Flag ① (not a bug):** `recover` under-removes liquidity by flooring `lrem`. Safe today because the
redeem waterfall reverts rather than underpay. It is the closest structural analog to the Bunni site
(a `mulDiv` of a share-of-reserve at a rounding boundary), so **D3 must fuzz the deploy→recover
round-trip** to prove the floor can never compound into a senior write-up.

**Flag ② (needs coverage, not a code fix):** the ERC4626 adapter's NAV honesty is *inherited* from the
external source's `previewRedeem`. A source that rounds `previewRedeem` UP would let `totalAssets()`
over-state the value backing senior par — the exact Bunni "trusted a conversion that rounded the wrong
way" vector. Our code picks the conservative view, but nothing *tests* that it holds against an
adverse-rounding source. → **A2 + `MockRoundingAdverseERC4626`.**

**Flag ③ (benign drift, worth an invariant):** in `MWJitLib.open`, `idleN` is decremented by the full
`got` withdrawn from the adapter, but the JIT position provisions only the floor-rounded `L` worth; the
un-provisioned remainder becomes untracked physical backing in the vault (conservative — real tokens,
not counted). The DeFi pair vault's existing `invariant_rounding_favors_vault` (`idleN ≤
adapter.totalAssets()`) already bounds the safe direction; no action needed beyond keeping that
invariant.

---

## Part 5 — Honest gaps & things I could not verify

1. **Adapters have no fuzzed conservation invariant suite** — the single biggest gap and the whole point
   of Group A. Today they have unit tests only (`MintwareERC4626YieldAdapter.t.sol` has a round-trip +
   one conservatism unit test; `MintwareMultiVenueYieldAdapter.t.sol`, `AaveV3YieldAdapter.t.sol` similar).
   The vault suites test adapters only through **mock** adapters, never the real ERC4626 adapter against
   an adversarial 4626.
2. **Treasury (v2) vault has no share-price-monotonic ghost** — only v1 does. Group C closes it.
3. **No explicit micro-withdrawal-loop probe** in either vault suite — cumulative conservation is
   asserted, but not the Bunni-specific dust-burst per-holder round-trip. Group B closes it.
4. **`MockRoundingAdverseERC4626` does not yet exist** — `MockFeeERC4626` models a *fee* (which our
   adapter's `previewRedeem` already nets), not an *adverse-rounding* source. The adverse-rounding mock
   is the one that would actually stress Flag ②.
5. **Could not verify against a live Arc 4626's real rounding.** The XyloVault behavior is reproduced by
   `MockFeeERC4626` from on-chain observation (per NatSpec), but the true source's `previewRedeem`
   rounding direction is not something this repo can confirm — hence A2 should run against the *adverse*
   mock as the worst case, and any real source should be re-checked at integration.
6. **`MWTreasuryPositionLib.recover` round-trip conservation** (Flag ①) is bounded only by the revert
   path today; D3 is needed to prove the floor cannot compound. I did not find an existing test that
   fuzzes deploy→recover→deploy specifically for par-identity conservation (the treasury suite fuzzes
   them but asserts coverage bounds, not round-trip par-losslessness).
7. **Part 0 (Bunni mechanism) precision** depends on the post-mortems; the paraphrased vulnerable calc
   should be treated as directional until cross-checked against the primary sources listed below.

### Sources

**Bunni V2 hack (2025-09-02, ~$8.3–8.4M):**
- Bunni post-mortem (primary; blog was unreachable to the research pass): http://blog.bunni.xyz/posts/exploit-post-mortem/
- Coinspect — most code-level detail (`balance - balance.mulDiv(shares, currentTotalSupply)`, `totalLiquidityEstimate0/1`, `5.83e16 → 9.114e15`): https://www.coinspect.com/learn-evm-attacks/cases/bunni/
- Halborn: https://www.halborn.com/blog/post/explained-the-bunni-hack-september-2025
- Dynamis LLP (`L = balance × Q96 / density`, min(L0,L1) flip, idle-fund redeployment): https://www.dynamisllp.com/knowledge/bunni-dex-hack-lessons-learned
- QuillAudits: https://www.quillaudits.com/blog/hack-analysis/bunni-v2-exploit
- Verichains: https://blog.verichains.io/p/bunnixyz-vulnerability-exposed-how
- Rekt: https://rekt.news/bunni-rekt
- The Block (carries Bunni post-mortem quotes): https://www.theblock.co/post/369564/bunni-smart-contract-rounding-error
- ⚠ Residual uncertainty: exact verbatim Solidity of the vulnerable line — reconstructed/cross-corroborated (`balance.mulDiv(shares, currentTotalSupply)` rounding DOWN in `BunniHubLogic::withdraw()`), not copied from source. Pull `BunniHubLogic.sol` at the pre-fix commit if a truly verbatim line is needed. Lending venue was **Euler** (per Bunni), not Aave.

**ERC-4626 rounding / inflation defense:**
- EIP-4626 spec (rounding section): https://eips.ethereum.org/EIPS/eip-4626
- OZ `ERC4626.sol` (virtual shares/assets, `_decimalsOffset`, security note): https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/extensions/ERC4626.sol
- OZ docs — ERC-4626 inflation attack: https://docs.openzeppelin.com/contracts/5.x/erc4626
- OZ blog — A Novel Defense Against ERC4626 Inflation Attacks: https://www.openzeppelin.com/news/a-novel-defense-against-erc4626-inflation-attacks
- Confirmed rounding rule (matches our code): deposit shares DOWN · previewMint UP · previewWithdraw UP · redeem assets DOWN · convertTo* DOWN.

**Foundry invariant testing + audited reference suites:**
- Foundry Book — Invariant Testing (handlers, `targetContract`/`targetSelector`, ghosts, `bound`, `fail_on_revert`): https://getfoundry.sh/forge/invariant-testing
- horsefacts/weth-invariant-testing (canonical handler/actor/ghost tutorial — `AddressSet`, `forEachActor`/`reduceActors`): https://github.com/horsefacts/weth-invariant-testing
- a16z/erc4626-tests (round-trip properties): https://github.com/a16z/erc4626-tests
- Trail of Bits crytic/properties ERC4626 ("shares never minted for free / tokens never withdrawn for free", `RoundingProps`, `SecurityProps` inflation): https://github.com/crytic/properties/blob/main/contracts/ERC4626/README.md
- Morpho MetaMorpho / vault-v2 (handler-based invariant suites for allocator vaults): https://github.com/morpho-org/metamorpho , https://github.com/morpho-org/vault-v2
- RareSkills invariant-testing guide: https://rareskills.io/post/invariant-testing-solidity
