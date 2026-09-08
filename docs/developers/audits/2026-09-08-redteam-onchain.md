# LP Gateway V1 — On-chain Red-Team (2026-09-08)

> Adversarial pass against `MintwareLpGatewayPositionManager` / `Staging` / `Factory`, `MintwareERC4626YieldAdapter`
> and `SeniorSharesMath` on branch `fix/lp-gateway-realfunds-audit` (post A-1/A-2/A-3/A-5/A-6 fixes). Every
> scenario is a runnable Forge test named `test_RT_<n>_<scenario>_(SUCCEEDS|FAILS)`; SUCCEEDS = the attack works
> and the asserts prove the extraction/brick/grief, FAILS = the defense held and the asserts prove that.
> No `src/` file was modified. Tests: `contracts-v4/test/audit/RedTeamOnchain{Fork,Unit}.t.sol` (+ adversarial
> tokens/sources in `RedTeamOnchainTokens.sol`). **Result: 33/33 tests run as declared** — 21 fork tests against
> the REAL Uniswap V4 PoolManager/PositionManager on Robinhood Chain testnet (real swaps via `PoolSwapTest`),
> 12 unit tests (Stub V4, production 4626 adapter composed).
>
> Run:
> ```
> export PATH="$HOME/.foundry/bin:$PATH"
> bash -c 'LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com forge test --match-contract RedTeamOnchainFork -vv'
> bash -c 'forge test --match-contract RedTeamOnchainUnit -vv'
> ```
> Prior findings this builds on: [`../lp-gateway-v1-realfunds-audit-findings.md`](../lp-gateway-v1-realfunds-audit-findings.md).

---

## 1. Executive summary

**Did we extract value?** Yes — but never as an unprivileged actor against a *plain* ERC-20 paired token with an
honest yield source. Every pump/dump-then-withdraw attempt (same block, two addresses, multi-block follower walk)
**lost money for the attacker**: the clamped follower + direction-conservative marks + pro-rata liquidity sourcing
hold. What *does* extract value:

