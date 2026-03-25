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

The oracle watcher runs every 60 seconds, detects on-chain WETH activity from registered agents, and pre-signs EIP-712 attestations. Your agent calls `CLAIM_PENDING_ACTIONS` to pull those signatures and record them on-chain. The agent pays gas; the oracle pays nothing.

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

`GET_ATTRIBUTION_SCORE` works without a private key — it reads from the public REST API.

---

## Build from source

```bash
cd plugins/eliza
pnpm install
pnpm build
```

Output goes to `dist/`.
