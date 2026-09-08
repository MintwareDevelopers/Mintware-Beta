# Round-2 closeout — UI money path (O-1, O-2, O-5, C-6 UI leg, O-9, O-10)

**Branch:** `feat/lp-gateway-audit-closeout` · **Date:** 2026-09-08 · **Scope owner:** UI money path
(`components/web2/v1/**`, `app/earn/**`, `app/api/gateway/{meta,position,positions,deposit,withdraw}`,
`lib/gateway/{deploy,positionReader}.ts`, CSP `connect-src`). Sources:
[`../2026-09-08-consolidated.md`](../2026-09-08-consolidated.md) §3, Hacken HO-1/HO-2/HO-3/HO-8,
red-team R-1/R-6. Nothing here touches `lib/gateway/registry.ts` (another owner) — its exports are
consumed as-is (`listActiveInstances`). No on-chain txs, no Vercel/prod changes.

**New files** (no concurrent-edit conflict possible; listed so ownership is explicit):
`lib/gateway/v4Math.ts` (+`.test.ts`), `lib/gateway/routeInstance.ts` (+`.test.ts`),
`lib/gateway/recordAuth.ts`, `lib/gateway/positionQuote.test.ts`,
`app/api/gateway/{meta,deposit,positions}/route.test.ts`.

**Verification commands** (all green at the time of writing; other owners' files were mid-edit in the tree):

```
bash -c 'npx vitest run lib/gateway/v4Math.test.ts lib/gateway/positionQuote.test.ts lib/gateway/routeInstance.test.ts lib/gateway/positionReader.test.ts lib/gateway/deploy.test.ts app/api/gateway/meta/route.test.ts app/api/gateway/deposit/route.test.ts app/api/gateway/positions/route.test.ts'
  → 8 files · 79 tests passed
bash -c 'npx tsc --noEmit -p .tsc-scoped.json'   → clean (the 6 known lib/gateway/registry.test.ts errors excluded)
tsc over every touched file incl. the UI components (scratch tsconfig extending tsconfig.json) → clean
```

Not verified in a browser: the deposit/withdraw flow needs a funded Robinhood-testnet wallet on an
injected provider; the dev server in this session had been stopped by another agent. The route
contract the UI relies on is locked by the Vitest suites above.

---

## O-1 (HIGH) — the UI could not record a deposit; withdraw never recorded

**Files:** `components/web2/v1/V1PoolDetail.tsx`, `components/web2/v1/V1Portfolio.tsx`,
`app/api/gateway/positions/route.ts`, `app/api/gateway/position/route.ts`, `app/api/gateway/withdraw/route.ts`.

**What changed**
- `V1PoolDetail.deposit/withdraw` → `confirmDeposit`/`confirmWithdraw` + a shared `record(kind, txHash, meta)`:
  after `receipt.status === 'success'` the connected wallet signs the exact message the route verifies
  (`buildGatewayDepositMessage` / `buildGatewayWithdrawMessage` with `pool = meta.poolAddress`, fresh `issuedAt`)
  and POSTs `{ address, txHash, pool, authMessage, authSignature, issuedAt }`. `res.ok && d.success` is checked.
- Honest state machine: `record` → button reads **"Confirmed on-chain · recording…"**; success →
  **"Deposited · recorded ✓"** / **"Withdrawn · recorded ✓"**; failure → `record_failed` with a banner
  *"Deposited on-chain — not yet recorded here. Your funds are safe on-chain (tx …). Recording only updates your
  cost basis on this dashboard."* and a **Retry recording** button (`retryRecord` re-signs with a new `issuedAt`
  for the stored `pending.txHash`). The old unconditional "Deposited ✓" is gone.
