# Closeout record — discovery hygiene, public-route abuse, dev bypass, deps, docs drift

**Scope:** round-2 audit ([`../2026-09-08-consolidated.md`](../2026-09-08-consolidated.md)) §3 items **O-7, O-8, O-12,
O-13, O-14** + the off-chain reports' R-4, R-5, HO-9/HO-11/HO-15/HO-16 (discover half), HO-19, §7 docs-vs-code.
**Branch:** `feat/lp-gateway-audit-closeout` · **Date:** 2026-09-08 · **Author:** Fable 5.1 (discovery-hygiene agent).
**Files owned/touched:** `lib/gateway/{discovery,riskScore,sparkline}.ts` (+tests), `app/api/gateway/{discover,sparklines}/route.ts`
(+tests), `app/api/(rewards)/cron/gateway-discover/route.ts` (+test), `lib/web2/routeHandler.ts` (dev-bypass + boot log only,
+ `routeHandler.bearerBypass.test.ts`), `lib/gateway/__audit__/redteamOffchainDiscovery.test.ts` (flipped to post-fix),
`package.json` + `pnpm-lock.yaml` (`next` only), `.claude/rules/{lp-gateway,deployments}.md`, `docs/developers/{lp-gateway,lp-gateway-testnet-runbook}.md`.
**Not touched (other agents):** registry/harvest/deploy, deposit/withdraw/meta/position/request routes, components, contracts,
`__audit__/hackenOffchain.test.ts`, `__audit__/redteamOffchainPublicRoutes.test.ts`.

**Verification commands** (all green unless stated): `bash -c 'npx vitest run lib/gateway/riskScore.test.ts lib/gateway/discovery.test.ts
lib/gateway/sparkline.test.ts app/api/gateway/sparklines/route.test.ts app/api/gateway/discover/route.test.ts
"app/api/(rewards)/cron/gateway-discover/route.test.ts" lib/web2/routeHandler.bearerBypass.test.ts
lib/gateway/__audit__/redteamOffchainDiscovery.test.ts lib/web2/routeHandler.test.ts'` → **9 files / 92 tests pass**
(riskScore 12 · discovery 35 · sparkline 10 · sparklines route 4 · discover route 3 · cron 8 · bearerBypass 5 ·
redteam-discovery 6 · routeHandler 9);
scoped `tsc --noEmit` over every owned file → clean.

---

## O-7 · Feed poisoning via GeckoTerminal (R-4, HO-16 discover half) — FIXED

