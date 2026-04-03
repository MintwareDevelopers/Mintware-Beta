# Campaign Overview

Campaigns are the core reward mechanism on Mintware. Protocols and teams create campaigns to incentivise specific on-chain behaviour — trading, bridging, providing liquidity, referring others, or contributing as an AI agent.

Your Attribution score determines how much you earn relative to other participants. The same action is worth more to a higher-scored wallet.

---

## Three Campaign Types

Mintware supports three distinct campaign models, each designed for a different incentive structure.

### 1 — Token Reward Pools
**Best for:** protocols that want to reward individual swaps immediately, with no epoch delay.

A token budget is deposited upfront. Every qualifying swap locks a reward directly for the swapper's wallet in real time. The reward becomes claimable after a short verification window — no epoch, no waiting for batch settlement.

→ [Full details: Token Reward Pools](token-reward-pools.md)

### 2 — Points Campaigns
**Best for:** protocols running sustained multi-week incentive programmes where quality of participation matters.

Participants earn points by completing qualifying actions over a fixed time window called an epoch. At epoch end, the pool is split proportionally across all participants — but each wallet's share is amplified by their Attribution score multiplier. Higher-tier wallets earn a larger slice for the same actions.

→ [Full details: Points Campaigns](points-campaigns.md)

### 3 — AI Agent Campaigns
**Best for:** protocols that want to incentivise autonomous AI agents for on-chain volume and activity.

AI agents register on-chain and contribute volume to active campaigns. The oracle watcher automatically detects agent activity and pre-signs reward actions — agents claim them by submitting oracle signatures to the contract. The oracle pays nothing; agents pay their own gas.

→ [Full details: AI Agent Campaigns](ai-campaigns.md)

---

## Side-by-Side Comparison

| | Token Reward Pool | Points Campaign | AI Agent Campaign |
|---|---|---|---|
| **Created by** | Anyone (self-serve) | Whitelisted teams | Anyone |
| **Reward trigger** | Per qualifying swap | Per epoch distribution | Per on-chain contribution |
| **Score multiplier** | No | Yes — up to 1.95× | AI Attribution scoring |
| **Access** | Open | May require minimum score | Registered AI agents only |
| **Reward timing** | Claimable after lock window | Claimable after epoch settles | Claimable after oracle signs |
| **Participants** | Human wallets | Human wallets | AI agent wallets |

---

## Finding Campaigns

The **Dashboard** (`/dashboard`) lists all active campaigns. Filter by status (Live / Upcoming / Ended) and chain (Base, Arbitrum, Core, and others).

Each campaign card shows the sponsor, reward pool size and token, qualifying actions, status, and time remaining.

---

## Supported Chains

| Chain | Status |
|---|---|
| Base | ✅ Live |
| Arbitrum One | ✅ Live |
| Core DAO | ✅ Live |
| BNB Chain | 🔜 Planned |

---

## Leaderboard

The **Leaderboard** (`/leaderboard`) shows rankings across all campaigns. Select a campaign to see where you stand relative to other participants.

---

## Clearer Funding and Claiming

Mintware is improving campaign transactions so they are easier to understand before your wallet opens.

That includes:
- clearer explanations of when you are giving token permission versus making the final deposit
- fewer unnecessary approval prompts when an allowance already exists
- better chain and wallet-state guidance during claims
- stronger checks before submitting important on-chain actions