- Portfolio is **chain-first**: `/api/gateway/positions` enumerates every resolvable instance and reads
  `sharesOf`/`totalNav` for the wallet; `gateway_positions` rows are enrichment only (cost basis, `recorded`).
  A wallet with on-chain shares and no row now shows its position with an **"Unrecorded"** badge (basis unknown)
  instead of an empty portfolio. `/api/gateway/position` GET returns `recorded` and the detail page says
  *"its deposit was never recorded here, so cost basis and P&L are unknown. Your funds are unaffected."*
- Withdraw route: when no `gateway_positions` row exists it no longer fabricates one (`entry_nav` is
  `NOT NULL DEFAULT 0`, which would have shown a "+100 % gain"); chain-first reads cover that case.

**How verified**
- `app/api/gateway/deposit/route.test.ts` — *"signed { address, txHash, pool=poolId, … } → 200, gateway_positions
  written"*, *"the OLD unsigned UI body is still refused (401)"*, withdraw *"signed withdraw body → 200 and the basis
  is reduced proportionally"*.
- `app/api/gateway/positions/route.test.ts` — *"on-chain shares with NO DB row → position surfaces, recorded:false,
  basis null"*, *"a DB row with ZERO on-chain shares is omitted"*, *"inactive instances are not enumerated"*.
- HO-1 PoC (`lib/gateway/__audit__/hackenOffchain.test.ts`) still passes — the unsigned body is still refused; the
  fix is on the client + a positive-path test, not a loosening.

**Residual risk**
- Recording still depends on a client round-trip. An event-indexed reconciliation (HO-1 rec. 3, the A-4
  precondition) is not built; until then a user who closes the tab mid-record has an unrecorded (but visible,
  chain-read) position with unknown basis. Harvest weighting by DB shares (O-4) is out of this scope.
- Embedded (Privy) wallets are still refused for transactions (pre-existing); the record step uses the same
  injected provider as the tx.

## O-2 (HIGH) — deposit misrouting via the env fallback, `live: true` hard-coded

**Files:** `lib/gateway/routeInstance.ts` (new), `app/api/gateway/{meta,position,positions,deposit,withdraw}/route.ts`,
`components/web2/v1/{V1Discover,V1Portfolio,V1PoolDetail}.tsx`.

**What changed**
- `resolveInstanceStrict(supabase, cfg, pool)` replaces `resolveRouteInstance` on every money-path route:
  accepts a 20-/32-byte hex id (same rule as `discovery.normalizePoolId`, re-implemented locally because that
  helper is not exported and `discovery.ts` is not in scope); **registry ≥1 active ⇒ a miss is 404 `pool_not_live`**
  (label slugs, inactive rows, the env pool itself, attacker strings — all 404); **registry empty ⇒ the env rig
  is served only for its own `LP_GATEWAY_POOL_ADDRESS` (or no pool), tagged `source: 'env-fallback'`,
  `live: false`.** No pool + several active instances ⇒ 404 `pool_required`. `listResolvableInstances` gives the
  Portfolio the same set.
- `meta` returns `source`, derived `live`, `pairLabel`, `staging`, ticks, the **instance's** quote asset
  (registry `quote_asset`, else the contract's own `quoteAsset()`, never the global env first) and **409
  `instance_quote_mismatch`** if the registry row and the contract disagree (H-01 substitution class).
- UI links are keyed by **poolId**: `V1Discover.slug` and `V1Portfolio.slugOf` now emit `p.poolAddress`; the pair
  label is display-only. `V1PoolDetail` asserts `meta.poolAddress === <url pool>` and
  `source === 'registry' ? live : source === 'env-fallback'` before enabling the deposit button; the env rig shows a
  visible **"Single-instance dev rig"** chip + banner naming the env-configured gateway; a 404 renders **"Not live"**
  + *"This pool has no live gateway — nothing here accepts funds."* The detail page also prints the deposit target
  (`Gateway (deposit target) · registry-verified | env-configured`).

**How verified**
- `lib/gateway/routeInstance.test.ts` (15 tests) — registry populated: poolId hit / label slug 404 / inactive 404 /
  env pool 404 / attacker 404 / no-param rules; registry empty: env rig tagged + `live:false`, other pool 404, legacy
  label rig, 503 when nothing is configured.
- `app/api/gateway/meta/route.test.ts` (6) — *"registry populated + unknown slug → 404"*, *"registry hit → source
  registry, live true, the INSTANCE quote asset"*, *"registry empty + the env pool → env-fallback, live FALSE"*,
  *"registry quote_asset ≠ contract quoteAsset() → 409"*.
- `app/api/gateway/deposit/route.test.ts` — *"a label slug that misses the registry → 404 (never recorded against the
  env rig)"*, *"receipt.to ≠ the resolved PM → wrong_contract"*.
