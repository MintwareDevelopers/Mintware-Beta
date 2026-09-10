# LP Gateway (V1) — the first live product surface

> **⭐ Earn-vs-LP decision (2026-09-08 — [`docs/developers/lp-gateway-earn-vs-lp-decision.md`](../../docs/developers/lp-gateway-earn-vs-lp-decision.md), fully built): LP and Earn are now two separate products, never fused.**
> **LP**: the user's ENTIRE committed capital is deployed (no held-back buffer; `MAX_DEPLOY_BPS = 10000`) —
> `deploy()` swaps part of it INTO the paired leg ATOMICALLY, in-contract, via a real V4 pool swap
> (`_executeSwap`/`unlockCallback`, the same unlock/settle pattern `MintwareTreasuryFloatSettlement` uses).
> **Mintware supplies NOTHING to any position and bears NONE of the IL — the owner-funded `pairedAmount` /
> `safeTransferFrom(msg.sender, …)` path is deleted outright**, not just capped; there is no code path left
> that accepts an owner-supplied paired token. `deploy`'s signature is now
> `deploy(quoteToDeploy, swapAmount, minPairedOut, minLiquidity, deadline)`. **Earn**: USDG supplied to a pure
> lending market (`MintwareERC4626YieldAdapter`, no pairing, no IL) — a genuinely separate, opt-in product,
> gated on real ERC-4626 capacity (none exists yet on Robinhood mainnet). The old fused model — stage → hold
> 50% back → "earn while idle" → deploy with an owner-supplied paired leg → A-4 harvest-to-buffer ledger — is
> retired in full: no held-back buffer, no owner subsidy, no buffer ledger (`resolveHarvestDestination` always
> returns `'restake'` now). `principalCap` (IA-11) survives as the real absolute TVL-at-risk bound, now simpler
> since there is no owner-injected value left to bound — see the decision doc's "Codebase impact" table for
> the full before/after. **Whether to retire `MintwareIdleYieldAdapter` itself is still an open call** (it may
> still be the right "doorway" custody adapter for the transient window between a deposit and the owner's next
> `deploy()` when no real Earn source has capacity) — not yet decided or touched.
>
> **Status (2026-09-07, historical — read the box above first):** **LIVE on Robinhood Chain testnet (46630)**,
> hardened + self-audited + firm-grade reviewed, merged to `main`. **Testnet + mock tokens + UNAUDITED** —
> external audit gates real mainnet value.
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
> **Mainnet yield source (2026-09-08):** no real ERC-4626 USDG vault exists on Robinhood mainnet with open
> capacity — see [`docs/developers/audits/closeout/mainnet-yield-sources.md`](../../docs/developers/audits/closeout/mainnet-yield-sources.md).
> `contracts-v4/src/vaults/MintwareIdleYieldAdapter.sol` is the zero-yield fallback (`LP_GATEWAY_IDLE_MODE=true`
> in `scripts/deploy-lp-gateway-mainnet.mjs` / the preflight) — custodies USDG under the same access-control
> pattern with no external dependency, gated by an owner-adjustable `LP_GATEWAY_DEPOSIT_CAP`. Using it means the
> "earns immediately" framing does not hold for that instance; say "held ready, not yet earning" instead.
> Explainer: [`docs/developers/lp-gateway.md`](../../docs/developers/lp-gateway.md).

## What V1 is (two products, never fused — earn-vs-lp decision)

**LP** — a **separate product surface** — touches none of the vault / JIT / YPN-treasury contracts. A user
deposits **USDG** (not USDC — parameterized everywhere; Robinhood Chain, Paxos USDG, 6dp) → it briefly
**stages** (a doorway, not a feature) → the owner **deploys the FULL committed amount** as liquidity into an
**existing, curated third-party Uniswap V4 pool**, swapping part of it into the paired leg atomically
in-contract → **100% of the impermanent loss is the user's; Mintware supplies no capital and bears none of
it** (enforced on-chain) → **harvest collects trading fees (never principal)**, restaked pro-rata into NAV
(no buffer). Copy: *"provide liquidity, earn trading fees, carries impermanent loss."*

**Earn** — a genuinely separate, opt-in, no-IL product: USDG supplied to a lending market
(`MintwareERC4626YieldAdapter`), single-asset in, single-asset out, no pairing. Ships the day a real USDG
ERC-4626 source has open capacity (none does on Robinhood mainnet today — not a code gap). Copy: *"supply
USDG, earn interest"* — never call it "LP."

