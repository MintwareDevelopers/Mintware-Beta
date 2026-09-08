# LP Gateway V1 — Round 3: real-world exploit replay (consolidated)

**Date:** 2026-09-08 · **Code under audit:** `main` @ `c11d8fd3` (the audit close-out) · **Driver:**
[`../../lp-gateway-external-audit-scope.md`](../../lp-gateway-external-audit-scope.md) (the external-audit scope
package — §6 invariants, §7 residuals, §8 auditor questions) · **Remediation:** this branch
(`audit/round3-exploit-replay`), see §4.

**Method.** Instead of another checklist pass, take **real incidents from products shaped like this one** — a vault
that marks deposits at a manipulable pool price (Gamma), a protocol that trusts market state an attacker created
(Cork), empty-vault share inflation (Sonne / Hundred / Radiant / Onyx), rehypothecation rounding (Bunni), donation
+ rounding (Euler), round-down drift (Balancer), tick-boundary valuation (Kyber), harvest sandwiches (Yearn / Beefy),
read-only reentrancy (Curve), issuer freezes (Paxos), env-typo downgrades (Codecov-class), non-idempotent payout jobs,
signature malleability (EIP-2), RLS bypass through views — map each to the exact function that is supposed to be safe
here, and **run it** against the real Uniswap v4 stack on the Robinhood testnet fork or the real off-chain code paths.
Seven passes, each with its own report and runnable PoCs:

| Pass | Report | PoCs |
|---|---|---|
| Exploit replay · vault / share accounting | [`exploit-replay-vault.md`](exploit-replay-vault.md) | `contracts-v4/test/audit3/ExploitReplayVault{Unit,Fork}.t.sol` |
| Exploit replay · integration / external calls | [`exploit-replay-integration.md`](exploit-replay-integration.md) | `contracts-v4/test/audit3/ExploitReplayIntegration{Base,A,B}.t.sol` |
| Exploit replay · off-chain / infra | [`exploit-replay-offchain.md`](exploit-replay-offchain.md) | `lib/gateway/__audit3__/*.test.ts` |
| Stateful invariant fuzzing (run three times: on `c11d8fd3`, on the first fix set, on the final source) | [`invariant-fuzzing.md`](invariant-fuzzing.md) | `contracts-v4/test/audit3/Invariant*.t.sol` |
| Economic models (scope §8 Q1–Q5, invariant 15) | [`economic-models.md`](economic-models.md) | `contracts-v4/test/audit3/Econ*.t.sol`, `scripts/audit3/econ_models.py` |
| Deployed-periphery + USDG equivalence (scope §8 Q7/Q8) | [`equivalence-checks.md`](equivalence-checks.md) | read-only bytecode / source diffs |
| Independent line-by-line (Fable) | [`fable-independent-review.md`](fable-independent-review.md) | `contracts-v4/test/audit3/Round3StaleIdleLossFork.t.sol` |

Every SUCCEEDS below was a runnable, quantified PoC before the fix; every FIXED row has that PoC flipped into a
regression asserting the new behaviour (test names end in `_FIXED`).

---

## 1. Verdict

| Question | Before round 3 (`c11d8fd3`) | After the round-3 fixes (§4) |
|---|---|---|
| **Bounded OWN funds, operator = sole depositor** | **Not yet** — a third party could cheapen entry against the sole holder on any single-venue pool (XR-1 / E-1, profitable at every policy depth), and every partial exit leaked ≈ $1 of phantom shares (F1) | **Yes, pending redeploy** — the live testnet rig still runs the pre-round-3 bytecode; redeploy + repoint `LP_GATEWAY_*` first |
| **Third-party funds** | **No** | **Still no** — owner paired-leg subsidy accounting (Q5), `compoundQuote` unlock (XR-4), a second signer on the seat (Q6), external audit. The economics say: third-party share ≤ 0.5 % of pool reserve until the fixes are live, then 2 %, and require arbitrage presence (a second venue) |
| **Mainnet** | blocked (no Morpho USDG vault with capacity) | unchanged |

---

## 2. Findings — contract layer

