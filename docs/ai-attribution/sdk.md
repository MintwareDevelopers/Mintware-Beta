# SDK Reference — @mintware/ai-attribution-sdk

The official TypeScript SDK for integrating AI agents with Mintware Attribution.

## Installation

```bash
npm install @mintware/ai-attribution-sdk
# or
pnpm add @mintware/ai-attribution-sdk
```

> `viem >= 2.0.0` is a peer dependency — install it alongside the SDK.

---

## Quick Start

```typescript
import { registerWithMintwareOracle, claimPendingActions, getScore } from '@mintware/ai-attribution-sdk'

// Step 1 — Register once (on-chain + profile sync in one call)
await registerWithMintwareOracle({ privateKey: process.env.AGENT_PRIVATE_KEY })

// Step 2 — Add to agent loop (runs every N minutes)
await claimPendingActions({
  agent:      process.env.AGENT_ADDRESS,
  privateKey: process.env.AGENT_PRIVATE_KEY,
  apiBase:    'https://mintware.finance',
})

// Read score at any time
const score = await getScore(process.env.AGENT_ADDRESS)
console.log(score.total.toString(), score.isTransparent)
```

---

## Read Functions

### `getScore(agent, opts?)`

Returns the full Attribution score for any agent address.

```typescript
const score = await getScore('0xabc...')
// score.total            — composite score (bigint)
// score.behavior         — behavior dimension (bigint)
// score.contribution     — contribution dimension (bigint)
// score.interpretability — transparency score (bigint)
// score.risk             — risk penalty (bigint)
// score.isTransparent    — has Transparent Agent badge (boolean)
// score.lastMwpHash      — most recent MWP hash (bytes32)
// score.erc8004TokenId   — linked ERC-8004 token (0n if none)
```

### `isRegistered(agent, opts?)`

Returns `true` if the agent wallet is registered on-chain.

### `getCampaignVolume(campaignId, agent, opts?)`

Returns the volume (in wei) an agent contributed to a specific campaign.

---

## Write Functions

### `registerWithMintwareOracle(opts)`

Register the agent wallet on-chain and sync the profile with Mintware in one call. Use this instead of `registerAgent()` for the full setup. Returns a `metadata_url` — set this as your ERC-8004 Identity Registry `tokenURI`.

```typescript
const { address, txHash, metadata_url } = await registerWithMintwareOracle({
  privateKey: '0x...',
  apiBase:    'https://mintware.finance', // optional

  // ERC-8004 identity metadata (all optional)
  agentName:         'My Agent',
  agentDescription:  'DeFi arbitrage agent on Base',
  x402Support:       true,
  operationalStatus: 'active',  // 'active' | 'paused' | 'offline'
  services: [
    { name: 'MCP', endpoint: 'https://myagent.xyz/mcp', version: '1.0' },
    { name: 'A2A', endpoint: 'https://myagent.xyz/a2a' },
  ],
})
// metadata_url → https://mintware.finance/api/agents/{address}/erc8004-metadata
// Set this as tokenURI when registering with the ERC-8004 Identity Registry
```

### `claimPendingActions(params)`

Fetch oracle-pre-signed actions and submit them to the contract. Agent pays gas.

```typescript
const result = await claimPendingActions({
  agent:      '0x...',
  privateKey: '0x...',
  apiBase:    'https://mintware.finance',
})
// result.submitted — number of actions submitted
// result.hashes    — on-chain transaction hashes
```

### `submitMwpHash(mwpHash, opts)`

Submit a MWP folder snapshot hash. Earns +50 interpretability points per unique hash (max 500). Unlocks the Transparent Agent badge on first submission.

```typescript
import { keccak256, toHex } from 'viem'
const hash = keccak256(toHex('ipfs://QmYourFolderCid'))
await submitMwpHash(hash, { privateKey: '0x...' })
```

### `linkErc8004(tokenId, opts)`

Link an ERC-8004 token ID to the agent wallet.

```typescript
await linkErc8004(42n, { privateKey: '0x...' })
```

### `registerAgent(opts)`

Low-level on-chain only registration. Prefer `registerWithMintwareOracle()` which also syncs the Mintware profile.

### `recordAction(params)`

Oracle-only. Manually request a signature for a specific action and submit it on-chain. Requires an oracle API key.

```typescript
const txHash = await recordAction({
  agent:          '0x...',
  volumeWei:      5_000_000_000_000_000_000n,
  mwpContextHash: '0x' + '00'.repeat(32),
  campaignId:     1n,
  privateKey:     '0x...',
  oracleApiUrl:   'https://mintware.finance',
  oracleApiKey:   process.env.AI_ATTRIBUTION_ORACLE_SECRET,
})
```

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

---

## Options

All functions accept an optional `opts` / `SdkOptions` object:

```typescript
{
  rpcUrl?:          string  // default: https://mainnet.base.org
  contractAddress?: string  // default: 0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421
}
```

---

## Network

The SDK targets **Base mainnet** (chain ID 8453) by default.

| | |
|---|---|
| Chain | Base mainnet (8453) |
| Contract | `0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421` (AIAttribution v3) |
| RPC | `https://mainnet.base.org` |
| npm | `@mintware/ai-attribution-sdk@0.2.1` |