Neither product ever holds capital back "to earn while idle" — that fused model (and the buffer it fed) is
retired. The through-line stays *"never idle, never locked, always yours"* — now honestly split across two
products with different risk, instead of one product quietly blending both.

## Contracts ([`contracts-v4/src/gateway/`](../../contracts-v4/src/gateway/))
- **`MintwareLpGatewayPositionManager`** — the core. `Ownable2Step`. One aggregate V4 position per pool,
  wrapping the OFFICIAL v4 PositionManager periphery. Entry-NAV shares via **`SeniorSharesMath`** (VIRTUAL=1e6
  offset, donation-safe). Owner-only `deploy(quoteToDeploy, swapAmount, minPairedOut, minLiquidity, deadline)`
  — swaps `swapAmount` of the user's own quote into the paired leg atomically in-contract (earn-vs-lp
  decision; no owner-supplied paired leg any more) — / `harvest(deadline)`.
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
withdrawer (**H-02**). **`MAX_DEPLOY_BPS` is now `10000` (100% — earn-vs-lp decision, no held-back buffer)**;
the RT-9a cost-basis discipline (`deployedPrincipal` never moves with price) survives as an overdraw guard,
not a size policy. `deploy` takes a `minLiquidity` floor (M-03) + a `minPairedOut` swap-slippage floor + a
follower band check (A-3, now bounding both the zap and the mint). `harvestRecipient` immutable;
`renounceOwnership` disabled; owner
`setPaused` (blocks deposits, never withdraw) + `compoundQuote`. **Residuals (ops, not code):** paired tokens
with admin controls (pause/blacklist/proxy) must be excluded by curation; the adapter owner can throttle exits
(delay, not loss); `block.number` on Robinhood Chain = L1 block (~12 s). Mainnet is audit-gated.

**Round-3 exploit replay (2026-09-08 — [`../../docs/developers/audits/round3/README.md`](../../docs/developers/audits/round3/README.md)):**
real-world incident classes (Gamma, Cork, Sonne, Bunni, Euler, Balancer, Kyber, Yearn, Curve read-only reentrancy,
Paxos freeze) replayed on the real v4 stack + stateful invariant fuzzing + closed-form economics. Fixed on-chain:
**entry-mark MEMORY** (deposits mark the LP leg at the holder-favourable max over spot / follower / the last two
`ENTRY_MEMORY_BLOCKS`=300 periods — a held dump or a one-step dump+`poke()` no longer cheapens entry; XR-1/E-1);
**single virtual offset on exit** (the per-leg `toAssets(…, VIRTUAL)` re-credited ≈$1 of phantom shares per partial
exit at 6 dp — fuzz F1); **pool must be initialised + follower anchored at creation** so the FIRST deploy is banded
(XR-2/X-7); **`DeployNotTwoSided`** (minted paired value within [½×, 2×] of quote — closes the compromised-seat
all-quote deploy, invariant 15); **`StageShortfall`** (a deposit must grow the reserve by ≥ amount − 50 bps —
source-layer inflation XR-3, also makes entry-fee sources DOA); **outage haircut** (20 % on `lastKnownIdle` when the
source is unreadable — R3-1); exit weight = holder mark (E-2); liquidity slice never exceeds the position (E-4);
tolerant re-stage on a capped source (R3-2, `RestageDeferred`; parked quote counts as idle, is paid out first on exit
and consumed first on deploy — R3-INV-2); exit re-credit is PER LEG (idle shortfall at the high mark, a failed LP leg at
`min(spot, ref)`, everything back when nothing was delivered — R3-INV-1); an unset memory bucket is never a price
(R3-INV-3); staging measures `unstage` by balance-diff (X-3). **Method lesson:** the fuzz harness was re-run after EVERY
fix set and each re-run found a real residual in the previous fix — never ship a contract fix without a fresh campaign.
Off-chain: deploy cron pre-flights the band (`poke` + retry) and an external reference price (`ref_price_*`,
fail-closed unless `LP_GATEWAY_DEPLOY_REQUIRE_REF_PRICE=false`); two-phase restake ledger (claim → compound →
mark); replay set keyed on the signed message; registry pins `owner()`/`harvestRecipient()`/adapter binding;
`ORACLE_SIGNER_PROVIDER` typo throws; ledger views `security_invoker` + revoked from anon in the migration
**SQL** (`20260908000003`) — ⚠ **round-4 (2026-09-09) found this migration was never actually EXECUTED against
production** (live-reproduced: both ledger views still return 200 to the anon key) — this line previously
claimed it as done; it is not. **Not yet fixed — apply the migration.** See round-4 below. Still open/accepted:
`compoundQuote` sandwich (Low, owner is sole depositor), read-only-reentrancy view windows (never read PM views
from a gateway callback), USDG issuer upgrade authority (single key behind a 24 h timelock — disclose + monitor).
**The owner paired-leg subsidy design residual is CLOSED** (earn-vs-lp decision, 2026-09-08) — deleted outright,
not just bounded; see the status box at the top.
Rig **'g'** (PM `0xa52d4ffaefa586251cb36d1e05588daa89ab0a63`, staging `0x0a85…fa14`, tUSDG `0x2a8c…b848`, poolId
`0x07340da7…dfa2`, PM code hash `0x89a53e8d…00f4`) is the round-3 deployment (smoke passed 2026-09-08); rig 'e' is superseded.

