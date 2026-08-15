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
data justify each phase. We did exactly that — **see "Status & evidence" below**: the measurement came back
*marginal* (naive JIT ≈ break-even), which refines the plan — a selective-firing keeper stops the bleed but
does **not** turn it positive; that takes Phase 2 (dynamic fees) / Phase 3 (LVR recapture). Either way we
ship on evidence, not vibes — and none of it throws away the hook.

## Status & evidence — PARKED (2026-08-15)

MEV/JIT work is **paused at a clean stop** (user decision). Nothing is half-finished or broken.

**Built + shipped**
- **Phase 0 — safe JIT rail + guards** (merged in the audit-hardening PRs): one-slice NAV-window bound (H2),
  reactive PnL circuit-breaker (H4) — `jitNetPnl`, owner `jitMaxCumulativeLoss` → `jitAutoDisabled`,
  `resetJitBreaker`. All in the deployed, invariant-fuzzed vault bytecode.
- **Swap harness** (PRs #258/#259) — `deploy {mockUsdc,mockTeam}` → `commit-team` → `jit-smoke`: fires a real
  V4 swap so the JIT hook triggers, sweeps, and reports `roundPnl`. **Fired live on Base Sepolia.**

**The evidence (JIT size-sweep, live)**

| swap size | JIT fired | borrowed | `roundPnl` |
|---|---|---|---|
| $0.50 | ✓ | $0.50 | −1 |
| $2 | ✓ | $1.00 (5% slice) | −1 |
| $10 | ✓ | $1.00 | −1 |
| $50 | ✓ | $1.00 | −1 |
| $200 | ✓ | $1.00 | −1 |

**Flat −1 micro-USDC across every size.** Naive JIT fee-capture is **structurally ~break-even** against
realistic pool depth — it captures roughly what its round-trip close cost pays; swap size doesn't move it.

**Implication (reprioritizes the phasing above):** the selective-firing keeper (Phase 1) is worth it as the
**safety/control** layer (keep JIT out of losing regimes, sweep, auto-disable) but its **yield upside is
capped** (turns a small loss into ~zero). The real money is **Phase 2 (dynamic fees)** and **Phase 3 (LVR
recapture)**.

**Resume decision** (pick a lever, evidence in hand):
1. **Min safety + Phase 2 (dynamic fees)** — *recommended*: cap JIT's downside, then charge informed flow
   more so capture > close cost (first net-positive lever; port `MWDynamicFee.sol`).
2. **Full Phase-1 keeper** — safety-complete but ~zero yield upside per the data; deploy-gated.
3. **Phase 3 (LVR recapture)** — the moat; biggest build; port `MWAmAuction.sol`.

**Live testnet artifacts:** audited fixed-stack vault `0xbf14c877…65c77`; JIT-fired mock/mock stack vault
`0x90f0849e…342227` (swapRouter `0xE9EC…D0cA`, lpRouter `0x2d4C…C1e0`). Re-fire via the bearer-gated
(`CRON_SECRET`) ops routes: `deploy {mockUsdc,mockTeam}` → `commit-team` → `jit-smoke`.

## Considered idea: "Internalized Slippage Capture" hook (assessment, 2026-08-15)

A blueprint (`MWSlippageCaptureHook`) proposed measuring a swap's price impact in the hook (beforeSwap
snapshots slot0 sqrtPrice, afterSwap reads it) and, for impact above a 0.30% threshold, skimming the excess
via `afterSwapReturnDelta` + `targetCurrency.take()` → 100% to the treasury as "reclaimed slippage / MEV."

**Assessment — the v4 mechanism is valid; the framing is not.** A hook *can* skim swap output with
`afterSwapReturnDelta` + `take` (that part works). But:

1. **"Slippage" is not a capturable pot.** It's the trader's worse average price walking up the curve —
   already in the pool reserves, accruing to LPs (then bled to arbitrageurs = LVR). `capturedFee =
   rawOutput × excessBps` is a **new deduction from the trader's output**, i.e. a fee sourced from the
   *trader*, not reclaimed leakage. Not "100% gross margin from nowhere."