- HO-2 PoC *"GET /api/gateway/meta?pool=<unknown> advertises the fallback PM … live:true"* now **fails as an attack**
  (404). The PoC suite lives in `lib/gateway/__audit__/` (not in this scope) and should be flipped to assert the
  fixed behaviour by its owner.

**Residual risk**
- **Discover/list `live`:** `app/api/gateway/discover/route.ts` and `/instances` are not in this scope. Discover's
  `liveSet` still reads `gateway_instances` without `.eq('status','active')` (HO-11) unless its owner changed it
  (the file is modified in the tree). Impact is now display-only: a stale "Live" chip leads to a page whose meta
  404s and whose deposit button is disabled — no funds can be routed. One-line fix for that owner: add
  `.eq('status', 'active')` (or reuse `listActiveInstances`).
- `app/api/gateway/alerts/route.ts` still uses the old `resolveRouteInstance` (read-only alerts; not money path).
- The env rig is still not verified on-chain the way registry rows are (HO-4); it is now only reachable while the
  registry is empty and is labelled as such. Registering the rig (or setting `LP_GATEWAY_POOL_ADDRESS` to its
  poolId) makes the fallback unnecessary — recommended.
- Legacy `/earn/<label>` links now 404 for deposits (by design); metrics still render via a label match.

## O-5 (MEDIUM) — CSP `connect-src` blocked the Robinhood RPC

**File:** `next.config.mjs` (the `connect-src` line only).

**What changed:** added `https://rpc.testnet.chain.robinhood.com https://rpc.mainnet.chain.robinhood.com`
(46630 testnet + 4663 mainnet). Nothing else in the CSP was loosened.

**How verified:** diff review of the single directive. Browser-side receipt waits (`waitForTransactionReceipt`
on `meta.rpcUrl`) and the `sharesOf`/pool-state reads now originate from an allow-listed origin.

