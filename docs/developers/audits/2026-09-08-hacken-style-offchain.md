# LP Gateway V1 — Off-chain & Integration Layer Audit (Hacken methodology)

**Date:** 2026-09-08 · **Auditor:** Fable 5.1 (independent pass, read-only) · **Target:** branch `fix/lp-gateway-realfunds-audit` (identical to the merge candidate for `main`)
**Layer:** Next.js 16 App Router routes + crons, `lib/gateway/*`, `lib/web2/routeHandler.ts`, signer resolution, Supabase migrations/RLS, deploy/smoke scripts, the V1 money-path UI, and the documentation that describes them.
**Out of scope:** Solidity (covered by the firm-grade review + the real-funds re-audit), Privy dashboard configuration, Vercel env *values* (only names were read).

---

## 1. Executive summary

The off-chain layer is **conservatively built where money moves under the operator's key** — every cron is flag-gated OFF and fails closed, the gateway seat is a dedicated role with no shared-key fallback, deploy refuses a zero slippage floor, bearer auth is constant-time and fails closed, RLS is enabled on all seven gateway tables, and untrusted GeckoTerminal data never reaches an on-chain action. Those controls re-verified as sound.

The material problems are **not in the cron/keeper path — they are in the user-facing money path and the ledger that is supposed to sit behind it**, and three of them are confirmed against production with read-only GETs:

1. **The UI cannot record a deposit.** `/api/gateway/deposit` was hardened to signed-message auth (M-04) but the only client caller still posts `{address, txHash, pool}` with no signature → **401 on every UI deposit**, while the button shows "Deposited ✓". Withdraw never calls its record route at all. Consequence: `gateway_positions` has **no writer in the product**, so the Portfolio is empty for every depositor, harvest has nobody to credit, and A-4 ("ledger never written") is now structural, not merely unfinished. **[HO-1, HIGH]**
2. **Every `/earn/<slug>` resolves to the single env-fallback PositionManager and is reported `live: true`.** The registry is keyed by 32-byte v4 poolId, the UI slug is the *pair label*, so a registry lookup by slug can never match; `resolveRouteInstance` then returns `LP_GATEWAY_POSITION_MANAGER` for any slug, and `meta` hard-codes `live: true`. Production confirms: `GET /api/gateway/meta?pool=definitely-not-a-pool` → the `0x24ff…3b11` rig, `live: true`. The page shows GeckoTerminal metrics for pool *X* while the deposit target is the PONS/USDG rig. The env fallback also **bypasses the H-01 on-chain verification** entirely — and production's registry is empty (`/api/gateway/instances` → `[]`), so the fallback *is* the live trust root. **[HO-2, HIGH]**
3. **The enforced CSP blocks the browser's RPC calls.** `connect-src` has no Robinhood host; `V1PoolDetail` builds `createPublicClient({ transport: http(meta.rpcUrl) })` in the browser for `waitForTransactionReceipt` / `sharesOf`. In production the deposit flow aborts after `approve` mines and the withdraw flow aborts before any tx. No loss — but the "LIVE" product's deposit/withdraw UI cannot complete. **[HO-3, MEDIUM]**

Two trust-model over-claims also need correcting: the **`root`/`gateway` seat separation is key-level only** — both wallets sign with the same `PRIVY_APP_ID`/`PRIVY_APP_SECRET` and no Privy authorization key or wallet policy is used, so a Vercel env leak reaches every seat **[HO-5, MEDIUM]**; and the **known-open A-4 / A-7** items re-verify as described, with A-7's hot-swap now PoC'd **[HO-6, HO-7]**.

### Verdict

| Scenario | Verdict | Conditions |
|---|---|---|
| **Own funds, bounded** (operator = sole depositor = curator, via *direct contract calls*) | **Acceptable with conditions** | The off-chain layer adds no *loss* path beyond the contract review's accepted residuals: crons OFF, dedicated seat, deposit target operator-controlled. Accept HO-4/HO-5 as operator risk; set `LP_GATEWAY_HARVEST_DESTINATION=restake` so fee income reaches NAV on-chain instead of an unwritten ledger. |
| **Own funds via the UI** | **Not possible today** | HO-1 + HO-2 + HO-3 (+ `LP_GATEWAY_USDG` unset in prod → the deposit button refuses). Fix all three before treating the UI as the product. |
| **Third-party funds** | **NOT READY** | HO-1, HO-2, HO-5, HO-6 (A-4), HO-7 (A-7) must be closed; then the external audit that already gates mainnet. |

---

## 2. Scope (files read end-to-end)

- `lib/gateway/`: `deploy.ts`, `harvest.ts`, `circuitBreaker.ts`, `registry.ts`, `discovery.ts`, `riskScore.ts`, `positionReader.ts`, `routerSwap.ts`, `v4SwapExec.ts`, `basisMath.ts`, `harvestMath.ts`, `chain.ts`, `alerts.ts`, `snapshot.ts`, `poolState.ts`, `sparkline.ts`, `opsConfig.ts` + all `*.test.ts`
- `app/api/gateway/{alerts,curate,deposit,discover,instances,leaderboard,meta,position,positions,request,sparklines,withdraw}/route.ts`
- `app/api/(rewards)/cron/gateway-{deploy,discover,harvest,snapshot}/route.ts` (snapshot hosts the breaker)
- `lib/web2/routeHandler.ts`, `lib/web2/supabase.ts`, `lib/web3/signedActionMessages.ts`, `lib/web3/oracleSigner.ts`, `lib/web3/oracleKeys.ts`, `lib/web3/artifacts/lpGateway.ts`
- `supabase/migrations/20260906000001`, `20260906000002`, `20260907000001`, `20260907000002`, `20260907000003`
- `scripts/deploy-lp-gateway-robinhood.mjs`, `scripts/smoke-lp-gateway-robinhood.mjs`, `config/deployments.json`, `vercel.json`, `next.config.mjs` (CSP)
- `components/web2/v1/{V1PoolDetail,V1Discover,V1Portfolio}.tsx`, `useGatewayBuffer.ts`, `app/earn/[pool]/page.tsx`, `app/curate/page.tsx`
- Contract surface cross-checked: `MintwareLpGatewayPositionManager.sol` (withdraw/deploy/paused), `MintwareLpGatewayFactory.sol` (`instanceForPool`)
- Docs: `lp-gateway-v1-realfunds-audit-findings.md`, `lp-gateway-v1-security-review.md`, `lp-gateway.md`, `lp-gateway-testnet-runbook.md`, `.claude/rules/lp-gateway.md`, `.claude/rules/deployments.md`, `.claude/STATE.md` (gateway rows)

