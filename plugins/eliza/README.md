# @mintware/eliza-plugin

Mintware AI Attribution plugin for [ElizaOS](https://elizaos.ai). Gives your autonomous agent on-chain reputation — track score, register, and claim oracle attestations, all from natural language.

Built on the [Mintware AI Attribution](https://mintware.finance) protocol on Base mainnet. Powered by `@mintware/ai-attribution-sdk`.

---

## What it does

| Action | Trigger phrases | Description |
|---|---|---|
| `GET_ATTRIBUTION_SCORE` | "check my attribution score", "get reputation score for 0x..." | Fetches total score, rank, behavior, contribution, interpretability, risk, transparent status, and PnL for any agent address |
| `REGISTER_MINTWARE` | "register with Mintware", "join Mintware attribution" | Submits a one-time `registerAgent()` tx on Base mainnet and enrolls the wallet with the oracle watcher |
| `CLAIM_PENDING_ACTIONS` | "claim pending actions", "update my attribution score" | Fetches pre-signed oracle attestations and submits each to the contract — keeps the score current |
| `PARK_USDC` | "park $25 into the vault", "earn yield on my usdc" | Parks USDC into the Mintware yield vault (ERC-20 `approve` + ERC-4626 `deposit`) so it earns while staying spendable in place — never locks |
| `UNPARK_USDC` | "un-park all my usdc", "withdraw from the yield vault" | Redeems vault shares back to USDC (reads `shares` + `previewWithdraw`, then `redeem`); omit an amount to un-park everything |
| `SHOW_TREASURY` | "show my treasury", "how much can I spend" | Read-only — shows how much USDC is parked (earning) and how much is spendable in place right now |
| `QUOTE_X402` | "quote x402 for https://…", "how much does this cost" | Read-only — preflights an x402-gated URL and reports the advertised price, network, recipient, and scheme without paying |
| `PAY_X402` | "pay x402 for https://…", "pay for this call" | Pays an x402-gated call in USDC via a signed EIP-3009 `TransferWithAuthorization`, retries with the payment header, and returns the resource |

The oracle watcher runs every 60 seconds, detects on-chain WETH activity from registered agents, and pre-signs EIP-712 attestations. Your agent calls `CLAIM_PENDING_ACTIONS` to pull those signatures and record them on-chain. The agent pays gas; the oracle pays nothing.

### Capital parking + x402

`PARK_USDC` / `UNPARK_USDC` move USDC in and out of the Mintware yield vault — capital earns yield but stays fully spendable in place (it never locks). Once parked, the agent spends it per compute/API call with `PAY_X402`, which signs an EIP-3009 authorization and settles in USDC; use `QUOTE_X402` first to preview cost, and `SHOW_TREASURY` to see parked vs. spendable balances. The vault, USDC token, and RPC default to the live Arc-testnet YPN stack and are overridable via runtime settings (`MINTWARE_PARK_VAULT`, `MINTWARE_PARK_USDC`, `MINTWARE_PARK_RPC`, `MINTWARE_PARK_CHAIN_ID`).

---

## Installation

```bash
npm install @mintware/eliza-plugin
```

Or with pnpm:

```bash
pnpm add @mintware/eliza-plugin
```

---

## Setup

### 1. Add your agent private key to the environment

```bash
# .env
AGENT_PRIVATE_KEY=0xYOUR_AGENT_WALLET_PRIVATE_KEY
```

This is the wallet that will be registered on-chain and pay gas for `registerAgent()` and `recordVerifiedAction()` calls. Keep it server-side only — never expose it in a client bundle.

### 2. Import and register the plugin

```typescript
import { AgentRuntime } from '@elizaos/core'
import mintwarePlugin from '@mintware/eliza-plugin'

const runtime = new AgentRuntime({
  // ... your other config
  plugins: [
    mintwarePlugin,
    // ... other plugins
  ],
  settings: {
    AGENT_PRIVATE_KEY: process.env.AGENT_PRIVATE_KEY,
  },
})
```

That's it. The plugin is now active. Your agent will respond to the natural-language triggers listed above.

---

## Usage examples

### Look up a score

```
User:  Check my attribution score
Agent: Attribution Score for 0xabc1…ef12
       ─────────────────────────────
       Total Score:      320
       Rank:             #14

       Score Breakdown:
         Behavior:         110
         Contribution:     95
         Interpretability: 80
         Risk Penalty:     0

       Transparent Agent: Yes (MWP hash on-chain)
```

### Look up another agent

```
User:  Get reputation score for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
Agent: Attribution Score for 0xd8dA…6045
       ...
```

### Register

```
User:  Register with Mintware
Agent: Registering with Mintware AI Attribution on Base mainnet. Submitting transaction…
       …
       Registration successful.

       Address:  0xabc1…ef12
       Tx Hash:  0x1a2b3c4d5e…f6a7b8
       Network:  Base mainnet

       The Mintware oracle watcher will start tracking your on-chain activity within ~60 seconds.
```

### Claim pending attestations

```
User:  Claim pending actions
Agent: Successfully submitted 2 attribution actions on-chain.

       Transactions:
         1. 0x1a2b3c4d5e…f6a7b8
         2. 0x9b8c7d6e5f…a1b2c3

       Your Attribution score will update on the next oracle sync (~60 seconds).
```

---

## Contract details

| Field | Value |
|---|---|
| Network | Base mainnet (chain ID 8453) |
| Contract | `0xb9FB965Caa7197932b52631e0121Ea54586e2B88` |
| Standard | ERC-8004 (AI Agent Registry) |
| Oracle pattern | Gasless EIP-712 — agent pays gas, oracle signs off-chain |

---

## Score dimensions

| Dimension | Description |
|---|---|
| Behavior | On-chain trading consistency and quality |
| Contribution | Volume and protocol engagement |
| Interpretability | MWP folder hash submissions (Transparent Agent badge) |
| Risk Penalty | Deducted for flagged behaviour |
| Total Score | Sum of all dimensions minus risk penalty |

Scores update within ~60 seconds of submitting a `CLAIM_PENDING_ACTIONS` transaction.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `AGENT_PRIVATE_KEY` | Required for write actions | 0x-prefixed private key for the agent wallet |
| `MINTWARE_PARK_VAULT` | Optional | ERC-4626 yield vault address (default: Arc-testnet `0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421`) |
| `MINTWARE_PARK_USDC` | Optional | USDC token address on the parking network (default: Arc-testnet `0x3600000000000000000000000000000000000000`) |
| `MINTWARE_PARK_RPC` | Optional | JSON-RPC endpoint for parking reads/writes (default: `https://rpc.testnet.arc.io`) |
| `MINTWARE_PARK_CHAIN_ID` | Optional | Chain ID for parking transactions (default: `5042002`, Arc testnet) |

`GET_ATTRIBUTION_SCORE`, `SHOW_TREASURY`, and `QUOTE_X402` work without a private key — they read from public REST/RPC. `PARK_USDC`, `UNPARK_USDC`, and `PAY_X402` require `AGENT_PRIVATE_KEY`.

---

## Build from source

```bash
cd plugins/eliza
pnpm install
pnpm build
```

Output goes to `dist/`.
