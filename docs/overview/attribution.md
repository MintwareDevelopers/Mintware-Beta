# Attribution — On-Chain Reputation

Attribution is Mintware's scoring engine. It analyses your full on-chain history across 100+ chains and produces a single composite score that reflects the quality of your wallet activity.

---

## What Gets Measured

Attribution breaks your wallet activity into six signal categories:

| Signal | What It Measures |
|---|---|
| **Volume** | The scale and consistency of your transaction activity |
| **Trading** | Your trading behaviour — frequency, diversity, timing |
| **Holding** | How long you hold assets; long-term conviction vs short-term flipping |
| **Liquidity** | Participation in liquidity provision and depth |
| **Governance** | On-chain governance participation across protocols |
| **Sharing** | Your referral network — the wallets you've brought on-chain |

Each signal is scored independently and combined into a total Attribution score.

---

## Your Score

Your score is a number between 0 and 925. It reflects the cumulative strength of your on-chain record across all six signals.

Scores are recalculated periodically as new on-chain activity is detected.

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

---

## Verifiable On-Chain

Your Attribution score is published as an offchain EAS (Ethereum Attestation Service) attestation on Base. This means your score is:

- Cryptographically signed by Mintware's oracle
- Verifiable by any third party without trusting Mintware
- Portable to other protocols that integrate EAS

See [EAS Attestations](../developers/eas-attestations.md) for details.
