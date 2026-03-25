# Token Reward Pools

Token Reward Pools are the simplest campaign type — a protocol deposits tokens, you complete qualifying swaps, and rewards are locked per transaction in real time. No epochs, no waiting for batch settlement.

---

## How It Works

```
Protocol deposits token budget into the campaign pool
        ↓
You complete a qualifying swap via Mintware Swap
        ↓
A reward is automatically locked for your wallet
        ↓
Short lock period (for on-chain verification)
        ↓
Reward becomes claimable — claim directly on-chain
        ↓
Tokens transfer to your wallet
```

The entire flow is automatic. You swap, the reward is locked, you claim when ready.

---

## Reward Structure

Each qualifying swap generates up to three reward components:

| Component | Who Receives It | Description |
|---|---|---|
| **Buyer Reward** | The swapper | The primary reward for completing the qualifying swap |
| **Referrer Reward** | The wallet that referred you (if applicable) | A share of the swap value directed to your referrer |
| **Platform Fee** | Mintware treasury | 2% of the swap value — Mintware's fee for operating the campaign |

The buyer reward percentage is set by the campaign creator when the pool is created. Referrer rewards incentivise growth through your referral network — see [Referral System](../referrals/overview.md).

---

## Qualifying Swaps

Not all swaps qualify. Each campaign defines:

- **Minimum swap size** — a floor transaction value in USD
- **Eligible tokens** — specific trading pairs or tokens that count
- **Chain** — swaps must occur on the campaign's designated chain

Always check the campaign detail page to confirm what qualifies before swapping.

---

## The Verification Window

There is a brief lock period between your swap and when the reward becomes claimable. During this window, Mintware verifies the on-chain transaction to confirm it meets campaign requirements.

Verification checks include:
- The transaction was successfully mined on-chain
- The swap was routed through a supported DEX aggregator
- The Mintware treasury fee was included in the transaction

This lock window exists to prevent fraudulent reward claims. Once verification passes, your reward status changes to **Claimable**.

---

## Claiming

When a reward is claimable, it appears in the **Rewards** section of the campaign detail page.

1. Click **Claim**
2. Confirm the on-chain transaction in your wallet
3. Tokens transfer directly to your connected wallet

> Gas is required to claim. Ensure your wallet has sufficient native token on the campaign's chain (e.g. ETH on Base, ETH on Arbitrum).

---

## Pool Depletion

The reward pool depletes as rewards are claimed. Once the pool is empty, the campaign ends automatically — no further rewards lock even if swaps continue. Campaign creators can top up the pool to extend the campaign.

The current pool balance is always shown on the campaign detail page.

---

## Batch Claiming

If you have multiple claimable rewards across epochs on the same contract, the UI displays a **Claim All (N)** button that submits a single batch transaction — saving gas compared to claiming individually.

---

## Creating a Pool

Token Reward Pool creation will be available to any wallet via the self-serve campaign interface (coming soon). Creating a pool requires:

1. Choosing the reward token and total budget
2. Setting the reward percentage per swap
3. Defining qualifying actions (minimum swap size, eligible tokens, chain)
4. Depositing the full token budget upfront

The first depositor becomes the campaign creator and is the only wallet that can recover remaining funds after the campaign closes.
