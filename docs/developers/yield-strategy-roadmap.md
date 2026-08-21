# Yield Strategy Roadmap

> **Status: strategy + design only. Everything below is testnet + unaudited; the only mainnet
> contract is AIAttribution v3 (Base). No number here is a promise — every figure is an illustrative,
> sourced assumption. This document is the "why + in what order," it does not authorize deploying
> anything with real value. External audit is the hard gate on all of it.**

Companion specs:
[`router-internalization-spec.md`](./router-internalization-spec.md) ·
[`own-pool-jit-spec.md`](./own-pool-jit-spec.md)

---

## North star

Ship **Bunni / EulerSwap-class yield inside a senior/junior safety structure** — atomic (not
leveraged) ETH-fee capture, conservation-audited accounting.

**The product is the *combination*, not the APY:** ~**8–12%** that stays **liquid, spendable, and
self-custodied**, and *can't rug you*. That beats nearly every "safe" option in DeFi or TradFi, and
it's an honest, durable number — not a 20% headline built on leverage, emissions, or a cherry-picked
window (which is exactly what wrecked the protocols we're learning from).

**Explicitly out of scope (decision, 2026-08):** no separate higher-risk "reach" tier. No leverage,
no perpetual-funding basis trade, no borrow-against-collateral strategy. One tier, all senior-safe.

---

## The honest yield ceiling

| Layer | Real range | Source |
|---|---|---|
| Best-of USDC lending floor (multi-venue) | 4–7% | live DefiLlama: Aave ~4%, Morpho curated ~5%, Fluid ~5%, Sky ~6% |
| + JIT-concentrated fees (own deep pools) | +2–4% | volatile, pool-dependent |
| + MEV recapture (am-AMM / Diamond-LVR) | +1–3% | pool-dependent, off by default |
| **Safe stacked core** | **~8–12%, peaks ~13% in good windows** | Bunni's ~13% USDC-USDT is the real-world marker |

> 20%+ on senior stablecoin capital, durably and safely, does not exist honestly — it's always
> leverage, emissions, or a peak snapshot. We are not building that.

---

## Phases

### Phase 0 — Safety foundation *(gates everything)*
- **Conservation invariants on the vault accounting**, fuzzed. *Bunni ($8.3M, Sept 2025) died on a
  **rounding bug in the active/idle split inside `withdraw()`** (`balance.mulDiv(shares, supply)`
  rounded the deduction DOWN), amplified by **44 micro-withdrawals** that flipped the pool's
  liquidity selection — **not** the rehypothecation, and **not** the strategy. Per Bunni's own
  post-mortem, the **rehypothecated funds were locked and safe** — rehypo actually **limited** the
  loss. So the lesson is narrower and more useful than "rehypo is risky": round every share↔asset
  conversion in the vault's favor, and **fuzz micro-withdrawal / dust-burst sequences** so ±1-wei
  rounding can't compound. Our own rounding-direction audit (Phase 0 research) found **no red flags**
  — every `mulDiv` in the vault/adapter path already favors the vault. The gate is proving it under
  fuzzing, especially for the **adapters** (which have no conservation suite yet) and the
  external-4626 adapter against an adverse-rounding source.*
- Senior/junior tranching wired *(have `SeniorSharesMath`)*; hot buffer + circuit breaker + reserve
  floor *(have, off by default)*.
- **→ External audit** of the converged accounting before any real value.

### Phase 1 — Safe yield core (~8–12%, mostly built)
- **Weight the multi-venue adapter toward best-of venues** — deep, reputable curated vaults
  (Morpho Steakhouse/Gauntlet, Fluid, Sky) with Aave as the floor; **cap the exotic high-APY vaults**,
  tier by venue risk. → lifts the floor from ~3.5% (vanilla Aave) to ~5–6%.
  > **⚠ Accuracy note (2026-08-21 — corrects an earlier over-claim).** `MintwareMultiVenueYieldAdapter`
  > does **STATIC, curator-set weighted allocation** (`setVenues(weights)` → `_deploy` splits by
  > `weightBps`) — it does **NOT** read live rates and route to the best. Per-venue **risk cap** is now
  > enforced on-chain (`maxVenueWeightBps`, PR #335). But two real gaps remain: (1) it is **not wired into
  > any deployed vault** — the deploy scripts wire a *single* adapter, and the vault's slot is
  > `IYieldAdapter public immutable adapter` (**one, set-once, conceived as Aave**), so today a treasury
  > vault genuinely *is* pigeonholed into one venue; (2) there is **no dynamic best-rate shopping**. Those
  > are **Phase 1b** below, not done here.
- **Turn on JIT-concentrated fees + MEV recapture on our own deep pools only**, selective-fired.
  *Have `MWHookCoordinator` / `MintwareTreasuryJitHook` / `MWDynamicFee`; need the selective-firing
  EV keeper + deep-pool "tier" config.*
- Senior par-protected; junior first-loss.

### Phase 1b — Dynamic best-rate routing (the rate-keeper) *(new; the "shop across platforms" lever)*
The genuine multi-source uplift: **read each venue's *current* rate (Aave / Morpho / Fluid / Sky / sUSDe)
and route idle capital toward the best**, bounded by the Phase 1 per-venue cap. This is *not* the static
weighting above — it's a live comparison + re-allocation. Three pieces:
- **The allocation brain** (off-chain, pure + tested): `lib/yield/rateRouter.ts` `computeBestRateWeights()`
  — rank venues by live APY, greedily fill toward the best up to `maxVenueBps` per venue (so it
  diversifies across the top few, never all-in), leave an idle buffer. Data source: the live DefiLlama
  feed we already use (`/api/benchmarks/yields`). **Built here.**
- **The keeper** (off-chain service, *deploy-gated*): periodically calls `adapter.setVenues(...)` +
  `rebalance()` with the computed weights. The adapter already supports re-weighting — this just drives it.
- **The wiring** (*deploy-gated*): a deploy script that stands a vault up pointing at the multi-venue
  adapter → real child adapters (Aave + a Morpho/sUSDe `MintwareERC4626YieldAdapter`), since nothing does
  this today and the vault's adapter slot is immutable (must be set at construction).

### Phase 2 — ETH-fee capture, the *safe* way (the differentiator)
- **Build the flash-loan atomic JIT ETH leg** — the USDC **never leaves the lending floor**;
  flash-source ETH per swap, provide JIT, capture the fee, repay, all atomic. No held ETH, no
  liquidation, no carried borrow, nothing to hedge. Runs **in tandem** with the floor on the same
  capital. *This is the gap: today's JIT hook is **single-sided** (it only provides the asset the
  vault already holds, on swaps whose output is that asset). The flash-sourced counter-asset path
  — a USDC vault supplying ETH — has **no code** yet.*
- Deep ETH pools only; atomic = senior-market-neutral; junior absorbs residual adverse selection.
  → a **bounded** ETH-fee slice on top of the floor, **not** the 40% passive headline.

### Phase 3 — Flow scale (external volume *with an edge*)
- **Internalize our own router flow** — vault-as-counterparty fill with a hard best-execution
  guarantee. *Have the off-chain router brain (`lib/web2/router/*`); **need** the on-chain fill
  contract + quoter — and note the base on-chain `MWRouter` contract is **not present on this branch**
  (verify vs `main`). See spec #1.*
- **RFQ / solver filling** (0x RFQ, 1inch Fusion, Hashflow) — our lending-floor-subsidized book
  quotes tighter and wins on price.
- **NOT** external searcher JIT on other pools — no moat, margin bid to zero in priority-fee wars,
  worse adverse selection.

### Phase 4 — Community / team tokens (monetize safely)
- **Matched vault** — team commits *their own token* as junior/locked/first-loss; community provides
  the USDC/ETH quote as senior/par-protected. The team bears the token risk. *Have
  `MintwareMatchedLiquidityVault`.*
- **Surge / dynamic fees** on thin, toxic flow — make them pay. **No JIT on thin pools** (our own
  live sweep proved naive JIT *bleeds* there, worse with size; community tokens are also unhedgeable).
- Venue protocol fee on their volume.

---

## What "ETH vaults" we actually have (verified 2026-08 — don't conflate)

- **Deployed (Base Sepolia, testnet): an ETH-*collateral* vault** (`0x09Cda8…`) — a
  `MintwareYieldVault` (single-asset) holding WETH + a yield adapter, plus `MintwareEthSettlement`
  (`0x2014…`) for oracle-bounded **ETH→USDC** settlement. Its job is the **spend/collateral rail**:
  hold ETH, earn a base yield, edge-auth values it as an ETH leg (VaR haircut vs the live Chainlink
  ETH/USD feed), you spend against it, settlement swaps ETH→USDC.
- **This is NOT an ETH/USDC LP that earns ETH-pair fees.** That single-asset vault earns its
  adapter's base yield, **not swap fees**. The "USDC earns ETH *fees*" engine is a **pair vault +
  hook** (`MintwareDeFiPairVault` / `MintwareMatchedLiquidityVault` + `MWHookCoordinator`), and there
  is **no deployed ETH/USDC LP instance** — that is the **Phase 2 build**.
- **How it plays a part:** it's the ETH **spend/settlement backbone** (ETH-leg valuation + ETH→USDC
  settlement already proven on testnet), so Phase 2's ETH *plumbing* is partly in place — but the
  **fee-capturing pair vault is still to build.** Do not assume the fee engine exists because "we
  have ETH vaults."

