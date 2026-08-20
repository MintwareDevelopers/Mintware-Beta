# Router Order-Flow Internalization — Engineering Design

> **Status: DESIGN / PROPOSAL.** This describes a strategy that is **partly built and mostly not**.
> The off-chain best-execution router brain (`lib/web2/router/*`) exists and is tested. The
> vault-as-counterparty fill path this document proposes **does not exist yet** and is the bulk of
> the work. **Everything money-touching in this repo is testnet + unaudited; the only mainnet
> contract is `AIAttribution` v3 on Base.** No number in this document is a measured on-chain
> result — every figure is a clearly-labeled illustrative assumption. Do not present any of this as
> live, profitable, or audited.

---

## 1. Summary

**Thesis.** When a swap comes through Mintware's own router, the Mintware vault can fill that order
**as the counterparty** — an in-house market maker — instead of (or before) sending the order to an
external venue. The vault quotes a fill at mid plus a spread; if that fill is at least as good for
the user as the best external quote (LI.FI), the vault takes the other side, pockets the spread and
the router fee, and only falls back to LI.FI when it cannot match the external best price. Idle vault
inventory earns the lending floor (Aave / ERC-4626 adapters) between fills. This is the on-chain
analogue of retail order-flow internalization (the mechanism behind PFOF), with one hard rule the
TradFi version does not guarantee: **the user is always given at least the best external quote.**

**Status banner — BUILT vs NEEDED.**

| Piece | State | Where |
|---|---|---|
| Off-chain best-execution decision brain (price internal vs LI.FI, pick strictly-better) | **BUILT + tested** | `lib/web2/router/{index,pickBest,internalQuote,fee,listing,quoterReader,config}.ts` |
| Server route that runs the decision | **BUILT** | `app/api/(web2)/swap/best-route/route.ts` |
| Client providers (LI.FI + internal) + swap hooks | **BUILT** | `lib/web2/providers/{lifi,mwInternal}.ts`, `hooks/{useQuote,useSwap}.ts` |
| Router fee knob + hard cap | **BUILT** | `lib/web2/router/fee.ts`, env `NEXT_PUBLIC_MW_ROUTER_FEE_BPS` |
| Vault inventory + settlement primitives (tranching, `settleSpend`, oracle-bounded ETH→USDC, idle-yield adapters) | **BUILT (testnet, unaudited)** | `contracts-v4/src/payments/*`, `contracts-v4/src/vaults/*` |
| **On-chain `MWRouter.sol` execution contract** | **NOT in this worktree** (router README claims it; the file, its test, its deploy script, and the `router_pools` migration are absent here — see §10) | — |
| **Vault-as-counterparty (RFQ) quoting engine** | **NEEDS BUILDING** | — |
| **Inventory + risk manager** (bands, hedging, netting) | **NEEDS BUILDING** | — |
| **Toxicity filter** (internalize benign, route toxic out) | **NEEDS BUILDING** | — |
| **Atomic fill path** (flash-source the out-asset, take the in-asset, settle) | **NEEDS BUILDING** | — |

The important honest gap: **the router as built prices and executes against a passive Uniswap-V4
pool**, not against vault inventory. It reads a V4 Quoter and routes to `MWRouter.swapExactInputSingle`.
Turning "the pool fills you" into "the vault fills you as principal" is a new execution path, not a
config flip. This document specifies that path and the risk machinery it requires.

---

## 2. Why this is the highest-leverage play

Three properties make this different from every other yield lever in the codebase.

**Moat — we see the order first.** Every other on-chain market-making edge (JIT liquidity, the
`MintwareTreasuryJitHook`, am-AMM in `MWHookCoordinator`) competes for flow *in the public mempool*,
where the order is already visible and the profit is auctioned away to whoever bids the most gas or
the most rent. Internalized flow is different: the order arrives at **our** router, in **our**
quote request, before it is a public transaction. There is no block-level auction to win because we
are the venue the user chose. That is a structurally cheaper place to capture spread than the
mempool.

