# Meteora DLMM — Pool Detail & Deposit Flow → LP-Gateway `/earn/[pool]` Spec

**Purpose.** Study Meteora's DLMM pool-detail + add-liquidity UX (the polished bar to clear), then
map each element to our **LP-Gateway** model and specify what `/earn/[pool]` (detail + deposit)
should show. Our mechanics are deliberately *much* simpler — single-sided USDG, no bins, no
strategy, no range picking — so the design job is: **feel as considered as Meteora while being
honest that the user makes almost no choices.**

> Sources (research only via WebSearch/WebFetch): Meteora docs (DLMM concepts, dynamic terminal),
> hashnode "Deep-Dive on Meteora DLMM", CEX.IO University Meteora review, Gate Learn DLMM guide.
> Meteora's GitBook docs 404 to WebFetch (JS SPA); labels below are corroborated across the
> tutorial write-ups + search snippets, not copied pixel-for-pixel.

---

## Part 1 — What Meteora's DLMM does (the reference)

### 1.1 Core mechanic (context for why their UI is complex)
- Liquidity is split into discrete **price bins** (a bin = one price step). Swaps *within* one bin
  have **zero slippage**.
- Exactly **one active bin** at a time (holds both tokens + earns fees). Bins left of it hold only
  token Y, bins right hold only token X → this is what makes **one-sided** deposits natural.
- An LP picks a **price range** spanning many bins (default **69 bins**, up to **1,400**). Capital
  earns **only while price is in range**; out-of-range = inactive, earns nothing until rebalanced.
- Fees = **base fee** + **variable/dynamic fee** (rises with volatility; ~0.01%–1%).

### 1.2 Pool detail page — elements
| Element | What it shows |
|---|---|
| **Header** | Token pair, current price, bin step, dynamic-fee badge |
| **Stat row** | **TVL**, **24h Volume**, **24h Fees**, **24h Fee/TVL** (the headline yield proxy, e.g. `0.82%`), APR (= Fee/TVL × 365) |
| **Price chart** | Price history for the pair |
| **Liquidity-distribution / bin chart** | Bars per bin showing depth across price; **active bin** highlighted; your position overlaid |
| **Your Position panel** | Deposited amounts (both tokens), current value, **unclaimed fees**, range vs current price, active/inactive status |
| **Action buttons** | Add Liquidity · Withdraw · Claim Fees · Close Position |

### 1.3 Add-liquidity flow — step by step
1. **Open** — "Add Liquidity" opens the deposit terminal.
2. **Amount input(s)** — enter token amount(s). **Balanced** (both) or **one-sided** (single asset).
3. **Autofill toggle** — on = the second amount is auto-computed from range+strategy; **off** =
   you type one side only (single-sided position).
4. **Range selection** — three interchangeable inputs:
   - Drag the **range slider / circle handles** on the bin chart (narrow, up to 69 bins),
   - type **Min / Max price** directly (widen up to 1,400 bins),
   - or set **Min% / Max%** (distance from active bin as a %).
5. **Strategy preset** — **Spot** (uniform across range), **Curve** (concentrated at center/current
   price), **Bid-Ask** (concentrated at the edges; DCA-in/out shape). Preview re-renders the bin
   bars live.
6. **Slippage** — max slippage tolerance for the add.
7. **Confirm + sign** — "Add Liquidity" → wallet signature → position appears in portfolio.

### 1.4 Position management
- **Claim fees** — collect accrued fees (some flows fold this into withdraw).
- **Add** — top up an existing position (can layer a different strategy).
- **Withdraw** — remove liquidity (partial or full); "Withdraw & Close" also claims + closes.
- **Close** — burns the position, returns both tokens.
- **Out-of-range warning** — inactive positions earn nothing; prompt to rebalance.
- **Empty / first-time** — no position → the deposit terminal is the primary surface + explainer.

---

## Part 2 — Our LP-Gateway model (what we're actually building)

**Flow:** single-sided **USDG** deposit → stages in **Morpho** (Steakhouse USDG 4626, earns from
block 1) → owner/cron deploys a **capped fraction** into an **existing third-party Uniswap-V4 pool**
(Robinhood Chain 4663; meme/USDG tiers) at a **FIXED wide range (±22980 ticks)** → **harvest** fees
(zero-liquidity-delta collect, never principal) into a **spendable buffer**. One share class; staging
is the position manager's internal idle reserve. Withdraw returns pro-rata of both legs (IL-exposed).

