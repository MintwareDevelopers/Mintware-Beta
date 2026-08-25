# Agent-distribution submissions — ready-to-push checklist

> Prepared 2026-08-25 (this branch). The **packages have been live on npm since 2026-03-25 but are listed in
> zero discovery registries** — publishing ≠ discoverability. Everything below is prepped in-repo; the
> **submit/publish steps need your accounts** (npm, GitHub, on-chain key) and are marked ⬜ YOU.
> Companion: the "reputation-gate in 5 lines" [`agent-integration-guide.md`](agent-integration-guide.md).

## 0. Republish the packages first (blocks everything else)

A correctness fix landed on this branch: all three packages hard-coded the **deprecated v2** Attribution
contract (`0xb9FB965…`) as `BASE_MAINNET_CONTRACT` — now **v3 `0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421`**
(src + dist + README). Reads (the main reputation-gating path) were always fine — they use the API — but
register/claim pointed at the dead contract.

⬜ **YOU:** bump versions and `npm publish` `@mintware/agentkit-actions`, `@mintware/eliza-plugin`,
`@mintware/mcp-server` so the registries pick up the corrected code. Do this **before** the registry
submissions below so they point at the fixed builds.

## 1. MCP Registry — `registry.modelcontextprotocol.io`

**Ready:** [`plugins/mcp/server.json`](../../plugins/mcp/server.json) (schema-valid, name
`io.github.MintwareDevelopers/mcp-server`, npm `@mintware/mcp-server`, stdio).

⬜ **YOU:**
1. Add `"mcpName": "io.github.MintwareDevelopers/mcp-server"` to `plugins/mcp/package.json`, then republish
   to npm (the registry verifies ownership by matching this field against the published package).
2. Install the publisher CLI (`mcp-publisher`), authenticate the **GitHub** namespace `io.github.MintwareDevelopers`
   (GitHub OAuth device flow — proves you own the org), then `mcp-publisher publish` from `plugins/mcp/`.
3. No code change beyond the `mcpName` field. Official registry (Anthropic/GitHub/Microsoft-backed).

## 2. ERC-8257 (OpenSea agent tool registry) — `@opensea/tool-sdk`

**Ready:** [`public/.well-known/ai-tool/attribution-score.json`](../../public/.well-known/ai-tool/attribution-score.json)
— the tool manifest for the score lookup (served at `https://mintware.finance/.well-known/ai-tool/attribution-score.json`
once this deploys). Open-access (no predicate). **Confirmed from the SDK docs:** ERC-8257 predicates support
**tiered** access (ERC-721/ERC-20-balance/subscription/composite), so the future Agent-Pass "discount + higher
rate limit" model *is* supportable — that resolves open-question #1 in
[`erc8257-agent-pass-idea.md`](erc8257-agent-pass-idea.md). The NFT pass itself stays a later phase.

⬜ **YOU:**
1. `npx @opensea/tool-sdk init` in a scratch dir to get the current manifest schema, then diff against the
   manifest above and adjust any field names the live SDK expects (the manifest here follows the documented
   `#tool-manifest-v1` shape but should be validated against the SDK before registering).
2. Deploy so the manifest is reachable at the `/.well-known/ai-tool/` URL.
3. `npx @opensea/tool-sdk register` — an **on-chain** tx to the ToolRegistry (Base) with the manifest URI +
   hash, from an address you control. No custody, no audit gate (read-only predicate in front of a live API).

## 3. AgentKit (`coinbase/agentkit`)

**Finding:** their `WISHLIST.md` has **no** reputation / on-chain-scoring / agent-identity / x402 slot, so a
Mintware action provider is a **cold contribution**, not filling a listed ask — lower expected acceptance,
lower priority than #1/#2. `@mintware/agentkit-actions` already works as a standalone AgentKit action set
(devs `agentkit.use(mintwareGetScoreAction)` per the integration guide), so registry listing isn't required
to be usable.

⬜ **YOU (optional / lower priority):** if pursuing, open a PR per their `CONTRIBUTING.md` adding a Mintware
action provider, framed around inter-agent trust / reputation-gating (the closest wishlist adjacency is
"agent communication / inter-agent trust"). Check in-progress PRs first to avoid duplication.

## 4. ElizaOS registry (`elizaOS/registry`) — ⚠ BLOCKED on a rename+republish

**Confirmed blocker:** ElizaOS requires the plugin to be published under the **`@elizaos/plugin-`** npm prefix
and registered by editing the registry's `index.json` via PR. The current package is `@mintware/eliza-plugin`
— **wrong scope/name.**

⬜ **YOU:** this is not a metadata-only submit. Follow ElizaOS's official **"Publish a Plugin"** flow
(`elizaos publish`) to get a compliant `@elizaos/plugin-mintware` (or `@elizaos-plugins/…`) name into their
namespace — publishing under the `@elizaos` scope directly likely isn't possible for a third party, so their
CLI/flow is the path. Then PR the registry `index.json`. Scope this against current ElizaOS docs before doing
the rename — it's the most involved of the four.

## 5. GitHub discoverability (low-cost, do anytime)

⬜ **YOU:** add topic tags (`x402`, `erc-8004`, `agentkit`, `mcp`, `ai-agents`, `reputation`) to the public
repo(s), and confirm the `@mintware/eliza-plugin` and `@mintware/mcp-server` READMEs are as clear as the
`agentkit-actions` one (they are, and now cite the correct v3 contract after §0).

---

### Priority order (recommended)
1. **§0 republish** (unblocks all) → 2. **§1 MCP Registry** (official, lowest friction) →
3. **§2 ERC-8257** (real agent marketplace, the strongest distribution channel) →
4. **§5 GitHub topics** (free) → 5. **§4 ElizaOS** (most work) → **§3 AgentKit** (weakest fit) last.