Production evidence gathered with **read-only public GETs only**: response headers of `/earn/pons-usdg`, `/api/gateway/meta?pool=…`, `/api/gateway/instances`. No money-moving endpoint was called; no transaction was sent; no source file was modified. One new test file was added: `lib/gateway/__audit__/hackenOffchain.test.ts` (8 PoCs, all passing = all confirmed).

---

## 3. Trust model (as built, off-chain)

```
                         ┌──────────────────────────────────────────────────────────────┐
  GeckoTerminal ───────▶ │ discovery.ts  (sanitised; auto rows land PENDING only)        │
  (untrusted)            │ riskScore.ts  (ranks, never certifies)                        │
                         └───────────────┬──────────────────────────────────────────────┘
                                         ▼  gateway_pool_requests (pending)
  /api/gateway/request ──▶ (public, free-text pool_address, rate-limit FAILS OPEN) ──────┘
                                         │
        Curator bearer (LP_GATEWAY_CURATOR_SECRET, fails closed) ──▶ /api/gateway/curate
                                         │ approve + addresses
                                         ▼
                         verifyInstanceOnChain(PM.quoteAsset(), PM.poolKey()) ── via LP_GATEWAY_RPC_URL (trusted RPC)
                                         │ ok → UPSERT gateway_instances (pool_address, chain) — no read-before-write
                                         ▼
   ┌────────────────── DEPOSIT-ROUTING TRUST ROOT ──────────────────────────────────────────────┐
   │  registry row (poolId-keyed, verified)   OR   env fallback LP_GATEWAY_POSITION_MANAGER      │
   │                                               (label-keyed, NOT verified, always live:true) │
   └───────────────┬───────────────────────────────────────────────────────────────────────────┘
                   ▼  /api/gateway/meta {positionManager, usdg=env, rpcUrl, live:true}
   Browser (V1PoolDetail) ── approve(usdg→PM) ── PM.deposit() ── POST /api/gateway/deposit (401: unsigned)
                   │                                                    ▲
                   └── browser RPC via http(meta.rpcUrl) ── BLOCKED by CSP connect-src ─┘

   Operator key path (all OFF by default, fail closed):
   Vercel cron (CRON_SECRET bearer) ──▶ gateway-snapshot ──▶ alerts ──▶ circuitBreaker ──▶ PM.setPaused   [getOracleSigner('gateway')]
   (not scheduled)                  ──▶ gateway-harvest  ──▶ PM.harvest → seat wallet → DB credits (no per-user rows exist)
   (not scheduled)                  ──▶ gateway-deploy   ──▶ zap seam (inert) ──▶ claim window ──▶ PM.deploy(minLiquidity>0)

   Signer: ORACLE_SIGNER_PROVIDER=privy → PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET) → wallet GATEWAY_ORACLE_PRIVY_WALLET_ID
           same app secret controls ROOT_ORACLE_PRIVY_WALLET_ID (card/x402). No authorization key, no wallet policy.
   Data:   Supabase service-role only (server), RLS enabled (deny-all) on all gateway tables.
```

**Who can make the app move money or point users at a contract:** (a) whoever writes Vercel env (`LP_GATEWAY_POSITION_MANAGER`, `LP_GATEWAY_USDG`, `LP_GATEWAY_RPC_URL`, the `*_ENABLED` flags, `PRIVY_APP_SECRET`); (b) the curator bearer holder (registry rows, on-chain-verified); (c) the `LP_GATEWAY_RPC_URL` operator (can lie to `verifyInstanceOnChain`, to the deposit-route receipt check, and to NAV reads); (d) Vercel cron with `CRON_SECRET` (only executes flag-gated code). Users can only affect their own DB rows (signed-message) and the public request queue.

---

## 4. Methodology

Hacken-style systematic pass: (1) architecture/trust-root mapping; (2) per-route checklist — authn/authz, replay & action binding, input validation (20- or 32-byte pool ids), idempotency, rate limiting, fail-closed posture, information leakage, BigInt/JSON safety, SSRF/URL handling, CORS/CSP; (3) crons — flag gating, signer role, race/idempotency, gas/deadline, partial failure, RPC lies/lag; (4) data layer — RLS, service-role scoping, ledger consistency, lost updates; (5) secrets/keys — resolution paths, fallbacks, blast radius of a leaked env, Privy scoping; (6) deploy/ops scripts — preflights, mis-wire paths; (7) frontend — which addresses are trusted, copy vs hard lines; (8) docs-vs-code; (9) `pnpm audit --prod`. Each suspected issue traced end-to-end; where a deterministic PoC was possible it was written as a Vitest (`lib/gateway/__audit__/hackenOffchain.test.ts`), otherwise marked by evidence type. Status: **CONFIRMED** (PoC or production GET or unambiguous code path) / **THEORETICAL** (depends on configuration not inspectable here).

---

## 5. Findings table