**Round-4 multi-suite audit (2026-09-09 — [`../../docs/developers/audits/round4/README.md`](../../docs/developers/audits/round4/README.md)):**
"all V1, anything V1 touches" — 24 confirmed findings (1 Critical, 6 High, 7 Medium, 7 Low, 3 Informational),
several with PoCs executed against a live testnet fork or the real production Supabase project. **Fixed
on-chain:** `deploy()`'s post-swap price re-read now re-checked against the deviation band (closes a hostile
paired-token transfer-hook interleaved-swap manipulation window — V4's `unlock()` lock is global, not
caller-scoped); `deploy()` now reverts `InsufficientStaged` before any swap when `staging.unstage()`
under-delivers (a routine adapter-liquidity-shortfall event, not an edge case); `_withdraw()`'s idle leg is now
isolated behind a self-call + try/catch (new `idleLegExit`, mirrors `lpLegExit`) so a frozen withdrawer no
longer bricks their own exit; `MintwareERC4626YieldAdapter.withdraw()` now genuinely honors `IYieldAdapter`'s
"never reverts" contract (the whole read-then-redeem sequence, not just `redeem`, moved behind one try/catch
boundary); `MintwareLpGatewayFactory` now disables `renounceOwnership`, matching every sibling contract;
`MintwareLpGatewayStaging.unstage()` now also try/catches `adapter.withdraw()` (defense-in-depth one layer up);
`deploy()`'s own pre-flight fee sweep is now isolated the same way (new `sweepFeesExternal` self-call) so a
frozen `harvestRecipient` no longer bricks deploying NEW capital, only fee collection itself.
**Fixed off-chain:** the D-4 adapter-kind probe (session-introduced) no longer defaults to `'real'` on ANY
`depositCap()` read failure — needs a positive `perBlockWithdrawCap()` confirmation now; the deposit-amount
input no longer silently corrupts locale-formatted numbers (`"1,25"` → `"125"`, a 100x-inflated deposit);
`withdrawLegsQuote()` no longer double-applies the virtual offset per leg (was the stale PRE-round-3-fix
formula, causing spurious `SlippageExceeded` on typical small withdrawals); the gateway crons no longer send
harvest/compound/deploy with a fixed gas literal (new `lib/gateway/gasEstimate.ts`, real `estimateContractGas`
+ buffer, floor-only-on-failure) and the harvest pre-simulate short-circuits a deterministic `NotDeployed`
instead of paying gas for a guaranteed revert; the registry's reactivation `update()` now detects a lost
concurrent-write race instead of silently logging stale metadata as success; deposit/withdraw cost-basis
writes are now one atomic RPC per direction instead of two separate round-trips (closes a crash-window /
lost-update race) — **migration `20260909000001_gateway_position_atomic_writes.sql` APPLIED + LIVE-VERIFIED
(2026-09-09, applied by the user the same way as the RLS one)**: confirmed via curl against prod that both
`record_gateway_deposit_event`/`record_gateway_withdraw_event` are service-role-only (anon gets `42501`) and
that a real insert + a same-`tx_hash` replay are correctly idempotent (`already_recorded:true`, no
double-credit); probe rows cleaned up after. `/api/gateway/{deposit,withdraw}` are fully live on this path.
**Reconciled by documentation, not code:**
`compoundQuote()`'s deliberate no-principalCap-check design (the class doc comment used to contradict it) and
`_idle()`'s donation-inflatable raw balance (an accepted, R3-INV-2-required tradeoff). **Still open, no code
possible:** the sibling `gateway_alerts` migration (`20260907000003`), same root cause as the RLS Critical.
Verification: full vitest 1066/0 fail, full forge test 1042/0 fail (4 pre-existing fork-test skips,
unrelated).

