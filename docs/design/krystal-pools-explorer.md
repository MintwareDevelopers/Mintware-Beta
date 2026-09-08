# Krystal DeFi Pools Explorer — Research + Mapping Spec

> Research target: `https://defi.krystal.app/pools` ("Hot Pools" / Explorer) and its per-pool
> analytics, mapped to the Mintware **LP-gateway** Discover + pool-detail surface.
>
> **Method / confidence.** The site is a client-rendered SPA that does not return content to
> `WebFetch`, so every claim below is corroborated across Krystal's own docs (`docs.krystal.app`,
> incl. `llms-full.txt` and the `.md?ask=` API), the Krystal Cloud API reference
> (`cloud.krystal.app`), and search snippets. Items are tagged **[confirmed]** (stated in docs/API)
> or **[inferred]** (implied by the SPA header, a search snippet's paraphrase, or standard v3/v4
> mechanics — verify against the live UI before building to it).

---

## 1. What Krystal is (context for the mapping)

Krystal bills itself as a "Liquidity Farming Agent": an aggregator + manager for **concentrated
liquidity** LP positions. The Explorer ("Hot Pools") aggregates on-chain pool data from **9
blockchains and 8 protocols** [confirmed] — Uniswap (v2/v3/v4-style), PancakeSwap, Sushi,
Aerodrome, Camelot, Thena, etc. across Base, BSC, Ethereum, Arbitrum, Optimism, Polygon, Ronin,
Solana, and Robinhood Chain. The Explorer is a **shopping surface**: rank/filter every pool, then
one-click **Zap-In** to LP.

The Explorer has three tabs [confirmed]:
- **Hot Pools** — curated top-5 leaderboards: **Best APR**, **Best Blue-chip**, **Best Stable Coin
  Pairs**, plus overall top pools + top wallets.
- **All Pools** — the full filterable/sortable table.
- **Top Wallets** — successful LPs, filterable by performance/chain (study proven strategies).

---

## 2. The Pools LIST — columns & metrics

