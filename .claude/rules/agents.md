# AI Agents (ERC-8004 + AIAttribution + x402 parking account)

> **Two agent surfaces live here.** (1) **Attribution / ERC-8004** — on-chain reputation (below,
> still accurate). (2) **Agent parking account + x402** — the newest and biggest surface: an agent
> treasury where idle USDC **earns while staying spendable in place**, paid per call over x402.
> See [Agent parking account + x402](#agent-parking-account--x402) and the 13-action plugin table.
> Full spec: [`docs/developers/agentkit-compute-402-spec.md`](../../docs/developers/agentkit-compute-402-spec.md).

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
- Public `/agents` (`app/agents/page.tsx`) was **reorganized to lead with earn + pay** (parking account + x402); Attribution was demoted to a supporting trust signal, not the headline.

---

# Agent parking account + x402

> **Status: code-complete + testnet, NOT mainnet/audited.** `lib/x402/*` + 5 routes + `/app/agents`
> UI + 13 plugin actions are built and green (**52 Vitest + 86 edge-auth Rust tests**), but the
> stack is **runtime-gated** (503 until env set) and rides the Arc-**testnet** YPN vault. External
> audit + a real settlement/card path gate real value. **Not live.** (See `.claude/STATE.md`.)

**Thesis.** An agent parks idle USDC in a yield vault where it **earns**, and spends it per call over
x402 **without ever un-parking** — a spend is a hold against the earning balance → settle (burn
shares). "Never idle, never locked, always yours," for agents. Mintware is both the **funding rail**
and the **x402 facilitator**, so the balance stays productive right up to settlement.

**Facilitator = a rename/adapter over YPN primitives that already ship:**
- `/verify` → edge-auth NAV-hold (`POST /authorize`, sizes a hold off live vault NAV, ~10 ms).
- `/settle` → relayer settle (+ CCTP if `payTo` is on another chain).
- x402 v2 **session token** ↔ edge-auth `hold_id` (idempotent, reservable, expiring).

**Reputation-gating is OPTIONAL, not a dependency.** The default facilitator authorizes purely on
live NAV. Trust-tiered pricing (`lib/x402/pricing.ts`) is off by default; a pluggable `TrustSource`
port can tier by **any** signal — parked size / tenure / staking / (optionally) Attribution. Turn it
on with `X402_TRUST_TIERING=parked` (→ `parkedSizeTrustSource`). Attribution is one possible input,
never required.

## The 13 actions across 3 runtimes

Each runtime keeps its existing Attribution actions and adds the 5-action parking/x402 set (MCP: 3).

| Runtime (package) | Parking + x402 actions | Pre-existing Attribution actions |
|---|---|---|
| **AgentKit** (`@mintware/agentkit-actions`, `plugins/agentkit`) | `MINTWARE_PARK` · `MINTWARE_UNPARK` · `MINTWARE_TREASURY` · `MINTWARE_X402_QUOTE` · `MINTWARE_X402_PAY` | `MINTWARE_GET_SCORE` · `MINTWARE_REGISTER` · `MINTWARE_CLAIM_PENDING` |
| **ElizaOS** (`@mintware/eliza-plugin`, `plugins/eliza`) | `PARK_USDC` · `UNPARK_USDC` · `SHOW_TREASURY` · `QUOTE_X402` · `PAY_X402` | `GET_ATTRIBUTION_SCORE` · `REGISTER_MINTWARE` · `CLAIM_PENDING_ACTIONS` |
| **MCP** (`@mintware/mcp-server`, `plugins/mcp` — Claude Desktop / Cursor) | `mintware_parking_account` · `mintware_x402_quote` · `mintware_x402_pay` | `mintware_get_score` · `mintware_leaderboard` · `mintware_register` · `mintware_claim_pending` |

- **Park / unpark** = ERC-4626 `approve`+`deposit` / `redeem` against the Arc yield vault (on-chain,
  agent pays gas; env-overridable via `MINTWARE_PARK_VAULT`/`_USDC`/`_RPC`).
- **X402 pay** signs an EIP-3009 `TransferWithAuthorization` (USDC), retries with `PAYMENT-SIGNATURE`,
  returns the resource. Quote is a read-only 402 preflight (no payment).
- **Treasury / account** reads `GET /api/x402/account` (parked · spendable · earning).

## Where the code lives

| Area | Location |
|---|---|
| Core lib | `lib/x402/*` — `types`, `protocol`, `pricing`, `facilitator`, `require402`, `edgeHttp`, `config`, `treasury` (park + spend-in-place), `vaultReader` (fee-net parked USDC off the Arc vault), `permitStore` (payer-keyed standing `DelegatedSpendPermit` store) |
| Routes | `app/api/x402/{account,supported,verify,settle,score,permit}` — `verify`→edge-auth, `settle`→relayer, `score` is a dogfood 402 paywall over Attribution, `permit` registers/reads the payer's standing spend-permit |
| Standing permit | `POST /api/x402/permit` — an agent signs ONE EIP-712 `DelegatedSpendPermit` (the SAME scheme the human card flow uses — `lib/org/spendPermit.ts`, domain `Mintware Payment Gateway`/`2.0`) verified server-side (recovers to `payer`, `user`==`payer`) → stored in `x402_standing_permits` (deny-all RLS). `/api/x402/settle` fetches it by `(payer, gateway)` and threads it into the relayer `SettleParams.permit`; **no permit registered ⇒ settle fails closed `no_standing_permit`** (never fabricated). Closes the `settlement_permit_unavailable` gap. |
| Discovery | `public/.well-known/x402.json` (facilitator/schemes/networks) |
| Live spendable | edge-auth `GET /available/:user` (read-only headroom = NAV − holds − cap − liquidity; without it, spendable defaults to full parked balance — parking never locks) |
| UI | public `/agents` (reorged to lead with earn + pay) · `/app/agents` (live clickable parking account: parked / spendable / earning) |
| Spec (full) | [`docs/developers/agentkit-compute-402-spec.md`](../../docs/developers/agentkit-compute-402-spec.md) |

**Runtime gates:** the facilitator/seller/live-spendable need `EDGE_AUTH_URL` / `EDGE_AUTH_SECRET`
+ `X402_PAY_TO`; routes **503** until set. **Settle transport** (`config.ts#getSettler`, precedence):
(1) `X402_RELAYER_URL` → the Rust `services/relayer` HTTP server (raw-key submitter — optional override);
(2) **`X402_SETTLE_PROVIDER=oracle` → in-process `settleSpend` via `getOracleSigner('root')`** — the SAME
Privy/oracle signer seat the human card flow uses (`lib/org/settleSwipe.ts`); no separate service, no raw
key (`ORACLE_SIGNER_PROVIDER=privy` keeps it in Privy's enclave). **This is the platform-consistent path**
(`lib/x402/oracleSettler.ts`); (3) neither → `deferredSettler` (authorize-now, settle-later). The
Privy/relayer signer must hold `RELAYER_ROLE` on the gateway. Fail-closed: edge-auth rejects when its
secret is unset (audit C1), and the facilitator inherits that; `/api/x402/settle` requires a standing
permit whenever a real settle transport is wired (`x402OnchainSettleConfigured()`).
