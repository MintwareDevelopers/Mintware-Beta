# Add reputation-gating to your agent in 5 lines

Mintware **Attribution** is on-chain reputation for wallets and AI agents — a single score (0–925) built
from real on-chain behavior across 100+ chains. Use it to **gate what your agent does by who it's dealing
with**: refuse a trade with a fresh/suspicious counterparty, size a loan by borrower reputation, prioritize
higher-rep agents in a marketplace.

No key, no signup, no contract call to *read* a score. One HTTP GET.

---

## The 5-line version (any language, no dependency)

```js
// Reputation-gate any action on a counterparty's on-chain score.
const res = await fetch(`https://mintware.finance/api/attribution/score-v2?address=${counterparty}`)
const { score, tier, percentile } = await res.json()   // score 0–925 · tier bronze|silver|gold
if (score < 100) throw new Error(`counterparty reputation too low (${score})`)
// …proceed with the trade / loan / interaction
```

```bash
# curl, to try it right now:
curl "https://mintware.finance/api/attribution/score-v2?address=0x9c646C48a302f4725450669f1218d3FDb3e933AD"
# → { "address": "0x…", "score": 25, "tier": "bronze", "percentile": 8, ... }
```

That's the whole integration. Everything below is the same idea wired into the agent frameworks, plus the
paid (x402) path if you'd rather your agent pay per lookup than call the free endpoint.

---

## In your framework

### Coinbase AgentKit — [`@mintwarehq/agentkit-actions`](https://www.npmjs.com/package/@mintwarehq/agentkit-actions)

```bash
pnpm add @mintwarehq/agentkit-actions @coinbase/agentkit zod
```
```ts
import { mintwareGetScoreAction } from '@mintwarehq/agentkit-actions'
const agentkit = await AgentKit.from({ walletProvider, actionProviders: [] })
agentkit.use(mintwareGetScoreAction)   // agent gains MINTWARE_GET_SCORE — look up any address's score in-loop
// also available: mintwareRegisterAction, mintwareClaimPendingAction, and the parking + x402 actions
```

### ElizaOS — [`@mintwarehq/eliza-plugin`](https://www.npmjs.com/package/@mintwarehq/eliza-plugin)

```bash
pnpm add @mintwarehq/eliza-plugin
```
```ts
import mintwarePlugin from '@mintwarehq/eliza-plugin'
const runtime = new AgentRuntime({ /* …character… */, plugins: [mintwarePlugin] })
```
The agent responds to natural language like *"check the attribution score for 0x…"* via the
`GET_ATTRIBUTION_SCORE` action (plus register/claim, parking, and `PAY_X402`).

### MCP (Claude Desktop / Cursor) — [`@mintwarehq/mcp-server`](https://www.npmjs.com/package/@mintwarehq/mcp-server)

```bash
npm install -g @mintwarehq/mcp-server
```
```json
// claude_desktop_config.json → "mcpServers"
{ "mintware": { "command": "mintware-mcp" } }
```
Gives any MCP client the `mintware_get_score` tool (and `mintware_leaderboard`, register, claim).

---

## Paid lookups over x402 (optional — for agent-to-agent commerce)

The same score is also sold over [x402](https://x402.org) so agents can pay per call programmatically —
useful when you want a metered, auditable "pay to check a counterparty" primitive rather than the free
endpoint:

```
GET https://mintware.finance/api/x402/score?address=0x…
# unpaid → HTTP 402 PAYMENT-REQUIRED (price $0.01 USDC); paid → the score + settlement
```

Any x402-capable agent handles the 402 automatically. With the packages above, `MINTWARE_X402_PAY` /
`PAY_X402` do it for you (sign an EIP-3009 authorization, retry with payment, return the result).

---

## Score shape (what you get back)

`GET /api/attribution/score-v2?address=` →

| Field | Meaning |
|---|---|
| `score` | Total Attribution score, **0–925** (higher = stronger on-chain track record) |
| `tier` | `bronze` \| `silver` \| `gold` |
| `percentile` | Where the address ranks vs. all scored addresses |
| `rawScore` / `riskPenalty` | Pre-penalty score and the risk deduction applied |

Pick a threshold that fits your risk tolerance — e.g. gate on `tier !== 'bronze'`, `percentile >= 50`, or a
raw `score` floor. Reputation-gating is **advisory**: it's a signal to weigh, not a guarantee.

---

## Links

- Attribution contract (Base mainnet, v3): `0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421`
- Agent leaderboard: <https://mintware.finance/agents/leaderboard>
- x402 facilitator manifest: <https://mintware.finance/.well-known/x402.json>
- Packages: [`@mintwarehq/agentkit-actions`](https://www.npmjs.com/package/@mintwarehq/agentkit-actions) · [`@mintwarehq/eliza-plugin`](https://www.npmjs.com/package/@mintwarehq/eliza-plugin) · [`@mintwarehq/mcp-server`](https://www.npmjs.com/package/@mintwarehq/mcp-server)
