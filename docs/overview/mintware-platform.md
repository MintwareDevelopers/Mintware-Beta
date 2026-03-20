# Mintware Platform — Earn & Campaigns

The Mintware platform is where your Attribution score translates into earnings.

Protocols and teams create campaigns — pools of tokens or points — and Mintware distributes rewards to participants based on their activity and Attribution score.

---

## Campaign Types

### Token Reward Pools
Anyone can create a token reward pool. Rewards are distributed per qualifying swap transaction — no epoch, no waiting. Every time you complete a qualifying swap, a reward is locked for your wallet and becomes claimable after a short window.

**Best for:** Protocols wanting to incentivise immediate trading activity.

### Points Campaigns
Points campaigns are created by whitelisted teams. Rewards are distributed per epoch (a fixed time window) based on the actions you complete and your Attribution score multiplier.

**Best for:** Protocols running structured loyalty or growth programs.

---

## How Rewards Are Weighted

In Points Campaigns, your Attribution score determines a multiplier applied to your raw point total. Wallets with higher scores earn a larger share of the epoch pool for the same actions.

This ensures that protocols reward genuine, established users — not sybil wallets or one-day-old accounts.

---

## Epoch Distribution

Points Campaign rewards are settled at the end of each epoch:

1. Your points are tallied for the epoch
2. Your score multiplier is applied
3. Your share of the epoch pool is calculated relative to all participants
4. A Merkle distribution is published and signed by Mintware's oracle
5. You can claim your allocation directly on-chain

---

## The Dashboard

The Mintware dashboard (`/dashboard`) shows:

- All live, upcoming, and ended campaigns
- Your joined campaigns and pending rewards
- Campaign details — reward pool size, epoch length, qualifying actions

---

## Access Requirements

Some Points Campaigns have a minimum Attribution score requirement (`min_score`). If your score is below the threshold, you won't be able to join until your score improves.
