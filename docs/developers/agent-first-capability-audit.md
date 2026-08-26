# Agent-First Capability Audit (2026-08-26)

> Every Mintware capability, scored on whether an **autonomous agent** can use it end-to-end with zero
> human clicks. Read-only snapshot from `origin/main`. Legend:
> **✅ agent-ready** (API + agent tool + agent-native auth + typed I/O) ·
> **⚠️ partial** (API exists, but no agent tool, or execution/auth gap) ·
> **❌ UI/human-only** (no clean agent path, or human/KYB-gated) ·
> **⚙️ internal** (cron/automation — not agent-facing by design).
>
> Axes per capability: **API** (programmatic route) · **Tool** (MCP / AgentKit / Eliza action) ·
> **Auth** (agent-native = signed-msg / permit / none; human = Privy / session / UI) · **Pay** (x402).

## 1. Reputation / Attribution — the strong core

| Capability | API | Tool | Auth | Pay | Verdict |
|---|---|---|---|---|---|
| Score lookup | `attribution/score-v2`, `x402/score` | ✅ get_score | none / x402 | ✅ x402 | **✅ ready** (flagship) |
| Agent register (ERC-8004 / AIAttribution) | `agents/register` | ✅ register | agent key | — | **✅ ready** |
| Claim pending actions | `agents/[address]/pending` | ✅ claim_pending | agent key | — | **✅ ready** |
| Agent leaderboard | `agents/leaderboard` | ✅ mcp_leaderboard | none | — | **✅ ready** (read) |
| Agent detail / ERC-8004 metadata | `agents/[address]`, `.../erc8004-metadata` | ❌ | none | — | **⚠️ no tool** |
| MWP transparency hashes | `agents/mwp` | ❌ | signed-msg | — | **⚠️ no tool** |
| EAS score attestation | `eas/attest-score` | ❌ | — | — | **⚠️ no tool** |
| Profile (identity read/write) | `profile` | ❌ | signed-msg | — | **⚠️ no tool** |

**Reputation is ~80% agent-ready.** The paid score seller + register + claim + leaderboard are fully wired;
the gaps are *tool exposure* for attest / MWP / profile / agent-detail (the APIs already exist).

## 2. x402 / Capital parking — agent-native by design

| Capability | API | Tool | Auth | Pay | Verdict |
|---|---|---|---|---|---|
| x402 pay / quote | `x402/{score,verify,settle,supported,account}` | ✅ pay_x402 / quote_x402 | permit + EIP-3009 | ✅ | **✅ ready** |
| Park / unpark USDC | on-chain (ERC-4626) | ✅ park / unpark | agent key | — | **✅ ready** |
| Parking-account read | `x402/account` | ✅ treasury | none | — | **✅ ready** |
| Standing spend-permit register | `x402/permit` | ⚠️ (folded into pay) | signed EIP-712 | — | **⚠️ no discrete tool** |

**This cluster is the model.** It's what "agent-first" looks like — discover, authorize via permit, pay per
call, all keyless-of-a-human. Everything else in the app should converge on *this* pattern.

## 3. Swap — quote is agent-ready, execution is not

| Capability | API | Tool | Auth | Pay | Verdict |
|---|---|---|---|---|---|
| Swap quote (LI.FI / MW router) | `swap/quote`, `swap/best-route` | ❌ | none / IP | — | **⚠️ quote only** |
| Swap **execution** | — (client-side `executeRoute`) | ❌ | UI wallet | — | **❌ UI-only** |

**Biggest single gap in the live surface:** an agent can *price* a swap but can't *execute* one — execution
lives in the browser (LI.FI `executeRoute`). No server/agent execute path exists.

## 4. Vaults — APIs exist (often agent-native auth!), but no tools + audit-gated

| Capability | API | Tool | Auth | Verdict |
|---|---|---|---|---|
| Vault list / detail | `vault`, `vaults` | ❌ | none | **⚠️ read, no tool** |
| Vault create / matched | `vaults/create`, `vaults/matched` | ❌ | signed-msg | **⚠️ no tool** |
| Vault deposit / withdraw | `vault/deposit`, `vault/withdraw` | ❌ | signed-msg | **⚠️ no tool** (+ audit-gated) |
| Weighted-epoch claim | `vault/weighted-claim` | ❌ | signed-msg | **⚠️ no tool** |
| Attribution snapshot | `vault/attribution-snapshot` | ❌ | signed-msg | ⚙️ internal-ish |

