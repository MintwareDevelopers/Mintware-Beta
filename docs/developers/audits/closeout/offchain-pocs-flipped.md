# Off-chain PoC suites after close-out — flipped to regression evidence

_2026-09-08 · branch `feat/lp-gateway-audit-closeout` · scope: **only** `lib/gateway/__audit__/**` (the Hacken-style +
red-team off-chain PoC suites and their `fakeSupabase` helper). No production file was touched; this record documents
how the PoCs that were written to PROVE the round-2 off-chain weaknesses now assert the FIXED behaviour, mirroring what
was done for the contract PoC suites. Sources: [`ui-money-path.md`](ui-money-path.md) (O-1/O-2/O-10),
[`registry-ledger.md`](registry-ledger.md) (O-3/O-4, A-4/A-7, HO-3/HO-6/HO-7/HO-10), [`discovery-hygiene.md`](discovery-hygiene.md)
(O-7/O-8/O-12, HO-5/HO-9/HO-11), [`profile-leaderboard.md`](profile-leaderboard.md) (O-11)._

**Verification:** `bash -c 'npx vitest run lib/gateway/__audit__'` → **8 files · 54 tests · all green** (was 5 files failing /
14 tests failing by design after the fixes landed). Scoped `tsc --noEmit` over `lib/gateway/__audit__/**` → 0 errors.

## Method

Every failing PoC was triaged into one of three buckets before editing:

| Bucket | Rule applied |
|---|---|
| (a) weakness FIXED | keep the ORIGINAL attack steps verbatim, rename with `_FIXED` / "defense holds", assert the refusal (404 / 409 / 401 / 400 / 429 / 500 / re-credit-to-zero / no-write). |
| (b) API changed | adapt to the new API with the same intent (e.g. `verifyInstanceOnChain` now takes `staging` + `trust`; the ledger client needs `getBlockNumber`/`getLogs`). |
| (c) genuine regression | leave failing and report. **None found.** |

Tests that still passed were kept unchanged. Where a passing test asserted a weakness that is now only a *residual*
(the exploit path is closed elsewhere), it was kept as evidence and re-labelled `RESIDUAL` / `LEGACY` with a `_FIXED`
sibling added beside it — assertions were never weakened to make anything pass.

## What was flipped (file → test → what it now asserts)

### `hackenOffchain.test.ts` (Hacken-style, HO-*)
| Case | Before (attack proved) | Now |
|---|---|---|
| HO-1 | unsigned UI deposit body → 401 | **unchanged, still 401** — the fix was on the client (O-1). |
| HO-2 | `resolveRouteInstance` fell back to the env PM; `/meta?pool=<unknown>` → 200 with `live:true` | **`_FIXED`**: `resolveInstanceStrict` → `404 pool_not_live`; `/meta` → 404 while the registry is populated; registry empty ⇒ the rig is served only for its own pool, `source:'env-fallback'`, `live:false`. The legacy helper case is kept as `RESIDUAL` (its only caller is read-only `/alerts`). |
| HO-3 | `registerInstance` upserted over an ACTIVE row with no select | **`_FIXED`**: a fully-verified candidate for an active pool → `active_instance_exists`; `gateway_instances` sees `['select']` only; no `upsert` anywhere; history row `refused`. Identical re-register = idempotent no-op; a fresh pool = `insert` with the **verified** quote (curator body ignored). |
| HO-4 | same signature accepted twice by `createHandler` | **kept as factory-level evidence** (still true — HO-12 follow-up) + `_FIXED` sibling: `bindSignedRecord` → `auth_replayed` on re-presentation, `auth_payload_mismatch` on body drift. |
| HO-5 | junk `?pools=` accepted as cache keys, N upstream fan-outs | **`_FIXED`**: 25 junk sets → 20× `400 INVALID_IDS` then 5× `429 RATE_LIMITED` (per-IP floor), **0** upstream calls; a valid id costs one upstream call and repeats are per-id cache hits. |
| HO-6 | free-text `pool_address` / any `chain_id` / 5 000-char label persisted | **`_FIXED`**: → `400 bad_pool_id` / `400 unsupported_chain`, no insert; a well-formed request lands with `pair_label` capped at 64. |
| HO-7 | Discover marked an `inactive` instance `live:true` | **`_FIXED`**: `live:false`; the read filters `status='active'`; flipping the row to active → `live:true`. |

### `redteamOffchainHarvest.test.ts` (A-4 / R-3 / O-4)
Rewritten to run the REAL `collect → index → settle` pipeline against a per-block chain mock and an emulated
`record_gateway_harvest` RPC (same idempotency contract as the plpgsql function).
- **`_FIXED` (buffer destination)**: Alice (stale DB row, 0 shares on-chain) is credited **0**; Bob gets the full **9 USDG** net;
  every `sharesOf`/`totalShares` read is pinned to the harvest block; `card_spend_buffers` is never written (both linked rows
  stay 0); `gateway_positions` is only ever `select`ed.
- **`_FIXED` (DEFAULT = restake)**: no per-user credit exists at all; `approve` + `compoundQuote(9 USDG)` are the only writes;
  log marked `restake` with the compound tx; no `sharesOf` reads.
- **`_FIXED` (atomic + idempotent)**: same collect tx → `duplicate` at the run level; cursor reset → the indexer's RPC returns
  `duplicate` (recorded 0, still exactly one credit row).
- **`_FIXED` (RMW race closed at both ends)**: no update/upsert ever touches `card_spend_buffers`, and
  `bufferMonitor.syncBufferBalance` on a `gateway_position_id`-linked buffer → `{ ok:false, reason:'gateway_funded' }` before any RPC.

