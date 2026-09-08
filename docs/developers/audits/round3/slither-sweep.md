# Slither sweep — full LP Gateway surface (round 3)

**Date:** 2026-09-08 · **Tool:** Slither 0.11.5, per-contract direct-solc · **solc:** 0.8.26 (`solc-select`)
**Scope:** the five contracts of the LP Gateway attack surface, including
`MintwareIdleYieldAdapter.sol` (branch `feat/lp-gateway-idle-yield-adapter`) which had **never been
Slither-scanned before**. Read-only; nothing under `contracts-v4/src/` was modified.

---

## Summary

**Slither produced 66 findings across our own code (2 High / 35 Medium / 26 Low / 3 Informational). After
triage, the real count is ZERO — every one of the 66 is a false positive or explicitly-by-design.** That
is a genuinely good outcome and it is stated plainly rather than softened: the two "High"
`arbitrary-send-erc20` hits are both the `onlyVault` + `transferFrom(vault, …)` pattern where `vault ==
msg.sender` by modifier, the 13 `reentrancy-balance` and 6 `reentrancy-no-eth` hits are all inside
`nonReentrant` externals whose "stale balance" is a deliberate before/after delta measurement, and every
`uninitialized-local` is a declare-then-conditionally-assign with a correct zero default. **Nothing found
by Slither can move funds incorrectly**, so there is no bolded block above this summary.

Two genuine (minor) observations came out of the **hand-reading done to triage** Slither's output, not out
of Slither itself — both Low/Informational, both written up below with a minimal proposed fix and **not
applied**:

| # | Where | Severity | One line |
|---|---|---|---|
| **H-1** | `MintwareIdleYieldAdapter.deposit` | **Low** (griefing, attacker-funded) | Because the cap is checked against `balanceOf(this)`, an outsider can donate up to `depositCap` and **close deposits** until the owner raises the cap. The donation itself is a gift to existing holders, so the attacker burns real value — but on a deliberately small "pre-audit" cap the DoS is cheap. Already asserted (as intended behaviour) by `test_donation_is_counted_in_totalAssets_but_cannot_bypass_the_cap`. |
| **H-2** | `MintwareLpGatewayPositionManager._withdraw` line 557 | **Informational** | `idleGot` is not clamped to `fromIdle`. A fee-charging ERC-4626 source whose `previewWithdraw` rounds up can make `staging.unstage` return 1–2 wei more than asked, so a withdrawer receives dust above entitlement. Sub-wei magnitude; the 4626 over-return case is already anticipated in `MintwareLpGatewayStaging.unstage` (X-3, line 68-73), just not clamped one layer up. |

Environment note: the `ParsingError: Type not found enum LockTier` bug that blocks the whole
`contracts-v4/src/vaults/` directory (memory `slither_tooling_workaround`) **did not fire here** — none of
the five files imports `VaultTypes.sol`, transitively or otherwise (verified by import graph before
running). Both yield adapters import only OZ + `./IYieldAdapter.sol`. All five analyses completed.

Cross-check: `forge test` — `MintwareIdleYieldAdapter.t.sol` **18/18 pass**, `contracts-v4/test/gateway/*`
**61/61 pass**, at the time of this sweep. No fallback to hand-reading + Aderyn was needed, since Slither
ran clean; `aderyn-sweep.md` landed in this directory from a parallel run while this sweep was in
progress. **Independent convergence worth noting:** that sweep reached H-1 below by a different route
(its IDLE-2), and Aderyn's own 88 detectors did not flag it either — two tools missed it, two hand-reads
found it. It also adds a related availability item this sweep did not cover (IDLE-1: the LP-Gateway
deposit rail never checks `maxSuppliable()`, so a forgotten `depositCap` surfaces as an unmodelled
`DepositCapExceeded` revert). Read the two reports together for the new adapter.

---

## How it was run (reproducible)

