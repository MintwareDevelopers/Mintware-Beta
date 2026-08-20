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
- **Conservation invariants on the idle↔active accounting seam**, fuzzed. *This is the exact class of
  bug that drained Bunni ($8.3M, Sept 2025) — a rounding error in the idle vs. active balance
  accounting, not the strategy. It is the #1 technical gate, not a footnote.*
- Senior/junior tranching wired *(have `SeniorSharesMath`)*; hot buffer + circuit breaker + reserve
  floor *(have, off by default)*.
- **→ External audit** of the converged accounting before any real value.

### Phase 1 — Safe yield core (~8–12%, mostly built)
- **Config the multi-venue adapter to best-of venues** — weight to deep, reputable curated vaults
  (Morpho Steakhouse/Gauntlet, Fluid, Sky) with Aave as the floor; **cap the exotic high-APY vaults**,
  tier by venue risk. *Have `MintwareMultiVenueYieldAdapter`; need venue weights + risk caps.*
  → lifts the floor from ~3.5% (vanilla Aave) to ~5–6%.
- **Turn on JIT-concentrated fees + MEV recapture on our own deep pools only**, selective-fired.
  *Have `MWHookCoordinator` / `MintwareTreasuryJitHook` / `MWDynamicFee`; need the selective-firing
  EV keeper + deep-pool "tier" config.*
- Senior par-protected; junior first-loss.

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
  on a **rounding bug in the idle↔active withdraw accounting**, not the strategy. Permanently shut
  down. → our Phase 0 gate.
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