---

## Non-negotiables (the safety spine)

1. **Conservation invariants before real value** — the Bunni lesson. Fuzz the idle↔active seam.
2. **Atomic over leverage** on senior money — flash-JIT, never borrow/hedge, for the core.
3. **Venue-risk tiering** — reach for yield in weighted, capped doses; JIT/atomic-ETH only on deep,
   liquid, (for ETH) hedgeable pairs; never thin/unhedgeable community tokens at our own risk.
4. **External audit is the hard gate** on everything.
5. **Testnet + unaudited today** — only AIAttribution v3 is mainnet.

---

## Precedent (what we're learning from)

- **Bunni v2** — proved ~13% on USDC-USDT via multi-venue rehypothecation + fees (+ am-AMM MEV). Died
  on a **rounding bug in the active/idle split inside `withdraw()`**, amplified by 44 micro-withdrawals
  — **not** the strategy, and **not** the rehypothecation (its rehypo'd funds were locked and *safe*;
  rehypo limited the loss). Permanently shut down. → our Phase 0 gate: round in the vault's favor +
  fuzz micro-withdrawal sequences.
- **EulerSwap** — same asset earns lending yield + backs swaps + is borrow collateral; JIT-borrows the
  counter-asset (up to ~50× depth). The live precedent for "USDC provides ETH" — via *borrow*
  (leverage/liquidation risk), which is why we prefer the *atomic-flash* variant for senior money.
- **Ethena / Resolv** — dollar-denominated ETH yield via long-stake / short-perp basis, tranched
  (RLP = junior). Real ~10–15% avg, but funding-cyclical → the reason we cut the basis "reach" tier.
- **Panoptic** — delta-neutral LP hedging (short call); confirms the LP-is-short-gamma residual and
  constant-rebalancing cost that make delta-neutral-held riskier than atomic flash-JIT.

---

## First build

Phase 0 first — the conservation invariants that gate everything (and directly protect the
multi-venue rehypothecation we already have). Phase 2's flash-JIT ETH leg is the headline
differentiator and is teed up by the research, but it must not ship ahead of the accounting safety net.
