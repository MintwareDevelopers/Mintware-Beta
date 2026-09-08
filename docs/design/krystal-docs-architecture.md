# Krystal — Docs & Architecture Deep-Dive → what's adoptable for our LP-Gateway

> Research spec. Sources: `docs.krystal.app`, `cloud.krystal.app` (+ its OpenAPI spec on
> `cloud-api.krystal.app`), `alm-docs.krystal.app`, `krystal.app`, `blog.krystal.app`, Krystal Wallet
> Medium, and the Code4rena "2024-06-krystal-defi" audit report. **Confirmed** = seen in ≥1 primary
> Krystal source (usually corroborated across two); **Inferred** = my synthesis, flagged inline.
> Compiled 2026-09-07. Maps to our LP-Gateway (`lib/gateway/*`, `feat/lp-gateway`) — see [[lp_gateway_phase1]].

---

## 1. Product suite (Confirmed)

Krystal = "decentralized, multichain **liquidity farming agent**." Mobile-first (iOS/Android launched
first), web app followed; feature parity across both.

| Surface | What it does |
|---|---|
| **Swap + Bridge** | Cross-chain DEX aggregator (best-execution routing + bridging), the original wallet product. |
| **Liquidity Management** | The core today. Manage concentrated-liquidity LP positions across **19+ DEXs / 12+ chains** in one UI: open, zap-in (enter a pool with any single asset), adjust, reinvest, close. Per-position **PnL / IL / fees / APR** dashboard ("Liquidity Lens"). |
| **Automation** | **Auto-Rebalance**, **Auto-Compound**, **Auto-Exit** layered onto a position. Uni v3 on ETH/ARB/Base/BNB/OP/Polygon; Auto-Rebalance also on Solana. |
| **Vaults / ALM** | Smart-contract "dynamic portfolio manager" holding multiple strategies. Two kinds: **Auto-Farm Vault** (describe a strategy in natural language → AI agent finds pools, deploys, harvests, compounds, rebalances, rotates) and **Community Vault** (public deposits → vault shares, owner takes a **performance fee**). |
| **Portfolio / Market insights** | Multichain wallet portfolio + analytics. |
| **KrystalGO** | IDO **launchpad** for token sales. (Adjacent; not relevant to us.) |

Price data: aggregated USD prices from **CEX (Binance/OKX/Coinbase) + DEX via Coingecko**; pool price
reflects live liquidity state (Confirmed, FAQ).

---

## 2. Public data layer — **Krystal Cloud** (Confirmed; this is the headline finding)

A standalone **DeFi Data API** productized off their own indexer. Host `cloud-api.krystal.app`, HTTPS,
auth via **`KC-APIKey` header**. Credit-metered. **1M+ pools, 12+ chains, 17+ DEXs, 99.9% uptime.**

### Endpoints (from the OpenAPI spec — Confirmed)

| Path | Cost | Notes / key params |
|---|---|---|
| `GET /v1/chains` · `/v1/chains/{chainId}` | free | supported networks + per-chain stats |
| `GET /v1/protocols` | free | all supported DEX protocols across chains |
| `GET /v1/balances/{wallet}` | 5 | `chainIds[]`, `tokenAddress`, `includeDustToken` |
| `GET /v1/pools` | 10 | `chainId`, `protocol`, `token`, **`sortBy`=APR/TVL/Volume/Fee**, `minTvl`, `minVolume24h`, `withIncentives`, `includeTokenPrice`, `limit/offset` |
| `GET /v1/pools/{chainId}/{poolAddress}` | 10 | `factoryAddress`, `withIncentives` |
| `GET /v1/pools/{chainId}/{poolAddress}/historical` | 10 | `startTime`, `endTime` |
| `GET /v1/pools/{chainId}/{poolAddress}/ticks` | 10 | liquidity distribution by tick |
| `GET /v1/pools/{chainId}/{poolAddress}/transactions` | 10 | swap/mint/burn feed, time-ranged |
| `GET /v1/positions` | 10 | **`wallet` required**, `positionStatus`, `protocols[]`, `chainIds[]`, `includeClosedPosition`, `includeSpamPosition`, **`orderBy`=pnl/apr/liquidity/lastAction** |
| `GET /v1/positions/{chainId}/{positionId}` | 10 | full position detail |
| `GET /v1/positions/{chainId}/{positionId}/historicalPerformance` | 10 | `timeframe`=1h/7d/30d |
| `GET /v1/positions/{chainId}/{positionId}/transactions` | 10 | position tx history |
| `GET /v1/strategies` · `/v1/strategies/{id}/positions` | 10 | `wallet` req — the ALM/vault strategy layer |

