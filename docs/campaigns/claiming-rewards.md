# Claiming Rewards

---

## Token Reward Pool Claims

Rewards from Token Reward Pools become claimable after a short lock period following your qualifying swap.

1. Go to the campaign detail page
2. Any claimable rewards will appear in the **Claim** section
3. A context line shows exactly what will arrive and where — e.g. `0.25 USDC on Base → your wallet`
4. Click **Check your wallet →** and confirm the on-chain transaction
5. Tokens transfer directly to your connected wallet

> **Gas reminder:** Claiming requires an on-chain transaction. Make sure your wallet has a small amount of the campaign chain's native token for gas (e.g. ETH on Base or Arbitrum).

The button reflects the actual state as the claim progresses: `Getting proof…` → `Check your wallet →` → `Waiting for confirmation…`. If you are on the wrong network, the app will prompt you to switch before the wallet opens.

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

> **Don't delay.** If the deadline passes, that epoch's reward cannot be claimed. The contract enforces this — there is no override.

---

## Already Claimed

If you've already claimed a distribution, the campaign page will show **Claimed** with the timestamp. You cannot claim the same distribution twice — the contract enforces this on-chain.

---

## Batch Claiming

If you have claimable rewards across multiple epochs on the same campaign contract, the UI will show a **Claim All (N) — check your wallet →** button. This submits a single `batchClaim()` transaction covering all eligible distributions — saving gas compared to claiming each epoch individually.

Batch claims fetch a Merkle proof for your wallet address for each eligible distribution before opening the wallet. The network context is checked first so the app can prompt you to switch to the correct chain before any transaction is submitted.

---

## Troubleshooting

**Claim button not appearing** — the epoch may not have settled yet, or the distribution hasn't been published. Check back shortly after epoch end.

**Transaction reverts** — ensure your wallet is connected to the correct network for this campaign and has sufficient gas. If the issue persists, the claim window may have expired.

**Wrong wallet connected** — rewards are claimable only by the wallet that earned them. Make sure you're connected with the correct wallet.