`slither .` still fails on this repo (crytic-compile chokes on Foundry's abbreviated build-info). The
per-contract direct-solc workaround, with this repo's exact remappings:

```bash
solc-select install 0.8.26          # was NOT present on this box; ~/.svm does not exist here
SOLC=$HOME/.solc-select/artifacts/solc-0.8.26/solc-0.8.26
REMAPS="@uniswap/v4-core/=contracts-v4/lib/v4-core/ \
@uniswap/v4-periphery/=contracts-v4/lib/v4-periphery/ \
@openzeppelin/contracts/=contracts-v4/lib/openzeppelin-contracts/contracts/ \
@pyth-network/pyth-sdk-solidity/=contracts-v4/lib/pyth-sdk-solidity/ \
forge-std/=contracts-v4/lib/forge-std/src/"

# run from the REPO ROOT (foundry.toml lives there, src = contracts-v4/src)
slither <path>.sol --solc "$SOLC" --solc-remaps "$REMAPS" \
        --solc-args="--via-ir --optimize" --filter-paths "contracts-v4/lib"
```

`--solc-args=` **must** use `=`, not a space (argparse eats `--via-ir` otherwise). `--filter-paths
"contracts-v4/lib"` drops the OZ/v4/permit2 noise — the unfiltered runs were 20 / 17 / 198 / 202 / 23
results, of which 66 are in our code.

Raw counts (our code only):

| File | Findings | Note |
|---|---|---|
| `MintwareIdleYieldAdapter.sol` | 3 | first Slither scan ever |
| `MintwareLpGatewayStaging.sol` | 1 | also re-surfaces inside the PM run |
| `MintwareLpGatewayPositionManager.sol` | 53 | includes the 1 Staging finding (imported) |
| `MintwareLpGatewayFactory.sol` | 57 | = the PM's 53 + **4 factory-specific** |
| `MintwareERC4626YieldAdapter.sol` | 6 | |
| **Unique total** | **66** | 2 High / 35 Med / 26 Low / 3 Info |

---

## 1. `MintwareIdleYieldAdapter.sol` — BRAND NEW, never Slither-scanned

3 findings. All false positives / by-design. The two genuine notes below (H-1, plus two deploy-time
footguns) were found by hand-reading, not by Slither.

| # | Detector (Slither sev.) | Location | Real or FP? | Reasoning · existing mitigation · gap |
|---|---|---|---|---|
| I-1 | `arbitrary-send-erc20` (**High**) | `deposit` → `asset.safeTransferFrom(vault, address(this), amount)` L111 | **False positive** | Slither's rule is "`from` is not `msg.sender`, so an approval by a third party can be drained". Here the function carries `onlyVault` (L107 modifier → L62 `if (msg.sender != vault) revert OnlyVault()`), so **`vault == msg.sender` on every reachable call** — `transferFrom(vault, …)` is literally `transferFrom(msg.sender, …)` written the long way. There is no third-party approval to steal: the only address that can ever be `from` is the only address that can call. Identical shape to the already-triaged FP in `MintwareERC4626YieldAdapter` (E-1). Covered by `test_onlyVault_gates_deposit_and_withdraw`. **No gap.** |
| I-2 | `incorrect-equality` (Med) | `withdraw` → `if (withdrawn == 0) return 0;` L121 | **False positive** | The detector targets strict equality on *balances/timestamps that an attacker can nudge*. This is an early-out on a locally-computed `min(amount, bal)` (L120) purely to skip a zero-value `safeTransfer` and a noise event. `withdrawn` is not compared to anything manipulable and nothing branches on it beyond the skip. **No gap.** |
| I-3 | `missing-zero-check` (Low) | constructor `vault_` → `vault = vault_` L73 | **Real, but deliberate and documented** | `vault_ == 0` is the *intended* deploy-order state (NatSpec L67 "may be zero, set later via `setVault`") — the adapter must exist before the staging contract that will own it. The sink is then closed permanently by `setVault` (L86-91: rejects zero, and `if (vault != address(0)) revert VaultAlreadySet()` makes it one-time). While `vault == 0` the adapter is inert: `onlyVault` can never pass, since `msg.sender` can't be the zero address. Locked by `test_setVault_is_one_time` + `test_setVault_rejects_zero_address`. **Already mitigated — no gap.** |

### H-1 (hand-found, **Low**) — a donation to the adapter closes deposits

```solidity
// MintwareIdleYieldAdapter.sol:107-113
function deposit(uint256 amount) external override onlyVault nonReentrant {
    if (amount == 0) return;
    uint256 bal = asset.balanceOf(address(this));     // ← live balance, includes donations
    if (bal + amount > depositCap) revert DepositCapExceeded();
```

**Is it real?** Yes, and it is already *asserted* as intended behaviour by
`contracts-v4/test/MintwareIdleYieldAdapter.t.sol:80-89` — a donor transfers `CAP` straight to the
adapter and `adapter.deposit(1)` then reverts `DepositCapExceeded`. So the behaviour is known and locked
in; what the NatSpec (L104-106) does **not** say is the flip side. It correctly claims a donation "never
bypasses the cap" — true — but a donation also **fills** the cap, which shuts the LP Gateway's deposit
path (`PM._deposit` → `staging.stage` → `adapter.deposit`, no try/catch on that path — PM L448) until the
owner calls `setDepositCap`.

**Is it already mitigated?** Partially, by economics, not by code. The donated tokens are counted in
`totalAssets()` (L128) and therefore in the PM's NAV, so they accrue to *existing* shareholders — the
griefer is making an irrecoverable gift. Recovery is a single owner tx (`setDepositCap`, L96). But the
whole point of this cap is to be **small** ("accept a small amount of real value while there is no
external audit yet", NatSpec L31-37), and a small cap is exactly what makes the grief cheap: at a $5k
pre-audit cap, $5k of USDG closes new deposits until an operator notices and reacts. There is no
`DepositCapExceeded` alert path wired off-chain today.

**Genuine gap?** Minor, and it is a design trade-off rather than a defect. Corroborated independently:
`aderyn-sweep.md` reaches the same conclusion as its **IDLE-2** by a different route, and proposes the
same tracked-principal fix. **Proposed minimal fix (NOT applied — lead's call):** track supplied principal instead of reading the live balance, so donations
raise NAV but do not consume cap headroom:

```solidity
uint256 public totalSupplied;                       // + storage

function deposit(uint256 amount) external override onlyVault nonReentrant {
    if (amount == 0) return;
-   uint256 bal = asset.balanceOf(address(this));
-   if (bal + amount > depositCap) revert DepositCapExceeded();
+   if (totalSupplied + amount > depositCap) revert DepositCapExceeded();
    asset.safeTransferFrom(vault, address(this), amount);
+   totalSupplied += amount;
    emit Supplied(amount);
}
// withdraw: totalSupplied -= Math.min(withdrawn, totalSupplied);
// maxSuppliable: totalSupplied >= depositCap ? 0 : depositCap - totalSupplied;
```

Cost of the fix: one extra SSTORE per deposit/withdraw, one new storage slot, and it makes the cap a
*principal* bound rather than an *exposure* bound (the current version guarantees "this adapter never
holds more than `depositCap`", which the fix would weaken to "never took in more than `depositCap`").
Given the cap's stated purpose is bounding **real value at risk**, the current behaviour is arguably the
safer of the two and the right resolution may simply be **a NatSpec sentence + an ops alert**, not a code
change. Flagged for the lead precisely because that judgement is not the auditor's to make.

### Two deploy-time footguns on the new contract (Informational, no fix proposed)

- **`vault_` non-zero at construction is irreversible.** If the deployer passes a *wrong* non-zero
  `vault_`, `setVault` can never correct it (L88 `VaultAlreadySet`) and the adapter is permanently bound
  to the wrong sink. The one-time rule is correct security-wise; the constructor just has no equivalent
  sanity check. Mitigated in practice because the factory refuses such an adapter — see next bullet.
- **A pre-wired `vault_` makes the adapter unusable with the factory.**
  `MintwareLpGatewayFactory._verifyAdapterBinding` (L122-123) reverts `AdapterAlreadyBound` when
  `adapter.vault()` is already non-zero. `MintwareIdleYieldAdapter` exposes a public `vault` getter, so it
  hits that probe. **This is the correct fail-closed direction**, but it means the mainnet/testnet deploy
  script *must* construct this adapter with `vault_ = address(0)` and let `Staging` be wired afterwards,
  exactly as `MintwareERC4626YieldAdapter` is. Worth a line in the runbook rather than a code change.
  Covered by `test_adapterBinding_vaultAlreadyWired_reverts`.

---

## 2. `MintwareLpGatewayPositionManager.sol` — the money-critical core

52 file-local findings (the 53rd is the Staging one, §3). All FP / by-design. Grouped by detector; the
round-3 additions the brief called out (`_marksHigher`, `_recordEntryHigh`, `_entryHigh`, `_holderMark`,
the per-leg re-credit in `_withdraw`, `DeployNotTwoSided`, the parked-quote accounting) are each triaged
explicitly.

| # | Detector (sev.) | Count | Location | Real or FP? | Reasoning · mitigation · gap |
|---|---|---|---|---|---|
| P-1 | `reentrancy-balance` (Low) | 13 | `_withdraw` L490-616 (4), `deploy` L641-743 (9) | **False positive — and Slither's explanation is wrong for this code** | Every instance says "balance read before the call … possible stale balance used after in a condition". In `deploy` the flagged "stale" values are `quoteUsed`/`pairedUsedVal`, which are **deliberately** `balanceBefore − balanceAfter` deltas (L695-696 vs L711-714): the whole point is to measure what the mint actually consumed, so reading before *and* after is the mechanism, not the bug. In `_withdraw` the "stale variable" is `quoteOut` at L612 — `quoteOut` is not a balance read at all, it is an accumulator of amounts this function itself transferred (L560, L572), checked against the caller's own `minQuoteOut` floor. Slither is pattern-matching `balanceOf` → later comparison without following the dataflow. Additionally, both entry points (`withdraw`/`withdrawWithMin` L465-477, `deploy` L641-645) are `nonReentrant`, so no reentrant write can land between the reads. **No gap.** |
| P-2 | `incorrect-equality` (Med) | 12 | L434, L443, L497, L501, L537, L539-541, L593, L600, L689, L851, L866, L387 | **All false positives** | Three sub-classes, none attacker-nudgeable: (a) **block-number identity** `_lastActionBlock[msg.sender] == block.number` (L434/L497) — this *is* the same-block deposit+withdraw guard, an equality check is the correct and only sensible form; (b) **zero guards before division / early-outs** — `navW == 0` (L537, L600), `lpSpotVal == 0` (L539-541), `pairedAmount == 0` (L851), `amount == 0` (L866), `sharesMinted == 0` (L443), `liquidity == 0` (L689); a strict `== 0` is exactly right for a divide-by-zero guard; (c) **round-3 additions** — `lastHolder = shares == ts` (L501) is sound because `shares ≤ sharesOf[msg.sender] ≤ totalShares`, so `shares == ts` implies the caller holds every share; `period % 2 == 0` (L387) is bucket parity in `_recordEntryHigh`, arithmetic on `block.number / ENTRY_MEMORY_BLOCKS`, not a value comparison; `idleGot == 0 && (lpFailed \|\| liqToRemove == 0)` (L593) is the "nothing was delivered → return the whole claim" branch, where `== 0` is precisely the condition wanted. **No gap.** |
| P-3 | `reentrancy-no-eth` (Med) | 6 | `_deposit` L431-460, `_withdraw` L490-616, `deploy` L641-743 | **False positive** | Flags state written after `staging.stage/unstage`, `positionManager.modifyLiquidities`, `permit2.approve`, and the `this.lpLegExit` self-call. Every public entry point is `nonReentrant` (L421, L427, L465, L471, L644, L750, L785), and the self-call to `lpLegExit` works *because* that function deliberately carries no guard — it is gated instead by `if (msg.sender != address(this)) revert NotSelf()` (L624), which no external caller and no token callback can satisfy. Checked the one hole: `poke()` (L632) is permissionless and un-guarded, so a paired token with a transfer hook could re-enter it mid-exit and advance `_refSqrtPrice`. Traced the consequence: `spot`, `w` and `lpSpotVal` are all cached **before any external call** (L521-524, documented as RT-2), so the payout size cannot move; the only post-call read of `_refSqrtPrice` is L599 `min(_deployedQuoteValueAt(spot), _deployedQuoteValueAt(_refOrSpot(spot)))`, and because it is a `min` against the *cached* spot value, a poked reference can only ever raise `lpValLow` up to the spot value — never above it. So the failed-LP-leg re-credit stays bounded by the fair-at-spot amount. **Bounded, no gap**; a paired token with transfer hooks is in any case an explicit curation exclusion (`lp-gateway.md` residuals). |
| P-4 | `uninitialized-local` (Med) | 7 | `_withdraw` L516 `spot`, L518 `liq`, L519 `lpSpotVal`, L553 `idleGot`, L569 `lpFailed`, L592 `reCredit`; `deploy` L663 `quoteGot` | **False positive** | All seven are declare-then-conditionally-assign where the Solidity zero default *is* the intended value. Verified each: `spot`/`liq`/`lpSpotVal` are only assigned under `if (tokenId != 0)` (L520-525) and every downstream use is guarded (`lpSpotVal == 0 ? 0 : …` L541; `_deployedQuoteValueAt` itself returns 0 when `tokenId == 0`, L821, so even the `spot = 0` path at L599 is safe — and that path is unreachable anyway, since `lpFailed` requires `liqToRemove > 0` which requires `lpSpotVal != 0`). `idleGot`/`lpFailed`/`reCredit` default to "nothing happened", which is what the re-credit branch at L593 expects. `quoteGot` defaults to 0 for a paired-only deploy, which the two-sided check at L721-724 then correctly rejects. **No gap.** |
| P-5 | `unused-return` (Med) | 4 | L245, L414, L673 `getSlot0`; L72 `adapter.withdraw` (Staging, §3) | **False positive** | The three `getSlot0` hits are tuple destructuring — `(uint160 s,,,)` — which is the idiomatic way to take only `sqrtPriceX96`. Slither reports every ignored tuple member as an "unused return". **No gap.** |
| P-6 | `reentrancy-benign` (Low) | 5 | `_deposit` L458, `_withdraw` L614, `compoundQuote` L790, `deploy` L739-741, plus `_anchorFollow` writes | **False positive** | Slither itself classes these as benign: the post-call writes are `_refSqrtPrice`/`_refBlock`/`_entryPeriodA|B`/`lastKnownIdle`, i.e. **bookkeeping that is deliberately refreshed last**, after the external interaction that changed the thing being recorded. `_anchorFollow` at the end of each path is the documented design (L458, L614, L741, L753). All under `nonReentrant`. **No gap.** |
| P-7 | `reentrancy-events` (Low) | 1 | `_sweepFees` L769 `Harvested` after `modifyLiquidities` | **False positive** | Event-after-interaction only. `_sweepFees` is reachable only from `harvest`/`deploy`/`lpLegExit`, all under the outer `nonReentrant`. Emitting after the call is required to report the *actual* swept amounts. **No gap.** |
| P-8 | `timestamp` (Low) | 2 | `acceptHarvestRecipient` L287; `_withdraw` L612 | **1 by-design, 1 misattributed** | L287 `block.timestamp < harvestRecipientEta` is the **48h harvest-recipient timelock** (`HARVEST_RECIPIENT_DELAY`, L76) — a validator can shift `block.timestamp` by seconds, which is nothing against a 48-hour delay. The second hit is simply **wrong**: Slither points at L612 `quoteOut < minQuoteOut \|\| pairedOut < minPairedOut`, which contains no timestamp at all; it is the caller's slippage floor. Slither has attributed a function-level `block.timestamp` use (`block.timestamp` is passed as the `deadline` arg at L571) to an unrelated comparison. **No gap.** |
| P-9 | `cyclomatic-complexity` (Info) | 2 | `_withdraw` (30), `deploy` (20) | **Real, and accepted** | Both numbers are accurate and both functions are money-critical, so this is the one finding worth not waving away. Mitigating context: the complexity is the *product* of the audit rounds (each best-effort leg, each re-credit branch, each fail-closed guard is a documented finding fix), the contract is EIP-170-constrained so extracting helpers costs bytecode, and the arithmetic is covered by `MintwareLpGatewayAuditRound2Fork.t.sol` + `MintwareLpGatewayHardeningFork.t.sol` + the round-3 replay suites. Independently re-derived the `_withdraw` re-credit algebra by hand during this triage (see box below) and it is sound. **No fix proposed** — a refactor of `_withdraw` before external audit would *cost* assurance, not add it. |
| P-10 | `too-many-digits` (Info) | 1 | `Q96 = 0x1000000000000000000000000` L49 | **False positive** | The canonical Uniswap `2**96` constant, written in hex as the ecosystem writes it. **No gap.** |

**Re-derived by hand (the part Slither cannot check): does the per-leg re-credit ever over-credit?**
`_withdraw` L590-611 credits shares back for whatever could not be delivered. An over-credit would let a
withdrawer keep shares *and* take value — the one thing here that could move funds incorrectly. It
cannot, and the bound is monotone rather than incidental:

- idle part = `shares · (fromIdle − idleGot) / (fromIdle + lpEntitled)` (L597), denominator `= claimTotal`.
- LP part = `shares · lpEntLow / (fromIdle + lpEntLow)` (L602), with
  `lpValLow = min(value@spot, value@ref)` (L599) and `lpEntitled` taken at `w = _holderMark(spot)` (L522).
- `_holderMark` returns the *most holder-favourable* of spot / follower / entry memory (L405-411), so
  `lpValLow ≤ lpSpotVal` ⇒ `lpEntLow ≤ lpEntitled`. Since `x ↦ x/(c+x)` is increasing,
  `lpEntLow/(fromIdle+lpEntLow) ≤ lpEntitled/claimTotal` — the smaller denominator never wins.
- Sum ≤ `shares·[(fromIdle − idleGot) + lpEntitled] / claimTotal ≤ shares`. The explicit
  `if (reCredit > shares) reCredit = shares` (L604) is belt-and-braces, not load-bearing.
- Pro-rata is genuinely price-neutral: `fromIdle ≈ shares·idle/(ts+V)` and
  `liqToRemove ≈ liq·shares/(ts+V)` — `w` algebraically cancels out of both, so the mark affects only the
  *composition* reported, never the size, exactly as the L479-489 NatSpec claims.
- `idleGot ≤ fromIdle` holds on the normal path (`payParked ≤ fromIdle` L555, `unstage` returns
  `≤ requested`), which is what makes L597 a true shortfall. The one exception is H-2 below.

### H-2 (hand-found, **Informational**) — `idleGot` is not clamped to `fromIdle`

```solidity
// MintwareLpGatewayPositionManager.sol:555-557
uint256 payParked = Math.min(quoteAsset.balanceOf(address(this)), fromIdle);
idleGot = payParked;
if (idleOk && fromIdle > payParked) idleGot += staging.unstage(fromIdle - payParked);
```

`MintwareLpGatewayStaging.unstage` returns a **measured balance delta** (`unstage` L71-73), not the
adapter's claimed figure — deliberately, per X-3. With `MintwareERC4626YieldAdapter` that delta can
legitimately come back **1–2 wei above the request**: `withdraw` sizes shares from
`previewWithdraw(want)` (adapter L126), which rounds *up*, and then `redeem(shares)` (L132) delivers the
assets those rounded-up shares are worth. Staging's own comment already anticipates "a source that
over-reports by 1 wei" — but the PM does not clamp, so `idleGot` can exceed `fromIdle`, `quoteOut`
carries the dust, and `fromIdle > idleGot` at L597 is simply false (no negative re-credit — Solidity
0.8 would revert on the underflow, so there is no silent corruption either).

**Real?** Yes, but at wei magnitude, paid out of the shared reserve, and only against a fee-charging
4626 source. It is nowhere near a fund-safety issue; it is listed because it is the only place in the
exit path where a delivered amount is not bounded by its entitlement. `MintwareIdleYieldAdapter` cannot
trigger it (`withdrawn = min(amount, bal)`, L120).

**Proposed minimal fix (NOT applied):**

```solidity
  if (idleOk && fromIdle > payParked) idleGot += staging.unstage(fromIdle - payParked);
+ if (idleGot > fromIdle) idleGot = fromIdle;   // 4626 previewWithdraw rounds up; keep the dust parked
```

The clamped-off dust stays in the PM's own balance, which `_idle()` already counts as NAV (L315,
R3-INV-2), so nothing is stranded — it simply accrues to the remaining holders instead of the exiter.
One line, no new storage, no behavioural change on the `MintwareIdleYieldAdapter` path.

### Round-3 additions specifically re-read (no Slither finding, no defect found)

- `_marksHigher` (L377-381) — the `b == 0 ⇒ true` / `a == 0 ⇒ false` asymmetry is correct and is the
  R3-INV-3 fix: an unset bucket must never be *compared* as sqrtPrice 0, which on a
  quote-is-currency0 pool would mark the LP leg at its range-edge maximum.
- `_recordEntryHigh` / `_entryHigh` (L385-400) — the two-bucket alternation is sound. One honest
  residual: because a bucket is only ever *replaced* (never expired), after a long quiet spell
  `_entryHigh` can return a value from an arbitrarily old period, marking a new deposit high and
  minting them fewer shares than the live price would. That is conservative for the protocol and
  costly only to the arriving depositor, who has `depositWithMin` (L427, floor enforced L444) to
  protect themselves, and `poke()` (L632) to refresh the parity bucket. Behaviour matches the L118-125
  NatSpec; no change proposed.
- `DeployNotTwoSided` (L719-725) — correctly checked on **used** amounts (`quoteUsed`/`pairedUsed`,
  L713-714), so returning the paired leg to the caller cannot satisfy it. Verified both degenerate
  inputs revert: `quoteToDeploy = 0` and `pairedAmount = 0` each drive one side to zero and trip the
  50% band.
- Parked-quote accounting in `_idle`/`deploy` — traced the full ordering. `_sweepFees` (L660) measures
  a delta and forwards only the delta (L913-926), so parked depositor quote is never swept to
  `harvestRecipient`; `fromParked` (L665) is capped at `quoteToDeploy`; `quoteBefore` (L695) is read
  *after* the permits and *before* the mint; `quoteLeft` re-stage is best-effort with the approval
  correctly zeroed in the catch (L734). No path lets parked principal escape NAV.

---

## 3. `MintwareLpGatewayStaging.sol`

| # | Detector (sev.) | Location | Real or FP? | Reasoning |
|---|---|---|---|---|
| S-1 | `unused-return` (Med) | `unstage` L72 `adapter.withdraw(amount)` | **False positive — Slither's advice would reintroduce a fixed bug** | Slither wants the return value used. Ignoring it is the **round-3 X-3 fix**, documented inline at L68-70: the contract measures `balanceOf` before/after (L71, L73) precisely *because* trusting the adapter's self-reported figure is unsafe — a source over-reporting by 1 wei would brick every withdraw, and one under-reporting would strand the difference in this contract forever (outside `stagedAssets`, outside NAV, with no sweep). Taking Slither's suggestion here would be a regression. **No gap.** |

Also re-checked (clean, no finding): `setController` is `deployer`-gated and one-time (L48-54, finding
M1); `stage`/`unstage` are `onlyController` + `nonReentrant`; `stagedAssets`/`maxUnstageable` are thin
pass-throughs whose revert-on-source-failure is exactly what `PM._idle()`'s `try/catch` (L314-318) is
built to absorb.

---

## 4. `MintwareLpGatewayFactory.sol`

4 factory-specific findings (the other 53 in its run are the PM/Staging ones already triaged above).

| # | Detector (sev.) | Location | Real or FP? | Reasoning |
|---|---|---|---|---|
| F-1 | `reentrancy-no-eth` (Med) | `createGateway` L91 `staging.setController(pm)` before `instanceForPool[poolId] = …` L93 | **False positive** | `createGateway` is `onlyOwner` (L79) and `staging` is a contract the factory itself just deployed one line earlier (L87) — its `setController` (L48-54) makes no external call and cannot reenter. There is no untrusted callee in the window. **No gap.** |
| F-2 | `reentrancy-benign` (Low) | same call, `poolIds.push(poolId)` L94 | **False positive** | Same reasoning as F-1; Slither classes it benign itself. |
| F-3 | `reentrancy-events` (Low) | `GatewayCreated` L95 after L91 | **False positive** | Event ordering only, `onlyOwner`, trusted freshly-deployed callee. |
| F-4 | `low-level-calls` (Info) | `_verifyAdapterBinding` L115, L119, L122 | **False positive — deliberate** | The three probes (`asset()`, `totalAssets()`, `vault()`) *must* be low-level because `IYieldAdapter` has no asset getter and the factory must tolerate an adapter that implements neither (the Aave adapter uses `underlying()`). All three are `staticcall`, so a hostile adapter can neither reenter nor mutate through them (L111). Return lengths are checked before `abi.decode` (`ret.length >= 32`, L116/L120/L123) — the classic decode-on-empty-returndata trap is closed. Covered by 6 dedicated tests (`test_adapterBinding_*`, 13/13 factory tests green). **No gap.** |

One non-finding worth recording: `adapterUsed[address(adapter)] = true` is written at L83, *before*
`_verifyAdapterBinding` at L84. That is safe — a verification revert unwinds the whole transaction, so a
rejected adapter is not burned. Checked because the ordering reads like a footgun.

---

## 5. `MintwareERC4626YieldAdapter.sol` (re-check of previously audited code)

6 findings, unchanged in character from the 2026-08-24 sweep. All FP / by-design.

| # | Detector (sev.) | Location | Real or FP? | Reasoning |
|---|---|---|---|---|
| E-1 | `arbitrary-send-erc20` (**High**) | `deposit` L109 `safeTransferFrom(vault, …)` | **False positive** | `onlyVault` (L107) ⇒ `vault == msg.sender`. Same shape as I-1; previously triaged as a High FP and it remains one. |
| E-2 | `incorrect-equality` (Med) ×2 | `withdraw` L125 `want == 0`, L131 `shares == 0` | **False positive** | Both are early-outs on locally-computed clamps (`min` of `amount`/`maxWithdrawable` L124; shares after three successive caps L126-130). Returning 0 rather than calling `redeem(0)` is required by the "withdraw never reverts" contract (`IYieldAdapter` L17-20). |
| E-3 | `reentrancy-no-eth` (Med) | `withdraw` L132-141: `_lastWithdrawBlock`/`_withdrawnThisBlock` written after `yieldSource.redeem` | **False positive** | `withdraw` is `onlyVault` + `nonReentrant` (L123), so a reentrant `withdraw` is blocked outright. The cross-function path Slither names is `_blockRemaining()` (L173-177), reachable only from the `view` `maxWithdrawable()` — a reentrant *read* of a stale `_withdrawnThisBlock` changes no state, and the outer call already fixed `want` before the redeem (L124). The per-block cap remains correct across multiple same-block withdraws because `_blockRemaining` itself handles the block rollover (L175). **No gap.** |
| E-4 | `unused-return` (Med) | `deposit` L111 `yieldSource.deposit(amount, this)` | **False positive** | The 4626 returns shares minted; the adapter deliberately never trusts a source-reported share figure — NAV is always re-derived from `previewRedeem(balanceOf(this))` (L152, L160), which is the fee-aware guarantee this contract exists for. Storing the returned value would be dead state at best and a second source of truth at worst. **No gap.** |
| E-5 | `missing-zero-check` (Low) | constructor `vault_` L80 | **Real, deliberate, documented** | Identical to I-3: `vault_ == 0` is the intended deploy-order state (NatSpec L72), closed permanently by the one-time `setVault` (L92-97). **Already mitigated.** |

---

## Verdict

| | Count |
|---|---|
| Slither findings on our code | **66** (2 High / 35 Med / 26 Low / 3 Info) |
| Real security issues among them | **0** |
| False positives | 63 |
| Real-but-by-design / already-mitigated | 3 (I-3, E-5 zero-checks; S-1 unused-return) |
| Genuine gaps found by hand while triaging | **2** — H-1 (Low, griefing) · H-2 (Informational, wei dust) |
| Anything that can move funds incorrectly | **None** |

Neither H-1 nor H-2 is applied. Both are one-file, few-line changes with the trade-off spelled out above;
H-1 in particular may be better answered with documentation + an ops alert than with code, and that call
belongs to the lead. The remaining assurance gate for this surface is unchanged: **external audit**.

Raw Slither output for all five runs (filtered and unfiltered) was produced by the commands in the
"How it was run" section and is reproducible from them; nothing in `contracts-v4/src/` was modified by
this sweep.