**Scale — capped by router volume, not pool depth.** A passive LP position earns fees proportional
to the depth it commits and the price range it covers; doubling revenue means doubling capital at
risk in the pool. Internalization decouples the two: the vault can fill a large fraction of *router
volume* out of a comparatively small, actively-managed inventory, because inventory turns over
(fill → hedge/net → refill) rather than sitting statically in a range. The ceiling is how much order
flow the router sees, which is a growth problem, not a capital problem (see §7).

**The profitability driver — retail router flow is uninformed (benign).** This is the whole game.
Market-making is profitable when your counterparties are, on average, *not* trading on information
you lack. Retail swap flow through an app router is overwhelmingly benign: someone rebalancing,
dollar-cost-averaging, cashing out to spend (this is literally the YPN use case — swap to USDC to
spend a card). Filling benign flow captures the bid/ask spread with **low adverse selection** — the
price rarely moves against you right after the fill because the flow carries no edge. This is the
exact opposite of the toxic, informed flow that a public JIT hook attracts, where arbitrageurs pick
you off precisely when the price is about to move (documented in this repo's own pool-tiering
analysis: naive JIT *bleeds* on thin pools). Internalization lets us **choose** to fill the benign
flow and **route the toxic flow out** to LI.FI, where the toxicity becomes someone else's problem.
That selection — impossible when you're a passive pool that must fill everyone — is why this is the
highest-leverage play.

---

## 3. Architecture

### 3.1 The decision path (what changes)

Today's decision path (all present in `lib/web2/router/`):

```
quote request (useQuote)
  → LI.FI quote fetched client-side (lib/web2/providers/lifi.ts)
  → POST /api/swap/best-route
       → isRouterEnabled()                         config.ts  (kill switch)
       → getListedPool()                           listing.ts (router_pools registry)
       → quoteInternalPool() → V4 Quoter read      internalQuote.ts + quoterReader.ts
       → pickBest(lifi, internal)                  pickBest.ts (STRICT gas-inclusive user-net)
  → winner: 'lifi' | 'mw-internal'
  → if mw-internal: mwInternal.executeSwap → MWRouter.swapExactInputSingle
```

The internalization path **inserts one new quote source** — the vault as principal — into
`quoteInternalPool`, and **replaces the execution target** for internalized fills. The comparator
(`pickBest`) and the best-execution guarantee are unchanged; they are exactly what makes
internalization safe, so we reuse them verbatim.

New logical shape:

```
best-route
  → quoteExternalBest()      = LI.FI (unchanged — this is the price to beat)
  → quoteVaultFill()         = NEW: inventory-aware RFQ quote from the vault
                                (mid from oracle/pool tick, minus a spread the
                                 inventory/risk manager sets per-pair, per-size)
  → toxicityFilter()         = NEW: is this flow benign enough to internalize?
  → pickBest(external, vaultFill)   REUSED: vault only wins if user-net ≥ external
  → if vault wins AND benign: vault-as-counterparty atomic fill
       - flash-source the OUT asset from inventory / idle adapter
       - take the IN asset from the user
       - deliver OUT to user at the quoted (≥ external) price
       - update inventory position; enqueue for hedge/net
  → else: LI.FI (fall back, exactly as today)
```

Where each hook attaches, concretely:

- **`quoteVaultFill()`** attaches inside `quoteInternalPool` (`lib/web2/router/internalQuote.ts`) as
  an alternative `QuoterReader` implementation. The existing `QuoterReader` interface
  (`quote(pool, amountIn) → RawPoolQuote`) is the right seam: a new `InventoryQuoteReader` returns a
  `RawPoolQuote` sourced from the vault's mid + spread instead of a V4 Quoter simulation. The
  orchestrator (`index.ts`) does not need to know which reader produced the quote — it already
  normalizes and compares.
- **`toxicityFilter()`** attaches in the best-route server route
  (`app/api/(web2)/swap/best-route/route.ts`) *before* the vault quote is even requested — if the
  flow is classified toxic, skip the vault entirely and return the LI.FI winner. Keeping it off the
  hot fill path means a toxic order never touches inventory.
