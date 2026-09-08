# Audit closeout — registry trust root (O-3 / A-7) + harvest ledger (O-4 / A-4)

_2026-09-08 · branch `feat/lp-gateway-audit-closeout` · scope: off-chain registry + harvest credit path only.
Testnet / pre-audit; nothing here changes the contracts. Findings referenced:
[`2026-09-08-consolidated.md`](../2026-09-08-consolidated.md) §3 O-3 / O-4 ·
[`2026-09-08-redteam-offchain.md`](../2026-09-08-redteam-offchain.md) R-2 / R-3 ·
[`2026-09-08-hacken-style-offchain.md`](../2026-09-08-hacken-style-offchain.md) HO-6 / HO-7 ·
[`lp-gateway-v1-realfunds-audit-findings.md`](../../lp-gateway-v1-realfunds-audit-findings.md) A-4 / A-7._

---

## 1. O-3 / R-2 / HO-7 / A-7 — registry trust root (HIGH, curator-secret gated → closed)

**Finding.** `registerInstance` trusted a candidate PositionManager that merely *echoed* `quoteAsset()` /
`poolKey()` (a 40-line lookalike passes), compared the quote to the **curator's input** rather than the
platform USDG, accepted hooked pool keys, never verified `staging`, and **upserted over an ACTIVE row** with
no read-before-write. The gate was a single static bearer **typed into the public `/curate` page**.
Outcome: theft of every *new* deposit for that pool.

**Files.**
- `lib/gateway/registry.ts` — rewritten write side (`verifyInstanceOnChain`, `registerInstance`,
  `deactivateInstance`, `registryTrustConfigFromEnv`, `listAllInstances`; local minimal ABIs
  `LP_FACTORY_ABI` / `LP_PM_STAGING_ABI` / `LP_STAGING_TRUST_ABI`).
- `lib/gateway/registry.test.ts` — 38 tests (rewritten; also fixes the 6 pre-existing tsc errors — see §3).
- `lib/gateway/curateAuth.ts` (+ `.test.ts`) — canonical curator message, allowlist parsing.
- `app/api/gateway/curate/route.ts` (+ `route.test.ts`) — signed-message curator auth; bearer = server-only.
- `app/curate/page.tsx` — wallet-signed actions, no secret field, register form, deactivate list.
- `app/api/gateway/instances/route.ts` — `?all=1` (inactive rows + `status` + `verification`).
- `app/api/gateway/request/route.ts` — pool-id shape / chain / label validation (HO-10, adjacent).
- `supabase/migrations/20260908000001_gateway_registry_history.sql` — history table + evidence columns.

**What changed.**

