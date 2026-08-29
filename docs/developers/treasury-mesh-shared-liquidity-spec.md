# Treasury Mesh — Shared Liquidity Network (Spec v0.1)

> **Status: design spec, pre-build, testnet+audit-gated.** Nothing here is live. This is the synthesis of a
> 5-track research effort (prior art · risk/adversarial · economics · legal · architecture). It is a
> foundation spec — the parameters are defaults to tune, and an external securities/fintech counsel +
> smart-contract audit are hard gates before any mainnet, real-value launch.
>
> **Naming.** Public product surface = **Treasury Mesh**; the mechanism = **Liquidity Mesh** (on-demand /
> JIT liquidity). Avoid "Yield Payment Network" for *this* feature — it pairs the two legally radioactive
> words (yield + deposit-flavoured "payment"). The pillar **"Never idle. Never locked. Always yours."**
> stays — it promises control + availability, never a return (just never restate "never idle" as "always
> earning"). See §7.

---

## 1. What it is (one paragraph)

A team's **idle treasury runway** (senior USDC/ETH, held in a Mintware YPN vault) is deployed as
**just-in-time liquidity into *other* teams' Uniswap-v4 trading pairs**, earning those pairs' trading
fees + recaptured MEV — while **staying safe to spend at par for its owner**. Safety comes from
**tranching**: the deployed capital is always **senior** (par-protected, price-free NAV); the borrowing
team posts its **own token as junior** (first-loss, absorbs impermanent loss / LVR). Recall is a JIT
unwind + an always-liquid hot buffer, utilization-bounded. It is the network-scale generalization of the
single-vault "spend the yield, never un-park the position" engine Mintware already runs.

**The worked example.** Team A has $100k idle in Mintware. Team Shib's pair needs ~$30k more depth.
The mesh routes $30k of A's senior into Shib's pair as JIT liquidity; it earns Shib's swap fees; Shib's
own token is the first-loss buffer; A recalls it at par when A wants to spend. A's runway was never idle,
never locked, and never stopped being spendable.

**Why it's novel** (prior-art track). No system combines all three legs. Closest analogues did parts:
**Fei × Ondo "Liquidity-as-a-Service"** matched a project's token with stablecoin and let the project keep
fees + eat IL — but *locked* the capital (sunset 2022 on yield compression, not a hack). **Tokemak** proved
"direct shared liquidity to where it's needed" but died on **yield attribution** (paid emissions, not real
fees). **Uniswap v4 singleton + flash accounting** is the substrate that makes one buffer serve many pools
atomically. Treasury Mesh = *Fei/Ondo LaaS + CLO tranching + v4-JIT + a par-spendable recall layer*, aimed
cross-team. Each ingredient is proven; the **assembly, and the spendable-while-deployed senior, are new.**

---

## 2. The three parties

| Party | Brings | Gets | Tranche |
|---|---|---|---|
| **Supplier** (team with idle runway) | senior USDC/ETH | base idle yield + rental coupon + fee kicker; **capital stays par-spendable** | **Senior** (par, protected) |
| **Borrower** (team needing pair depth) | its own token as first-loss + a rent coupon (mostly paid out of the fees the depth earns) | on-demand depth, no dilution, no emissions, no MM options | **Junior** (first-loss, absorbs IL/LVR) |
| **Mintware** | the software/rails | a flat ~10% facilitation take, scales with the book | facilitator, never a counterparty |

---

## 3. The universal spend rule (the foundation this plugs into)

Every spend path — cards, vendor pay, payroll, and mesh recalls — sizes its spend through **one shared
computation**, never a per-rail limit. Spendable is the intersection of four gates:

```
spendable(party) = min(
   OWNERSHIP    your own realizable claim (your senior shares) — never anyone else's, never community-matched principal
   SOLVENCY     max(0, NAV − senior_par × OC_trigger)   ← CLO overcollateralization test: junior spends only the surplus keeping senior whole
   LIQUIDITY    NAV − deployed/JIT'd − hot-buffer reserve   ← Aave-style: deployed capital reduces live liquidity, NOT ownership
)                                                            then capped by role/policy (governance)
```

This one rule auto-answers every case with no special-casing:
- **Own single-owner treasury** → you own it all, drain it (bounded by liquidity + policy).
- **30/70 matched LP** → community's 70% senior is untouchable; the team's junior is locked/subordinate; only the **residual yield** above senior coverage is spendable.
- **Mesh-deployed** → deploying $30k into Shib's pair doesn't change A's ownership; it lowers A's *live liquidity*; the LIQUIDITY gate accounts for recall exactly like Aave utilization.

It is **already enforced** at the contract (`burnForPayment` burns only your own senior shares) and in
edge-auth (`ledger::available = min(equity(seniorShares[you]), cap_room, liquidity)`), and edge-auth's
`portfolio_available` already spans **multiple legs** — a "leg" is precisely "a slice deployed into pair B."
The engineering task is to funnel *every* rail (starting with vendor pay/payroll) through this one function.

---

## 4. Safety model (the bulletproof core)

The whole safety problem reduces to: **is the borrowing pair's junior always thick enough, and the
supplier's exposure always short enough, that a token crash can never eat senior principal before recall
completes?** Answer: yes — provably for the right tiers/modes.

### 4.1 Risk tiers (curator-assigned, Morpho-curator model)

| Tier | Examples | `LGD₉₉(H)` | junior haircut `h_J` | `OC_trigger` | **min junior thickness `J/S`** | max % of one treasury into pair | deploy mode |
|---|---|---|---|---|---|---|---|
| **A** blue-chip | ETH, wBTC | 0.10 | 0.10 | 1.10 | **≥ 12%** | 25% | standing allowed |
| **B** established | listed L1/L2 | 0.30 | 0.25 | 1.25 | **≥ 50%** | 10% | JIT-preferred |
| **C** meme/thin/new | new team tokens | 0.60 | 0.50 | 1.50 | **≥ 180%** (junior > senior) | 3% | **atomic JIT only** |

Min-thickness formula: `J/S ≥ OC_trigger · LGD₉₉(H) / (1 − h_J)`. Every knob is keyed to tier — thin/meme
pairs need a junior that *exceeds* the senior they protect, tiny concentration, and can only be funded
atomically (in-and-out within one swap). Per-tier book cap ≤ 30% of a treasury across all Tier-C.

### 4.2 Per-pair coverage test (CLO O/C, enforced every block)

```
OC_i = V_J,i / SS_i  ≥  OC_trigger_i          where SS_i = S_i · LGD₉₉,i(H)  (stressed senior shortfall)
V_J   = junior marked at TRUNCATED oracle price p̂ × (1 − h_J)   ← never raw spot (kills the Gamma-style manipulation)
```

Two enforceable caps fall out: **min junior thickness** and **max senior into one pair given its junior**.
An independent **concentration cap** `c_i` (does not scale with claimed junior) blocks a self-minted junior
from unlocking large senior.

### 4.3 Withdrawal-vs-liquidation buffer (dYdX trick)

Two OC thresholds with a deliberate gap, so a voluntary spend can never itself push a position into
liquidation:

| Tier | `OC_withdraw` (spend/recall allowed only above) | `OC_liq` (forced junior seize + unwind below) |
|---|---|---|
| A | 1.15 | 1.05 |
| B | 1.30 | 1.12 |
| C | 1.60 | 1.30 |

### 4.4 Isolation (Morpho-style) — mandatory

Each *(supplier treasury × borrowing pair)* is its **own isolated market**. A loss in pair *i* can reduce
only pair *i*'s junior → optional pair-scoped insurance → (provably never, under §4.6) pair *i*'s senior.
It can **never** touch another lender's senior/junior, nor any treasury's undeployed hot buffer.
**Cross-lender contagion = 0.** (Isolation does *not* solve *correlation* — a supplier in 10 meme pairs that
crash together sees its own reduced spendability, managed by concentration + per-tier book caps.)

### 4.5 Toxic flow / LVR — junior bears it, via a directional surcharge

The arb/gap-closing swap only (identified vs the truncated oracle) pays an extra fee `β` (Diamond-LVR),
which accrues **senior-first**. Waterfall per JIT fill: base fee + surcharge → senior; residual LVR →
junior; senior only in a bounded per-swap tail that §4.6 makes unreachable under the tier params.
Atomic JIT caps a thin pair's LVR exposure at one swap.

### 4.6 Insolvency waterfall + when senior loss is *provably impossible*

```
1. directional surcharge + accrued fees (pair i)      ← toxic-swap recapture
2. junior principal J_i (borrowing team's token)      ← first-loss, seized at OC_liq
3. pair-i-scoped insurance slice (optional)
4. senior S_i                                          ← target: UNREACHABLE
5. treasury's hot buffer / other pairs                ← NEVER (isolation)
```

Senior loss is **provable-impossible** iff all three hold: (1) bounded exposure per interval
(`maxLoss_i(H) ≤ V_J,i`); (2) bounded realized move — **atomic JIT** (exposure = one swap) *or*
truncated-oracle-gated + per-block notional cap; (3) guaranteed recall within `H` (hot buffer alone funds
the unwind; recall is permissionless). Tier A/B and atomic-Tier-C meet all three → provable. **The system
refuses any configuration where senior safety would be only probabilistic** (e.g. standing deployment into
a token that can gap past `LGD₉₉(H)` faster than recall) — that's what the tier→deploy-mode mapping enforces.

### 4.7 Governance / abuse defenses

- **Junior lock ≥ senior deployment + `H` (plus cliff)** — the borrower cannot withdraw junior while any
  senior is deployed against it. Self-dealing exit impossible. (Matches the ≥90-day matched-vault cliff lineage.)
- **Wash-trading pays senior, doesn't extract it** — self-swap fees still accrue senior-first; but exclude
  self-swaps (taker == junior owner / linked address) from the pair's *advertised APR / reputation signal*,
  cap credited APR per pair, flag anomalies → allocation freeze, require organic-volume (unique-taker) to
  graduate from Tier C.
- **Sybil pairs share an allocation budget** (same deployer / same-block LP / shared funding).
- **Reputation firewall** — no reputation/attribution signal is ever a *required* input to a solvency or
  spendability decision (it may tier *pricing* only).

### 4.8 The eight safety invariants (must ALWAYS hold)

- **INV-1 Par coverage:** ∀ deployed pair *i*: `OC_i ≥ OC_liq_i`; on breach → auto junior-seize + unwind.
- **INV-2 Safe spend:** a spend/recall executes only if post-action `OC_i ≥ OC_withdraw_i` for every affected pair.
- **INV-3 Isolation:** loss in pair *i* ⇒ ΔS_j = ΔJ_j = 0 for all j≠i, and Δ(hot buffer) = 0.
- **INV-4 Liquidity floor:** `deployed ≤ U_max·T`; hot buffer `B_hot ≥ max((1−U_max)·T, q₉₉(outflow over H), largest committed spend)`; hot buffer **never deployed**.
- **INV-5 Junior-first & bounded:** loss order = surcharge/fees → junior → insurance → senior; `maxLoss_i(H) ≤ V_J,i` by construction.
- **INV-6 No manipulable mark:** every solvency-relevant valuation uses truncated-oracle `p̂` + haircut, never raw spot; deployment blocked when `|spot − p̂| > Δ_tick`.
- **INV-7 Junior lock:** junior withdrawable only when zero senior is deployed against it, plus cliff.
- **INV-8 Reputation firewall:** no reputation signal is a required input to any solvency/spendability decision.

**The single irreducible residual risk:** **recall liveness within `H`** (keeper + chain availability).
Mitigate by sizing `B_hot` to fund a congested block window with zero unwinds, and permissionless recall.

---

## 5. Eligibility & Curation (the top gate — user-set tenet)

**Only vetted, qualifying pairs and verified teams can ever *borrow* mesh liquidity.** A treasury's senior
is never routed into an unapproved / self-serve / unverified token — only blue-chip or mature, established
community pairs that clear the tier bar (junior thickness, depth, oracle quality, token age/mcap, organic
volume). **Borrowing is permissioned and curated; supplying can be broad.** This is not a nicety — it
collapses the two worst attack surfaces (adverse selection, and oracle manipulation on thin pools) by
simply excluding the pairs that carry them, converting a hard trustless-risk problem into a managed
curated-risk one (the Morpho-curator / prime-broker "vetted counterparties only" model). Curation sits
*above* the per-pair coverage tests and the universal spend rule.

---

## 6. Economics — the Liquidity Rental Market

### 6.1 Two-part price (the wedge)

Supplier total return = **base idle yield** (earned even at 0% utilization, via the multi-venue adapter) +
**rental coupon** (when deployed) + **thin fee kicker** — and the capital **stays par-spendable** the whole
time. Aave and Tokemak both *lock* supplied capital and pay only when utilized; this is the differentiator.
Modeled: a $2M treasury earns **~1.8× Aave, principal-protected, still spendable.**

### 6.2 Pricing mechanism: utilization-curve floor + auction on top (Tokemak v2 model), tiered

```
rental_APR(pair) = max( curveRate(tier, U), marketBid(pair) )
curveRate(tier,U) = base_r[tier] + slope1[tier]·min(U,U*)/U* + slope2[tier]·max(0,U−U*)/(1−U*)   ← Aave kinked curve, per tier
```

The **curve floor** guarantees suppliers a predictable minimum (works day-one with zero bidders); the
**auction** captures a hot pair's true willingness-to-pay when depth oversubscribes. Thin/meme tiers get a
higher floor + steeper slope → they pay more *and* post more junior.

### 6.3 Fee/rent waterfall (adapting 60/30/10)

Per epoch, position generates `V = fees + captured LVR/MEV`:
1. **Mintware take** `φ·V` off the top (φ = 10%, tiered 5/10/15).
2. **Senior coupon** `R = r_rent·U·C_A·Δt`, senior-first; shortfall pulled from borrower's **rent escrow**
   (pre-funded 2–4 epochs) then junior; principal stays whole regardless.
3. **Excess split**: 25% senior kicker / 75% junior (the junior's reward for first-loss + bringing flow).

Effective at a healthy pair ≈ **57% senior / 33% junior / 10% Mintware.** The 57 is coupon-floored
(predictable, Aave-competitive); the 33 is residual-levered (junior's upside).

### 6.4 Per-party value prop (rough)

- **Supplier** $2M idle: Aave ≈ $100k/yr (locked, no upside). Mesh ≈ **~$180k/yr, principal-protected, still spendable** (~1.8×).
- **Borrower** $1M depth: MM deal ≈ $240k/yr retainer + call-option dilution; emissions ≈ 5–10% supply/yr. Mesh ≈ **$60k/yr, largely self-funded by fees, no dilution, no emissions** (~4× cheaper, aligned — team bets its own junior).
- **Mintware** $50M rented @ ~20% annual fee turnover = **~$1M/yr** at 10%, scaling with the book, near-zero marginal cost.

### 6.5 Adverse-selection defenses (market-for-lemons)

1. Risk tiers price the tail (§4.1). 2. **Junior coverage ratio as a screen** — a team unwilling to lock a
big junior of its own token reveals it doesn't believe in its pair (separating equilibrium). 3. Toxic-flow
recapture at the hook (dynamic/surge fee + Diamond-LVR, senior-first). 4. **Per-tier supplier opt-in**
(conservative treasuries back only blue-chip). 5. Caps + oracle-guard breakers.

### 6.6 Cold-start — the supply side already exists

The unfair advantage: **idle team runway already parked in Mintware treasury/YPN vaults *is* the supply.**
You activate existing capital, not a cold audience. Sequenced (Tokemak-style, supply-first): (0) Mintware
seeds a few blue-chip pairs for day-one depth + a live fee stream; (1) time-boxed supplier-coupon backstop;
(2) anchor a handful of credible borrower teams with waived/discounted take; (3) bridge points/referral for
early suppliers — **framed as a bridge to real yield, not permanent emissions** (avoid the OHM/Tokemak
trap); (4) withdraw subsidies once organic utilization clears a threshold.

---

## 7. Legal / compliance (compliant-by-design) — *not legal advice; counsel gates launch*

**The fault line & the mirror.** The mechanism sits on crypto's most-enforced line ("supply idle capital,
earn passive yield from others"), and the senior/junior tranche is a near-exact mirror of **SEC v. BarnBridge
DAO** (pooled → tranched → senior *"guaranteed"* → charged as unregistered securities **and** the pools as
unregistered investment companies). The design steers off it — and, beautifully, **the safest *legal*
structure equals the safest *risk* structure:**

- **Isolated, per-owner-attributed positions — never a commingled pool paying pro-rata.** (Risk: kills
  contagion. Legal: breaks Howey horizontal commonality + avoids the Investment-Company-Act charge.)
- **Honest par, never "guaranteed."** "Par while covered, pro-rata haircut in the tail" is defensible
  *because it is not a guarantee.* Frame the senior as a **priority claim on the owner's own capital**, not
  a promised return funded by juniors.
- **Non-custodial + ministerial fee capture.** Yield must read as *variable trading fees generated by
  third-party swaps, routed by immutable open-source code* — never *"we deploy / manage / optimize your
  capital."* The 2025 SEC staking statements + the Oct 2025 DeFi-credit comment bless exactly this posture.
- **Not raising capital for Mintware or a Mintware token** (peer-to-peer facilitation).

**Do/Don't language (add to the `/legal` CI lint):**
- **DON'T:** deposit · savings · account · earn · interest · APY · fixed rate · guaranteed · principal-protected · risk-free · "always $1" · "we lend/deploy/invest/optimize your funds" · loan/borrow/lending-product (for the core flow) · fund/pool-you-invest-in · bank.
- **DO:** non-custodial software · provides liquidity to a trading pair · on-demand (JIT) liquidity · may earn variable trading fees generated by third-party swap activity (no number) · redeemable at NAV, subject to solvency · priority in the payout waterfall · first-loss / junior collateral posted by the counterparty · permissionless, open-source, automated.

**Naming:** product = **Treasury Mesh**; mechanism = **Liquidity Mesh**. Positioning sentence:
> *Treasury Mesh is non-custodial liquidity-routing software. It is not a deposit, savings, lending, or
> yield product; it takes no custody of user funds; any fees are variable and generated by third-party
> trading activity. Redemption is at NAV — par while solvent, pro-rata in the tail.*

---

## 8. Architecture — ~85% already ships

### 8.1 Reuse substrate (already built + invariant-tested)

- **JIT borrow-seam** — `MintwareTreasuryJitHook` borrows a bounded slice of its own vault's idle senior,
  JITs one swap, returns it. Clean funding ABI `IJitVault { borrowIdleForJit, settleJitReturn, jitBorrowed }`.
  Execution math is a **pool-agnostic stateless library** (`MWJitLib.open/close/sweep`).
- **Coverage / O/C** — `deployedFromSenior ≤ recoverableUSDC() + juniorUsdcBuffer`; `_coverageOkAfter`,
  `coverageBps()`, `minCoverageBps` (48h-timelocked), per-block `jitMaxPerBlockBps`. Junior USDC buffer is
  first-loss; the volatile team token is deliberately not valued.
- **Par-free senior NAV** — deployed/JIT'd USDC still counts at PAR in `totalSeniorAssets()`;
  `seniorRealizableAssets()` is the solvency-aware floor; `idleBuffer()` = spendable-right-now.
- **edge-auth is already multi-leg** — `portfolio_available(legs, acct, guard)` sums equity across legs,
  subtracts an always-liquid hot-buffer reserve, has a `reserve_floor_breached` reason + circuit breaker.
  **A "leg" is exactly "a slice deployed into pair B."**
- **Directory + adapters** — `MintwareTreasuryVaultFactory`/`Registry` (multi-tenant, CREATE2, `byTeam`,
  `active`); `MintwareMultiVenueYieldAdapter` (best-effort never-revert withdraw); `SeniorSharesMath`.
- **Settlement-timing pattern** — the v4 afterSwap trap (swapper settles input last) is already solved via
  take-or-mint ERC-6909 claims + a permissionless `sweepJit()` + `forceSettleJit` backstop.

### 8.2 Why v4 makes it feasible

**Singleton** (all pools' reserves in one contract) + **flash accounting** (mint liquidity into pair B, let
the swap net deltas, remove it, settle only the net — even across pairs in one `unlock`; ERC-6909 claims as
first-class value) + **hooks** (per-swap JIT trigger, already implemented). One supplier's USDC can serve
pair B, be recalled, and serve pair C **in the same block without leaving the singleton.** Cross-pool shared
liquidity is a v4 capital-efficiency multiplier that was impractical in v3.

### 8.3 Net-new (the whole delta)

1. **`MintwareLiquidityAllocator.sol`** — the one genuinely new contract: supplier share-ledger
   (`SeniorSharesMath`), per-pair deployed tally + **network-level coverage gate** (reads borrower vault B's
   `juniorUsdcBuffer`/`coverageBps` view), per-supplier cap, hot-buffer reserve, utilization + recall queue,
   6909-claim→supplier attribution, timelocked risk params + instant breaker, `forceRecall` (mirrors
   `forceSettleJit`). Pair hooks borrow from the allocator instead of their own vault (`onlyJitHook` →
   also-accept-allocator). Keep the hook's local per-block cap + the vault's own coverage gate intact
   (defense-in-depth).
2. **`NetworkYieldAdapter.sol`** — thin `IYieldAdapter` so a supplier vault treats the mesh as one weighted
   venue in its `MultiVenueYieldAdapter`; `withdraw` utilization-bounded, best-effort, never-revert.
3. **Allocation Service (Rust, sibling to edge-auth/relayer)** — supply↔demand matching, pair ranking by
   fee/coverage/utilization, recall/rebalance orchestration; feeds edge-auth the per-supplier legs. Fail-closed.
4. **Network sweep/recall keeper + cron.**
5. **Schema** — `network_allocations`, `network_positions`, `network_fee_accruals` (deny-all RLS, service-role only).

### 8.4 Allocation + recall model — hybrid (atomic default + opt-in standing)

- **Atomic/short-window JIT (safe default)** — bounded slice for one swap; par-free senior NAV preserved;
  borrower B's junior is first-loss on close cost. Honest caveat inherited from today: the open→`sweepJit`
  round is **not atomic**, so cross-team it's a short **cross-vault credit exposure** (A's slice out-at-par,
  backed by B's junior) — bounded by a per-pair open-slice cap + `forceRecall`.
- **Standing allocation (opt-in, higher yield)** — Aave-style resting slice, recall bounded by the pair's
  un-utilized liquidity + a recall premium; carries standing IL risk → only on pairs whose junior coverage
  supports it (Tier A). Invariant: `Σ standing(A) ≤ commit(A) − hotBuffer(A) − minRecallable(A)`.
- **Recall priority for A's own spend:** hot buffer → atomic slices auto-return next sweep → unwind standing
  up to utilization headroom → else edge-auth `reserve_floor_breached` decline/defer. **Par is never broken
  to satisfy a recall.**
- **Supplier knobs:** `networkCommitBps`, `hotBufferBps`, `minRecallable`, `perPairCapBps`, `allowStanding`.

### 8.5 Phased build

- **Phase 0 — Seam generalization.** Introduce `MintwareLiquidityAllocator` (supplier ledger + per-pair
  coverage gate); one pair's hook borrows from the allocator instead of its own vault (single supplier →
  single borrower). Prove atomic cross-vault JIT on Base Sepolia via the existing 6909-claim + `sweepJit`
  path. Invariants: supplier A senior par preserved; B junior absorbs close cost; stuck-slice `forceRecall`
  bounded by B junior. Flag/env-gated off.
- **Phase 1 — Network adapter + accounting.** `NetworkYieldAdapter`; supplier shares; fee attribution on
  sweep; N→N via the registry. Extend edge-auth `portfolio.rs` legs + refresher so `spendable` spans slices.
- **Phase 2 — Recall + utilization + standing mode.** Utilization caps, recall queue + priority ladder,
  knobs; opt-in standing with utilization-bounded recall + premium; per-pair caps tiered by junior coverage;
  off-chain Allocation Service for matching/ranking/orchestration.
- **Phase 3 — Ops + observability + audit gate.** Network sweep/recall keeper + cron; `network_*` schema;
  timelocked risk params + instant breaker; `/proof`-style network dashboard. **External audit of the
  converged cross-vault credit stack is the sole gate before real value.**

### 8.6 Top risks for the audit

1. **Cross-vault credit exposure in the open→sweep window** — A's slice out-at-par backed only by B's
   junior; a stuck slice + adverse team-price move is the sharpest edge. Reproduce the single-vault
   `seniorRealizableAssets`/`forceSettleJit` solvency fix at network level.
2. **6909-claim attribution** — claims are fungible per-currency; supplier attribution lives only in the
   allocator ledger → a reconciliation bug mis-credits fees/losses across teams.
3. **Recall-vs-spend races** under high utilization — the hot buffer + `reserve_floor_breached` decline must
   guarantee a supplier can always spend its non-committed balance, never breaking par to satisfy a recall.

---

## 9. Open decisions (to resolve before/along the build)

1. **Ownership granularity** for the spend rule (already open from the treasury spend track): one-vault =
   one team (ships now) vs per-member sub-accounts (needs per-member share allocation). The mesh works on
   either; it's about who the "supplier party" is.
2. **Curation authority** — who runs the tier/eligibility allow-list (Mintware curator v1; DAO/curator
   market later, Morpho-style).
3. **Standing vs atomic-only for launch** — recommend **atomic-only** for the first mainnet iteration
   (provable safety), standing as a fast-follow for Tier-A once the coverage engine is battle-tested.
4. **Insurance slice** — optional protocol-funded pair-scoped backstop between junior and senior (raises the
   provable-safety margin; costs capital).

---

## 10. Bottom line

Treasury Mesh is a genuinely novel combination of proven ingredients, its safety is *provable* (not
aspirational) under the tier→deploy-mode mapping, its economics beat every alternative for all three
parties, it's compliant-by-design when built isolated + non-custodial + no-guarantee, and it's **~one new
coordinator contract + a thin adapter + a Rust matching service** away from the primitives Mintware already
ships. It ties the treasury, the token teams, and the community into one ecosystem where every dollar is
working for someone and safe for its owner — the whole "never idle, never locked, always yours" thesis, at
network scale.

**Gates before real value:** external securities/fintech counsel sign-off (§7) + a smart-contract audit of
the converged cross-vault credit stack (§8.6). Testnet + unaudited until then, like the rest of the YPN stack.
