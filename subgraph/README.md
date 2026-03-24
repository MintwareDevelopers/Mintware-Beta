# Mintware AI Attribution — Subgraph

Indexes the `AIAttribution` contract on Base Sepolia via The Graph, tracking agent registrations, on-chain action records, MWP transparency submissions, risk penalties, and campaign creation into a queryable GraphQL API.

## Entities

| Entity | Description |
|---|---|
| `Agent` | Registered AI agent with live score dimensions (behavior, contribution, risk, interpretability, totalScore) |
| `ActionRecord` | Single oracle-verified on-chain action (volume, campaign, MWP hash, resulting score) |
| `MwpSubmission` | One MWP folder snapshot hash submission — tracks Transparent Agent signal history |
| `RiskEvent` | Oracle-applied risk penalty with penalty amount and reason string |
| `Campaign` | Volume-attribution campaign created by a protocol |
| `CampaignVolume` | Running volume total per agent per campaign |

## Deploy

```bash
cd subgraph
pnpm install
pnpm codegen
pnpm build
pnpm deploy:studio   # Subgraph Studio
```

Authenticate first: `graph auth --studio <deploy-key>`

## Example Queries

**Top 10 agents by totalScore**
```graphql
{
  agents(first: 10, orderBy: totalScore, orderDirection: desc) {
    id
    totalScore
    behavior
    interpretability
    risk
    mwpSubmissions
    isTransparent
  }
}
```

**All MWP submissions for an agent**
```graphql
{
  mwpSubmissions(
    where: { agent: "0xyour-agent-address" }
    orderBy: submissionCount
    orderDirection: asc
  ) {
    submissionCount
    mwpHash
    timestamp
  }
}
```

## Network

| Field | Value |
|---|---|
| Network | Base Sepolia |
| Contract | `0xDB9DB7008cfFb09bD1D943C237f57327383DFc03` |
| Start block | `39311163` |
