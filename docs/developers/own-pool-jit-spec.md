# Own-Pool Atomic JIT Liquidity, with Flash-Sourced Inventory

> **Engineering design doc — grounded, honest.** This describes atomic just-in-time (JIT)
> liquidity on **Mintware's own Uniswap-V4 pools**, using flash-sourced counter-asset inventory.
> It is a design on top of the JIT machinery that already ships in `contracts-v4/`, plus one fill
> path that **does not yet exist** and is called out plainly below.

---

## 1. Summary + status

**The idea.** Because Mintware is the **hook** on its own V4 pools, it holds a structural right no
external JIT bot has: it can act *first* inside a swap. On `beforeSwap` the hook can source the
counter-asset (from the vault's idle capital or a flash loan), mint a **tight** concentrated position
right at the trade price, let the swap execute against that position — capturing the LP fee and, with
Diamond-LVR on, recapturing a slice of the adverse-selection value — then unwind and repay, **all in
one transaction**. The vault's capital earns the swap fee with only **atomic (in-tx) exposure**, not a
held/overnight LP position with ongoing impermanent loss. It still bears the **per-swap adverse
selection (LVR)** of the swaps it fires against; a selective-firing keeper plus Diamond-LVR are what
keep that term in check.

The first concrete instance in this doc is the **USDC→ETH** case: a USDC-denominated vault
flash-sources ETH to back an ETH/USDC swap, then unwinds the ETH it is left holding back to USDC
inside the same transaction.

### Status banner (read this before trusting anything downstream)

| Piece | State |
|---|---|
| `MintwareTreasuryJitHook` — borrow-idle → JIT → afterSwap-mint-6909 → keeper `sweepJit` → settle | **BUILT** (`contracts-v4/src/payments/`), Forge-tested |
| `MWJitLib` — the DeFi pair vault's single-sided JIT subsystem | **BUILT** (`contracts-v4/src/vaults/lib/`) |
| Vault borrow-seam `borrowIdleForJit` / `settleJitReturn` (par accounting, per-block cap, junior backstop, PnL breaker) | **BUILT** (`MintwareTreasuryVault`) |
| MEV engine: `MWDynamicFee` (volatility / quadratic / surge / MEV-tax / **Diamond-LVR** surcharge), `MWOracleGuard` truncated oracle | **BUILT — all levers OFF/inert by default** |
| `HookMiner` CREATE2 salt mining; `IHooks` implemented directly (no `BaseHook`) | **BUILT** |
| **Flash-source-the-counter-asset fill path** (borrow ETH the vault does *not* hold, provide it, repay from swap proceeds) | **NEEDED — does not exist** (see §4, §11) |
| Selective-firing keeper (expected-value gate beyond a size threshold) | **NEEDED** (see §5, §11) |
| Per-pool tiering config + turning Diamond-LVR on for this use | **NEEDED / config** (see §6, §11) |

> **Honesty gate.** Everything vault/hook/MEV in this repo is **testnet + unaudited**. The **only**
> mainnet contract is **AIAttribution v3** on Base (`0x11Ef2c7D…C421`). The ULV engine is on **Base
> Sepolia only, empty and unproven**. No number in this doc is measured on-chain; every figure in §10
> is a **labeled illustrative assumption**, not a forecast, and explicitly **not** the ~40% passive
> full-exposure ULV headline. External audit is the gate before any real value.

---

## 2. Mechanism — the atomic `beforeSwap → provide → afterSwap → unwind` flow

The shipped `MintwareTreasuryJitHook` already runs the full atomic loop for the **single-sided**
harvest (the vault provides an asset it already holds idle). The flow, and its one genuinely subtle
correctness point — the **afterSwap settlement gotcha** — are below. The flash-sourced counter-asset
variant (§4) slots a different *inventory-sourcing* step into the same skeleton.

### The shipped single-sided loop (real code)

1. **`beforeSwap`** (`MintwareTreasuryJitHook.beforeSwap`): the hook checks the swap is on its
   `canonicalPoolId` (a Cork-class guard — a swap on any *other* pool naming this hook no-ops rather
   than reverting), that the output side is USDC, that `|amountSpecified| ≥ jitThreshold`, and that
   the initiator isn't the exempt `jitSkipSender`. If so it calls `_open`.
2. **`_open`**: `vault.borrowIdleForJit(mag)` lends a **bounded** slice of senior idle USDC (see §7),
   the hook mints a tight single-sided position at `JIT_SALT` in a range `jitWidthSpacings` wide,
   **just to one side of the live tick**, and settles the add-liquidity delta. It reads **no price
   oracle** to size the fill; the vault caps the slice. Near a tick extreme it no-ops and returns the
   borrow rather than let `getSqrtPriceAtTick` revert inside `beforeSwap` (audit M6).
3. **The swap executes** against resting liquidity + the fresh JIT position. The hook also returns a
   per-swap **dynamic LP-fee override** (`_dynamicFee`) — pure, clamped, revert-free.
4. **`afterSwap`**: `_close` removes the JIT position. **Here is the gotcha** (next subsection): it
   **cannot** physically `take()` what the closed position is owed, so it **mints ERC-6909 claims** for
   the owed amounts (`usdcClaim` / `teamClaim`) and returns. It also advances the truncated oracle.
5. **Keeper `sweepJit()`** (post-settlement, permissionless): inside a fresh `unlock`, redeems the
   6909 claims to physical tokens, swaps the team/ETH side back to USDC (bounded by the truncated
   oracle ± `SWEEP_BAND_TICKS` so a same-tx spot push can't force a bad unwind price), and returns the
   total to the vault via `settleJitReturn`. Between step 4 and 5 the vault's `jitBorrowed` stays
   outstanding **at par**, so senior NAV is held.

### The afterSwap settlement gotcha (audit-critical)

In Uniswap V4, **the swapper settles its input token LAST** — *after* `afterSwap` returns. So during
the `afterSwap` callback the PoolManager does not yet hold the swapper's input; a hook that closed its
position and is *owed* that token **cannot `take()` it mid-swap**. Naively calling `take()` there
reverts and bricks the pool.

The shipped fix (in both `MintwareTreasuryJitHook._close` and `MWJitLib._takeOrClaim`):

- **Take what's physically available**, then **`mint` an ERC-6909 claim** for the shortfall
  (`poolManager.mint(address(this), currency.toId(), owed)`), accumulating into `usdcClaim` /
  `teamClaim`.
- A **later keeper sweep** — separated by transaction, once the swapper has settled and the physical
  tokens exist — `burn`s the claims, `take`s the physical, converts the counter-asset back to USDC,
  and settles with the vault.

This take-or-mint-6909 + keeper-sweep pattern is the load-bearing correctness invariant of the whole
design. See `.claude/rules/vaults.md` ("afterSwap settlement gotcha") and the
`v4_afterswap_settlement_timing` memory.

```mermaid
sequenceDiagram
    participant T as Trader
    participant PM as V4 PoolManager
    participant H as MintwareTreasuryJitHook
    participant V as MintwareTreasuryVault
    participant K as Keeper (sweepJit)

    T->>PM: swap (ETH/USDC), unlock
    PM->>H: beforeSwap(key, params)
    Note over H: canonical-pool + threshold + output-side checks
    H->>V: borrowIdleForJit(mag)  [OR flash-source counter-asset — §4, NOT BUILT]
    V-->>H: lent (bounded slice, par-counted)
    H->>PM: modifyLiquidity(+L, JIT_SALT)  tight range at tick
    Note over PM: swap executes against resting + JIT liquidity (fee captured)
    PM->>H: afterSwap(delta)
    H->>PM: modifyLiquidity(-L)  close
    Note over H: GOTCHA: swapper settles input LAST → can't take() now
    H->>PM: mint ERC-6909 claims for owed sides
    H->>H: advance truncated oracle
    Note over T,PM: swap fully settles; physical tokens now exist
    K->>PM: sweepJit() → unlock
    PM->>K: burn claims, take physical
    K->>PM: swap counter-asset → USDC (oracle-banded)
    K->>V: settleJitReturn(usdcReturned)
    Note over V: profit lifts senior; shortfall drawn from junior buffer; PnL breaker updated
```

---

## 3. Internal (our pools) vs external JIT

| | **External JIT** (searcher) | **Internal / own-pool JIT** (this doc) |
|---|---|---|
| Who provides | A competing bot racing to add liquidity in the same block as a large swap | The **hook on the pool itself** |
| Edge | Speed / priority-fee auction; must win the race every time | **Structural** — the hook runs *inside* the swap on `beforeSwap`, before anyone else can add |
| Ordering risk | Can be out-bid, sandwiched, or front-run | First-provision right is guaranteed by being the hook |
| Fee share | Splits the swap's fee with resting LPs and other JIT bots | Provisions a tight range that captures a large share of the fired swap's fee |
| Capital | Searcher's own / flash-loaned | Vault idle capital (§7) or flash loan (§4) |

**This document is about internal JIT.** The whole point is that Mintware does not have to win a
searcher race: it *is* the hook, so its atomic first-provision right is a property of the pool, not of
a per-block auction. That is also why it is only compelling on **our own pools** — you cannot be the
hook on someone else's pool.

---

## 4. Flash-sourced inventory — how the counter-asset is provided and repaid same-tx

There are three ways to source the inventory the JIT position needs, in ascending order of what the
repo supports today:

**(a) Idle vault capital — BUILT (single-sided only).** The shipped path. `borrowIdleForJit` lends
senior **USDC** the vault already holds (idle in Aave). The hook opens a **single-sided USDC** range
on swaps whose **output is USDC** — i.e. flow that is *buying* USDC (selling ETH/team). The vault
never sources an asset it doesn't hold. `MWJitLib.open` is the same shape for the DeFi pair vault:
single-sided, funded from the **output-side** Aave adapter. Repayment is the keeper sweep (§2).

**(b) V4 flash accounting — the same-tx primitive, partially used.** V4's `unlock`/`take`/`settle`
lets a hook take tokens from the PoolManager and repay before the unlock closes, with only a transient
negative balance. The shipped `sweepJit` already uses this to `burn`/`take`/`swap`/`settle` inside one
unlock. In principle the hook could `take()` the counter-asset (ETH) from the pool's own reserves in
`beforeSwap`, provide it as JIT liquidity, and repay from the swap's proceeds — **but the afterSwap
timing gotcha (§2) means the repay leg lands as a 6909 claim + keeper sweep, exactly as today.**

**(c) External flash loan — NEEDED, does not exist.** To back a swap where the vault must hold an
asset it does *not* own (the USDC vault providing **ETH** to a trader *buying* ETH), the counter-asset
has to be **flash-borrowed** — e.g. Aave v3 `flashLoanSimple`, Balancer, or Morpho — inside the
`beforeSwap`/`unlock` frame, provided as JIT liquidity, and repaid same-tx from the swap output plus
fee. **There is no flash-loan integration in `MintwareTreasuryJitHook` or `MWJitLib` today.** This is
the central missing piece for the USDC→ETH instance (see §8, §11).

Whatever the source, the invariant is: **inventory is sourced and repaid within the same transaction**,
so the vault never holds a converted, directional position past the tx boundary — no overnight IL.

---

## 5. Selective firing — fire only when it pays

JIT is not free money: every position you open is exposed to being **picked off** by informed flow.
The firing rule must be an **expected-value** gate:

```
FIRE  iff   E[fee on fired notional] + E[recaptured LVR (Diamond-LVR)]
            >   E[adverse selection cost (LVR)] + E[gas + flash-loan premium]
```

**What exists today:** the on-chain gate is a **size threshold** (`jitThreshold`) plus the vault's
coverage/PnL guards (§7). That is a crude proxy — it skips dust, nothing more. `beforeSwap` **cannot
call out** to an off-chain model and must stay pure/revert-free, so the real EV logic lives **off
chain**, in a keeper that continuously tunes the hook's on-chain parameters (threshold, width, LVR
slope, per-block cap, and — once built — the deep-pool allowlist) based on measured pool toxicity,
realized JIT PnL (`jitNetPnl`), and current flow. This is the "selective-firing keeper" direction from
the MEV engine roadmap (`ypn_mev_strategy_spec` / `.claude/rules/smart-contracts.md`): **no new hook
family — one keeper that fires the existing levers selectively.** It is **NEEDED / not built** as an
EV engine; only the size threshold exists.

The vault's **PnL breaker** (`jitMaxCumulativeLoss` → `jitAutoDisabled`) is the backstop under the
keeper: if cumulative realized JIT loss breaches the owner threshold, `borrowIdleForJit` no-ops and
JIT halts until re-enabled — so a mis-tuned firing rule fails safe rather than bleeding the senior.

---

## 6. Adverse selection & LVR recapture — the honest exposure

**What atomic JIT removes:** the *held-position* risks. There is no overnight inventory, no
multi-block impermanent loss, no funding of a standing two-sided position. Between transactions the
vault holds USDC (par), not a directional LP position.

**What atomic JIT does *not* remove:** the **per-swap adverse selection**, i.e. **LVR
(loss-versus-rebalancing)**. When you provide liquidity into a swap, informed/arbitrage flow trades
against you precisely when the price is moving *through* you — you systematically end up on the wrong
side of that move. This cost is intrinsic to being the counterparty on that swap, atomic or not. On a
single swap it shows up as: the position you close is worth less (in USDC terms, after unwinding the
counter-asset) than fee + principal would suggest.

**LVR recapture — Diamond-LVR (`MWDynamicFee.lvrSurchargePips`).** The mitigation is a **directional**
surcharge applied **only** on the gap-closing (arb) swap — the swap that realizes LVR against LPs —
and **never** on benign flow that widens the gap (the uninformed flow LPs *earn* on). In the hook,
`_dynamicFee` detects the arb direction from the live tick vs the truncated oracle (`tick > oTick &&
zeroForOne`, or `tick < oTick && !zeroForOne`) and adds `slope·dev + quad·dev²` (clamped to
`maxFeePips`). This recaptures a **portion** of the LVR back to the LP — not all of it. **It is OFF by
default (`lvrEnabled = false`)** and must be explicitly enabled and tuned for this use.

**Deep / high-volume pools only.** The empirically grounded rule (see `pool_tiering` /
`.claude/rules/vaults.md`): **naive JIT BLEEDS on thin pools, and worse with size** — a live sweep
showed it getting *worse* as size grew (≈ −27% on the slice). On thin/community/meme pools the LVR
term dominates the fee term and net firing is negative, so **JIT stays OFF there** and the pool relies
on the dynamic/surge fee + LVR levers instead. Own-pool atomic JIT is a **deep, high-volume-pool**
strategy. The per-pool tiering that enforces "deep-only" is **config that must be wired** (§11).

---

## 7. Tranche safety — senior backs only near-neutral atomic harvest

The vault is tranched (`SeniorSharesMath` — one audited senior-share / virtual-offset inflation
defense, shared by v1 and v2):

- **Senior = community capital**, par, USDC-spendable. It must stay whole. JIT only ever borrows
  senior idle USDC, and `jitBorrowed` counts it **at par**, so `totalSeniorAssets()` is unchanged by
  the loan itself.
- **Junior = team/first-loss capital** (`juniorUsdcBuffer`). On `settleJitReturn`, if the returned
  USDC is short of what was borrowed, the **shortfall is drawn from the junior buffer first** so the
  senior stays whole; profit lifts the senior.

The borrow-seam guards (`MintwareTreasuryVault.borrowIdleForJit`) that keep senior exposure "atomic
harvest, not a punt":

- **Paused / breaker-tripped → no-op** (`return 0`, never revert inside `beforeSwap`).
- **One slice outstanding at a time** (`jitBorrowed != 0 → 0`).
- **Per-block cap**: `perBlockCap = totalSeniorAssets × jitMaxPerBlockBps / BPS` (default `jitMaxPerBlockBps
  = 500`, i.e. 5%), further clamped to adapter headroom.
- **Coverage gate**: `_coverageOkAfter(cap)` skips JIT when the junior cushion is thin.
- **PnL breaker**: cumulative realized JIT loss past `jitMaxCumulativeLoss` sets `jitAutoDisabled`.

This is the "junior backstops, senior NAV untouched" design the hook NatSpec calls out. **Extending
to flash-sourced counter-asset inventory (§4c) must preserve every one of these guards** — the
counter-asset leg introduces a *conversion-back-to-USDC* step whose slippage is a new shortfall source
that the junior buffer must be sized to absorb, and the coverage gate must account for.

---

## 8. The USDC→ETH atomic instance (spelled out)

Consider a Mintware ETH/USDC pool where Mintware is the hook, and a USDC-denominated vault.

**Case A — trader sells ETH to buy USDC (output = USDC): BUILT.** This is exactly the shipped path.
`beforeSwap` sees output-side USDC ≥ threshold, borrows senior idle USDC, opens a tight single-sided
**USDC** range just below the tick, the swap fills against it (fee captured), `afterSwap` closes and
mints 6909 claims, and `sweepJit` converts the ETH the position accrued back to USDC (oracle-banded)
and settles. The vault only ever *held* USDC; it briefly *acquired* ETH via the position and unwound
it same-loop.

**Case B — trader buys ETH with USDC (output = ETH): NEEDED, no code path.** To back this the vault
must **provide ETH it does not hold**. That requires **flash-sourcing ETH** (§4c): flash-borrow ETH in
the `beforeSwap`/`unlock` frame, mint a tight single-sided ETH range at the tick, let the trader's USDC
buy that ETH (fee captured), and repay the flash loan from the USDC proceeds + fee, converting as
needed — all atomic, all subject to the afterSwap 6909/keeper timing. **None of this exists**: there is
no flash-loan call, no ETH-inventory path, in `MintwareTreasuryJitHook` or `MWJitLib`. Case B is the
work item that makes "flash-sourced inventory" real; Case A is the already-shipped, single-sided
special case where the sourced asset happens to be the one the vault already holds.

The honest framing for the concept as a whole: **Case A proves the atomic loop end-to-end today; Case
B (the symmetric flash-sourced side) is a design, not a shipped capability.**

---

## 9. Precedent (mechanism only — no fabricated numbers)

- **JIT liquidity is a documented, live Uniswap v3 MEV strategy.** Searchers add a concentrated
  position in the same block as a large swap to capture its fee, then remove it — well-characterized
  in public MEV research and pool analytics. Own-pool JIT is the same mechanism with the hook holding
  the first-provision right instead of racing for it.
- **Flash loans** (Aave v3 `flashLoanSimple`, Balancer, Morpho) are the standard same-tx uncollateralized
  borrow primitive; the counter-asset source in §4c is a conventional flash-loan-and-repay.
- **Uniswap v4 flash accounting** (`unlock` / `take` / `settle`, transient balances) is the native
  same-tx primitive the hook already uses in `sweepJit`, and the substrate for §4b.
- **LVR (loss-versus-rebalancing)** is the standard academic framing for LP adverse selection; the
  **Diamond** directional-surcharge approach (charge only the gap-closing arb) is the design
  `MWDynamicFee.lvrSurchargePips` implements.
- **Held-position contrast:** single-sided / zap LP vaults such as **Gamma** and **Arrakis** take a
  *standing* concentrated position and manage its rebalancing and IL over time. Own-pool atomic JIT is
  the opposite trade-off: **no held position / no overnight IL**, in exchange for bearing per-swap LVR
  only on the swaps it fires. Different risk shape, not "strictly better."

No performance figures are asserted from any of these — they establish that each *mechanism* is real
and precedented.

---

## 10. Realistic yield model (illustrative — not a forecast, not measured)

**Frame it correctly.** The return here is **fees captured on the volume the hook actually FIRES on,
net of adverse selection and gas — a *slice* of the pool's total fee pool.** It is **not** the ~40%
passive full-exposure ULV headline (that number is a different, full-exposure model and is **not**
claimed here). It is an *incremental* spread on top of the senior's baseline idle (Aave) yield, and on
the wrong pool it is **zero or negative**.

### Worked example — all inputs are labeled illustrative assumptions

| Assumption | Illustrative value | Basis |
|---|---|---|
| Pool | Deep ETH/USDC, ~$50M/day volume | *assumed deep-tier pool* |
| Fired notional (selective) | ~10% of volume = **$5.0M/day** | keeper fires only qualifying large flow |
| JIT share of the fired swap's fee | 70% | tight range captures most of the fee on swaps it fires against |
| Effective fee tier at fire time | 0.30% (floor; may surge higher) | `baseFeePips = 3000` |
| Gross JIT fee | 0.30% × $5.0M × 70% = **$10,500/day** | derived |
| Adverse selection (LVR) before recapture | 60% of gross | *assumed deep-pool toxicity* |
| Diamond-LVR recapture of that LVR | 25% | *assumed, lever tuned & ON* |
| Net adverse cost | 0.60 × (1−0.25) × gross = 0.45 × gross = **$4,725/day** | derived |
| Gas + flash premium | ~200 fired swaps/day × $2 = **$400/day** | Base is cheap; flash premium ~0 for idle-sourced, small for borrowed |
| **Net captured** | 10,500 − 4,725 − 400 ≈ **$5,375/day** | derived |

**How to read $5,375/day.** It is a **slice of the pool's fee pool**, and it sits **on top of** the
senior's baseline Aave yield on the idle USDC that briefly backs each fill — it is **not** the vault's
headline APY. Because the same idle USDC is recycled every swap (atomic), per-dollar-of-capital
figures look large and are **misleading** — which is exactly why this doc reports **daily dollars and
an incremental spread**, not an annualized headline percentage.

### Sensitivity (why the honest answer is "it depends, and can be negative")

| Adverse selection (of gross) | Recapture 0% | Recapture 25% | Recapture 50% |
|---|---|---|---|
| 40% | +$5,900/day | +$6,740/day | +$7,580/day |
| 60% | +$3,700/day | +$5,375/day *(base case)* | +$7,060/day |
| 80% | +$1,700/day | +$3,780/day | +$5,860/day |
| **110% (thin-pool regime)** | **−$1,700/day** | **−$785/day** | **+$130/day** |

The bottom row is the **thin-pool bleed** made numeric: once adverse selection exceeds gross fees, net
firing is **negative** regardless of recapture — the reason JIT is **deep-pool-only** and stays OFF
elsewhere (§6). All cells share the same illustrative gross ($10,500/day) and gas ($400/day); only the
LVR/recapture assumptions move. **None of these are measured; they are scenario inputs.** The platform's
public value-prop model lives at `/app/the-math` (`app/the-math/page.tsx`) with real DeFi benchmarks
(`GET /api/benchmarks/yields`) — this JIT slice is one incremental component of that, not the whole.

---

## 11. What exists vs what's needed

### EXISTS (grounded in real contracts read for this doc)

- **`MintwareTreasuryJitHook`** — full atomic single-sided loop: `beforeSwap` (canonical-pool + size +
  output-side gate) → `_open` → `afterSwap` `_close` + **ERC-6909 claim mint** → permissionless
  `sweepJit` → `settleJitReturn`. Oracle-banded unwind, `IHooks` implemented directly, `0x20C8`
  permission bits validated in-constructor.
- **`MWJitLib`** — the DeFi pair vault's stateless, delegatecall-linked single-sided JIT (same
  take-or-mint-6909 shortfall path, funded from the output-side Aave adapter).
