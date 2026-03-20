# Token Reward Pools

Token Reward Pools distribute rewards per qualifying swap transaction. No epochs, no waiting for a distribution — every qualifying swap locks a reward for your wallet immediately.

---

## How It Works

1. A protocol deposits tokens into a campaign pool
2. You complete a qualifying swap via the Mintware Swap interface
3. A reward is automatically locked for your wallet
4. After a short claim window, the reward becomes claimable
5. Claim directly on-chain — tokens transfer to your wallet

---

## Reward Structure

Each pool defines the reward per qualifying transaction. There are typically three reward components per swap:

- **Buyer reward** — goes to the wallet that made the swap
- **Referrer reward** — goes to whoever referred the buyer (if applicable)
- **Platform fee** — Mintware's 2% fee, directed to the treasury

---

## Claim Window

Rewards enter a brief lock period after the swap before becoming claimable. This window is defined by the campaign creator and exists to allow for verification.

Once the window passes, the reward is available to claim from the campaign detail page or your profile.

---

## Pool Depletion

Token Reward Pools deplete as rewards are claimed. Once the pool is empty, the campaign ends. Campaigns can be topped up by the creator.

---

## Creating a Pool

Token Reward Pool creation will be available to anyone via the self-serve campaign interface (coming soon). Pools require depositing the reward token upfront.
