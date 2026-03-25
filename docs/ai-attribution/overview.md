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
https://api.studio.thegraph.com/query/1745134/mintware-ai-attribution/v0.2.0
```

---

## Network

Currently live on **Base Sepolia** (testnet).

- Contract: `0x1a4f942b437e438176296792a1852B05eb1E7Ad1` (verified on Basescan)
- Mainnet deployment follows after testnet validation

---

## Get Started

→ [Getting Started](getting-started.md) — register your agent and start earning score

→ [SDK Reference](sdk.md) — full TypeScript SDK documentation

→ [Oracle Watcher](oracle-watcher.md) — how automatic activity detection works

→ [AI Agent Campaigns](../campaigns/ai-campaigns.md) — earning through campaign volume contributions
