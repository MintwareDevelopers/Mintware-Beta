# LP Gateway V1 — Off-chain / Ops / Key-management Red-Team (2026-09-08)

> Scope: Next.js routes (`app/api/gateway/*`, `app/api/(rewards)/cron/gateway-*`), `lib/gateway/*`,
> `lib/web2/routeHandler.ts`, `lib/web3/{oracleSigner,oracleKeys}.ts`, the Sept-2026 migrations, the deploy +
> smoke scripts, the V1 UI (`components/web2/v1/*`, `app/earn/[pool]`, `app/curate`), `vercel.json`, deps.
> Branch `fix/lp-gateway-realfunds-audit`. No src modified; no on-chain txs; production touched with read-only
> GETs only. **PoCs:** `lib/gateway/__audit__/redteamOffchain*.test.ts` (35 assertions, all green =
> weakness reproduced) — run `bash -c 'npx vitest run lib/gateway/__audit__'`. A parallel pass landed
> `hackenOffchain.test.ts` (HO-1…HO-7) in the same dir mid-session; where it overlaps I cite both.
> Baseline: [`../lp-gateway-v1-realfunds-audit-findings.md`](../lp-gateway-v1-realfunds-audit-findings.md) (A-4, A-7 open).

## 1. Executive summary

**Prod as observed (read-only GETs, 2026-09-08):** `gateway_instances` is empty; every `?pool=` resolves to the
single-env fallback PM `0x24ff…3b11` (`poolAddress:"pons-usdg"`, `live:true`); `meta.usdg` is `null`, so the UI's
deposit button refuses ("isn't live") — the product is currently **deposit-dead in prod by accident of env**, which
is also what neutralises R-1 today. Cron + admin routes answer 401 (bearer holds). Harvest/deploy crons are not in
`vercel.json`; they run only if someone calls them with `CRON_SECRET`.

**Worst realistic outcome — own funds (operator is the only depositor):** no unprivileged path moves or freezes
your principal. The realistic losses are (a) a **Vercel env dump**: `PRIVY_APP_SECRET` + the wallet ids controls
*every* Privy seat — the "dedicated gateway seat" separates *addresses*, not *credentials* — giving deploy-into-a-
pumped-pool (bounded by `MAX_DEPLOY_BPS`=50% NAV + band) plus 100% of fees plus deposit-pause griefing; (b) a
leaked `LP_GATEWAY_CURATOR_SECRET` (typed into a public web page at `/curate`) lets anyone hot-swap the deposit
target of an active pool to a lookalike contract (R-2) — total theft of *new* deposits, existing principal safe.

**Worst realistic outcome — third-party funds:** (1) **R-1 deposit misrouting** — with ≥2 pools registered, a user
on `/earn/<pool-they-chose>` deposits into the fallback rig because the UI slug never matches the registry key
and `live:true` is hard-coded; funds are in a Mintware PM but the *wrong pool* (wrong IL/risk profile, wrong
position page). (2) **R-3 (A-4 exploited)** — the UI never records deposits (401) or withdraws (no call), so the
DB ledger is stale-by-design; once buffers are linked, a withdrawn wallet keeps 50% of another LP's fee income and
the card rail authorizes swipes against that phantom balance. (3) **R-2** as above. Nothing reads on-chain
`sharesOf` for weighting; nothing verifies `factory.instanceForPool`.

Verdict: the money-path defenses that exist (bearer fail-closed, on-chain event trust anchor, tx-hash idempotency,
gateway-seat no-fallback, RLS deny-all) hold. The open surface is **routing + ledger + credential blast radius**,
not signature/auth math. Gate third-party funds on R-1, R-2, R-3.

## 2. Attack matrix