| Sub-item | Files | Change | Verification |
|---|---|---|---|
| Risk score steerable by free text | `lib/gateway/riskScore.ts` | Scorer inputs are numeric/enum only (it never received text, but nothing bounded them). Added `normalizeSignals` + `SIGNAL_BOUNDS`: every numeric clamped (NaN → min edge, ±Infinity → matching edge), `volTvlRatio` recomputed from the clamped legs, protocol/quote flags coerced. New bounded signals: `feePct` (>3% ⇒ +10 "unusual fee tier") and `tokensResolved` (both legs 20-byte addresses, else +10). `usdgQuoted` is now `boolean \| null` — `null` (unknown) ⇒ ineligible. | `riskScore.test.ts` (12): bound clamps, 1e300 volume, garbage enums, unknown-quote ineligible; `discovery.test.ts` "renaming the pool / symbols / logo URLs cannot move the score". |
| Est. APR inflation via name suffix | `discovery.ts` `parseFeePct` / `estimateFeeAprPct` | Fee tier: the pool's own field (`pool_fee_percentage` / `fee_percentage` / `fee_tier`) wins when present; a present-but-insane field ⇒ unknown (no fallback to the name); the name suffix is accepted only when `0 < fee ≤ MAX_FEE_PCT (10)`. Est. APR ⇒ `null` (UI "n/a") when the tier is unknown, TVL < `$1,000`, or result > `10,000%`. | `discovery.test.ts` "fee tier + est. APR are bounded" (3), red-team PoC re-run: `MOON / USDG 99%` at $1 TVL → `feePct null`, `estFeeAprPct null` (was 1e13 %). |
| Any-https tracking pixel | `discovery.ts` `safeImg` | Parses with `URL`; requires `https:`, no credentials, no whitespace/quotes/angle brackets, ≤ 2 KB, and host ∈ `IMG_HOST_ALLOWLIST` (`assets.geckoterminal.com`, `coin-images.coingecko.com`, `assets.coingecko.com`) or suffix `.geckoterminal.com` / `.coingecko.com`. Else `null` → UI initials. | `discovery.test.ts` "safeImg" (3): lookalike hosts, http, creds, data:/javascript:, over-long all dropped; CDN logos pass. |
| USDG matched by NAME when env unset | `discovery.ts` `poolToCandidate` / `resolveUsdg` | **Address-only.** `usdgAddress` must be a 20-byte hex (invalid ⇒ treated as unset). Unset ⇒ `usdgQuoted: null` ⇒ `computeRisk` returns `ineligible` with reason `quote asset unknown — LP_GATEWAY_USDG unset (fail-closed)`; `fetchHotPools` / `discoverAndIngest` log one `warn` per call. `/api/gateway/discover` returns `usdgConfigured:false`. The name regex is gone. | `discovery.test.ts` O-7 block (name never matches; spoofed name with foreign quote address ⇒ false), `fetchHotPools` unset-warns, `discoverAndIngest` unset ⇒ ingests nothing/prunes nothing. |
| Prune evicts legit candidates | `discovery.ts` `discoverAndIngest` / `pruneGraceMs` | Only auto+pending rows for the chain, not in the current list, **and** unseen for `LP_GATEWAY_DISCOVER_PRUNE_GRACE_HOURS` (default 72 h) are deleted (per-row delete re-filtered on `status='pending' AND source='auto'`). Anchor = `hotness.lastSeenAt` (now stamped on every ingest/refresh; the table has no `updated_at`) else `created_at`; **no anchor ⇒ never evicted**. `approved`/`rejected`/`manual`/other-chain rows are never candidates. A failed/malformed upstream read prunes nothing (`kept.length === 0`). | `discovery.test.ts` "prune safety" (6) incl. the 30-attacker-pool eviction PoC (legit row survives), env-tunable grace, failed-read leaves queue untouched; flipped `__audit__/redteamOffchainDiscovery.test.ts`. |
| No fetch timeout in the cron | `discovery.ts` `fetchGtPools` | One shared upstream reader for both paths: `AbortController` **8 s** (`GT_FETCH_TIMEOUT_MS`), **2 bounded retries** (`GT_FETCH_RETRIES`, backoff 250 ms × attempt) on network/timeout errors and 5xx only — **never** on 429/4xx (no rate-limit amplification); a 200 with non-JSON body ⇒ `malformed_payload`, no retry. Network slug env is shape-checked (`gtNetwork`). Never throws. | `discovery.test.ts` "fetchGtPools" (5): signal passed, 503→503→200 succeeds in 3, exhaustion, 429 single attempt, non-JSON, abort at timeout (<2 s). |
| Cron must survive a malformed payload | `discovery.ts` `validateGtPayload`; `cron/gateway-discover/route.ts` | `data` must be an array (non-object entries dropped), `included` likewise; `poolToCandidate` tolerates non-object `attributes`/`relationships`/ids. Cron returns 200 `{…, upstream:'error'}` (never 500) and logs a warn. Comment now states the real schedule (daily 05:00 UTC). | `cron/gateway-discover/route.test.ts` (8): 5 malformed shapes + thrown fetch ⇒ 200, queue untouched; bearer 401; unset secret ⇒ 500. |