Severity is for third-party depositors; own-funds severity in brackets where different.

| # | Finding (source) | Sev | Status |
|---|---|---|---|
| **F1** | **Per-leg virtual offset on exit re-credits phantom shares.** `_withdraw` priced each leg with `toAssets(shares, leg, ts, VIRTUAL)` (and liquidity in L-units), so `claim > delivered` on every partial exit by ≈ `shares·V/(ts+V)`; the re-credit handed back unbacked shares — ≈ $1 per exit at 6 dp, repeatable every 2 blocks, paid by remaining holders (fuzz: +$100 over 200 cycles against a 10k victim). Also made the C-10 `SourceUnavailable` refusal dead code (F1-b). (invariant-fuzzing F1/F1-b) | **High** | ✅ single offset on the whole claim, legs split by un-offset weights, liquidity slice = value slice (`Invariant*Regressions` flipped) |
| **XR-1 / E-1** | **Entry mark had a one-block memory.** `max(spot, ref)` beats a flash dump, but `ref` follows spot at 5 %/block and `poke()` is permissionless: a dump *held* 7 blocks (2×) / 14 (4×) — or atomically, a ≤ 1-step dump + `poke()` — priced a deposit at the deflated NAV; pro-rata exit then paid the attacker their fraction of the restored position. Fork: 1.5 M depth, 2× → attacker **+29.9k / holder −34.9k (−11.6 %)**; E-1 atomic: **+4.3k / −5.0k** on 300k NAV, **profitable at the policy-minimum depth and the R8 2 % share**, gain/cost ≈ s/φ independent of depth. (exploit-replay-vault XR-1, economic-models E-1/Q1/Q3) | **High** [Medium] | ✅ entry-mark MEMORY (`_holderMark`: max over spot / follower / two `ENTRY_MEMORY_BLOCKS`=300 buckets; a held dump must now survive 1–2 h) — `EconFollower`, `ExploitReplayVaultFork` Gamma tests flipped. **Bounded, not immune:** `test_XR_Gamma_heldDump_beyondMemoryWindow_…_SUCCEEDS` shows a dump held 600 blocks (~2 h, one poke per period) reproduces the original numbers to the wei — the fix converts a 90 s attack into a 2 h one at full dip-buyer/arb exposure; the R8 share cap + arbitrage-presence policy carry the rest |
| **E-3 / inv. 15** | **Compromised seat: pump to the all-quote range edge, walk the follower (23 blocks; 0 on a fresh instance — the first deploy had no band), deploy quote with no paired leg, dump.** Depositors lose **51.9 % of the deployed quote = 25.8 % of NAV**, the seat books +32k. (economic-models §7) | **High** (owner key) | ✅ `DeployNotTwoSided` on the amounts actually MINTED (paired value ∈ [½, 2] × quote) + first deploy banded (below) — `EconOwner` flipped; worst case now ≤ ~5 % griefing at the seat's own expense |
| **XR-2 / X-7** | **Nothing checked the pool existed; the first deploy had no reference.** v4 `initialize` is permissionless; a gateway could be created on an uninitialised pool, deposits accepted, and the first `deploy` anchored the follower at whatever spot the attacker set (`minLiquidity` from the cron is spot-relative, so an in-range 4× mispricing passed its own floor). Fork: **+29.6k / LP leg −26.8 %** in range; **+51.8k / −26 % of principal** out of range; front-run **14.85k of 150k**. (exploit-replay-vault XR-2, exploit-replay-integration X-7) | **Medium** | ✅ ctor `PoolNotInitialized` + follower anchored at creation and running from creation → first deploy banded; cron pre-flights the band (`poke` + retry) and an **external reference price** (`ref_price_deviation`, fail-closed without a reference unless `LP_GATEWAY_DEPLOY_REQUIRE_REF_PRICE=false` on a testnet rig). **Residual (on-chain):** a pool already at a wrong price BEFORE creation, or an empty pool walked there with free pokes, passes band + two-sided at 2× (ratio 0.71): `test_XR_Cork_heldPreDeployWalk_inRange2x_…_SUCCEEDS` — attacker +10.9k, LP leg −8.15 % (vs −26.8 % pre-fix). The cron's external-reference check is the guard for this case; it is off-chain and not exercised by Forge |
| **R3-1** | **`lastKnownIdle` only conservative for yield.** A loss realised in the source *while unreadable* left the fallback stale-high; an outage-time exiter was re-credited against the inflated figure and offloaded part of the loss onto remaining holders (fork: **+5k / −5k on a 20k loss**). (fable-independent-review) | **Medium** | ✅ `OUTAGE_HAIRCUT_BPS = 2000` on the fallback (blind exiter keeps ≤ what a live read would give; waiting is exact) — `CloseoutFork` C-10 expectations updated |
| **R3-INV-1** | **Exit weight at the high mark over-credited an exiter whose LP leg FAILED** (found by the invariant re-run against my E-2 fix): idle cash paid in full while the failed-LP re-credit was sized at the high mark → the exiter cashed idle out at `nav_w/ts` instead of `nav_spot/ts` (6 dp fork: bob +1,665 / alice −1,665 per exit, repeatable every 2 blocks under a paused paired token). | **Medium** (precondition: LP leg failure + spot below the mark) | ✅ per-leg re-credit weights: idle shortfall against the LP marked HIGH, failed LP leg against the LP marked LOW (`min(spot, ref)`), everything back when nothing was delivered — `InvariantForkRegressions` R3-INV-1 flipped |
| **R3-INV-2** | **Quote parked by the deferred re-stage sat outside NAV** (a consequence of my R3-2 fix): entries priced cheap, exits forfeited their slice (fork: a later depositor gained 6.5k of a 19.9k parked amount). | Low | ✅ `_idle()` counts the PM's own quote; `deploy` consumes parked quote first; `_withdraw` pays it first (even during a source outage) |
| **R3-INV-3** | **Unset entry-memory bucket read as sqrtPrice 0** (found by the second invariant re-run): `_marksHigher(0, b)` returned true on quote-is-currency0 pools, so a gateway created in an EVEN period marked the LP leg at its range-edge maximum for the first period — deposits under-minted ~42 %, the shortfall accruing to existing holders (6 dp fork: bob 38.7k vs 66.7k shares). Not exploitable for profit by the depositor; a depositor-side DoS/over-charge window of ≤ 300 blocks. | Medium (bounded window) | ✅ zero is "unset, never a price" on both sides of `_marksHigher` — `InvariantForkRegressions` R3-INV-3 flipped; the fork campaign now also runs green in the even-period window (`A3_FORK_PERIOD_PARITY=even`) |
| **E-2** | **Exit re-credit weighted at spot.** Under an idle shortfall (Morpho illiquid) the withdrawer's own dump shrank the LP leg's weight → **+3.5 % (one step) / +59 % (4×) more shares re-credited**; sim net +571 / +8.9k, co-depositors −0.8 % / −12.9 %. (economic-models Q4) | **Medium** (precondition: adapter shortfall) | ✅ exit weight = `_holderMark(spot)` — `EconExit` flipped |
| **XR-3 / F2** | **Gateway is an unchecked depositor into the 4626.** Against an empty offset-less source: seed 1 wei + donate → the gateway's first deposit mints 0 source shares, the PM still mints full shares, the seeder redeems everything (**100 % of the first deposit**); OZ offset-0: a 0.61:1 grief; Morpho offset-12: immune. (exploit-replay-vault XR-3, invariant-fuzzing F2) | Medium-Low (curation-gated) | ✅ `StageShortfall` (reserve must grow by ≥ amount − 50 bps); also closes RT-5d (transient exit-fee cheap mint) and makes entry-fee sources > 0.5 % DOA (L-05 no longer a live risk) |
| **R3-2** | **Capped source DoS'd every deploy.** Leftover quote after the mint was re-staged unconditionally; with Morpho at `maxDeposit == 0` (the live mainnet state) the re-stage reverted even though the LP add had succeeded. | Low (availability) | ✅ `try/catch` re-stage, `RestageDeferred`; dust stays in the PM (outside NAV) until the next deploy picks it up |
| **E-4** | Liquidity slice could exceed the position for an all-but-dust holder (per-leg offset in L-units) → v4 `SafeCastOverflow` → LP leg re-credited on every retry. | Low (liveness) | ✅ by the F1 fix (`liqToRemove = min(liq, liq·lpEntitled/lpVal)`) |
| **X-3** | Staging trusted the adapter's `returned`: +1 wei bricked every withdraw; −N stranded N in the staging forever. | Low (non-compliant source) | ✅ balance-diff in `unstage` |
| **X-2** | A source that swaps its `asset()` after construction bricked the instance (staging `safeTransfer` outside every try). | Medium-Low (curation R6; Morpho immutable) | ⚠ Partially fixed via X-3: withdraw pays the whole LP leg and re-credits the idle claim (`…_idleReCredited_lpPays_FIXED`); deposits still revert (instance closed, not locked); the swapped-in token sits in the staging with no sweep |
| **XR-4** | `compoundQuote` books profit atomically: a 2-block hold captures **90 %** of a compound. | Low (owner is sole depositor) → Medium with third parties | ⏳ Open — add a linear unlock before third-party depositors |
| **X-1** | Read-only reentrancy windows: `totalNav`/`totalShares`/`sharesOf` read **2.0×** inside a source `redeem`, **1.67×** in transfer windows; `deployedPrincipal` stale. No on-chain consumer exists. | Info → hard rule | ⏳ Documented (scope §7): never read PM views from a gateway callback; `nonReentrantView` before share tokenisation |
| X-4 / X-5 / X-6 | Preview-fine/redeem-haircut source (first-mover ~9 %); entry-fee dilution (now DOA); issuer freeze of a depositor strands their unfrozen paired leg too. | Low | Accepted (X-4 non-compliant source; X-5 closed by `StageShortfall`; X-6 design/legal call — delivering the paired leg to a frozen address is arguably worse) |
| F3 / F3-b | Adapter over-delivers ≤ 1 source share (ceil/floor); cost basis 1–2 wei above the cap-checked request. | Info | Accepted (wei-level) |
| Q5 | **Owner paired-leg subsidy is captured 100 % by holders at deploy time**; a later depositor pays NAV including it and carries its IL (alice 131k vs bob 87.5k after −50 %). | Design (third-party) | ⏳ Open — owner shares for the paired leg at `min(spot, ref)` with a cliff, or fund the paired leg from depositor quote (economic-models §5.3) |