- **The atomic fill** replaces the `MWRouter.swapExactInputSingle` execution branch in
  `lib/web2/providers/mwInternal.ts` / `hooks/useSwap.ts` with a call into a new
  vault-counterparty contract (or an extended `MWRouter` that can pull from vault inventory). This is
  the one genuinely new on-chain component.

### 3.2 Sequence diagram

```mermaid
sequenceDiagram
    actor User
    participant UI as useQuote / useSwap
    participant LIFI as LI.FI (external best)
    participant BR as /api/swap/best-route
    participant TOX as Toxicity filter
    participant INV as Inventory + risk manager
    participant PICK as pickBest (best-ex)
    participant VAULT as Vault (counterparty)
    participant ADPT as Idle-yield adapter

    User->>UI: enter swap (tokenIn, amountIn)
    UI->>LIFI: quote (client-side proxy)
    LIFI-->>UI: external best quote (buyAmount, gasUSD)
    UI->>BR: best-route(external quote, pair, size)
    BR->>TOX: classify flow (benign vs toxic?)
    alt flow is toxic / informed
        TOX-->>BR: TOXIC → skip vault
        BR-->>UI: winner = LI.FI
    else flow is benign
        TOX-->>BR: BENIGN
        BR->>INV: quote a fill (mid ± spread, size, band check)
        INV-->>BR: vault fill quote (or null if out of band)
        BR->>PICK: compare(external, vaultFill)
        alt vaultFill user-net STRICTLY ≥ external
            PICK-->>BR: winner = mw-internal
            BR-->>UI: winner = vault fill (≥ external guaranteed)
            UI->>VAULT: execute atomic fill
            VAULT->>ADPT: flash-source OUT asset from idle inventory
            User->>VAULT: deliver IN asset
            VAULT->>User: deliver OUT asset at quoted price
            VAULT->>INV: update position; enqueue hedge/net
        else external better or tie or unpriced
            PICK-->>BR: winner = LI.FI
            BR-->>UI: winner = LI.FI (fall back)
        end
    end
    UI->>User: execute winning route
```

### 3.3 What stays exactly as-is (and must)

`pickBest` (`lib/web2/router/pickBest.ts`) is the single point where a user could be handed a worse
price, and it is deliberately conservative: the vault (internal) side wins **only** when both sides
have a USD basis *and* the vault's gas-inclusive user-net strictly exceeds LI.FI's by the configured
margin; every ambiguity resolves to LI.FI. Internalization does not weaken this — it strengthens the
argument, because now the "internal" quote is a price the vault is *choosing* to offer, so it can
always price to `external + ε` and still profit on the spread it holds back. The best-execution
invariant is free.

---

## 4. Where the yield comes from

For each internalized fill, the vault captures up to four components:

1. **Spread** — the difference between the vault's true mid (its cost to source/hedge the OUT asset)
   and the price it fills the user at. Because the user must receive at least the external best
   quote, the *realizable* spread is bounded by how far the vault's mid sits inside the external
   quote. On benign flow with a tight external market this is a few basis points; it is the core,
   recurring capture.
2. **Router fee** — `applyRouterFee` (`lib/web2/router/fee.ts`) already skims a treasury fee off the
   output on internal swaps (`NEXT_PUBLIC_MW_ROUTER_FEE_BPS`, default 50 bps, hard cap 100 bps). On
   an internalized fill this fee is retained by the same entity that holds the inventory — it is
   revenue the user would otherwise have paid to LI.FI's integrator fee anyway (the default is
   explicitly parity with the 0.5% LI.FI referrer fee), so it is not an extra cost imposed on the
   user.
3. **The LP fee we'd otherwise pay** — when a swap routes externally, the user's output is already
   net of the external pool's LP fee and LI.FI's integrator fee. Filling internally means that LP fee
   is not paid to a third-party pool; the portion of it not passed back to the user (to clear the
   best-ex bar) accrues to the vault.