| ID | Severity | Likelihood / Impact | Title | Status |
|---|---|---|---|---|
| HO-1 | **High** | Certain / High (ledger integrity; A-4 amplifier) | UI deposit-record call is unsigned → 401 on every deposit; withdraw never records | CONFIRMED (PoC + code) |
| HO-2 | **High** | Certain / High (third-party: wrong-pool routing; bypasses H-01) | Label-slug vs poolId mismatch → every `/earn/[pool]` resolves to the unverified env fallback, `live: true` hard-coded | CONFIRMED (PoC + prod GET) |
| HO-3 | Medium | Certain / Medium (availability of the money UI; no loss) | Enforced CSP `connect-src` omits the Robinhood RPC → browser deposit/withdraw flow aborts | CONFIRMED (prod header + code) |
| HO-4 | Medium | Low / High | Env fallback instance is an unverified deposit-routing trust root (H-01 class) and is the *only* root in prod | CONFIRMED (prod GET) |
| HO-5 | Medium | Low / High | Privy seat separation is key-level only: one app secret controls `root` and `gateway`; no authorization key / wallet policy | Code-CONFIRMED absence; dashboard THEORETICAL |
| HO-6 | Medium (own funds) / **High** (third-party) | Certain / High | A-4 re-verified: `card_spend_buffers.gateway_position_id` has zero writers; with HO-1 `gateway_positions` has none either; `bufferMonitor` overwrite confirmed | CONFIRMED (grep + code) |
| HO-7 | Medium | Low / Medium | A-7 re-verified + hot-swap PoC: `registerInstance` upserts over an active row with no read-before-write; `staging` unverified; factory check not applicable to the current rig | CONFIRMED (PoC) |
| HO-8 | Medium (latent, deploy OFF) | Medium / Medium | `LP_GATEWAY_DEPLOY_MIN_LIQUIDITY` is one global absolute-L floor for all pools — cannot be protective and non-bricking across pools | CONFIRMED (code) |
| HO-9 | Low | Medium / Low | Sparklines: unbounded module-level cache keyed by unvalidated caller input; per-request GeckoTerminal fan-out | CONFIRMED (PoC) |
| HO-10 | Low | High / Low | `/api/gateway/request` accepts free-text `pool_address`/`chain_id`/unbounded label; rate limit fails open | CONFIRMED (PoC) |
| HO-11 | Low | Low / Low | Discover `live` computed without `status='active'` filter → deactivated instance shows live, routes to fallback | CONFIRMED (PoC) |
| HO-12 | Low | Low / Low | Signed-message auth: no nonce (15-min replay), EIP-191 JSON without domain/chainId; signed `pool`/`txHash` not compared to body | CONFIRMED (PoC) |
| HO-13 | Low | Low / Low | `/api/gateway/meta` echoes the server `rpcUrl` publicly | CONFIRMED (prod GET) |
| HO-14 | Low | Low / Medium | Deploy script silently falls back to the shared `ROOT_*` Privy seat; smoke script uses `ROOT_*` only; `LP_GATEWAY_POOL_ADDRESS` is a label (root cause of HO-2) | CONFIRMED (code) |
| HO-15 | Low | Low / Low | Rate limiting inactive in prod (Upstash unset, fails open); `position(s)` GETs amplify RPC reads per `?address=` | CONFIRMED (code + docs) |
| HO-16 | Low | Low / Low | Cron hygiene: zap runs before the L-02 claim; harvest dupe check after the tx (vacuous); `discoverAndIngest` fetch has no timeout | CONFIRMED (code) |
| HO-17 | Info | — | Copy vs hard lines: "withdraw anytime", "always in range", "Idle in Morpho", "Deposited ✓" on failure, deposit-noun framing | CONFIRMED (code) |
| HO-18 | Info | — | Documentation-vs-code discrepancies (11 items, §7) | CONFIRMED |
| HO-19 | Info | — | Dependency audit: 150 advisories in the prod tree; `next` carries 12 High (DoS / middleware bypass) as a direct dep | CONFIRMED (`pnpm audit --prod`) |

No Critical. Nothing found that lets an unprivileged party move or redirect funds through the off-chain layer.

---

## 6. Detailed findings

### HO-1 · HIGH · The UI's deposit-record call cannot pass the route's auth; withdraw never records — the depositor ledger has no writer in the product
**Where.** `components/web2/v1/V1PoolDetail.tsx:131` sends `POST /api/gateway/deposit` with body `{ address, txHash, pool }`. `app/api/gateway/deposit/route.ts:116` declares `{ auth: 'signed-message', action: 'mintware-gateway-deposit' }`; `lib/web2/routeHandler.ts:276-279` rejects any body without `authMessage`/`authSignature`/`issuedAt` with **401 `AUTH_REQUIRED`**. The UI never checks the response (`await fetch(...)` then `setStatus('done')`, line 131-132) and renders "Deposited ✓" (`:164`). `withdraw()` (`:139-162`) completes on-chain and never calls `/api/gateway/withdraw` — the route has **zero callers** in the repo (grep). `buildGatewayDepositMessage`/`buildGatewayWithdrawMessage` (`lib/web3/signedActionMessages.ts:347-383`) are exported and used by nothing.
**Evidence.** PoC `HO-1` invokes the route with the UI's exact body → `401 AUTH_REQUIRED`. Git history: the route was hardened in `777c7b92` (M-04 remediation); the client was not updated in that or any later commit touching `V1PoolDetail.tsx`.
**Impact.** `gateway_positions` is written only by these two routes, so in the shipped product it is **never written**: the Portfolio (`positions/route.ts:30` is DB-first — `if (posRows.length === 0) return []`) shows no position for any depositor even though `sharesOf` on-chain is non-zero; `snapshot.ts`, `leaderboard`, and harvest's pro-rata split (`harvest.ts:188-196`) see no rows. This turns A-4 from "unfinished" into "structurally unwritable" and defeats the purpose of M-04 (which was meant to make basis recording *safe*, not impossible). A depositor who reads "Deposited ✓" and then an empty portfolio has a reasonable belief their funds are gone. Own funds: dashboard lies; third-party: fee income has no attribution.
**Recommendation.** (1) In `deposit()`/`withdraw()`, sign `buildGatewayDepositMessage`/`buildGatewayWithdrawMessage` via the connected wallet and post `{ address, txHash, pool, authMessage, authSignature, issuedAt }`; check `res.ok` and surface a "recorded / not recorded — retry" state. (2) Make the Portfolio **chain-first**: enumerate active instances (+ fallback) and read `sharesOf` for the wallet, using DB rows only for cost basis. (3) Add a reconciliation job that indexes `Deposited`/`Withdrawn` events into `gateway_positions` so the ledger never depends on a client round-trip (this is also the A-4 fix's precondition). (4) Add a Vitest that drives the deposit route with the client's real body builder so client/route drift fails CI.

### HO-2 · HIGH · Pool-identity confusion: every `/earn/[pool]` resolves to the env fallback PositionManager, reported `live: true`, bypassing on-chain verification
**Where.** Slug: `V1Discover.tsx:39` and `V1Portfolio.tsx:37` build `/earn/<pairLabel-as-slug>` (e.g. `pons-usdg 0.3%`). Registry: `gateway_instances.pool_address` is written from `gateway_pool_requests.pool_address`, which `discovery.ts:141` normalises to a **32-byte v4 poolId**. `registry.ts:160-172` matches `pool_address = slug.toLowerCase()` → never matches a poolId row → `resolveRouteInstance` (`:110-123`) returns `{ cfg.positionManager, cfg.poolAddress }` for *any* slug. `meta/route.ts:63` returns literal `live: true`; `:58` returns `usdg` from the global env `LP_GATEWAY_USDG`, not the instance's `quote_asset`. `chain.ts:19-27` accepts `LP_GATEWAY_POSITION_MANAGER` with only an `isAddress` check — `verifyInstanceOnChain` is applied **only** to registry rows (`registry.ts:194-202`), never to the fallback.
**Evidence.** PoC `HO-2` (both tests). Production: `GET /api/gateway/meta?pool=definitely-not-a-pool` → `{ positionManager: "0x24ff5d2bb29b5448bdf96db0fcdf0553ebda3b11", poolAddress: "pons-usdg", live: true, usdg: null, rpcUrl: "https://rpc.testnet.chain.robinhood.com" }`; `GET /api/gateway/instances` → `[]`. The runbook itself documents the label convention (`lp-gateway-testnet-runbook.md:59`: "a label/poolId you key the DB by, e.g. tpons-usdg") and the deploy script prints `LP_GATEWAY_POOL_ADDRESS = pons-usdg` (`deploy-lp-gateway-robinhood.mjs:239`).
**Impact.** The detail page renders GeckoTerminal metrics for pool *X* (matched by label, `V1PoolDetail.tsx:66`) with an "Est. Fee APR", a "Live" chip and a deposit button whose target is a *different* pool's gateway. With third-party users this is mis-sold exposure (a mainnet meme pool's APR shown, PONS/USDG rig funded). The deposit route then records the position under the fallback's `poolAddress` — internally consistent, externally wrong. Because the fallback is not verified on-chain, a Vercel env write is a deposit-target substitution (the H-01 class the registry was hardened against). Today production is accidentally safe on this path only because `LP_GATEWAY_USDG` is unset (`V1PoolDetail.tsx:113` refuses when `!meta.usdg`) — and the docs instruct setting it.
**Recommendation.** (1) Key everything by **poolId**: `/earn/[poolId]`, `gateway_instances.pool_address = poolId`, `LP_GATEWAY_POOL_ADDRESS = poolId`; show the label from the row. (2) `resolveRouteInstance` must **not** fall back when a `pool` param was supplied and did not match → `404 pool_not_live`. (3) `meta.live` must be derived (registry row with `status='active'`, or verified fallback), and `meta.usdg` must be `inst.quoteAsset`. (4) Run `verifyInstanceOnChain` on the env fallback at first use (memoise per process) and refuse to serve it on mismatch — or drop the fallback and register the rig. (5) UI: assert `meta.poolAddress === discover.poolAddress` before enabling the deposit button.

