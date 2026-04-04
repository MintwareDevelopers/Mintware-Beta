# Mintware Swap

The Mintware Swap interface lets you swap tokens across chains while qualifying for campaign rewards. You get best-execution routing plus campaign rewards on top — no separate step required.

---

## Routing

### LI.FI (All Chains)

Mintware uses [LI.FI](https://li.fi) as the primary routing aggregator. LI.FI sources liquidity across DEXes and bridges to find the best available route for your swap. It handles cross-chain swaps (bridging + swapping in a single transaction) as well as same-chain swaps.

When you request a quote, Mintware's server proxies the request to LI.FI — your API keys are never exposed to the browser. The Mintware platform fee is injected server-side before the route is returned, so the fee is always present in the quoted calldata.

### 0x (Core Chain Only)

Swaps on the **Core** chain are routed through [0x Protocol](https://0x.org) rather than LI.FI. Core is not yet supported by LI.FI's aggregation layer — once it is, routing will unify. Until then, Core swaps use 0x's native routing for that chain.

> **Core swaps are coming soon** — the Molten router is pending deployment. The swap interface will show a status message while this is being finalized.

---

## Supported Chains

| Chain | Router | Status |
|---|---|---|
| Base | LI.FI | Live |
| Arbitrum | LI.FI | Live |
| Core | 0x | Coming soon |

Additional chains are added as campaigns go live.

---

## Qualifying for Rewards

To qualify for campaign rewards from a swap:

1. You must have joined the relevant campaign
2. The swap must be completed through the Mintware Swap interface
3. The swap must meet any campaign-specific conditions (token pair, minimum size, etc.)

If your swap qualifies, a reward is automatically locked for your wallet. No additional action is needed until you're ready to claim.

---

## Fees

Mintware charges a small platform fee on qualifying swaps. This fee is injected server-side into the quoted route — what you see is what you pay, with no surprise deductions after execution.

The fee is verified on-chain after your swap completes. If the fee is not present in the transaction calldata, the swap is still executed but no campaign reward is credited.

**Network fees are shown fiat-first.** The swap interface shows the estimated network cost as `~$0.05` with the native token amount as secondary context (`~0.00003 ETH`). This makes the cost immediately legible regardless of which chain you are on.

---

## Best Execution

The swap interface always shows the best available route from the aggregator. The Mintware fee is layered on top of the underlying execution — it does not degrade your received amount below what you'd get going directly to the aggregator.

---

## Review Before You Confirm

Clicking **Review Swap** opens a confirmation panel before your wallet popup appears. It shows:

- the token and amount you are sending, with USD value
- the estimated token and amount you should receive
- the network the swap will happen on
- the estimated network fee (fiat-first: `~$0.05 (~0.00003 ETH)`)
- the Mintware platform fee as a percentage and estimated USD amount
- price impact with a warning if it exceeds 2%
- the aggregator route being used
- a plain-language explanation of what will happen

If your wallet does not have enough native token to cover the estimated fee, a warning appears before you reach the confirmation panel.

After reviewing, clicking **Open wallet to confirm** opens your wallet. You can cancel at any time before that point.
