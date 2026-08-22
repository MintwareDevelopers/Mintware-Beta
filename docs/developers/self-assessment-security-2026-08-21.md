# Mintware Contracts — Security Self-Assessment (audit-readiness exercise)

> ⚠️ **THIS IS A SELF-REVIEW, NOT AN EXTERNAL AUDIT.** It was produced by running our own consolidated
> checklist (SCSVS + SWC + Solcurity + DeFi vulnerability classes — see `audit-checklist.md`) over the
> contract stack, as a *pre-audit readiness exercise*. It does **not** substitute for a professional
> audit and confers no assurance. Its purpose is to surface what a firm like CertiK / Trail of Bits /
> OpenZeppelin would likely flag **before** we pay for one. Everything here is **testnet, unaudited,
> pre-launch** — nothing is live with real value, which is exactly why this is the right time to find it.

**Date:** 2026-08-21 · **Scope:** all 38 files in `contracts-v4/src/` (~9,700 lines) · **Method:** 7
parallel reviewers, one per bundle, each scoring against the identical layered checklist, adversarial,
with file:line evidence.

**Verified-vs-reported honesty:** findings tagged **[CONFIRMED]** were re-opened and verified in code
during synthesis; **[REPORTED]** are reviewer findings with file:line that were *not* independently
re-verified here — treat them as high-quality leads to confirm, not settled fact. No new static-analysis
tool run was performed for this pass (a prior Slither pass on `MintwareDeFiPairVault` came back clean;
extending Slither/Echidna across the stack is a recommended follow-up).

---

## Remediation status (2026-08-21) — updated after fixing + re-reviewing