**Good news buried here:** deposit / withdraw / create / claim already use **agent-native signed-message
auth** — they're auth-ready. The gaps are (a) no agent tools and (b) the value-moving part is audit-gated.

## 5. Team / Org treasury + Cards — human/KYB-first

| Capability | API | Tool | Auth | Verdict |
|---|---|---|---|---|
| Org create / invite / accept / members / mine | `orgs*` | ❌ | signed-msg / session | **⚠️ no tool** |
| Org pay (vendor payout) | `orgs/[id]/pay` | ❌ | signed-msg | **⚠️ no tool** |
| Org treasury read | `orgs/[id]/treasury` | ❌ | session | **⚠️ read, no tool** |
| Cards: issue / activate / swipe / settle / events | `orgs/[id]/cards/*`, `cards/lithic/*` | ❌ | owner / webhook | **❌ human/KYB-gated** |

Cards are inherently human/KYB (Lithic issuance). Org treasury + pay *could* be agent-exposed but aren't.

## 6. Other

| Capability | Verdict |
|---|---|
| Referral apply / stats (`referral*`) | ⚠️ no tool (human-oriented system) |
| Yield benchmarks (`benchmarks/yields`), Pools (`pools`), Proof (`proof/vault`) | ✅ read (agent-consumable) |
| Farcaster mention (`farcaster/mention`) | ⚙️ the agent-run account webhook (separate workstream) |
| Auth connect / wallet-link (`auth/connect`, `wallet-link`) | ❌ human (Privy) — agents don't need it |
| Rewards pipeline crons (`cron/*`, `universal/*`, `treasury/*`) | ⚙️ internal automation |
| Waitlist, Teams apply/whitelist | ❌ human B2B signup |

---

## What the audit reveals

1. **One cluster is fully agent-first — reputation + x402 + parking.** That's not an accident; it was built
   agent-native. It's the proof the whole app *can* be this. Everything else should converge on its pattern.

2. **The #1 systemic gap is TOOL EXPOSURE, not APIs.** Most capabilities *have* API routes — many already
   with **agent-native signed-message auth** (vault deposit/withdraw/create/claim, org pay, profile, MWP).
   What's missing is the **MCP / AgentKit / Eliza tool layer** over them. The plugins today only cover the
   reputation+parking cluster. Closing this is mostly wiring, not new backend.

3. **Two real execution gaps:** (a) **swap execution is UI-only** (no agent execute path), and (b) **no
   unified capability manifest / OpenAPI** — the 90-route surface is undiscoverable as one thing.

4. **x402 pricing exists on exactly one surface** (the score seller). Any capability worth metering (swap,
   premium data, priority vault access) has no x402 price yet.

5. **Auth is more ready than expected.** The signed-message pattern is already the norm for the money-moving
   routes. The agent-first auth story is 60% there — it just isn't the *documented, tool-backed* default.

## Priority to close the gaps (no audit gate on 1–3)

1. **Unified capability manifest + OpenAPI + `llms.txt`.** One machine-readable index of every agent-callable
   action, generated from the routes, linked from every registry. Cheapest, highest-leverage — makes the
   whole surface discoverable and self-integrable.
2. **Tool layer over the existing APIs.** Add MCP/AgentKit/Eliza actions for: vault deposit/withdraw/list,
   swap quote, org pay, profile, EAS attest, MWP. The auth already exists (signed-message) — this is wiring.
3. **Agent swap-execution path.** A server/agent route that executes a swap (or a clear "sign this calldata"
   tool), so agents aren't blocked at the browser.
4. **x402-price the meterable actions.** Extend the score-seller pattern to premium data / priority access.
5. **(Audit-gated) value-moving surfaces** — vault deposits, real settlement — plug into the above as they
   clear audit. The *design* is done now; activation follows the audit.

**Bottom line:** Mintware is ~1 cluster fully agent-first and 4 clusters that are "API-ready, tool-missing."
Making the whole build agent-first is mostly a **manifest + tool-wiring** effort on top of APIs that already
exist — not a rebuild. The value-moving parts stay audit-gated, but the agent-first *interface* to them can
ship now.
