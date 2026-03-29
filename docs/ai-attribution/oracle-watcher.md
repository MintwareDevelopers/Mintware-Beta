# Oracle Watcher

The Oracle Watcher is a background service that automatically monitors the blockchain for registered AI agent activity, signs verified actions, and queues them for agents to claim. Agents don't need to poll or call the oracle proactively — the watcher handles detection automatically.

---

## Why It Exists

Without the Oracle Watcher, every scoring action would require the agent to call the oracle API manually after each on-chain event. This creates friction and requires the agent to be continuously aware of every transaction it makes.

The watcher inverts this: the oracle watches the chain, detects activity, and pre-signs actions. The agent simply checks its queue periodically and submits whatever is waiting.

---

## How It Works

```
Every 60 seconds:
  1. Read last processed block from persistent state
  2. Fetch on-chain events since last block (Transfer events, campaign interactions)
  3. Filter: identify events where the sender/receiver is a registered agent
  4. Deduplicate: skip any transaction already processed
  5. For each new agent activity: call oracle sign API
  6. Store signed action in the pending queue (Supabase)
  7. Save new last processed block to state
```

Agents poll `GET /api/agents/{address}/pending` to retrieve queued signatures, then submit them on-chain.

---

## The Gas Model

This architecture is designed so that **Mintware pays $0 in oracle gas costs**, regardless of how many agents are active.

| Party | What They Pay |
|---|---|
| Mintware (oracle watcher) | $0 — runs on Cloudflare Workers free tier |
| Agent | Gas to call `recordVerifiedAction()` on-chain |

The oracle signs off-chain using EIP-712 cryptographic signatures. The agent submits the signature to the contract and pays the gas. Mintware never submits an on-chain transaction as part of normal oracle operation.

---

## Signature Security

Oracle signatures are:

- **Typed** — EIP-712 structured data prevents signatures from being reused across different contexts or contracts
- **Nonce-bound** — each signature includes the agent's current nonce. Submitting a signature increments the nonce, making the same signature invalid for future use
- **Time-limited** — every signature includes a `deadline` timestamp. The contract rejects signatures submitted after their deadline
- **Address-bound** — the signature encodes the agent's address. It cannot be used by a different wallet

---

## What Activity Is Detected

The watcher currently monitors **WETH Transfer events** on Base mainnet as a primary activity signal. Any registered agent wallet that sends or receives WETH is detected and eligible for a scoring action.

Additional signal types — campaign-specific swaps, governance interactions, LP events — are planned for future versions.

---

## Pending Queue

Signed actions are stored in a database queue associated with the agent's address. The queue is:

- **Public** — any wallet can query the pending queue for any agent address. Signatures are bound to the agent by EIP-712 and cannot be used by another wallet.
- **Filtered** — expired signatures (past their `deadline`) are automatically excluded from results
- **Ordered** — oldest signatures are returned first
- **Capped** — results are limited to 50 pending actions per request to prevent overload

---

## Claiming Pending Actions

Agents use the SDK to pick up and submit their pending queue in one call:

```typescript
import { claimPendingActions } from '@mintware/ai-attribution-sdk'

const result = await claimPendingActions({
  agent:      '0xAgentAddress...',
  privateKey: '0xAgentPrivateKey...',
  apiBase:    'https://mintware.finance',
})

console.log(`Submitted ${result.submitted} actions`)
// result.hashes — on-chain transaction hashes for submitted actions
```

The SDK:
1. Fetches the agent's pending queue from the API
2. Filters out any expired signatures automatically
3. Submits each valid signature to the contract
4. Returns a count and list of transaction hashes

Call this periodically — daily or after significant on-chain activity.

---

## Manual Trigger

The watcher also accepts a manual trigger for testing or immediate processing:

```
POST https://oracle-watcher.ceo-1f9.workers.dev/run
Authorization: Bearer <ORACLE_SECRET>
```

Health check:
```
GET https://oracle-watcher.ceo-1f9.workers.dev/health
```
