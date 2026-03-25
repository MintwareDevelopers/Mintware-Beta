# Points Campaigns

Points Campaigns run over fixed time windows called epochs. Participants earn points by completing qualifying actions, and at epoch end, the reward pool is distributed based on each wallet's point share — amplified by their Attribution score multiplier.

The result: two participants who complete the exact same actions can earn different rewards depending on how strong their on-chain reputation is.

---

## How It Works

```
Join the campaign (subject to minimum score requirement, if set)
        ↓
Complete qualifying actions during the epoch to earn points
        ↓
Points are credited in real time as actions are verified
        ↓
Epoch ends — total points across all participants are tallied
        ↓
Your Attribution score multiplier is applied to your point total
        ↓
Your share of the epoch pool = your weighted points / all weighted points
        ↓
Mintware publishes a Merkle distribution, signed by the oracle
        ↓
Claim your allocation on-chain
```

---

## Epochs

An epoch is a fixed time window — typically one week. Points reset at the start of each epoch. Past performance doesn't carry over.

Each epoch is a fresh competition. If a campaign runs for multiple epochs, each one is settled and distributed independently.

---

## Qualifying Actions

Each campaign defines its own set of qualifying actions and point values. Common examples:

| Action | Base Points | Frequency |
|---|---|---|
| Bridge | 15 pts | Once per wallet per campaign |
| Trade | 8 pts | Once per calendar day |
| Referral bridge | 60 pts | Per referred wallet that bridges |
| Referral trade | 8 pts | Per referred wallet per trading day |

Always check the campaign detail page for the exact actions and values — they vary by campaign.

---

## Score Multipliers

Your Attribution score applies a multiplier to your raw point total at the moment each action is credited. There are two independent multipliers:

**Attribution multiplier** — based on your Attribution score percentile relative to all scored wallets:

| Attribution Percentile | Multiplier |
|---|---|
| 0–33% (lower third) | 1.0× |
| 34–66% (middle third) | 1.25× |
| 67–100% (top third) | 1.5× |

**Sharing multiplier** — based on your Sharing score percentile (the strength of your referral network):

| Sharing Percentile | Multiplier |
|---|---|
| 0–33% | 1.0× |
| 34–66% | 1.15× |
| 67–100% | 1.3× |

Both multipliers combine **multiplicatively**. Maximum combined multiplier: **1.95×**.

> **Example:** A wallet in the top third for both Attribution and Sharing earns 1.5 × 1.3 = **1.95×** on every action. A trade worth 8 base points becomes 15.6 weighted points.

Multipliers are locked at the time each action is credited — they do not retroactively change if your score shifts during the campaign.

---

## The Epoch Distribution

When an epoch closes, the distribution is calculated off-chain:

1. All participant point totals are read (with multipliers already applied)
2. Each wallet's share is calculated as their weighted points divided by the sum of all weighted points
3. Each wallet's share is multiplied by the epoch pool size
4. A Merkle tree is built from the final allocations
5. Mintware's oracle cryptographically signs the Merkle root
6. The signed distribution is published on-chain and becomes claimable

No gas is spent by Mintware to publish the distribution — the oracle signature is enough. Claimers pay their own gas when they submit their Merkle proof.

---

## Minimum Score Access

Some Points Campaigns have a `min_score` threshold. Wallets below the threshold cannot join. If you're blocked, your Attribution score needs to improve first — see [Your Score](../getting-started/your-score.md).

---

## Who Creates Points Campaigns

Points Campaigns are created by whitelisted teams only. This is intentional — the score-multiplier system has real economic impact, and campaigns must be structured responsibly. Self-serve creation for Token Reward Pools is separate and open to anyone.

---

## Claim Deadline

Every epoch distribution includes a deadline. Claims must be submitted on-chain before this deadline. Deadlines are set generously, but don't leave them indefinitely — once expired, the allocation cannot be recovered.
