# Attribution — On-Chain Reputation

Attribution is Mintware's scoring engine. It analyses your full on-chain history across 100+ chains and produces a single composite score that reflects the quality of your wallet activity.

---

## What Gets Measured

Attribution breaks your wallet activity into six signal categories:

| Signal | Max Score | What It Measures |
|---|---|---|
| **Volume** | 100 | The scale and consistency of your transaction activity |
| **Trading** | 75 | Your trading behaviour — frequency, diversity, timing |
| **Holding** | 100 | How long you hold assets; long-term conviction vs short-term flipping |
| **Liquidity** | 150 | Participation in liquidity provision and depth |
| **Governance** | 100 | On-chain governance participation across protocols |
| **Sharing** | 400 | Your referral network — the wallets you've brought on-chain |

Each signal is scored independently and combined into a total Attribution score. **Maximum possible score: 925.**

---

## Score Tiers

| Tier | Description |
|---|---|
| Bronze | Early activity — building your reputation |
| Silver | Established on-chain presence |
| Gold | Seasoned participant with consistent history |

See [Score Tiers](score-tiers.md) for full detail on what each tier means for your campaign earnings.

---

## Wallet Character

Beyond your score, Attribution assigns a **character** to your wallet based on behavioural patterns — how you act in different market conditions, your consistency across protocols, and your long-term orientation.

Examples include *Ghost* (shows up in calm markets, absent in volatility), *Builder* (consistent protocol engagement), and others.

Character is displayed on your profile and used to surface relevant protocol opportunities.

---

## Multi-Chain Coverage

Attribution analyses activity across 100+ EVM and non-EVM chains. You don't need to migrate assets or bridge anything — Attribution reads your existing history wherever it is.

> **Your score is chain-agnostic.** A wallet with deep history on Arbitrum, Optimism, Polygon, or any other EVM chain scores the same as one active on Ethereum mainnet. History is history.

---

## Verifiable On-Chain

Your Attribution score can be published as an offchain EAS (Ethereum Attestation Service) attestation. This means your score is:

- Cryptographically signed by Mintware's oracle
- Verifiable by any third party without trusting Mintware
- Portable to other protocols that integrate EAS

See [EAS Attestations](../developers/eas-attestations.md) for details.
