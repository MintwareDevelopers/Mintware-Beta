# Krystal LP Automation & Position Management — Research + Mapping to Our LP Gateway

> **Purpose.** Distil Krystal's LP position-management + automation surface into a buildable
> spec, then map each feature to **our** LP Gateway (single-sided USDG → Morpho stage → owner
> deploys a capped fraction into an existing Uniswap-V4 pool at a **fixed wide range ±22980**,
> harvest fees into a spendable buffer — *"spend from yield, never your position"*; curated one
> pool per gateway, non-custodial, testnet on Robinhood Chain).
>
> **Confidence tags.** `[C]` = confirmed across Krystal docs (`docs.krystal.app`, incl.
> `llms-full.txt` corpus) + corroborating search. `[~]` = inferred / single-source / industry-general.
> Sources listed at the bottom. Research date: 2026-09-07.

---

## 1. What Krystal is

An automated **liquidity-farming manager** over third-party concentrated-liquidity DEXes
(Uniswap v3/v4, PancakeSwap v3, SushiSwap v3, Camelot, Quickswap, Thena, Aerodrome) across
~9 chains and 19+ DEXes. `[C]` Non-custodial: it drives *your* CL positions via smart
contracts; Krystal never takes principal, and users can withdraw directly from the contract
if the UI fails. `[C]` The whole thesis is that a user should never hand-tune ratios or ranges.

**The core contrast with us:** Krystal is a *general* manager — the user picks the pool,
the tokens (2–4), and the range, and toggles automations. **We are the opposite: a curated,
managed, single-sided, fixed-range gateway.** Many of Krystal's "automations" are things we
*already embody structurally* (auto-managed range, auto-harvest). Krystal's value is therefore
mostly in the **tracking + transparency + alerting** layer, which is where our genuinely-new
adoption opportunities sit.

---

## 2. Feature inventory (Krystal)

### 2.1 Zap / single-token entry & exit `[C]`

| Feature | What it does |
|---|---|
| **Zap In** | Provide/increase liquidity with **one supported token in one transaction** — Krystal computes the correct pool ratio and combines swap + add-liquidity into a single tx. No pre-balancing. |
| **Zap Out** | Remove all liquidity + unclaimed fees and swap it to **any single token** the user prefers, in one tx. |
| **Adjust** | Withdraw all liquidity incl. unclaimed fees, then re-add into a **new range** (a rebalance the user triggers manually). |
| **Compound** (manual) | Claim unclaimed fees and add them back into the *current* position. |
| **Migrate to Vault** | Convert an existing LP strategy/position into an Auto-Farm Vault via a "Migrate to Vault" button. |
| **Migrate across pools/DEXes** | Rebalance/Adjust lets you move to a different price tier; position migration is Zap-Out → Zap-In under the hood. |

### 2.2 Automation `[C]`

| Automation | Trigger | Key config knobs |
|---|---|---|
| **Auto-Rebalance** | Fires when actual price falls outside a **Trigger Prices** band. | Lower/Upper Trigger Prices (absolute **or** % vs current price); **New Range** (the range to rebuild into after rebalance); **Time Buffer** (price must stay out-of-band for N time before firing — anti-whipsaw); **Gas Fee Ceiling** (max gas willing to pay; skips if exceeded). |
| **Auto-Compound** | By **Time** (interval) **or** by **Fee** (fee threshold reached). | **Minimum Fees** lower bound to activate; **Gas Fee Ceiling** = max gas, capped at **30% of Earned Fees**; one-time or recurring. |
| **Auto-Exit** | Price crosses a Trigger Prices band (acts as **stop-loss / take-profit / auto-close**). | Same Lower/Upper Trigger Prices + Time Buffer; Gas Fee Ceiling; Platform Fee. Closes the position when conditions are met. |
| **Auto-Harvest** | Periodically claims fees/rewards. | (bundled into vault automation) |

### 2.3 Managed / vault products `[C]`