### HO-3 · MEDIUM · The enforced CSP blocks the browser-side RPC the money UI depends on
**Where.** `next.config.mjs:16-24` (`connect-src`) lists Base/Arbitrum/Ethereum RPCs, Supabase, Privy, WalletConnect — **no `rpc.testnet.chain.robinhood.com`** (nor any wildcard). Applied to every route via `:86` (`Content-Security-Policy: CSP_ENFORCED`). `V1PoolDetail.tsx:122` creates `createPublicClient({ transport: http(meta.rpcUrl) })` in the browser and calls `waitForTransactionReceipt` (`:125,128,155`) and `readContract('sharesOf')` (`:150`).
**Evidence.** Production response headers on `/earn/pons-usdg` carry the enforced CSP whose `connect-src` contains no robinhood host (fetched read-only); code paths above.
**Impact.** Deposit: `approve` is sent through the injected wallet (its own RPC — allowed), then the receipt wait to `meta.rpcUrl` is blocked → `catch` → "Deposit failed" with the approve **already mined** (an exact-amount allowance to the PM — harmless, but confusing) and `deposit()` never sent. Withdraw: the `sharesOf` read is blocked before any tx. So the "LIVE" product's deposit/withdraw UI cannot complete in production; users who saw metrics and a Live chip get a generic failure. No fund loss.
**Recommendation.** Add the Robinhood RPC host(s) to `connect-src` (and the mainnet host when the chain moves), or route browser reads through a same-origin API. Add a Playwright smoke that performs the flow against the deployed CSP so the header and the code cannot drift silently. Prefer using the wallet transport for `waitForTransactionReceipt` (avoids a second RPC dependency).