2. **It does not capture MEV.** Sandwich/arb profit comes from front/back-running *around* the trade —
   untouched here. Capturing that is LVR-recapture (Phase 3), a different mechanism.
3. **"Zero aggregator friction" inverts under load.** Aggregators quote the **net output including hook
   deltas**, so on exactly the high-impact trades this targets they see the skim → route *away* (or the
   trader gets a bad-execution surprise and the pool gets deprioritized). Friction concentrates on the
   large trades, it doesn't disappear.

*Technical nits if ever built:* `slot0SqrtPriceX96Start` is declared regular storage, not `transient` (the
comment claims EIP-1153); `_calculatePriceImpact` uses the sqrtPrice ratio, ~2× off from true price impact
(price = sqrtPrice²); it imports `v4-periphery/BaseHook` whereas our stack implements `IHooks` directly.

**Salvageable core → this IS Phase 2 (dynamic fees).** Stripped of the framing, it's a **surge/dynamic fee
on high-impact trades routed to the treasury** — the exact lever the size-sweep evidence pointed to, built
on `MWDynamicFee.sol`. Honest reframe: *"on flow where Mintware has the best liquidity (so it routes here
despite a surge fee), charge a size/impact-scaled treasury fee."* Real incremental revenue on
price-insensitive large flow — a **surge fee** (incidence on traders), not slippage reclamation. Good
instinct (capture large-flow value for the treasury), corrected mechanism-story, right lever underneath.

### Can you actually "capture the slippage"? Yes — but the *dislocation*, not the trader's output

Sharper statement of the above, because it's the crux. Two things get called "slippage":

1. **The trader's slippage = a cost, not a pot.** The worse average price from walking up the curve is the
   trader's cost of trading. It's not a skimmable amount; trying to skim it (the blueprint) just charges the
   trader a fee.
2. **The price *dislocation* the trade creates = very capturable.** Right after a big trade, the *pool* is
   mispriced vs. the real market (e.g. a whale sells ETH → pool prints $2,950 while the market is $3,000).
   That gap is free money for whoever trades the pool back to the true price. Today an **arb bot** grabs it
   in the next block — that's the leak (LVR).

**"Capturing the slippage" = capturing that arbitrage before the bots** — the protocol/hook (or an auction)
does the rebalancing arb itself and keeps the value. That's **Phase 3 (LVR recapture)**, and it's the real
thing your instinct is reaching for — *not* skimming the trader (a fee), but taking the arb (the leak).

### Where this actually pays: low-cap / community / meme pools

The capture scales with **slippage per trade**, which is *tiny* on deep blue-chip pools (bps — this is why
our live sweep on a deep pool was ~break-even) and **fat on thin pools** where a normal trade slips **4–8%**.
So MEV capture is a rounding error on ETH/USDC but a **real yield line on thin community-token pools**.

**This is a strong fit for Mintware specifically:** the model is *team/community tokens* (teams launch vaults
with their own token as the junior leg), so the pools we'd actually run **are exactly the thin,
high-slippage pools where this pays**. MEV capture isn't bolted onto blue-chip flow we don't have — it's most
valuable on the flow we *do* have.

*How* you capture the fat impact depends on venues:
- **Multi-venue token** (also on a CEX / another DEX): the pool mispricing is a clean **arb/LVR recapture** —
  grab the arb back to the reference price.
- **Single-venue token** (our pool is the only liquidity): no external price to arb, so the impact is "real"
  — but that's exactly where **sandwiching is rampant** (bots front-run + back-run the mean-reversion), and a
  **surge/dynamic fee** captures a fat slice of a fat impact. Addressable MEV is still large; it's
  sandwich-internalization + surge fee rather than pure arb.

**Tested now with the existing harness** (thin ~$20 baseline vs the deep $5M one), and the result flips the
naive expectation:

| swap | deep-pool `roundPnl` | thin-pool `roundPnl` |
|---|---|---|
| $0.50 | −0.000001 | **−0.006** |
| $1 | — | **−0.025** |
| $2 | −0.000001 | **−0.125** |
| $5 | −0.000001 | **−0.274** |