| Metric / column | Confirmed? | Notes |
|---|---|---|
| **Pair** (token0 / token1 + logos) | [confirmed] | Token symbols, addresses, decimals, logos (Cloud API `token0`/`token1`). |
| **Protocol / DEX badge** | [confirmed] | Which DEX + version (v2 uniform vs v3/v4 concentrated). Drives APR math (see §3). |
| **Chain badge** | [confirmed] | One of 9 chains. |
| **Fee tier** | [confirmed] | Pool fee tier. Krystal buckets tiers into ≤0.05% / 0.05–0.3% / >0.3% (used for dynamic zap fees). |
| **TVL** | [confirmed] | Total value locked (USD). Sortable. |
| **24h Volume** | [confirmed] | Sortable. API also exposes 1h / 7d / 30d windows. |
| **24h Fees** | [confirmed] | LP trading fees earned, USD. Sortable. |
| **APR** | [confirmed] | Annualized; **combines fee APR + farm/reward APR** (see §3). Cloud API returns `feeApr` and incentive/farm APR **separately**. |
| **Reward / farm APR** | [confirmed] | Separate incentive stream (e.g. Merkl rewards) with token, daily USD value, own APR. |
| **Volume / TVL ratio** | [confirmed] | Filter/rank metric; capital-efficiency proxy (higher = more fees per $ TVL). |
| **Drawdown** | [confirmed as filter] | Max decline in pool value from a peak — downside-risk signal. [inferred: exact window]. |
| **Volatility** | [confirmed as filter] | Price fluctuation of the pair's assets — risk signal. [inferred: exact window/definition]. |
| **In-range status** | [inferred] | A position-level concept (is the LP's range active); referenced but not confirmed as a LIST column. |
| **IL / net-of-IL** | [inferred: NOT in list] | IL is offered only via the detail-page **simulator**; the listed APR is **gross** (fees + rewards), not net-of-IL. |

**Sort options** [confirmed]: APR, TVL, 24h Vol, 24h Fees (and "so on" — the risk metrics above are
also rankable).

**Search** [confirmed]: by token **name or address**.

**Pagination** [inferred]: standard paged/infinite table (not documented explicitly).

---

## 3. How APR is computed & presented

**Exact formula** [confirmed]:

```
APR = (24h earning × 365) / Current liquidity × 100%
```

- **Trailing window:** 24h earnings annualized (×365). It is a **trailing/realized** rate, not a
  forward projection. (Cloud API also exposes 1h / 7d / 30d stats, so other windows exist server-side.)
- **Components** [confirmed]: `24h earning` = LP trading fees **+ farming/reward incentives** (e.g.
  Merkl). Cloud API keeps `feeApr` and incentive/farm APR as **separate fields** → the UI can show a
  breakdown (fee APR vs reward APR) that sums to total APR.
- **Concentrated vs uniform** [confirmed]: for v3/v4 concentrated pools, "Current liquidity" is the
  liquidity **in the active price range**, so **narrower ranges display higher APR**; v2-style
  uniform pools use total pool liquidity.
- **Known caveat** [confirmed]: large deposits/withdrawals skew the ratio (historical 24h earning vs
  changed current liquidity) → APR display is approximate.
- **Net-of-IL:** the listed APR is **gross**; IL is a separate detail-page simulation, never
  subtracted from the headline APR.

**Ranking / scoring.** No single opaque composite score is documented. Ranking = sort on any one
metric, plus the curated Hot-Pools leaderboards (Best APR / Best Blue-chip / Best Stable) which are
**category filters over the same metrics**, not a proprietary score. Risk metrics (drawdown,
volatility, vol/TVL) exist as **additional independent rank axes**, not folded into one number.

---

## 4. Risk / quality signals per pool

| Signal | Confirmed? | Notes |
|---|---|---|
| **Drawdown** | [confirmed] | Downside risk (peak-to-trough pool value). |
| **Volatility** | [confirmed] | Asset price-swing risk. |
| **Volume / TVL** | [confirmed] | Efficiency/health (sustained volume vs parked capital). |
| **Blue-chip / stable categorization** | [confirmed] | Via the Hot-Pools leaderboards. |
| **Vault "Evaluation" risk signals** | [confirmed, vaults] | System-generated risk notes appear on **Vault** detail pages (a different product than raw pools); includes explicit IL risk + "no performance guarantees". |
| Audited / verified-token badge | [inferred / not found] | Not documented for the pool list. |

Takeaway: Krystal's per-pool risk is **quantitative market signals** (drawdown / volatility /
vol-TVL), not a token-safety/audit attestation.

---

## 5. Per-pool DETAIL page

| Element | Confirmed? | Notes |
|---|---|---|
| **Historical performance charts** | [confirmed] | Time-series (TVL / volume / fees / APR over 1h/24h/7d/30d windows the API exposes). |
| **Fee-generation simulator** | [confirmed] | Simulate fees from **your** liquidity size + chosen price range. |
| **Impermanent-loss simulator** | [confirmed] | Simulate IL given **expected future prices**. |
| **Price chart** | [inferred] | Standard; implied by simulators needing price history. |
| **Liquidity-distribution chart** | [inferred] | Expected for concentrated pools (range picker) but not explicitly documented. |
| **Zap-In CTA** | [confirmed] | One-click single-asset entry into the pool. |

---

## 6. Filter model (multi-protocol × multi-chain)

- **Chain** multi-select (9 chains) [confirmed].
- **Protocol/DEX** multi-select (8 protocols) [confirmed].
- **Token** name/address search [confirmed].
- **Metric filters/rank**: APR, TVL, 24h Vol, 24h Fees, drawdown, volatility, vol/TVL [confirmed].
- Underlying data via Cloud API `GET /v1/pools` (list across chains/protocols) and
  `GET /v1/pools/:chainId/:poolAddress` (detail) [confirmed].

---

## 7. Mapping to OUR LP-gateway (KEEP / ADAPT / OMIT)

**Our reality.** A user deposits a **single quote asset (USDG)** into **ONE curated Uniswap-V4 pool
per gateway** on **Robinhood Chain**. We already pull **GeckoTerminal** metrics (TVL, 24h volume,
current price, 24h trades), read **pool fee tier on-chain**, compute a trailing **Est. APR
(24h fees ÷ TVL)**, and attach a **curator risk score**. Our "Discover" = a small list of curated
gateways (not a 1000-row multi-chain table); our "pool-detail" = one gateway page.