| Req | Implementation |
|---|---|
| (a) trust root | `LP_GATEWAY_FACTORY` set ⇒ `factory.instanceForPool(poolId)` must return `{staging == supplied, positionManager == candidate, active == true}` (`factory_pm_mismatch` / `factory_staging_mismatch` / `factory_inactive` / `factory_read_failed`). Unset ⇒ `keccak256(getCode(pm))` must be in `LP_GATEWAY_PM_CODEHASHES` (`codehash_not_allowlisted` / `no_code_at_pm` / `codehash_unavailable`). **Neither configured ⇒ `trust_root_unconfigured`, no RPC spent, nothing written.** |
| (b) staging + quote | `pm.staging() == supplied` (`staging_mismatch`) · `staging.controller() == pm` (`staging_controller_mismatch`) · `staging.quoteAsset() == LP_GATEWAY_USDG` (`staging_quote_mismatch`) · `pm.quoteAsset() == LP_GATEWAY_USDG` (`quote_asset_mismatch`). The row's `quote_asset` is the **verified** value; the curator body's `quoteAsset` is ignored (`quote_env_unset` fails closed when the env is missing). |
| (c) hooks | `poolKey.hooks != 0x0` ⇒ `hooked_pool_rejected` (checked before any other comparison). |
| (d) no upsert | `registerInstance` **selects first**. Active row with a different PM/staging ⇒ `active_instance_exists` (409 at the route) and a `refused` history row. Identical re-register ⇒ idempotent no-op (no write). Inactive row ⇒ status-guarded `update … where status='inactive'`; none ⇒ `insert`. `upsert` is gone (the test DB throws on it). `deactivateInstance` is the only path to inactive: requires `by` + non-empty `reason`, guarded update, history `deactivate`. Every register / deactivate / refusal is appended to `gateway_instance_history` (trigger makes it append-only even for service role). |
| (e) verification mandatory | `verify` is a required param: `{ client, trust? }` (on-chain) **or** `{ operatorAttestation: { by, reason } }` — the attestation is recorded as `verification='operator_attested'` + `verification_meta`. No silent skip path exists any more. |
| (e′) curator auth | `POST /api/gateway/curate`: `auth:'signed-message'`, `action:'mintware-gateway-curate'`, signer must be in `LP_GATEWAY_CURATORS` (empty ⇒ 503 `curators_not_configured`; other wallet ⇒ 403 `not_a_curator`). The route **rebuilds the exact canonical message** (`buildGatewayCurateMessage`: action · curateAction · requestId · pool · chainId · candidate PM · staging · issuedAt) and strict-compares → a signature is bound to *this* request + *these* addresses (401 `AUTH_MISMATCH` on any body tamper). Signed pool/chain must equal the request row's. Actor recorded = recovered signer, never body text. **Bearer** (`LP_GATEWAY_CURATOR_SECRET`) survives only for server-to-server approve/reject; it can neither register (`register_requires_curator_signature`) nor deactivate; unset secret ⇒ 503 in every env (closes O-12 for this route). |
| UI | `/curate`: no secret input; shows the connected curator wallet; Approve / Reject / "Approve + register" (PM + staging fields; quote is never entered) / per-instance **Deactivate** with a reason prompt. All via `useSignMessage`. |

**Verified.** `npx vitest run lib/gateway/registry.test.ts` → 38/38 (every branch above: factory tuple/struct
shapes, lookalike PM, each staging/quote/hook/pool mismatch, both RPC-failure paths, env parsing, unconfigured
trust root, attestation incomplete/ok, active-row refusal + history, identical no-op, reactivation, deactivate).
`app/api/gateway/curate/route.test.ts` → 11/11 with **real EIP-191 signatures** (allowlist ok / stranger 403 /
unset 503 / action swap 401 / PM swap 401 / pool mismatch 400 / foreign-action 401 / registry 400+409 /
deactivate / bearer approve-reject only / bad bearer 401 / unset 503). `lib/gateway/curateAuth.test.ts` → 4/4.
tsc clean for all files (scoped + full owned set).

**Residuals.**
- The factory check verifies the *record*; it does not itself prove the factory address is the audited one —
  `LP_GATEWAY_FACTORY` is an operator-set trust anchor (same class as `LP_GATEWAY_USDG`). Set it from the
  deploy record, never from a request.
- Code-hash allowlisting pins bytecode, not constructor args (pool key / adapter / owner). Those ARE covered by
  the other checks (poolId, staging wiring, quote) but the adapter behind staging is not verified here (C-9
  accepted; factory does not check `adapter.asset()` either).
- `verifyInstanceOnChain` reads `getCode` at latest — a metamorphic/selfdestruct-redeploy is not a concern on
  Cancun+ chains but is not explicitly guarded.
- `gateway_pool_requests.reviewed_by` for the bearer path is the literal `server:bearer`.
- The red-team PoC suites under `lib/gateway/__audit__/` (not owned here) now **fail by design** for
  R-2 ×4, HO-3, HO-6 (`/request` shape), and the curate `NODE_ENV=development` pass-through — each asserted
  the weakness; they should be flipped into regression assertions or retired by their owner.