**Toolchain gotcha found while flipping (recorded in both replay reports):** on this forge build `vm.expectRevert` does NOT
intercept a CREATE at the cheatcode's own depth — a reverting `new` bubbles to the test frame, forge marks the test PASS
and every assert after it is skipped (tell: ~32k gas, no logs). Constructor-revert regressions must go through an external
self-call (`this.xrNewPm(...)`).

**Defenses that held** (attacks ran and failed, all still green): same-block dump vs the entry mark; every
state-changing re-entry from every callback surface (15 entry points × 3 surfaces); v4 settlement ordering inside a
third party's `unlock`; Permit2 hygiene on every revert path; Kyber tick-boundary valuation (NAV == delivered to the
wei at all six boundary cases); Platypus/Penpie fee stranding; Bunni idle/LP split at tiny share counts and
`withdrawWithMin` full rollback; Euler donate/dust cycles (−281 wei / 150 cycles); Balancer round-down at 6 dp × 18 dp
(cyclers −86 wei); PM `VIRTUAL = 1e6` against an attacker at half the virtual supply; `harvest()` itself is not
sandwichable; Morpho `maxDeposit == 0` / `NotEnoughLiquidity` / `maxRedeem` cap; USDG freeze of staging / adapter /
source / recipient; fee-on-transfer quote (DOA); rebasing quote; Ownable2Step races; PoolKey bound at construction.

