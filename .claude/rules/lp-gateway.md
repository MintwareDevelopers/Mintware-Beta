# LP Gateway (V1) — the first live product surface

> **Status (2026-09-07):** **LIVE on Robinhood Chain testnet (46630)**, hardened + self-audited + firm-grade
> reviewed, merged to `main`. **Testnet + mock tokens + UNAUDITED** — external audit gates real mainnet value.
> **Real-funds re-audit (Fable 5.1, 2026-09-07 — [`docs/developers/lp-gateway-v1-realfunds-audit-findings.md`](../../docs/developers/lp-gateway-v1-realfunds-audit-findings.md)):**
> 4 HIGHs found + fixed on the `2026-09-07c` rig — A-1 withdraw re-credits unserved shares (adapter illiquid ⇒
> nothing stranded), A-2 empty-position brick, A-3 on-chain `MAX_DEPLOY_BPS=5000` cap on TOTAL deployed/NAV +
> follower band in `deploy` + cron fail-closed on `minLiquidity=0`, A-5 the staging adapter is now the PRODUCTION
> `MintwareERC4626YieldAdapter` (`onlyVault`) — the earlier rigs ran a `MockYieldAdapter` anyone could drain.
> Key hardening DONE (prod `ORACLE_SIGNER_PROVIDER=privy` verified; dedicated `gateway` signer role, see Off-chain).
> **USDG verified (M-07):** RH-mainnet USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` is Paxos-NATIVE (UUPS,
> matches Paxos' official table) — issuer can freeze **and wipe** balances → bounded exposure + disclosure.
> **Still gating OWN funds:** the bounded rollout itself (hard exposure cap, deep pools only, tiny first
> amount, monitoring). **Gating third-party funds:** A-4 buffer ledger (never written), A-7 registry, external audit.
> Deploy truth: [`config/deployments.json`](../../config/deployments.json) (`robinhood-testnet`) + `STATE.md`.
> Explainer: [`docs/developers/lp-gateway.md`](../../docs/developers/lp-gateway.md).

## What V1 is (one loop)
A **separate product surface** — touches none of the vault / JIT / YPN-treasury contracts. A user deposits
**USDG** (not USDC — parameterized everywhere; Robinhood Chain, Paxos USDG, 6dp) → it **stages into a
Morpho-shaped ERC-4626 adapter and earns immediately** → the owner deploys a **capped fraction** as liquidity
into an **existing, curated third-party Uniswap V4 pool** → **harvest collects trading fees (never principal)**
into a **yield-first spendable buffer**. Idle-buffer framing: *"put idle cash to work, spend from the buffer,
not your position."* The smallest concrete slice of "never idle, never locked, always yours."

## Contracts ([`contracts-v4/src/gateway/`](../../contracts-v4/src/gateway/))
- **`MintwareLpGatewayPositionManager`** — the core. `Ownable2Step`. One aggregate V4 position per pool,
  wrapping the OFFICIAL v4 PositionManager periphery. Entry-NAV shares via **`SeniorSharesMath`** (VIRTUAL=1e6
  offset, donation-safe). Owner-only `deploy(quote,paired,minLiquidity,deadline)` / `harvest(deadline)`.
- **`MintwareLpGatewayStaging`** — the Morpho earn reserve. `deployer`-gated `setController` (finding M1).
- **`MintwareLpGatewayFactory`** — curated (onlyOwner) multi-pool factory; per-pool isolated instances;
  adapter-reuse guard (M2); `Ownable2Step`; `DEFAULT_MAX_DEVIATION_BPS = 500`.

**Hardening (firm-grade review — see [`../../docs/developers/lp-gateway-v1-security-review.md`](../../docs/developers/lp-gateway-v1-security-review.md)):**
hookless meme pools have **no on-chain TWAP**, so manipulation resistance is a **clamped-follower reference**
(tracks spot ≤ `maxDeviationBps`/block; anyone may `poke()` it one bounded step) + a **conservative ENTRY mark**
(deposit values the LP leg at `max(spot,ref)`; `depositWithMin` bounds a pump). **Withdraw is PURE PRO-RATA on
both legs** (share fraction of idle AND of liquidity — no price read sizes it; `withdrawWithMin` bounds it) with
each leg **best-effort + re-credited as shares** if undeliverable (illiquid Morpho, paused/blacklisting paired
token, frozen recipient) — **withdrawals never brick, nothing is stranded** (round-2 audit F-01/F-02, RT-2/5/6;
the earlier withdraw-side `min(spot,ref)` mark was retired: redundant under pro-rata and it under-paid honest
exits). `_sweepFees` runs before every principal decrease/increase so fees route to the buffer, never a
withdrawer (**H-02**). **`MAX_DEPLOY_BPS` caps depositor principal AT COST** (`deployedPrincipal`, never moves
with price — RT-9a: a marked-value cap re-opened after every drawdown). `deploy` takes a `minLiquidity` floor
(M-03) + a follower band check (A-3). `harvestRecipient` immutable; `renounceOwnership` disabled; owner
`setPaused` (blocks deposits, never withdraw) + `compoundQuote`. **Residuals (ops, not code):** paired tokens
with admin controls (pause/blacklist/proxy) must be excluded by curation; the adapter owner can throttle exits
(delay, not loss); `block.number` on Robinhood Chain = L1 block (~12 s). Mainnet is audit-gated.

## Off-chain ([`lib/gateway/*`](../../lib/gateway/), [`app/api/gateway/*`](../../app/api/gateway/))
- **`registry.ts`** — the deposit-routing trust root. `registerInstance` **verifies the candidate PM on-chain**
  (`quoteAsset()`/`poolKey()` must match the approved pool) before writing a `gateway_instances` row (**H-01**).
- **`discovery.ts`** — `fetchHotPools` (live GeckoTerminal read, network slug **`robinhood` = MAINNET**, powers
  the browse feed) + `discoverAndIngest` (persisted curator queue; validates input, L-09). A pool identifier
  is a **20-byte address OR a 32-byte v4 poolId** (`normalizePoolId` — v4 pools have no address; **never
  `isAddress()`-gate them or the whole feed empties**, PR #470). `riskScore.ts` **ranks, never certifies**
  (verdict always `'review'`). **Round-2 O-7 hardening (2026-09-08, closeout `discovery-hygiene.md`):**
  everything GeckoTerminal returns is untrusted → the risk score sees only **clamped numerics** (`normalizeSignals`
  — name/symbol/URL text can never move it); **USDG is matched by ADDRESS only** against `LP_GATEWAY_USDG` —
  **unset ⇒ quote unknown ⇒ every pool ineligible ⇒ feed EMPTY (fail-closed) + `usdgConfigured:false`**, never by
  pair name; token logos pass only **https + GT/CoinGecko CDN hosts** (`safeImg`); the fee tier comes from the
  pool's fee field, else a name suffix only if ≤ 10% (`parseFeePct`); **est. fee APR is bounded** (n/a below $1k
  TVL or above 10,000%); the upstream read has an **8 s AbortController timeout + 2 bounded retries** (5xx/network
  only, never a 429) and **validates payload shape** (`fetchGtPools`) so the cron never 500s; **prune** only
  touches auto+pending rows unseen for `LP_GATEWAY_DISCOVER_PRUNE_GRACE_HOURS` (72 h) — curator decisions and
  manual rows are never evicted, and a failed read prunes nothing. **Honest residual:** the numbers themselves
  (TVL/age/tx) are upstream-asserted — a wash-traded fake can still score 0; that is why the verdict is a human
  gate and the UI chip must not read as certification. Est. APR is labeled an estimate, never a
  projection/guarantee (hard copy line).
- **Crons** (`app/api/(rewards)/cron/gateway-{discover,snapshot,harvest,deploy}`) — flag-gated OFF + fail-closed.
  **Schedule truth (`vercel.json`): `discover` daily `0 5 * * *`, `snapshot` daily `0 6 * * *`; `harvest` and
  `deploy` are NOT scheduled** (bearer routes, run by hand). Deploy has idempotency (L-02). Money-moving crons
  sign via **`getOracleSigner('gateway')`** — a DEDICATED Privy seat (`GATEWAY_ORACLE_PRIVY_WALLET_ID/_ADDRESS`,
  no shared-key fallback in app code) that is the rig's owner (`0x18AE…663c`). Prod's shared `root` is a
  different wallet (`0x7fD8…7E06`, card/x402/treasury) and must never own a gateway (re-audit A-3 key hardening).
- **Routes** (`app/api/gateway/{discover,sparklines,instances,position,positions,leaderboard,alerts,deposit,withdraw,curate,request,meta}`) — all
  `createHandler`. `deposit`/`withdraw` **routes** require **signed-message auth + tx-hash idempotency** (M-04 —
  the route half; the `/earn/[pool]` client sends the signed body as of the O-1 closeout — verify in
  `V1PoolDetail.tsx`, it POSTed an unsigned body until 2026-09-08). `curate` bearer **fails
  closed** when `LP_GATEWAY_CURATOR_SECRET` unset (`?? ''`, not a literal — C-01; and no `NODE_ENV=development`
  free pass any more — O-12, `ALLOW_DEV_BEARER_BYPASS`). **O-8:** `sparklines` validates ids (20/32-byte hex)
  before keying, caps **≤ 12 ids/request** (`truncated:true` beyond — the client should batch), caches **per id**
  (LRU 500 + TTL, misses remembered, in-flight coalesced) and returns **429 from an in-memory per-IP floor even
  without Upstash**; `discover` has the same floor + `.eq('status','active')` for `live` (HO-11). Both declare
  `rateLimit`; the other public GETs (`instances`, `position(s)`, `leaderboard`, `meta`, `alerts`) still don't
  (HO-15, their owners). Swap seams (`routerSwap.ts`, `v4SwapExec.ts`) fail-closed no-ops until a router is wired.
- **Depositable rule:** a pool is depositable only when `gateway_instances` holds an **`active`**, on-chain-verified
  (H-01) row for its **poolId** — the Discover `live` flag and `/earn/[pool]` must resolve through the registry, never
  through a pair label. The single-env `LP_GATEWAY_POSITION_MANAGER` fallback is bootstrap-only (O-2 closeout;
  see the registry agent's record for its final gating).
- Migrations: `20260906000001` (positions/harvest) · `_002` (registry) · `20260907000001` (idempotency) ·
  `_002` (position snapshots) · `_003` (alerts). All **deny-all RLS**. **Env vars:** every `LP_GATEWAY_*` var is
  tabled in [`deployments.md`](deployments.md) → "LP Gateway (V1) — Robinhood Chain".

## Surfaces & the V1/V2 model
- **`/v1`** ([`app/v1/page.tsx`](../../app/v1/page.tsx)) = the live product (`V1Shell` + `V1Discover` — the
  rolling curated-pool feed). **Flag-independent** — reachable any time. `/earn/[pool]` = deposit; `/curate` =
  curator queue.
- **V1 is a PRODUCT the site links to, NOT a site-wide mode.** V2 (the marketing/landing) is the front door,
  unchanged. The bridge is `LiveTodayStrip` (a slim "Live now → /v1" band) + the `LaunchModal` "V1 · Live" track.
- ⚠ **`NEXT_PUBLIC_V1_MODE_ENABLED` is a legacy dark-launch flag — leave it OFF.** Flipping it ON swaps the
  ENTIRE public site to V1 faces (it replaced the landing once → an incident, 2026-09-07). Do not flip it.

## Deploy, tests, framing
- **Deploy:** pure-Privy, no raw key — `scripts/deploy-lp-gateway-robinhood.mjs` (`pnpm deploy:lp-gateway:robinhood`).
  Runbook: [`../../docs/developers/lp-gateway-testnet-runbook.md`](../../docs/developers/lp-gateway-testnet-runbook.md).
- **Tests:** 44 gateway Forge (staging/PM/factory + `MintwareLpGatewayRealAdapter.t.sol` — the gateway composed
  with the PRODUCTION 4626 adapter: onlyVault drain-block, one-time setVault, A-1 re-credit vs per-block cap +
  stalled source, fee-net NAV) + `MintwareLpGatewayHardeningFork.t.sol` (7 — real `PoolSwapTest` swaps prove
  H-02/H-03 + the A-1/A-2/A-3 regressions, on the real adapter; self-skips without `LP_FORK_RPC_URL`) +
  `MintwareLpGatewayAuditRound2Fork.t.sol` (10 — round-2 F-01/F-02/F-04, RT-1a/2/5a/9a regressions with real
  third-party depth) + the auditors' own PoC suites under `contracts-v4/test/audit/` (kept green as evidence, asserting
  post-fix behavior) + gateway Vitest (`lib/gateway/*`, incl. `__audit__/` PoCs; the O-7/O-8/O-12 closeout added
  `discovery` 35 · `riskScore` 12 · `sparkline` 10 · `sparklines/route` 4 · `discover/route` 3 ·
  `cron/gateway-discover/route` 8 · `routeHandler.bearerBypass` 5 — 77 cases, and flipped
  `__audit__/redteamOffchainDiscovery` (6) to assert the fixed behavior). ⚠ The sparkline/discover PoCs inside the
  SHARED `__audit__/hackenOffchain.test.ts` (HO-5, HO-7) and `redteamOffchainPublicRoutes.test.ts` (R-5 sparklines)
  now **fail-as-attacks** and need flipping by whoever consolidates those files. Foundry gotcha: anchor `vm.roll`
  to a captured `b0` — a relative `block.number + 1` re-evaluated mid-test can land on the same block twice and
  trip `SameBlockAction`.
- **Hard copy lines** (same as the rest of the stack): idle-buffer, **never** "spend the fees" undersell or
  "100% spendable" overclaim; no **deposit / savings / guaranteed / fixed-APY**; testnet-honest; a liquidity
  position carries impermanent loss; external audit gates real value. `riskScore` never certifies safety.