Errors: 400 bad input · 401 bad key · **402 insufficient credits** · 500.

### Pricing (Confirmed)

| Plan | Price | Credits/mo |
|---|---|---|
| Free | $0 | 50,000 |
| Standard | $99 | 5,000,000 |
| Extra | $790 | 50,000,000 |

At 10 credits/pool-call, Free ≈ 5,000 pool reads/mo — comfortably covers a curation queue that reads a
few dozen pools on a 3-hourly cron. **Free tier alone likely covers our entire phase-1 discovery load.**

### Data models (Confirmed fields; exact JSON shapes not public — Inferred completeness)

- **Pool:** address, token pair, TVL, 24h volume, fees, **APR**, incentives, per-tick liquidity, tx feed, historical series. APR = `(24h earning × 365) / current liquidity × 100%` (Confirmed formula).
- **Position:** id, wallet, protocol, chain, tokens, liquidity, **fees earned, PnL, IL, APR**, historical performance (1h/7d/30d), tx history.

### SDK / tooling (Confirmed)

TS + Python examples, an npm `krystal-cli`, Swagger UI, and a published "Claude Code skill" for the API.
No heavyweight client library required — it's a plain REST + header-key service.

---

## 3. How they aggregate DEXes/chains (Confirmed + Inferred)

- **Confirmed:** Krystal Cloud is *their own* indexer/data service ("real-time data on Liquidity Pools
  and Positions… across multiple Chains and DEXs," 1M+ pools, 99.9% uptime SLA) — not a resold subgraph.
  Prices layered from CEX + Coingecko + on-chain pool state.
- **Inferred:** the pool/position/tick/historical granularity (per-tick liquidity, closed positions,
  spam flags, 1h performance) is deeper than public subgraphs expose consistently, which points to a
  **first-party multi-chain indexer** normalizing v2/v3/v4 + Pancake into one schema, rather than
  fanning out to per-DEX subgraphs at query time. The API *is* the product (they sell it), so the
  aggregation is centralized and normalized behind `KC-APIKey`.

**Implication for us:** GeckoTerminal gives us discovery-grade signals (TVL, vol, age, price, tx counts);
Krystal Cloud additionally gives **normalized APR, per-tick liquidity, historical pool series, and a
first-class positions endpoint with PnL/IL/fees** — the exact data we'd otherwise hand-derive on-chain.

---

## 4. On-chain automation architecture (Confirmed via Code4rena 2024-06)

The mechanism behind Auto-Rebalance/Compound/Exit — directly relevant to our harvest/rebalance design:

- Contracts in scope: `V3Automation.sol`, `V3Utils.sol`, `Common.sol`, `StructHash.sol`, `EIP712.sol` (~1,137 LoC).
- **Intent model:** user signs an **EIP-712** order describing the automation config; an **`OPERATOR_ROLE`**
  keeper submits execution params on-chain. Non-custodial: user keeps the LP **NFT**; contract takes it
  via `safeTransferFrom`, operates, returns it.
- **Auto-Rebalance controls (Confirmed, docs):** lower/upper **trigger prices** (absolute or % from
  current), **time buffer** (only fire if out-of-range for N minutes), **gas-fee ceiling**, pool + swap
  **slippage guards** (revert on unfavorable move), **min-fee threshold** before compounding.
- **Audit outcome:** 0 high, 5 medium. Themes worth stealing as our own test cases: signed-order **replay
  (missing nonce)**, **signed-intent ≠ executed-params** drift (operator could deviate), zero-value
  transfer/approval reverts (fee-on-transfer + BNB-style tokens), NFT-allowance erasure breaking delegation.

---

## 5. Trust / security / legal posture (Confirmed)

- **Non-custodial**, stated plainly: "does not hold your assets at any time"; funds always withdrawable
  directly from the contract if the UI is down (they publish the manual path).
- **Audits:** "all smart contracts fully audited by external third parties"; public **Code4rena** contest
  (June–July 2024). They lead with the audit as a trust signal.
- **Risk disclosures**, surfaced *in-product* not buried: explicit **IL** warnings on every LP/vault
  surface, **slippage** definition, and a pointed **"Public Vaults carry inherent risk — anyone can
  create one"** caveat. Guidance to "prefer audited, well-established contracts."
- **Compliance:** references **FATF** recommendations + country restrictions.

Pattern: audit-forward + risk-inline + explicit non-custody + geo-gating. No "guaranteed/APY-promise"
language — consistent with our own #1 legal line.

---

## 6. Mapping to OUR LP-Gateway — KEEP / ADAPT / OMIT

Our system (recap): single-sided **USDG → one curated Uni-V4 pool on Robinhood Chain (4663)**, staged in
**Morpho**, harvested fees → **spendable buffer** (never principal); curated multi-pool **factory+registry**;
**GeckoTerminal** discovery cron → **risk-scored curation queue** (human-approved, never auto). Operator =
oracle signer (Privy).

| Krystal capability | Verdict | Notes for us |
|---|---|---|
| **Krystal Cloud pools/positions API** | **ADAPT (high leverage)** | See §7 — strongest single adoptable. Use as a *second* discovery source + our position/PnL/IL data model. |
| Own multi-DEX indexer | **OMIT** | We don't need to build one for one chain / one pool shape. Consume theirs (or Gecko) instead. |
| `sortBy=APR/TVL/Volume/Fee` pool ranking | **ADAPT** | Feed APR + fee into `riskScore.ts` hotness ranking — today we rank on vol/TVL only. |
| Per-tick liquidity (`/ticks`) | **KEEP for later** | Useful for our capped-deploy NAV/depth guard (C1 fix) — real depth read instead of a spot-liquidity proxy. Not phase-1. |
| Pool `/historical` series | **ADAPT** | Age + volatility of a candidate over time is a far better rug signal than a single `pool_created_at`. Add to curation signals. |
| **Positions endpoint (PnL/IL/fees/APR + historicalPerformance)** | **ADAPT (data model)** | See §8 — adopt the *field set + APR formula*, even if we compute on-chain rather than call them for our own single pool. |
| Auto-Rebalance / Auto-Compound | **KEEP (concept)** | We already harvest fees→buffer. Their trigger-price + time-buffer + gas-ceiling + slippage-guard control set is a clean template for a future rebalance/harvest keeper config. |
| EIP-712 signed-intent + OPERATOR_ROLE keeper | **KEEP (we already do this shape)** | Our oracle-signer operator ≈ their `OPERATOR_ROLE`. Steal their **audit findings as tests**: nonce/replay, signed-intent==executed-params, fee-on-transfer/zero-approval reverts. |
| Vault **shares** for external deposits + **performance fee** | **OMIT (phase-1) / note for later** | Our gateway is single-owner-curated → spendable buffer, not a public deposit vault. Community-vault-with-shares is a later product decision, not now. |
| Natural-language "Auto-Farm" AI vault | **OMIT** | Out of scope; also collides with our legal posture on discretion. |
| Swap/bridge aggregator, KrystalGO | **OMIT** | Unrelated to LP-gateway. |
| Audit-forward + IL-inline + non-custodial + geo trust pattern | **KEEP** | See §9. Directly reusable; matches `/legal`. |

---

## 7. (a) Krystal Cloud vs our GeckoTerminal path

| Dimension | GeckoTerminal (today) | Krystal Cloud |
|---|---|---|
| Pool discovery (TVL/vol/age/price/tx) | ✅ have it, free, no key | ✅ + APR/fee/incentives, sortable server-side |
| **Robinhood Chain (4663) coverage** | ✅ network slug `robinhood` | ❓ **12+ chains listed, RH not confirmed** — must verify `/v1/chains` before adopting |
| Per-tick liquidity / real depth | ❌ | ✅ `/ticks` |
| Historical pool series | limited | ✅ `/historical` |
| **Positions w/ PnL/IL/fees** | ❌ (we derive on-chain) | ✅ first-class |
| Auth / cost | none | `KC-APIKey`, free ≤50k credits/mo (≈5k pool reads) |
| Failure mode | soft-fail we already handle | add a 402/401 path |

**Recommendation:** **Do NOT rip out GeckoTerminal — add Krystal Cloud as an optional enrichment/second
source behind the existing `discovery.ts` guards.** Decision gate: **first confirm Robinhood Chain (4663)
is in `/v1/chains`.** If yes → use Cloud for APR + historical + per-tick depth (materially better curation
signals + a free path to the C1 depth guard). If no → Cloud is unusable for our chain today; keep Gecko,
and treat Cloud only as the *data-model* reference (§8). Either way, keep the untrusted-input coercion
(`safeNum`/`sanitizeLabel`) — a keyed API is still external data.

## 8. (b) IL / PnL tracking data model (adopt the shape)

Adopt Krystal's position field set for our own position/harvest records (compute on-chain for our single
pool; no external dependency needed):