**On thin pools naive JIT doesn't capture value — it *bleeds*, worse with trade size** (up to −27% on the ~$1
JIT slice). The value is there (that's why the swings are big), but JIT is structurally on the **losing**
side: it borrows USDC, provides it, accumulates the volatile token as the trade pushes price up, then sells
it back into the *moved* thin pool at a terrible price — self-sandwiched, and the close cost explodes with
thinness. **JIT is the wrong MEV tool for thin community pools** (must be off — the H4 breaker auto-disables
it). The right tools are **dynamic/surge fees** (capture the impact as a fee, no adverse round-trip — the
"slippage capture" blueprint, correctly reframed) and **LVR recapture** (arb the dislocation). Since Mintware
runs community-token pools, this is the operative regime.

## Pool tiering — blue-chip vs community is not one-size-fits-all

A vault's whole profile flips with its **junior token's tier** (liquidity × volatility × external-venue depth),
and every parameter — not just MEV — should follow:

| Axis | Deep / blue-chip junior (e.g. ETH) | Thin / community-meme junior |
|---|---|---|
| Slippage per trade | bps | 4–8% |
| Seniority swap (junior→USDC) | clean, low-slippage | high-slippage / fragile |
| Senior USDC backing | well-backed | riskier-backed |
| Card spend / senior-LTV | generous | tighter |
| `idleBufferTargetBps` | lower (more LP) | **higher** (more USDC safe in Aave) |
| MEV mechanism | JIT ~break-even (marginal) | **JIT off**; dynamic-fee + LVR (value is large) |

The levers already exist on-chain (`idleBufferTargetBps`, `jitMaxPerBlockBps`, `jitMaxCumulativeLoss`); a
**tier preset** (or an on-chain junior-liquidity read) would set them at vault creation. The card rail is not
one-size either — spend/settlement generosity scales with how safely the junior backs the senior. Treat
blue-chip and community vaults as **different products.**

## Mechanism ranking — for the goal "capture MEV + slippage," JIT is NOT the best

Decision (2026-08-15). Ranked best → worst for **our** goal on **our** thin community pools:

| Rank | Mechanism | Captures | Fit |
|---|---|---|---|
| 1 | **MEV-tax / top-of-block auction = LVR recapture** (`MWAmAuction.sol`) | the arb/sandwich value that leaks from the pool | **Best / the moat.** Redirects to treasury the value bots take today. |
| 2 | **Dynamic / surge fee** (`MWDynamicFee.sol`) | price-impact, as a fee on high-impact flow | **Best pragmatic first lever.** No capital, no adverse inventory; strong on thin pools. Single-venue fallback. |
| 3 | **JIT liquidity** (our `MintwareTreasuryJitHook`) | the swap fee, via provision | **Weak here** — the safe *scaffold* we built, not the capture engine. Round-trips inventory through the same thin pool → break-even to negative. |

Direction: **build the auction/dynamic-fee engine; treat naive JIT as a retired experiment.** The infra we
already shipped (tranche vault, safe hook seam, guards H2/H4, settlement gateway) is exactly what an
auction/dynamic-fee hook plugs into — not throwaway, it's the foundation. Both blocks (`MWDynamicFee`,
`MWAmAuction`) already exist in the repo.

## How much of a trader's slippage can we actually capture?

Quantified answer to "on a low cap I trade with 4–7% slippage — can we capture that?" — via
[`sims/lvr_capture_sim.py`](sims/lvr_capture_sim.py) (constant-product pool, 0.3% fee; run `python3
docs/developers/sims/lvr_capture_sim.py`).

A trader's slippage splits into **permanent impact** (the market genuinely repriced — *nobody* captures it)
and **temporary impact / LVR** (reverts — captured by an MEV bot today; a hook can redirect it to treasury).
The capture ratio is set by the temporary fraction **β** (unknowable per-token → we sweep it), **not** by pool
size — pool size only scales the dollars.

