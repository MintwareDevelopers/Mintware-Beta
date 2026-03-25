# Attribution — On-Chain Reputation

Attribution is Mintware's scoring engine. It analyses your complete on-chain history across 100+ chains and produces a single composite reputation score that reflects the quality, depth, and consistency of your wallet activity.

Your score is not based on wealth. A wallet with decades of consistent, diverse on-chain activity scores higher than a whale who deployed capital yesterday.

---

## What Gets Measured

Attribution breaks your wallet history into six independent signal categories:

| Signal | Max Score | What It Measures |
|---|---|---|
| **Volume** | 100 | The scale and consistency of your transaction activity over time |
| **Trading** | 75 | Your trading behaviour — frequency, diversity, protocol breadth, and timing across market conditions |
| **Holding** | 100 | Long-term asset conviction — how long you hold relative to your entry, and whether you accumulate or churn |
| **Liquidity** | 150 | Participation in liquidity provision — depth, duration, and quality of your LP positions |
| **Governance** | 100 | On-chain governance participation across protocols — proposals, votes, and delegation history |
| **Sharing** | 400 | The depth and quality of your referral network — wallets you've brought on-chain and their downstream activity |

Each signal is scored independently. They combine into a total Attribution score. **Maximum possible score: 925.**

---

## How Signals Are Scored

Each signal uses its own set of behavioural indicators drawn from your raw on-chain history. The scoring is designed to reward genuine, sustained participation — not gaming:

- **Recency matters, but history matters more.** Consistent activity over years scores better than a sudden burst.
- **Breadth matters.** Being active across multiple chains and protocols reflects genuine engagement, not narrow optimisation.
- **Quality beats quantity.** Thousands of low-value transactions score lower than sustained, meaningful activity.
- **Sharing is weighted heavily** because building a real referral network that generates genuine on-chain activity is hard to fake.

The specific weights and formulas are proprietary. What you need to know: the score rewards being a genuine, long-term DeFi participant.

---

## Score Tiers

| Tier | Description |
|---|---|
| **Bronze** | Emerging on-chain presence — building history and activity across chains |
| **Silver** | Established participant with consistent history and protocol diversity |
| **Gold** | Seasoned, long-term wallet with depth across signals |

Tier thresholds are applied relative to the distribution of all scored wallets — they shift as the community grows.

---

## Wallet Character

Beyond your score, Attribution assigns a **character** to your wallet based on behavioural patterns — how you respond to volatility, your consistency across bull and bear markets, and your long-term orientation.

Character labels reflect observed behavioural traits, not judgements. Examples:

- *Ghost* — active in calm markets, dormant in chaos
- *Builder* — consistent protocol engagement regardless of market conditions
- *Liquidity Provider* — concentrated LP activity and depth

Character is shown on your profile page and used to surface relevant campaign and protocol opportunities.

---

## Multi-Chain Coverage

Attribution analyses activity across 100+ EVM and non-EVM chains. You don't need to migrate assets or bridge anything — Attribution reads your existing history wherever it lives.

Your score is chain-agnostic. Deep history on Arbitrum, Optimism, Polygon, Solana, or any supported chain contributes equally to your score. History is history.

---

## Score Updates

Your Attribution score updates as your on-chain activity grows. Major new activity — sustained LP positions, governance participation, referral network expansion — can meaningfully shift your score over time.

Short-term gaming (sudden bursts of low-quality activity) is detected and does not produce score increases proportional to the raw activity.

---

## Verifiable On-Chain

Your Attribution score can be published as a cryptographically signed EAS (Ethereum Attestation Service) attestation. This makes your score:

- **Verifiable** by any third party without trusting Mintware
- **Portable** to any protocol that integrates EAS
- **Timestamped** — the attestation records when the score was measured

See [EAS Attestations](../developers/eas-attestations.md) for details.

---

## How to Improve Your Score

There is no shortcut. The signals that matter most — long-term holding, liquidity depth, governance participation, and organic referral networks — take time to build.

Practical steps:
- Participate in governance across the protocols you already use
- Add and maintain LP positions rather than one-time deposits
- Build your referral network authentically — refer wallets that will actually be active
- Stay consistent across multiple chains rather than concentrating on one

See [Your Score](../getting-started/your-score.md) for how to read and interpret your score in detail.
