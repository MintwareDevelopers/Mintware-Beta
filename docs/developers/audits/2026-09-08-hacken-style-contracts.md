# Mintware LP Gateway V1 — Smart-Contract Audit (Hacken-methodology)

| | |
|---|---|
| **Date** | 2026-09-08 |
| **Auditor** | Fable 5.1 (Claude), independent pass; PoC-verified |
| **Repository / commit** | `MintwareDevelopers/Mintware-Beta`, branch `fix/lp-gateway-realfunds-audit` @ `70a89806` (stated by the requester as identical to what merges to `main`) |
| **Toolchain** | Foundry `forge 1.8.0`, solc `0.8.26`, `via_ir`, optimizer 200 (repo `foundry.toml`) |
| **Fork target** | Robinhood Chain testnet (chain id `46630`, Arbitrum Nitro — `ArbSys` present, blocks carry `l1BlockNumber`), `LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com` |
| **Report type** | Read-only review + executable PoCs. **No `src/` file was modified.** New file: `contracts-v4/test/audit/HackenContracts.t.sol` (16 tests). |
| **Disclaimer** | This is an internal, methodology-driven review, not a substitute for the external firm audit the project has correctly designated as the gate for real value. |

---

## 1. Executive summary

The LP Gateway V1 is a small (≈1,000 LOC in scope), thin wrapper over the official Uniswap v4 `PositionManager`, an
ERC-4626 "stage-and-earn" reserve, and a shared virtual-offset share library. Its mechanics are careful: access control
is tight, ownership is two-step with `renounceOwnership` disabled, the fee recipient is immutable, reentrancy is
contained (verified against a hostile paired token on a fork), Permit2 allowances are revoked, fees are swept to the
buffer before every principal change, share math is donation-safe, and the prior two review rounds' fixes (A-1, A-2,
A-3, A-6/A-8, H-02, M-06) are all present and behave as described.

The review found **no path by which an unprivileged party can directly take another user's principal**, and no
arithmetic/overflow/reentrancy defects. It did find **one High and one Medium** design-level issue that the prior
rounds missed, both of which directly contradict the product's two central on-chain claims ("withdrawals never brick";
"the conservative mark protects depositors"):

- **F-01 (High)** — The withdraw-side `min(spot, ref)` mark is **redundant** with the pro-rata sourcing that M-06
  introduced (pro-rata sourcing already makes a withdrawal price-neutral — proven by PoC), and it is **harmful**:
  whenever spot is above the clamped-follower reference the withdrawer receives only `R/S` of their liquidity slice,
  with no re-credit, and the shortfall is transferred to remaining holders (or, for a sole holder, to the virtual
  offset — **permanently dead**). The reference only moves on gateway actions, ≤5 % per (L1) block, so an ordinary
  meme-coin rally with no activity leaves it stale. PoCs: a sole holder exiting after a legit rally left **25 % of her
  liquidity (≈66k of a 200k deposit) stranded forever**; a remaining holder who pumps in the same block as a victim's
  withdraw **nets +14k on a 100k stake** (victim −12 %); a depositor after a natural crash immediately owns **14 % less**
  than she paid. No user-side slippage parameters exist on `deposit`/`withdraw`.
- **F-02 (Medium)** — Every LP-touching withdrawal (which, under pro-rata sourcing, is every withdrawal once deployed)
  performs non-best-effort ERC-20 transfers of the **third-party paired token** (via `PoolManager.take`) and of quote
  fees to the **immutable `harvestRecipient`**. A paused/rugged paired token, or a USDG freeze of `harvestRecipient`,
  **reverts all withdrawals including the idle quote leg** (PoC-confirmed) — the exact failure mode the A-1 re-credit
  design was meant to make impossible, on a product whose universe is meme tokens and a freezable stablecoin.

Plus four Low and a set of Informational items (deploy cap is quote-leg-only so a "capped" deploy leaves 66.7 % of NAV
LP-exposed; stale-follower deploy DoS; Arbitrum `block.number` = L1 block semantics; adapter owner can throttle exits;
factory does not verify the adapter binding).

### Verdict

| Question | Answer |
|---|---|
| Safe for a **bounded amount of the operator's own funds** (operator = sole depositor)? | **Conditionally yes.** With a single depositor, F-01's wealth transfer has no counterparty except the dead-value case: a sole holder's full exit after a rally **permanently strands part of the LP leg** (F-01a), so the operator should (a) never fully exit while spot ≫ reference (walk the follower with `harvest` first, then exit), or preferably (b) ship the one-line F-01 fix first. F-02 is an availability/loss risk that curation (pausable/blacklistable paired tokens) and bounded size mitigate but do not remove. |
| Safe for **third-party funds**? | **No — not before F-01 and F-02 are fixed** (and the previously-open A-4/A-7 off-chain items). F-01 is a live, PoC-profitable wealth transfer between depositors that also fires with no attacker at all. |

---

## 2. Scope & commit

In scope (Solidity), `contracts-v4/`:

| File | LOC | Role |
|---|---|---|
| `src/gateway/MintwareLpGatewayPositionManager.sol` | 588 | Core — deposit/withdraw/deploy/harvest, NAV, follower, share accounting |
| `src/gateway/MintwareLpGatewayStaging.sol` | 80 | Single-controller idle reserve over an `IYieldAdapter` |
| `src/gateway/MintwareLpGatewayFactory.sol` | 105 | Curated per-pool factory |
| `src/vaults/MintwareERC4626YieldAdapter.sol` + `IYieldAdapter.sol` | 163 + 31 | Fee-aware, best-effort 4626 adapter |
| `src/lib/SeniorSharesMath.sol` | 36 | Symmetric virtual-offset share math |
| `test/gateway/*.t.sol` (4 files, 44 tests), `test/fork/MintwareLpGatewayHardeningFork.t.sol` (7 tests) | — | Existing coverage |