4. **Idle lending floor** — inventory not actively filling sits in the idle-yield adapters
   (`AaveV3YieldAdapter`, `MintwareERC4626YieldAdapter`, `MintwareMultiVenueYieldAdapter`), earning
   the lending rate. The adapter's `withdraw` is explicitly **best-effort, never-reverts**
   (`IYieldAdapter` NatSpec), which is exactly the property a hot-path flash-source needs — inventory
   can earn the floor and still be pulled back to fill a swap without bricking it.

Components 1–3 are spread/fee on flow (bounded by volume × captured edge). Component 4 is a floor on
idle inventory. **The headline is 1+4, not a passive LP APY.** See §9 for why we model this as
bps-per-swap and not as an APY.

---

## 5. The USDC→ETH flash-fill instance

The first concrete instance. A user swaps USDC → ETH through the router. The vault holds mostly USDC
inventory (it is a USDC-denominated treasury) and does not want to hold a static ETH bag. The atomic
fill:

1. **Best-ex check.** LI.FI quotes `X` ETH out for the user's USDC in. The vault quotes `X + ε` ETH
   (ε ≥ 0). `pickBest` confirms the vault is strictly better, gas-inclusive. If not, fall back to
   LI.FI — done, no inventory touched.
2. **Flash-source the ETH.** The vault does not sit on idle ETH. In the same transaction it sources
   `X + ε` ETH — either from its own WETH inventory buffer, or by pulling from an idle-yield position
   / a hedging venue — so the user's OUT leg is covered atomically. (The existing
   `MintwareEthSettlement` contract already does the *inverse* leg — an oracle-bounded WETH→USDC
   swap for card settlement — proving the oracle-band + junior-buffer machinery for ETH↔USDC
   conversion exists in the repo and can be mirrored for the sourcing direction.)
3. **Take the USDC.** The user's USDC in-leg lands in the vault as new USDC inventory.
4. **Deliver ETH to the user** at the quoted `X + ε`. The user is done; they received ≥ the external
   best price.
5. **Inventory update + rebalance.** The vault is now longer USDC and shorter ETH than its target
   band. The inventory/risk manager records the position and, on its own schedule (not on the user's
   hot path), rebalances: net against opposite flow (an ETH→USDC swap that arrives minutes later
   costs nothing to net internally), or hedge the residual ETH exposure externally. The spread `ε`
   plus the router fee is the compensation for carrying that inventory risk between fill and
   rebalance.

The honest hard part is step 2 + step 5: sourcing the OUT asset atomically without holding a large
static bag, and keeping net ETH exposure inside a band. That is the inventory/risk manager (§6),
which does not exist yet.

---

## 6. Risk & safety

Internalization is a market-making business, and market-making has one way to lose money badly:
carrying inventory into an adverse move. The safety design:

**Inventory risk — bands, hedging, netting.**
- **Bands.** Each pair has a target inventory and a max deviation band. The `InventoryQuoteReader`
  returns *no* vault quote (→ LI.FI) when filling would push inventory outside the band. This caps
  directional exposure structurally: the vault simply stops offering to fill in the direction that
  would overload it. This mirrors the `IYieldAdapter.maxWithdrawable()` pattern already used to size
  JIT/buffer pulls — you only offer what you can safely source.
- **Netting first, hedging second.** Opposite flow is free to net internally; only the residual is
  hedged externally. On a two-sided book (USDC↔ETH both directions) a large fraction of exposure
  self-cancels over short windows, so hedging cost is charged only on the imbalance.
- **Hedging.** Residual exposure beyond a threshold is hedged on an external venue (via the same
  LI.FI path, or an oracle-bounded swap like `MintwareEthSettlement`). The spread captured must
  exceed expected hedging cost + adverse selection for a pair to be internalized at all.

