# Welcome to Mintware

Mintware is an on-chain **reputation + liquidity** platform for EVM chains. The through-line:

> **Never idle. Never locked. Always yours.**

Capital that stays productive, stays spendable, and is fairly earned. Your on-chain history becomes a
verifiable score (Attribution), and liquidity products route value by it.

> **Canonical narrative & copy:** [product/framing-and-messaging.md](product/framing-and-messaging.md)
> is the source of truth for how Mintware is described. If a page here disagrees with it, that page is wrong.

---

## The Mintware stack

### Attribution — on-chain reputation (live)
A live scoring engine that reads your full wallet history across many chains and produces one composite
reputation score across **seven signals plus a risk penalty**. It reflects the depth, consistency, and
quality of your on-chain behaviour — not just your balance.

### Swap (live)
Cross-chain swaps via LI.FI best-execution routing, with clearer confirmation context — what you send,
what you receive, fees, and route/chain warnings — before your wallet opens.

### Vaults — reputation-weighted DeFi liquidity (in testing)
Liquidity vaults on Uniswap V4. In the **Growth vault**, your share of the fee pool is weighted by your
Attribution score; the matched-liquidity vault pays **pro-rata**. The engine is **in testing on Base
Sepolia** and unaudited — not a place to deposit real value yet.

### Yield Payment Network / Liquid Sovereign Account (coming)
The direction: USDC that earns yield **and** stays spendable — principal never touched. See
[Yield Payment Network](https://mintware.finance/yield-payment-network). Settlement engine exists
off-chain but is deploy-gated; nothing here is live or an offer.

### AI agent reputation (live)
Attribution for AI agent wallets on Base (ERC-8004), with plugins and a leaderboard. See
[AI Attribution](ai-attribution/overview.md).

---

## Platform status

| Product | Status |
|---|---|
| Attribution scoring | ✅ Live |
| Swap (LI.FI) | ✅ Live |
| Referral system | ✅ Live |
| AI agent reputation | ✅ Live — Base mainnet |
| Vaults / ULV engine | 🟡 In testing on Base Sepolia (unaudited) |
| Yield Payment Network / LSA | 🔜 Coming — not live |

> **Shelved (not current):** the **RWA** surface (Aug 2026) and the **Campaigns** product (token reward
> pools / points campaigns, Aug 2026) were removed from the platform. Archived under
> [archive/](archive/) — do not treat them as live.

---

## Quick links

* [What is Mintware?](overview/what-is-mintware.md)
* [Attribution — on-chain reputation](overview/attribution.md)
* [Vaults](vaults/overview.md)
* [Swap](swap/overview.md)
* [Connect your wallet](getting-started/connect-wallet.md)
* [API reference](developers/api-reference.md)