- **Borrow-seam** on `MintwareTreasuryVault` — `borrowIdleForJit` / `settleJitReturn` with par
  accounting, per-block cap (`jitMaxPerBlockBps`), coverage gate, junior-buffer shortfall absorption,
  and the `jitNetPnl` → `jitAutoDisabled` PnL breaker.
- **MEV engine** — `MWDynamicFee` (`volatilityFeeQuad`, `surgeFee`, `mevTaxPips`, **`lvrSurchargePips`**)
  + `MWOracleGuard` truncated in-block oracle. Diamond-LVR is **wired into the hook's `_dynamicFee`**
  but **OFF by default**.
- **`SeniorSharesMath`** — the tranche inflation defense; the senior/junior structure JIT relies on.
- **`HookMiner`** — CREATE2 salt mining for the required permission bits (`BaseHook` does not exist).

### NEEDED (called out plainly)

1. **Flash-source-the-counter-asset fill path (the headline gap).** The current hooks only provide the
   asset the vault **already holds idle** (single-sided, output-side). Backing a swap where the vault
   must supply an asset it does **not** hold — the **USDC→ETH Case B** (§8) — needs a **flash loan**
   (Aave/Balancer/Morpho) or a v4-flash-accounting `take → provide → repay` leg, integrated into
   `beforeSwap`/`unlock` and repaid same-tx. **No such code exists.** It is materially riskier than the
   single-sided harvest (you take on the counter-asset atomically and must unwind it to USDC within the
   tx), so its slippage/shortfall must fold into the junior-buffer sizing and the coverage gate.