**Toxicity filter — internalize benign, route toxic out.** The vault should refuse to fill flow that
is likely informed: unusually large size for the pair, patterns consistent with arbitrage against a
stale mid, flow arriving in a burst around an oracle update, or pairs/venues known to attract
sandwichers. Classified-toxic flow is routed to LI.FI untouched. This is the single most important
risk control, because it converts the flow the vault fills from "everyone" (a passive pool's curse)
to "the benign subset" (a market maker's edge). It attaches *before* the vault quote request so a
toxic order never reaches inventory.

**The non-negotiable best-execution guarantee.** The user is *always* offered at least the best
external quote. This is enforced by `pickBest`'s existing strict, gas-inclusive, USD-net rule — the
vault can only win by being strictly better for the user, ties and unprovable cases go to LI.FI, and
the router fee is already inside the internal quote's `buyAmount` so skimming it can never make the
internal quote *look* better than it truly is. On-chain, the fill still carries an
`amountOutMinimum` floor (as `mwInternal.executeSwap` already sets), so even a stale quote cannot
under-deliver. **This guarantee is what separates on-chain internalization from the reputationally
fraught version of PFOF: the user provably cannot be given a worse price to feed our spread.**

**Tranching — senior only backs market-neutral inventory.** The vault's senior tranche (community
capital, par, USDC-spendable) must not be exposed to directional market-making PnL. Internalization
inventory risk (the ETH leg carried between fill and hedge) is a **junior first-loss** position, the
same tranche that already absorbs settlement slippage in `MintwareEthSettlement` (the junior buffer
tops up an under-filled settlement; a move beyond the VaR haircut γ is "the junior first-loss event
the tranche is designed to absorb — never a senior/rail loss"). Internalization reuses that exact
boundary: **senior stays price-free and par-redeemable; the market-making book lives in junior.** If
the toxicity filter fails and the vault gets picked off, junior eats it, senior does not.

**Regulatory / optics honesty.** Internalizing retail order flow and profiting on the spread is,
mechanically, payment-for-order-flow / principal internalization. In TradFi this carries real
best-execution-obligation and disclosure baggage, and "PFOF" is a loaded term. Two things make the
on-chain version more defensible, and both should be stated plainly rather than hidden:
1. **On-chain transparency helps.** Every fill, the external quote it beat, and the price delivered
   are verifiable on-chain and in the `best-route` decision record. The best-ex claim is auditable,
   not asserted.
2. **The guarantee is provable.** The user provably receives ≥ the external best quote. The spread
   is captured from the gap between our *cost* and the *external market*, never from degrading the
   user's price.
   This does **not** make it regulation-proof — depending on jurisdiction and how the product is
   marketed, order-flow internalization can attract scrutiny. Flag it for legal review before any
   mainnet launch; do not market it as "free" or imply the user is getting the vault's true mid.

---

## 7. The real ceiling

**Yield scales with router volume, and router volume is ~zero today.** This is the honest constraint
that dominates everything above. The router is:
- **flag-gated off** — `NEXT_PUBLIC_MW_ROUTER_ENABLED` defaults to unset; `isRouterEnabled()` returns
  false and `resolveSwapRoute` short-circuits to LI.FI before any internal work (`config.ts`,
  `index.ts`);
- **empty** — the `router_pools` registry has no rows, so even with the flag on every pair resolves
  to LI.FI (`listing.ts`);
- **not fully deployed** — the on-chain execution contract the client calls (`MWRouter`) is not
  present in this worktree at all (§10), and no pool is listed on any chain.

So the entire strategy earns exactly `$0` until the router is actually carrying swap volume. The
capture per dollar of flow can be attractive (§9), but `attractive_bps × $0 = $0`. This is a
**go-to-market gate, not a technology gate**: the hard problem is the classic market-maker
chicken-and-egg — you need order flow to make internalization profitable, and you need a reason
(better prices, rewards, the YPN spend loop) for order flow to come to your router in the first
place. Building a flawless quoting/inventory/toxicity stack does not create volume. Be explicit
about this in any planning: this is a bet on the *router* becoming a real front door for swaps
(driven by the app's swap surface, the YPN spend-to-USDC loop, agent x402 flow, etc.), and the
internalization engine is how we *monetize* that flow once it exists — not how we create it.

---

## 8. Precedent

Cited as **mechanism** precedent — how the model works and why it is profitable — not as a source of
any specific number.

**TradFi — retail equity internalization (PFOF).** Wholesale market makers such as Citadel
Securities and Virtu internalize retail equity and options order flow routed to them by retail
brokers: they fill the retail order as principal, capture the bid/ask spread, and are required to
meet or improve the public best bid/offer. The model is profitable *specifically because retail
flow is uninformed* — it is not, on average, trading ahead of price moves, so the internalizer
captures spread with low adverse selection. This is the exact economic engine proposed here; the
on-chain differences are (a) a provable, on-chain best-execution guarantee and (b) transparency of
every fill.

**Crypto — RFQ market makers and solver networks.** The same "fill as principal, guarantee the user
a competitive price" pattern already exists on-chain:
- **RFQ makers** (e.g. Wintermute, Hashflow) quote a firm price to fill a user's swap as
  counterparty, competing against AMM/aggregator prices.
- **CoW Protocol solvers** compete to settle user orders, often filling from their own inventory or
  netting opposite orders (coincidence-of-wants) rather than touching an AMM — internal netting is
  a first-class source of price improvement there.
- **0x RFQ** lets professional makers stream firm quotes that fill retail flow directly.

The point of the crypto precedents is that **on-chain principal internalization with a
best-price guarantee is an established, working pattern** — Mintware's edge is that it *owns the
router the flow arrives at* and *already has the vault, tranching, and settlement primitives* to be
the counterparty, rather than being a third-party maker bidding for someone else's flow.

---

## 9. Realistic yield model

Model the capture as **basis-points-of-captured-edge per swap × internalized volume**, not as an
APY. An APY headline (e.g. "the ETH pair earns 40% of fees") describes *passive, full-exposure*
liquidity provision and is **not** what internalization captures — internalization captures a thin,
recurring spread on flow while deliberately *avoiding* full directional exposure. Quoting an APY
would overstate it and misrepresent the risk profile.

### 9.1 The formula

```
annual_capture_$  =  internalized_volume_per_year  ×  captured_edge_bps / 10_000
idle_floor_$      =  average_idle_inventory  ×  lending_apy
gross_$           =  annual_capture_$  +  idle_floor_$
```

- `captured_edge_bps` = the blended spread + retained router/LP fee the vault keeps *after* clearing
  the best-ex bar, net of expected hedging cost. **Illustratively assumed 2–8 bps** on benign
  stable/blue-chip flow. This is an assumption, not a measurement.
- `internalized_volume` = the share of router volume the toxicity filter + inventory bands actually
  let the vault fill. Assumed here, not observed (router volume is ~zero today — §7).
- `lending_apy` = idle-inventory floor from the yield adapters. Illustratively 3–5%.

### 9.2 Worked example (ILLUSTRATIVE — every input is an assumption)

Assume:
- Actively-managed inventory: **$1,000,000** (mostly USDC, two-sided on USDC↔USDT and USDC↔ETH).
- Internalized volume: **$500,000 / day** ≈ **$125M / year** (250 trading days).
- Captured edge: **4 bps** (mid of the 2–8 bps assumed range).
- Idle floor: **4% APY** on the inventory not actively filling.

```
annual_capture_$ = 125,000,000 × 4 / 10,000  = $50,000
idle_floor_$     = 1,000,000   × 0.04         = $40,000
gross_$          = $90,000
```

As a return on the $1M inventory that's roughly **9% gross** — of which about half is the spread
capture on flow and about half is the idle lending floor. Note this is *gross*, before hedging
slippage beyond the assumed edge, gas, operational cost, and any junior-tranche losses from
mis-classified toxic flow.

### 9.3 Sensitivity (ILLUSTRATIVE)

Annual spread capture only (`internalized_volume × edge_bps`), excluding the idle floor:

| Internalized volume/day | @ 2 bps | @ 4 bps | @ 8 bps |
|---|---|---|---|
| $100k/day (~$25M/yr) | $5,000 | $10,000 | $20,000 |
| $500k/day (~$125M/yr) | $25,000 | $50,000 | $100,000 |
| $2M/day (~$500M/yr) | $100,000 | $200,000 | $400,000 |

**Read the table as a shape, not a promise.** The dominant variable by far is *internalized volume*
(the columns move slowly; the rows move fast), which is exactly the go-to-market gate in §7. The
captured-edge assumption (2–8 bps) is a plausible band for benign stable/blue-chip flow, but the
*realized* edge depends entirely on how tight the external market is and how well the toxicity filter
works — it could be lower, and on toxic flow that slips through it can go *negative*. None of these
cells is a projection; they exist to show that the strategy's value is gated on flow, not on the
per-swap math.

---

## 10. What exists vs what's needed

**EXISTS (in this repo, testnet/unaudited unless noted).**
- **Best-execution decision brain** — `lib/web2/router/*`: kill switch (`config.ts`), pool listing
  registry (`listing.ts`, Supabase-backed via `registryFromFetcher`), internal quoting
  (`internalQuote.ts` + `quoterReader.ts` reading a V4 Quoter), the router fee skim + hard cap
  (`fee.ts`), and the safety-critical comparator (`pickBest.ts`). Unit-tested (the router suites are
  in the Vitest list).
- **Server wiring** — `app/api/(web2)/swap/best-route/route.ts` runs the decision with the Supabase
  registry + a viem-backed V4 Quoter reader; fails safe to LI.FI on any error.
- **Client providers + hooks** — `lib/web2/providers/{lifi,mwInternal}.ts`, `hooks/{useQuote,useSwap}.ts`:
  LI.FI quote/execute, the `mw-internal` provider (`fetchBestRoute` + `executeSwap`), and the
  per-quote augmentation + `mw-internal` execution branch. Flag-gated inert by default.
- **Fee knobs** — `NEXT_PUBLIC_MW_ROUTER_FEE_BPS` / `_MIN_MARGIN_BPS` / `NEXT_PUBLIC_MW_ROUTER_ENABLED`
  and the per-chain `MW_ROUTER_ADDRESS_{BASE,BASE_SEPOLIA}` / `MW_V4_QUOTER_{…}` server env
  (`config.ts`, documented in `.claude/rules/deployments.md`).
- **Vault inventory + settlement primitives** — `contracts-v4/src/payments/MintwareTreasuryVault.sol`
  (senior/junior tranching, par-senior NAV, spendable), `MintwarePaymentGateway.sol`
  (`settleSpend` / `burnForPayment`), `MintwareEthSettlement.sol` (oracle-bounded ETH→USDC batch
  swap with junior first-loss top-up — proves the ETH↔USDC conversion + oracle-band machinery), and
  the idle-yield adapters `AaveV3YieldAdapter.sol` / `MintwareERC4626YieldAdapter.sol` /
  `MintwareMultiVenueYieldAdapter.sol` (best-effort never-revert `withdraw`, ideal for hot-path
  flash-sourcing).

**NEEDED (does not exist — the bulk of the work).**
- **Vault-as-counterparty quoting engine** — an `InventoryQuoteReader` implementing the existing
  `QuoterReader` interface, returning a mid-plus-spread fill priced off inventory state, not a V4
  Quoter. *(Mostly off-chain.)*
- **Inventory + risk manager** — target bands per pair, deviation limits that suppress the vault
  quote when a fill would overload inventory, netting of opposite flow, residual hedging, and the
  junior-tranche accounting for market-making PnL. *(Mostly off-chain, with on-chain accounting
  hooks.)*
- **Toxicity filter** — pre-quote classifier that routes informed/toxic flow to LI.FI and only lets
  benign flow reach the vault. *(Off-chain.)*
- **Atomic vault-as-counterparty fill path** — the one genuinely new on-chain component: a contract
  path that flash-sources the OUT asset from inventory / an idle adapter, takes the IN asset, delivers
  the OUT asset at the quoted price under an `amountOutMinimum` floor, and records the inventory
  delta. *(On-chain.)*
- **Best-ex wiring for the vault quote** — feed the vault quote into `pickBest` alongside LI.FI (the
  comparator itself is reused unchanged).
- **⚠ On-chain `MWRouter.sol`** — the router README (`lib/web2/router/README.md`) claims
  `contracts-v4/src/MWRouter.sol` + `MWRouter.t.sol` + `contracts-v4/script/DeployMWRouter.s.sol` +
  the `router_pools` Supabase migration all exist and are tested. **In this worktree
  (`feat/the-math-page`) none of those files are present** — `find` turns up no `MWRouter*`, no
  `DeployMWRouter*`, and no `*router_pools*` migration. The off-chain TS brain is real and tested;
  the on-chain execution contract and its registry migration are either on a different branch or not
  yet committed here. **Treat the on-chain execution leg as not-in-tree and verify its actual state
  before planning any deploy.** The internalization fill path would extend or replace this
  (still-to-be-located) execution contract anyway.

The distribution of work is therefore: **mostly off-chain** (quoting, inventory, risk, toxicity) plus
**one new on-chain fill path** (and first, locating/finishing the base `MWRouter` execution leg the
current provider code already calls).

---

## 11. Sequencing

Ship the smallest safe thing first, with the safety controls on from day one — never a "capture
first, add risk controls later" ordering.

1. **Land the base router execution leg.** Locate or (re)build `MWRouter.sol` + its deploy script +
   the `router_pools` migration (the off-chain brain already expects them), deploy on Base Sepolia,
   list one pool, and prove the *existing* pool-routing path end-to-end with the flag on. This is
   prerequisite plumbing — internalization has nothing to execute against until the router carries a
   real swap.
2. **Start with benign, tight-market pairs only** — stablecoin pairs (USDC↔USDT) and blue-chip
   (USDC↔ETH). These have the lowest adverse selection and the tightest external quotes, so the
   best-ex bar is easy to clear and the inventory risk is smallest.
3. **Turn on best-ex + inventory bands + the toxicity filter from day one.** Do not internalize a
   single fill without: the `pickBest` best-ex guarantee (already built), inventory deviation bands
   that suppress the vault quote when a fill would overload the book, and the toxicity filter routing
   informed flow out. Junior-tranche isolation of market-making PnL is in this first cut, not a
   later hardening pass.
4. **USDC→ETH flash-fill as the first concrete instance** (§5) — one direction, small size caps,
   tight bands, heavy logging of realized-vs-quoted spread so the captured-edge assumption in §9 can
   be *measured* and replaced with real data before scaling size or adding pairs.
5. **Only then** widen: larger size caps, more pairs, netting across pairs, and external hedging of
   residuals — each gated on the measured edge staying positive after hedging cost, and on external
   audit of the new on-chain fill path before any mainnet value.

---

### Appendix — key files referenced

| Concern | File |
|---|---|
| Orchestrator / decision | `lib/web2/router/index.ts` |
| Best-ex comparator (reused, unchanged) | `lib/web2/router/pickBest.ts` |
| Internal quote + `QuoterReader` seam (where the inventory quoter attaches) | `lib/web2/router/internalQuote.ts`, `lib/web2/router/quoterReader.ts` |
| Router fee skim + cap | `lib/web2/router/fee.ts` |
| Pool listing registry | `lib/web2/router/listing.ts` |
| Kill switch + on-chain config | `lib/web2/router/config.ts` |
| Server route | `app/api/(web2)/swap/best-route/route.ts` |
| Client providers | `lib/web2/providers/lifi.ts`, `lib/web2/providers/mwInternal.ts` |
| Swap hooks | `hooks/useQuote.ts`, `hooks/useSwap.ts` |
| Vault inventory / tranching | `contracts-v4/src/payments/MintwareTreasuryVault.sol` |
| Settlement gateway | `contracts-v4/src/payments/MintwarePaymentGateway.sol` |
| Oracle-bounded ETH↔USDC (precedent for flash-fill machinery) | `contracts-v4/src/payments/MintwareEthSettlement.sol` |
| Idle-yield adapters (hot-path flash-source) | `contracts-v4/src/vaults/{AaveV3YieldAdapter,MintwareERC4626YieldAdapter,MintwareMultiVenueYieldAdapter}.sol`, `IYieldAdapter.sol` |
| Router env flags | `.claude/rules/deployments.md` |