### `redteamOffchainRegistry.test.ts` (A-7 / R-2 ×4 / O-3)
Constants replaced with valid hex (the old `0x…rea1` / `0x…ev` were not addresses and would now be refused as `bad_address`
before reaching the trust root). The lookalike was **upgraded** to echo every view the hardened check reads
(`quoteAsset`/`poolKey`/`staging`/`controller`) — and is still refused:
- echo-everything lookalike → `codehash_not_allowlisted`; the same echoes with the audited bytecode pass (`verification:'codehash'`);
- factory trust root → `factory_pm_mismatch` (and `factory_staging_mismatch` when the PM matches but staging doesn't);
- no trust root configured → `trust_root_unconfigured` with **zero** RPC calls;
- fake-but-consistent "USDG" → `quote_asset_mismatch`; `registerInstance` ignores the curator-supplied `quoteAsset`, writes nothing, logs `refused`;
- hooked pool key → `hooked_pool_rejected`;
- ACTIVE row + a candidate carrying the audited bytecode → `active_instance_exists`, row untouched, only `['select']` on `gateway_instances`, history `refused` with `existingPositionManager`;
- the sanctioned path: `deactivateInstance` (reason required) → `register` re-activates in place (never a second row), history `['deactivate','register']` with `prev_position_manager`.

### `redteamOffchainPublicRoutes.test.ts` (R-5 / HO-9 / HO-10 / O-8)
- sparklines: 16 well-formed junk ids → **12** upstream calls (`MAX_POOLS`), a repeat → **0** (remembered misses); non-hex junk → 0 calls, no cache key; 8 concurrent callers for one id → 1 upstream + 7 coalesced.
- `/api/gateway/request`: the original 100 KB body → `400 bad_pool_id`; `unsupported_chain` / `bad_requester` / `bad_quote_asset` each 400; nothing inserted; a valid request lands with an ASCII-only label ≤ 64.
- **`RESIDUAL` (kept, honest):** with Upstash unset the declared `{max:5/min}` on `/request` is a no-op and, unlike discover/sparklines, this route has **no in-memory floor** — 20 well-formed unique ids still insert 20 rows (bounded only by the per-pool DB unique guard). Delegated to the route owner in `discovery-hygiene.md` O-8; ops fix = set `UPSTASH_REDIS_REST_URL/_TOKEN`.

### `redteamOffchainSignedAuth.test.ts` (R-6 / O-10 / O-12)
- The two factory-level cases (no txHash/pool binding, unlimited replay in `createHandler`) **still pass and are kept as evidence** — the binding is route-level by design.
- `_FIXED` (O-10): `bindSignedRecord` → `auth_payload_mismatch` for body ≠ signed (txHash or pool), `auth_replayed` on the 2nd–5th presentation, and the old "5 txHashes on one signature" loop is refused on every iteration.
- `_FIXED` (O-12): `NODE_ENV=development` + empty bearer secret → **`500 MISSING_SECRET`** (was 200 open); `ALLOW_DEV_BEARER_BYPASS=true` is an explicit opt-in that works only in development and is ignored under `production`/`test`.

### `redteamOffchainRouting.test.ts` (R-1 / O-2 / O-1 / O-11)
- The three legacy-helper cases are kept, re-labelled `LEGACY … (residual, read-only alerts only)`.
- `_FIXED` siblings: label slug → 404; poolId → registry PM `live:true`; the env pool itself → 404 while the registry is populated; inactive → 404 and `listResolvableInstances` yields only the rig tagged `env-fallback`/`live:false`; attacker strings → 404 whether the registry is populated or empty; empty registry → rig only for its own pool, `live:false`; nothing configured → 503.
- The `nextDepositBasis` drift case is kept (pure math, still true) with its comment updated: the UI now records both legs (O-1) and the leaderboard ranks by on-chain shares × NAV (O-11), so the drift can no longer inflate a rank.

### Untouched (already green)
`redteamOffchainDiscovery.test.ts` (flipped earlier by the discovery-hygiene agent) and `redteamOffchainKeys.test.ts`
(its "range/agent roles still fall back to `ORACLE_PRIVATE_KEY`" and "bare hex silently prefixed" cases remain open
findings — they were never in this close-out's scope and still pass as written).

## Helper change — `fakeSupabase.ts`
Additive only: `upsert` accepts an array + `ignoreDuplicates` (the ledger's `gateway_known_depositors` write), and
`fakeSupabase({ rpc })` exposes `client.rpc(fn, args)` so a suite can emulate a Postgres function (used for
`record_gateway_harvest`). Existing callers are unaffected.

## (c) Genuine regressions found
**None.** Every PoC that failed after the fixes failed because the exploit path is closed, not because a fix missed.

## Residuals surfaced by the flipped suites (not regressions; all already documented by their owners)
1. `registry.resolveRouteInstance` still falls back to the env PM — only `/api/gateway/alerts` (read-only) uses it. Do not re-wire it into a money route.
2. `createHandler` alone has no txHash/pool binding and no nonce; the binding + per-process replay set live in the routes (`recordAuth.ts`). Shared nonce store / EIP-712 = HO-12 follow-up.
3. `/api/gateway/request` has no in-memory rate-limit floor; without Upstash the declared limit is a no-op.
4. `redteamOffchainKeys.test.ts`: `range`/`agent` roles still fall back to the shared `ORACLE_PRIVATE_KEY` in env-key mode; a bare-hex key is silently `0x`-prefixed.
