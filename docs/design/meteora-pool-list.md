# Meteora Pool List / "Discover" — Reference Spec + Mapping to Our LP Gateway

Research of Meteora's DLMM + DAMM v2 pool list ("Dynamic Terminal" / Discover) and a column-by-column
map to **our** LP-gateway Discover table. Sources at bottom.

> **Our context.** Users deposit a single quote asset (**USDG**) into a **curated Uniswap-V4 pool on
> Robinhood Chain**. Per-pool data we hold today:
> - `/api/gateway/instances` → `{ pairLabel, poolAddress, quoteAsset, chainId }`
> - GeckoTerminal hotness (`lib/gateway/discovery.ts`) → `{ tvlUsd, vol24Usd, volTvlRatio }`, plus
>   `poolAgeDays`, `txCount24` in `risk_signals`
> - Risk score + reasons (`lib/gateway/riskScore.ts`) → `{ score 0-100, verdict, reasons[] }`
> Legend for mapping: **KEEP** = we have the data · **ADAPT** = derive/approximate · **OMIT** = N/A.

---

## 1. What Meteora shows

Meteora's list is the **Dynamic Terminal** — one workspace combining a pool table, charts, token data,
and quick actions. Two pool families share the same table shell: **DLMM** (concentrated liquidity in
discrete price *bins*, volatility-aware dynamic fees) and **DAMM v2** (constant-product AMM with
position NFTs, optional concentrated ranges, anti-sniper suite). The API that backs the table exposes
far more fields than the UI renders; both are captured below.

### 1a. Header stats strip (protocol-wide)

| Stat | Notes |
|---|---|
| Total TVL | Sum across all pools |
| 24h Swap Volume | Protocol-wide |
| 24h Fees Generated | Protocol-wide; sometimes split DLMM vs DAMM |

### 1b. Filter tabs (pool table)

`All` · `Favorites` (user-starred, client-side) · `Top Performers` · `Trending` · `New Tokens` · `RWA`.
Plus a **DLMM vs DAMM v2** family toggle and a **timeframe** toggle (5m / 30m / 1h / 2h / 4h / 12h / 24h)
that re-bases the volume/fee/APR columns.

### 1c. Ranking / scoring behind the tabs

- **Default sort:** `volume_24h:desc`.
- **Top Performers:** sort by **Fees / Active TVL** over a chosen timeframe (fees earned relative to the
  capital sitting *where trades actually reach* — for DLMM, liquidity in active bins near price). Prone
  to noise (a near-empty pool shows a huge %), so a **min-TVL floor filter** is the recommended companion.
- **Trending:** momentum in recent-window volume / activity.
- **New Tokens:** newest `pool_created_at`.
- No opaque proprietary score — ranking is just sort-by-metric + tab-scoped filters.

---

## 2. Pool table columns (full)

Columns actually rendered in the table, with the API field that feeds each.

| # | Column | Meaning | API field |
|---|---|---|---|
| 1 | Pair / Name | token-x / token-y, icons, symbols; verified badge on tokens | `name`, `token_x`/`token_y` (`symbol`, `is_verified`) |
| 2 | Fee tier | base fee %; DLMM shows dynamic-fee range (base→max) | `pool_config.base_fee_pct`, `max_fee_pct`, `dynamic_fee_pct` |
| 3 | Bin step (DLMM only) | price granularity per bin (bps) | `pool_config.bin_step` |
| 4 | Price + trend | current pair price; small sparkline / % change | `current_price` (+ chart series) |
| 5 | TVL | total liquidity in the pair | `tvl` |
| 6 | Active / 24h TVL | DLMM: liquidity in active bins near price (denominator for Fees/TVL) | derived from bin reserves |
| 7 | Volume (windowed) | swap volume over selected timeframe | `volume.{5m…24h}` |
| 8 | Fees (windowed) | fees earned over timeframe | `fees.{30m…24h}` |
| 9 | 24h Fee / TVL | headline yield proxy (×365 ≈ APR) | `fee_tvl_ratio.{…}` |
| 10 | APR / APY | 24h fee APR/APY | `apr`, `apy` |
| 11 | Farm APR/APY | reward-emission yield if farmed | `farm_apr`, `farm_apy`, `has_farm` |
| 12 | Locked liquidity % (DAMM v2) | share of LP permanently locked | pool lock data |
| 13 | Quick action | **Ape In** button (+ Add Liquidity) | — |

Other API fields not always shown as columns: `reserve_x/y`, `token_x/y_amount`, `protocol_fees`,
`cumulative_metrics` (lifetime volume + fees), `created_at`, `tags[]`, `launchpad`, `reward_mint_x/y`.

### 2a. Sortable / filterable / search / pagination

- **Sortable:** windowed `volume_*`, `fee_*`, `fee_tvl_ratio_*`, `apr_*`; non-windowed `tvl`, `fee_pct`,
  `bin_step`, `pool_created_at`, `farm_apy`.
- **Filterable:** numeric (`tvl`, `volume_*`, `fee_*`, `fee_tvl_ratio_*`, `apr_*` with `= > >= < <=`),
  boolean (`is_blacklisted`), text (`pool_address`, `name`, `token_x`, `token_y`).
- **Search (`query`):** matches name / tokens / address.
- **Pagination:** `page` (1-based) + `page_size` (max 1000); default sort `volume_24h:desc`.

### 2b. Badges / verification / risk indicators

- **Verified token badge** ← `token_x/y.is_verified`.
- **Blacklist** ← `is_blacklisted` (hidden/flagged).
- **Tags** ← `tags[]` (e.g. launchpad origin).
- DAMM v2 anti-sniper suite + **locked-liquidity %** act as trust signals; no numeric "risk score" is
  shown to users — safety is conveyed via verified badge + locked % + blacklist.