| Krystal element | Verdict | How it maps to us |
|---|---|---|
| Pair (token0/token1) | **KEEP** | Show pool pair from GeckoTerminal; frame our side as the USDG entry. |
| DEX/protocol badge | **OMIT** | Single-protocol (Uniswap V4). A static "Uniswap V4" tag is enough — no aggregation. |
| Chain badge | **OMIT / static** | Single chain (Robinhood). Show once, not a filter. |
| Fee tier | **KEEP** | Already read on-chain; display it, and bucket like Krystal (≤0.05 / 0.05–0.3 / >0.3%) for a quick "cost/vol" read. |
| TVL | **KEEP** | Have it (GeckoTerminal). |
| 24h Volume | **KEEP** | Have it. GeckoTerminal also gives 6h/1h → optional shorter windows. |
| 7d Volume | **ADAPT** | GeckoTerminal exposes multiple windows; add 7d if the endpoint returns it, else omit. |
| 24h Fees | **ADAPT** | Derive = 24h volume × fee tier (we have both) rather than a direct fees feed. Label as derived. |
| **APR (fee)** | **KEEP** | Our "Est. APR = 24h fees ÷ TVL × 365" is **the same formula** as Krystal's. Rename to match: annualize explicitly, label "trailing 24h, gross of IL." |
| Reward/farm APR | **OMIT** | No external farm incentives on our curated V4 pools today. If a gateway ever carries incentives, add as a separate line (Krystal keeps them separate). |
| Volume/TVL ratio | **KEEP (cheap win)** | Pure derive from data we already have; strong capital-efficiency signal for a curated meme pool. Add to detail + as a curator input. |
| Volatility | **ADAPT** | Use GeckoTerminal price-change % over 24h/7d as a volatility proxy; feed into curator score. |
| Drawdown | **ADAPT** | Approximate from price history (peak-to-trough) if we snapshot price; otherwise defer. |
| In-range status | **OMIT (list) / ADAPT (detail)** | Not a list column for us. On detail, once a deposit exists we can show whether the gateway's V4 range is active. |
| IL figure | **OMIT (headline)** | Keep APR gross like Krystal; never subtract IL from the number. |
| IL simulator (detail) | **ADAPT (later)** | High-value but non-trivial; a "what-if price move → IL" widget fits our single-asset story. Phase 2. |
| Fee-gen simulator (detail) | **ADAPT** | "Deposit $X → est. fees at current APR" is trivial for us (single-asset, one pool) and directly answers the user's question. Phase 1. |
| Historical charts (TVL/vol/fees/APR) | **ADAPT** | Requires snapshotting GeckoTerminal metrics on a cron into a small time-series table; then chart. Phase 2. |
| Liquidity-distribution chart | **OMIT (Phase 1)** | Nice for V4 but needs on-chain tick reads; defer. |
| Curated leaderboards (Best APR/Blue-chip/Stable) | **ADAPT** | Our whole product *is* curation — surface the **curator risk score** + a one-line "why curated" instead of auto leaderboards. |
| Per-pool risk signals | **KEEP + extend** | Keep our curator risk score as the headline; back it with Krystal-style quant signals (volatility, vol/TVL, TVL floor). Show the score's inputs, not just a number. |
| Multi-chain/multi-protocol filters | **OMIT** | N/A — single chain, single protocol, curated set. |
| Token name/address search | **ADAPT** | Small curated list → a simple filter/search is optional; keep if the list grows. |
| Zap-In (single-tx single-asset entry) | **KEEP (it's our core)** | Our USDG single-asset deposit *is* the Zap. Make the deposit CTA as prominent as Krystal's Zap-In. |
| Top Wallets tab | **OMIT** | Not relevant to a curated-gateway model. |

---

## 8. Sources

- Hot Pools docs — https://docs.krystal.app/products/liquidity-management/lp-exploration/hot-pools
- Krystal docs (llms-full export + `.md?ask=` API) — https://docs.krystal.app/
- Krystal Cloud API (pools/positions endpoints, stat windows, fee vs incentive APR) — https://cloud.krystal.app/
- Krystal app — https://krystal.app/ · Explorer — https://defi.krystal.app/pools
- "The Art of Liquidity in DeFi" — https://blog.krystal.app/the-art-of-liquidity-in-defi-strategic-insights-on-lps/