**Residual risk:** `meta.rpcUrl` echoes `LP_GATEWAY_RPC_URL`; if the operator points it at a different host the
browser reads are blocked again (and HO-13's key-leak concern applies). A `NEXT_PUBLIC_LP_GATEWAY_RPC_URL`
for the browser is the right follow-up; not done here (env/ops).

## C-6 (UI leg) — `depositWithMin` / `withdrawWithMin` with a shown floor

**Files:** `lib/gateway/positionReader.ts`, `lib/gateway/v4Math.ts` (new), `app/api/gateway/position/route.ts`,
`app/api/gateway/meta/route.ts`, `components/web2/v1/V1PoolDetail.tsx`.

**What changed**
- `positionReader.depositSharesQuote(amount, totalShares, totalNav)` = `floor(amount·(ts+1e6)/(nav+1e6))`
  (SeniorSharesMath.toShares mirror). `withdrawLegsQuote(shares, poolState)` mirrors `_withdraw`: share fraction of
  `staging.stagedAssets()` + share fraction of position liquidity converted at spot via
  `v4Math.getAmountsForLiquidity` (SqrtPriceMath round-down, exactly `_amountsForLiquidity`); last holder takes all;
  `lpQuotable:false` when slot0 is unreadable. `readGatewayPoolState` gathers the inputs (`totalShares`, `totalNav`,
  `tokenId`, `stagedAssets`, periphery `getPositionLiquidity(tokenId)`, slot0 via `poolState.readCurrentTick`,
  ticks, `quoteIsCurrency0`); `/api/gateway/position` GET returns it as `poolState` (JSON-safe).
- `meta.supportsMin` feature-detects the deployment: the 4-byte selectors of `depositWithMin(uint256,uint256)` and
  `withdrawWithMin(uint256,uint256,uint256)` must both appear in the PM bytecode (`getCode`); `null` when unreadable.
  `meta.pairedAsset` / `pairedDecimals` let the UI print the paired floor in real units (raw units when unknown).
- UI: a **review step** before every tx. Deposit: *You send · Est. shares (current NAV) · Min. shares floor (−1 %)* and
  *"If fewer than the floor would be minted, the transaction reverts and nothing moves."* Withdraw: *Shares to burn ·
  Est. USDG out · Min. USDG floor (−1 %) · Est. PAIRED out · Min. PAIRED floor* with the same revert copy; when the LP
  leg is unquotable the paired floor is 0 and the copy says only the idle leg is protected. The quote is taken from a
  **fresh** `/api/gateway/position` read at review time, not render state. `SLIPPAGE_TOLERANCE_BPS = 100` (exported
  const). Submits `depositWithMin(amount, minShares)` / `withdrawWithMin(shares, minQuote, minPaired)` when
  `supportsMin === true`; otherwise the plain calls with an explicit amber warning *"This deployment has no
  slippage-bounded deposit/withdraw — the transaction has no floor."* If `supportsMin` is true but pool state is
  unreadable the flow refuses rather than submitting an unbounded tx.

**How verified**
- `lib/gateway/v4Math.test.ts` (13) — `getSqrtPriceAtTick`: tick 0 = 2^96 exactly, MIN/MAX = v4-core constants
  exactly, <1e-9 rel. error vs `sqrt(1.0001^t)·2^96` across the range, monotonic; `getLiquidityForAmounts` /
  `getAmountsForLiquidity` round-trip never over-delivers, closed-form L at price 1, min-branch, out-of-range branches.
- `lib/gateway/positionQuote.test.ts` (15) — first deposit 1:1, fewer shares after NAV growth, 1 % floor sits just
  under the quote; withdraw undeployed/deployed/leg-swap/last-holder/unquotable/Σ pro-rata ≤ full; serialisation
  round-trip; `readGatewayPoolState` reads (supplied vs read staging, undeployed short-circuit, slot0 failure nulls
  spot).
- `app/api/gateway/meta/route.test.ts` — *"supportsMin detected"*, *"false on a legacy PM …, null when bytecode is
  unreadable"*.

**Residual risk**
- The deposit quote uses `totalNav`; the contract mints off `_navDeposit()` (LP leg at `max(spot, ref)`), so the
  real mint is ≤ the quote. A ref/spot gap >1 % reverts — that is the intended C-6 protection, surfaced as
  *"Deposit reverted — nothing moved"*. Withdraw floors include the LP leg, so a best-effort LP failure (A-1
  re-credit path) now reverts instead of re-crediting; the user keeps everything and can retry (or use plain
  `withdraw` by direct call). Copy says so.
- Bytecode selector detection is a heuristic (a proxy would need `getCode` on the implementation); `null` ⇒ plain
  calls with the warning shown.

## O-9 — one global absolute-L `LP_GATEWAY_DEPLOY_MIN_LIQUIDITY`

**Files:** `lib/gateway/deploy.ts`, `lib/gateway/deploy.test.ts`, `lib/gateway/v4Math.ts`.

**What changed**
- `computeDeployMinLiquidity({ sqrtPriceX96, tickLower, tickUpper, quoteIsCurrency0, quoteToDeploy, pairedOut, tolBps,
  envFloor })`: `L = getLiquidityForAmounts(spot, A, B, amount0, amount1)` (the exact value `deploy()` mints — same
  library, same leg mapping via `quoteIsCurrency0`), `minLiquidity = L × (1 − tol)` with `tol` =
  `LP_GATEWAY_DEPLOY_TOL_BPS` (default 100 = 1 %); **out of range ⇒ `{ reason: 'out_of_range' }`** (a balanced deploy
  would be one-sided); **computed 0 ⇒ `{ reason: 'min_liquidity_unset' }`** (fail-closed, even if an env floor is
  set); the env value is only ever an additional floor: `max(computed, env)` with a warning log when it wins.
- `deployGateway` reads `poolKey/poolManager/tickLower/tickUpper/quoteAsset` + slot0 (`readCurrentTick`) after the
  zap and before the L-02 window claim (a refusal never locks the window); unreadable price/coordinates ⇒
  `reason: 'price_unreadable'`, no tx. `DeployOutcome.ok` now carries `minLiquidity`.

**How verified:** `lib/gateway/deploy.test.ts` — the 3 pre-existing `deployWindowKey` tests unchanged + 7 new:
floor = `getLiquidityForAmounts × (1 − 1 %)`, custom tolerance, quote↔currency mapping (asymmetric range),
`max(computed, env)` both ways, out-of-range at/below/above both bounds, computed-0 refusal with and without env floor,
different pools get different floors (tighter range ⇒ larger L). **10/10.**

**Residual risk:** the floor is computed one block before submission; a same-block sandwich is still bounded by the
on-chain follower band (after the first deploy) and by the 1 % tolerance. Private-mempool submission (HO-8 rec.)
is not available on Robinhood Chain today. Deploy remains OFF (`LP_GATEWAY_DEPLOY_ENABLED` unset).

## O-10 (LOW) — signed `txHash`/`pool` not compared to the body; 15-min replay

**Files:** `lib/gateway/recordAuth.ts` (new), `app/api/gateway/{deposit,withdraw}/route.ts`.

**What changed:** `bindSignedRecord(body)` parses `authMessage` and requires `signed.txHash ===
body.txHash.toLowerCase()` (66-char hex) and `signed.pool === body.pool?.toLowerCase() ?? null` → else **401
`auth_payload_mismatch`**; then claims `keccak256(authSignature)` in a per-process set for the same 15-min window
createHandler enforces → a re-presented signature is **409 `auth_replayed`**. The route then acts on the *signed*
values. The durable backstop stays `gateway_deposit_events.tx_hash UNIQUE` (a fresh signature for an already-recorded
tx is an idempotent replay — basis not inflated).

**How verified:** `app/api/gateway/deposit/route.test.ts` — *"body txHash ≠ signed txHash → 401"*, *"body pool ≠ signed
pool → 401"*, *"case differences are normalised"*, *"the same signature presented twice → second is 409"*, *"a FRESH
signature for an already-recorded tx is an idempotent replay (basis not inflated)"*, withdraw: *"a deposit-action
signature cannot be replayed on the withdraw route"*, *"signed pool ≠ body pool → 401 on withdraw too"*.

**Residual risk:** the replay set is per-process (serverless instances don't share it); across instances the
UNIQUE tx-hash ledger + the on-chain event/`receipt.to`/`sharesOf` anchors bound the effect to "record the same tx
again, idempotently". A shared nonce store (Upstash) and EIP-712 typed messages remain the stronger follow-up
(HO-12). The factory-level PoC in `__audit__/redteamOffchainSignedAuth.test.ts` still passes because it tests
`createHandler` alone; the binding lives in the routes (proved by the route tests above).

---

## Copy check
No "deposit / savings / guaranteed / fixed APY" framing was added; every projected figure is labelled *est.* /
*estimate, not a projection*; withdraw copy names impermanent loss; the dev rig and unrecorded states are shown,
never hidden.