---

## 3. Findings — off-chain / infra (all fixed in this branch)

| # | Finding | Sev | Status |
|---|---|---|---|
| **F-1** | Ledger views `gateway_fee_balances` / `gateway_fee_ledger_reconciliation` were owner-executed (no `security_invoker`) over deny-all tables — **queryable with the public anon key** (200 on prod; empty only because the ledger is empty) | **Medium** (latent) | ✅ migration `20260908000003`: `security_invoker = on`, `REVOKE ALL` from `PUBLIC`/`anon`/`authenticated`, `REVOKE EXECUTE` on `record_gateway_harvest` (F-7) — applied to prod by the operator |
| **F-3** | `markRestaked` swallowed write errors and was row-by-row → after a mined `compoundQuote(Σ pending)` a failed UPDATE left logs `pending` and the next cron compounded the same net again from the seat | Low/Medium (Mintware-side) | ✅ two-phase, count-verified settlement (`claimRestake` → compound → `markRestaked`; `releaseRestake` only when nothing was sent; ambiguous send stays `restaking` + `listStuckRestaking`) |
| **F-5** | Code-hash trust root pinned immutables, not `owner()` / `harvestRecipient()` / `staging.adapter()`; a bytecode-identical PM with an attacker owner was stopped only by an accident of the build | Medium (latent) | ✅ registry `seat` checks (`owner_mismatch`, `recipient_not_allowlisted`, `adapter_unbound`, `adapter_vault_mismatch`; fail closed when `LP_GATEWAY_OWNER` is unset) |
| **F-2** | O-10 replay set keyed on the signature → EIP-2 high-`s` / `v` twins bypassed it (impact bounded by `UNIQUE(tx_hash)`) | Low | ✅ keyed on the signed `authMessage` |
| **F-6** | `ORACLE_SIGNER_PROVIDER` typo silently selected env-key mode for every role (`range`/`agent` signed with the shared, git-exposed key class) | Low | ✅ only `privy` / `env-key` accepted; anything else throws at first use for every role |
| F-10 | CSP `connect-src https://*.supabase.co` allowed exfiltration to ANY Supabase project | Low | ✅ pinned to our project host |
| F-4 / F-8 / F-9 / F-11 / F-12 / F-13 | XFF-trusting per-IP floor (Vercel overwrites XFF — mitigated by platform); `gateway_alerts` table missing in prod; PNG/HTML polyglot accepted (not renderable as HTML); transitive `pnpm audit` highs (none on the gateway path); leaderboard 500-wallet RPC fan-out; re-org at 1 confirmation | Low / Info | Documented; F-8 is an ops item (apply the alerts migration) |