2. **Selective-firing keeper (EV gate).** Today's on-chain gate is a bare size threshold. The
   expected-value rule of §5 (fee + recaptured LVR > LVR + gas) must live in an **off-chain keeper**
   that tunes the hook's params from measured toxicity and realized `jitNetPnl`. `beforeSwap` stays
   pure. **Not built as an EV engine.**
3. **Per-pool tiering config.** A deep-pool allowlist plus params (threshold, width, LVR slope,
   per-block cap) scaled by pool depth / junior tier, enforcing "deep-only." Principle is documented
   (`pool_tiering`); the wiring is not.
4. **Turn Diamond-LVR (and the fee levers) ON for this use, tuned.** All levers are OFF/inert by
   default; this strategy specifically needs `setLvr(...)` enabled with tuned slope/quad on the target
   deep pool, and likely surge tuned for the reposition.
5. **Deployment + audit.** Nothing here is on mainnet. Testnet + unaudited; external audit is the gate.

---

## 12. Sequencing & risks

**Sequencing (lowest-risk first):**

1. **Deep pools, single-sided, Case A only** — the already-shipped loop, on a deep ETH/USDC pool, with
   the size threshold as the only firing gate and Diamond-LVR OFF. Prove the atomic loop + sweep on
   testnet with real (test) flow.