### HO-4 · MEDIUM · The env fallback is an unverified deposit-routing trust root — and the only one in production
**Where.** `chain.ts:15-29`, `registry.ts:119-121`, `deposit/route.ts:40` (`receipt.to === inst.positionManager` — verifies the user's tx against whatever the fallback says), `meta/route.ts:54`.
**Evidence.** `/api/gateway/instances` → `[]` in production; `/api/gateway/meta` serves the env PM. Registry rows get `verifyInstanceOnChain`; the env PM gets `isAddress`.
**Impact.** The H-01 control ("the registry row is the trust root, verify it on-chain") is bypassed by the code path that actually serves production. Anyone with Vercel env write (or a CI/secret-manager compromise) substitutes the deposit target for every user; the deposit route will then happily "verify" user txs against the substituted address. Likelihood low (operator-controlled), impact high (principal routed to an arbitrary contract).
**Recommendation.** Verify the fallback exactly like a registry row (`quoteAsset()` + `poolKey()` hash == `LP_GATEWAY_POOL_ADDRESS`, which requires HO-2's poolId keying), memoised; log an alert on mismatch; long-term remove the fallback and make the registry the sole root. Consider pinning the expected PM **code hash** as well, so a same-interface impostor is rejected.

### HO-5 · MEDIUM · Privy seat separation is key-level only; one app secret controls every wallet
**Where.** `lib/web3/oracleSigner.ts:75` — `new PrivyClient(appId, appSecret)` then `createViemAccount({ walletId, address, privy })`. No `walletApi.authorizationPrivateKey`, no per-wallet policy, no quorum. `oracleKeys.ts:37` correctly gives the `gateway` role no raw-key fallback — but in Privy mode both `root` and `gateway` resolve through the same `PRIVY_APP_ID`/`PRIVY_APP_SECRET`.
**Evidence.** Code above; `scripts/provision-privy-oracle-wallet.mjs` creates wallets with no owner/authorization key. Whether the Privy dashboard restricts these wallets by policy could not be inspected → dashboard side THEORETICAL; code side CONFIRMED absent.
**Impact.** The A-3 remediation note ("a gateway compromise can't reach card/x402") holds for a leaked *wallet id* or a leaked *rig owner key*, but not for the realistic case — a leaked Vercel environment — which exposes `PRIVY_APP_SECRET` and therefore every seat: `deploy`/`harvest`/`setPaused` on the gateway **and** card settle / x402 on `root`. The gateway seat can move up to `MAX_DEPLOY_BPS` (50%) of NAV into a chosen pool at a price bounded only by the follower band.
**Recommendation.** Enable Privy **authorization keys** (owner key held outside Vercel — HSM/1Password, or a quorum with a human co-signer) for both server wallets, and attach a **wallet policy** to the gateway wallet allow-listing the PM address and the selectors `deploy`, `harvest`, `setPaused`, `compoundQuote`, `approve(quote→PM)` with chain `46630`/`4663`. Document the residual honestly: "a Vercel env leak reaches every Privy seat unless authorization keys are configured".

### HO-6 · MEDIUM (own) / HIGH (third-party) · A-4 re-verified: the per-depositor buffer ledger has no writer, and the position table now has none either
**Where.** `card_spend_buffers.gateway_position_id` is referenced by exactly three files (grep): the migration that adds it, `harvest.ts:210` (reader), `position/route.ts:119` (reader). Nothing writes it. `harvest.ts:212 if (!buf?.id) continue` fires for every depositor → `credited = 0`, `harvest_events.amount_credited_atomic = 0`, net fees accumulate in the seat wallet. `harvest.ts:188-196` weights by DB `gateway_positions.shares` (written only by the routes HO-1 shows are never reached). `lib/org/bufferMonitor.ts:78-81` overwrites `buffer_balance_atomic` from the on-chain card buffer — would erase gateway credits if a row were ever linked. Non-atomic read-modify-write at `harvest.ts:207-216`.
**Status.** Unchanged from the prior audit, with one aggravation: because of HO-1 the *share* table is also unwritten in the product, so the ledger is not "tolerable but unfinished" — it does not exist end-to-end. **Own funds** (sole depositor = operator): fees sit in the operator's own seat wallet — no leak. **Third party**: 100% of fee income is an off-chain IOU with no per-user row; must be fixed before any third-party depositor.
**Recommendation.** Until the event-indexed, on-chain-share-weighted, atomically-written ledger exists: set `LP_GATEWAY_HARVEST_DESTINATION=restake` as the default — `compoundQuote` lifts NAV pro-rata **on-chain**, so fee income provably reaches depositors without any DB. Build the ledger as: index `Harvested`/`Deposited`/`Withdrawn` by `(tx_hash, log_index)`; weight by `sharesOf`/`totalShares` read at the harvest block; write credits in a Postgres function with `FOR UPDATE`; keep it in its **own** table the card monitor never touches.

### HO-7 · MEDIUM · A-7 re-verified: the registry upsert hot-swaps an active instance; `staging` unverified; factory check not applicable to the current rig
**Where.** `registry.ts:203-219` — `upsert(..., { onConflict: 'pool_address,chain_id' })` with `status: 'active'`; no prior `select`. `verifyInstanceOnChain` reads the *candidate's* self-reported `quoteAsset()`/`poolKey()` (`:72-81`) — a hostile contract can echo them. `staging` (`:208`) is never checked against `PM.staging()`; `deploy.ts:76-78` reads `stagedAssets` from that registry `staging`, so a wrong address skews the threshold read (bounded by the on-chain cap; no loss). `MintwareLpGatewayFactory.instanceForPool(poolId)` exists (`.sol:34`) but the live rig was deployed **directly** by the `.mjs`, not via the factory, so "require factory-deployed" would reject the current instance.
**Evidence.** PoC `HO-3`: `registerInstance` with a passing verifier issues `upsert` and never `select`s.
**Impact.** Curator-trust-conditional. If an active pool is re-registered with a different PM, every existing depositor's `gateway_positions` row (keyed by `pool_address`) now points at the new PM → `sharesOf` reads 0 → Portfolio empties, the withdraw button says "No position"; funds remain in the old PM, reachable only by direct contract interaction. Availability/UX loss, not theft — unless the substituted PM is hostile (then it is the H-01 outcome the curator is trusted to prevent).
**Recommendation.** (1) Read before write: if an `active` row exists for `(pool, chain)`, **refuse** unless the request carries an explicit `replace: true` and the old row is first set `inactive` (and keep the old PM resolvable for withdraw-only). (2) Verify `PM.staging() == supplied staging`. (3) For factory-deployed instances also assert `factory.instanceForPool(poolId) == {pm, staging, active}`; for direct deploys, pin the expected **runtime code hash**. (4) Alert (Slack/email) on every registration.

### HO-8 · MEDIUM (latent) · A single global `LP_GATEWAY_DEPLOY_MIN_LIQUIDITY` cannot protect every pool
**Where.** `deploy.ts:124-131` — one env value in absolute Uniswap `L` units is threaded to `deploy()` for *every* active instance (`deployAll`, `:59-63`). `L` depends on token decimals, price and the range; a floor that is meaningful for PONS/USDG (6dp/18dp, price 1) is either useless (too low) or a permanent revert (too high) for the next pool.
**Evidence.** Code path; deploy is OFF (`LP_GATEWAY_DEPLOY_ENABLED` unset; not in `vercel.json`).
**Impact.** The A-3 remediation says the cron "refuses `minLiquidity = 0`" — true — but the realfunds fix plan (§7.5, "compute real `minLiquidity` from current spot × (1−tol)") was not implemented; the sandwich floor is operator guesswork and multi-pool-incorrect. The on-chain follower band and `MAX_DEPLOY_BPS` remain the real bound.
**Recommendation.** Compute per instance at run time: read slot0 (`poolState.readCurrentTick`), compute `L_expected = getLiquidityForAmounts(spot, tickLower, tickUpper, quote, paired)`, set `minLiquidity = L_expected × (1 − LP_GATEWAY_DEPLOY_TOL_BPS/10_000)`. Keep the env as an *optional* additional floor. Also submit via a private mempool/relay when one exists on Robinhood Chain.

### HO-9 · LOW · Sparklines cache is keyed by unvalidated caller input and unbounded
**Where.** `sparklines/route.ts:12` (`const cache = new Map()` never evicted), `:16` (raw `?pools=` split, up to 30 items of any length, lower-cased but not shape-checked), `:19` (cache key = sorted raw ids), `:23` (`fetchSparklines` validates ids only for the upstream URL).
**Evidence.** PoC `HO-5`: 25 requests with distinct 2 KB junk ids → 25 upstream calls, 25 new Map keys.
**Impact.** Each distinct id-set is a cache miss → up to 16 GeckoTerminal calls (free tier ≈ 30 req/min) — an unauthenticated caller can exhaust the quota and starve the Discover feed for everyone; the Map grows without bound for the instance's lifetime (serverless recycling caps the damage). Rate limiting is inactive (HO-15).
**Recommendation.** Validate ids with the same 20/32-byte regex *before* keying; cache per **id** not per set; bound the Map (LRU, e.g. 500 entries); apply a `rateLimit` to the route and make Upstash live.

### HO-10 · LOW · `/api/gateway/request` accepts free-text `pool_address`, arbitrary `chain_id`, unbounded `pair_label`
**Where.** `request/route.ts:16-27` — only `quoteAsset` is `isAddress`-checked; `pool_address` is any string, `chain_id` any number, `pair_label` any length. Rate limit declared (5/min) but fails open (Upstash unset). The auto path caps labels at 64 and shape-checks ids (`discovery.ts:28-38`); the manual path does neither.
**Evidence.** PoC `HO-6`.
**Impact.** Queue pollution (manual rows have `risk_score = null` → sorted last, so auto candidates are not hidden), a spoofed `pair_label` shown to the curator on `/curate` (React escapes markup; social-engineering only), unbounded row size. No funds impact.
**Recommendation.** Reuse `normalizePoolId` and `sanitizeLabel` from `discovery.ts`; restrict `chainId` to `gatewayConfig().chainId`; require `signed-message` auth (`requesterWallet` is currently self-asserted); activate Upstash.

### HO-11 · LOW · Discover's `live` flag ignores instance status
**Where.** `discover/route.ts:27-31` — `gateway_instances` filtered by `chain_id` only; `resolveGatewayByPool` requires `status='active'`.
**Evidence.** PoC `HO-7`.
**Impact.** A deactivated instance shows "Live" in the feed; clicking through resolves to the env fallback (HO-2) — a second route into wrong-pool deposits.
**Recommendation.** `.eq('status','active')`; share one `listActiveInstances` call.

### HO-12 · LOW · Signed-message auth: no nonce, plain EIP-191 JSON, unchecked signed fields
**Where.** `routeHandler.ts:267-335` binds `issuedAt` and `action` (sound) but has no single-use nonce; `signedActionMessages.ts` messages carry no domain/chainId (EIP-191 text, not EIP-712). `deposit/withdraw` routes never compare the signed `pool`/`txHash` to the body (A-9, still open).
**Evidence.** PoC `HO-4`: the same signed body is accepted twice.
**Impact.** A captured signature replays for 15 min on the same route (TLS makes capture unlikely; the sensitive route, `position` POST, only discloses the caller's own buffer). Any dapp can present the JSON to a wallet for signing (phishing surface) — action binding limits the blast radius to these routes.
**Recommendation.** Add a `nonce` to the message and a short-TTL `used_nonces` set (Upstash) or accept the residual and document it; migrate to EIP-712 with `{ name: 'Mintware', chainId, verifyingContract: PM }`; compare signed `pool`/`txHash` to the body.

### HO-13 · LOW · `/api/gateway/meta` publishes the server RPC URL
**Where.** `meta/route.ts:57` returns `cfg.rpcUrl` (= `LP_GATEWAY_RPC_URL`). Production returns the public RH testnet URL today.
**Impact.** If the operator ever points `LP_GATEWAY_RPC_URL` at an authenticated provider (Alchemy/QuickNode key in the URL), the key is public. Also couples the browser to the server's RPC (HO-3).
**Recommendation.** Serve a separate `NEXT_PUBLIC_LP_GATEWAY_RPC_URL` for the browser; never echo server env.

### HO-14 · LOW · Deploy/smoke scripts: silent seat fallback and label-keyed pool id
**Where.** `deploy-lp-gateway-robinhood.mjs:95-96` — `GATEWAY_ORACLE_PRIVY_* ?? ROOT_ORACLE_PRIVY_*`; header comments (`:4-16`) still describe the ROOT wallet as the signer. `smoke-lp-gateway-robinhood.mjs:46` reads `ROOT_ORACLE_PRIVY_*` only (so the smoke's `setPaused` passes only if the local env names the gateway wallet as ROOT). `:239` prints `LP_GATEWAY_POOL_ADDRESS = pons-usdg`.
**Impact.** An operator who forgets the `GATEWAY_*` vars deploys a rig owned by the **shared root** with no warning — exactly the coupling A-3 removed. The label convention is the root cause of HO-2.
**Recommendation.** Remove the ROOT fallback (die), print the computed **poolId** as `LP_GATEWAY_POOL_ADDRESS`, make the smoke read `GATEWAY_*`, and assert `PM.owner() == GATEWAY_ORACLE_PRIVY_ADDRESS` post-deploy.

### HO-15 · LOW · Rate limiting inactive; public reads amplify RPC calls
**Where.** `routeHandler.ts:135-167, 228-240` fails open without Upstash (documented as unset in prod — `.claude/rules/security.md`). `position/route.ts` (3 RPC reads per call) and `positions/route.ts` (3 per pool) accept any `?address=`.
**Impact.** Unauthenticated RPC-quota amplification against `LP_GATEWAY_RPC_URL`; if the public RPC throttles, deposit-route receipt verification and `meta` degrade for everyone.
**Recommendation.** Provision Upstash (both var names are already accepted), add `rateLimit` to every public gateway GET, cache `totalShares/totalNav` per block.

### HO-16 · LOW · Cron hygiene (no loss today)
- `deploy.ts:113` executes the zap *before* the L-02 claim (`:136-152`) — two concurrent runs both swap; only one deploys (A-8; inert while the seam returns 0).
- `harvest.ts:137-138` checks `harvest_events.collect_tx` **after** mining a fresh `harvest()` tx — the dedupe can never fire for a retry (each run is a new tx); the real protection is that `harvest()` is idempotent on-chain (a second call collects ~0). A crash between `:119` and `:220` leaves fees in the seat with no `harvest_events` row.
- `discovery.ts:200` `fetch` has no `AbortController` (the sibling `fetchHotPools` has 6 s) — a stalled upstream holds the cron to the platform timeout.
- `deploy.ts:80` `BigInt(env)` on a malformed threshold throws → 500 (fail closed, acceptable) but with no reason code.
**Recommendation.** Claim first, then zap; record a `pending` harvest row before the tx and finalise after; add the timeout; wrap env parsing.

### HO-17 · INFO · Copy vs the hard lines
`V1PoolDetail.tsx:338` "Locks anything? No — withdraw anytime" — with A-1 the contract re-credits shares when the adapter is illiquid (you get what is liquid *now*), and Paxos can freeze/wipe (M-07); say "no lock-up; exit subject to reserve liquidity and issuer controls". `:226` "Fixed wide range … always in range" contradicts the out-of-range banner on the same page (`:195-203`). `:220`/`:361` "Idle in Morpho" — the live rig's yield source is a `MockERC4626` and no Morpho vault has been selected; say "a curated ERC-4626 lending vault (testnet: mock)". `:164` shows "Deposited ✓" regardless of the record result (HO-1). "Net vs your deposit", "your deposit" use *deposit* as the product noun the hard line asks to avoid (the verb on the button is defensible; the noun framing is not). `riskChip` renders "Trust · Low/Med/High" — the disclaimer is present (`:250`) but the chip reads as certification. Positive: "Est. Fee APR · 24h, gross of IL", "an estimate, not a projection", "subject to impermanent loss", "Robinhood Testnet" tags are all present and correct. `ensureChain` (`:107`) hard-codes `chainName: 'Robinhood Chain Testnet'` regardless of `chainId`.

### HO-18 · INFO · Documentation-vs-code — see §7.

### HO-19 · INFO · Dependencies (`pnpm audit --prod`, no fixes applied)
150 advisories / 166 findings in the production tree: **69 High, 86 Moderate, 11 Low**. Direct dependency with fixes available: **`next`** — 12 High/Moderate advisories incl. "Denial of Service with Server Components" (High ×2), "Middleware / Proxy bypass via segment-prefetch routes — incomplete-fix follow-up" (High), "null origin can bypass Server Actions CSRF checks" (Moderate), "XSS with CSP nonces" (Moderate), "HTTP request smuggling in rewrites" (Moderate) → **upgrade Next.js to the patched 16.1.x**. Everything else is transitive: `hono` (27, via `@privy-io/react-auth → x402 → wagmi → porto`), `axios` (28), `undici` (12, via `eas-sdk → hardhat` — a dev toolchain leaking into the prod tree; consider moving `eas-sdk` usage server-only or pruning `hardhat`), `nanoid`/`brace-expansion`/`fast-uri`/`ws`/`js-yaml` (High, transitive). None is on the gateway money path directly; the `next` items are the ones that touch the routes in scope.

---

## 7. Documentation-vs-code discrepancies

| # | Doc | Says | Code / reality |
|---|---|---|---|
| 1 | `.claude/rules/lp-gateway.md:59` | discover cron "scheduled every 3h" | `vercel.json`: `0 5 * * *` (daily). `deployments.md`/`STATE.md` cron tables are correct. |
| 2 | `docs/developers/lp-gateway.md:50-55` | "A pool becomes depositable only once a curator approves it and a gateway is deployed for it" | Every `/earn/<slug>` is `live: true` on the env fallback (HO-2); prod registry is empty. |
| 3 | `lp-gateway-v1-security-review.md` M-04 row; `lp-gateway.md:64` | deposit/withdraw "now require signed-message auth" — fixed | Route yes; the only client never sends a signature → 401 (HO-1). Withdraw route has no caller. |
| 4 | `lp-gateway-testnet-runbook.md:65` | client flow `POST /api/gateway/deposit {address,txHash}` | Documents the unsigned body the route rejects. |
| 5 | `lp-gateway-v1-realfunds-audit-findings.md §8` | A-4 "open (own-funds tolerable)" — ledger "never written" | Also `gateway_positions` unwritten in the product (HO-1); `restake` is the only path where fees reach depositors. |
| 6 | `.claude/rules/lp-gateway.md:63` | route list | omits `alerts`. Migrations list (`:67`) omits `20260907000002/3` (snapshots, alerts). |
| 7 | `.claude/rules/deployments.md` env table | documents `GATEWAY_ORACLE_PRIVY_*`, `LP_GATEWAY_USDG` | ~24 other `LP_GATEWAY_*` vars read by code are undocumented (`CHAIN_ID`, `RPC_URL`, `POSITION_MANAGER`, `STAGING`, `POOL_ADDRESS`, `DEPLOY_*` ×5, `HARVEST_*` ×3, `CURATOR_SECRET`, `CIRCUIT_BREAKER_ENABLED`, `ROUTER_ADDRESS`, `QUOTER`, `SWAP_SLIPPAGE_BPS`, `GT_NETWORK`, `ALERT_DEBOUNCE_SECS`, `PERF_FEE_BPS`). The rule file says this table is the one home for env facts. |
| 8 | `deploy-lp-gateway-robinhood.mjs:2-16` header | "the Privy ROOT server wallet signs every deploy tx … becomes the gateway owner" | Code prefers `GATEWAY_*` and falls back to ROOT silently (HO-14). |
| 9 | `.claude/rules/lp-gateway.md:41-42` | "⚠ The other chat added … `paused` … `compoundQuote` — on their branch, verify before relying" | Both are on this branch, in the ABI, deployed (`deployments.json` note) and smoke-tested — stale caveat. |
| 10 | `lp-gateway-v1-realfunds-audit-findings.md §7.5` | fix plan: cron computes real `minLiquidity` from spot | Not implemented; cron only refuses `0` (HO-8). |
| 11 | `V1PoolDetail.tsx` copy | "Idle in Morpho" | Live rig yield source is `MockERC4626` (`deployments.json`), no Morpho vault chosen. |

`config/deployments.json` (robinhood-testnet rows) matches the smoke script defaults and the prod `meta` response (`0x24ff…3b11`) — **accurate**.

---

## 8. Test & typecheck results

- Existing suites: `npx vitest run lib/gateway lib/web2/routeHandler.test.ts lib/web3/signedActionMessages.test.ts` → **9 files, 61 tests, all green**.
- New PoCs: `npx vitest run lib/gateway/__audit__/hackenOffchain.test.ts` → **8/8 pass** (each pass = finding confirmed: HO-1, HO-2 ×2, HO-3/A-7 hot-swap, HO-12 replay, HO-9 cache, HO-10 free-text, HO-11 status filter). Fully mocked; no network.
- Typecheck: `npx tsc --noEmit -p .tsc-scoped.json` → only the 6 **pre-existing** `lib/gateway/registry.test.ts` mock-typing errors (known); no new errors.
- `pnpm audit --prod` → summary in HO-19.
- Production read-only probes: CSP header on `/earn/pons-usdg`; `GET /api/gateway/meta?pool=definitely-not-a-pool`; `GET /api/gateway/instances`.

---

## 9. Verified sound (traced; no change needed)

- **Bearer auth** (`routeHandler.ts:248-265`): empty secret ⇒ 500 outside dev; constant-time compare; curate C-01 fix (`?? ''`) holds; crons read `CRON_SECRET` at request time.
- **Signed-message binding**: body `issuedAt` must equal the signed `issuedAt`; `action` must match the route; recovered signer must equal `address`; `ctx.user` is the only identity the deposit/withdraw routes trust, and the on-chain `Deposited`/`Withdrawn` event's `user` must equal it (`deposit/route.ts:52`, `withdraw/route.ts:49`).
- **Idempotency**: `gateway_deposit_events UNIQUE(tx_hash)` claimed *before* the basis mutation; `basisMath` pure and tested; shares always synced from chain. `gateway_deploy_events UNIQUE(position_manager, chain_id, window_key)` claimed before `deploy()`; `harvest_events UNIQUE(collect_tx)`.
- **Crons**: `LP_GATEWAY_{DEPLOY,HARVEST}_ENABLED !== 'true'` ⇒ no-op; missing config ⇒ 503; signer failure ⇒ 503 with no tx; `receipt.status` checked after every write; breaker reads `paused` first, never un-pauses, dedicated seat. Deploy refuses `minLiquidity ≤ 0` **before** claiming the window; targets `ratio·NAV − deployed`; the contract independently enforces `MAX_DEPLOY_BPS`.
- **Signer roles**: `gateway` has no shared-key fallback (`oracleKeys.ts:37`); env-key mode throws when unset (fail closed).
- **Data layer**: RLS enabled (no policies ⇒ deny-all) on `gateway_positions`, `harvest_events`, `gateway_instances`, `gateway_pool_requests`, `gateway_deposit_events`, `gateway_deploy_events`, `gateway_position_snapshots`, `gateway_alerts`; all access via the server-only service client (`supabase.ts:29-31` throws in the browser); `numeric(78,0)` for atomic amounts; `ctx.json` BigInt-safe.
- **Injection**: the PostgREST `not in (...)` list in `discovery.ts:272` is built only from `normalizePoolId`-validated hex; `sparkline.ts:12-15` validates ids before URL interpolation (no SSRF via path segment); `safeImg` https-only; `sanitizeLabel` strips control/zero-width chars and caps at 64 (auto path).
- **Swap seams** (`routerSwap.ts`, `v4SwapExec.ts`): return `0n` / no call site until `LP_GATEWAY_ROUTER_ADDRESS` + `LP_GATEWAY_QUOTER` are set; min-out double-enforced; slippage capped at 5000 bps (still too permissive — tighten before wiring).
- **Deploy script preflights**: `getChainId()` match, bytecode presence for PoolManager/PositionManager/Permit2, tick alignment, `adapter.vault()==staging`, `staging.controller()==pm`, yield-source `asset()==quote`; production adapter (A-5) composed; no secret printed.
- **UI**: exact-amount `approve` (no unlimited allowance); withdraw burns a share fraction read from chain; buffer reveal is owner-signed on explicit gesture (L-03); est. APR labelled and IL-qualified.
- **Request-size guard** 256 KB; `X-Request-Id` on every response; unhandled errors ⇒ 500 with message only.

---

## 10. Appendix — checklist coverage

| Area | Checked | Result |
|---|---|---|
| Authn/authz per route | all 12 gateway routes + 4 crons | curate/crons bearer fail-closed ✓; deposit/withdraw/position-POST signed ✓; public GETs intended public ✓ (HO-13 leak) |
| Replay / action binding | routeHandler + 3 message builders | issuedAt+action bound ✓; no nonce (HO-12); signed `pool`/`txHash` unchecked (A-9) |
| Input validation (20/32-byte ids) | discover, sparkline, request, meta, position(s) | auto path ✓; `request` ✗ (HO-10); `sparklines` cache key ✗ (HO-9); slug≠poolId (HO-2) |
| Idempotency | deposit/withdraw/deploy/harvest | ✓ / ✓ / ✓ (claim-after-zap, HO-16) / vacuous dedupe (HO-16) |
| Rate limiting | all | declared on `request` only; inactive in prod (HO-15) |
| Fail-closed posture | crons, signer, curate, verify | ✓ throughout |
| Information leakage | meta, position(s), leaderboard, curate GET | `rpcUrl` (HO-13); cost basis/leaderboard are chain-derivable — acceptable |
| BigInt/JSON safety | ctx.json, numeric(78,0) round-trips | ✓ |
| SSRF / URL handling | GeckoTerminal URLs, RPC | ids validated ✓; network slug env-only ✓; RPC trusted root (noted) |
| CORS / CSP | next.config.mjs | CSP omits RH RPC (HO-3); no CORS headers (same-origin only) ✓ |
| Cron flag gating / signer role / gas / deadline | deploy, harvest, breaker | ✓; global `minLiquidity` (HO-8) |
| RPC lies / lag | verify, deposit receipt, NAV reads | single RPC is a trust root; no cross-check (documented) |
| RLS / service-role | 7 tables | ✓ deny-all |
| Ledger consistency (A-4) | harvest ↔ positions ↔ buffers | ✗ (HO-6, HO-1) |
| Secrets / key mgmt | oracleSigner, oracleKeys, scripts | role isolation ✓; app-secret blast radius (HO-5); script fallback (HO-14) |
| Deploy/ops scripts | chain-id, bytecode, wiring asserts | ✓; label pool id (HO-14) |
| Frontend trust | meta → PM, usdg | trusts env fallback (HO-2/HO-4); CSP-blocked RPC (HO-3) |
| Copy vs hard lines | Discover, PoolDetail, Portfolio | HO-17 |
| Docs vs code | 6 docs | 11 discrepancies (§7) |
| Dependencies | `pnpm audit --prod` | HO-19 |

---

*Status legend:* **CONFIRMED** = reproduced by PoC, production read-only GET, or an unambiguous code path; **THEORETICAL** = depends on configuration not inspectable from the repo. This document is an internal review, not an external audit, and does not change the standing posture: **external audit gates real value.**