**Ops steps.**
1. Apply `supabase/migrations/20260908000001_gateway_registry_history.sql`.
2. Set on Vercel (Production + Preview) — all server-only:
   - `LP_GATEWAY_USDG` — Paxos USDG on Robinhood Chain (already required by O-7; the registry now fails closed without it).
   - `LP_GATEWAY_CURATORS` — comma list of curator wallet addresses (Privy/external). Empty ⇒ nobody can curate.
   - **Either** `LP_GATEWAY_FACTORY` = the curated `MintwareLpGatewayFactory` (once instances are factory-deployed),
     **or** `LP_GATEWAY_PM_CODEHASHES` = comma list of `keccak256(eth_getCode(<audited PM build>))`. For the
     current direct-deployed rig: `cast keccak $(cast code <PM> --rpc-url $LP_GATEWAY_RPC_URL)` and allowlist that
     hash. Both may be set; the factory wins when set.
   - `LP_GATEWAY_CURATOR_SECRET` — keep ONLY if a server job needs approve/reject; it is no longer used by the page.
3. Re-register the live rig **once** through `/curate` (Approve + register with PM + staging) so the row carries
   `verification` — or run a one-off script calling `registerInstance(..., { operatorAttestation })` and keep the
   history row. An already-active identical row is a no-op.

---

## 2. O-4 / R-3 / HO-6 / A-4 — harvest fee ledger (HIGH for third-party → closed)

**Finding.** Harvest credits were weighted by **DB** `gateway_positions.shares` (never `sharesOf`; a fully
withdrawn wallet still received half a harvest), written by non-atomic read-modify-write into
`card_spend_buffers` — a table the card rail authorizes against and `lib/org/bufferMonitor.ts` overwrites
from chain — and only the one collect tx the cron sent was ever looked at (withdraw/deploy fee sweeps emit the
same `Harvested` event and were never credited).

**Files.**
- `lib/gateway/ledger.ts` (+ `ledger.test.ts`, 12 tests) — indexer + atomic writer + reconciliation.
- `lib/gateway/harvestMath.ts` (+ test, 6 new) — `proRataByOnchainShares` (denominator = on-chain total).
- `lib/gateway/harvest.ts` (+ new `harvest.test.ts`, 7 tests) — collect → convert → **index → settle**.
- `app/api/(rewards)/cron/gateway-harvest/route.ts` — comment/mode doc; wiring unchanged.
- `lib/org/bufferMonitor.ts` — refuses to sync a `gateway_position_id`-linked buffer (`gateway_funded`).
- `supabase/migrations/20260908000002_gateway_fee_ledger.sql` — 5 tables, 1 function, 2 views.

**What changed.**
- **Event-indexed.** `indexHarvestLogs` scans `getLogs(address = PM, events = [Deposited, Harvested])` from a
  persisted cursor (`gateway_index_cursors`, per chain+PM) to `tip − LP_GATEWAY_INDEX_CONFIRMATIONS`, in
  `LP_GATEWAY_INDEX_CHUNK_BLOCKS` chunks, at most `LP_GATEWAY_INDEX_MAX_BLOCKS` per run. First run starts at
  `LP_GATEWAY_INDEX_START_BLOCK` or `tip − LP_GATEWAY_INDEX_INITIAL_WINDOW`. The cursor advances only after
  every log in a chunk is recorded; any getLogs / share-read / RPC-write failure leaves it untouched (re-run
  is safe: idempotent key). `Harvested` logs from withdraw/deploy sweeps are indexed identically.
- **On-chain-share-weighted at the harvest block.** Read-set = `gateway_known_depositors` (every `Deposited`
  user ever seen — including one in the same block as the harvest) ∪ DB positions. `totalShares()` and
  `sharesOf(user)` are read with `blockNumber` = the log's block (batched `readContract`, no multicall — the
  gateway chain config has no multicall3). Split with `proRataByOnchainShares`: floor per holder over the
  **contract's** total; unknown holders' slice + rounding dust is `unallocated_atomic` on the log row, never
  re-assigned. Σ credits ≤ net always (throws on Σ sharesOf > totalShares).
