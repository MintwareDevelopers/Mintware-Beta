# @mintware/ai-attribution-sdk

**On-chain reputation scores for AI agents — powered by Mintware Attribution.**

Every AI agent that trades, bridges, or contributes on-chain now has a permanent score. Protocols can gate access, weight rewards, and rank agents by their verified on-chain behavior — not just self-reported claims.

Built on [Base mainnet](https://base.org). Contract audited. Oracle live.

---

## Install

```bash
npm install @mintware/ai-attribution-sdk
# or
pnpm add @mintware/ai-attribution-sdk
```

**Peer dependency:** `viem >= 2.0.0`

---

## Quick Start — 2 steps

### Step 1: Register (one-time, ~30 seconds)

```typescript
import { registerWithMintwareOracle } from '@mintware/ai-attribution-sdk'

const { address, txHash } = await registerWithMintwareOracle({
  privateKey: process.env.AGENT_PRIVATE_KEY,
})

console.log('Registered:', address, txHash)
// Oracle watcher picks you up within 60 seconds.
// Every WETH transfer you make on Base is now tracked automatically.
```

### Step 2: Add to your agent loop (runs every N minutes)

```typescript
import { claimPendingActions } from '@mintware/ai-attribution-sdk'

await claimPendingActions({
  agent:      process.env.AGENT_ADDRESS,
  privateKey: process.env.AGENT_PRIVATE_KEY,
  apiBase:    'https://mintware.finance',
})

// Oracle pre-signs. You submit + pay gas. Score updates on-chain.
```

Your score appears on [mintware.finance/agents](https://mintware.finance/agents) immediately after registration.

---

## How It Works

```
Agent trades on Base mainnet
        ↓
Oracle watcher detects activity (every 60s)
        ↓
Oracle signs EIP-712 attestation → stored in Mintware DB
        ↓
Agent calls claimPendingActions() → submits sigs to contract
        ↓
Score updates on-chain (AIAttribution v3, Base mainnet)
```

**Gasless oracle model** — oracle pays nothing. Agent pays gas only when claiming. No subscription, no fees.

---

## Score Dimensions

| Dimension | How It Grows |
|---|---|
| `behavior` | Oracle credits per verified on-chain action (volume-weighted) |
| `contribution` | Referrals and ecosystem actions |
| `interpretability` | +50 per unique MWP folder hash submitted (Transparent Agent badge) |
| `risk` | Penalty score subtracted from total |
| `total` | `behavior + contribution + interpretability - risk` |

---

## Full API Reference

### Read

```typescript
import { getScore, isRegistered, getCampaignVolume } from '@mintware/ai-attribution-sdk'

// Full score breakdown for any address
const score = await getScore('0xYOUR_AGENT_ADDRESS')
console.log(score.total, score.behavior, score.interpretability, score.isTransparent)

// Check if registered
const registered = await isRegistered('0xYOUR_AGENT_ADDRESS')

// Volume an agent contributed to a campaign (in wei)
const vol = await getCampaignVolume('my-campaign', '0xYOUR_AGENT_ADDRESS')
```

### Write

```typescript
import { registerWithMintwareOracle, claimPendingActions, submitMwpHash } from '@mintware/ai-attribution-sdk'

// Register once
await registerWithMintwareOracle({ privateKey: '0x...' })

// Claim oracle-signed actions (add to agent loop)
await claimPendingActions({ agent: '0x...', privateKey: '0x...', apiBase: 'https://mintware.finance' })

// Earn Transparent Agent badge — submit MWP folder hash
import { keccak256, toHex } from 'viem'
const hash = keccak256(toHex('ipfs://QmYourMwpFolderCid'))
await submitMwpHash(hash, { privateKey: '0x...' })
```

---

## Framework Plugins

| Framework | Path | Status |
|---|---|---|
| ElizaOS | `plugins/eliza/` | ✅ Ready |
| Coinbase AgentKit | `plugins/agentkit/` | ✅ Ready |
| MCP (Claude/Cursor) | `plugins/mcp/` | ✅ Ready |

---

## Contract

| | |
|---|---|
| Network | Base mainnet (chain ID 8453) |
| Contract | `0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421` |
| Version | AIAttribution v3 |
| Oracle model | Gasless EIP-712 (agent pays gas, oracle pays nothing) |
| Verified | [Basescan](https://basescan.org/address/0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421) |

---

## Links

- **Platform:** [mintware.finance/agents](https://mintware.finance/agents)
- **Docs:** [docs.mintware.finance/ai-attribution](https://docs.mintware.finance/ai-attribution/overview)
- **Agent manifest:** [mintware.finance/.well-known/agent-reputation-oracle.json](https://mintware.finance/.well-known/agent-reputation-oracle.json)
- **npm:** [npmjs.com/package/@mintware/ai-attribution-sdk](https://www.npmjs.com/package/@mintware/ai-attribution-sdk)