| Product | Shape |
|---|---|
| **Auto-Farm Vault** | "Next-gen farming vault" — user states farming *goals* (risk level, return mode, style); an **AI Agent designs + runs** the strategy across multi-pool/multi-asset (no single principal-token limit). |
| **Community Vaults** | A vault **owner** picks 2–4 tokens + LP strategy; public participants just deposit. Owner can earn a commission. |
| **Krystal-managed vaults** | "Curated strategies run directly by our team" for various risk profiles. |
| Vault deposit/withdraw | Deposit a supported token + amount. Withdraw via **Zap-out** (→ single token) or **Manual** (→ vault's current assets); choose a %. |

**Note:** vaults are *multi-asset* — **not** single-token principal. This is the biggest
structural divergence from our model.

### 2.4 Position tracking & analytics `[C]`

| Metric | Definition (as documented) |
|---|---|
| **Positions Value** | Total liquidity + unclaimed fees & rewards; real-time value **and** value at deposit time. |
| **Earnings** | Total claimed + unclaimed fees & rewards. |
| **Profit & Loss** | `current position value + withdrawals + claimed fees&rewards − deposited value`. |
| **APR** | `(24h earning × 365) / current liquidity × 100%`. |
| **Per-position row** | Liquidity, PnL, 24h Earnings, APR, Price Range, **Age**. |
| **Graphs** | Earning graph (daily fees/rewards) + Performance graph (total LP portfolio value); filters **24h / 7D / 30D / 90D / 1Y**. |
| **Portfolio dashboard** | Total LP value + total fees generated, aggregated across chains/DEXes. |

> **IL-vs-HODL:** Krystal markets rebalancing as "minimizing impermanent loss," and its PnL is
> measured vs *deposited value* — but an explicit **IL-vs-HODL** comparison line is **not**
> documented `[~]`. Treat IL-vs-HODL as an adjacent/industry idea, not a copied Krystal feature.

### 2.5 Alerts / notifications

**ABSENT from Krystal's docs.** `[C]` No out-of-range alert, price alert, or
Telegram/email/push channel is documented. Automations *act* on triggers, but there is no
documented *notify-the-user* surface. Out-of-range alerting is an industry-standard LP tool
(email/Telegram/webhook) `[~]` — so it's a **genuinely new** idea for us to adopt, not a copy.

### 2.6 Fees & business model `[C]`

| Fee | Amount |
|---|---|
| Auto-Farm Vault performance fee | **10%** of generated rewards; *no* extra fee for automation/zap/rebalance inside a vault |
| Community Vault | 10% default (5% if sharing activated) + owner-set commission |
| Zap fee (dynamic by pool tier) | ≤0.05% → **0.05%** · 0.05–0.3% → **0.1%** · >0.3% → **0.25%** of zap amount |
| Auto-Rebalance / Auto-Exit | **0.01% / 0.03% / 0.05%** of LP position (by tier) |
| Auto-Compound / Auto-Harvest | **2%** of generated LP fees |
| Manual Rebalance / Compound | 0.05% / 0.1% / 0.25% (by tier) |
| Swap fee | **0.1%** of swap volume |
| Custody | Non-custodial; funds withdrawable directly from contract |

**Takeaway:** Krystal monetises the *action* (zap, rebalance, compound) + a vault performance
fee. Gas is user-paid with a ceiling guard. This is a clean precedent for our own fee posture.

---

## 3. Mapping to OUR LP Gateway — KEEP / ADAPT / OMIT

Legend: **KEEP** = adopt roughly as-is · **ADAPT** = reshape to our managed/single-sided/buffer
model · **OMIT** = doesn't fit a curated single-pool gateway · **ALREADY** = we structurally
embody this, so it's not new work (surface it as a *story*, don't rebuild the mechanism).

### 3.1 Zap / entry / exit

| Krystal feature | Verdict | Notes for us |
|---|---|---|
| Zap In (single-token, swap+add, 1 tx) | **ALREADY (ADAPT wording)** | Our deposit is *already* single-token (USDG). We don't swap-and-add into two sides; we stage into Morpho and the owner deploys at a fixed range. **We are "zap-in" by construction** — market it as "deposit one token, we do the rest," but we do **not** need Krystal's ratio-swap engine. |
| Zap Out (→ any single token) | **ADAPT** | Our withdraw should return USDG (single token). Reuse Krystal's "choose %, review est. amount + fee, confirm" UX. Because our position sits at a fixed wide range + a Morpho buffer, "zap out" = unwind buffer + pro-rata redeem — simpler than Krystal's arbitrary-token swap. |
| Adjust / manual re-range | **OMIT** | Users never pick or change ranges — the range is fixed (±22980) and owner-managed. Exposing this would break the "we manage it" promise. |
| Manual Compound | **OMIT (as a user action)** | Harvest is our job, not the user's. See auto-harvest below. |
| Migrate to Vault / cross-pool migration | **OMIT (v1)** | One pool per gateway, curated. No user-driven migration. (A curator-side "retire gateway / move pool" op is an operator concern, not a user feature.) |

