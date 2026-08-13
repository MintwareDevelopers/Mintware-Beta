# Welcome to Mintware

Mintware is a DeFi reputation and rewards platform built for EVM chains.

We turn your on-chain history into a verifiable score — then use that score to determine how much you earn from liquidity pools and protocol incentives. The better your on-chain track record, the more your activity is worth.

Mintware is also designed to make on-chain actions easier to understand before you commit. Swaps, claims, and funding actions now surface clearer confirmation context, stronger chain guidance, and better fee visibility before your wallet opens.

---

## The Mintware Stack

### Attribution — On-Chain Reputation
A live scoring engine that analyses your full wallet history across 100+ chains and produces a single composite reputation score. Your score reflects the depth, consistency, and quality of your on-chain behaviour — not just your balance.

### Mintware Swap — Clearer Before You Confirm
Mintware Swap is built to reduce confusion before the wallet popup appears.

Depending on the route and token pair, Mintware can show:
- what you are sending
- what you are expected to receive
- estimated network fees
- route and chain context
- warnings for missing gas balance or unusual price impact

### Two-Surface Vaults — DeFi + RWA
Liquidity vaults on Uniswap V4 where your share of the fee pool is weighted by your Attribution score and referral network — the same deposit earns more if you've built a stronger on-chain reputation. Two surfaces on one shared ERC-4626 base:

- **DeFi** — permissionless yield: dynamic fees, idle-capital routing, MEV protection, attribution-weighted fee share.
- **RWA** — tokenized real-world assets (private credit, real-estate, energy), SPV-wrapped with oracle-banded pricing, KYC-at-redemption, and async 30-day settlement.

The reputation-yield experience and the full RWA deal pipeline (register → verify → author → approve → publish → redeem) are live in production. See [Two-Surface Vaults](vaults/overview.md) and [RWA Deals](vaults/rwa-deals.md).

---

## Quick Links

* [What is Attribution?](overview/attribution.md)
* [Two-Surface Vaults](vaults/overview.md)
* [RWA Deals — Lifecycle & Trust](vaults/rwa-deals.md)
* [Connect your wallet](getting-started/connect-wallet.md)
* [API reference](developers/api-reference.md)
* [Smart contracts](developers/smart-contracts.md)

---

## Platform Status

| Product | Status |
|---|---|
| Attribution scoring | ✅ Live — 100+ chains |
| Mintware Swap | ✅ Live |
| Referral system | ✅ Live |
| AI Agent reputation | ✅ Live — Base mainnet |
| Reputation-weighted Vaults | 🟡 Testnet — in testing ahead of launch |
