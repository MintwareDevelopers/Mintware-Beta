# Score Multipliers

Points Campaigns apply multipliers to your raw action points based on your on-chain reputation. This means wallets with stronger histories earn more points per action — and a proportionally larger share of each epoch's reward pool.

---

## Two Multipliers

| Multiplier | Based on | Max |
|---|---|---|
| Attribution | Your Attribution score percentile | 1.5× |
| Sharing | Your referral network (Sharing score percentile) | 1.3× |

Both multipliers are applied **multiplicatively**. The maximum combined multiplier is **1.95×**.

---

## Percentile Bands

| Percentile | Attribution multiplier | Sharing multiplier |
|---|---|---|
| 0–33% | 1.0× | 1.0× |
| 34–66% | 1.25× | 1.15× |
| 67–100% | 1.5× | 1.3× |

Your percentile is calculated relative to all scored wallets at the time you join the campaign.

---

## When Multipliers Apply

Multipliers are applied **at point-credit time** — when your action (swap, bridge, referral) is recorded. They are not retroactively recalculated if your score changes during the campaign.

This means:
- Building your Attribution score before joining a campaign gives you a better multiplier from day one
- Referring wallets before joining increases your Sharing score, which boosts your Sharing multiplier

---

## Example

A wallet in the 70th percentile for both Attribution and Sharing earns:

```
1.5 × 1.3 = 1.95× per action
```

A trade action worth 8 base points becomes **15.6 points** after multipliers.

---

## Which Campaigns Use Multipliers

Only **Points Campaigns** use score multipliers. Token Reward Pool campaigns pay a flat percentage of swap value — no multipliers apply.

Check the campaign detail page to see whether a campaign is a Points Campaign and what your current multiplier is.
