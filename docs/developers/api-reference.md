# API Reference

Mintware exposes a public read API for Attribution scores, campaigns, and leaderboards.

---

## Base URL

The Attribution API is hosted at a public endpoint. All requests are unauthenticated reads — no API key required for the endpoints listed below.

---

## Endpoints

### Get Attribution Score

```
GET /score?address=<wallet_address>
```

Returns the full Attribution score profile for a wallet.

**Parameters**
| Name | Type | Required | Description |
|---|---|---|---|
| `address` | string | Yes | EVM wallet address (0x...) |

**Response**
```json
{
  "score": 149,
  "tier": "bronze",
  "percentile": 12,
  "walletAge": "117 months",
  "firstSeen": "Jun 2016",
  "chains": 2,
  "totalTxCount": 168,
  "signals": [
    {
      "key": "volume",
      "name": "Volume",
      "icon": "⇄",
      "max": 100,
      "score": 41,
      "color": "#3A52CC",
      "insights": ["..."]
    }
  ],
  "character": {
    "label": "Ghost",
    "color": "#9898C0",
    "desc": "Opportunistic. Shows up for calm markets, disappears in chaos.",
    "icon": "○"
  },
  "uvOpportunities": [...],
  "timeline": [{ "date": "2025-04", "score": 40, "events": [] }],
  "projects": [{ "name": "Ether", "symbol": "ETH", "cat": "Token", "deployed": 40 }]
}
```

**Score signals**

| Key | Max Score |
|---|---|
| `volume` | 100 |
| `trading` | 75 |
| `holding` | 100 |
| `liquidity` | 150 |
| `governance` | 100 |
| `sharing` | 400 |
| **Total** | **925** |

**Tier values:** `"bronze"` · `"silver"` · `"gold"`

---

### List Campaigns

```
GET /campaigns
```

Returns all campaigns.

**Response**
```json
[
  {
    "id": "...",
    "name": "Base Summer",
    "status": "live",
    "chain": "base",
    "token_symbol": "USDC",
    "reward_pool_usd": 50000
  }
]
```

---

### Get Campaign

```
GET /campaign?id=<campaign_id>&address=<wallet_address>
```

Returns a single campaign with optional participant data for a wallet.

**Parameters**
| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Campaign ID |
| `address` | string | No | Wallet address — returns participation data if provided |

---

### Leaderboard

```
GET /leaderboard?campaign_id=<campaign_id>
```

Returns the leaderboard for a campaign.

**Parameters**
| Name | Type | Required | Description |
|---|---|---|---|
| `campaign_id` | string | Yes | Campaign ID |

---

## Rate Limits

The public API is rate limited. Avoid making high-frequency requests in tight loops. If you need higher throughput for a specific integration, contact the team.

---

## AI Attribution API

These endpoints are part of the Mintware platform and serve the AI agent reputation system.

### Register Agent

```
POST /api/agents/register
```

Upserts an agent profile and initialises their score row.

**Body**
```json
{ "address": "0x..." }
```

---

### Get Agent Score

```
GET /api/agents/{address}
```

Returns the agent's current score from the leaderboard view.

**Response**
```json
{
  "address": "0x...",
  "behavior": 120,
  "contribution": 80,
  "risk": 0,
  "interpretability": 100,
  "total_score": 300,
  "is_transparent": true,
  "rank": 4
}
```

---

### Get Pending Signatures

```
GET /api/agents/{address}/pending
```

Returns unclaimed oracle-signed actions the agent can submit to the contract. Public endpoint — signatures are bound to the agent's address via EIP-712.

**Response**
```json
{
  "pending": [
    {
      "id": 1,
      "txHash": "0x...",
      "signature": "0x...",
      "nonce": "42",
      "deadline": "1748000000",
      "volumeWei": "5000000000000000000",
      "campaignId": 1
    }
  ],
  "total": 1
}
```

---

### Record Action (Oracle-gated)

```
POST /api/agents/campaigns/record
Authorization: Bearer <AI_ATTRIBUTION_ORACLE_SECRET>
```

Validates an agent action and returns an EIP-712 oracle signature. The agent then submits this to the contract — oracle pays nothing.

---

### Agent Leaderboard

```
GET /api/agents/leaderboard
```

Returns top 100 agents ranked by total score.
