# LP Gateway V1 — Round-2 Audit: Hacken-style + Red Team (consolidated)

**Date:** 2026-09-08 · **Code under audit:** `main` @ `e4d30ddc` (PR #477 merged — the real-funds re-audit remediation:
A-1/A-2/A-3/A-5/A-6, dedicated `gateway` signer, production ERC-4626 adapter) · **Remediation branch:** see §5.
**Four independent passes** (each with its own report + runnable PoCs):

| Pass | Report | PoCs |
|---|---|---|
| Hacken-style · contracts | [`2026-09-08-hacken-style-contracts.md`](2026-09-08-hacken-style-contracts.md) | `contracts-v4/test/audit/HackenContracts.t.sol` |
| Hacken-style · off-chain | [`2026-09-08-hacken-style-offchain.md`](2026-09-08-hacken-style-offchain.md) | `lib/gateway/__audit__/hackenOffchain.test.ts` |
| Red team · on-chain adversary | [`2026-09-08-redteam-onchain.md`](2026-09-08-redteam-onchain.md) | `contracts-v4/test/audit/RedTeamOnchain{Fork,Unit}.t.sol` |
| Red team · off-chain / ops adversary | [`2026-09-08-redteam-offchain.md`](2026-09-08-redteam-offchain.md) | `lib/gateway/__audit__/redteamOffchain*.test.ts` |

Everything below is deduplicated across the four; IDs in parentheses are the originals. **CONFIRMED** = a runnable PoC
reproduced it against the real Uniswap v4 stack (fork) or the real code paths (Vitest). Nothing here is speculative.

---

## 1. Verdict

| Question | Before round 2 | After the round-2 contract fixes (§5) |
|---|---|---|
| **Bounded OWN funds, operator = sole depositor, via direct contract calls** | Conditionally — but F-01a could strand a third of a sole holder's exit after any rally the follower hadn't seen; F-02 could freeze the idle leg behind a third-party token failure | **Yes**, with the bounded rollout (exposure cap, deep pools with no admin-controlled paired token, tiny first amount) |
| **Own funds via the `/v1` UI** | **Not possible** — HO-1 (unsigned deposit record), HO-3 (CSP blocks the RPC) | Unchanged until the off-chain fixes land (§4) |
| **Third-party funds** | **No** | **Still no** — R-1/HO-2 misrouting, R-2/A-7 registry, R-3/A-4 ledger, HO-5 credential blast radius, external audit |

---

## 2. Findings — contract layer (all fixed, see §5)