## Off-chain ([`lib/gateway/*`](../../lib/gateway/), [`app/api/gateway/*`](../../app/api/gateway/))
- **`registry.ts`** — the deposit-routing trust root. `registerInstance` **verifies the candidate PM on-chain**
  (`quoteAsset()`/`poolKey()` must match the approved pool) before writing a `gateway_instances` row (**H-01**).
- **`discovery.ts`** — `fetchHotPools` (live GeckoTerminal read, network slug **`robinhood` = MAINNET**, powers
  the browse feed) + `discoverAndIngest` (persisted curator queue; validates input, L-09). A pool identifier
  is a **20-byte address OR a 32-byte v4 poolId** (`normalizePoolId` — v4 pools have no address; **never
  `isAddress()`-gate them or the whole feed empties**, PR #470). `riskScore.ts` **ranks, never certifies**
  (verdict always `'review'`). **Round-2 O-7 hardening (2026-09-08, closeout `discovery-hygiene.md`):**
  everything GeckoTerminal returns is untrusted → the risk score sees only **clamped numerics** (`normalizeSignals`
  — name/symbol/URL text can never move it); **USDG is matched by ADDRESS only** against
  `LP_GATEWAY_DISCOVER_USDG` (a **DEDICATED var, added 2026-09-09** — falls back to `LP_GATEWAY_USDG` if
  unset) — **unset (and the fallback also wrong) ⇒ quote unknown ⇒ every pool ineligible ⇒ feed EMPTY
  (fail-closed) + `usdgConfigured:false`**, never by pair name. ⚠ **2026-09-09 incident:** `LP_GATEWAY_USDG`
  is registry's var (must equal the DEPLOYED rig's on-chain quote asset — today the testnet mock tUSDG) and
  was repointed to it on 2026-09-08 for that reason, which silently emptied Discover (a testnet mock
  address matches zero real mainnet GeckoTerminal pools). Fixed by splitting into its own var — set
  `LP_GATEWAY_DISCOVER_USDG` to the real mainnet USDG (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`)
  explicitly; `LP_GATEWAY_USDG` stays whatever registry needs, unchanged. See `deployments.md`. Token logos
  pass only **https + GT/CoinGecko CDN hosts** (`safeImg`); the fee tier comes from the
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
- **Routes** (`app/api/gateway/{discover,sparklines,instances,position,positions,leaderboard,alerts,deposit,withdraw,curate,request,meta,fee-reconciliation}`) — all
  `createHandler`. `fee-reconciliation` is bearer-gated (`ADMIN_SECRET`) — an operator-only read of the
  already-durable per-log paired-fee ledger (V1-07 above). `deposit`/`withdraw` **routes** require **signed-message auth + tx-hash idempotency** (M-04 —
  the route half; the `/earn/[pool]` client sends the signed body as of the O-1 closeout — verify in
  `V1PoolDetail.tsx`, it POSTed an unsigned body until 2026-09-08). `curate` bearer **fails
  closed** when `LP_GATEWAY_CURATOR_SECRET` unset (`?? ''`, not a literal — C-01; and no `NODE_ENV=development`
  free pass any more — O-12, `ALLOW_DEV_BEARER_BYPASS`). **O-8:** `sparklines` validates ids (20/32-byte hex)
  before keying, caps **≤ 12 ids/request** (`truncated:true` beyond — the client should batch), caches **per id**
  (LRU 500 + TTL, misses remembered, in-flight coalesced) and returns **429 from an in-memory per-IP floor even
  without Upstash**; `discover` has the same floor + `.eq('status','active')` for `live` (HO-11). Both declare
  `rateLimit`; the other public GETs (`instances`, `position(s)`, `leaderboard`, `meta`, `alerts`) still don't
  (HO-15, their owners). Harvest uses a swap seam (`routerSwap.ts#swapPairedToQuote`) to convert harvested
  paired-token fees back to quote — unrelated to deploy. **The deploy-side seam (`swapQuoteToPaired`) is GONE
  (earn-vs-lp decision)**: `deploy()` executes that swap in-contract now, so `lib/gateway/deploy.ts` only SIZES
  the call (`swapAmount`/`minPairedOut` from live pool state via `quoteToPairedAtSpot`), it no longer runs any
  swap of its own. **V1-07 (independent Codex audit, round-4, 2026-09-09): "paired-token fees are never
  converted."** Was true when raised; **the actual swap execution is now IMPLEMENTED (2026-09-10)** —
  `swapPairedToQuote` builds and submits a real Uniswap V4 exact-in single-hop swap (`buildV4SwapCalldata`)
  through Robinhood Chain **mainnet's** modified Universal Router (`0x8876789976dEcBfCbBbe364623C63652db8C0904`
  — testnet 46630, where the gateway is actually deployed today, has NO V4 deployment at all, confirmed
  against Uniswap's own docs). Remains a **fail-closed no-op today**: gated behind two independent flags
  (`NEXT_PUBLIC_MW_ROUTER_ENABLED` + `LP_GATEWAY_ROUTER_ADDRESS`), both unset on the current testnet
  deployment, so harvested paired fees still stay unconverted in the recipient wallet exactly as before — this
  closes the code gap, not the runtime behavior, until the gateway itself is ever deployed to a chain with a
  real router. **Honest verification scope (see the file's own header comment for full sourcing):** the swap
  encoding is based on the router's own live-verified function selectors + a third-party integrator's
  technical docs (neither Uniswap's nor Robinhood's own docs publish this struct) — NOT a fork test, NOT
  bytecode decompilation, NOT a live test transaction (none possible in this sandbox). An operator MUST verify
  with a small, monitored test swap before `LP_GATEWAY_ROUTER_ADDRESS` is ever set on a real deploy. 21 unit
  tests (`routerSwap.test.ts`) cover the encoding (decoded back from its own output, not a magic hex string)
  and every execution path incl. two Codex-caught hash-preservation cases: an error AFTER the swap tx is
  already submitted (receipt-wait failure, post-swap balance-read failure) now always preserves the real
  `txHash` for reconciliation instead of reporting `null` — an earlier draft lost it, making a submitted
  on-chain swap indistinguishable from one that never happened. The raw harvested paired amount was never lost
  either way: `lib/gateway/ledger.ts#indexHarvestLogs` already writes every `Harvested` log's `pairedFees` into
  `gateway_harvest_logs.paired_fees_atomic` (per-log, comprehensive), and
  `gateway_fee_ledger_reconciliation.gross_paired_atomic` sums it per pool. **Still genuinely open:** nothing
  reads `gateway_fee_ledger_reconciliation` through any API/UI today — the data is durably tracked but not yet
  EXPOSED to an operator or depositor. **A second residual, also honest (Codex live-watch, 2026-09-10): no
  automated reconciliation job.** `swapPairedToQuote` preserves `swapTx` even when confirmation/measurement
  fails after a real submit (see above) and `harvest.ts` durably records it in `harvest_events.swap_tx`,
  conservatively crediting `0` proceeds for that run rather than guessing — but nothing later re-checks such
  a pending `swap_tx` and retroactively credits the real `quoteOut` once it confirms; recovery today is
  manual (an operator looks the hash up on-chain). Building that reconciliation cron is new scope, not part
  of the fee-conversion work itself, and wasn't built without a separate decision to do so.
- **Depositable rule:** a pool is depositable only when `gateway_instances` holds an **`active`**, on-chain-verified
  (H-01) row for its **poolId** — the Discover `live` flag and `/earn/[pool]` must resolve through the registry, never
  through a pair label. The single-env `LP_GATEWAY_POSITION_MANAGER` fallback is bootstrap-only (O-2 closeout;
  see the registry agent's record for its final gating).
- Migrations: `20260906000001` (positions/harvest) · `_002` (registry) · `20260907000001` (idempotency) ·
  `_002` (position snapshots) · `_003` (alerts) · `20260908000002` (event-indexed fee ledger —
  `gateway_harvest_logs`/`gateway_fee_credits`/`gateway_fee_payouts` + the `gateway_fee_balances`/
  `gateway_fee_ledger_reconciliation` views; **this is where paired-token fee history is ALREADY durably
  tracked** — see V1-07 below, don't re-add it elsewhere) · `_003` (fee-ledger view security — **applied
  to prod, live-verified**) · `20260909000001` (cost-basis atomic writes — **applied to prod,
  live-verified**, see round-4 above) · `_002` (registry multi-row-per-pool history, Finding D) ·
  `_004` (cost-basis EVENT-ORDER fix — replaces the two `record_gateway_*_event` RPCs with a
  full-history-replay version that takes an EXTRA `p_block_number` arg, see the event-order note below) ·
  `_005` (cost-basis MANAGER-GENERATION fix — adds `position_manager` to `gateway_positions`'/
  `gateway_deposit_events`' identity; FINAL design, revised 2026-09-10 per Codex to-do items 2-4: both
  RPCs take `pg_advisory_xact_lock` first (concurrency) and operate on an EXACT `(wallet, pool, chain,
  positionManager)` match ONLY — no adopt-or-create, no migration-time backfill guess, ever. An orphaned
  pre-existing row (`position_manager IS NULL`) is left untouched and invisible to every generation until
  `scripts/verify-gateway-pm-attribution.mjs` resolves it from a real on-chain receipt) ·
  `_006` (`recompute_gateway_position` — the second half of that recovery: called by the script AFTER it
  resolves an orphaned row's real `position_manager`, to recompute the position from its now-correctly-
  attributed history; refuses rather than guesses over an incomplete one) ·
  `_007` (`apply_gateway_pm_attribution` — user directive 2026-09-10, "make recovery updates and
  recomputation atomic": ONE function combining `_006`'s event-UPDATE and recompute into a SINGLE
  transaction under the same advisory lock, closing the crash-window gap where a process killed between
  the two separate calls used to leave an event resolved but `gateway_positions` stale. Refuses a
  conflicting re-attribution to a different PM; reports `remaining_orphans > 0` rather than guessing when
  sibling rows for the same wallet/pool/chain are still unresolved — the script's own full idempotent
  sweep (`recomputeAllResolvedIdentities`) stays as a backstop for anything this doesn't close, e.g. an
  identity stranded by a run that predates this migration). `_007` also creates
  **`gateway_position_recompute_issues`** (user directive 2026-09-10, third Codex pass: "a manager whose
  recorded withdrawals exceed recorded minted shares can be skipped during recovery yet still appear
  complete") — a durable per-identity record of a skipped sibling's reason (`data_gap` or `over_burn`;
  the latter has every field populated and can't be found by a cheap NULL-field query, only by the actual
  replay `apply_gateway_pm_attribution` already does). Written when a sibling is skipped, cleared the
  moment that identity successfully recomputes — by `apply_gateway_pm_attribution` itself (its own cross-
  PM loop), by `_006`'s `recompute_gateway_position` (amended the same day so the script's backstop
  sweep, which calls that function directly for identities it didn't itself touch this run, also clears a
  stale issue once that identity resolves through it), AND by `_005`'s own `record_gateway_deposit_event`/
  `record_gateway_withdraw_event` (user directive 2026-09-10, fourth Codex pass: "if a late deposit/
  withdraw recording repairs the complete event replay, clear that identity's old recompute issue... do
  not clear it on incremental fallback or incomplete replay" — only the CLEAN full-history replay branch
  clears; the pre-existing single-delta fallback never does, since it hasn't proven a genuine resolution).
  Without all three writers, an identity healed via whichever path DIDN'T clear would read as incomplete
  forever even after its basis became fully accurate. Read by `lib/gateway/attributionCompleteness.ts`
  alongside the orphan/gap checks. ⚠ **`_004`, `_005` and `_006` are NOT backward-compatible like the
  earlier ones** — the deposit/withdraw ROUTES already call the RPCs with the new args (same commits as
  these migrations) but Postgres treats a different arg count as a DIFFERENT function; until `_004` and
  `_005` are BOTH applied (in order — `_005` builds on `_004`'s signature), there is NO matching RPC
  signature and `/api/gateway/{deposit,withdraw}` will 500 on every call (`record_failed`) — apply them
  PROMPTLY after this code deploys, the same way the prior cost-basis/RLS migrations were. `_006` and
  `_007` are additive (new functions/table, nothing else depends on them) and can be applied whenever
  convenient. **Deploy-ordering safety net:** `_005` (on the HOT deposit/withdraw path) and `_006`
  (recovery-only) both now reference `_007`'s new table before `_007` necessarily exists yet — each
  DELETE is wrapped in its own `EXCEPTION WHEN undefined_table THEN NULL` block, so applying `_004`+`_005`
  WITHOUT `_007` yet (a real, expected sequencing — `_007` is documented as "whenever convenient," not
  required alongside `_004`/`_005`) degrades to a harmless no-op on the clear step rather than breaking
  every normal deposit/withdraw; proven directly in `costBasisRpc.pglite.test.ts` by a dedicated test
  suite that applies every migration EXCEPT `_007` and confirms a fresh deposit still succeeds. Applying
  `_006` alone (without `_007`) is likewise safe for the same reason. On-chain funds are unaffected either
  way (this is display-only cost-basis bookkeeping). All **deny-all RLS**. **Env vars:** every
  `LP_GATEWAY_*` var is tabled in
  [`deployments.md`](deployments.md) → "LP Gateway (V1) — Robinhood Chain".
- **Historical PM attribution recovery** (`scripts/verify-gateway-pm-attribution.mjs`, independent Codex
  audit, to-do items 3/4, 2026-09-10): resolves orphaned (`position_manager IS NULL`) `gateway_deposit_events`
  rows from real on-chain receipts (`receipt.to`, decoded `Deposited`/`Withdrawn` event, cross-checked
  against the receipt's own `transactionHash` and the candidate PM's on-chain `poolKey()`) — never
  guesses; an unresolvable row (pruned node, chain reorg, event/user mismatch, hash/pool mismatch) stays
  explicitly unresolved. Dry-run by default (`node --env-file=.env.local
  scripts/verify-gateway-pm-attribution.mjs`); `--apply` calls `apply_gateway_pm_attribution` per resolved
  row (atomic event-update + recompute, `_007` — REVISED same-day to also atomically recompute every
  SIBLING position-manager identity sharing a wallet/pool/chain the moment its last orphaned row resolves,
  closing a cross-PM staleness gap Codex's live review caught), then a full idempotent self-heal sweep
  (`recomputeAllResolvedIdentities`) that gates every identity on having NO remaining orphaned rows for
  that wallet/pool/chain before publishing a basis. Not run against production data by anyone yet — an
  operator action, not something done automatically.
  **Release verification — deployed schema state** (`scripts/verify-gateway-schema-state.mjs`, user
  directive 2026-09-10; REWRITTEN same-day after Codex's live review caught the first version doing the
  exact thing it claimed not to): checks whether migrations `_004`–`_007`'s functions/columns/table
  actually appear in a real Supabase project's exposed schema. Genuinely read-only by construction — the
  script has no Supabase client import at all, only a plain `fetch` against PostgREST's own OpenAPI
  (Swagger) schema document, served on one GET to the REST root; every function/table/column check after
  that is a pure JSON-property lookup with no network call and nothing to execute. The FIRST version
  instead called the actual RPCs (`record_gateway_deposit_event` etc.) with a "harmless dummy identity" —
  Codex reproduced live that this genuinely inserted 2 `gateway_deposit_events` rows and 1
  `gateway_positions` row against real migrations, directly contradicting its own "never mutates
  anything" claim (a dummy identity avoids a ROW COLLISION, not the INSERT itself). It also classified any
  error other than a recognized "not found" code as proof of existence, so an expired/invalid credential
  reported every single check as "✅ FOUND." Both fixed by construction in the rewrite: the one network
  call that can fail (the schema fetch) returns a distinct `unknown` outcome — printed plainly and exits
  non-zero — never silently treated as "present." `node --env-file=.env.local
  scripts/verify-gateway-schema-state.mjs`; reads `SUPABASE_SERVICE_ROLE_KEY` from the OPERATOR's own env
  exactly like every other script here — never hardcoded, logged, or printed by the script itself. Proves
  an object is *exposed in the schema*, not that its current body/constraints/RLS match this repo, nor a
  specific migration version (a function can be redefined in place, as this session did repeatedly,
  without its PostgREST-visible name/signature changing) — and not that the SQL logic is *correct* (see
  `costBasisRpc.pglite.test.ts`/`.concurrency.test.ts` for that). ⚠ **Still not run against production by
  this session** — the `SUPABASE_SERVICE_ROLE_KEY` value was accidentally exposed in the session
  transcript while checking `.env.local` for the credential's *presence* (2026-09-10); the key must be
  rotated in the Supabase dashboard before anyone runs this (or any) script against prod with it. Same
  rotation requirement as whatever the originally-flagged exposure was — treat
  as an independent, additional reason, not a substitute investigation.
  **`costBasisComplete`** (the position routes above)
  is wired into the V1 UI (`V1PoolDetail`/`V1Portfolio`) — a warning line, a per-card badge, and a
  portfolio-level banner when any position's basis may still be incomplete.
  **Genuine multi-connection lock verification (2026-09-10 — CLOSED):** `lib/gateway/costBasisRpc.concurrency.test.ts`
  runs a REAL, precompiled Postgres binary (`embedded-postgres` devDependency — a real subprocess with a
  real TCP listener, not the single-connection embedded PGlite everything else here uses) and races two
  genuinely independent `pg` client connections against it: one test proves the exact
  `pg_advisory_xact_lock(hashtext(wallet||':'||pool), chainId)` key every gateway RPC takes actually blocks
  a second real connection (measured, not assumed); another launches two REAL concurrent
  `record_gateway_deposit_event` calls for the SAME identity via `Promise.all` and proves neither is a lost
  update (the combined basis/shares reflect BOTH deposits, both event rows persist); a third proves
  DIFFERENT identities never block each other (the lock is per-wallet+pool, not global). Self-skips
  (console.warn, never fails) if a real Postgres subprocess can't actually start in a given environment —
  matches the existing Forge fork-test convention (self-skip without `BASE_RPC_URL`) rather than making the
  whole suite fragile to sandbox differences. No Docker needed.

## Surfaces & the V1/V2 model
- **`/v1`** ([`app/v1/page.tsx`](../../app/v1/page.tsx)) = the live product (`V1Shell` + `V1Discover` — the
  rolling curated-pool feed). **Flag-independent** — reachable any time. `/earn/[pool]` = deposit; `/curate` =
  curator queue.
- **V1 is a PRODUCT the site links to, NOT a site-wide mode.** V2 (the marketing/landing) is the front door,
  unchanged. The bridge is `LiveTodayStrip` (a slim "Live now → /v1" band) + the `LaunchModal` "V1 · Live" track.
- ⚠ **`NEXT_PUBLIC_V1_MODE_ENABLED` is a legacy dark-launch flag — leave it OFF.** Flipping it ON swaps the
  ENTIRE public site to V1 faces (it replaced the landing once → an incident, 2026-09-07). Do not flip it.

## Deploy, tests, framing
> ⚠ **Test counts below are STALE post earn-vs-lp decision** (2026-09-08) — every `deploy()`-touching test
> across the gateway suite is being migrated to the new swap-based signature + a seeded-liquidity real-V4 rig
> (a fresh pool has nothing to swap against); re-run `pnpm forge:test` and update the counts here once that
> migration lands, per the reconcile-on-change rule.
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
- **Harvest destination:** `resolveHarvestDestination()` (`lib/gateway/harvest.ts`) now ALWAYS returns
  `'restake'` (earn-vs-lp decision — the A-4 per-depositor buffer-credit ledger is dropped; LP-Gateway V1
  never grows a protocol-custodied buffer). The `'buffer'` branch's code + `ledger.ts` credit machinery are
  left in place as dead code rather than ripped out (avoids a DB schema/migration pass in the same change) —
  it is simply unreachable now.
- **Hard copy lines** (same as the rest of the stack): **no more "idle-buffer" framing** (earn-vs-lp decision
  — LP never idles capital, Earn never pairs); **never** "spend the fees" undersell or "100% spendable"
  overclaim; no **deposit / savings / guaranteed / fixed-APY**; testnet-honest; a liquidity position carries
  impermanent loss (100% the user's, never Mintware's); external audit gates real value. `riskScore` never
  certifies safety.