- **Atomic write.** `record_gateway_harvest(p_log, p_credits, p_settlement)` — one plpgsql transaction:
  `INSERT … ON CONFLICT DO NOTHING` on `UNIQUE (chain_id, tx_hash, log_index)`, then `SELECT … FOR UPDATE`;
  already settled / credited ⇒ `'duplicate'` (nothing written); credits inserted with their own
  `UNIQUE (chain_id, tx_hash, log_index, user_wallet)`; refuses if Σ credits > net. Returns `'ok' | 'duplicate'`.
- **Own tables, isolated.** `gateway_harvest_logs`, `gateway_fee_credits`, `gateway_fee_payouts`,
  `gateway_known_depositors`, `gateway_index_cursors` — all deny-all RLS. `card_spend_buffers` is no longer
  written by any gateway code; `bufferMonitor.syncBufferBalance` now returns `{ ok:false, reason:'gateway_funded' }`
  before touching a row that has `gateway_position_id` set (so it can never zero a ledger claim).
- **Destination default = `restake`.** `resolveHarvestDestination()` in `harvest.ts` treats anything but an
  explicit `LP_GATEWAY_HARVEST_DESTINATION=buffer` as `restake` — enforced on the money path regardless of
  `opsConfig.ts` (whose old `'buffer'` default predates the closeout; not owned here). Restake: logs are
  recorded `pending`, then the cron compounds **Σ pending net (all un-settled logs, incl. sweeps) + net of the
  swapped paired leg** via `approve` + `compoundQuote`, and marks them `restake` with the compound tx —
  NAV lifts pro-rata on-chain, no DB claim exists. Buffer: credits written at index time; nothing moves
  on-chain; the net stays in the seat wallet as IOU backing.
- **Pipeline order** in `harvestGateway`: dust-guard (still indexes prior sweeps when skipping) → collect →
  `harvest_events` run-idempotency → convert paired leg → **index** (`minToBlock` = the receipt block, so the
  just-mined collect is in range even with confirmations > 0) → settle. Index failure ⇒ `ledger_index_failed`,
  nothing compounded/credited, run recorded with 0 credited. Index-only mode:
  `LP_GATEWAY_LEDGER_INDEX_ENABLED=true` without harvest — no signer, no tx, sweeps still credited.