Context read: `docs/developers/lp-gateway-v1-realfunds-audit-findings.md`, `lp-gateway-v1-security-review.md`,
`lp-gateway.md`, `.claude/rules/lp-gateway.md`, the vendored v4-core/v4-periphery/Permit2/OZ sources actually
compiled against. Out of scope: off-chain `lib/gateway/*`, routes, crons, UI, deploy scripts (except where their
behaviour is asserted by the contracts' documentation).

`git diff main` for the in-scope `src/` files: only `MintwareLpGatewayPositionManager.sol` differs (+65/−1, the A-1/A-2/A-3/A-6/A-8 fixes).

---

## 3. Methodology

Hacken-style, in order:

1. **Documentation & architecture review** — read the three design/audit docs, then the code, and listed every
   claim the code does not honour (§6).
2. **Line-by-line review** of every external/public function against a fixed checklist (Appendix A): access control;
   arithmetic and rounding direction per operation; casts (`uint128`/`uint160`/`int24`); reentrancy & CEI; external-call
   trust (PoolManager, PositionManager, Permit2, adapter, 4626 source, ERC-20 quirks); oracle/price model (follower,
   band, directional marks, same-block guard); share accounting and inflation/donation; DoS/griefing; events;
   ownership/upgrade; deadlines/slippage; constants; first-depositor and zero-liquidity states; native ETH; hooks.
3. **Test adequacy** — mapped each invariant to an existing test, listed uncovered branches, ran all suites (§7).
4. **Code quality & gas** — brief (§9).
5. **Verification** — every suspected issue was turned into a Forge test in
   `contracts-v4/test/audit/HackenContracts.t.sol` and run (unit against the Stub rig; fork against the real v4
   stack on Robinhood testnet with deep third-party liquidity added via `PoolModifyLiquidityTest`). Status is
   reported as **CONFIRMED** (PoC passes and demonstrates the behaviour), **THEORETICAL** (reasoned, not reproduced), or
   **NOT REPRODUCIBLE**. Nothing was executed on-chain; fork reads only.

Severity = Hacken matrix of **Likelihood × Impact** (High/Med/Low each).

---

## 4. Findings table

| ID | Title | Severity | Likelihood | Impact | Status |
|---|---|---|---|---|---|
| **F-01** | Withdraw-side conservative mark is redundant under pro-rata sourcing and under-pays withdrawers whenever spot > reference; action-driven follower goes stale; no user slippage params. Value flows to remaining holders or is permanently stranded; inducible by a same-block pump. | **High** | High | Med–High | CONFIRMED (3 PoCs) |
| **F-02** | LP-leg and fee-sweep ERC-20 transfers in the withdraw path are not best-effort: a paused/rugged paired token or a frozen `harvestRecipient` reverts **all** withdrawals, including the idle quote. | **Medium** | Low–Med | High | CONFIRMED (2 PoCs) |
| **F-03** | `MAX_DEPLOY_BPS` caps only the quote leg before the paired leg is added: a single "capped" balanced deploy leaves 66.7 % of NAV LP-exposed (docs claim ≤50 %). Paired-only top-ups are uncounted (out-of-range only). | Low | Med | Low–Med | CONFIRMED (66.7 %) / THEORETICAL (paired-only) |
| **F-04** | Stale follower blocks `deploy` (`DeployPriceOutOfBand`) after any legit move > band with no activity; recovery only by the owner walking the reference with repeated `harvest` (one step per L1 block). | Low | Med | Low | CONFIRMED |
| **F-05** | Robinhood Chain is Arbitrum Nitro: `block.number` is the **L1** block (~12 s). The "same-block" guard, the follower's "per-block" step and the adapter's per-block cap all operate per ~12 s; multiple L2 blocks share one `block.number`. Foundry fork tests do not model this. | Low / Info | High | Low | CONFIRMED (chain probe) |
| **F-06** | `MintwareERC4626YieldAdapter` is one-step `Ownable` (renounce enabled) and its owner can set `perBlockWithdrawCap` to throttle every withdrawal indefinitely (funds re-credited, not lost — but "never locked" is violated). Security-review L-06 claimed Ownable2Step "everywhere". | Low | Low | Med | CONFIRMED (code) |
| **F-07** | Factory does not verify `adapter.asset() == quoteAsset` nor that `adapter.vault()` will be the new staging; a mis-wired adapter makes the instance DOA (first deposit reverts). Documented as deferred (I-01) although the production adapter now exposes `asset()`. | Low | Low | Low | THEORETICAL |
| I-01 | `deploy` reuses the `ZeroShares` error for "zero liquidity minted". | Info | — | — | — |
| I-02 | Factory permanently binds one instance per pool (`AlreadyExists`); `deactivate` has no on-chain effect (deposits continue); no re-range/migration path — a range that goes permanently out-of-range cannot be replaced for that pool. | Info | — | — | — |
| I-03 | Any NAV left when `totalShares == 0` is owned by the virtual offset and is unrecoverable by anyone (property of the symmetric offset; interacts with F-01a). | Info | — | — | CONFIRMED (unit PoC) |
| I-04 | `deploy` passes `amount0Max/amount1Max` equal to the exact amounts; `LiquidityAmounts` floor vs v4 round-up can spuriously revert `MaximumAmountExceeded` at some price/amount combinations (retry-able). | Info | — | — | THEORETICAL |
| I-05 | No getters for `_refSqrtPrice` / `_refBlock`; keepers/UI cannot compute the directional marks off-chain except by indexing `PriceAnchored`. | Info | — | — | — |
| I-06 | Entry shares are minted on the requested `quoteAmount`, not the NAV delta (known L-05/L-07: fee-charging or rounding-adverse sources dilute earlier holders by the fee/rounding). | Info | — | — | known |
| I-07 | No token-rescue function on PM/Staging/Adapter; stray paired tokens are swept to the owner on the next `deploy`, stray quote is re-staged for all holders. | Info | — | — | — |
| I-08 | `Harvested` is emitted from `withdraw`/`deploy` too; any off-chain fee ledger must index the event, not `harvest()` txs (already noted as A-4 off-chain). | Info | — | — | — |

---

## 5. Detailed findings

### F-01 · HIGH · Withdraw-side conservative mark + stale, action-driven follower systematically under-pay withdrawers (and over-charge depositors); redundant with pro-rata sourcing; no user slippage parameters

**Location.** `MintwareLpGatewayPositionManager.sol`
- withdraw mark: `:264-270` (`navW = idle + min(deployedSpotVal, valueAt(ref))`, `claimValue` from `navW`)
- LP sizing at spot: `:294-297` (`want = liq · remaining / deployedSpotVal`)
- re-credit comparison at spot: `:314-316`
- deposit mark: `:470-475` (`_navDeposit` = idle + `max(spot, ref)`)
- follower: `:186-207` (`_anchorFollow` — one step ≤ `maxDeviationBps` per `block.number`, **only when a
  deposit/withdraw/deploy/harvest executes**)
- entry points lack slippage params: `deposit(uint256)` `:223`, `withdraw(uint256)` `:247`

**Description.** Let `I` = idle, `S` = LP value at spot, `R` = LP value at the reference, `M = min(S, R)`, and a
withdrawer holding fraction `f = shares/totalShares`. The code computes (ignoring the offset):

```
claim     = f · (I + M)
fromIdle  = claim · I / (I + M)      = f · I                 ← pro-rata idle, price-independent
remaining = claim − fromIdle          = f · M
want      = liq · remaining / S       = liq · f · (M / S)
```

- If `S ≤ R` (spot at/below reference): `M = S` → `want = f · liq` → **exactly pro-rata**. Price manipulation by the
  withdrawer changes nothing (PoC `test_VS_withdrawAtDeflatedSpot_isExactlyProRata`: a 300k dump before withdraw
  removed exactly 50.0 % of liquidity for a 50 % holder). The H-03 threat ("pump inflates the claim, paid from real
  idle") **cannot occur** once sourcing is pro-rata (M-06): idle is always `f · I`. So the min-mark adds no protection.
- If `S > R` (spot above reference): `want = liq · f · R/S < f · liq`. The withdrawer receives only `R/S` of their
  liquidity slice. Because the re-credit test values what was delivered **at spot** (`delivered = f·R ≥ claim`), no
  shares are re-credited. The forgone `(1 − R/S)` slice stays in the position and accrues to the **remaining holders**
  — or, if the withdrawer was the sole holder, to the virtual offset, where it is **unrecoverable by anyone** (I-03).

`S > R` arises (a) **naturally**: the follower moves only when someone transacts with the gateway, at most 5 % of
sqrtPrice per L1 block (F-05), so any rally larger than that with no gateway activity leaves the reference stale; and
(b) **adversarially**: a remaining holder buys the paired token immediately before a victim's `withdraw` (same block or
held across blocks on a thin pool) and sells back after. The mirror applies to deposits: `_navDeposit` marks at
`max(spot, ref)`, so after a natural crash (or a same-block dump by a remaining holder) the depositor is priced at the
stale high and immediately owns less than she paid.

Neither `deposit` nor `withdraw` accepts a `minSharesOut` / `minQuoteOut,minPairedOut`, so users cannot bound any of
this; the v4 decrease itself also passes `amount0Min = amount1Min = 0` (L-01).

**Evidence (fork, real v4 on Robinhood testnet, 1.5 M external liquidity so the gateway is ~10 % of pool depth,
band 500 bps; `HackenLpGatewayForkTest`):**

| PoC | Setup | Result |
|---|---|---|
| `test_F01a_staleRefRally_soleHolderUnderpaid_leftoverDead` | Alice sole holder, 200k deposit, 100k/100k deployed. Third party buys 600k paired (legit rally, sqrtPrice +26 %), 5 blocks, no gateway action. Alice withdraws 100 % of shares. | Liquidity before 146,406; **36,549 (25 %) left in the position with `totalShares == 0`**; leftover NAV **66,541 quote (33 % of her deposit)**. A subsequent 1 M depositor round-trips and recovers only his own deposit — the leftover is **dead**. |
| `test_F01b_remainingHolderPump_extractsFromWithdrawer` | Alice + Bob 100k each; 100k/100k deployed; fair claim each = 149,999. Same block: Bob buys 500k paired → Alice withdraws all → Bob sells back (price restored within 2 %). | Alice removed < 45 % of liquidity (fair 50 %) and received **131,664 (−12.2 %)**. Bob's swap round-trip cost **6,759**; Bob's wealth **+14,283 net** (100,049,999 → 100,064,282). **Profitable extraction by an unprivileged depositor.** |
| `test_F01c_staleRefCrash_depositorOverpays` | 200k deposited / 100k+100k deployed; third party sells 600k paired (crash), 5 blocks, no gateway action. Carol deposits 100k. | Carol's claim right after depositing: **85,850 (−14.2 %)**, transferred to existing holders. |

**Why the prior rounds missed it.** H-03's withdraw-side mark and M-06's pro-rata sourcing were designed in the same
review as independent fixes; nobody re-derived the withdraw algebra after both landed. The fork test
`test_fork_H03_conservativeMarkCapsPump` asserts only `valueOut < navSpot` (trivially true for any pro-rata payout
when spot is pumped) — it never compares against the pro-rata entitlement.

**Recommendation.**
1. **Withdraw:** size the LP removal pro-rata from shares (`liqToRemove = liq · shares / totalShares`, offset-adjusted if
   desired) and drop the `min(spot, ref)` mark for the LP leg — pro-rata sourcing already makes the withdrawal
   price-neutral. Keep the re-credit path for adapter shortfall. (One-line semantic change; re-derive `claimValue` at
   spot so the re-credit comparison stays consistent.)
2. **Deposit:** keep the `max(spot, ref)` mark (it is the only defence against cheap entry) but add `minSharesOut`, and
   add `minQuoteOut`/`minPairedOut` to `withdraw` so users can bound sandwiching in either direction.
3. **Follower liveness:** add a permissionless `poke()` that only runs `_anchorFollow()` (bounded by construction —
   nothing a caller can do with it except move the reference one step toward spot), and/or make the step time-based
   (`block.timestamp`) so it is not hostage to activity or to Arbitrum's L1-block cadence (F-05).
4. Consider the stronger standard defence for oracle-less NAV vaults — a short deposit→withdraw cooldown or epoch
   settlement — since the residual deposit-side walk-down (documented) is cheap on a single-venue meme pool.
5. Add a test that asserts the withdrawer's received liquidity equals the pro-rata slice for **both** `S > R` and
   `S < R`.

---

### F-02 · MEDIUM · Non-best-effort transfers in the withdraw path let a third-party token failure lock all depositor funds, including the idle quote

**Location.** `MintwareLpGatewayPositionManager.sol` `:291-305` (withdraw LP branch: `_sweepFees` then
`_decreaseAndTake`), `:427-438` (`_sweepFees` → `safeTransfer(harvestRecipient, …)`), `:568-587`
(`_decreaseAndTake` → `PoolManager.take` → `paired.transfer(PM)`), `:71` (`harvestRecipient` immutable).

**Description.** Under pro-rata sourcing `remaining = f · M > 0` whenever the position holds liquidity, so **every**
withdrawal executes the LP branch. That branch (i) sweeps fees to `harvestRecipient` (transfers of quote and paired),
(ii) decreases liquidity and `take`s both tokens to the PM, (iii) forwards them to the user. None of these is wrapped
in a best-effort guard, unlike the idle leg (`staging.unstage` is best-effort and A-1 re-credits the shortfall). A
revert in any of them reverts the whole withdrawal — including the idle quote already sourced. Triggers, all outside
the protocol's control:

- The **paired meme token** pauses, blacklists the PM, self-destructs, or otherwise reverts on transfer (common
  meme-token mechanics; a rug). Every withdraw reverts at `PoolManager.take`.
- **USDG (Paxos) freezes `harvestRecipient`** (the operator's hot wallet — the most exposed address in the system).
  Once any quote fee has accrued, `_sweepFees` reverts on `safeTransfer(harvestRecipient, quoteFees)`, and with it
  every withdraw and every `harvest`/`deploy`. `harvestRecipient` is immutable, so there is no on-chain recovery
  short of the issuer unfreezing. The M-07 analysis enumerates PM/staging freezes but not this address.

Impact: **all depositor value is locked** (the idle quote is perfectly liquid in Morpho but unreachable) for as long
as the third-party condition persists; permanent if the paired token never recovers. This is exactly the class of
failure the A-1 re-credit was built to prevent, and it contradicts the documented "withdrawals never brick".

**Evidence (fork):**
- `test_F02a_pairedTokenPaused_bricksAllWithdrawals_includingIdle` — 200k deposited, 100k/100k deployed,
  `staging.maxUnstageable() > 90k` (idle is liquid). Paired token paused → `withdraw(all)` **reverts**;
  `withdraw(1 %)` **reverts**.
- `test_F02b_harvestRecipientFrozen_bricksWithdrawals` — fees accrued; quote freezes `harvestRecipient` →
  `withdraw(50 %)` reverts `ADDRESS_FROZEN`; `harvest` reverts.

**Recommendation.**
1. Make the LP leg **best-effort like the idle leg**: wrap `_sweepFees` + `_decreaseAndTake` in a `try` (via an
   external self-call or a small internal library that catches), and on failure deliver the idle leg and **re-credit**
   the LP-leg shares (the A-1 machinery already exists). The user then always gets the liquid part.
2. Decouple fee sweeping from user exits: if the sweep fails, **accrue the fees inside the PM** (hold them and let
   `harvest` retry) instead of reverting the user's transaction; or route fees through a pull-based escrow the
   recipient claims.
3. Consider a **timelocked** `harvestRecipient` rotation (or a two-address fallback) to survive an issuer freeze of
   the hot wallet without widening owner power beyond a delayed change.
4. Add fork tests for a reverting paired token and a frozen recipient.

---

### F-03 · LOW · `MAX_DEPLOY_BPS` bounds the quote leg only; a "capped" deploy leaves 66.7 % of NAV LP-exposed

**Location.** `:345-349`:
`if (deployedNow + quoteToDeploy > nav · MAX_DEPLOY_BPS / 10_000) revert DeployCapExceeded();`

**Description.** The cap is checked on `quoteToDeploy` before the paired leg (`pairedAmount`, supplied by the owner)
is added. A balanced in-range deploy of 50 % of NAV as quote plus the matching paired doubles the deployed value while
NAV grows by only the paired amount: `deployed / NAV = (0.5 + 0.5) / 1.5 = 66.7 %`. The documentation
(`lp-gateway.md`, `.claude/rules/lp-gateway.md`, the A-3 remediation note and the code comment at `:50-53`) describes
this as a hard cap on the **total** deployed fraction with "most capital stays idle". A second quote deploy is then
correctly refused, so the invariant is "≤ 50 % quote pre-deploy", not "≤ 50 % LP-exposed". The compromised-owner
extraction bound (A-3) is therefore on two-thirds of NAV, not one-half, and the IL exposure users are told about is
understated by a third. Paired-only top-ups (`quoteToDeploy = 0`) are not counted at all, but are only mintable when
the position is out of range on the paired side (in range the mint reverts `ZeroShares`), so that sub-case is
theoretical and adds owner capital rather than extracting.

**Evidence (fork).** `test_F03_deployCap_isQuoteLegOnly_exposureExceeds50pct` — after `deploy(100k, 100k)` on 200k
NAV: **`deployed bps of NAV: 6666`**. The repo's own `test_fork_A3_deployCapBlocksOverExposure` comment already
acknowledges "~2/3 of NAV is LP-exposed" after the setUp deploy.

**Recommendation.** Check the cap on the **post-deploy** exposure: `deployedNow + quoteToDeploy + pairedValueAtSpot ≤
MAX_DEPLOY_BPS · (nav + pairedValueAtSpot)`, or set `MAX_DEPLOY_BPS` to the value that yields the intended total
exposure (e.g. 3333 for a 50 % total on a balanced add) and fix the docs either way.

---

### F-04 · LOW · Stale follower blocks `deploy`; owner recovery only via repeated `harvest`

**Location.** `:366-373` (band check uses `_refSqrtPrice`), `:186-207` (follower only advances on actions).

**Description.** After any legitimate move larger than `maxDeviationBps` with no gateway activity, `deploy` reverts
`DeployPriceOutOfBand` until the reference is walked back within band. The only owner-controlled action that advances
the follower without moving capital is `harvest` — one step per (L1) block. Availability-only, owner-recoverable, but
it means the deploy cron will fail-closed on exactly the volatile days a meme pool earns the most, and the runbook does
not describe the recovery.

**Evidence (fork).** `test_F04_staleRef_blocksDeploy_untilWalked` — after a +26 % sqrtPrice rally, `deploy` reverts;
**4 successive `harvest` calls in distinct blocks** were needed before `deploy` succeeded.

**Recommendation.** Same as F-01 item 3 (permissionless/time-based `poke`). Document the `harvest`-walk recovery.

---

### F-05 · LOW / INFO · Robinhood Chain `block.number` is the L1 block (Arbitrum Nitro)

**Location.** `:85, :226-227, :255-256` (`_lastActionBlock`), `:196, :205` (`_refBlock`),
`MintwareERC4626YieldAdapter.sol:122-126, :158-162` (per-block cap).

**Description.** The RH testnet RPC returns `l1BlockNumber` on every block and `ArbSys(0x64).arbBlockNumber()` /
`arbOSVersion()` answer (probed read-only, chain id 46630) — it is an Arbitrum Nitro chain, on which the `NUMBER` opcode
returns the **L1** block number (≈12 s cadence) while L2 blocks are sub-second. Consequences: the "same-block" guard is
a ~12 s per-address cooldown; the follower steps at most once per ~12 s (5 % per 12 s ≈ slower trend-following than
the docs imply and a wider window for F-01); the adapter's `perBlockWithdrawCap` is per ~12 s; and the constructor
comment "5 % sqrtPrice ≈ 10 % price/block" should read "per L1 block". Not a vulnerability by itself. Note that
**Foundry fork tests do not reproduce this** — the fork serves the test contract's `block.number` from the L1 field and
`vm.roll(block.number + 1)` re-evaluates to the same value in loops (the repo's own A-1 test already works around this;
the audit PoCs use absolute baselines).

**Recommendation.** Use `block.timestamp` for the follower cadence and the per-address cooldown; document the L1-block
semantics; keep fork tests on absolute block baselines.

---

### F-06 · LOW · Adapter ownership is one-step and the owner can throttle all exits

**Location.** `MintwareERC4626YieldAdapter.sol:34` (`Ownable`), `:84-87` (`setPerBlockWithdrawCap`).

**Description.** The adapter owner (a separate key from the gateway owner in the deploy script) can set
`perBlockWithdrawCap` to any value, including `1`, at any time and with no delay. Every gateway withdrawal then
under-delivers and is re-credited (no loss), but exits are throttled to the cap per ~12 s indefinitely — the "never
locked" pillar depends on this key. `Ownable` is one-step (a typo in `transferOwnership` loses control forever) and
`renounceOwnership` is enabled (freezes the cap at its current value). The security review's L-06 remediation states
Ownable2Step was applied "everywhere"; the adapter was not.

**Recommendation.** `Ownable2Step` + disabled renounce (as on the PM); timelock or bound changes to the cap (e.g. a
floor as a fraction of `totalAssets`).

---

### F-07 · LOW · Factory does not verify the adapter binding

**Location.** `MintwareLpGatewayFactory.sol:67-93`.

**Description.** `createGateway` records `adapterUsed` but never checks `adapter.asset() == quoteAsset` (the
production adapter exposes it) nor that the adapter's `vault` is unset/will be the new staging. A mis-wired adapter is
detected only when the first `deposit` reverts (`OnlyVault` / transfer failure). Documented as deferred (I-01) with a
now-stale reason.

**Recommendation.** `require(IYieldAdapterWithAsset(adapter).asset() == quoteAsset)`; consider having the factory call
`adapter.setVault(staging)` when it is the adapter owner, or assert `vault() == address(0)` at creation.

---

### Informational (I-01 … I-08)

See the table in §4. Two worth stating explicitly:

- **I-02** — Because the factory refuses a second instance per pool and `deactivate` is app-layer only, a pool whose
  price permanently leaves the immutable range (a routine meme-coin outcome) can never receive a re-ranged gateway
  through the factory; the position simply sits single-sided. Consider keying instances by `(poolId, salt)` or allowing
  a deactivated slot to be replaced.
- **I-03** — With the symmetric offset, when `totalShares == 0` the virtual shares own exactly the leftover NAV; a new
  depositor of any size gets back exactly what they deposit (unit PoC `test_I03_leftoverNavAtZeroShares_isDeadForever`).
  This is a correct property (it is what defeats the inflation attack), but it means every path that leaves NAV behind
  at zero shares (F-01a, offset dust) is a permanent burn, not a windfall.

---

## 6. Documentation-vs-code discrepancies

| # | Document says | Code does | Ref |
|---|---|---|---|
| D-1 | "`MAX_DEPLOY_BPS = 5000` hard cap on **total** deployed fraction of NAV"; "the rest stays idle"; "most capital stays idle" (`lp-gateway.md`, rule file, realfunds §8, code comment `:50-53`) | Caps the quote leg pre-deploy only; a balanced deploy leaves **66.7 %** LP-exposed, 33 % idle | F-03 |
| D-2 | "withdrawals never brick" (M-01, `lp-gateway.md`, code `:78, :184, :262`) | Any LP-touching withdraw reverts if the paired token or a quote transfer to `harvestRecipient` fails | F-02 |
| D-3 | "a withdrawal values the LP leg at `min(spot, ref)` … so a pump can't inflate a withdrawal claim" (H-03 fix) | Under pro-rata sourcing the claim is already price-neutral; the mark instead **under-pays** the withdrawer by `R/S` | F-01 |
| D-4 | Follower "tracks spot ≤ `maxDeviationBps` per block" | Only when a deposit/withdraw/deploy/harvest executes; never on its own; "block" = L1 block (~12 s) | F-01/F-04/F-05 |
| D-5 | M-07 freeze table: PM frozen / staging frozen / global pause → "no permanent loss" | Omits `harvestRecipient` frozen → all withdrawals + harvest + deploy revert; recipient is immutable | F-02b |
| D-6 | Security review L-06 remediation: `Ownable2Step` "everywhere", renounce blocked | Adapter is one-step `Ownable`, renounce enabled | F-06 |
| D-7 | Realfunds §6 test gap 1: "`INCREASE_LIQUIDITY` path never executed against any v4 instance" | Now exercised by `test_fork_A2_fullDrainThenHarvestAndRedeploySucceed` (redeploy with `tokenId != 0`) — the doc is stale (in the good direction) | §7 |
| D-8 | Realfunds §8 / review: A-6/A-8 constructor guards "fixed" and "verified by 33/33 unit" | Guards are present, but **no repo test exercises `HookedPoolUnsupported`, `BadTicks`, or the native-ETH rejection** (grep: zero hits in `test/`). Covered now by the audit file's `test_VS_ctor_*` | §7 |
| D-9 | `.claude/rules/lp-gateway.md`: "32 gateway Forge tests"; other doc: "33/33" | 44 unit + 7 fork on this branch | §7 |
| D-10 | Rule file: `setPaused` / `compoundQuote` "on their branch, verify before relying" | Present on this branch, unit-tested (`test_pause_*`, `test_compoundQuote_*`) | — |
| D-11 | Code comment `:137-138`: "2000 bps … is the sane meme-pool default the factory passes" | Factory default is **500** (`DEFAULT_MAX_DEVIATION_BPS`) | — |
| D-12 | Security review I-01: factory check "needs a common adapter getter (`IYieldAdapter` lacks one)" | Production adapter exposes `asset()`; the realfunds doc already flags this, the review table was not updated | F-07 |
| D-13 | `deposit` NatSpec: "Not a deposit/savings product" — fine; but `Deployed(tokenId, quoteUsed, pairedUsed, liquidity)` reports the **requested** `liquidity`, not the on-chain delta (equal in practice) | Cosmetic | — |

---

## 7. Test coverage matrix & suite results

### Suite results (this review, `forge 1.8.0`)

| Suite | Result |
|---|---|
| `contracts-v4/test/gateway/*` (Staging 8, Factory 7, PositionManager 18, RealAdapter 11) | **44 / 44 pass** |
| `contracts-v4/test/fork/MintwareLpGatewayHardeningFork.t.sol` (RH testnet fork) | **7 / 7 pass** (14.0 s) |
| **New** `contracts-v4/test/audit/HackenContracts.t.sol` (unit 5 + fork 11) | **16 / 16 pass** — every PASS is a CONFIRMED behaviour (F-01a/b/c, F-02a/b, F-03, F-04, I-03) or a verified-sound check (`test_VS_*`) |
| Full `forge test` (whole repo, fork harnesses self-skipping) | see appendix C (run recorded at the end of the engagement) |

### Invariant → test map

| Invariant / property | Existing test | Gap / note |
|---|---|---|
| First deposit 1:1; later deposits priced at NAV | `test_firstDeposit_oneToOne`, `test_secondDeposit_pricedAtNav`, `test_A5_sourceYield_*` | — |
| Inflation/donation defence (VIRTUAL) | `test_inflationDefense_secondDepositorWhole`; review of `SeniorSharesMath` | No fuzz/invariant test that Σ claims ≤ NAV; add a handler-based invariant |
| Same-block guard | `test_sameBlock_*` | Sybil (two addresses) is by design out of scope; L1-block semantics untested (F-05) |
| Pause blocks deposits, never withdraw | `test_pause_blocksDeposit_allowsWithdraw` | — |
| Ownership: onlyOwner on deploy/harvest/setPaused/compoundQuote; renounce disabled | `test_*_onlyOwner`, `test_renounceOwnership_disabled` | No test of `Ownable2Step` handoff; adapter ownership untested (F-06) |
| `harvestRecipient` immutable | `test_harvestRecipient_immutable` | — |
| A-1 re-credit on adapter shortfall (idle-only, per-block cap, stalled source, with LP leg) | `test_audit_A1_*`, `test_A5_A1_*`, `test_fork_A1_*` | — |
| A-2 empty-position sweep no-op; redeploy after drain (INCREASE path) | `test_fork_A2_*` | — |
| A-3 size cap / price band on deploy | `test_fork_A3_*` | Cap semantics not asserted (F-03); boundary (`== cap`) only implicitly via setUp |
| A-6/A-8 constructor guards (hooks, native ETH, ticks) | **none** | Added: `test_VS_ctor_rejectsHookedPool/NativeEthPair/BadTicks/BadBand` |
| H-02 fee sweep before decrease/increase | `test_fork_H02_*` | Only asserts recipient balance grew; does not assert the withdrawer received zero fees |
| H-03 conservative mark | `test_fork_H03_conservativeMarkCapsPump` | Asserts `valueOut < navSpot` only — **does not compare against pro-rata**, which is why F-01 was invisible. Added: `test_F01b`, `test_VS_withdrawAtDeflatedSpot_isExactlyProRata`, `test_VS_depositAtDeflatedSpot_notCheapened` |
| M-06 pro-rata sourcing | implicit in fork H02/H03 | Added explicit pro-rata assertion (`test_VS_withdrawAtDeflatedSpot_*`) |
| Permit2 allowance revoked after deploy (L-04) | **none** | Added: `test_VS_permit2AllowanceRevokedAfterDeploy` (also asserts no tokens at rest in PM) |
| Reentrancy via hostile paired token during `take` | **none** | Added: `test_VS_pairedTokenReentrancyBlocked` |
| Staging access control, best-effort unstage | `MintwareLpGatewayStaging.t.sol` (8) | — |
| Adapter onlyVault / one-time setVault / wrong-asset reject / fee-net NAV | `MintwareLpGatewayRealAdapter.t.sol` (11) | `setPerBlockWithdrawCap` griefing untested (F-06) |
| Factory: onlyOwner, duplicate pool, adapter reuse, default band, deactivate | `MintwareLpGatewayFactory.t.sol` (7) | Adapter binding unchecked (F-07) |
| `compoundQuote` lifts NAV without mint | `test_compoundQuote_liftsNavNoMint` | Only idle-only state; no test with `tokenId != 0` |
| Follower stepping over multiple blocks; stale-ref behaviour | **none** | Added: `test_F04_*` (steps), `test_F01a/c` (stale) |
| Out-of-range deploy; `MinLiquidityNotMet`; `ZeroShares` on zero liquidity | **none** | Uncovered |
| 6-dp quote × 18-dp paired on real v4 | **none** (fork rigs are 18/18) | Uncovered; math is decimal-agnostic but a smoke test is cheap |
| Deploy rounding (`amountXMax` exact) | **none** | I-04, uncovered |
| Paired-token pause / recipient freeze | **none** | Added: `test_F02a`, `test_F02b` |

---

## 8. Verified sound (checked, and why it holds)

- **Access control.** `deploy`/`harvest`/`setPaused`/`compoundQuote` are `onlyOwner`; `Staging.stage/unstage` are
  `onlyController` (one-shot, deployer-only `setController`); adapter `deposit/withdraw` are `onlyVault` with one-time
  `setVault` (tested at both layers); factory `createGateway/deactivate` are `onlyOwner`. No principal-sweep function
  exists anywhere; `withdraw` is `msg.sender`-scoped and shares are non-transferable.
- **Ownership.** PM and factory are `Ownable2Step`; PM `renounceOwnership` reverts; `harvestRecipient` immutable, no
  setter (tested).
- **Reentrancy / CEI.** All state-changing PM entry points are `nonReentrant`; share effects precede external calls in
  `withdraw`; PoolManager unlocks into the PositionManager (not the gateway), the pool is hookless (enforced in the
  constructor), and a hostile paired token that re-enters `deposit` during `take` is rejected (fork PoC).
- **Arithmetic.** All conversions use `FullMath.mulDiv`/OZ `mulDiv` with explicit floor rounding in the vault's favour
  (`toShares` Floor, `toAssets` Floor, `fromIdle`/`want`/`reCredit` floor, `SqrtPriceMath` `roundUp=false` in NAV).
  Casts: `uint128(want)` is guarded by `want >= liq ? liq : …`; `uint160` follower math cannot overflow because
  `ref + maxStep < spot ≤ MAX_SQRT_PRICE` on the branch where it is computed; `_pairedToQuote` two-stage `mulDiv`
  stays far below 2²⁵⁶ for any realistic amount/price; no `unchecked` blocks in scope.
- **Share accounting.** Symmetric virtual offset (`VIRTUAL = 1e6`) applied consistently on mint and redeem; the
  first-depositor attack requires donating ≈10⁶× the victim's deposit regardless of decimals; a plain token donation to
  the adapter does **not** move NAV (adapter values `previewRedeem(balanceOf)`, not `balanceOf` of the token). Second
  depositor stays whole after a donation (unit test).
- **v4 encoding.** `MINT_POSITION`/`INCREASE_LIQUIDITY` + `SETTLE_PAIR`, `DECREASE_LIQUIDITY` + `TAKE_PAIR` match the
  vendored `PositionManager._handleAction` decoders; `msgSender()` = locker = PM so `_settlePair` pays from the PM via
  Permit2; `_take` skips zero amounts; `nextTokenId()` read-before-mint is safe because the mint is atomic and hookless;
  the NFT is owned by the PM, which exposes no transfer/approve/permit path (and does not implement ERC-1271).
- **Permit2.** Allowance set to the exact amount with a 30-min expiry and revoked to `(0, 0)` after `_modify` — on-fork
  read of `allowance(pm, token, posm)` returns `0` for both tokens and the PM holds no tokens at rest.
- **Fee handling.** `_sweepFees` (zero-delta decrease to `harvestRecipient`) precedes every principal decrease and
  increase, so `feesAccrued` in the subsequent modify is zero and the user/owner never receives position fees (fork
  H-02 tests); zero-liquidity early return prevents `CannotUpdateEmptyPosition` (A-2, fork test).
- **Deploy guards.** Total-quote cap (semantics per F-03), spot-vs-reference band, `minLiquidity` floor, revert on zero
  liquidity, unused quote re-staged, unused paired returned to the owner; first deploy anchors the follower.
- **Adapter.** `asset()` checked at construction; `totalAssets`/`maxWithdrawable` fee-net via `previewRedeem`; exit via
  `redeem` in `try/catch`; per-block cap accounting is consistent; best-effort contract honoured (three shortfall modes
  tested end-to-end through the PM).
- **Withdraw price-neutrality when spot ≤ ref.** Pro-rata sourcing yields exactly the pro-rata liquidity slice after a
  same-block dump (fork PoC) — the withdrawer cannot inflate their claim.
- **Deposit protection when spot < ref.** A same-block dump before deposit does not increase shares minted (fork PoC).
- **Prior fixes present as described:** A-1 re-credit (`:312-323`), A-2 (`:433`), A-3 cap+band (`:345-349, :366-373`),
  A-6/A-8 (`:150-155`), H-02 (`:293, :353`), M-01 no price-revert on withdraw, M-02 no `pokePrice`, M-03 `minLiquidity`,
  M-06 pro-rata (`:278`), L-04 revoke (`:395-396`), L-06 on PM/factory.

---

## 9. Code quality & gas (brief)

- Clear, heavily commented, finding-IDs cross-referenced in code — good auditability. Some comments are now stale
  (D-1, D-11).
- `deploy` and `withdraw` each read `getPositionLiquidity` / `getSlot0` several times per call (three `getPositionLiquidity`
  staticcalls in the deploy cap path alone); caching `liq` and `spot` once per call would save ~10–20k gas and reduce
  the chance of inconsistent reads. Minor.
- `_amountsForLiquidity` re-derives `sqrtA/sqrtB` on every call; they are constants of the position and could be
  immutables.
- `_refSqrtPrice`/`_refBlock` should be `public` (I-05) for keepers and the UI.
- Error naming: `ZeroShares` used for zero liquidity in `deploy` (I-01).
- Tests: the fork harness relies on relative `vm.roll(block.number + 1)`, which misbehaves on Arbitrum forks in loops
  (F-05); use absolute baselines.

---

## Appendix A — Checklist coverage

| Area | Checked | Result |
|---|---|---|
| Access control on every external/public function | ✅ | Sound (§8) |
| Arithmetic: rounding direction per op; overflow; casts `uint128`/`uint160`/`int24`/`uint48` | ✅ | Sound; I-04 rounding revert (retry-able) |
| Reentrancy & CEI, cross-contract re-entry via paired token / adapter / 4626 | ✅ + fork PoC | Sound |
| External-call trust: PoolManager, PositionManager, Permit2, adapter, 4626 source | ✅ | Sound except non-best-effort LP-leg transfers (F-02) |
| ERC-20 quirks: FoT, rebasing, revert-on-zero, pause/blacklist, 18 vs 6 dp | ✅ | FoT quote reverts deposit (safe); FoT paired handled by deltas; pause/blacklist → F-02; decimals agnostic |
| Oracle/price model: follower, band, directional marks, same-block guard | ✅ + fork PoCs | **F-01** (withdraw mark redundant & harmful; stale follower), F-04, F-05 |
| Share accounting, inflation/donation, first depositor, zero-shares leftovers | ✅ + PoC | Sound; I-03 dead-value property |
| DoS / griefing | ✅ | F-02 (third-party token), F-04 (deploy), F-06 (adapter cap) |
| Events | ✅ | Correct; `Harvested` from user paths (I-08); `Deployed.liquidity` = requested |
| Ownership / upgradeability | ✅ | PM/factory sound; adapter one-step (F-06) |
| Deadlines / slippage | ✅ | `deploy` has both; `deposit`/`withdraw` have neither (F-01); decrease mins = 0 (L-01) |
| Constants (`MAX_DEPLOY_BPS`, band bounds, `VIRTUAL`, Permit2 expiry) | ✅ | F-03 semantics; band 1–5000 enforced; `VIRTUAL` decimal-agnostic |
| Zero-liquidity / dust / out-of-range states | ✅ | A-2 handled; out-of-range deploy untested |
| Native ETH, hooked pools | ✅ + unit PoC | Rejected at construction |
| Chain semantics (L2) | ✅ (RPC probe) | F-05 |
| Test adequacy | ✅ | §7 gaps |

## Appendix B — PoC index (`contracts-v4/test/audit/HackenContracts.t.sol`)

Run: `LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com forge test --match-path "contracts-v4/test/audit/HackenContracts.t.sol" -vv`

| Test | Finding | Status |
|---|---|---|
| `test_F01a_staleRefRally_soleHolderUnderpaid_leftoverDead` | F-01 | CONFIRMED — 25 % of liquidity / 66.5k quote stranded at `totalShares==0` |
| `test_F01b_remainingHolderPump_extractsFromWithdrawer` | F-01 | CONFIRMED — victim −12.2 %, attacker +14.3k net |
| `test_F01c_staleRefCrash_depositorOverpays` | F-01 | CONFIRMED — depositor −14.2 % |
| `test_F02a_pairedTokenPaused_bricksAllWithdrawals_includingIdle` | F-02 | CONFIRMED |
| `test_F02b_harvestRecipientFrozen_bricksWithdrawals` | F-02 | CONFIRMED |
| `test_F03_deployCap_isQuoteLegOnly_exposureExceeds50pct` | F-03 | CONFIRMED — 6666 bps |
| `test_F04_staleRef_blocksDeploy_untilWalked` | F-04 | CONFIRMED — 4 harvest steps to recover |
| `test_I03_leftoverNavAtZeroShares_isDeadForever` (unit) | I-03 | CONFIRMED |
| `test_VS_ctor_rejectsHookedPool / NativeEthPair / BadTicks / BadBand` (unit) | A-6/A-8 guards | Verified sound |
| `test_VS_permit2AllowanceRevokedAfterDeploy` | L-04 | Verified sound |
| `test_VS_pairedTokenReentrancyBlocked` | reentrancy | Verified sound |
| `test_VS_withdrawAtDeflatedSpot_isExactlyProRata` | M-06 / H-03 | Verified sound (and the basis of F-01) |
| `test_VS_depositAtDeflatedSpot_notCheapened` | H-03 deposit side | Verified sound |

## Appendix C — Full-repo `forge test`

Recorded at the end of the engagement (fork harnesses self-skip without `BASE_RPC_URL`/`LP_FORK_RPC_URL`):

```
Ran 92 test suites in 279.34s (1043.55s CPU time): 800 tests passed, 0 failed, 4 skipped (804 total tests)
```

The 4 skips are the pre-existing `BASE_RPC_URL`-gated fork harnesses. The total includes this review's 16 PoCs
(`HackenContracts.t.sol`) and two other **untracked** files present in `contracts-v4/test/audit/` at run time
(`RedTeamOnchainFork.t.sol`, `RedTeamOnchainTokens.sol`) that were **not authored by this review** and were left
untouched. In-scope gateway suites in isolation: 44/44 unit, 7/7 fork (§7).