**Residuals (honest):** (1) the scorer's *numbers* (TVL / age / tx count / volume) are still upstream-asserted — a wash-traded
fake pool with perfect metrics scores 0. Not fixable off-chain without on-chain reads; mitigated by the verdict never exceeding
`'review'` (human gate). **The UI chip (`Trust · Low`) must not read as certification — components owner.** (2) Whether
GeckoTerminal actually returns a pool fee field for RH-chain v4 pools is unverified offline; the code accepts three plausible
keys and otherwise relies on the bounded name suffix. (3) **Ops action required:** `LP_GATEWAY_USDG` is unset in prod (audit
HO-2 evidence) — with this change the live Discover feed and the curator queue are **empty until it is set** (fail-closed by
design). Set it before merging to `main` or accept the empty feed. (4) `hotness.lastSeenAt` is only stamped from this commit
on; legacy auto rows fall back to `created_at` (may be pruned on the first post-deploy run if >72 h old and absent — harmless,
they re-appear when re-seen).

## O-8 · Public-route abuse (R-5, HO-9, HO-15) — FIXED for the routes I own; partially delegated

| Sub-item | Files | Change | Verification |
|---|---|---|---|
| `/sparklines` fan-out amplifier | `lib/gateway/sparkline.ts`, `app/api/gateway/sparklines/route.ts` | `MAX_POOLS` **16 → 12** per request; ids validated (20/32-byte hex) **before** keying (`normalizeIds`, `validId`); over-long `?pools=` (>4 KB) ⇒ 400; zero valid ids ⇒ 400 `INVALID_IDS`; extra ids dropped with `truncated:true` + `maxIds` in the response. Cache is now **per id**: `LruCache` (500 entries, TTL 15 min for a series, **5 min for a remembered miss** so junk-but-valid ids can't be replayed for free) + **in-flight coalescing** (N concurrent callers for one id = 1 upstream call). OHLCV parsing tolerates malformed shapes. | `sparkline.test.ts` (10): cap, validation, LRU eviction/TTL, remembered miss, coalescing, bounded growth; `sparklines/route.test.ts` (4): junk ⇒ 400 + 0 upstream, cap/truncation + per-id hits, 429 floor, empty list. |
| 429 without Upstash | `sparkline.ts` `createTokenBucket`; both routes | In-memory per-IP token bucket (LRU-bounded 5,000 keys) as the floor: sparklines 20 burst / 20 per min, discover 30 burst / 30 per min; returns `{success:false,error:'Too many requests',code:'RATE_LIMITED'}` 429 (same shape as `createHandler`). Per-instance only — Upstash remains the cross-instance limiter. | route tests: 429 appears within the burst; other IP unaffected. |
| Every gateway public route declares `rateLimit` | `discover`, `sparklines` routes | Both now declare `rateLimit: {max:60, windowMs:60_000}` (live once Redis env is set). **Delegated:** `instances`, `position`, `positions`, `leaderboard`, `meta`, `alerts` do not (their owners — HO-15). | grep `rateLimit` in `app/api/gateway/*/route.ts`. |
| Boot log when Upstash missing | `lib/web2/routeHandler.ts` | `getRedis()` is invoked once at module load (skipped under Vitest) so the cold-start log always carries `[routeHandler] rate limiting INACTIVE — … Every declared \`rateLimit\` is a NO-OP (fails OPEN); only routes with an in-memory floor still throttle.` Previously it only fired lazily when the first `rateLimit` handler was built. | manual: import the module with no Redis env. |
| `/api/gateway/request` body cap / free text (HO-10) | — | **Not mine — the registry agent's** (`request/route.ts`). `normalizePoolId` + `sanitizeLabel` are exported from `discovery.ts` for reuse. | — |
| Discover `live` ignores status (HO-11) | `discover/route.ts` | `.eq('status','active')` on the `gateway_instances` read; concurrent cold-cache refreshes coalesce into one upstream read. | `discover/route.test.ts` (3). |

**Residuals:** the floor is per serverless instance (an attacker spread across instances still needs Upstash to be stopped —
**set `UPSTASH_REDIS_REST_URL/_TOKEN` in prod**). `V1Discover.tsx` sends all pool ids in one call; with the 12-id cap it will get
sparklines for the first 12 rows only until it batches (`truncated:true` is returned) — **components owner**.

## O-12 · `NODE_ENV=development` bearer bypass — FIXED

`lib/web2/routeHandler.ts` (bearer branch only): an unset/empty secret now fails **closed everywhere** (500 `MISSING_SECRET`)
unless `NODE_ENV === 'development'` **and** `ALLOW_DEV_BEARER_BYPASS === 'true'` — an explicit, logged (warn per request)
opt-in that is ignored in production/test. Covers the curate route's `bearerSecret: process.env.LP_GATEWAY_CURATOR_SECRET ?? ''`
pattern (empty string ⇒ closed). Verification: `lib/web2/routeHandler.bearerBypass.test.ts` (5) + the existing
`routeHandler.test.ts` (unchanged, green) + cron route test "unset secret ⇒ 500". Documented in `deployments.md`.

## O-13 · Dependencies — `next` upgraded 16.1.6 → **16.2.12** (exact)

`pnpm audit --prod` (2026-09-08, before): **166 findings — 69 high / 86 moderate / 11 low**; 28 advisories on `next` (5 fixed at
≥16.1.7, the rest — incl. every High: DoS with Server Components ×2, Middleware/Proxy bypass ×5, SSRF ×2, Server Actions DoS —
fixed at ≥16.2.3…16.2.11). The latest 16.1.x (16.1.7) closes only 5 of 28, so the upgrade went to **16.2.12** (latest 16.2 patch;
closes all 28; 16.3.4 exists but adds a minor with no further advisory fixes). Major unchanged; `react`/`react-dom` 19.2.4 peers
satisfied; lockfile has no `16.1.6` reference. Remaining advisories are transitive (`hono` via privy→x402→wagmi→porto, `axios`,
`undici` via `eas-sdk → hardhat` — a dev toolchain in the prod tree, `nanoid`/`ws`/…) — none on the gateway server path.
**Build proof:** see the "Build" section at the end (filled from the actual run).

## O-14 · Docs vs code (24 items) — reconciled where the doc is mine

| # (Hacken §7) | Doc | Fix |
|---|---|---|
| 1 | `.claude/rules/lp-gateway.md` "discover every 3h" | Cron truth from `vercel.json`: `discover` daily `0 5 * * *`, `snapshot` daily `0 6 * * *`; **harvest/deploy NOT scheduled**. Also in `deployments.md` + runbook + cron file comment. |
| 2 | `docs/developers/lp-gateway.md` "depositable only once curated" | Rewritten as the precise registry rule: depositable ⇔ an **`active`, on-chain-verified `gateway_instances` row for the exact poolId**; label is never a key; env PM is bootstrap only. Matches the O-2 closeout state observed in `meta/route.ts` (`source: 'registry' \| 'env-fallback'`, `live` only for active registry rows). |
| 3 / 4 | M-04 "fixed" / runbook unsigned deposit body | Split honestly: route half fixed (M-04); client half = O-1. Verified `V1PoolDetail.tsx` now signs (`authMessage`/`authSignature`, action `mintware-gateway-deposit`) as of the O-1 closeout; runbook §4 documents the signed body. |
| 6 | rule file route list / migrations | Added `alerts`; migrations now list all five (`…000001/2`, `20260907000001/2/3`). |
| 7 | `deployments.md` env table | New **LP Gateway (V1)** section: every `LP_GATEWAY_*` var read anywhere (`grep -rn 'process.env.LP_GATEWAY' lib app scripts`) + `LP_TICK_*`, `LP_MAX_DEVIATION_BPS`, `LP_FORK_RPC_URL`, `GATEWAY_ORACLE_PRIVY_*`, the new `LP_GATEWAY_DISCOVER_PRUNE_GRACE_HOURS`, `ALLOW_DEV_BEARER_BYPASS`, Upstash — with reader, default, meaning, fail-closed behaviour. `LP_GATEWAY_USDG` row now states the fail-closed empty-feed consequence. |
| 9 | "other chat" caveat | Already absent from the on-disk rule file (it now states `setPaused` + `compoundQuote` as shipped); verified, nothing to remove. |
| runbook | `pokePrice()` (owner) / `maxDeviationBps` "default 20%" / `LP_MAX_DEVIATION_BPS` "default 2000" / single migration / `NEXT_PUBLIC_V1_MODE_ENABLED=true` instructions | Corrected to permissionless `poke()`, default **500 bps** (script), five migrations, and "V1 is a product — do NOT flip the legacy flag" (matches the rule + the 2026-09-07 incident). Flags section lists every knob with defaults + the schedule truth. |
| test counts | rule file | Forge counts re-verified by `grep -c 'function test'`: gateway unit 44 (7+18+11+8), hardening fork 7, round-2 fork 10; Vitest additions enumerated. |
| **Not mine** | 5 (`realfunds-audit-findings §8`), 8 (deploy-script header / ROOT fallback — HO-14), 10 (§7.5 `minLiquidity` — O-9), 11 (`V1PoolDetail` "Idle in Morpho" copy — HO-17) | Left for their owners; called out in the rule file where relevant. |

## Audit PoC suites — status after this closeout

- `lib/gateway/__audit__/redteamOffchainDiscovery.test.ts` — **flipped** to assert the fixed behaviour (6 cases green; the one
  "RESIDUAL" case documents the upstream-asserted-numbers residual).
- **Now failing as attacks, NOT edited (shared files):** `hackenOffchain.test.ts` HO-5 (sparklines: junk ids no longer reach the
  spy — 400) and HO-7 (discover now filters `status='active'`); `redteamOffchainPublicRoutes.test.ts` sparklines case (12 upstream
  calls, not 16). HO-2/HO-3 in the same file also fail from other agents' registry/meta fixes. Whoever consolidates those files
  should flip these four the way the contract PoC suites were.

## Build (O-13 proof)

Three runs on `next@16.2.12`, logs in the session scratchpad (`build-*discovery-hygiene.log`):

1. `bash -c 'pnpm build'` (= bare `next build`) → **Turbopack** path, fails immediately: `⨯ ERROR: This build is using
   Turbopack, with a webpack config and no turbopack config … Error: Call retries were exceeded (WorkerError)`. Pre-existing
   and unrelated — production builds with `next build --webpack` (`vercel.json`), exactly because of this Turbopack path.
2. `npx next build --webpack` (Vercel's command), default heap → `FATAL ERROR: Ineffective mark-compacts near heap limit —
   JavaScript heap out of memory` at ~242 s (exit 134). Local-box memory, not a compile error (the memory index already
   records "local next build broken — diagnose via branch push").
3. `NODE_OPTIONS=--max-old-space-size=8192 npx next build --webpack` → **`✓ Compiled successfully in 101s`** on 16.2.12
   (webpack), then the post-compile route-type check failed on a **sibling agent's in-flight file, not this change**:
   `Type error: Route "app/api/gateway/leaderboard/route.ts" does not match the required types of a Next.js Route.
   "__resetLeaderboardCache" is not a valid Route export field.` (Next.js forbids non-route exports from `route.ts`; I removed
   the same kind of test hook from `discover/route.ts` for this reason.)

**Decision:** the upgrade is **kept** — the webpack compile (the part the upgrade can break) passed; the only failure is a
concurrent edit that fails identically on 16.1.6. **Lead action:** have the leaderboard owner drop that export (or move the reset
hook to a lib module), then re-run `NODE_OPTIONS=--max-old-space-size=8192 npx next build --webpack` once for the final proof.
If the lead prefers the letter of the rule, reverting is `pnpm add next@16.1.6 --save-exact` (nothing else in the tree changed).