2. **Turn on Diamond-LVR + surge, tuned** — enable and calibrate `lvrSurchargePips` and the surge floor
   on that deep pool; measure realized `jitNetPnl` against the PnL breaker.
3. **Add the selective-firing keeper** — replace the bare threshold with the off-chain EV gate; wire
   per-pool tiering so it can only ever arm deep pools.
4. **Build the flash-source fill path (Case B)** — the flash-loan/flash-accounting counter-asset leg,
   with junior-buffer sizing updated for the conversion-slippage shortfall. This is the largest new
   attack surface and comes last.
5. **External audit → mainnet.**

**Risks:**

- **Settlement-timing correctness (audit-critical).** The take-or-mint-6909 + keeper-sweep invariant
  (§2) is the thing that must never be gotten wrong; any path that tries to `take()` the swapper's
  input inside `afterSwap` bricks the pool. Every new fill path (esp. Case B) must respect it.
- **Thin-pool bleed** — firing on a shallow pool is negative-EV and gets worse with size (§6, §10). The
  deep-only tiering is a safety control, not an optimization.
- **Counter-asset unwind slippage** (Case B / the sweep) — the leg that converts the sourced/accrued
  counter-asset back to USDC is where a manipulated spot can bite; mitigated by the oracle-banded
  unwind (`SWEEP_BAND_TICKS`) but must be sized into the junior buffer.
- **Flash-loan premium + gas** eating thin margins — folded into the EV gate; on Base gas is small, but
  the premium on a borrowed counter-asset is a real subtraction.
- **Levers-off-by-default drift** — because every lever ships inert, a deploy that forgets to enable
  Diamond-LVR runs the *un*-recaptured LVR profile (worse economics), while a deploy that over-tunes it
  can over-charge benign flow. Both are config-review items.
- **Testnet + unaudited** — the standing risk on everything but AIAttribution v3.