| # | Vector | Who | Measured |
|---|---|---|---|
| **RT-9a/9b** | **Mark-to-market deploy cap is a martingale.** `MAX_DEPLOY_BPS` bounds the *marked* LP fraction, not principal. A token issuer who dumps between cron runs re-opens the cap every cycle; the cron's own rule (`deployable = 50%·NAV − deployed`) tops the LP back up with fresh idle. | Hostile token issuer + the **honest** cron (no key needed); worse with a compromised owner | Honest cron: **67% of principal** deployed over 6 cycles, issuer walks away with **53%**. Compromised owner: **80% deployed, 71% extracted.** The "most capital stays idle" invariant is false in principal terms. |
| **RT-1a/1e** | **Deposit sandwich — `deposit()` has no `minSharesOut`.** Deposits are priced at `max(spot, ref)` = the pumped spot. The conservative mark protects the pool, *not the depositor*. No mempool needed: pump, hold, any deposit in the window is diluted. | Any existing holder with swap capital | **12.9% of a 100k deposit lost for 153 quote of fees (83×)** on a thin pool; **11.9% for 1.5k** with 10× third-party depth. Captured pro-rata by existing holders. |
| **RT-2** | **A-1 re-credit mints shares after full delivery** when the paired token has a receive-hook: the callback (fired from the PM's transfer to the withdrawer, after the PositionManager unlocked) dumps the paired leg; `delivered` is then valued at a *re-read* `_spot()` while `claimValue` was pre-dump → `delivered < claimValue` → shares re-credited. | Depositor whose paired token calls back (ERC777-style / malicious meme) | **12.9% of the withdrawn shares re-minted → +14k (≈11%) over a 125k fair claim**, realized next block. One-line root cause. |
| **RT-5c / 5d** | Lying or fee-flipping 4626 source → over-withdraw from co-depositors / mint cheap shares | Curator-trust failure (Morpho does not behave this way) | +75k on a 125k claim (over-report); +33k (50% transient exit fee). |

**Did we brick it?** Yes — **RT-6a/6b/6c: a paired token with a blacklist or pause freezes 100% of depositor funds,
including the Morpho idle leg**, because every withdraw with a live LP routes through `_sweepFees` /
`_decreaseAndTake` (a paired `TAKE` to the PM, a paired fee transfer to the immutable `harvestRecipient`, a paired
transfer to the withdrawer). Deposits keep succeeding into the frozen instance. A single depositor can be targeted.
Reverting `previewRedeem` on the source bricks everything too (RT-5f, no try/catch — A-8 known).

**Did we grief it?** Yes, cheaply: 31 quote blocks three consecutive owner deploy attempts via `DeployPriceOutOfBand`
(RT-3b); the adapter owner's `perBlockWithdrawCap = 1` soft-locks every exit indefinitely (RT-7d); a Morpho pause lets
the first mover take the *entire* LP and leaves everyone else 100% in the frozen reserve (RT-5a, value-neutral).

**Worst realistic loss** for a meme pool with a hostile issuer: **≥ 2/3 of depositor principal despite the 50% cap**
(RT-9a, honest operator), and **a total freeze** if the token has admin controls (RT-6a). For a curated pool with a
plain token and honest issuer: **~13% per victim deposit** to a sandwicher (RT-1a) and the ≤ 3.2% owner mis-deploy
loss (RT-9c) — everything else held.

---

## 2. Attack matrix

| ID | Scenario | Persona | Result | Severity | Test |
|---|---|---|---|---|---|
| RT-1a | Deposit sandwich, thin pool (pump → victim deposit → dump) | External MEV / holder | **SUCCEEDED** — victim −12.9k/100k, cost 153 | **High** (3rd-party) / Med (own funds) | `test_RT_1a_depositSandwich_thinPool_SUCCEEDS` |
| RT-1a′ | Same with 10× third-party depth | External MEV | **SUCCEEDED** — victim −11.9k, cost 1.55k | High | `test_RT_1a_depositSandwich_deepPool10x_SUCCEEDS` |
| RT-1e | Held pump, victim deposits 3 blocks later (no mempool) | External | **SUCCEEDED** — same −12.9k | High | `test_RT_1e_heldPump_noMempool_dilutesLaterDeposit_SUCCEEDS` |
| RT-1b | Withdraw sandwich (dump → victim withdraws → pump) | External MEV | FAILED — victim got 155.7k vs 125k fair; attacker −11.4k | — | `test_RT_1b_withdrawSandwich_dumpVictimPump_FAILS` |
| RT-1c | Two-address same-block round trip through the guard, with a pump | External | FAILED — 215k out vs 225k in | — | `test_RT_1c_twoAddressSameBlockRoundTrip_FAILS` |
| RT-1d | Pump 2×, walk follower 7 blocks, withdraw all, unwind | External holder | FAILED — attacker 114.7k vs 125k fair; co-holder intact | — | `test_RT_1d_followerWalk_pumpHoldWithdraw_FAILS` |
| RT-1f | First-depositor donation (1 wei + $1M 4626-share donation), 6dp | External | FAILED — victim loses ≤$1; attacker burns $1M | — | `test_RT_1f_firstDepositorDonation_6dp_FAILS` |
| RT-1g | 300 dust deposit/withdraw rounding cycles | External | FAILED — attacker −300 wei | — | `test_RT_1g_roundingDrain_dustCycles_FAILS` |
| RT-2 | Hook-bearing paired token → re-credit after full delivery | Depositor + callback token | **SUCCEEDED** — +12.9% shares re-minted, +14k realized | **Medium** (needs callback token; one-line fix) | `test_RT_2_hookPaired_reCreditMintsSharesAfterFullDelivery_SUCCEEDS` |
| RT-2b | Re-credit under normal conditions | Depositor | FAILED — 0 wei re-credit | — | `test_RT_2b_plainPaired_reCreditIsDustOnly_FAILS` |
| RT-3a | Sandwich owner deploy inside the 5% band | External MEV | **SUCCEEDED (marginal)** — +12 quote on a 20k deploy (6 bps) | Low | `test_RT_3a_deploySandwichWithinBand_marginal_SUCCEEDS` |
| RT-3b | `DeployPriceOutOfBand` griefing | External | **SUCCEEDED** — 3 deploys blocked for 31 quote | Low | `test_RT_3b_deployPriceBandDoS_cheapPerBlock_SUCCEEDS` |
| RT-4 | Exact-zero drain → stale follower → price moves 50% → deploy | State | FAILED — recovers in 9 blocks, no brick | — | `test_RT_4_drainedPositionStaleFollower_recoverable_FAILS` |
| RT-5a | Source paused with live LP: first mover exits via everyone's LP | Depositor | **SUCCEEDED** (liveness; value-neutral) | Low | `test_RT_5a_sourcePaused_firstMoverTakesWholeLP_SUCCEEDS` |
| RT-5c | Over-reporting idle source → drain LP from co-depositors | Hostile source | **SUCCEEDED** — 200k vs 125k fair | Medium (curator-trust) | `test_RT_5c_overReportingSource_drainsLPFromCoDepositors_SUCCEEDS` |
| RT-5d | Transient 50% exit fee → cheap shares | Hostile source | **SUCCEEDED** — +33k | Info (curator-trust) | `test_RT_5d_transientExitFee_mintsCheapShares_SUCCEEDS` |
| RT-5e | Source `maxDeposit == 0` | Source | FAILED — deposit DoS only, exits intact | — | `test_RT_5e_sourceSupplyCap_depositDOS_noLoss_FAILS` |
| RT-5f | Source `previewRedeem` reverts | Source | **SUCCEEDED** — deposit/withdraw/NAV all revert (no try/catch) | Low (availability) | `test_RT_5f_sourcePreviewReverts_everythingBricks_SUCCEEDS` |
| RT-5g/5h | Reentrancy into `withdraw`/`deposit` from the source's `redeem` | Hostile source | FAILED — `ReentrancyGuardReentrantCall` | — | `test_RT_5g_…_FAILS`, `test_RT_5h_…_FAILS` |
| RT-6a | Paired token blacklists the PM | Token admin | **SUCCEEDED** — 100% frozen incl. 60k idle; deposits still accepted | **High** (availability/ransom) | `test_RT_6a_blacklistPairedFreezesPM_allWithdrawsBrick_SUCCEEDS` |
| RT-6b | Paired token blacklists the immutable `harvestRecipient` | Token admin | **SUCCEEDED** — exits/harvest brick once paired fees accrue | High | `test_RT_6b_blacklistHarvestRecipient_bricksExitsOnceFeesAccrue_SUCCEEDS` |
| RT-6c | Paired token blacklists one depositor | Token admin | **SUCCEEDED** — targeted freeze (idle too) | Medium | `test_RT_6c_blacklistSingleDepositor_targetedFreeze_SUCCEEDS` |
| RT-6d | Fee-on-transfer paired | Token | FAILED — deploy DOA, no loss | — | `test_RT_6d_feeOnTransferPaired_deployDOA_noLoss_FAILS` |
| RT-7a | `setController` front-run | External | FAILED | — | `test_RT_7a_setControllerRace_FAILS` |
| RT-7b | Factory adapter reuse / non-owner create | External | FAILED | — | `test_RT_7b_factoryAdapterReuse_and_curation_FAILS` |
| RT-7c | Ownable2Step pending-owner powers / renounce | Key | FAILED | — | `test_RT_7c_ownable2Step_pendingOwnerPowerless_FAILS` |
| RT-7d | Adapter owner sets `perBlockWithdrawCap = 1` | Adapter-owner key | **SUCCEEDED** — indefinite exit soft-lock, no loss | Low | `test_RT_7d_adapterOwnerPerBlockCap_softLocksExits_SUCCEEDS` |
| RT-9a | Crash-cycle vs the **honest cron rule** | Token issuer | **SUCCEEDED** — 67% deployed, issuer +53% | **Medium-High** | `test_RT_9a_crashCycle_honestCron_bypassesTotalDeployCap_SUCCEEDS` |
| RT-9b | Crash-cycle, compromised owner | Owner key + issuer | **SUCCEEDED** — 80% deployed, +71% extracted | High (key) | `test_RT_9b_crashCycle_compromisedOwner_worstCaseLoss_SUCCEEDS` |
| RT-9c | Owner pump 2× → walk → deploy max → dump | Owner key | **SUCCEEDED** (bounded) — depositors −3.2% NAV; owner net negative | Info | `test_RT_9c_ownerPumpWalkDeployDump_boundedLoss_SUCCEEDS` |
| RT-9d | Compromised owner, idle-only: any principal sweep? | Owner key | FAILED — none exists | — | `test_RT_9d_compromisedOwnerIdleOnly_noPrincipalSweep_FAILS` |
| RT-x | 6dp quote × 18dp paired on real V4: value conserved | — | FAILED-to-break — 149,999.5 of 150,000 | — | `test_RT_x_6dpQuote18dpPaired_valueConserved_FAILS` |

---

## 3. Detailed write-ups — SUCCEEDED attacks

### RT-9a / RT-9b · Medium-High · The total-deploy cap is on marked value → a dying token pulls principal in repeatedly

**Steps (RT-9a, honest operator).** Full-range pool, alice deposits 100k idle. Each cycle the owner applies the cron's
exact rule (`deploy.ts`: `deployedNow = totalNav − staged; deployable = 50%·NAV − deployedNow; quoteToDeploy =
deployable/2`, matched paired from the seat). Between cycles the token issuer sells paired until the price is /16 and
the follower is walked (anyone can, ~28 blocks of any action). Six cycles.

**PoC output.** `cumulative depositor quote deployed 67,050 · issuer's net quote gain 53,272 · alice NAV at end 60,505`
(and that 60.5k is mostly dying paired legs marked at the crashed spot). Compromised-owner variant (deploys the full
room, RT-9b): `80,302 deployed · issuer +71,236 · alice NAV 37,829`.

**Root cause.** `deploy()` checks `deployedNow + quoteToDeploy ≤ MAX_DEPLOY_BPS·NAV` where `deployedNow =
_deployedQuoteValueAt(spot)`. After a crash the LP marks near zero, so the same 50% "room" reopens; the cron's
target-ratio rule then *rebalances into the drawdown*. Nothing tracks how much **principal** has ever been deployed.
The A-3 comment ("bounds what a compromised owner key can push into the pool") holds per-call, not cumulatively, and
does not need a compromised key at all — the honest rule + a hostile issuer suffices.

**Fix.** Track a cost basis: `quoteBasisDeployed += quoteUsed` on deploy, reduced pro-rata on LP-sourced withdraws;
cap `quoteBasisDeployed + quoteToDeploy ≤ MAX_DEPLOY_BPS · (idle + quoteBasisDeployed)`. Add a drawdown breaker
(no deploy while `LP mark < X% of basis`). Cron: deploy only from *net new deposits*, never to restore a ratio after
a drawdown. Curation remains the economic backstop for issuer-controlled tokens.

### RT-1a / RT-1e · High (third-party depositors) · Deposit sandwich; no `minSharesOut`

**Steps.** Gateway is the pool's LP (50k/50k, NAV 150k, alice 100% of shares). Attacker buys paired with 30k quote
(spot NAV → 187k), bob deposits 100k at that NAV, attacker sells the paired back. Bob exits next block.

**PoC output.** `victim loss 12,857 · attacker round-trip cost 153 · holder gain 12,944 · loss/cost 83×`. With 10×
third-party depth and a 300k pump: `victim loss 11,925 · cost 1,554`. Holding the pump for 3 blocks before the
victim arrives (RT-1e) gives the identical loss — **no front-running or mempool visibility is required**; on a thin
meme pool with no arbitrageurs the pump simply persists.

**Root cause.** Deposits are priced at `max(spot, ref)`; a pump makes `spot` the max, so the depositor pays the
manipulated price. This is deliberate (protects existing holders) but leaves the *depositor* with no protection:
`deposit(uint256 quoteAmount)` has no minimum-shares parameter, and the UI cannot enforce one. The dilution goes to
existing holders pro-rata, so the attacker only needs to be a holder.

**Fix.** `deposit(uint256 quoteAmount, uint256 minSharesOut)`; have the UI quote shares off `_navDeposit`. Optionally
also refuse deposits when `|spot − ref| > maxDeviationBps` (deposit is not the availability-critical path — withdraw
is; the M-01 "never revert on price" argument does not apply to entries). Third-party funds should not be accepted
before this lands.

### RT-2 · Medium · A-1 re-credit values `delivered` at a re-read spot → shares minted after full delivery

**Steps.** Paired token is ERC777-style (calls a registered receiver after transfer). Attacker contract deposits 100k
(alice 100k; LP 50k/50k). It withdraws all; inside `_decreaseAndTake`'s `pairedAsset.safeTransfer(msg.sender, …)` the
callback sells the received paired into the pool (the PositionManager has already unlocked, so the swap succeeds).
Back in `withdraw`, `delivered = quoteOut + _pairedToQuote(pairedOut, _spot())` uses the *depressed* spot while
`claimValue` was computed at the pre-dump mark → `delivered < claimValue` → `reCredit` shares.

**PoC output.** `shares withdrawn 100,000 · re-credited 12,922 · fair claim 124,999 · attacker ended with 138,848
(+14,028 realized from the minted shares next block)`. Control (RT-2b, plain ERC20): re-credit = 0 wei.

**Root cause.** `withdraw` reads `_spot()` twice — once to size the removal, again after external calls to value the
result. The second read is the attack surface. Hookless-pool reasoning ("no callbacks reach the gateway") is true of
the *pool* but not of the *tokens*.

**Fix.** Cache `spot` before sourcing and value `delivered` at that cached price (one line); or compute the re-credit
from `liqToRemove/want` and the unstage shortfall rather than from any price. Curation: reject paired tokens whose
`transfer` can call the receiver (ERC777, hooks, proxies).

### RT-6a / 6b / 6c · High (availability, ransom) · A blacklist/pausable paired token freezes 100% of funds

**Steps.** Paired token admin blacklists the PM (6a), the immutable `harvestRecipient` (6b, after any two-sided
volume so paired fees exist), or one depositor (6c).

**PoC output (6a).** Every `withdraw` reverts (full exit and `withdraw(1e18)` alike), `harvest` and `deploy` revert,
while `deposit` **still succeeds**: `depositor value frozen 159,927, of which idle (Morpho) also unreachable 60,000`.
6b: exits brick until the admin relents. 6c: the targeted depositor cannot withdraw even their idle share; others can.

**Root cause.** Any withdraw with a live LP has `remaining > 0` (pro-rata sourcing), so it always executes
`_sweepFees` → `TAKE_PAIR` (paired → PM) → paired fee transfer to `harvestRecipient`, then `_decreaseAndTake(liq,
withdrawer)`. A revert anywhere in the paired path reverts the whole withdraw — including the idle leg that was already
unstaged. `harvestRecipient` is immutable, so a frozen recipient cannot be rotated. Same class as the USDG issuer
risk already disclosed (M-07), but here it is the **meme token's** admin — a far more likely adversary.

**Fix.** (1) An idle-only exit that never touches the pool: if the LP leg reverts, `try/catch` it and re-credit the
unserved value (the A-1 machinery already exists). (2) In `_sweepFees`, `try` the recipient transfer and keep unsent
fees in the PM for a later `harvest` rather than reverting principal paths. (3) Auto-pause deposits when the LP leg
is failing. (4) Curation: no paired tokens with `pause`/`blacklist`/upgradeable proxies.

### RT-5a · Low · Source paused with a live LP: first mover exits via everyone's LP

`setFailWithdrawals(true)` on the source (a paused Morpho). Mallory (50% of shares) withdraws: idle serves 0, the
shortfall is pushed onto the LP, `want ≥ liq` → she removes **100% of the LP** (`first mover took 99,999`) and is
re-credited shares for the unserved idle. Alice's withdraw in the next block serves 0; she recovers 124,999 only after
the source unpauses. Value-neutral (A-1 keeps claims honest) but pro-rata sourcing (M-06) does not survive an idle
freeze, and the LP is reallocated to whoever moves first. **Fix:** cap LP removal at the withdrawer's pro-rata
liquidity share and re-credit the remainder — which also removes the RT-5c vector (an idle shortfall is never made
good from the LP).

### RT-5c / RT-5d · Curator-trust · Lying or fee-flipping 4626 source

Over-report idle by 150k → the withdrawer's claim is pro-rata of phantom NAV, the real idle serves in full, and the
LP covers the rest: `mallory got 199,999 vs fair 124,999; alice left with 50,000`. A source that can raise its exit
fee to 50% and lower it again lets a depositor mint 2× shares (`+33,333`). Neither is Morpho behaviour; both are
what a wrong `LP_GATEWAY_YIELD_SOURCE` does. The RT-5a fix (never source an idle shortfall from the LP) removes 5c.

### RT-3a / RT-3b · Low · In-band deploy sandwich (marginal) and band griefing

Pushing spot 4.76% (inside the 5% band) before a 10k/10k deploy and reversing nets **+12 quote** on a 1,400 push —
profitable but bounded to single-digit bps of the deployed amount by the band; the cron's `minLiquidity` (0 here)
tightens it further. Pushing >5% before each owner attempt reverts `DeployPriceOutOfBand`: **31 quote blocks three
consecutive deploys**; all fees flow to LPs, and the owner deploys the moment the griefer stops.

### RT-7d · Low · Adapter-owner `perBlockWithdrawCap = 1`

Every exit serves 1 wei and re-credits the rest; five full-exit attempts serve 5 wei. Nothing is lost or moved, but
exits are soft-locked for as long as that key wants. Same Privy seat as the PM owner in the deploy script — so it is
one key, not two; note it in the key-compromise model.

### RT-5f · Low · Source `previewRedeem` reverts → deposit, withdraw and `totalNav` all revert

A-8 noted the missing `try/catch` on the staged read; confirmed as a total brick for as long as the source
misbehaves (no loss; recovers when the source does).

### RT-9c · Info · Owner pump → walk → deploy → dump is bounded

Owner pumps 2× on a 20k LP, walks the follower in 7 blocks, deploys the full cap room at the pumped price, dumps.
Depositors lose **3,477 = 3.16% of NAV** (marked after a third party restores fair); the owner is net negative (it
donated 11.2k of paired to gain 1.4k quote). The band + cap do their job here; RT-9a/9b is the path that does not
need manipulation at all.

---

## 4. Notable FAILED attacks — why the defense held

- **Price manipulation then withdraw (RT-1b, 1c, 1d).** Pro-rata sourcing makes the LP removal `want = liq ·
  remaining / V(spot)`; with `remaining` marked at `min(spot, ref)` this is *at most* the withdrawer's pro-rata
  liquidity, whatever spot is. A pump therefore hands the attacker *less* than pro-rata (mostly quote at a price they
  themselves paid up for) and a dump hands the *victim* a paired-heavy slice that is worth more once fair returns
  (bob got 155.7k vs 125k fair; the attacker ate 11.4k of slippage). The two-address bypass of the same-block guard
  gains nothing for the same reason (215k out vs 225k in). Walking the follower onto the pump (7 blocks) only makes
  `min(spot, ref) == spot`; it does not change the pro-rata physics (mallory 114.7k vs 125k fair; alice 125.0k).
- **Inflation / rounding (RT-1f, 1g, 2b).** VIRTUAL = 1e6 on a 6dp quote bounds the donation attack at ~$1 lost per
  $1M donated (victim got 999.001 of 1,000; the attacker's single share redeems for $1). 300 dust cycles net −300
  wei. A healthy half-exit re-credits 0 wei.
- **Reentrancy (RT-5g, 5h).** Probes from inside the source's `redeem` into `withdraw`/`deposit` are rejected with
  `ReentrancyGuardReentrantCall`; the honest exit is served exactly once.
- **Drained/dust state (RT-4).** Exact-zero liquidity with a stale follower and a 50% price move recovers in 9 blocks
  of walking; the A-2 fix holds.
- **Ownership / factory (RT-7a, 7b, 7c, 9d).** `setController` deployer-only + one-shot; adapter reuse refused;
  pending owner powerless until accept; no function lets the PM owner move principal in the idle-only state
  (`staging.unstage` / `adapter.withdraw` both refuse the owner).
- **Decimal mix (RT-x).** 6dp quote × 18dp paired through a real V4 deploy + full exit conserves value to
  149,999.5 / 150,000 — closes test gap #7.
- **Fee-on-transfer paired (RT-6d).** Deploy is DOA (under-funded SETTLE), idle path untouched — no loss.

---

## 5. Residual risks — economics / ops, not code

1. **Issuer-controlled paired tokens.** RT-6a–c and RT-9a show that a hostile meme deployer can both **freeze** the
   gateway (blacklist/pause) and **drain** ≥ 2/3 of principal through the cron's rebalancing. No code change fully
   removes this on a token the issuer controls; curation must exclude tokens with admin controls / proxies, and the
   deploy rule must never buy drawdowns. Deep-pool curation shrinks RT-1a's ratio (83× → ~8× at 10× depth) but does
   not remove it.
2. **Follower speed is per block, not per time.** 5% sqrtPrice/block ≈ 10% price/block converges 2× in 7 blocks; on
   a sub-second L2 that is seconds, so "patient cross-block manipulator" is not patient at all. It did not yield
   extraction here only because withdraw is pro-rata; it does matter for deposits (RT-1e) and deploy band checks.
3. **Owner paired contributions are a depositor subsidy.** In every deploy the owner's paired leg becomes depositor
   NAV (alice exits with 150k on a 100k deposit in the standard rig). Fine for own funds; an accounting hole for
   third-party depositors (A-9). Also inflates `deployedNow`, which is what stops RT-9b from reaching 100%.
4. **Key model.** PM owner and adapter owner are the same Privy seat; RT-7d (exit soft-lock) and RT-9b (80%
   principal into a dying pool) are what that seat can do. Neither is a direct sweep; both are ransom-shaped.
5. **USDG issuer wipe** (M-07) is unchanged; RT-6 shows the *paired* token is the likelier freeze vector.
6. **Bounded rollout still applies** — nothing here changes the "own funds, deep pools only, tiny first amount"
   gates; RT-1a and RT-6a should gate any third-party depositor.

## 6. Test-infrastructure notes (for whoever extends these)

- `via_ir` may CSE `block.number` across `vm.roll` on a fork — never roll relative to it; both harnesses keep their
  own `blk` counter (`_roll`). The existing gateway tests noted the same symptom.
- `vm.prank(x); pm.withdraw(pm.sharesOf(x))` pranks the *view* call — hoist arguments into locals first.
- `_refSqrtPrice` is internal; the fork harness probes storage slot 6 (`forge inspect … storage-layout`) and asserts
  the probe against the first anchor in `_standard`.
- Marking NAV right after an attacker's unwind is misleading (their last swap leaves spot off-fair); `_arbBack` has
  a third party restore the price before any "loss" is read.
