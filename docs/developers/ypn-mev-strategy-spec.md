# YPN MEV-Capture Strategy Layer — Spec

**Status:** proposed (design). Not built. This is the "make MEV capture actually stellar" phase that sits
on top of the safe JIT rail already shipped.

## TL;DR for the anxious question

**This does NOT require a new family of v4 hooks.** We keep the one `MintwareTreasuryJitHook` we already
built and tested. The sophistication is:
1. **Mostly off-chain** — a strategy/keeper service that decides *when* and *how much* to quote. Zero hook
   changes.
2. **Incremental on-chain additions** to the single existing hook (a dynamic-fee return in `beforeSwap`, an
   arb-capture step in `afterSwap`).
3. **Reuse of building blocks we already own** — `contracts-v4/src/hooks/MWDynamicFee.sol` (dynamic LP fee)
   and `MWAmAuction.sol` / `MWAmAuctionLib.sol` (a top-of-block auction) exist from the social-vault family
   and can be ported/composed, not rewritten.

## Where we are now (the safe rail — shipped)

`MintwareTreasuryJitHook` + the vault JIT seam captures the **swap fee** on just-in-time liquidity:
- borrow a bounded idle-senior slice → open a tight single-sided position → capture the fee → close into
  ERC-6909 claims → keeper `sweepJit` settles.
- **Guards (shipped):** one-slice-at-a-time window bound (H2), a reactive realized-PnL circuit-breaker with
  owner threshold + auto-disable (H4), per-block cap, paused/tick-boundary no-op, junior-buffer backstop.

This is **Level 1**: real fee capture, can't bleed, but it fires on *any* qualifying swap with a *fixed*
range. It is the correct foundation, not the finished product.

## The gap to "stellar" (Level 2–3)

The frontier of LP MEV capture is **LVR recapture** — reclaiming the value arbitrageurs normally extract
from LPs — not just the swap fee. Three levers, in earnings-impact order:

### 1. Selective firing (off-chain) — biggest lever, no hook change
A strategy service watches the mempool / order flow and decides whether *this* swap is worth quoting (benign
flow = quote; toxic/informed = sit out). It drives the hook through the knobs the hook already exposes
(`jitCap`, threshold) or a thin `setJitParams` the keeper updates per block.
- **On-chain:** at most a parameter setter. No new hook.
- **Off-chain:** a Rust/TS keeper (extends the `services/` stack) with an order-flow model.
- **Why it matters:** the single biggest determinant of JIT PnL is *not quoting toxic flow*. This is where
  most of the money is.

### 2. Dynamic fees (on-chain, existing block) — small addition to the one hook
`beforeSwap` returns a fee override that rises with volatility / inferred informed-ness, so informed flow
pays for the adverse selection it imposes.
- **On-chain:** extend `MintwareTreasuryJitHook.beforeSwap` to return a dynamic fee; **port the math from the
  existing `MWDynamicFee.sol`.** Not a new hook — a few lines on the one we have.
- **Off-chain:** the keeper can feed a volatility signal, or it's computed on-chain from recent ticks.

### 3. LVR recapture / backrun (the moat) — extension, then optionally an auction
Capture the arbitrage that follows a price-moving trade, for the community, instead of leaking it to bots.
Two implementation tiers:
- **Tier A (extension):** an `afterSwap` step that, when the swap moved the pool off the external price,
  performs the rebalancing arb itself (or routes it) and credits the proceeds to the vault. This is an
  *addition to the existing hook's `afterSwap`* (which already runs to close the JIT position).
- **Tier B (auction, frontier):** auction the right to fill / rebalance at top-of-block (MEV-tax style).
  **We already have `MWAmAuction.sol` + `MWAmAuctionLib.sol`** — a top-of-block auction from the social-vault
  work — to port/compose. Still composes with the treasury hook; does not replace it.

## Architecture (unchanged foundation)

```
  Off-chain STRATEGY ENGINE (new)            On-chain (existing hook + vault, extended)
  ┌───────────────────────────┐             ┌──────────────────────────────────────────┐
  │ order-flow / mempool model │  params →   │ MintwareTreasuryJitHook                    │
  │ selective-fire decision    │  ────────►  │  beforeSwap: (+ dynamic fee)   [ext #2]    │
  │ volatility / LVR signal    │             │  afterSwap : close JIT (+ arb) [ext #3A]   │
  │ keeper: sweepJit, params   │  sweep →    │ MintwareTreasuryVault (JIT seam, guards)   │
  └───────────────────────────┘             │  + jitNetPnl / breaker (shipped)           │
                                             │ (optional) MWAmAuction (ported) [ext #3B]  │
                                             └──────────────────────────────────────────┘
```

- **Dumb-safe on-chain:** the contract only executes + enforces safety (this is how CoW, Sorella, searchers
  all structure it — the smarts are private/off-chain).
- **Smart off-chain:** the strategy engine holds the intelligence and can be iterated without redeploying
  contracts.

## Phasing

| Phase | Work | New hook? | Value |
|---|---|---|---|
| **0 (done)** | Safe JIT rail + guards (one-slice, PnL breaker) | — | Fee capture that can't bleed; measures real MEV PnL via `jitNetPnl` |
| **1** | Off-chain selective-firing keeper | No | The biggest earnings lever — stop quoting toxic flow |
| **2** | Dynamic fee in `beforeSwap` (port `MWDynamicFee`) | No (extend) | Charge informed flow for adverse selection |
| **3A** | `afterSwap` arb / LVR recapture | No (extend) | The moat: recapture LP value for the community |
| **3B** | Top-of-block auction (port `MWAmAuction`) | No (compose) | Frontier LVR internalization |

## Measurement first

`jitNetPnl` (shipped) is the instrument: run the safe rail on testnet, watch realized JIT PnL, and let the
data justify each phase. If the guarded rail already clears meaningful profit, Phase 1 is the obvious next
build; if it's marginal, the selective-firing keeper is exactly what turns it positive. Either way we ship
on evidence, not vibes — and none of it throws away the hook.
