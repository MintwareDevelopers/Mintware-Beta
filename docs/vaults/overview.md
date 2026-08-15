# Vaults — Reputation-Weighted DeFi Liquidity

> **Status: in testing on Base Sepolia, unaudited.** The vault engine is deployed to testnet only —
> not live for real deposits, not audited, not an offer. (The **RWA surface** referenced in older
> versions of this page was **shelved** — see [archive/](../archive/).)

Mintware Vaults are a liquidity coordination layer on **Uniswap V4**. The idea at the centre:

> **In the Growth vault, your reputation is yield.** Two wallets deposit the same amount; the one with
> the stronger on-chain history earns a larger share of the fees — from reputation alone.

Most vault protocols pay liquidity providers purely by **size of capital**. The Growth vault weights
each depositor's fee share by their on-chain **Attribution score**, turning DeFi history into an
economic asset. (The **matched-liquidity vault** pays **pro-rata**, not reputation-weighted — see
[reward weighting](#which-vault-weights-by-reputation).)

---

## Why an LP earns more (Growth vault)

Fee share is driven by two independent, on-chain levers:

### Lever 1 — Reputation (Attribution tier)
Your Attribution percentile sets a multiplier on your fee share:

| Attribution percentile | Fee-share multiplier |
|---|---|
| 0–33% (Bronze) | 1.00× |
| 34–66% (Silver) | 1.25× |
| 67–100% (Gold) | 1.50× |

### Lever 2 — Commitment (Lock tier)
Committing liquidity for longer earns a higher multiplier; the early-exit penalty **tapers to zero**
approaching unlock, so leaving early is never a cliff.

| Lock tier | Duration | Multiplier |
|---|---|---|
| Flex | No lock | 1.00× |
| Committed | 30 days | 1.15× |
| Aligned | 90 days | 1.30× |
| Core | 180 days | 1.50× |

### The referral loop
Referrals are a third dimension — but not a flat bounty. Referring an LP feeds your **Sharing** signal,
which lifts your Attribution score, which raises the multiplier on **every** deposit you make.

---

## How a deposit works

One deposit runs your capital through a Uniswap V4 hook engine on every swap that touches the pool:
idle capital is routed to yield instead of sitting flat, fees auto-tune to volatility, value captured
mid-swap stays with LPs, and fees accrue per epoch (claimable — no manual compounding). The exact
splits and mechanics live on-chain; see [smart contracts](../developers/smart-contracts.md).

---

## Which vault weights by reputation?

- **Growth vault** — reputation-weighted (the multipliers above).
- **Matched-liquidity vault** — **pro-rata** (dual-sided team-locked / community-matched launch
  liquidity, ≥90-day cliff). Not reputation-weighted.

---

## What's true today

- The vault engine (V4 hook + ERC-4626 base + factory) is **deployed to Base Sepolia** and indexed.
- It is **unaudited** and holds no real value — testnet only, ahead of an external audit before mainnet.
- Public marketing must say "in testing on Base Sepolia," never "deposit now."