$200k pool, trader buys ~$4.7k and eats 5% (loses ~$235 vs mid):

| Temporary fraction β | We capture | = % of the trader's slippage |
|---|---|---|
| 0.3 (informed flow) | $14 | 6% |
| 0.5 (typical retail) | $45 | **~19%** |
| 0.7 (pure ape/impact) | $92 | 39% |
| single-venue: 1% surge fee | $47 | 20% (a fee, not reclaimed leakage) |

Absolute $ scales linearly with pool size (same ratios): $50k pool → ~$11 (β0.5); $1M pool → ~$223 (β0.5).

**Bottom line: yes, partly — realistically ~15–40% of the slippage (≈0.8–2% of trade notional), the piece
already leaking to bots.** Honest caveats: β is assumed not measured; the permanent part is gone for everyone;
these are **upper bounds** on the LVR piece (ignore gas, latency, competing arbs) — our structural edge is that
*as the pool's own hook we go first* (top-of-block right); clean LVR needs a second venue, else fall back to
the surge-fee row. **Naive JIT captures none of this** — the mechanisms that do are ranks 1–2 above.

## Prior art: RexHook (adopted mechanisms)

Reviewed the RexHook whitepaper (v1.6/1.7, Feb 2026 — a "Shopify for V4 token launches": launchpad +
hook marketplace + registry). Most of it (marketplace, $REX token, launchpad economics) is not us. But its
fee-capture / MEV sections are on our exact problem and independently corroborate the ranking above. Adopt:

1. **Deterrence sizing for MEV, not just capture.** Set the surge/capture rate η* = min{1, (gas + builder
   bribe)/E} so a sandwich becomes zero-EV → the attacker doesn't attack. Better than racing the bot for the
   value: it protects our trader *and* stops the leak. Fold into the LVR/auction lever.
2. **Quote-asset, in-swap fee capture with ZERO token accumulation.** Take the cut in USDC directly from swap
   output via `afterSwap` delta modification — never hold/dump the volatile token. This is the mechanically
   correct fix for exactly our JIT's dump-back sin; our dynamic-fee lever must use this pattern (their
   "zero sell pressure" Thm 3.2). Their whole "death spiral" thesis = accumulate-and-dump crashes price =
   the lesson our thin-pool JIT test taught us, formalized.
3. **Elasticity-based fee tiering.** Revenue R=fV(f) is maximized at demand elasticity ε=1 → charge MORE where
   demand is inelastic (launch / low-cap / FOMO), LESS where arbitrage-sensitive. This is the economic
   justification for our surge fee on thin pools and maps onto the pool-tiering table. (Their tiers: <$100K up
   to 30% … >$1M 1–5% — but note 30% would get routed around by aggregators; treat as an upper caricature.)
4. **TWAP z-score sandwich detection in `beforeSwap`:** flag when `|P_spot − P_twap|/σ > 2.5` AND ≥2
   opposite-direction swaps in the block. A concrete selective-firing heuristic for the keeper.
5. **Emit the Uniswap Foundation standard hook events** (`HookSwap`, `HookFee`, `HookModifyLiquidity`,
   `HookBonus`) → free indexer/explorer interop (v4.xyz, Envio), zero custom adapters.
6. **`@openzeppelin/uniswap-hooks` `BaseHook` now exists** — our older note "BaseHook doesn't exist, use IHooks
   directly" is stale; an OZ-audited base is available to inherit. **Verify before relying on it.**

Honest read: it's a fundraising whitepaper ($40M FDV) — "theorems" are dressed-up algebra, empirics are cited
literature not their own data, and their "MEV capture" is really detect-suspicious-swap-and-charge-a-high-fee
(incidence can land on a legitimate volatile-market trader) = a volatility surge fee, i.e. our lever #2, NOT
true LVR recapture. Their `PriceImpactHook` = the `MWSlippageCaptureHook` idea, and they too frame it honestly
as an *additional fee*, not "reclaimed slippage." Where we're ahead: the treasury/tranche + card-settlement
layer routing captured value into spendable senior USDC — they just split fees to recipient wallets.