- **Reconciliation.** View `gateway_fee_balances` (per depositor: credited − paid = owed) and
  `gateway_fee_ledger_reconciliation` (per PM: gross / skim / credited / unallocated / pending / restaked / paid /
  `expected_seat_quote_atomic`). `reconcileSeat()` reads `quoteAsset.balanceOf(harvestRecipient)` live and
  returns `seat − expected` (≥ 0 = every IOU + Mintware's skim is covered). `listFeeBalances()` for a payout job.
  Payouts are recorded in `gateway_fee_payouts` (operator; `UNIQUE(tx_hash)`), never by the indexer.

**Verified.** `ledger.test.ts` 12/12: Alice (stale DB row, 0 on-chain) gets nothing / Bob gets 9 of 10 USDG;
every share read pinned to block 110; `card_spend_buffers` untouched; duplicate-key re-run after a cursor reset
credits nothing; withdraw-sweep tx credited like a harvest; `Deposited`-only depositor discovered and the
unknown holder's slice left unallocated; pending/restake round-trip; cursor not advanced on RPC-write or
getLogs failure; confirmations / chunking / per-run cap / resume; `minToBlock`; same-block Deposited+Harvested.
`harvest.test.ts` 7/7: restake default (compound = Σ pending incl. an older sweep, marks restaked), buffer
opt-in (credits from the index, DB shares never read, no buffer write), index failure = nothing settled,
dust-floor still indexes, disabled, index-only mode, both-off. `harvestMath.test.ts` 16/16. Migrations: no
Postgres locally (`psql`/`supabase` absent) — structural check (balanced parens / `$$` / termination / RLS on
every table / all referenced objects present) passes; the plpgsql was hand-reviewed.

**Residuals.**
- **Paired-leg proceeds** are converted (`swapPairedToQuote`) but not attributed per depositor under `buffer`:
  they are not part of any `Harvested.quoteFees`. Under `restake` they are compounded. Proper fix = a
  `conversion` ledger row keyed by the swap tx, weighted at the swap block. `paired_fees_atomic` is stored on
  every log so this is backfillable.
- Credits are an **off-chain IOU** against the seat wallet until a payout rail exists (`gateway_fee_payouts` has
  no writer yet). `reconcileSeat` makes the backing auditable; it does not enforce it. Restake (default) has no
  such IOU — prefer it until payouts are built.
- `record_gateway_harvest` trusts the caller's `shares_at_block` values; the indexer is the only caller and reads
  them from chain at the pinned block. A reorg deeper than `LP_GATEWAY_INDEX_CONFIRMATIONS` (default 1; Robinhood
  Chain `block.number` = L1 block) could index a log that later disappears — raise the confirmations for
  third-party funds.
- `markRestaked` updates rows one by one (guarded on `settlement='pending'`); not a single statement.
- The `__audit__` A-4 PoCs (`redteamOffchainHarvest.test.ts`) now fail by design (their mock client lacks
  `getBlockNumber`/`getLogs`; the exploit path is gone) — flip/retire with their owner.

**Ops steps.**
1. Apply `supabase/migrations/20260908000002_gateway_fee_ledger.sql` (after `…000001`).
2. Leave `LP_GATEWAY_HARVEST_DESTINATION` **unset** (= restake) until a payout rail exists; set `buffer` only
   deliberately.
3. Optional, recommended before enabling harvest: `LP_GATEWAY_LEDGER_INDEX_ENABLED=true` to start indexing
   sweeps with no tx; set `LP_GATEWAY_INDEX_START_BLOCK` to the PM's deploy block for a full history (else the
   first run starts `LP_GATEWAY_INDEX_INITIAL_WINDOW` = 10 000 blocks back). Tune `LP_GATEWAY_INDEX_CONFIRMATIONS`
   (default 1), `LP_GATEWAY_INDEX_CHUNK_BLOCKS` (5 000), `LP_GATEWAY_INDEX_MAX_BLOCKS` (50 000),
   `LP_GATEWAY_INDEX_READ_BATCH` (40) to the RPC's limits.
4. `LP_GATEWAY_HARVEST_ENABLED=true` (+ the `gateway` Privy seat holding PM ownership) to run the full
   collect → index → compound loop. The cron is not yet in `vercel.json` (unchanged by this work).
5. Periodically compare `reconcileSeat()` (or the view) with the seat wallet; `delta < 0` = investigate before
   any payout.

---

## 3. Pre-existing tsc errors in `lib/gateway/registry.test.ts` (6)

All six were `Type '{ readContract: Mock<…> }' is not assignable to type 'ReadClient'` — the test mock's
`readContract` return union vs viem's deep generic `Pick<PublicClient,'readContract'>`. Fixed at the source:
`ReadClient` is now structural (`{ readContract: (args: any) => Promise<unknown>; getCode?: … }`, the same
pattern `lib/gateway/positionReader.ts` already uses), and the rewritten test types its mock as `ReadClient`.
`npx tsc --noEmit -p .tsc-scoped.json` → 0 errors; a scratch config covering every file in this record → 0 errors.

## 4. Test inventory (owned)

| Suite | Count |
|---|---|
| `lib/gateway/registry.test.ts` | 38 |
| `lib/gateway/ledger.test.ts` | 12 |
| `lib/gateway/harvest.test.ts` | 7 |
| `lib/gateway/harvestMath.test.ts` | 16 |
| `lib/gateway/curateAuth.test.ts` | 4 |
| `app/api/gateway/curate/route.test.ts` | 11 |
| **Total** | **88 / 88 green** |