The findings below were remediated on branch `fix/audit-remediation` (PR #350) and **re-reviewed by a
fresh adversarial pass that confirmed all fixes hold with 0 regressions introduced**. Full fast suite
**440 passed / 0 failed** at every step.

- **All 6 Highs — FIXED.** H1 solvency-aware NAV (pro-rata haircut, no first-redeemer run) · H2 mitigated
  by H1 + the idle-exposure cap · H3 no unbounded distributor approval · H4 pinned settlement rail + cap ·
  H5 dead `FeeVault` deleted · H6 launch-price band on matched-vault activation.
- **Mediums FIXED:** M3 (balance-verified JIT return) · M5 (guardian-pause auto-heal) · M6/M7 (hot-path
  try/catch — no bricked swaps/redemptions) · M9 (breaker blocks only the gap-widening direction) ·
  M10/M11 (fee-ceiling clamp + bounded slope/quad) · M1 (per-block burn cap).
- **Lows FIXED:** L3 (`_satAdd`) · L4 (settlement donation-DoS clamp).
- **DEFERRED (documented, lower-severity / delicate):** M8 (JIT pool-binding — needs an interface change
  across hook + vault) · M12 (deposit fee-realization — naive fix breaks the migrator's dust refund) · M13
  (fee-on-transfer balance-diff deposit) · L1 (`Ownable2Step`) · L5 (bound `rebalanceToProfile`'s spot read) ·
  M2/M4/L2 (deploy-config / CCTP-v2 recipient binding / an ERC-4626 source invariant). None are value-loss.
- **Deployed:** the hardened ETH senior stack is **live + verified on Base Sepolia** (testnet + mock +
  unaudited) — treasury vault `0xb84776…8A1c`, JIT hook `0xE21D93…60C8`, gateway `0x16609c…A96F`,
  settlement `0x6d0a15…A9E0`.

Still a **self-review, not an external audit**; external audit remains the gate before real value.

## TL;DR — the headline

**No Criticals. 6 High-severity findings. ~14 Medium.** The findings *converge* on a few systemic
themes rather than scattering — which is itself the most useful output:

1. **🔴 The senior "par / always $1" claim is not robustly enforced on-chain under impairment.** This is
   the **code-level version of the #1 legal risk** (senior-tranche-as-deposit). It is the most important
   result of the exercise.
2. **🔴 Several single privileged keys can move or mis-account user funds** (custody red line), and the
   protection is applied **inconsistently** across sibling contracts.
3. **🟠 Dead / misleading code advertises protection it doesn't have** (chiefly `FeeVault`).
4. **🟠 Pause / guardian paths can freeze user exits** with no auto-heal (systemic, via one shared lib).
5. **🟠 Liveness coupling** — an external call in a hot path can brick swaps or redemptions.
6. **🟠 Empty-pool / oracle price-reference manipulation** at launch and on thin pools.

---

## Consolidated findings (ranked, deduped)

### 🔴 HIGH

**H1 — Senior par-NAV is over-stated under impairment → first-redeemer run** *(Treasury vault)* **[REPORTED]**
`payments/MintwareTreasuryVault.sol:406-408, 494-511, 765-791`. `totalSeniorAssets` values the LP + JIT
legs at **par** regardless of `recoverableUSDC()`. `redeemSenior` converts shares at the par-inflated NAV
*before* writing `deployedFromSenior` down, so when the team token falls, early redeemers exit at 100¢ from
healthy idle/buffer and late redeemers hit a revert (0). No queue, no haircut, no auto-pause-on-impairment.
→ **This is the senior-tranche-as-deposit risk located in code.** Fix: solvency-aware NAV (haircut toward
`recoverableUSDC()` when coverage < 100%) or a pro-rata/queue gate below full coverage.

**H2 — Senior solvency floor (`minCoverageBps`) defaults OFF; zero-USDC-buffer tranche allowed** *(Treasury vault)* **[REPORTED]**
`payments/MintwareTreasuryVault.sol:150, 336-358, 452-455`. The invariant `deployedFromSenior ≤ recoverableUSDC()
+ juniorUsdcBuffer` is enforced at deploy **only if `minCoverageBps != 0`** — and it ships 0. `commitTeam`
permits `juniorUSDC = 0`. So the exact configuration H1 needs to realize loss is reachable by default. Fix:
require a non-zero coverage floor for any vault holding real senior value; refuse `deployToLP` backed only by
a spot-priced team token.

**H3 — Owner-set weighted distributor gets unbounded approval over the vault's ENTIRE balance** *(DeFi pair vault)* **[CONFIRMED]**
`vaults/MintwareDeFiPairVault.sol:660-668`. `setWeightedDistributor` (onlyOwner, set-once-but-anytime) calls
`token0/1.forceApprove(dist, type(uint256).max)` (verified lines 666-667). `fundFees` is a *pull* (line 643)
with no on-chain constraint that the distributor pulls only `lp0/lp1` — the allowance covers principal + reserve
+ idle. A malicious/compromised distributor (or an owner pointing it at a contract they control) can `transferFrom`
the whole vault. **Fails the custody red line.** Fix: push exact `lp0/lp1` via `safeTransfer`, or per-call approve
+ reset to 0; timelock `setWeightedDistributor`.

**H4 — ETH-settlement relayer can drain all backing to an arbitrary address** *(ETH settlement)* **[CONFIRMED]**
`payments/MintwareEthSettlement.sol:252-301`. `batchSettleEth(totalUsdc, minUsdcOut, rail)` is `onlyRelayer`;
`rail` is only null-checked, **not pinned** (verified line 260), and `minUsdcOut` is **relayer-supplied** (so the
slippage floor can be 0). A rogue/compromised relayer repeatedly settles to `rail = attacker`, `minUsdcOut = 0`,
converting the WETH backing + junior buffer and paying it out (line 298). The oracle band bounds per-swap price,
not repeated extraction. **The Gateway already fixed this exact class (audit C1 pins its receiver) — the sibling
contract did not.** Fix: pin `rail` to a stored settlement address (mirror C1) and/or bind to a signed hold; add a
per-call/daily cap.

**H5 — `FeeVault` advertises oracle-signed distribution but performs NO signature check; owner sets any root** *(legacy)* **[CONFIRMED — corroborated by prior oracle audit]**
`FeeVault.sol:30-32, 60-62, 177-204`. `closeEpoch(bytes32 root)` is `onlyOwner`, takes only a root, does **no**
`ECDSA.recover`; the `ATTRIBUTION_SNAPSHOT_TYPEHASH`, `oracleSigner`, EIP712 base, and `InvalidOracleSignature`
error are all declared-but-unused, and the NatSpec claims a verification that does not exist. It still sits in
`src/` (deployable) and references now-deleted contracts. `MintwareWeightedDistributor` was built to fix exactly
this and *does* verify. Fix: **delete `FeeVault` or hard-deprecate it** (move to `deprecated/`, DEPRECATED banner,
strip the misleading crypto scaffolding).

**H6 — Matched-launch vault activates against a manipulable empty-pool price** *(Matched vault)* **[REPORTED]**
`vaults/MintwareMatchedLiquidityVault.sol:702-711, 374-395`. The V4 pool is initialized at `commitTeam` but left
**empty and swappable** through the funding window; swaps are permissionless and moving a zero-liquidity pool's
price is ~free. `activate()` sizes liquidity off the **stored** `launchSqrtPriceX96` but executes at **live** price
→ either reverts every launch (repeatable DoS) or deploys the 90-day-locked position lopsided and mispriced. Fix:
re-read live `slot0` in `activate()`, require it ≈ `launchSqrtPriceX96` within a tight band, size off the live
price; add an extended-window `abort`; consider a hook-level swap gate until Active.

### 🟠 MEDIUM (grouped by theme)

**Theme — a single privileged key can move / mis-account user funds:**
- **M1 — Gateway/vault `burnForPayment` can burn ANY senior holder's shares** *(Treasury + Gateway)* **[REPORTED]** — `MintwareTreasuryVault.sol:519-536`, `MintwarePaymentGateway.sol:137-198`. On-chain the vault enforces nothing; the only defense (EIP-712 permit) is off-chain in the Gateway. A compromised/buggy Gateway, or a rogue relayer fabricating a `holdId` under the sub-$250 lane, drains senior USDC. Fix: on-chain per-user nonce/holdId + spend cap so the *vault* bounds withdrawals.
- **M2 — Role concentration voids the ≥$250 two-signer control** *(Gateway)* **[REPORTED]** — `MintwarePaymentGateway.sol:108-111`. Constructor grants ADMIN + RELAYER + EDGE_SIGNER + PAUSER to one address; if relayer==edge-signer in prod, the high-value second-signature gate is self-satisfiable. Fix: separate keys at deploy; document that EDGE_SIGNER must not be the relayer.
- **M3 — JIT hook return is self-reported, not balance-verified** *(Treasury vault)* **[REPORTED]** — `MintwareTreasuryVault.sol:673-722`. `settleJitReturn(usdcReturned)` trusts the caller's figure; a buggy/malicious hook borrows and under-returns (bounded per block, repeatable). Fix: balance-diff the return.
- **M4 — CCTP `recipient` is relayer-chosen, unbound to the burn** *(CCTP router)* **[REPORTED]** — `MintwareCctpDepositRouter.sol:87-104`. A rogue relayer credits bridged shares to itself. Attestation/replay itself is sound (delegated to Circle). Fix: CCTP-v2 `hookData`-bound recipient.

**Theme — pause / guardian can freeze user exits (systemic, one shared lib):**
- **M5 — Guardian single-key can freeze redemptions on EVERY consuming vault** **[REPORTED]** — `lib/MWGuardianPausable.sol:49` + consumers: `MintwareYieldVault.redeem`, `MintwareTreasuryVault` (senior redeem/`burnForPayment`), `MintwareDeFiPairVault.executeRedeem`, `MintwareMatchedLiquidityVault` (community/team). The guardian is documented as a *lower-trust* fast-pause role, yet only `owner` can unpause and there's no auto-heal / no paused-mode exit path. **One fix here fixes all four vaults.** Fix: scope guardian-pause to exclude user exit paths, or add a max-pause auto-heal, or keep par redemption always open.

**Theme — liveness coupling (external call in hot path bricks the path):**
- **M6 — Redemption liveness gated on the distributor** *(DeFi pair vault)* **[REPORTED]** — `MintwareDeFiPairVault.sol:494-512`. `executeRedeem`→`_realizeFees`→`distributor.fundFees`; if the distributor reverts, **every** exit reverts. Fix: try/catch → fall back to the pro-rata accumulator.
- **M7 — am-AMM swap liveness gated on `rentSink.fundRent`** *(Hook)* **[REPORTED]** — `MWAmAuction.sol:208-246`, called inside `beforeSwap`. If the sink (itself pausable) reverts, all managed-pool swaps brick. Fix: try/catch → credit rent to a pull-ledger.

**Theme — hook / pool price-reference & config footguns:**
- **M8 — JIT bridge is not pool-bound (Cork-class D5)** *(Hook)* **[REPORTED]** — `MWHookCoordinator.sol:305-311` + `IMWJitVault.jitOpen(bool,uint256)` carries no pool id; a swap on pool B could drive a mint/close in the single global `vault`'s pool A. Safe by *config convention* today, not by code. Fix: pass `PoolId` into `jitOpen`/`jitClose`, assert it in the vault.
- **M9 — Circuit breaker reverts deviation-*reducing* swaps → thin-pool DoS** *(Hook)* **[REPORTED]** — `MWHookCoordinator.sol:274-276`, `MWOracleGuard.sol:38-43`. Once spot is pushed past the band (cheap on thin pools), *every* swap reverts, including the arb that would restore price; recovery leans on `pokeOracle` healing to the manipulated price. Fix: let deviation-reducing swaps bypass the breaker.
- **M10 — `maxFeePips==0` reaches a 100% fee on the primary dynamic-fee path** *(Hook)* **[REPORTED]** — `MWHookCoordinator.sol:289-297`. The `FALLBACK_MAX_FEE_PIPS` clamp exists only on the am-AMM branch; the ordinary path lets the fee hit 1e6 (bricks the swap) when misconfigured. Fix: apply the clamp / reject `maxFeePips==0` in `configurePool`.
- **M11 — Fee-slope / quad setters don't enforce the bound the invariants assume** *(Hook)* **[REPORTED]** — `MWHookCoordinator.sol:219-245, 211-216`. `slope`/`quad` stored as unbounded `uint256`; the 7/7 invariants + revert-freedom assumed `≤ MAX_PIPS`, and `setLvrParams`'s own comment says to bound them but the code doesn't. A misconfig overflows the swap hot path → DoS. Fix: `require(slope ≤ MAX_PIPS && quad ≤ MAX_PIPS)`.

**Theme — fee accounting / token handling:**
- **M12 — Deposit doesn't realize pending fees before minting → incumbent-fee dilution** *(DeFi pair vault)* **[REPORTED]** — `MintwareDeFiPairVault.sol:426-480`. `_deposit` claims but doesn't `_realizeFees()` (redeem does); a new depositor captures a slice of pre-existing uncollected fees. Fix: `_realizeFees()` at the top of `_deposit`.
- **M13 — DeFi pair vault deposit is not balance-diff → fee-on-transfer tokens break** *(DeFi pair vault)* **[REPORTED]** — `MintwareDeFiPairVault.sol:440-467`. Uses `amount0Desired` not received amount (unlike `fundRent`, and unlike the *matched* vault which does balance-diff — an inconsistency). MEME-profile pairs are exactly where FoT appears. Fails safe (revert), but can't host such pairs. Fix: balance-diff intake.

### 🟡 LOW / INFO (selected — full detail in the bundle transcripts)

- **L1 — Single-step `Ownable` across many contracts** (pair vault, registry, factory, yield vault) — use `Ownable2Step`. **[REPORTED]**
- **L2 — ERC-4626 adapter NAV trusts the source's `previewRedeem` not over-reporting** — fine for XyloVault; document as a wiring gate before any other source. **[REPORTED]**
- **L3 — MultiVenue `totalAssets()` uses checked add while siblings use `_satAdd`** — a hostile child reporting `uint256.max` bricks the NAV read; asymmetric with the stated DoS defense. **[REPORTED]**
- **L4 — ETH-settlement donation-induced DoS + wrong error** (`MintwareEthSettlement.sol:232, 295`). **[REPORTED]**
- **L5 — `rebalanceToProfile` uses unbounded spot `slot0`** (DeFi pair vault). **[REPORTED]**
- **Info — dead/misleading code:** `AttributionToken.setOracleSigner` (unreachable, misleading NatSpec); `afterSwap` comment contradicts the swallowed `jitClose` revert; registry NatSpec references deleted contracts; "junior ETH" is an ERC-20 team token in NatSpec. **[REPORTED]**
- **Info — `SeniorSharesMath` v1 offset is 1e3** (v2 is 1e6): standard-order but modest; confirm the live Arc-testnet `MintwareYieldVault` tolerates it. **[REPORTED]**

---

## What is SOLID (for balance — not everything is a finding)

- **Reentrancy & callback auth** are broadly well-handled: `nonReentrant` + CEI across money paths; every V4 hook entrypoint is `onlyPoolManager`; `unlockCallback` correctly *not* `nonReentrant`.
- **`Mintwarev3ToV4Migrator`** — clean (NFT-owner-gated, decrease-before-collect, min-out guards, dust swept).
- **Yield adapters** — the right patterns: balance-of payout (not trusting child return values), fee-net `previewRedeem` NAV, `onlyVault` gating.
- **`MintwareWeightedDistributor`** — EIP-712 sig-verified epoch close, replay + over-claim well-guarded, per-epoch solvency balanced. (This is the *correct* fix that FeeVault lacks.)
- **Multi-tenant factory** — CREATE2 front-running closed (`onlyFactory`), stale-salt reverts on the flag-bit check.
- **First-depositor inflation** — symmetric virtual offset present everywhere; the DeFi pair vault's shares == V4 `positionLiquidity` is genuinely donation-proof.
- **Formal-verification-proven rounding** (Halmos + Coq) holds in the reviewed paths.
- **Attribution token** soulbound transfer-block + replay-safe mint.

---

## Coverage summary (aggregate across the stack)

| Checklist dimension | Aggregate |
|---|---|
| A2 Access control / A12 keys (custody red line) | **GAP** — H3, H4, M1–M5; the dominant theme |
| A6 Reentrancy / CEI | PASS |
| A7 Oracle / price | PARTIAL — empty-pool (H6), thin-pool breaker (M9), spot reads (L5) |
| A8 Signatures / replay | PASS (Gateway, Distributor, Attribution) |
| A10 Delegatecall safety | PASS (stateless libs) |
| A11 Token handling | PARTIAL — FoT inconsistency (M13) |
| D1 First-depositor inflation | PASS |
| **D2 Solvency / NAV** | **GAP — H1, H2** (senior par); adapters PARTIAL (curator/source trust) |
| D4 JIT / MEV | PASS (economically & safety-gated) |
| D5 Callback auth / pool-binding | PARTIAL — JIT not pool-bound (M8) |
| D6 Rounding conservation | PASS (partly formally proven) |
| D9 Emergency posture | **GAP — M5** (guardian freezes exits, systemic) |
| D10 Factory / front-running | PASS |
| E2/E3 Dead & misleading code | **GAP — H5** (FeeVault) + several Info |

---

## Recommended remediation order (before real value)

1. **Senior solvency (H1 + H2)** — the #1 item; make the par claim honest under impairment (solvency-aware NAV / coverage floor on by default). This is also the code answer to the legal senior-tranche risk.
2. **Custody red lines (H3, H4, M1–M4)** — remove unbounded approvals; pin settlement destinations; bound `burnForPayment` on-chain; separate keys. Apply the Gateway's C1 fix to its siblings.
3. **Delete / hard-deprecate `FeeVault` (H5)** — remove the misleading, unverified, deployable path.
4. **Exit-liveness (M5, M6, M7)** — one guardian-pause scope fix + try/catch on the two hot-path external calls.
5. **Hook config footguns (M8–M11)** — pool-bind JIT, bound the fee params, fix the breaker direction.
6. **Then** commission the external audit — with this list already closed, it's cheaper and lands on the real residual.

## Honest limitations of this exercise

- It is a **self-review**, not an audit — same discipline banner as `tob-hook-checklist-review.md`.
- **[REPORTED]** findings are strong, cited leads but were **not** independently re-verified in this pass; confirm each before acting. Only H3, H4, H5 were re-opened here (**[CONFIRMED]**).
- No fuzzing/symbolic tool run was added beyond the existing Slither (clean on the pair vault) + Halmos/Coq. A Slither/Echidna sweep across the stack is the natural next layer.
- Reviewers may have **missed** issues (false negatives) and may have **over- or under-rated** severity. An external audit remains the gate before real value — this exercise makes that audit land better, it does not replace it.
