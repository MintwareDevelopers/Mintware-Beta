# Points Campaigns

Points Campaigns run over fixed time windows called epochs. Rewards are distributed at the end of each epoch based on the points you've earned and your Attribution score multiplier.

---

## How It Works

1. Join the campaign (subject to any minimum score requirement)
2. Complete qualifying actions during the epoch to earn points
3. At epoch end, your points are tallied and your multiplier is applied
4. Mintware publishes a Merkle distribution for the epoch
5. Claim your allocation on-chain

---

## Qualifying Actions

Each campaign defines its own set of actions. Common examples:

| Action | Points | Frequency |
|---|---|---|
| Bridge | 15 pts | Once per wallet |
| Trade | 8 pts | Once per day |
| Referral bridge | 60 pts per referred wallet | Per referred bridge |
| Referral trade | 8 pts per referred wallet | Per referred trading day |

Actions and point values vary by campaign — always check the campaign detail page for the specific rules.

---

## Score Multiplier

Your Attribution score applies a multiplier to your raw point total at epoch end. This means two participants who complete the same actions can earn different rewards based on their Attribution standing.

Higher-tier wallets earn a larger share of the epoch pool for the same actions.

---

## Minimum Score Access

Some Points Campaigns require a minimum Attribution score to join. If you don't meet the requirement, work on improving your score first — see [Your Score](../getting-started/your-score.md) for guidance.

---

## Epoch Distribution

At the end of each epoch:
1. Total points across all participants are tallied
2. Score multipliers are applied per wallet
3. Each wallet's share of the epoch pool is calculated
4. A Merkle tree is built from the distribution
5. Mintware's oracle signs the root — making it claimable on-chain

Your allocation is then available to claim via the campaign detail page.

---

## Multiple Epochs

Points Campaigns can run for multiple epochs. Your points reset each epoch — past performance doesn't carry over. Each epoch is an independent competition.