### 2c. "Ape In" quick action

One-click: swap a single input token → create a position in that pool in **one transaction**, using
saved default settings. It's the fast-path deposit CTA sitting on every row.

---

## 3. Mapping to OUR Discover table

### 3a. Columns

| Meteora column | Us | How |
|---|---|---|
| Pair / Name | **KEEP** | `pairLabel` (+ derive token symbols/icons from label) |
| Fee tier | **ADAPT** | V4 pool fee is on-chain; read once at curation → store on instance. Until then OMIT. |
| Bin step | **OMIT** | Uniswap-V4 has no bins (DLMM concept) |
| Price + trend | **ADAPT** | GeckoTerminal per-pool price / OHLCV; sparkline optional (extra fetch) |
| TVL | **KEEP** | hotness `tvlUsd` |
| Active / 24h TVL | **OMIT** | no bin model; single "TVL" column suffices |
| Volume (24h) | **KEEP** | hotness `vol24Usd` (24h only — we don't store other windows) |
| Fees (windowed) | **ADAPT** | approximate `fees24 ≈ vol24Usd × poolFeeRate` once fee tier is stored |
| 24h Fee / TVL | **ADAPT** | derive from approx fees / `tvlUsd`; or show `volTvlRatio` as an activity proxy |
| APR / APY | **ADAPT** | `estAPR ≈ (fees24 / tvlUsd) × 365`; **label "estimated," no compounding/APY claim** |
| Farm APR/APY | **OMIT** | no reward emissions on gateway pools |
| Locked liquidity % | **OMIT** | not modeled |
| Quote asset | **KEEP** (new col) | `quoteAsset` = USDG — reinforces single-asset deposit story |
| Quick action | **ADAPT** | "Ape In" → our **"Deposit USDG"** one-click CTA per row |

### 3b. Filter tabs

| Meteora tab | Us |
|---|---|
| All | **KEEP** — all live curated instances |
| Favorites | **ADAPT** — client-side star in `localStorage` (no backend) |
| Top Performers | **ADAPT** — sort by `volTvlRatio` or est-APR **with a min-TVL floor** (avoid the empty-pool noise trap) |
| Trending | **ADAPT** — sort by `vol24Usd` (momentum needs multi-window data we lack; 24h volume is the honest proxy) |
| New Tokens | **ADAPT** — sort by `poolAgeDays` (in `risk_signals`) |
| RWA | **OMIT** — RWA shelved |
| DLMM ↔ DAMM v2 toggle | **OMIT** — single family (V4) |
| Timeframe toggle | **OMIT** (v1) — we only hold 24h windows; hardcode 24h |

### 3c. Sort / search / pagination

- **Sort:** TVL, 24h Volume, est-APR / Fee-TVL, newest. Default **24h Volume desc** (matches Meteora). **KEEP/ADAPT.**
- **Search:** by pair label / pool address — **KEEP** (client-side filter on the instances list).
- **Pagination:** curated list is small → single page or simple client paging. **ADAPT/OMIT.**

### 3d. Badges / trust — our differentiator

Meteora leans on verified-token + locked-%. **We already compute a real risk score** the curator uses —
surface a *curation-grade* trust signal instead:

| Signal | Us |
|---|---|
| Verified badge | **ADAPT** → **"Curated" badge** — every live instance passed human review (stronger than token-verified) |
| Risk score / reasons | **KEEP** — expose a coarse chip (Low/Med/High from `risk_score`) with `reasons[]` on hover/expand |
| Blacklist | **ADAPT** — ineligible/rejected pools never reach the live list (filtered upstream) |
| New-pool warning | **KEEP** — `poolAgeDays < 7` → "new pool" flag from existing signals |
| Wash-trade flag | **KEEP** — `volTvlRatio > 25` reason already exists |

### 3e. Header stats strip

| Meteora | Us |
|---|---|
| Total TVL | **ADAPT** — Σ `tvlUsd` across live instances |
| 24h Volume | **ADAPT** — Σ `vol24Usd` |
| 24h Fees | **ADAPT** — Σ approx fees (est.), or OMIT until fee tier stored |

---

## 4. Buildable v1 recommendation (tight)

- **Columns:** Pair · Quote (USDG) · TVL · 24h Volume · Est. APR (labeled *estimated*, Fee/TVL×365) ·
  Trust chip (Curated + risk level) · **Deposit USDG** CTA.
- **Tabs:** All · Favorites (localStorage) · Top Performers (Fee-TVL, min-TVL floor) · New.
- **Sort:** default 24h Volume desc; sortable TVL / Volume / Est-APR / Newest.
- **Search:** pair label + address, client-side.
- **Header strip:** Σ TVL · Σ 24h Volume (Fees est. optional).
- **Deferred (need on-chain read at curation):** exact fee tier → real fees/APR, price sparkline.
- **Never claim:** guaranteed/fixed APY, "savings/deposit yield" (est-APR only; house copy rules).

---

## Sources
- [Meteora Docs — DLMM Pools API (fields, sort, filter, pagination)](https://docs.meteora.ag/api-reference/dlmm/pools/pools)
- [Meteora Docs — home / DLMM + DAMM v2 concepts](https://docs.meteora.ag)
- [Meteora Docs — DAMM v2 (locked liquidity, anti-sniper)](https://github.com/MeteoraAg/damm-v2)
- [Solana Guides — finding best Meteora pools (Fees/Active TVL, TVL floor)](https://solanaguides.com/how-to-find-the-best-meteora-pools)
- [Bitquery — Meteora DAMM v2 API fields](https://docs.bitquery.io/docs/blockchain/Solana/Meteora-DAMM-v2-API/)
- [Madeonsol — Meteora DLMM pools explained](https://madeonsol.com/blog/meteora-dlmm-pools-explained)
