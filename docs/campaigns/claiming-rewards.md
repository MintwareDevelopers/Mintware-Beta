# Claiming Rewards

---

## Token Reward Pool Claims

Rewards from Token Reward Pools become claimable after a short lock period following your qualifying swap.

1. Go to the campaign detail page
2. Any claimable rewards will appear in the **Claim** section
3. Click **Claim** and confirm the on-chain transaction
4. Tokens transfer directly to your connected wallet

Claiming requires a transaction on Base. Make sure you have a small amount of ETH for gas.

---

## Points Campaign Claims

At the end of each epoch, Mintware calculates your allocation and publishes a Merkle distribution.

1. Once the epoch ends and the distribution is published, a **Claim** button appears on the campaign detail page
2. Click **Claim** — your Merkle proof is fetched automatically
3. Confirm the on-chain transaction
4. Tokens transfer to your wallet

---

## Claim Deadline

Oracle-signed distributions have an expiry. Claims must be submitted before the deadline embedded in the signature. Deadlines are set generously (30 days by default) but don't leave it indefinitely.

---

## Already Claimed

If you've already claimed a distribution, the campaign page will show **Claimed** with the timestamp. You cannot claim the same distribution twice — the contract enforces this on-chain.

---

## Troubleshooting

**Claim button not appearing** — the epoch may not have settled yet, or the distribution hasn't been published. Check back shortly after epoch end.

**Transaction reverts** — ensure your wallet is connected to Base and you have sufficient ETH for gas. If the issue persists, the claim window may have expired.

**Wrong wallet connected** — rewards are claimable only by the wallet that earned them. Make sure you're connected with the correct wallet.
