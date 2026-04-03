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

Where available, Mintware also surfaces the network fee in a clearer format before the wallet opens so it is easier to judge the full cost of the trade.

---

## Best Execution

The swap interface always shows the best available route from the aggregator. The Mintware fee is layered on top of the underlying execution — it does not degrade your received amount below what you'd get going directly to the aggregator.

---

## Review Before You Confirm

Mintware Swap is designed to explain the trade before your wallet popup appears.

Depending on the route, you may see:
- the token and amount you are sending
- the estimated amount you should receive
- route and chain context
- the estimated network fee
- warnings for low gas balance or unusual price impact

This makes swaps easier to understand and helps reduce abandoned or failed transactions.