### 3.2 Automation

| Krystal automation | Verdict | Notes for us |
|---|---|---|
| **Auto-managed range** (their Auto-Rebalance) | **ALREADY** | We hold a **fixed wide range ±22980** and manage deployment ourselves. We don't chase price with a rebalancer — the wide band + curation *is* our range strategy. Do **not** build a trigger-band rebalancer; it contradicts the model. (If we ever want it, it's a curator tool, never a user toggle.) |
| **Auto-Harvest / Auto-Compound** | **ALREADY (harvest) + ADAPT (compound target)** | We already harvest fees → **spendable buffer**. Krystal compounds fees *back into the position*; **we deliberately do the opposite** — "spend from yield, never your position." So: keep auto-harvest; **the "compound destination" is the buffer, not the LP.** Optionally offer a per-gateway toggle: *harvest→buffer* (default) vs *harvest→restake buffer into Morpho* for users who want to compound rather than spend. That toggle is the one genuinely-useful borrow from auto-compound. |
| **Gas Fee Ceiling / Min-Fee threshold** on harvest | **ADAPT (new, worth adopting)** | Krystal only harvests when fees clear a **Minimum Fees** floor and gas is under a **Gas Fee Ceiling** (capped 30% of earned fees). We should gate our harvest cron the same way so we don't burn gas dust-harvesting a thin pool. Cheap, high-value guard. |
| **Auto-Exit (stop-loss / take-profit)** | **ADAPT (curator-side, optional)** | A user-facing stop-loss contradicts "never your position." But a **curator/operator circuit-breaker** — auto-pull the deployed fraction back to Morpho if the pool deviates beyond a band or depth collapses — is exactly the safety valve our fixed-range model needs. Frame as protocol-level de-risking, not a user order. |
| **Auto-Farm AI Agent vault** | **OMIT** | We *are* the managed strategy; a goal-driven multi-pool AI agent is out of scope and off-thesis (curated single pool). |
| **Community Vaults (owner-run)** | **OMIT (v1)** | Interesting long-term (a "gateway owner" who curates a pool and earns commission maps to our gateway-per-pool shape), but not v1. Park it. |

### 3.3 Tracking & analytics — **the richest adoption area**

| Krystal metric | Verdict | Notes for us |
|---|---|---|
| Positions Value (now vs at-deposit) | **KEEP** | Show deployed LP value + Morpho-staged value + buffer, now vs deposit. |
| Earnings (claimed + unclaimed fees) | **KEEP** | Our version: fees harvested → buffer (spendable) + Morpho yield accrued. Split "spendable (buffer)" vs "earning (staged)". |
| **PnL vs deposited value** | **KEEP** | `current gateway value + withdrawals + spent-from-buffer − deposited USDG`. Direct analogue. |
| **APR** `(24h earning×365)/liquidity` | **KEEP** | Compute blended APR = Morpho yield (staged portion) + LP fee APR (deployed portion). Our headline number. |
| Earning + Performance graphs, 24h/7D/30D/90D/1Y | **KEEP** | Daily buffer-accrual graph + total-value graph. Strong trust signal. |
| **In-range %** (time position spent in range) | **ADAPT (new, worth adopting)** | Because our range is *fixed wide*, "in-range %" becomes a **health metric of our curation**: what fraction of time the pool price sat inside ±22980 (i.e. actually earning fees). Surfacing it proves the wide band works. Genuinely new for us. |
| **IL-vs-HODL** line | **ADAPT (new, worth adopting)** | Not explicitly in Krystal, but the highest-value transparency add: show "your gateway value vs if you'd just held USDG." Since deposits are single-sided USDG and the deployed slice is capped, our IL surface is small and bounded — quantifying it *builds trust* rather than scaring users. Genuinely new. |
| Cross-chain/DEX portfolio dashboard | **OMIT / ADAPT-down** | We're one chain, one pool per gateway. Collapse to a single **gateway dashboard** (staged / deployed / buffer / harvested-to-date). |

