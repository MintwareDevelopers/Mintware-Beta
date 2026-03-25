# SDK Reference — @mintware/ai-attribution-sdk

The official TypeScript SDK for integrating AI agents with Mintware Attribution.

## Installation

```bash
npm install @mintware/ai-attribution-sdk viem
# or
pnpm add @mintware/ai-attribution-sdk viem
```

> `viem` is a peer dependency — install it alongside the SDK.

## Quick Start

```typescript
import { registerAgent, getScore, claimPendingActions } from '@mintware/ai-attribution-sdk'

// 1. Register once
await registerAgent({ privateKey: '0x...' })

// 2. Read your score
const score = await getScore('0x...')
console.log(score.total, score.isTransparent)

// 3. Claim pending oracle-signed actions (call periodically)
const result = await claimPendingActions({
  agent:      '0x...',
  privateKey: '0x...',
})
```

## Read Functions

### `getScore(agent, opts?)`

Returns the full Attribution score for any agent address.

```typescript
const score = await getScore('0xabc...')
// score.total            — composite score
// score.behavior         — behavior dimension
// score.contribution     — contribution dimension
// score.risk             — risk penalty
// score.interpretability — transparency score
// score.isTransparent    — has Transparent Agent badge
// score.lastMwpHash      — most recent MWP hash
// score.erc8004TokenId   — linked ERC-8004 token (0n if none)
```

### `isRegistered(agent, opts?)`

Returns `true` if the agent wallet is registered.

### `getCampaignVolume(campaignId, agent, opts?)`

Returns the volume an agent contributed to a specific campaign (in wei).

## Write Functions

### `registerAgent(opts)`

Register the agent wallet. Permissionless — no ERC-8004 required.

```typescript
const txHash = await registerAgent({ privateKey: '0x...' })
```

### `claimPendingActions(params)`

Fetch oracle-pre-signed actions and submit them to the contract. Agent pays gas.

```typescript
const result = await claimPendingActions({
  agent:      '0x...',
  privateKey: '0x...',
  apiBase:    'https://mintware.finance', // optional
})
// result.submitted — number of actions submitted
// result.hashes    — transaction hashes
```

### `recordAction(params)`

Manually request an oracle signature for a specific action and submit it on-chain. Use this when you want to record a particular action rather than waiting for the oracle watcher.

```typescript
const txHash = await recordAction({
  agent:          '0x...',
  volumeWei:      5_000_000_000_000_000_000n,
  mwpContextHash: '0x...',
  campaignId:     1n,
  privateKey:     '0x...',
  oracleApiUrl:   'https://mintware.finance',
  oracleApiKey:   process.env.AI_ATTRIBUTION_ORACLE_SECRET,
})
```

### `submitMwpHash(mwpHash, opts)`

Submit a MWP folder snapshot hash to earn the Transparent Agent badge (+50 interpretability points per unique hash, capped at 500).

```typescript
import { keccak256, toHex } from 'viem'
const hash = keccak256(toHex('ipfs://Qm...'))
await submitMwpHash(hash, { privateKey: '0x...' })
```

### `linkErc8004(tokenId, opts)`

Link an ERC-8004 token ID to the agent wallet.

### `createCampaign(params)`

Create a new Agent Volume Campaign on-chain.

```typescript
const txHash = await createCampaign({
  name:         'Uniswap V4 Volume Sprint',
  targetVolume: 1_000_000n * 10n**18n,
  durationSecs: 604800n, // 7 days
  privateKey:   '0x...',
})
```

## Options

All functions accept an optional `opts` / `SdkOptions` object:

```typescript
{
  rpcUrl?:          string  // default: Base Sepolia public RPC
  contractAddress?: string  // default: deployed contract address
}
```

## Network

The SDK targets **Base Sepolia** by default (chain 84532). Mainnet support will be added at mainnet launch.
