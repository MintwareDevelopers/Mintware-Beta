# LP Gateway V1 — Round-3 Economic Models (audit scope §8 Q1–Q5, invariant 15)

**Date:** 2026-09-08 · **Branch:** `audit/round3-exploit-replay` · **Target:** the close-out PM
(`contracts-v4/src/gateway/MintwareLpGatewayPositionManager.sol`, `MAX_DEPLOY_BPS = 5000`, band 500 bps,
ticks ±22 980, pure pro-rata exit, cost-basis cap). **No `src/` file was modified.**

**Method.** Every question is answered twice and the two answers are reconciled: (1) a closed-form / numeric model
in [`scripts/audit3/econ_models.py`](../../../../scripts/audit3/econ_models.py) built from the exact primitives the
contract uses (Uniswap CL swap math with fee-on-input, `V(P) = L(2√P − √Pa − P/√Pb)`, one follower step ≤ band per
`block.number`, deposit mark `max(V(spot), V(ref))`, pro-rata sourcing, `reCredit = shares·(claim−delivered)/claim`,
cost-basis cap); (2) fork simulations against the **real** Uniswap v4 PoolManager / PositionManager on Robinhood
testnet in [`contracts-v4/test/audit3/Econ{Follower,Exit,Owner,SubsidyIl}.t.sol`](../../../../contracts-v4/test/audit3/)
(shared rig `EconBase.sol`: 18 dp mocks, price 1.0, third-party depth in the gateway's range, **limit swaps** so the
price lands exactly on the model's target). **16 / 16 simulations pass; every headline number agrees with the model
within 2–12 %** (reconciliation table in Appendix A). Where the first-order model overstates (Q4), the simulation is
the binding number and the report says so.

```bash
export PATH="$HOME/.foundry/bin:$PATH"
python3 scripts/audit3/econ_models.py                                   # every table below
bash -c 'LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com \
  forge test --match-contract "Econ(Follower|Exit|Owner|SubsidyIl)Test" -vv'   # 16 tests, ~7 s after fork
```
(If other `audit3/` files are mid-edit, add `--skip "*/audit3/Invariant*" --skip "*/audit3/ExploitReplay*"`.)

**Notation.** Quote = USDG. `R` = the pool's in-range **virtual quote reserve** (`L·√P`, the policy §7 number; at
price 1.0 it equals `L` in quote units). `q` = gateway quote leg deployed **at cost**; `s = q/R` = gateway share (policy
R8); `φ` = fee tier (0.30 %); `c` = cap (0.5); `b` = follower step / band (5 % of √P ≈ 10.25 % price); a "dump by
`x`" moves the paired price to `1/x`, a **step** is `x = 1.108` (√P −4.9 %). Balanced deploy: idle `= q(1−c)/c`, LP
value `V = 2q` (the owner's paired leg counted as depositor NAV), `NAV = q/c + q = 3q` at `c = 0.5`.
Pools used: **reference** PONS/USDG (`R ≈ 14.0 M`, scope §4.5), **harness** (`R ≈ 2.35 M`, the 1.5 M/1.5 M
external LP of the Round-2 fork suite + a 100 k/100 k gateway → `s = 4.3 %`), **policy minimum** (`R = 250 k`, R5).

---

## 0. Answers in one table

| Q | Question | Answer (numbers) | Verdict |
|---|---|---|---|
| **Q1** | Follower speed vs block cadence | Walking the reference 2× takes **7 blocks (dump) / 8 (pump) ≈ 84–96 s** of L1 cadence, capital `0.41·R` (**5.8 M** on PONS, **104 k** at policy-min), fee cost **0.21 % of R** with no arbitrage (**29.8 k** / **532**), **12.3 % of R per block held** if the displacement is arbitraged. But the walk is not needed: a **same-block snap** (dump ≤ 1 step → `poke()` → deposit → reverse, **E-1**) extracts **1.7 % of gateway NAV per cycle** at gain/cost **≈ s/φ·D/(NAV+D) = 3.3× at the 2 % share, 8× at 5 %**, independent of depth and of arbitrage. In-band deploy sandwich: **unprofitable below ~6 % share** (2 steps via poke), depositor loss ≤ **1.2 % of the deploy**. | Band primitive: **per-time**, with the deposit mark and deploy band read against the **previous block's** reference (§1.5). |
| **Q2** | `MAX_DEPLOY_BPS` calibration | Max principal loss = **c** (50 %) at `P→0`; **−29 % at the range floor** (P = Pa); depositor NAV is **≥ principal down to P ≈ 0.30 (−70 %)** because the owner leg covers the quote-leg IL — for **any** `c`. Balanced LP value = 66.7 % of NAV (F-03); at `P = 0.4` the paired leg is 1.6× the quote leg, at the floor it is all paired. | Keep **5000 as the hard constant**; add an owner-lowerable ratio (timelocked increases) and a **two-sided-deploy check** `ρ ∈ [½, 2]` (§2.4). |
| **Q3** | Thin-pool manipulation cost model | `gain(D) = D·ΔV/(NAV−ΔV+D)`, `ΔV = (1+ρ)q·g(x)`, `g(x) ≈ 0.96·(1−1/√x)`; `cost ≈ φ·R·(x−1)/√x + n·α·R(√x−1)²/√x`; **ratio → s(1+ρ)/(2φ) = s/φ** for balanced deploys. **R5 (depth) does not enter the ratio at all**; it sets capital `K ≈ D + 0.05R` and the absolute prize. **R8's 2 % is 3–6× above break-even (0.31–0.60 %)**; 5 % running is 8–16×. | R5 is necessary but irrelevant to profitability; **R8 is wrong for E-1** — add an arbitrage-presence rule and cut the third-party share to **≤ 0.5 %** until the code fix lands (§3.4). |
| **Q4** | Pro-rata exit composition risk | Plain sandwiches still fail (victim's slice is worth **≥ fair**, +0.12 % here). Residual found: the **re-credit weight** — under an adapter shortfall the withdrawer dumps first so `claim` marks the LP leg low → **+3.5 % (one step) / +59 % (4× dump) more shares re-credited**; sim net **+571 / +8.9 k** to the attacker, co-depositors **−0.8 % / −12.9 %** (**E-2**, precondition: Morpho illiquid). Composition moves **−3.6 % quote / +7.5 % paired per step**. New Low: **E-4** liquidity-slice overshoot bricks the LP leg for an "all-but-dust" holder. | UI floors **1 % on both legs**, quote floor is the one that bites; fix E-2 by weighting the re-credit at `max(spot, ref)` (§4.4). |
| **Q5** | Owner-subsidy accounting | The paired leg is captured **100 % by holders at deploy time** (alice: 100 k → 150 k claim); a later depositor pays NAV that includes it and **carries its IL** (bob: 100 k → 87.5 k after −50 %, alice still 131.2 k). It also makes `q` the *smaller* of the two legs the owner can mis-price. | **Mint owner shares** for the paired leg at `min(spot, ref)` (shape A) before third-party admission; or fund the paired leg from depositor quote (shape D) (§5.3). |
| **Inv 15** | Owner worst case | Compromised seat: **pump to the all-quote range edge, walk 23 blocks (0 on a fresh instance — the first deploy has no band), deploy `q` with no paired leg, dump.** Depositors lose **51.9 % of the deployed quote = 25.7 % of principal (25.7 % of NAV)** — sim 51,344 on 200 k — and the seat **books +32 k** net of 20 k fees at the harness share. Reference pool at 2 %: **25.8 % of NAV** gross, seat ≈ break-even (+25 k on 30 M capital); at 5 %: seat **+241 k**. Policy-min at 2 %: 2.6 k / seat +0.4 k. RT-9c (mid-range, owner-funded paired) reconciles as the owner-*negative* variant (−3.2 % NAV griefing). | **One number: 25.8 % of NAV** (reference and policy-min alike — the ratio is depth-free). Two-sided-deploy check cuts it to ≤ 5.5 % griefing at the seat's own expense (§7.3). |

**New findings** (none is speculative; each has a fork PoC):

| ID | Finding | Severity | PoC |
|---|---|---|---|
| **E-1** | **Same-block follower snap defeats the deposit mark.** `_anchorFollow` moves the reference *onto* spot when the deviation is ≤ one step, and it runs on any action (`poke`, a dust deposit, a co-holder's withdraw). Dump ≤ 1 step → `poke()` → `deposit(D)` is priced at `max(V(spot), V(ref)) = V(dumped spot)` → reverse → exit next block. **3.4 % more shares** for the same quote; extraction **1.7 % of NAV per 2-block cycle**, repeatable; gain/cost **≈ s/φ**, atomic (no arb exposure, no mempool). Profitable at the R8 2 % share on the 250 k policy-minimum pool (**+176 on 15 k NAV**) and at 4.3 % on the harness (**+4.3 k on 300 k**). The control without the poke extracts nothing. | **High** for third-party depositors on single-venue pools (Medium own-funds) | `EconFollower.test_E1_*` |
| **E-2** | **Re-credit weight is spot-marked** (Q4) — under an idle shortfall the withdrawer's dump inflates its own re-credit. | Medium (precondition: adapter shortfall) | `EconExit.test_Q4_recreditWeight_*` |
| **E-3** | **First deploy has no band; the band is two steps wide with a same-block poke; the range has an all-quote edge** → a compromised seat converts 52 % of any fresh deploy into paired bought at the top (Inv 15). Also the seat's cheapest griefing on a live instance. | **High** (owner key) — this is the number invariant 15 asked for | `EconOwner.test_I15_*` |
| **E-4** | **Liquidity slice can overshoot the position.** `toAssets(shares, liq, ts, VIRTUAL)` with the quote-scaled offset requests `> liq` when `totalShares > liquidity` (raw units) and the withdrawer holds all-but-dust (a co-holder keeps wei of rounding re-credit — which any off-unity-price exit leaves). v4 reverts `SafeCastOverflow`, the LP leg is caught + re-credited, the withdrawer gets idle only on every retry with the same share count. Workaround: exit `shares − ε`. Decimal-dependent (18 dp shares vs `L` units). | Low (liveness; no loss) | `EconExit.test_E4_*` |

---

## 1. Q1 — Follower speed vs block cadence

### 1.1 Cost to walk the reference 2× (model + sim)

The follower moves ≤ 5 % of √P per distinct `block.number`, once per block, toward spot, on any deposit / withdraw /
deploy / harvest / poke. A 2× price move is a √2 = +41.4 % (pump) or −29.3 % (dump) √P move:
`n_pump = ⌈ln√2 / ln 1.05⌉ = 8`, `n_dump = ⌈ln√2 / −ln 0.95⌉ = 7`. **Sim: 7 blocks** (`test_Q1_walkFollower2x`).

Round trip cost on a single in-range liquidity `L = R` (fee on input, exact reversal):

| Pool | Dir | Blocks | L1 seconds | Capital (quote or paired at fair) | Fee cost, no arbitrage | Loss per block held if arbitraged (α = 1) | Cost / R |
|---|---|---|---|---|---|---|---|
| reference PONS/USDG (R = 14.0 M) | pump | 8 | 96 | 5,816,439 | **29,762** | 1,715,934 | 0.213 % |
| reference PONS/USDG | dump | 7 | 84 | 5,816,439 | 29,762 | 1,715,934 | 0.213 % |
| harness (R = 2.35 M) | dump | 7 | 84 | 974,669 | 4,987 (**sim 4,992**) | 287,542 | 0.213 % |
| policy minimum (R = 250 k) | dump | 7 | 84 | 103,865 | **532** | 30,642 | 0.213 % |

Closed form: `fees ≈ φ·R·(x−1)/√x` (= 0.212 % R at x = 2); inventory loss if the displacement is arbitraged away
before the reversal `= R(√x−1)²/√x` (12.3 % R at x = 2, 0.28 % R at one step). **Arbitrage presence — not depth —
is what makes a held walk expensive**: without it the walk costs fees only, and its cost/R is depth-invariant.

### 1.2 What the walk (and the one-step snap) unlocks — entry-mark cheapening

The attacker is the *depositor*: dump, get the mark down, deposit `D` at the low NAV, reverse, exit pro-rata next block.
`gain(D) = D·ΔV/(NAV−ΔV+D)`, `ΔV = V·g(x)`, `g(x) = 1 − V(1/x)/V(1)`:

| x (dump) | √P step | g(x) | g/(√x−1) | blocks to walk |
|---|---|---|---|---|
| 1.108 (one step) | −5.0 % | 0.0506 | 0.96 | **1 (same block, via poke)** |
| 1.5 | −18.4 % | 0.191 | 0.85 | 4 |
| 2.0 | −29.3 % | 0.313 | 0.76 | 7 |
| 4.0 | −50 % | 0.558 | 0.56 | 14 |
| 9.95 (= 1/Pa, range floor) | −68.3 % | 0.791 | 0.37 | 23 |

`g` is **linear in the step to first order** (an LP holds paired inventory), so the extraction per unit of fee is the
same for a small snap as for a big walk — only the absolute size and the exposure differ.

| Pool | s | x | blocks | NAV | D | gain (model) | fee cost | **ratio** | capital K | loss % NAV |
|---|---|---|---|---|---|---|---|---|---|---|
| reference | 2 % | 1.108 | 1 | 840 k | 840 k | 14,401 | 4,316 | **3.3** | 1.58 M | 1.71 |
| reference | 2 % | 2 | 7 | 840 k | 840 k | 97,779 | 29,762 | 3.3 | 6.66 M | 11.6 |
| reference | 2 % | 2 | 7 | 840 k | 2.52 M | 138,601 | 29,762 | 4.7 | 8.34 M | 16.5 |
| reference | 5 % | 1.108 | 1 | 2.1 M | 2.1 M | 36,003 | 4,316 | **8.3** | 2.84 M | 1.71 |
| reference | 5 % | 9.95 | 23 | 2.1 M | 6.3 M | 957,059 | 119,522 | 8.0 | 36.6 M | 45.6 |
| harness | 4.3 % | 1.108 | 1 | 300 k | 300 k | 5,188 · **sim 5,038** (attacker net **4,329**) | 723 | 7.2 · **sim 7.0** | 426 k | 1.71 · **sim 1.67** |
| harness | 4.3 % | 2 | 7 | 300 k | 300 k | 35,228 · **sim 34,920** (net **29,928**) | 4,987 · **sim 4,992** | 7.1 · **sim 7.0** | 1.28 M | 11.6 · **sim 11.6** |
| policy-min | 2 % | 1.108 | 1 | 15 k | 15 k | 257 · **sim 252** (net **176**) | 77 | 3.3 · **sim 3.3** | 28 k | 1.71 · **sim 1.67** |

Break-even share (no arbitrage, ratio = 1): **0.60 %** (D = NAV), **0.31 %** (D → ∞) at one step; 0.61 % / 0.34 % at
2×; 0.79 % / 0.54 % at the range floor. At φ = 0.05 %: 0.10 %; at φ = 1 %: 2.0 %.

**The one-block variant (E-1) is the binding case**: `test_E1_sameBlockSnap_dumpPokeDeposit_extracts_SUCCEEDS`
prints `shares minted vs fair 10341 bps · attacker NET gain 4,329 · alice loss 5,038 (167 bps of NAV)`;
`test_E1_control_noPoke_maxMarkProtects_FAILS` (same dump, no poke) mints exactly fair shares and the attacker loses
the fees — the poke (or any co-holder action in the block) is the enabling primitive. It is atomic in one transaction,
so arbitrage cannot interpose, and it repeats every two blocks against the same co-depositors.

### 1.3 In-band deploy sandwich (Q1b / Q3)

Push √P by `d` (≤ band), the owner deploys `q` at the pushed price, reverse on the deeper pool.
`gain ≈ ΔL·d²·L/(L+ΔL)/(1+d)² − 2φ·L·d` with `ΔL = q/(√P₁−√Pa)`; **break-even `ΔL/L = 2φ/d`** = 12 % of pool
liquidity at one step, **6 % at two steps**. A same-block `poke()` legally widens the band to two steps
(`ref` moves one step toward spot, then `|spot−ref| ≤ band` passes at 2 steps) — RT-3a measured at 4.8 % (one step);
this is the 2-step version:

| Pool | share | steps | ΔL/L | attacker PnL | fees | depositor loss | loss / deploy |
|---|---|---|---|---|---|---|---|
| reference | 2 % | 2 | 2.5 % | **−4,922** | 8,243 | 3,227 | 1.2 % |
| reference | 5 % | 2 | 6.4 % | −239 | 8,269 | 7,549 | 1.1 % |
| reference | 10 % | 2 | 12.7 % | **+6,919** | 8,308 | 13,575 | 1.0 % |
| harness | 10 % | 2 (d = 0.10) | 10 % | +1,081 · **sim +1,020** | 1,360 | 2,175 · **sim 2,571** | 1.0 % · sim 1.16 % |
| harness | 2 % | 2 | 2.0 % | −817 · **sim −770** | 1,349 | 518 | 1.1 % |

Verdict: R8's 2 % keeps the sandwich unprofitable with margin (needs > 6 % share even with the poke); depositor
griefing is ≤ ~1.2 % of the deployed quote, ∝ `d²`. Not the binding threat. The `poke`-widened band matters more for
invariant 15 (§7).

### 1.4 Per-block vs per-time on Arbitrum-Orbit cadence

On Robinhood Chain `block.number` is the L1 block (~12 s); many L2 transactions share one number and the number can
also jump. The follower therefore already behaves as a coarse per-12 s rule — so **cadence is not what breaks it;
E-1 is** (any step size snaps within the block). Portability is the other issue: the same code on a chain where
`block.number` is the L2 block would converge 2× in **2 s** (0.25 s blocks) or 16 s (2 s blocks):

| step (bps √P) | price step / block | blocks for 2× | minutes at 12 s | seconds if 0.25 s blocks | seconds if 2 s blocks | max 1-block snap mark-down |
|---|---|---|---|---|---|---|
| **500 (current)** | 10.25 % | 8 | 1.6 | 2 | 16 | 5.06 % |
| 200 | 4.0 % | 18 | 3.6 | 4.5 | 36 | 2.0 % |
| 100 | 2.0 % | 35 | 7 | 8.8 | 70 | 1.0 % |
| 50 | 1.0 % | 70 | 14 | 17.5 | 140 | 0.5 % |
| 23 | 0.46 % | 151 | 30 | 38 | 302 | 0.23 % |

A time-based step (`maxStep = ref·rate·min(Δt, Δt_max)`) is the robust primitive: it is chain-portable, expressible in
human units, and the sequencer's `block.timestamp` is monotonic and L1-bounded (cap `Δt_max` at a few minutes so a
timestamp jump cannot walk the reference in one update). **But the step size alone does not fix E-1** — per-cycle
extraction scales with the step (1.7 % of NAV at 500 bps → 0.08 % at 23 bps) while the **ratio stays s/φ = 3.3×** at
2 %; a slow follower only turns a jackpot into a drip.

### 1.5 Recommendation (band + primitive)

1. **Read the reference from the previous block for every mark.** Store `refPrev` (the value before the current
   block's step) and price deposits at `max(V(spot), V(ref), V(refPrev))`; check the deploy band against `refPrev`.
   This removes the atomic E-1 (a same-block dump cannot move the mark) and restores the band to one step. Cheap:
   one extra storage slot, appended after `lastKnownIdle`.
2. **Refuse deposits when `|spot − refPrev| > band`** (deposits are not the availability-critical path; withdraw stays
   ungated). A dumped pool then cannot accept entries until the follower has been walked, which forces the multi-block
   held dump (visible; arb-exposed; `setPaused`-able).
3. **Time-based step, decoupled from the deploy band**: `followRate` ≈ **23–50 bps of √P per 12 s** (2× in
   15–30 min) with `Δt_max = 5 min`; keep the **deploy band at 300–500 bps** (griefing cost `φ·R·b` per block is
   harmless and the sandwich is bounded by `d²`). Legit deploy latency after a real 2× move: 15–30 min — acceptable
   (the cron retries).
4. Accept and state the residual: on a **single-venue** pool with no arbitrage a patient attacker keeps ratio ≈ s/φ
   over a multi-block walk. That residual is closed by **share** (s ≤ ~0.5 %) or by **arbitrage presence**, not by
   depth (§3.4).

---

## 2. Q2 — `MAX_DEPLOY_BPS` calibration

### 2.1 Depositor NAV vs price (balanced deploy at the cap, ±22 980 ticks: Pa = 0.1005, Pb = 9.95)

`NAV(P) = (1−c)·Pr + V(L(q), P)`, `q = c·Pr`, the owner's matched paired leg counted as depositor NAV.
Sim (`test_Q2_navVsPrice_matchesModel`, 100 k principal, 50 k/50 k deploy): P = 0.5 → **118,720** (model 118,720);
P = 0.3 → **100,025** (100,026); P ≤ Pa → **70,747** (70,872); P = 2 → **187,440** (187,440).

| P | LP value V (per 100 principal) | NAV % principal | NAV % of NAV-at-deploy | paired leg / quote leg |
|---|---|---|---|---|
| 0 | 0 | **50** | 33.3 | all paired |
| 0.1005 (= Pa, −90 %) | 20.9 | **70.9** | 47.3 | all paired |
| 0.2 | 37.6 | 87.6 | 58.4 | 2.95 |
| **0.30** | 50.0 | **100.0 — principal floor** | 66.7 | 1.96 |
| 0.5 | 68.7 | 118.7 | 79.2 | 1.41 |
| 1 | 100 | 150 | 100 | 1.00 |
| 2 | 137.4 | 187.4 | 125 | 0.71 |
| 4 | 176.8 | 226.8 | 151 | 0.44 |
| ≥ 9.95 (= Pb) | 207.7 | 257.7 | 172 | all quote |

| cap c | principal floor price | max loss % principal (P→0) | max loss % of NAV-at-deploy |
|---|---|---|---|
| 0.2 | 0.30 | 20 | 33.3 |
| 0.3 | 0.30 | 30 | 46.2 |
| 0.4 | 0.30 | 40 | 57.1 |
| **0.5** | **0.30** | **50** | **66.7** |

Three facts fall out. (i) The cap **is** the maximum principal loss (`P → 0` wipes the quote leg; nothing else can).
(ii) The principal floor price (**−70 %**) is **independent of c** — it is where `V(P) = q`, i.e. where the owner's leg
stops covering the quote-leg IL; below it depositors lose `q − V(P)`, at the range floor 29 % of principal at c = 0.5.
(iii) Because the owner's leg is depositor NAV, **NAV volatility is 2× the principal exposure** (F-03's 66.7 %) and the
LP leg is the manipulation surface (§3): `ΔV = (1+ρ)·q·g`.

### 2.2 Should the cap also bound the paired leg / total LP value?

Yes, but not by value — by **composition**. A balanced in-range mint fixes the paired leg from `q` and the price:
`ρ = pairedValue/quoteValue = (√P − P/√Pb)/(√P − √Pa)` — 1.0 at centre, **1.6 at P = 0.4, 2.95 at P = 0.2, ∞ at the
floor; 0.71 at P = 2, 0 at the ceiling**. Two consequences the cap does not see:
- A deploy near the **lower** edge puts up to 4× the quote leg into a paired-heavy position — depositors' *marked* NAV
  is then dominated by the owner's gift and swings with it (§5), and the manipulation surface `ΔV` grows with `1+ρ`.
- A deploy at/above the **upper** edge is **all quote and needs no owner capital at all** — the invariant-15 path (§7).

A `MAX_LP_VALUE_BPS` on NAV would bite only off-centre (a balanced deploy at c = 0.5 is 66.7 % of NAV by
construction), so the cleaner primitive is a **two-sided-deploy check on the amounts actually used**:
`pairedUsedValueAtSpot ∈ [½, 2]·quoteUsed` (equivalently `P ∈ [0.40, 2.49]·P_centre`). It costs one multiplication,
needs no new price source, structurally blocks single-sided deploys, and bounds `ρ ≤ 2` so LP value ≤ 3q.

### 2.3 Is 50 % the right constant?

The fee case for the product needs LP exposure; the loss case is `c` of principal in a wipe and `0.58c` at the range
floor. With the owner leg covering to −70 %, **50 % is defensible for a curated pool with a plain token** — the
Round-2/3 attacks that reached 67–80 % of principal were the marked-value cap (closed) and the all-quote deploy (E-3,
§7), not the constant. Lowering the constant helps linearly (c = 0.3 → 30 % worst case) while the E-3 path scales
with `q` too (E-3 is 52 % *of q*). Recommendation: **keep 5000 as the immutable ceiling**; add an owner-settable
`deployRatioBps ≤ MAX_DEPLOY_BPS` on-chain (instant decrease, 48 h-timelocked increase) so the off-chain
`LP_GATEWAY_DEPLOY_RATIO_BPS` posture is enforced where a compromised cron cannot bypass it; **ship the two-sided
check (§2.2)**. A constant beats a timelocked *ceiling* because the ceiling is the one number depositors are told.

---

## 3. Q3 — Thin-pool manipulation cost model

### 3.1 Closed form

Inputs: attacker capital `K`, in-range liquidity `L` (`R = L√P₀`), gateway share `s = q/R`, fee `φ`, band/step `b`,
blocks `n`, arbitrage intensity `α ∈ [0,1]` (fraction of the displacement other traders undo per block), paired ratio
`ρ` (1 balanced), cap `c`, attacker deposit `D`.

```
NAV      = q/c + ρ·q                       (idle + LP, owner leg included)        [= 3q at c=½, ρ=1]
V        = (1+ρ)·q
dump x   : √P → 1/√x ;  d = 1 − 1/√x      (one step ⇔ d ≤ b ⇔ x ≤ 1/(1−b)² = 1.108)
g(x)     = 1 − V(1/x)/V(1)  ≈ 0.96·d  (small d) … 0.79 at the range floor
ΔV       = V·g(x)                          (LP mark-down the mark inherits once the follower is on spot)
blocks   n = 1 if d ≤ b (same-block snap) else ⌈ln√x / −ln(1−b)⌉
gain(D)  = D·ΔV / (NAV − ΔV + D)           (→ ΔV as D→∞;  ≈ ΔV/2 at D = NAV)
cost     = φ·R·(x−1)/√x                    (dump + re-buy fees, no arbitrage)
         + (n−1)·α·R·(√x−1)²/√x            (inventory lost to arbitrage per held block; 0 for the atomic snap)
capital  K = D + R·(√x−1)                  (paired inventory at fair, or the quote to re-buy it)
ratio    = gain/cost  →  s·(1+ρ)·g(x)·√x / (φ·(x−1))  · D/(NAV−ΔV+D)
         ≈ s·(1+ρ)/(2φ) · D/(NAV+D)  =  s/φ · D/(NAV+D)      for small steps, ρ = 1
```

Deploy-band leg (§1.3): `gain_sandwich ≈ ΔL·d²/(1+d)² − 2φ·R·d`, `ΔL/L ≈ 1.46·q_new/R`, profitable iff
`ΔL/L > 2φ/d` (12 % at one step, 6 % at two).

**What the formula says.** `R` cancels out of the ratio. Depth fixes the ticket size (`K ≈ 0.05R + D` for a snap,
`0.41R + D` for a 2× walk) and the absolute prize (`ΔV = 2sR·g`), never the return on cost. The return on cost is the
gateway's share of the pool divided by the fee tier: the attacker pays fees on the whole pool's displacement and
harvests the gateway's slice of it. Arbitrage (`α`) is the only term that grows with time — and it is zero for the
atomic one-step snap.

### 3.2 Validation at the policy thresholds (sim vs model)

| Case | Model gain / cost / ratio | Sim | Verdict |
|---|---|---|---|
| R5 depth 250 k, R8 share 2 %, one step, D = NAV (15 k) | 257 / 77 / **3.3×** | alice −252, attacker **+176** net, 167 bps of NAV | **profitable at both policy limits** |
| harness 2.35 M, 4.3 %, one step, D = NAV | 5,188 / 723 / 7.2× | −5,038 / **+4,329** | ✓ |
| harness, 2× walk (7 blocks), D = NAV | 35,228 / 4,987 / 7.1× | −34,920 / **+29,928**, cost 4,992 | ✓ |
| reference 14 M, 2 %, one step, D = NAV | 14,401 / 4,316 / 3.3× | (scale-invariant: same ratio as above) | profitable |
| reference, 5 % running share, one step | 36,003 / 4,316 / **8.3×** | — | profitable |
| deploy sandwich, 2 % share, 2 steps | −817 | **−770** | R8 holds for this vector |
| deploy sandwich, 10 % share, 2 steps | +1,081 | **+1,020** | needs > 6 % share |

### 3.3 Where R5 / R8 are wrong

- **R5 (min depth 250 k) is not a manipulation-resistance control.** It bounds the attacker's *ticket* (~30 k for a
  snap, ~120 k for a 2× walk at 250 k) and the absolute prize, and it does make the *victim-side* RT-1a sandwich
  smaller per unit of pump — but every ratio above is identical at 250 k and at 14 M. Keep it for its real purpose
  (execution quality, RT-1a magnitude, `minLiquidity` sanity), not as the manipulation backstop the policy §1 says
  it is.
- **R8 (share ≤ 2 % at deploy / 5 % running) is 3–6× / 8–16× above the no-arbitrage break-even** (0.31–0.60 % one
  step; 0.34–0.61 % at 2×). The threshold that would make the deposit-side mark unprofitable on a single-venue pool
  is **s ≤ 0.3–0.5 %** at φ = 0.30 % (0.1 % at φ = 0.05 %; 2 % only at a 1 % fee tier — which policy §3 rightly avoids
  for other reasons). R8 *is* adequate for the deploy-band sandwich (needs > 6 %).
- **The missing precondition is arbitrage presence.** With `α ≈ 1` a single held block at one step costs 0.28 % R
  against a gain of `0.05·s·R`, i.e. break-even at **s ≈ 5.6 %** — so on a *multi-venue* pool a walk of any length is
  unprofitable at R8's limits, and only the atomic snap (E-1) survives, which the code fix removes. Add to the policy:
  *the paired token must have a second liquid venue (another pool / CEX) with observed arbitrage, or the third-party
  share cap drops to 0.5 %.*
- **R8 is measured on the quote leg.** The manipulation surface is `(1+ρ)·q`; a deploy at P = 0.4 (ρ = 1.6) has
  2.6× the surface of the same `q` at centre. Measure the share on **total LP value**, or enforce the two-sided check.

### 3.4 Recommended thresholds

| Control | Today | Recommend | Why |
|---|---|---|---|
| R5 min virtual reserve | 250 k USDG | keep 250 k; first mainnet 1 M | ticket size / RT-1a; not a ratio control |
| R8 share at deploy (third-party funds) | 2 % of quote reserve | **≤ 0.5 % of R on LP value** until E-1/E-3 code fixes land, then 2 % | break-even 0.31–0.60 % |
| R8 running share | 5 % | **≤ 2 %** (pause deposits above) | 5 % is 8–16× break-even |
| New R10 — arbitrage presence | — | second venue with observed arb, or the 0.5 % cap applies | `α` is the only time-cost term |
| Fee tier | 0.30 % | keep; never list 0.05 % pools for third-party funds (break-even 0.1 %) | ratio ∝ 1/φ |

---

## 4. Q4 — Pro-rata exit composition risk

### 4.1 Why RT-1b/1c/1d fail (and keep failing)

For a pro-rata slice of liquidity `f·L` taken at price `P₁` and valued at fair `P₀`: `slice(P₁)@P₀ − f·V(P₀) =
f·L·(√P₁−√P₀)²/√P₁ ≥ 0` — any displacement at exit time hands the *withdrawer* the un-arbitraged composition, which
is worth **more** at fair (sim: victim value 150,184 vs 150,000 fair after a one-step dump). Sandwiching a withdrawer
transfers value from the manipulator to the victim. There is no residual there; `withdrawWithMin` protects
*composition*, not value.

### 4.2 The residual that exists: the re-credit weight (E-2)

`reCredit = shares·(claim − delivered)/claim`, `claim = f·idle + f·V(spot_cached)`, `delivered = idleGot + LP slice at
spot_cached`. The LP terms cancel; the idle shortfall `X = f·idle − idleGot` does not — and it is divided by a
spot-marked claim. A withdrawer who **dumps first** shrinks `f·V(spot)` and is re-credited more shares for the same `X`:
`reCredit_manip/reCredit_fair = (idle + V)/(idle + V(1−g)) = 3/(3−2g)` at c = ½ → **+3.49 % at one step, +59.2 % at a
4× dump**, atomic (no follower involved), sized by the shortfall, so the precondition is an idle leg that under-delivers
(Morpho paused / supply-side illiquidity / the adapter's own per-block cap — RT-5a/7d territory).

| x | model excess re-credit | **sim excess re-credit** | first-order gross | **sim: attacker net / co-depositor loss** |
|---|---|---|---|---|
| 1.108 | +3.49 % | **+3.42 %** (34,472 vs 33,333 shares) | 1,744 (fees 723) | **+571 / −1,271 (0.84 % of her claim)** |
| 4.0 | +59.2 % | **+59.2 %** (53,079) | 29,619 (fees 10,585) | **+8,868 / −19,349 (12.9 %)** |

The share count matches the model exactly; the *value* transfer is 25–35 % below first order because the
manipulator's own dump/re-buy straddles the removal of its slice (the RT-1b effect, now working against it). Model
ratios at other points: 1.1× (2 % share, f = ½, one step) … 5.9× (5 %, f = 0.9, 4×). At the policy limits it is
marginal-to-positive; with a large exiting holder and a stalled source it is a clean drain of the co-depositors.

### 4.3 Floors, multi-block, and the E-4 liveness wart

- **Loose floors.** The composition sensitivity is `Q = L(√P−√Pa)` → **−3.6 % quote / +7.5 % paired per one-step
  dump** (sim 96,413 / 53,771 vs 100 k / 50 k expected). A 10 % floor passes it, a 1 % floor reverts it
  (`test_Q4_victimComposition_floors`). Since value is never below fair, the floor's job is to stop a user receiving
  meme inventory they must sell into the same manipulated pool.
- **Multi-block held positions** add nothing: the exit reads spot once and only as a weight; holding changes the IL
  outcome, not the pro-rata slice.
- **E-4.** After any off-unity-price exit the delivered legs round a few wei under the marked claim (sim: alice keeps
  **25,794 wei** of shares). The next holder to exit *all* their shares is then not `lastHolder`, and
  `toAssets(shares, liq, ts, VIRTUAL)` requests **more liquidity than the position holds** (73,203,416,798,420,612,240,609
  vs 73,203,416,798,420,611,991,526) whenever `totalShares > liquidity` in raw units → v4 `SafeCastOverflow` → LP leg
  re-credited, idle-only payout, deterministic on retry. `withdraw(shares − 1e12)` works. No value at risk; a UI that
  calls `withdraw(sharesOf(user))` will show "LP leg unavailable" to the second-to-last big holder for as long as dust
  holders exist. Fix: `liqToRemove = min(liq, mulDiv(shares, liq, ts))` — liquidity is not donation-exposed and does not
  need the offset.

### 4.4 Recommendations

1. **Re-credit weight at `max(V(spot), V(ref), V(refPrev))`** (the conservative direction for a re-credit is a *high*
   LP mark → fewer shares), and compute the idle and LP re-credits per leg (`shares·w_idle·X/fromIdle` and
   `shares·w_LP` when the LP leg failed) so the LP delivery never enters the weight. Removes E-2 except via a walked
   follower (multi-block, arb-exposed).
2. **UI floor defaults: 1 % on both legs**, computed from a dry quote of the pro-rata legs at spot; surface the quote
   floor as the one that matters ("you will receive at least X USDG"). Offer 0.5 % for deep pools; never default
   above 2 %. The value is ≥ fair regardless; the floor bounds composition.
3. Fix E-4 with the `min(liq, ·)` clamp (Low).

---

## 5. Q5 — Owner-subsidy accounting

### 5.1 How the paired leg flows (model = sim)

| Step | alice claim | bob claim | NAV | who moved |
|---|---|---|---|---|
| alice deposits 100 | 100 | — | 100 | |
| owner deploys 50 q + 50 p (owner's paired) | **150** | — | 150 | **the whole 50 accrues to the holder at deploy time** |
| bob deposits 100 at NAV 150 | 150 | 100 | 250 | bob buys 40 % of the pool at par — no subsidy |
| price −50 % (LP 100 → 68.7) | **131.2** (sim 131,232) | **87.5** (sim 87,488) | 218.7 | bob carries IL on a paired leg he never received |
| (instead) price +100 % | 172.5 | 115 | 287.4 | bob's upside is on his own money only |

Capture is by **share ownership at the block of deploy**, realised on exit, pro-rata; withdrawals leak it immediately
(F-01a: alice exits with 150 k on 100 k). Later depositors pay for it at NAV and hold its IL; the owner has no claim.
For own funds it is a bookkeeping choice; for third-party depositors it is (a) an unpriced transfer between cohorts,
(b) a NAV that overstates principal by up to 50 %, (c) 2× the manipulation surface (`1+ρ`), and (d) the reason the
seat's *cheapest* extraction is the leg it does not have to fund (§7).

### 5.2 On-chain shapes

| Shape | Mechanics | Pros | Cons |
|---|---|---|---|
| **A — owner shares** (recommended) | At `deploy`, mint the owner `sharesOwner = toShares(pairedValue, S, NAV)` for the paired leg, **valued at `min(V(spot), V(ref), V(refPrev))`** (conservative for depositors; the band already bounds it to ≤ 1–2 steps); owner exits through the same pro-rata `withdraw`, optionally under a cliff (no owner exit for N blocks). | NAV/share unchanged at deploy (no cohort transfer); owner bears its own IL; `sharesOf`/`totalShares` machinery unchanged; RT-9c-style mis-deploys now hurt the seat's own shares; principal definition untouched (cost basis is quote-only). | Owner shares are a claim on idle too — on exit the owner takes `f·idle` in quote, converting its paired into depositor quote *at the deploy mark* (bounded by the conservative valuation + the band; a walked mark can over-credit ≤ a few %); owner NAV now visible to depositors (fine — disclose). |
| **B — separate paired claim** | Track `ownerPairedClaim` in paired units; on exit pay the owner from the LP paired leg only. | No claim on idle. | Who bears IL is undefined (a fixed paired claim is a senior/junior tranche in disguise — the legal item /legal flags); accounting on partial exits is intricate; a new code path in the money-critical exit. |
| **C — explicit subsidy** (status quo, disclosed) | Keep the gift, account `subsidyPaired`, show NAV-ex-subsidy and principal separately, warn later depositors. | Zero code in the exit path; simplest for own funds. | Cohort transfer remains; 2× manipulation surface remains; needs the two-sided check to stop E-3 anyway. |
| **D — fund the paired leg from depositor quote** | `deploy` pulls `2q'` from staging and swaps half in-pool (the PM already holds the pool key; use `minOut` + band). | No owner capital, no subsidy, LP = depositor capital end-to-end; cap base counts the whole `2q'`. | An on-chain swap inside deploy (slippage, MEV — the band + `minOut` bound it); the cost-basis cap must count both legs; NAV per share unchanged (quote → LP at spot). |

**Recommendation.** Before third-party admission: **A** (owner shares at the conservative mark, exit through the common
path, 48 h cliff on the first owner exit after each deploy) — or **D** if the product wants "no owner capital in the
pool" as a statement. Either way add the **two-sided-deploy check** (§2.2) so the leg the owner *doesn't* fund cannot
become the whole position. Until then, keep C with the NAV-ex-subsidy figure in every surface that shows NAV.

---

## 6. Q4-adjacent: what the floors do **not** cover (summary for the UI team)

| Scenario | Value vs fair | Composition | Covered by `withdrawWithMin` 1 %? |
|---|---|---|---|
| dump → victim withdraws → pump back (RT-1b) | ≥ fair (+0.12 %) | −3.6 % quote / +7.5 % paired per step | yes (reverts) |
| pump → victim withdraws | ≥ fair | +quote / −paired | yes |
| adapter shortfall + withdrawer's own dump (E-2) | co-depositors −0.8…−12.9 % | n/a (attacker is the withdrawer) | **no** — code fix §4.4 |
| all-but-dust holder (E-4) | 0 loss, idle-only payout | LP leg not delivered | no — retry with `shares − ε`; code fix |

---

## 7. Invariant 15 — owner cannot extract principal: enumeration and the number

### 7.1 Every owner-reachable transition

| Transition | Seat | Moves depositor value? | Bound today | Worst case |
|---|---|---|---|---|
| `deploy(q, p, minLiq, dl)` | PM owner | **yes** — `q` leaves the reserve into the pool at the current price | cost-basis cap ≤ 50 % of principal; band vs follower (**not on the first deploy**; 2 steps with a same-block poke); follower walkable by anyone | **E-3: 52 % of q → 25.9 % of principal** (§7.2) |
| `harvest(dl)` | PM owner | fees only (principal untouched, zero-delta decrease) | — | fee stream, not principal |
| `compoundQuote(a)` | PM owner | adds value | — | none |
| `setPaused(bool)` | PM owner | blocks deposits only | withdraw ungated | none (griefing: no new capital) |
| `propose/accept/cancelHarvestRecipient` | PM owner | fee destination after 48 h | timelock | fee stream after 48 h |
| `transferOwnership` / `acceptOwnership` | owner / pending | none by itself | 2-step | race in §8 Q6 (out of scope here) |
| adapter `setPerBlockWithdrawCap` | adapter owner (same seat) | delays idle exits (A-1 re-credits) | none | indefinite soft-lock (RT-7d); no loss |
| adapter `setVault` | adapter owner | one-time | one-way | none once set |
| staging `setController` | deployer | one-time | one-way | none once set |
| factory `createGateway` / `deactivate` | factory owner | none (new instance / flag) | curated | none |
| **no** owner path to `staging.unstage`, `adapter.withdraw`, or the position other than via `deploy`/`harvest` | | | | RT-9d, `test_I15_capBoundsRepeat_FAILS` |

### 7.2 The worst case, quantified (E-3)

Sequence (`test_I15_liveInstance_pumpWalkAllQuoteDeployDump_SUCCEEDS`, harness R = 2.35 M, 200 k principal, 1 k anchor
deploy so the follower exists): buy paired until spot is one tick past the range edge where the position is 100 %
quote (capital **4.76 M**, ~2.16 R); `poke` per block until the band passes (**23 blocks**; model 24); `deploy(99 k, 0)`
— mints an all-quote position, no owner capital; sell the paired back through the pool now deeper by the gateway's
fresh liquidity; a third party restores fair. **Depositor NAV 200,999 → 149,655: loss 51,344 = 51.9 % of q =
25.7 % of principal; the seat's wealth +32,195 after ≈ 20 k of fees.** On a **fresh instance the first deploy has no
band at all — same result in one block, no walk** (`test_I15_freshInstance_*`: loss 51,344, +32,208). A second
attempt is refused by the cap and the seat cannot touch the remaining idle (`test_I15_capBoundsRepeat_FAILS`).

Closed form: the position `L_g = q/(√Pb − √Pa)` buys paired all the way down from Pb to P₀ and ends worth
`L_g(2√P₀ − √Pa − P₀/√Pb) = 0.481·q` → **loss = 0.519·q ≤ 0.519·c·Pr = 25.95 % of principal**. Seat PnL ≈
`0.519·q − 0.85 %·R` (fees on ~2.16 R of pump volume plus the paired sold), positive iff **s_new > ~1.6 %**.

| Pool | share of fresh deploy | q | blocks | pump capital | depositor loss | **% of principal / NAV** | seat net (no arb) |
|---|---|---|---|---|---|---|---|
| **reference PONS/USDG (14 M)** | 2 % | 280 k | 24 | 30.3 M | 144,295 | **25.8 %** | +25 k (≈ break-even) |
| reference | 5 % | 700 k | 24 | 30.3 M | 358,332 | 25.6 % | **+241 k** |
| harness (2.35 M) | 4.2 % (99 k) | 99 k | 23 (sim) | 4.76 M (sim) | **51,344 (sim)** | **25.7 %** | **+32,195 (sim)** |
| **policy minimum (250 k)** | 2 % | 5 k | 24 | 540 k | 2,577 | **25.8 %** | +448 |
| policy minimum | 5 % | 12.5 k | 24 | 540 k | 6,399 | 25.6 % | +4,300 |

"NAV" here is principal (nothing else deployed); with an existing balanced position the same `q` costs the same
absolute amount, a smaller % of the (subsidy-inflated) NAV. **Single number: 25.8 % of NAV, on the reference pool and
on the policy-minimum pool alike.** It is the second-largest owner-side number in the programme (RT-9b's 80 %/71 % on
the marked-value cap is closed; this one is open) and it needs no crash, no hostile issuer, and — on a fresh instance —
no patience.

### 7.3 Reconciliation with RT-9b / RT-9c and the fix

- **RT-9b** (80 % deployed / 71 % extracted) was the marked-value cap re-opening; the cost-basis cap closed it
  (`R2_RT9a_crashDoesNotReopenDeployCap`, `test_I15_capBoundsRepeat_FAILS`). E-3 lives *inside* the cap.
- **RT-9c** (pump 2×, walk, balanced deploy, dump: depositors −3.16 % of NAV, owner net negative) is the
  **two-sided** variant. Modelled: for a balanced deploy walked to `P₁` and returned to fair, depositor loss/q =
  4.5 % (P₁ = 1.5), **11.1 % (P₁ = 2)**, 16.9 % (2.5), 31 % (0.5), 68 % (0.4); the seat's PnL ≈ loss − p − fees is
  **negative whenever the paired leg is funded** (−0.25 q at P₁ = 2) and turns positive only past P₁ ≈ 3.5 where
  ρ < 0.5. RT-9c's 3.16 % of NAV ≈ 11 % of the 20 k it deployed — consistent.
- **Fix:** the **two-sided check `ρ ∈ [½, 2]` on the amounts used** (§2.2) makes every owner path RT-9c-shaped:
  owner-negative, depositor griefing ≤ **5.5 % of principal** (11 % of q at the ρ = 0.71 bound; 16.9 % of q → 8.4 % at
  ρ = 0.62 if the band is set at [0.4, 2.5]). With `refPrev` (§1.5) the band is one step again and the first deploy
  should require `minLiquidity > 0` **and** be limited to a small `q` (e.g. ≤ 5 % of the cap room) so an un-banded first
  deploy is never the big one.

---

## 8. Recommendations — consolidated

**Code (before third-party funds):**
1. `refPrev` for the deposit mark and the deploy band (kills E-1 atomic, restores a one-step band) + refuse deposits
   when `|spot − refPrev| > band`. *(E-1, E-3 partial)*
2. Time-based follower step decoupled from the deploy band: `followRate` 23–50 bps √P per 12 s (`Δt_max` 5 min);
   `deployBandBps` 300–500. *(Q1)*
3. Two-sided-deploy check `pairedUsedValue ∈ [½, 2]·quoteUsed`; first deploy capped small. *(E-3 → ≤ 5.5 % griefing,
   owner-negative)*
4. Re-credit weight at `max(spot, ref, refPrev)`, per-leg re-credit. *(E-2)*
5. `liqToRemove = min(liq, mulDiv(shares, liq, ts))`. *(E-4)*
6. Owner shares for the paired leg at `min(spot, ref, refPrev)` with a cliff (shape A), or fund the paired leg from
   depositor quote (shape D). *(Q5)*
7. Keep `MAX_DEPLOY_BPS = 5000` constant; add `deployRatioBps ≤ 5000` on-chain, instant down / 48 h up. *(Q2)*

**Policy (now):**
- R8: third-party share **≤ 0.5 % of R on total LP value** until items 1–4 land; running share ≤ 2 % (pause above).
- New rule: **arbitrage presence** (second venue) for any third-party pool, else the 0.5 % cap.
- Keep R5 = 250 k (1 M first mainnet) but stop describing depth as the manipulation backstop; the backstop is share ×
  fee tier × arbitrage.
- Never list 0.05 % / 0.01 % tiers for third-party funds (break-even share 0.1 %).

**UI:** `withdrawWithMin` floors default **1 % / 1 %** (0.5 % deep pools, never > 2 %); `depositWithMin` at 1 % of the
dry-quoted shares (RT-1a); show NAV-ex-subsidy next to NAV until Q5 is fixed; handle E-4 by retrying with `shares − ε`.

---

## Appendix A — Model ↔ simulation reconciliation

| Quantity | Model | Simulation | Δ | Test |
|---|---|---|---|---|
| blocks to walk 2× (dump) | 7 | 7 | 0 | `test_Q1_walkFollower2x` |
| 2× walk round-trip cost (harness) | 4,987 | 4,992 | +0.1 % | same |
| 2× walk extraction, D = NAV | 35,228 | 34,920 | −0.9 % | same |
| E-1 one-step extraction, harness | 5,188 | 5,038 | −2.9 % | `test_E1_sameBlockSnap_dumpPokeDeposit` |
| E-1 attacker net, harness | 4,465 | 4,329 | −3.0 % | same |
| E-1 extraction, policy-min 2 % | 257 | 252 | −2 % | `test_E1_sameBlockSnap_policyMinDepth` |
| E-1 shares over fair | +3.5 % | +3.41 % | | same |
| E-1 without poke | 0 | 0 (attacker −fees) | | `test_E1_control_noPoke` |
| deploy sandwich PnL, 10 % share, 2 steps | +1,081 | +1,020 | −5.6 % | `test_Q3_deploySandwich_…10pct` |
| deploy sandwich depositor loss | 2,175 | 2,571 | +18 % | same |
| deploy sandwich PnL, 2 % share | −817 | −770 | | `…2pctShare_FAILS` |
| Q2 NAV at P = 0.5 / 0.3 / Pa / 2 | 118,720 / 100,026 / 70,872 / 187,440 | 118,720 / 100,025 / 70,747 / 187,440 | ≤ 0.2 % | `test_Q2_navVsPrice` |
| Q4 excess re-credit, one step / 4× | +3.49 % / +59.2 % | +3.42 % / +59.2 % | | `test_Q4_recreditWeight_*` |
| Q4 net transfer, one step / 4× | 1,744 / 29,619 (first order) | 1,271 / 19,349 (attacker net 571 / 8,868) | −27 % / −35 % (second-order slice effect; sim binds) | same |
| Q4 composition per step | −7.3 % quote-leg | −3.6 % total quote (idle dilutes), +7.5 % paired | | `test_Q4_victimComposition_floors` |
| Q5 alice / bob after −50 % | 131,232 / 87,488 | 131,232 / 87,488 | 0 | `test_Q5_subsidy_*` |
| Inv-15 loss (harness, q = 99 k) | 50,767 (51.3 % of q) | 51,344 (51.9 %) | +1.1 % | `test_I15_liveInstance_*` |
| Inv-15 blocks / seat net | 24 / +30,975 | 23 / +32,195 | | same |
| Inv-15 fresh instance | 1 block, same loss | 0 walked, 51,344 | | `test_I15_freshInstance_*` |
| E-4 overshoot | `shares(liq+v)/(ts+v) > liq` iff `ts > liq` and co-holder dust | requested 73,203,416,798,420,612,240,609 vs 73,203,416,798,420,611,991,526; `SafeCastOverflow` caught | | `test_E4_*` |

## Appendix B — Files

- `scripts/audit3/econ_models.py` — all formulas + tables (`--json` for machine output).
- `contracts-v4/test/audit3/EconBase.sol` — rig (limit swaps, follower probe at slot 7, external depth).
- `contracts-v4/test/audit3/EconFollower.t.sol` (6) · `EconExit.t.sol` (5) · `EconOwner.t.sol` (3) ·
  `EconSubsidyIl.t.sol` (2) — 16 fork tests, all `[PASS]` on 2026-09-08 against
  `https://rpc.testnet.chain.robinhood.com` (fork block ≈ 115.60 M).
- Prior numbers reconciled: [`2026-09-08-redteam-onchain.md`](../2026-09-08-redteam-onchain.md) RT-1a (12.9 k / 153,
  victim-side — unchanged, `depositWithMin` covers it), RT-1e, RT-3a (+12 on 20 k = 6 bps; here +1,020 on 221 k = 46 bps
  with the poke-widened band), RT-3b, RT-9a/9b (closed by the cost-basis cap), RT-9c (owner-negative two-sided variant,
  −3.16 % NAV = ~11 % of q — consistent with §7.3).