**The single sentence:** *"Deposit USDG. It earns immediately, provides liquidity, and you spend the
**fees** — never your principal. No range, no rebalancing."*

**Hard honesty lines (from repo legal rules — never violate in copy):**
- No "deposit / savings / guaranteed / fixed APY / par / principal-protected."
- Meme/thin/volatile pools → **real IL exposure**; withdrawal is pro-rata of both legs, not 1:1.
- Phase-1 is **testnet-first, unaudited, flag-gated** → say so; the "live, no hedging" voice is for
  post-audit real value, not now.

---

## Part 3 — Element-by-element mapping (KEEP / ADAPT / OMIT)

### 3.1 Pool detail page
| Meteora element | Decision | Our version |
|---|---|---|
| Token-pair header | **ADAPT** | "Put USDG to work in **PONS / USDG**" — USDG is the deposit asset; the paired leg is the *venue*, not something the user supplies. |
| Current price / bin step | **OMIT** | User picks no price; irrelevant to their action. (Keep internally for NAV.) |
| **TVL** | **KEEP** | Gateway position TVL (Morpho reserve + deployed V4 legs), our share of pool. |
| **24h Volume**, **Volume/TVL** | **KEEP** | Pool activity = the reason fees exist. Label honestly as pool-level. |
| **24h Fee/TVL** | **ADAPT** | Keep as the yield proxy, but split the story: **Morpho base APY** (real, ~1.9–2.5%) + **pool fee share** (variable, illustrative until indexer). Never sum into one "APY" number. |
| **APR** (Fee/TVL×365) | **ADAPT → "recent fee rate"** | Show a *trailing realized* rate, clearly "past 7/30d, not a projection." No forward APY headline. |
| Price chart | **OMIT (v1)** → optional later | Replace with a **"where your USDG is" allocation view** (Morpho reserve vs deployed vs buffer). |
| **Bin / liquidity-distribution chart** | **ADAPT (signature)** | We have no bins, but the distribution chart is Meteora's most polished element. Reuse the *form*: a horizontal band showing the pool's V4 liquidity depth with **our fixed ±22980 range shaded** and the current price marked → visually proves "wide range, always in range." This is our one hero visual. |
| Dynamic-fee badge | **OMIT** | We don't set fees. Optionally show the pool's fee tier as read-only metadata. |
| **Your Position panel** | **KEEP** | Shares, current value (offset-consistent from `positionReader`), **PnL**, **spendable buffer (harvested fees)**, allocation breakdown. |
| Active/inactive range status | **ADAPT → "In range"** | Because range is fixed and wide, show a reassuring **"In range ✓"** state; only warn if price exits ±22980 (rare, but honest). |

### 3.2 Deposit flow
| Meteora step | Decision | Our version |
|---|---|---|
| Amount input(s) | **KEEP (one only)** | Single **USDG amount** field + balance + Max. |
| Balanced vs one-sided | **OMIT** | Always single-sided USDG. State it as a *feature* ("no second token needed"). |
| Autofill toggle | **OMIT** | Nothing to autofill. |
| Range slider / Min-Max / Min%-Max% | **OMIT** | Range is protocol-fixed (±22980). Replace with a **read-only "Range: full-width, managed for you"** line + one-tap "why?" explainer. |
| Strategy presets (Spot/Curve/Bid-Ask) | **OMIT** | No strategy choice. Optionally a static "how it's deployed" diagram in the explainer. |
| Slippage | **ADAPT (hidden default)** | Deposit into Morpho has ~none; the V4 zap (paired-leg swap) has slippage but happens **later, cron-side, not in the user's tx**. Expose an **advanced** slippage only if the deposit path ever swaps at deposit time; default hidden. |
| Confirm + sign | **KEEP** | Approve USDG (Permit2) → deposit tx → wallet sign. Non-custodial: verify client tx, mirror `gateway_positions`. |
| Post-deposit state | **KEEP** | Show new position + "your USDG is already earning in Morpho; it'll join the pool at the next deployment." Set expectation that V4 deployment is **owner/cron-batched, not instant**. |