| # | Scenario | Result | Sev (impact / likelihood) | Evidence | Fix (one line) |
|---|---|---|---|---|---|
| R-1 | Deposit misrouting: unknown/label `pool` → env fallback PM, `live:true` hard-coded; inactive rows also fall back; Discover `live` ignores `status` | **EXPLOITABLE** (prod-verified; deposits currently blocked only by `usdg:null`) | High / High once ≥2 pools live | `registry.ts:110-123`, `meta/route.ts:477`, `discover/route.ts:299-303`, `V1Discover.tsx:40`, `V1PoolDetail.tsx:64,114`; PoC `redteamOffchainRouting` ×3, HO-2, HO-7; live `GET /api/gateway/meta?pool=nonexistent-pool` | Registry-miss ⇒ 404 (no fallback when registry non-empty); key instances by poolId AND slug; `live` = registry hit && status active |
| R-2 | A-7 deepened: lookalike PM echoing `quoteAsset()/poolKey()` passes H-01; `registerInstance` upserts over an ACTIVE row; `staging` unverified; quote asset checked vs curator input not `LP_GATEWAY_USDG`; hooked key accepted; secret typed into a public page | **EXPLOITABLE** given `LP_GATEWAY_CURATOR_SECRET` | Critical impact (all new deposits) / Medium (single static bearer, browser-entered) | `registry.ts:59-105,175-221`, `curate/route.ts:102-149,153`, `app/curate/page.tsx:36-56`; PoC `redteamOffchainRegistry` ×4, HO-3 | Require `factory.instanceForPool(poolId) == {pm, staging, active}`; refuse upsert on active row; compare quote to env USDG; reject `hooks≠0`; curator = signed-message allowlist, not a shared bearer |
| R-3 | A-4 exploited: harvest weights by DB shares; UI deposit POST lacks signature (401) and withdraw never records → ledger stale by default; linked buffer is card-authorizable; non-atomic RMW vs `bufferMonitor` overwrite | **EXPLOITABLE** when `LP_GATEWAY_HARVEST_ENABLED` + a `gateway_position_id` link exist (both absent today) | High (third-party) / Low today, High when linked | `harvest.ts:181-215`, `V1PoolDetail.tsx:131-132,154-158`, `cardAuthorize.ts:164-177`, `bufferMonitor.ts:78-81`; PoC `redteamOffchainHarvest` ×2 (4.5 USDG to a 0-share wallet), HO-1 | Event-indexed, on-chain-`sharesOf`-weighted, atomic credit ledger in its own table; UI must sign + call both record routes; never credit a buffer the card rail reads |
| R-4 | Feed poisoning: attacker-steerable risk score (0 = "Low"), APR inflation via name suffix, https tracking pixel, USDG-by-name when env unset, prune evicts every legit auto candidate, no fetch timeout in cron | **EXPLOITABLE** (availability/integrity of the curator queue; human approve still gates money) | Medium / Medium | `discovery.ts:108,120-122,44-47,268-283,201`; PoC `redteamOffchainDiscovery` ×6 | Set `LP_GATEWAY_USDG` in prod; pin `img-src` to GT/CoinGecko CDNs; cap `feePct`≤10 & APR display; prune only rows older than N runs; add AbortController to cron fetch |
| R-5 | Public-route DoS: `/sparklines` = 16 GT requests per call, any 64-hex id, no rate limit, unbounded cache Map → GT 429 → Discover blank; `/request` free-text 100 KB `pool_address`, limiter fails open (no Upstash) | **EXPLOITABLE** | Medium (product blank) / High (trivial) | `sparklines/route.ts:750-764`, `sparkline.ts:538-547`, `request/route.ts:709-737`, `routeHandler.ts:135-167`; PoC `redteamOffchainPublicRoutes` ×2, HO-5, HO-6 | Set Upstash/KV env (limiter becomes real); validate `pool_address` as 20/32-byte hex; LRU-cap the cache; only serve sparklines for ids in the last Discover set |
| R-6 | Signed-message: `txHash`/`pool` in the signed payload not compared to body; no nonce → 15-min replay | **MITIGATED in effect** (event `user==signer`, `receipt.to==PM`, UNIQUE tx_hash) — Low | Low / Medium | `deposit/route.ts:177-217`, `routeHandler.ts:292-307`; PoC `redteamOffchainSignedAuth` ×2, HO-4 | Rebuild the exact message server-side and strict-compare (the "gold standard" the rules already prescribe) |
| R-7 | Leaderboard inflation: deposit→withdraw(unrecorded)→repeat ⇒ Σ`entry_nav` unbounded on fixed capital | **EXPLOITABLE** (Season-0 reputational) | Low / High | `leaderboard/route.ts:362-381`, `basisMath.ts:7-10`; PoC `redteamOffchainRouting` "ledger drift" | Rank by on-chain `sharesOf`×NAV, not DB basis |
| R-8 | Keys/env: `PRIVY_APP_SECRET` is one credential for all seats; `ORACLE_SIGNER_PROVIDER` is a global switch (typo ⇒ raw-key mode for gateway); `range`/`agent` still fall back to `ORACLE_PRIVATE_KEY` (git-exposed); deploy script falls back to ROOT ids; smoke uses ROOT only | **THEORETICAL → ops risk** (gateway role itself fails closed: MITIGATED) | High impact / Low likelihood | `oracleSigner.ts:49-57`, `oracleKeys.ts:36-42`, `deploy-lp-gateway-robinhood.mjs:95-96`, `smoke-…mjs:48`; PoC `redteamOffchainKeys` ×4 | Privy **authorization keys / policies** per wallet (second factor Vercel can't leak); assert `ORACLE_SIGNER_PROVIDER==='privy'` at boot in prod; delete `ORACLE_PRIVATE_KEY` from every env; drop the ROOT fallback from the script |
| R-9 | Cron/curator bearer: unset secret ⇒ 500 in prod, but `NODE_ENV=development` ⇒ no-auth pass-through (approve/register on a dev box) | **MITIGATED (prod)** / Low (dev) | Low | `routeHandler.ts:253-264`; PoC `redteamOffchainSignedAuth` bearer ×3; prod probes 401 | Remove the dev bypass for money-adjacent routes or require an explicit `ALLOW_DEV_NOAUTH=1` |
| R-10 | Cron abuse: window-claim after zap (inert), breaker pause needs 2 daily runs out of range (≈10× price move) and never auto-unpauses (griefing, flag OFF), harvest idempotency vacuous, RPC trusted blindly (chain id never checked in app), `meta.rpcUrl` leaked to browser | **THEORETICAL** | Low | `deploy.ts:143-165`, `circuitBreaker.ts`, `alerts.ts:599-602`, `chain.ts:44-46`, `meta/route.ts:471` | `getChainId()` preflight in `gatewayPublicClient`; move the claim before the zap; never emit an RPC URL with a key |
| R-11 | Deploy/ops scripts: `LP_GATEWAY_YIELD_SOURCE` only `asset()`-checked (malicious 4626 accepted); smoke `die()` between `setPaused(true/false)` leaves deposits paused; partial deploy leaves unwired rig (asserted post-wire, good) | **THEORETICAL** (operator-only inputs) | Low | `deploy-…mjs:147-160`, `smoke-…mjs:98-110` | Allowlist the 4626 source address; `try/finally` unpause in smoke |
| R-12 | Supply chain: `pnpm audit --prod` = 166 (69 high) — all 13 high pkgs sit under `eas-sdk→hardhat`, `@metamask/sdk`, `@privy-io/react-auth`, `@lifi/widget`, `next→sharp`; none in the gateway server path; no `postinstall`; lockfile present | **THEORETICAL** | Low | audit output; `package.json` | Move `eas-sdk` (drags hardhat) to a server-only import or drop; enable `pnpm install --frozen-lockfile` explicitly; Dependabot on high |

## 3. Detailed write-ups (EXPLOITABLE)

### R-1 · Deposit misrouting via the silent single-env fallback
`resolveRouteInstance` (`lib/gateway/registry.ts:110-123`) looks up `gateway_instances.pool_address == pool.toLowerCase()`
and, on *any* miss (unknown string, inactive row, label vs poolId mismatch), returns `cfg.positionManager` from env.
`/api/gateway/meta` then returns that PM with `live: true` unconditionally (`meta/route.ts:477`). The UI builds its
slug from the GeckoTerminal pair label (`V1Discover.tsx:40` → `"meme-usdg"`) while the registry is keyed by the 32-byte
v4 poolId (curate writes `request.pool_address`), so **no `/earn/[pool]` page can ever hit the registry**; every
page advertises the fallback rig and `V1PoolDetail.deposit()` approves + deposits into it (`:125-128`). Discover
additionally marks pools "Live" from `gateway_instances` without a `status` filter (`discover/route.ts:299-303`), so a
deactivated pool is advertised as live and then routed to the fallback. Live check: `GET /api/gateway/meta?pool=
nonexistent-pool` → `{positionManager:"0x24ff…3b11", poolAddress:"pons-usdg", live:true, usdg:null}`.
**Today** deposits are blocked because `LP_GATEWAY_USDG` is unset (`!meta.usdg`) — an accident, not a control.
**Severity:** High once a second pool is registered (a phishing link `/earn/<any>` or simply the real Discover row
sends capital into a pool the user didn't choose). Funds stay in a Mintware PM (not theft), but the user holds a
position in the wrong pool with a different IL profile and the DB records `pool_address:"pons-usdg"` against it.
**Fix:** when the registry has ≥1 active row, a miss is a 404 and `live:false`; store a `slug` column (unique per
chain) and resolve by slug **or** poolId; compute `live` from an active registry hit; set `LP_GATEWAY_USDG`.

### R-2 · A-7 deepened: lookalike PM + active-row hot-swap = theft of all new deposits (curator-secret gated)
`verifyInstanceOnChain` proves only that the candidate *says* it fronts the pool (`registry.ts:72-104`). A 40-line
contract with `quoteAsset()`/`poolKey()` view echoes and a `deposit(uint256)` that `transferFrom`s the caller's USDG
to the attacker passes (PoC "verifyInstanceOnChain returns ok for a contract that merely echoes"). It also passes with
a *fake* quote token (the expected quote is the curator body's `instance.quoteAsset`, never `LP_GATEWAY_USDG`) and with
a hooked pool key. `registerInstance` then **upserts on `(pool_address, chain_id)`** with `status:'active'`, so an
existing live pool's PM/staging are replaced with no read-before-write, no history, no "already active" guard (PoC
"registerInstance UPSERTS…"; HO-3). The UI's approve calls (`meta` → `positionManager`) and the deposit route's
`receipt.to` check both follow the new row, so the swap is self-consistent end-to-end: every subsequent depositor
approves real USDG to the hostile PM and calls its `deposit`. The gate is a single static bearer
(`LP_GATEWAY_CURATOR_SECRET`) that is **entered into a public web page** (`app/curate/page.tsx:36-56`, kept in React
state, sent from the browser) — phishable, shoulder-surfable, and an XSS anywhere on the origin reads it.
**Severity:** Critical impact / Medium likelihood → **High**. Existing principal in the real PM is untouched.
**Fix:** (1) require `factory.instanceForPool(computePoolId(poolKey))` to return `{positionManager==candidate,
staging==supplied, active}` (the factory is `onlyOwner` and deploys audited bytecode — that is the real trust
root); (2) refuse `registerInstance` when an active row exists (explicit `deactivate` step); (3) compare the quote
asset to `LP_GATEWAY_USDG`; (4) reject `hooks != 0`; (5) replace the bearer with signed-message auth from an
allowlisted curator wallet + keep an append-only `gateway_instance_history`.

### R-3 · A-4 exploited end-to-end: stale DB shares steal fee income; the IOU is card-authorizable
`harvestGateway` (`harvest.ts:181-215`) weights credits by `gateway_positions.shares` from the DB and never reads
`sharesOf` (PoC asserts `readContract` was never called with `sharesOf`). Those rows are written only by
`/api/gateway/{deposit,withdraw}` — and the shipped UI **cannot** write them: `V1PoolDetail.deposit()` POSTs
`{address, txHash, pool}` with no `authMessage/authSignature/issuedAt` (`:131`) → 401 `AUTH_REQUIRED` (HO-1), and
`withdraw()` never calls the record route at all (`:154-158`). So the ledger is not "occasionally stale", it is
**structurally unsynced**. PoC: Alice withdraws 100% on-chain (sharesOf=0) but keeps a DB row of 1000 shares; on a
10 USDG harvest she is credited **4.5 USDG** into `card_spend_buffers` and Bob (the only real LP) is short-changed 50%.
Does anything pay from that buffer? **Yes**: `lib/org/cardAuthorize.ts:164-177` (`CARD_BUFFER_ENABLED`) authorizes card
swipes via `reserve_card_buffer` against `buffer_balance_atomic` — while the harvested USDG actually sits in the
seat wallet (`harvestRecipient`), not in any buffer wallet. `bufferMonitor.syncBufferBalance` then overwrites the
balance from chain (`bufferMonitor.ts:78-81`), erasing the credit (second PoC). Today: `gateway_position_id` is never
set (card_spend_buffers requires an `org_card_id`), harvest is OFF, so **inert**; it becomes live money the moment
either an org card is linked or harvest is enabled with third-party depositors.
**Fix:** dedicated `gateway_fee_credits` table keyed `(collect_tx, log_index, user)`, weights from a multicall of
`sharesOf` at the harvest block, atomic `FOR UPDATE` RPC; the card rail must never read a gateway IOU; the UI must
sign (`buildGatewayDepositMessage/WithdrawMessage`) and call both routes; a reconciler cron compares DB vs chain.

### R-4 · Curator-queue poisoning / eviction from GeckoTerminal
All inputs to `computeRisk` and `estFeeAprPct` come from the upstream JSON (`discovery.ts:97-160`). PoCs: a fake pool with
$200k reported TVL / 30d age / 1000 tx scores **0 → "Low"** (green chip on Discover + detail); `name:"MOON / USDG 99%"`
with `reserve_in_usd:"1"` renders an APR > 1e13 %; `safeImg` accepts any https URL (tracking pixel; CSP `img-src https:`);
with `LP_GATEWAY_USDG` unset (prod), USDG-quotedness is decided by the **name regex** — any "X / USDG" pool is eligible;
30 attacker pools in the top-30 **prune every legitimate auto candidate** (`pruned=1`, legit row gone) while manual spam is
never pruned; the cron `fetch` has no timeout. The human approve still gates money, so this is queue integrity + UX
deception, not theft. Fix per matrix.

### R-5 · Public-route DoS with the limiter failing open
`/api/gateway/sparklines` accepts up to 16 arbitrary 64-hex ids and fans out one GeckoTerminal request each, no auth, no
rate limit, cache keyed by the attacker-chosen id-set with no eviction (`sparklines/route.ts:750`). GT's free tier is
~30 req/min, so two calls/minute with fresh junk ids starve `fetchHotPools` (which returns `[]` on `!res.ok` and caches
that for 3 min) → Discover shows "No pools match yet" for everyone. `/api/gateway/request` declares `{max:5/min}` but
`getRedis()` finds no Upstash/KV env → `rl === null` → 20 spam inserts of 100 KB `pool_address` in a row succeed (PoC).
Fix: set the Redis env (turns every declared limit on), validate ids/lengths, LRU-cap caches.

### R-7 · Leaderboard inflation
`Σ entry_nav` is additive per recorded deposit and only reduced by the withdraw route the UI never calls → 5 cycles of
the same 1,000 USDG rank as 5,000 (PoC). Season-0 disclaimer says standings may reset; still a cheap integrity hole.

## 4. Notable MITIGATED items (and why the defense held)

- **Cron/curator/admin bearer** — constant-time compare, `''` secret ⇒ 500 `MISSING_SECRET` in prod (not pass-through);
  live probes: `/api/cron/gateway-{harvest,deploy}` 401, `/api/oracle/signer-check` 401. Only the `NODE_ENV=development`
  bypass remains (R-9).
- **Deposit/withdraw record trust anchor** — `receipt.status`, `receipt.to == registered PM`, event decoded only from
  the PM's address, `event.user == recovered signer`, `sharesOf` read from chain, `UNIQUE(tx_hash)` claimed *before*
  the basis mutation. A captured signature can only record the victim's own txs (R-6 is Low for this reason).
- **Signed-message replay guards** — `issuedAt` and `action` are bound to the signature (cross-route/cross-action replay
  fails); every gateway signed route passes `action:`.
- **Gateway signer seat** — `oracleKeys.gateway` has no fallback and throws; `deploy/harvest/circuitBreaker` all resolve
  `'gateway'`, never `'root'`. Deploy cron refuses `minLiquidity=0` before the window claim.
- **Swap seams** — `routerSwap` / `v4SwapExec` return 0 and the zap failure fails deploy closed; no call site for
  `executeV4Swap`.
- **RLS** — all five gateway tables `enable row level security` with no policies (deny-all); browser never reads them.
- **Untrusted-input coercion** — `safeNum`, `sanitizeLabel` (control chars, 64 cap), `normalizePoolId` (20/32-byte
  hex only) → no NaN/Infinity, no path injection into the GT URL, no non-https `<img src>`; React escapes labels
  (no XSS found); `ctx.json` is BigInt-safe everywhere (no 500s from bigint payloads).
- **Discover prune** only runs when `kept>0` (a GT blip can't wipe the queue — a *hostile* 30 can, R-4).
- **Deploy script** — chain-id + bytecode preflights, post-wire assertions (`adapter.vault==staging`,
  `staging.controller==pm`), yield-source `asset()` check; Privy-only (no raw key).

## 5. Residuals for ops

**Monitoring.** Alert on: any `gateway_instances` row change (diff PM/staging vs `factory.instanceForPool`); harvest
`amount_credited_atomic` vs Σ on-chain `sharesOf` divergence; `/api/gateway/meta` responses whose `positionManager`
equals the env fallback while the registry is non-empty; GeckoTerminal 429s (Discover going blank); `[routeHandler]
rate limiter INACTIVE` in Vercel cold-start logs (it is, today); `paused()==true` on any PM (smoke/breaker griefing).

**Key ceremony.** `PRIVY_APP_SECRET` is the whole kingdom — enable Privy **authorization keys/policies** per server
wallet (a signer Vercel never holds), scope the gateway wallet's policy to `deploy/harvest/setPaused` on allowlisted
PMs only; assert `ORACLE_SIGNER_PROVIDER==='privy'` at boot in prod (fail the deploy otherwise); purge
`ORACLE_PRIVATE_KEY`/`DISTRIBUTOR_PRIVATE_KEY` from every Vercel env (range/agent still fall back to them); remove the
ROOT fallback from `deploy-lp-gateway-robinhood.mjs`; rotate `LP_GATEWAY_CURATOR_SECRET` and stop entering it in a
browser — use signed-message auth from an allowlisted curator wallet.

**Allowlists.** Deposit target = `factory.instanceForPool` only (no env fallback once the registry is populated);
quote asset = `LP_GATEWAY_USDG` (set it in prod — it is `null` there); `img-src` = GT/CoinGecko CDNs; sparklines
only for ids in the current Discover set; `LP_GATEWAY_YIELD_SOURCE` from a pinned list; never wire
`card_spend_buffers` to gateway credits until the A-4 ledger exists.

**Before third-party funds:** R-1, R-2, R-3 fixed + UI signs and records both routes + Upstash set + external audit
(unchanged from the baseline verdict).
