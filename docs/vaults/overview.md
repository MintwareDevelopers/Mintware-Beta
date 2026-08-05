# Two-Surface Vaults

> **Status:** Live on `mintware.finance/vaults`. The reputation-as-yield model, the two-surface
> discovery experience, and the full RWA deal pipeline (author → review → publish → redeem) are in
> production. On-chain RWA settlement runs on testnet and is gated on the legal track before mainnet.

Mintware Vaults are a liquidity coordination layer on **Uniswap V4** with one idea at the centre:

> **Your reputation is yield.** Two wallets deposit the same amount into the same vault. The one with
> the stronger on-chain history earns a larger share of the fees — from reputation alone.

Every other vault protocol pays liquidity providers by **size of capital**. Mintware weights each
depositor's fee share by their on-chain **Attribution score**. That turns your DeFi history from a
vanity number into an economic asset, and it's something no capital-only vault can offer.

---

## Two surfaces, one foundation

Both surfaces are built on a shared **ERC-4626 base + multi-tenant factory**, so the same reputation
engine, fee accounting, and epoch distribution apply across everything you touch.

| | **DeFi surface** | **RWA surface** |
|---|---|---|
| Earn from | On-chain activity (swap fees) | Real-world yield (credit, real-estate, energy) |
| Yield source | Swap fees + idle-capital routing + MEV capture | Underlying asset + fees |
| Risk shape | Smart-contract + market volatility | Issuer / counterparty · oracle-banded price |
| Protection | MEV guard · dynamic fee · range optimization | SPV wrapper · oracle price bands · 40/60 reserve |
| Access | Permissionless — deposit anytime | Reg D: KYC/whitelisted holders (trade + redeem) · Reg A+: open · 30-day settlement |
| Instrument | ERC-4626 share | `vRWA` bearer token (1:1 with shares) |
| Best for | Active on-chain LPs chasing trading yield | Allocators wanting off-chain yield on on-chain rails |

Your Attribution score compounds across both — activity on either surface strengthens the single
reputation that weights your fee share everywhere.

---

## Why an LP earns more here

A depositor's fee share is driven by **two independent levers**, both enforced on-chain:

### Lever 1 — Reputation (Attribution tier)
Your Mintware Attribution percentile sets a multiplier on your fee share:

| Attribution percentile | Fee-share multiplier |
|---|---|
| 0–33% (Bronze) | 1.00× |
| 34–66% (Silver) | 1.25× |
| 67–100% (Gold) | 1.50× |

### Lever 2 — Commitment (Lock tier)
Committing your liquidity for longer earns a higher multiplier. The early-exit penalty **tapers to
zero** as you approach unlock, so leaving early is never a cliff.

| Lock tier | Duration | Multiplier | Early exit |
|---|---|---|---|
| Flex | No lock | 1.00× | None (7-day withdrawal notice) |
| Committed | 30 days | 1.15× | ≤2.0%, tapering to 0% near unlock |
| Aligned | 90 days | 1.30× | ≤2.0%, tapering to 0% near unlock |
| Core | 180 days | 1.50× | ≤2.0%, tapering to 0% near unlock |

### The referral loop
Referrals are the third dimension — but they don't pay a flat bounty. Referring an LP feeds your
**Sharing** signal, which lifts your Attribution score, which raises the multiplier on **every**
deposit you make. It's the only referral program that pays you twice: once in fees, and again by
permanently raising your reputation tier.

```
Refer an LP → their TVL sticks → your Sharing score rises →
your Attribution rises → your fee-share multiplier rises → repeat
```

---

## How a deposit works (DeFi)

One deposit runs your capital through a five-stage Uniswap V4 hook engine on every swap that touches
the pool — automatically:

```
01  MEV Protection    — TWAP verify + sandwich guard; value stays with LPs, not bots
02  Dynamic Fee       — fee auto-tunes to volatility + depth so LPs capture more
03  Idle Capital      — un-ranged liquidity is routed to yield instead of sitting idle
04  Attribution Split — fees split 70/15/10/5, your LP share weighted by reputation
05  FeeVault          — accrues per 7-day epoch, claimable — no manual compounding
```

**Fee split:** every swap fee is split **70% to LPs · 15% to referrers · 10% to the protocol
treasury · 5% to a rolling Attribution bonus pool**. The bonus pool seeds the next epoch and
absorbs any unclaimed rewards, then pays out to the highest-reputation active LPs — so nothing is
wasted. The split lives on-chain in the FeeVault; any change emits a public event.

---

## The RWA surface

The RWA surface tokenizes real-world assets — private credit, real-estate notes, energy off-take —
as a `vRWA` instrument on a legal-wrapped foundation:

- **SPV-wrapped** — each deal sits in a bankruptcy-remote special-purpose vehicle.
- **Oracle-banded price** — on-chain swaps are constrained to ±15% (core) / ±45% (spec) around the
  published NAV; trades outside the spec band revert.
- **40 / 60 reserve** — a reserve ratio backs redemptions.
- **KYC at transfer for Reg D** — Reg D `vRWA` only reaches whitelisted/verified wallets (enforced on
  every transfer via `SPVBeneficiaryRegistry`); redemption re-checks KYC. Reg A+ `vRWA` trades openly.
- **Async 30-day settlement** — redemption is a request → 30-day window → issuer settlement flow.

Full issuer + redemption detail is in **[RWA Deals — Lifecycle & Trust Model](rwa-deals.md)**.

---

## What's live today

- **On production `/vaults`:** two-surface discovery, the interactive reputation-yield model, live
  stats, lock-tier and trust explainers, and a vault reputation leaderboard.
- **RWA deal pipeline (no new contracts required):** issuers register, author a full deal page,
  Mintware reviews and approves, the deal publishes to `/vault/[id]`, and holders can request
  redemptions that admins settle. All operable in-app today.
- **DeFi vaults:** V4 hook + ERC-4626 vault + FeeVault deployed and indexed; the create-and-seed flow
  is live.
- **Pending:** on-chain RWA deposits/settlement (contracts on testnet, mainnet gated on the legal
  track) and a fair-launch **threshold seeding** mechanism (design complete, contract not yet built —
  see the [build spec](../developers/vaults-rwa-build-spec.md)).

---

## Why this is different from standard LP

| | Standard V4 LP | Mintware Vault |
|---|---|---|
| Yield source | Swap fees only | Swap fees + idle-capital + MEV capture |
| Yield distribution | Proportional to capital | Weighted by reputation + lock commitment |
| Referrals | None | Compound into your reputation tier |
| Asset types | Crypto only | DeFi **and** RWA on one base |
| Trust | Trust the operator | Trust the contract — split, queue, and bands are code |

Reputation-weighted yield is the wedge; the two-surface base is the platform. Mintware is the only
place your on-chain history, your commitment, and your referral network all compound into a single
number that determines what your liquidity earns.