### 3.4 Alerts / notifications — **all net-new for us**

| Idea | Verdict | Notes |
|---|---|---|
| **Out-of-range alert** | **ADAPT (new)** | Notify the *curator/operator* (and optionally depositors) when pool price exits ±22980 for > buffer-time (steal Krystal's **Time Buffer** anti-whipsaw idea) — so we know fees have stopped accruing and can decide to pull to Morpho. |
| **Buffer / harvest alerts** | **ADAPT (new)** | "Buffer topped up," "buffer low," "harvest skipped (gas ceiling)." |
| Price alerts | **OMIT** | Not our job; users aren't trading. |
| Channels (email / Telegram / push / in-app) | **ADAPT (new)** | Start with in-app + email; Telegram/webhook later. Krystal documents none, so no copy exists — design our own, small. |

### 3.5 Fees / business model

| Krystal fee | Verdict | Notes |
|---|---|---|
| Performance fee (10% of rewards) | **KEEP (as the model)** | Cleanest fit: take a **performance cut of harvested yield** before it hits the buffer. Aligns with "spend from yield." |
| Per-action zap/rebalance fees | **OMIT** | We don't expose those actions to users; no per-action monetisation. |
| Gas ceiling on automated actions | **KEEP** | Adopt for our harvest cron (see 3.2). |
| Non-custodial + direct-contract withdraw | **KEEP** | We're already non-custodial; document a direct-contract exit path as Krystal does. Reinforces the posture. |

---

## 4. What we ALREADY embody vs genuinely-NEW ideas

**Already embodied (surface as story/UX, don't rebuild the mechanism):**
- Single-token entry ("zap in") — we're single-sided USDG by construction. `[C→ours]`
- Auto-managed range — fixed wide ±22980, curator-managed (Krystal chases price; we don't). `[C→ours]`
- Auto-harvest — we already sweep fees to the buffer.
- Non-custodial posture + curated/managed strategy (their "Krystal-managed vaults" ≈ our curated gateway).

**Genuinely new — worth adopting (ranked):**
1. **IL-vs-HODL tracking** — "vs just holding USDG" line; bounded + trust-building for us. `[~]`
2. **Out-of-range alerting w/ Time-Buffer debounce** — operator + optional depositor notify when price leaves ±22980. `[C for Time-Buffer / ~ for alerting]`
3. **In-range % as a curation-health metric** — proves the wide band earns.
4. **Min-fee floor + gas-ceiling guard on the harvest cron** (cap ~30% of earned fees, Krystal's number). `[C]`
5. **Optional harvest destination toggle** (buffer-spend default vs restake-to-Morpho compound). `[C-adapted]`
6. **Performance-fee model** (a % of harvested yield) as the monetisation primitive. `[C]`
7. **Operator circuit-breaker "auto-exit"** — pull deployed slice back to Morpho on deviation/depth-collapse (curator-side, not a user stop-loss). `[C-adapted]`

**Explicitly OMIT (off-thesis for a curated, single-pool, single-sided, fixed-range gateway):**
user-driven re-ranging/Adjust, manual compound, cross-pool migration, goal-driven AI multi-pool
vaults, community owner-run vaults (park for later), per-action zap fees, price alerts.

---

## Sources
- Krystal Docs corpus — `https://docs.krystal.app/llms-full.txt` (Zap In/Out, Auto-Rebalance/Compound/Exit config, Auto-Farm/Community/Krystal-managed vaults, tracking metrics, full fee schedule)
- Provide Liquidity / Auto-Rebalance docs pages — `https://docs.krystal.app/products/liquidity-management/...`
- `https://krystal.app/` , `/arbitrum`, `/ethereum`, `/bnb` (supported DEXes/chains, farming pitch)
- Krystal on X — Zap In launch (single-token add) + "Auto-Rebalance / Auto-Compound / Auto-Exit / Auto-Harvest" announcement
- FAQ — `https://docs.krystal.app/faq`
- Industry-general (IL-vs-HODL, out-of-range alert channels) — corroborating search only `[~]`
