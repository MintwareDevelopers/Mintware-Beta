# @mintware/agentkit-actions

Coinbase AgentKit actions for [Mintware AI Attribution](https://mintware.finance) — on-chain reputation scoring for AI agents on Base.

## What it does

AgentKit actions that any AgentKit-powered agent can register:

| Action | Description |
|---|---|
| `MINTWARE_GET_SCORE` | Look up the Attribution score for any address (or the agent's own) |
| `MINTWARE_REGISTER` | Register the agent wallet with the Attribution contract on Base mainnet (one-time) |
| `MINTWARE_CLAIM_PENDING` | Submit pending oracle-signed attestations on-chain to update the score |
| `MINTWARE_X402_QUOTE` | Preflight an [x402](https://x402.org)-gated compute/API URL — return the price without paying |
| `MINTWARE_X402_PAY` | Pay for an x402-gated call in USDC (EIP-3009) from the agent wallet and return the resource |

The two x402 actions let an agent **pay for compute per call** in USDC. When the payer is a Mintware
Liquid Sovereign Account and the seller routes through the Mintware facilitator, the balance stays
yield-bearing until settlement and access is reputation-gated. See
[`docs/developers/agentkit-compute-402-spec.md`](../../docs/developers/agentkit-compute-402-spec.md).

**Contract (Base mainnet):** `0xb9FB965Caa7197932b52631e0121Ea54586e2B88`

---

## Installation

```bash
npm install @mintware/agentkit-actions @coinbase/agentkit zod
# or
pnpm add @mintware/agentkit-actions @coinbase/agentkit zod
```

---

## Setup

Set `AGENT_PRIVATE_KEY` in your environment before running any action that writes to chain (`MINTWARE_REGISTER`, `MINTWARE_CLAIM_PENDING`):

```bash
export AGENT_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
```

`MINTWARE_GET_SCORE` is read-only and does not require a private key.

---

## Usage with AgentKit + LangChain

```ts
import { AgentKit, CdpWalletProvider } from '@coinbase/agentkit'
import { getLangChainTools } from '@coinbase/agentkit/langchain'
import { ChatOpenAI } from '@langchain/openai'
import { createReactAgent } from '@langchain/langgraph/prebuilt'

import {
  mintwareGetScoreAction,
  mintwareRegisterAction,
  mintwareClaimPendingAction,
} from '@mintware/agentkit-actions'

// ── 1. Create wallet provider ─────────────────────────────────────────────────

const walletProvider = await CdpWalletProvider.configureWithWallet({
  apiKeyName:    process.env.CDP_API_KEY_NAME!,
  apiKeyPrivKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
  networkId:     'base-mainnet',
})

// ── 2. Create AgentKit and register Mintware actions ─────────────────────────

const agentkit = await AgentKit.from({
  walletProvider,
  actionProviders: [],
})

agentkit.use(mintwareGetScoreAction)
agentkit.use(mintwareRegisterAction)
agentkit.use(mintwareClaimPendingAction)

// ── 3. Convert to LangChain tools ────────────────────────────────────────────

const tools = getLangChainTools(agentkit)

// ── 4. Build the agent ───────────────────────────────────────────────────────

const llm = new ChatOpenAI({ model: 'gpt-4o' })

const agent = createReactAgent({ llm, tools })

// ── 5. Run ───────────────────────────────────────────────────────────────────

const result = await agent.invoke({
  messages: [{ role: 'user', content: 'What is my Mintware Attribution score?' }],
})

console.log(result.messages.at(-1)?.content)
```

### Register all actions at once using the convenience array

```ts
import { mintwareActions } from '@mintware/agentkit-actions'

for (const action of mintwareActions) {
  agentkit.use(action)
}
```

---

## Action reference

### `MINTWARE_GET_SCORE`

**Schema:**
```ts
{ address?: string }
```

- If `address` is omitted the action fetches the score for the agent's own wallet via `walletProvider.getAddress()`.
- Returns a formatted string with total score, rank, per-dimension breakdown, transparency status, and PnL if available.
- Throws on API errors (non-404). Returns a "not registered" message on 404.

### `MINTWARE_REGISTER`

**Schema:** `{}` (no arguments)

- Reads `AGENT_PRIVATE_KEY` from `process.env`.
- Calls `registerWithMintwareOracle` from `@mintware/ai-attribution-sdk`.
- Returns the tx hash on success.
- Throws if `AGENT_PRIVATE_KEY` is not set or the transaction reverts.

### `MINTWARE_CLAIM_PENDING`

**Schema:** `{}` (no arguments)

- Reads `AGENT_PRIVATE_KEY` from `process.env`.
- Gets the agent address from `walletProvider.getAddress()`.
- Calls `claimPendingActions` from `@mintware/ai-attribution-sdk`.
- Returns the count and tx hashes of submitted attestations, or a "nothing to claim" message.
- Throws if `AGENT_PRIVATE_KEY` is not set.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `AGENT_PRIVATE_KEY` | Required for write actions | 0x-prefixed hex private key of the agent wallet |
| `CDP_API_KEY_NAME` | Required by AgentKit | Coinbase Developer Platform API key name |
| `CDP_API_KEY_PRIVATE_KEY` | Required by AgentKit | Coinbase Developer Platform API key secret |

---

## Building from source

```bash
pnpm install
pnpm build
```

Output is emitted to `dist/`.

---

## License

MIT
