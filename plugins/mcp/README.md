# @mintware/mcp-server

Model Context Protocol (MCP) server for Mintware AI Attribution. Exposes tools to Claude Desktop, Cursor, and any MCP-compatible AI client so they can look up on-chain reputation scores for AI agents, register new agents, and claim pending oracle attestations — all on Base mainnet.

---

## What it does

Mintware AI Attribution is an on-chain reputation system for AI agents on Base. Each agent wallet accumulates a score across four dimensions:

- **Behavior** — instruction-following quality, absence of harmful outputs
- **Contribution** — value created for users and the DeFi ecosystem
- **Interpretability** — transparency via Model Workspace Protocol (MWP) hash submissions
- **Risk** — penalty for unsafe or manipulative actions

Agents with higher scores earn larger multipliers in Mintware reward campaigns.

This MCP server lets any Claude or Cursor session query those scores, register new agents, and push pending oracle-signed attestations on-chain.

---

## Installation

```bash
npm install -g @mintware/mcp-server
```

Or with pnpm:

```bash
pnpm add -g @mintware/mcp-server
```

---

## Claude Desktop configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "mintware": {
      "command": "mintware-mcp"
    }
  }
}
```

Restart Claude Desktop after saving. You should see the Mintware tools appear in the tool list.

---

## Cursor configuration

Add to `.cursor/mcp.json` in your project root, or to the global Cursor settings:

```json
{
  "mcpServers": {
    "mintware": {
      "command": "mintware-mcp"
    }
  }
}
```

---

## Available tools

### `mintware_get_score`

Fetch the Attribution score for any agent wallet address.

**Input:**
```json
{ "address": "0xabc..." }
```

**Returns:** total score, rank, behavior, contribution, interpretability, risk penalty, transparent status, PnL breakdown (if available), and MWP submission count.

---

### `mintware_leaderboard`

Fetch the top agents on the Attribution leaderboard.

**Input:**
```json
{ "limit": 10 }
```

`limit` is optional, defaults to 10, max 50. Returns agents ranked by total score with address, score, and transparent status.

---

### `mintware_register`

Register an agent wallet with the AIAttribution contract on Base mainnet. One-time transaction — the wallet pays a small ETH gas fee.

**Input:**
```json
{ "privateKey": "0x..." }
```

After registration, the oracle watcher begins tracking on-chain activity automatically within ~60 seconds.

---

### `mintware_claim_pending`

Fetch pending oracle-signed action attestations from the Mintware API and submit each to the contract on Base mainnet. Run this periodically to keep the Attribution score current.

**Input:**
```json
{
  "address": "0xabc...",
  "privateKey": "0x..."
}
```

Returns the number of actions submitted and the transaction hashes.

---

### `mintware_parking_account`

Show an agent's Mintware capital-parking account — USDC parked (and earning yield) plus what's spendable in place right now. Read-only.

**Input:** `{ "address": "0xabc..." }`

### `mintware_x402_quote`

Preflight an [x402](https://x402.org)-gated compute/API URL without paying — returns the price, network, and recipient from the HTTP 402 challenge. Read-only.

**Input:** `{ "url": "https://…" }`

### `mintware_x402_pay`

Pay for an x402-gated call in USDC (signs an EIP-3009 authorization) and return the resource. The agent parks capital that keeps earning while staying spendable in place; this spends it per call. Only pass a private key for a wallet you control, in a trusted environment.

**Input:** `{ "url": "https://…", "privateKey": "0x…", "maxAmountUsd": 0.05 }`

---

## Contract details

- **Network:** Base mainnet (chain ID 8453)
- **Contract:** `0xb9FB965Caa7197932b52631e0121Ea54586e2B88`
- **API:** `https://mintware.finance`

---

## Building from source

```bash
pnpm install
pnpm build
```

The compiled server is at `dist/index.js`.

---

## License

MIT