| # | Finding (source IDs) | Sev | Status |
|---|---|---|---|
| **C-1** | **Withdraw under-pays whenever spot > follower; the forgone LP slice goes to remaining holders or is stranded forever for a sole holder.** The withdraw-side `min(spot, ref)` mark was redundant once sourcing became pro-rata (M-06) and only subtracted. PoCs: sole holder −33% of deposit stranded after a legit rally; a remaining holder pumping in the victim's block nets +14.3k on 100k. (Hacken F-01a/b, I-03) | **High** · CONFIRMED | ✅ fixed — pure pro-rata exit |
| **C-2** | **A third-party token failure freezes ALL depositor funds including the liquid idle quote**: every deployed-state withdraw routed through the paired-token `TAKE` and a fee sweep to the immutable `harvestRecipient`; a paused/blacklisting paired token or a USDG freeze of the recipient reverted every exit. (Hacken F-02a/b, RT-6a/6b/6c) | **High** (availability) · CONFIRMED | ✅ fixed — best-effort LP leg + re-credit |
| **C-3** | **`MAX_DEPLOY_BPS` capped MARKED value, not principal**: a dumping paired token plus the honest cron top-up rule cycled 67% of principal into the LP and extracted 53% in 6 cycles (compromised owner: 80% / 71%). (RT-9a/9b) | **Med-High** · CONFIRMED | ✅ fixed — cost-basis cap on-chain + cron |
| **C-4** | **Re-credit re-read `_spot()` after external calls**: a paired token with transfer hooks dumps inside the exit → 12.9% of shares re-minted after full delivery. (RT-2) | **Medium** · CONFIRMED | ✅ fixed — spot cached once, weight-only |
| **C-5** | **Idle shortfall was sourced from the LP**: a paused Morpho let the first mover take the *whole* position (value-neutral, but a run dynamic); a lying / fee-flipping 4626 source moved value between co-depositors. (RT-5a/5c/5d) | **Medium** · CONFIRMED | ✅ fixed — pro-rata LP slice only; shortfall re-credited |
| **C-6** | **No user slippage bounds** on `deposit`/`withdraw`: a same-block or *held* pump before a deposit costs the depositor 12–13% (83× the attacker's fee cost); stale-high entry mark after a crash costs 14%. (RT-1a/1e, Hacken F-01c) | **Medium** (High for third-party) · CONFIRMED | ✅ mitigated — `depositWithMin` / `withdrawWithMin`; **UI must use them** |
| **C-7** | Follower only advanced on gateway actions → stale reference blocked `deploy` (`DeployPriceOutOfBand`) until the owner walked it with repeated `harvest`; also the root of C-1/C-6 staleness. (Hacken F-04, RT-3b, RT-4) | Low | ✅ fixed — permissionless bounded `poke()` |
| C-8 | Docs said "≤50% of NAV LP-exposed"; a balanced deploy is 66.7% of NAV because the owner's paired leg is added. (Hacken F-03) | Low (docs) | ✅ re-documented: the cap is on **depositor principal at cost**; the paired leg is owner capital |
| C-9 | Adapter is one-step `Ownable`; its owner can throttle exits via `perBlockWithdrawCap` (A-1 re-credits, so delay not loss). Factory doesn't verify `adapter.asset()`. (Hacken F-06/F-07, RT-7d) | Low | ⏳ accepted: adapter owner = the same Privy seat; factory check deferred (rig is deployed directly) |
| C-10 | A 4626 source whose `previewRedeem` reverts bricks every NAV read. (RT-5f) | Low (curator trust) | ⏳ accepted / curation — Morpho vaults don't revert previews; documented |
| C-11 | Robinhood Chain `block.number` = L1 block (~12 s): same-block guard, follower step and adapter cap are per ~12 s. (Hacken F-05) | Info | documented |

**Attacks that FAILED against the pre-fix code (defenses held):** withdraw sandwich, two-address same-block round trip,
7-block follower walk, $1M donation vs the VIRTUAL offset (≤ $1 effect), 300 rounding cycles, reentrancy from the 4626
source and from a hook token, `setController` / `setVault` races, adapter reuse, Ownable2Step pending-owner power,
owner idle-only sweep, fee-on-transfer paired (deploy DOA, no loss), exact-zero drain recovery, 6dp×18dp value
conservation, Permit2 revoke, all A-1/A-2/A-3/A-6/A-8/H-02 fixes present and behaving.

---

## 3. Findings — off-chain / ops layer

| # | Finding (source IDs) | Sev | Status |
|---|---|---|---|
| **O-1** | **The UI cannot record a deposit**: `V1PoolDetail.tsx` POSTs `/api/gateway/deposit` with no signature → 401 while showing "Deposited ✓"; `/api/gateway/withdraw` has zero callers. `gateway_positions` has no writer in the product → Portfolio empty, harvest credits nobody. Makes A-4 structural. (HO-1, R-3) | **High** · CONFIRMED | ⏳ open |
| **O-2** | **Deposit misrouting**: the registry keys by 32-byte poolId, the UI slug is the pair *label*, so every `/earn/<anything>` falls back to the env PM with `live: true` hard-coded — bypassing H-01 verification entirely. Harmless with one instance; a foot-gun at two. Prod-verified via GET. (HO-2, R-1, HO-4) | **High** (third-party) · CONFIRMED | ⏳ open |
| **O-3** | **Registry (A-7) deepened**: a lookalike PM echoing `quoteAsset()/poolKey()` passes H-01; `registerInstance` upserts over an ACTIVE row; staging unverified; quote compared to curator input not `LP_GATEWAY_USDG`; the curator bearer is typed into the public `/curate` page. Needs the curator secret; outcome = theft of *new* deposits. (R-2, HO-7) | **High** (needs secret) · CONFIRMED | ⏳ open |
| **O-4** | **Ledger (A-4) end-to-end**: harvest weights by DB shares, never reads `sharesOf`; a fully-withdrawn wallet still receives half a harvest; credits land in `card_spend_buffers`, which `cardAuthorize` would authorize against if `CARD_BUFFER_ENABLED`. Inert today (harvest cron OFF, no card link). (R-3, HO-6) | **High** (third-party) · CONFIRMED | ⏳ open — use `LP_GATEWAY_HARVEST_DESTINATION=restake` until an event-indexed ledger exists |
| **O-5** | **CSP `connect-src` has no Robinhood RPC** → browser `http(meta.rpcUrl)` reads are blocked; UI deposit aborts after `approve` mines, withdraw aborts before any tx. No loss; the UI money path is non-functional in prod. (HO-3) | Medium · CONFIRMED (prod header) | ⏳ open |
| **O-6** | **Seat separation is address-level only**: one `PRIVY_APP_SECRET` reaches every Privy wallet (`root`, `gateway`); `ORACLE_SIGNER_PROVIDER` is a global switch (typo ⇒ raw-key mode); `range`/`agent` still fall back to the git-exposed `ORACLE_PRIVATE_KEY`. (HO-5, R-8) | Medium | ⏳ open — Privy authorization keys / per-wallet policies; purge legacy raw keys |
| O-7 | Feed poisoning: GeckoTerminal-steerable risk score, unbounded est-APR via name suffix, any-https tracking pixel, USDG matched by *name* when `LP_GATEWAY_USDG` is unset (prod), prune-to-top-30 evicts legit candidates, no fetch timeout. (R-4) | Medium | ⏳ open — set `LP_GATEWAY_USDG`; harden discovery |
| O-8 | `/sparklines` fans out 16 upstream calls per request for any 64-hex ids; rate limits are no-ops (Upstash unset); `/request` accepts 100 KB free text. (R-5, HO low) | Medium (DoS/cost) | ⏳ open — set Upstash env |
| O-9 | One global absolute-L `LP_GATEWAY_DEPLOY_MIN_LIQUIDITY` for all pools (the §7.5 "compute from spot" was never built). (HO-8) | Medium (latent) | ⏳ open |
| O-10 | Signed-message: `txHash`/`pool` not compared to body; no nonce (15-min replay) — bounded by the on-chain event / `receipt.to` / UNIQUE tx-hash anchor. (R-6) | Low | ⏳ open |
| O-11 | Leaderboard Σ`entry_nav` inflates via unrecorded withdraws. (R-7) | Low | ⏳ open |
| O-12 | `NODE_ENV=development` bypasses bearer on curate/register (dev boxes only). | Low | ⏳ open |
| O-13 | Dependencies: 150–166 advisories, none in the gateway server path; direct `next` ×12 → patch upgrade. | Low | ⏳ open |
| O-14 | Docs vs code (24 items across both passes): "discover every 3h" vs daily cron; "depositable only once curated" false; M-04 "fixed" but the client never updated; ~24 `LP_GATEWAY_*` env vars undocumented; stale "other chat" caveat. | Info | ⏳ open |

**Held:** bearer fail-closed (500 on unset, 401 live), the deposit trust anchor (`receipt.to`, event user == signer,
on-chain `sharesOf`, tx-hash idempotency), action/issuedAt binding, `gateway` seat with no fallback,
`minLiquidity=0` refusal, swap seams fail-closed, RLS deny-all on all 7 gateway tables, no PostgREST/SSRF injection,
input coercion / no XSS, BigInt-safe JSON, deploy-script chain-id + code preflights, exact-amount approve.

---

## 4. What still gates what

**Own funds (bounded, direct contract calls):** nothing at the contract layer after §5. Rollout gates: exposure cap ·
deep pool whose paired token has **no admin controls** (pause/blacklist/proxy — see C-2/C-10 residuals) ·
tiny first amount · watch harvest / out-of-range / breaker · `LP_GATEWAY_HARVEST_DESTINATION=restake`.
**Own funds via the UI:** O-1, O-2, O-5 first.
**Third-party funds:** O-1 → O-4, O-6, `depositWithMin` wired in the UI (C-6), then an external audit.

---

## 5. Remediation shipped in this round (contract)

`MintwareLpGatewayPositionManager`:
- **Pure pro-rata exit** (`_withdraw`): share fraction of the idle reserve AND of position liquidity; the withdraw-side
  `min(spot, ref)` mark is retired (deposit keeps `max(spot, ref)`). Spot is read once, before any external call, and
  used only as the re-credit weight. Last holder's exit removes all liquidity (no offset dust; A-2 clean state).
- **Best-effort LP leg**: `lpLegExit` self-call inside `try`; on failure the idle leg still pays and the LP slice is
  re-credited as shares (`LpLegUnavailable` event). Idle shortfall is re-credited, never sourced from the LP.
- **Cost-basis cap**: `deployedPrincipal` tracks quote principal in the LP at cost (up on deploy, down pro-rata on
  exit, never with price); `MAX_DEPLOY_BPS` now bounds `deployedPrincipal + quoteToDeploy` against
  `staged + deployedPrincipal`. Cron targets `ratio·(staged + deployedPrincipal) − deployedPrincipal`.
- `depositWithMin` / `withdrawWithMin` (`SlippageExceeded`), permissionless bounded `poke()`.

**Evidence:** existing gateway unit 44/44 · hardening fork 7/7 · new
`contracts-v4/test/fork/MintwareLpGatewayAuditRound2Fork.t.sol` **10/10** (F-01a/b, F-02a/b, F-04, RT-1a, RT-2, RT-5a,
RT-9a, withdrawWithMin) · the auditors' own PoC suites re-run against the fix: F-01a/b, F-02a/b, I-03, RT-2, RT-5a,
RT-6a/b/c, RT-9a/b **now fail as attacks** (suites updated to assert the fixed behavior).
