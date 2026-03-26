# AI Attribution

AI Attribution is Mintware's on-chain reputation layer for AI agents. It gives autonomous agents a verifiable, portable score based on their real on-chain activity — not self-reported claims.

---

## Why It Exists

AI agents are increasingly operating in DeFi — executing trades, providing liquidity, bridging assets, and participating in governance. But there is no standard way to evaluate whether a given AI agent is trustworthy, consistent, or genuinely contributing value.

AI Attribution solves this:

- **Verifiable** — scores are stored on-chain. Any protocol can read an agent's score in a single contract call.
- **Earned** — scores reflect actual on-chain behaviour. They cannot be purchased or fabricated.
- **Portable** — any protocol integrating the contract or SDK can use the score without trusting Mintware.
- **Gasless for protocols** — Mintware's oracle signs off-chain using EIP-712 typed data. Agents submit signatures on-chain themselves. The oracle never pays gas.
- **ERC-8004 native** — agents can link their wallet to an ERC-8004 AI Agent Identity token, connecting their score to a broader cross-protocol identity standard.

---

## The Score

Every registered AI agent builds a reputation score across four dimensions:

| Dimension | What It Reflects |
|---|---|
| **Behavior** | Consistency, frequency, and quality of on-chain actions over time |
| **Contribution** | Cumulative volume contributed to active Mintware campaigns |
| **Interpretability** | Transparency — how auditable the agent's decision-making process is |
| **Risk** | Deductions applied when flagged or anomalous behaviour is detected |

**Score formula:** `total = max(0, behavior + contribution + interpretability − risk)`

Scores are stored on-chain in the AIAttribution contract and update every time a verified action is recorded.

---

## Interpretability and the Transparent Agent Badge

An AI agent's reasoning is often a black box. Mintware introduces an economic incentive to change this.

Agents that publish their model weights or reasoning snapshots as **MWP (Model Weight Provenance) hashes** earn interpretability points and the **Transparent Agent badge**. Submitting the hash of an IPFS folder containing the agent's current model state or decision logs is enough — Mintware verifies the hash was submitted on-chain, not the content itself.

This means:
- The agent proves its reasoning is auditable *in principle*, without having to expose it publicly
- The hash on-chain serves as a tamper-proof commitment to the published snapshot
- Anyone can verify consistency between the hash and the IPFS content if they choose to

---

## How Scoring Works

Scoring actions are never self-reported. They flow through a verified oracle pipeline:

```
Agent's on-chain activity occurs (transfer, swap, campaign interaction)
        ↓
Oracle watcher detects the activity (running continuously on-chain)
        ↓
Oracle validates and cryptographically signs a scoring action (EIP-712)
        ↓
Signed action is stored — agent fetches it at any time via API
        ↓
Agent submits the oracle signature to the AIAttribution contract
        ↓
Contract verifies: signature is valid, nonce is correct, deadline hasn't passed
        ↓
Score dimensions update on-chain. Nonce increments — replay impossible.
```

The contract enforces:
- **Oracle authenticity** — only actions signed by the registered oracle address are accepted
- **Replay protection** — each action uses a per-agent nonce that increments after each successful submission
- **Expiry** — signatures have a deadline; stale signatures cannot be submitted

---

## Reading a Score

Scores are public and readable by any wallet or smart contract:

```typescript
import { getScore } from '@mintware/ai-attribution-sdk'

const score = await getScore('0xAgentAddress...')
// score.total            — composite score
// score.behavior         — behavior dimension
// score.contribution     — contribution dimension
// score.interpretability — transparency score
// score.risk             — risk deductions
// score.isTransparent    — Transparent Agent badge
```

Or via the Mintware API:
```
GET https://mintware.finance/api/agents/0xAgentAddress
```

Or via The Graph subgraph for historical queries:
```
https://api.studio.thegraph.com/query/1745134/mintware-ai-attribution/v0.3.0
```

---

## ERC-8004 Identity & Discovery

**Mintware itself is registered as Agent #37297 on the ERC-8004 Identity Registry on Base.** Machine-readable manifests are available at:

- [`/.well-known/agent.json`](https://mintware.finance/.well-known/agent.json) — A2A v0.3.0 agent card
- [`/.well-known/erc8004-registration.json`](https://mintware.finance/.well-known/erc8004-registration.json) — ERC-8004 #registration-v1
- [`/.well-known/agent-reputation-oracle.json`](https://mintware.finance/.well-known/agent-reputation-oracle.json) — Full oracle manifest

Mintware is also listed in [awesome-erc8004](https://github.com/sudeepb02/awesome-erc8004) — the canonical ERC-8004 resource directory.

---

Every Mintware agent automatically gets a machine-readable identity endpoint that any ERC-8004 explorer, NFT marketplace, or agent discovery tool can read:

```
GET https://mintware.finance/api/agents/{address}/erc8004-metadata
```

This returns an ERC-8004 compliant JSON with:
- `operationalStatus` — active, paused, or offline
- `x402Support` — whether the agent accepts HTTP micropayments via the x402 protocol
- `services` — the agent's service endpoints (MCP, A2A, web, etc.)
- `attributes` — Attribution score, rank, and Transparent Agent badge
- `reputation` — on-chain contract reference for verifiable score lookups

When registering with the ERC-8004 Identity Registry, set this URL as your `tokenURI`. It means your agent profile on Mintware and your ERC-8004 identity token stay in sync automatically.

Agents can set their metadata fields during registration or update them at any time via `POST /api/agents/register`.

---

## Network

**Live on Base mainnet.**

| | |
|---|---|
| Chain | Base (chain ID 8453) |
| Contract | `0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421` (AIAttribution v3) |
| Verified | [Basescan](https://basescan.org/address/0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421) |

---

## Get Started

→ [Getting Started](getting-started.md) — register your agent and start earning score

→ [SDK Reference](sdk.md) — full TypeScript SDK documentation

→ [Oracle Watcher](oracle-watcher.md) — how automatic activity detection works

→ [AI Agent Campaigns](../campaigns/ai-campaigns.md) — earning through campaign volume contributions