### 3.3 Position management
| Meteora action | Decision | Our version |
|---|---|---|
| Claim fees | **ADAPT → "Spend / buffer"** | Fees are auto-harvested to the **spendable buffer** (card/x402), not a manual claim. Surface the buffer balance + "Spend" affordance instead of a Claim button. |
| Add | **KEEP** | Add more USDG to the same position (same single field). |
| Withdraw | **KEEP (honest)** | Partial/full; **pro-rata of both legs, IL-exposed** — show an estimate + a "may differ from deposit due to price movement" note. |
| Close | **MERGE into Withdraw** | Full withdraw = close (one share class). |
| Out-of-range warning | **ADAPT** | Rare given wide fixed range; keep the plumbing, show only if breached. |
| Empty / first-time | **KEEP** | No position → lead with the one-sentence value prop + single USDG field + the allocation/range hero visual. |

---

## Part 4 — `/earn/[pool]` page spec (buildable)

Existing file: `app/earn/[pool]/page.tsx` (currently a public, login-gated **preview** with an
illustrative stat row + connect CTA). Existing data: `lib/gateway/positionReader.ts`
(`readGatewayPosition`, `positionValueAtomic`), `discovery.ts`, `harvestMath.ts`. Design system:
`V2Nav`, `GradientPanel`, `soft-card`, `glass-pill-primary`, peri/ink tokens.

### 4.1 Layout (top → bottom)
1. **Hero** *(exists, keep)* — eyebrow "Earn — pool preview", `USDG in {PAIR}`, one-sentence value
   prop, stat row (`TVL`, `Volume / TVL`, `Fee / TVL (24h)`), primary CTA. Add a **testnet/phase-1
   honesty chip** near the CTA.
2. **Allocation + range hero visual** *(new — the signature element)* — horizontal band:
   `Morpho reserve │ Deployed in {PAIR} V4 │ Spendable buffer`, plus the **±22980 range shaded over
   pool depth** with current price marked. This is the Meteora-bin-chart analogue.
3. **Yield breakdown** *(new)* — two honest rows, never summed:
   - `Morpho base — ~X% APY (real)`
   - `Pool fee share — illustrative until indexer / trailing Nd realized`
4. **Deposit card** *(new — replaces Meteora terminal)*:
   - Single **USDG amount** field + balance + Max.
   - Read-only meta: `Range: full-width, managed` · `Venue: {PAIR} on Robinhood Chain` ·
     `Yield source: Morpho (Steakhouse USDG)`.
   - CTA: connected → "Deposit USDG"; disconnected → "Connect to deposit".
   - Fine print: IL exposure, testnet, non-custodial, deployment is batched.
5. **Your Position panel** *(new, gated on connection + `gateway_positions` row)*:
   - Shares · current value · PnL · **spendable buffer** · allocation split.
   - Actions: **Add** · **Withdraw** (pro-rata/IL note) · **Spend from buffer**.
   - Empty state → collapses to just the deposit card + explainer.
6. **"How it works" explainer** *(exists/expand)* — stage → deploy → harvest → spend; the
   "why no range/strategy" answer.

### 4.2 Data sources
| UI | Source |
|---|---|
| TVL / Volume / Fee-TVL | `lib/gateway/discovery.ts` (indexer; ILLUSTRATIVE map until live — keep the explicit "illustrative" labelling already in the file) |
| Position value / PnL / shares | `lib/gateway/positionReader.ts#readGatewayPosition` |
| Buffer balance | `card_spend_buffers.buffer_balance_atomic` (gateway-credited via harvest) |
| Deposit / withdraw | `/api/gateway/{deposit,withdraw}` (non-custodial: verify client tx → mirror `gateway_positions`) |
| Morpho APY | Morpho/Steakhouse vault read (or config until wired) |

### 4.3 Copy guardrails (enforce)
- Deposit asset = "USDG"; paired token = "the pool", never "you provide X and Y".
- Never "APY" as a single headline number; split real (Morpho) vs variable (fees).
- Withdrawal copy states IL / pro-rata explicitly.
- Testnet + unaudited + flag-gated stated on-page while true.
- No "spend your principal" — always "spend the **fees**."

### 4.4 Build order
1. Real stat row from `discovery.ts` (drop ILLUSTRATIVE when indexer lands; keep label).
2. Allocation + fixed-range hero visual (SVG band; the polish investment).
3. Deposit card (single field → `/api/gateway/deposit`, Permit2 + sign).
4. Your Position panel from `positionReader` + buffer.
5. Withdraw (IL-honest) + Add.
6. "Spend from buffer" link into the existing card/x402 buffer surface.
