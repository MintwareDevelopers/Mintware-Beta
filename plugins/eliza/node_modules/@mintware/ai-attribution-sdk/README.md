# @mintware/ai-attribution-sdk

Mintware's AI Attribution SDK gives every ERC-8004 agent a persistent, cross-chain reputation score. Register in one transaction, submit MWP folder hashes to earn the Transparent Agent badge, and let protocols gate access or weight rewards by your on-chain behavior — all with three lines of code.

## Install

Not yet published to npm. Install from source:

```bash
# From the project root
pnpm install
cd sdk && pnpm build
```

Once published:
```bash
pnpm add @mintware/ai-attribution-sdk
# or
npm install @mintware/ai-attribution-sdk
```

**Peer dependency:** `viem >= 2.0.0`

## Quick Start

```typescript
import { registerAgent, submitMwpHash, getScore } from '@mintware/ai-attribution-sdk'
import { keccak256, toHex } from 'viem'

const AGENT_KEY = '0xYOUR_PRIVATE_KEY'

// 1. Register your agent wallet (one-time, permissionless)
const regTx = await registerAgent({ privateKey: AGENT_KEY })
console.log('Registered:', regTx)

// 2. Submit a MWP folder hash to earn Transparent Agent badge (+50 interpretability pts)
const hash = keccak256(toHex('ipfs://QmYourMwpFolderCid'))
await submitMwpHash(hash, { privateKey: AGENT_KEY })

// 3. Read your score
const score = await getScore('0xYOUR_AGENT_ADDRESS')
console.log(`Total: ${score.total} | Transparent: ${score.isTransparent}`)
// Total: 50n | Transparent: true
```

All functions default to **Base Sepolia**. Override with `rpcUrl` and `contractAddress` options for mainnet.

## API Reference

| Function | Signature | Description |
|---|---|---|
| `getScore` | `(agent, opts?) => Promise<AgentScore>` | Read full score breakdown for any agent address |
| `isRegistered` | `(agent, opts?) => Promise<boolean>` | Check if an address is registered |
| `getCampaignVolume` | `(campaignId, agent, opts?) => Promise<bigint>` | Volume an agent contributed to a campaign (in wei) |
| `registerAgent` | `(opts: WriteOptions) => Promise<0x${string}>` | Register the calling wallet — permissionless, one-time |
| `linkErc8004` | `(tokenId, opts: WriteOptions) => Promise<0x${string}>` | Link an ERC-8004 tokenId to the agent wallet |
| `submitMwpHash` | `(mwpHash, opts: WriteOptions) => Promise<0x${string}>` | Submit a MWP folder snapshot hash (+50 interpretability pts) |
| `recordAction` | `(params & OracleOptions) => Promise<0x${string}>` | Oracle-only: record a verified on-chain action for an agent |
| `createCampaign` | `(params & WriteOptions) => Promise<0x${string}>` | Create a new Agent Volume Campaign on-chain |

## Score Breakdown

| Dimension | Type | How it grows | Notes |
|---|---|---|---|
| `behavior` | `uint128` | Oracle credits per verified on-chain action | Proportional to volume contributed |
| `contribution` | `uint128` | Oracle credits for referrals and ecosystem actions | Set by oracle at record time |
| `interpretability` | `uint64` | +50 per unique `submitMwpHash` call | Hard cap: 500. Unlocks `isTransparent = true` at first submission |
| `risk` | `uint64` | Penalty score — subtracted from total | Set by oracle; higher = worse |
| `total` | `uint256` | `behavior + contribution + interpretability - risk` | What protocols read for gating/weighting |

## Contract Addresses

| Network | Address |
|---|---|
| Base Sepolia (testnet) | `0xDB9DB7008cfFb09bD1D943C237f57327383DFc03` |
| Base mainnet | Coming soon |

Contract owner: `0x9c646C48a302f4725450669f1218d3FDb3e933AD`
Oracle: `0xc75D4b4bdB4D7ac103671f45E99D2FA6107B2e93`

## ERC-8004

ERC-8004 is a proposed standard for on-chain AI agent identity tokens. The AIAttribution contract supports it as an **optional enhancement**:

- At launch, `requireErc8004 = false` — registration is permissionless, no token needed.
- Call `linkErc8004(tokenId)` at any time to bind your ERC-8004 identity token to the agent wallet. This ties your off-chain agent identity to on-chain reputation.
- The contract owner can flip `requireErc8004 = true` when the ERC-8004 ecosystem matures — at that point, new registrations will require a valid tokenId.

## License

MIT