Off-chain PoCs live in `lib/gateway/__audit3__/` and are kept, flipped, as regressions (`FIXED` in their names).

---

## 4. What changed (remediation on this branch)

**Contracts** (`contracts-v4/src/gateway/`, no ABI-breaking change to `deploy`/`deposit`/`withdraw`):

- `MintwareLpGatewayPositionManager`: ctor `PoolNotInitialized` + anchor at creation; `_anchorFollow` from creation;
  entry-mark memory (`_recordEntryHigh` / `_entryHigh` / `_holderMark` / `_marksHigher`, `ENTRY_MEMORY_BLOCKS = 300`);
  `_navDepositStrict` at the holder mark; `_deposit` `StageShortfall` (`STAGE_TOLERANCE_BPS = 50`); `_withdraw` single
  offset on the claim, legs by un-offset weights, liquidity slice = value slice, exit weight = holder mark,
  `OUTAGE_HAIRCUT_BPS = 2000`, cost basis leaves by the liquidity fraction; `deploy` `DeployNotTwoSided`
  (`MIN_TWO_SIDED_BPS = 5000`) + `try/catch` re-stage (`RestageDeferred`); new view `referencePrice()`.
  Behavioural note on `DeployNotTwoSided`: a balanced offering is consumed lopsidedly when spot sits in the outer part
  of the range (the mint takes all of the scarce side), so deploys within roughly the outer third of the range are now
  refused as well as out-of-range ones — a near-edge deploy is a bad entry anyway; the cron simply retries next window.
