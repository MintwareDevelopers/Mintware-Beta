# AI Agents (ERC-8004 + AIAttribution)

## AIAttribution v3 — Base Mainnet

- Contract: `0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421`
- v2 (`0xb9FB965...`) deprecated — `setOracle` ABI removed
- Chain: Base mainnet (8453)

## ERC-8004 Identity Registry

- Registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` on Base
- Mintware Agent ID: **#37297** (registered 2026-03-27)
- Registered via: BaseScan → Write as Proxy → `register(agentURI, metadata[])`
- Registration tx: `0x7fb33cbeb8da13ed45f353bbaf847ab1db0c0c320960beb3161bedda60ef1ca0`
- `tokenURI` = `https://mintware.finance/.well-known/erc8004-registration.json`

## Machine-Readable Manifests

| Path | Purpose |
|---|---|
| `public/.well-known/agent.json` | A2A v0.3.0 agent card |
| `public/.well-known/erc8004-registration.json` | ERC-8004 `#registration-v1` JSON with Agent #37297 |
| `public/.well-known/agent-reputation-oracle.json` | Oracle capability manifest |

## SDK (`@mintware/ai-attribution-sdk` v0.2.0)

- Default chain: Base mainnet
- Default contract: `0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421`
- Local dist: `sdk/dist/index.js`

Key functions:
- `registerWithMintwareOracle({ privateKey })` — register agent on Base
- `claimPendingActions()` — claim pending scored actions
- `getScore(address)` — read Attribution score
- `isRegistered(address)` — check registration

## Demo Agent

- Deployer wallet: `0x9c646C48a302f4725450669f1218d3FDb3e933AD`
- Registration tx: `0x1dde6aa6...`
- Rank #1 on `/agents` leaderboard

## Awesome-ERC8004 PR

Submitted PR adding Mintware to `### 🪪 Identity & Trust` section of the curated list. Awaiting maintainer merge.

## Scoring Dimensions

| Dimension | Description |
|---|---|
| `behavior` | On-chain volume/trading behavior |
| `contribution` | Protocol contributions |
| `interpretability` | MWP transparency hashes |
| `risk` | Risk deductions |
| `total_score` | `behavior + contribution + interpretability - risk` |

## `/agents` Routes

- Public integrations/docs page lives at `app/agents/page.tsx`
- Agent leaderboard lives at `app/(web3)/agents/leaderboard/page.tsx`
- Agent detail lives at `/agent/{address}` and should link back to `/agents/leaderboard`
- Do not create another route-group page at `app/(web3)/agents/page.tsx` or Next.js will fail the build due to duplicate `/agents` resolution
- **Narrative order (2026-08-18):** the page **leads with the agent-treasury vision** (LP
  participation via the agentic ULV roles + the JIT 402 payment engine — honestly labeled
  "Blueprint · not yet built," nothing here is deployed/audited/live). On-chain reputation
  (plugins, live leaderboard, actions table) is the **second**, clearly-optional section — real
  and live today, just not the lead. Don't reorder this without checking build status hasn't
  changed. The bigger "agent parking account + x402" build (live treasury demo at `/app/agents`,
  Arc-testnet-proven) exists on the unmerged, audit-gated `feat/ypn-vault-convergence` branch —
  do not port claims from it onto `main`'s page until that branch actually ships.