```
position: { chainId, poolAddress, owner,
            liquidity, token0Amt, token1Amt,
            principalUsd, currentValueUsd,
            feesEarnedUsd, feesClaimedUsd,
            pnlUsd, impermanentLossUsd,
            apr,                      // (24h earning × 365) / current liquidity
            historicalPerformance[]  // {t, valueUsd, feesUsd} @ 1h/7d/30d
          }
```

- **IL** = value-if-held − current-LP-value (both in USDG terms — clean for us since one side is USDG).
- **PnL** = currentValueUsd + feesEarnedUsd − principalUsd.
- Persist snapshots (mirror `historicalPerformance` 1h/7d/30d) so the spendable-buffer feed can show
  fees-vs-IL honestly rather than fees alone. This is the single biggest *honesty* upgrade to the buffer UI.

## 9. (c) Trust / disclosure patterns to copy

- Lead with the **audit** (we have the LP-Gateway self-audit PR #465 / firm-grade fixes — surface it like Krystal surfaces Code4rena).
- **IL inline on every LP surface**, not just `/legal` — Krystal shows IL warnings at the point of action.
- Keep the **manual-withdraw / non-custodial** promise explicit ("funds always yours" == our tenet).
- Import their audit findings as our **test matrix** for the operator/signed-intent path (nonce/replay,
  intent==params, fee-on-transfer, zero-approval) — cheap, high-credibility hardening.
- Avoid public-deposit/shares framing until a deliberate product+legal decision (their "public vaults
  carry risk — anyone can create one" caveat shows the disclosure burden that comes with it).

---

## 10. Open verification items

1. **Robinhood Chain (4663) in Krystal Cloud `/v1/chains`?** — gates §7. (Not confirmed; RH not in their listed chains.)
2. **Does Cloud index Uniswap v4** on any chain? (v4 confirmed as a supported protocol generally; per-chain v4 coverage unverified.)
3. Exact JSON response schemas (fields confirmed by name from OpenAPI summary; full shapes behind the Swagger SPA — not machine-fetched here).
4. USDG-quoted pool support in Cloud token filters (our hard eligibility gate).