- Second pass after the invariant re-run: `_idle()` includes `quoteAsset.balanceOf(pm)`; `deploy` consumes parked quote
  before unstaging; `_withdraw` pays the idle leg from parked quote first and re-credits PER LEG (idle shortfall at the
  high mark, failed LP leg at `min(spot, ref)`, all shares back when nothing was delivered).
- `MintwareLpGatewayStaging.unstage`: balance-diff.
- Storage: four new slots appended after `lastKnownIdle`; `_refSqrtPrice` stays at slot 7.
- Test rigs: `test/mocks/MockSlot0PoolManager.sol` replaces the codeless pool-manager stub in every idle-path rig.

**Off-chain:** `lib/gateway/deploy.ts` (band pre-flight + external reference; `bandDeviationBps`,
`pairedPriceInQuote`, `externalPairedPriceInQuote`, `referenceDeviationBps`, `requireRefPrice`), `ledger.ts` +
`harvest.ts` (two-phase restake), `recordAuth.ts` (message-keyed replay), `registry.ts` (seat checks),
`lib/web3/oracleSigner.ts` (provider typo throws), `discovery.ts` (`baseToken`/`quoteToken` on candidates),
`lib/web3/artifacts/lpGateway.ts` (`referencePrice`, `maxDeviationBps`), `next.config.mjs` (CSP pin), migration
`supabase/migrations/20260908000003_gateway_ledger_view_security.sql`. New env:
`LP_GATEWAY_DEPLOY_REF_MAX_DEV_BPS` (500), `LP_GATEWAY_DEPLOY_REQUIRE_REF_PRICE` (true).

**Verification (from the repo root, `export PATH="$HOME/.foundry/bin:$PATH"`):**

```bash
bash -c 'forge test --match-path "contracts-v4/test/gateway/*"'                                    # 61 unit
bash -c 'forge test --match-path "contracts-v4/test/audit/*"'                                      # 87 prior-round audit
bash -c 'LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com forge test --match-path "contracts-v4/test/fork/MintwareLpGateway{Closeout,AuditRound2,Hardening}Fork.t.sol"'  # 22 fork
bash -c 'LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com forge test --match-path "contracts-v4/test/audit3/*"'   # round-3 PoCs, flipped
npx vitest run                                                                                     # 1037 (incl. lib/gateway/__audit3__)
```

---

## 5. Left for a human

1. ~~Redeploy the testnet rig~~ **Done 2026-09-08: rig 'g'** — PM `0xa52d4ffaefa586251cb36d1e05588daa89ab0a63`, staging
   `0x0a8544c0222d3d6a729cd8aa81fbe9f64174fa14`, tUSDG `0x2a8c32e291bc90ceb8ae058b6a684be0312bb848`, poolId
   `0x07340da7f228f72fd2a624571c34b0f217b5f3a8e2b2826373f4afffe0a0dfa2`, PM code hash
   `0x89a53e8da35d43715c50cd1354bbc376624ab6bfc56fccb96097db2baefc00f4`; smoke passed (deposit · compound · pause ·
   withdraw). Remaining ops: repoint Vercel `LP_GATEWAY_POSITION_MANAGER` / `_STAGING` / `_POOL_ADDRESS` / `_USDG` /
   `LP_GATEWAY_PM_CODEHASHES`, set `LP_GATEWAY_DEPLOY_REQUIRE_REF_PRICE=false` **on the testnet rig only**, redeploy,
   register the row via a curator-signed `POST /api/gateway/curate` approve (prod `gateway_instances` was empty — rig 'e'
   was never registered; the app ran on the env fallback).
2. Apply the `gateway_alerts` migration in prod (F-8) if it is still missing.
3. Before any third-party depositor: `compoundQuote` linear unlock (XR-4), owner paired-leg accounting (Q5), a second
   signer on `acceptHarvestRecipient` / `deploy` size (Q6), third-party share policy per `economic-models.md` §3.4, and
   the external audit itself (scope doc updated with invariants 17–21).
4. Monitor USDG `CallScheduled` / `Upgraded` on RH mainnet (issuer upgrade authority is one key behind a 24 h timelock).
