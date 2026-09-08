# LP Gateway V1 — Audit Close-out Record (2026-09-08)

Everything on the post-audit list, what changed, where the proof is, and what is left for a human. Findings are
the IDs from [`../2026-09-08-consolidated.md`](../2026-09-08-consolidated.md). Each area has its own detailed
record (files, diffs-in-words, verification commands and outputs, residuals) linked below.

## Status by finding

| ID | Finding | Status | Record |
|---|---|---|---|
| C-1 … C-7 | Round-2 contract findings (pro-rata exit, best-effort LP leg, cost-basis cap, cached spot, no LP sourcing of shortfall, slippage bounds, `poke()`) | ✅ merged in #478 | consolidated §5 |
| C-9a | Adapter one-step `Ownable` | ✅ `Ownable2Step` + renounce disabled | [contracts-residuals.md](contracts-residuals.md) |
| C-9b | Factory doesn't verify adapter binding | ✅ `asset()`/`totalAssets()`/`vault()` checks (`AdapterAssetMismatch`, `AdapterUnreadable`, `AdapterAlreadyBound`) | contracts-residuals.md |
| C-10 | Reverting 4626 source bricks NAV reads | ✅ tolerant `_idle()` + `lastKnownIdle`; deposits/deploy/compound fail closed (`SourceUnavailable`), withdraw pays the LP leg and re-credits the idle claim | contracts-residuals.md |
| F-02 rec. 3 | `harvestRecipient` immutable → issuer freeze of the hot wallet unrecoverable | ✅ 48 h timelocked rotation (`proposeHarvestRecipient` / `acceptHarvestRecipient` / cancel) | contracts-residuals.md |
| CI | Fork suites never ran in CI | ✅ `forge-tests` job runs the fork + audit suites against the public RH RPC with retries | contracts-residuals.md |
| O-1 | UI deposit record unsigned (401 behind "Deposited ✓"); withdraw never recorded | ✅ signed recording on both, honest states + retry; Portfolio/positions chain-first | [ui-money-path.md](ui-money-path.md) |
| O-2 | Slug → env-PM fallback with `live:true` | ✅ `resolveInstanceStrict`: poolId keys, 404 on miss once registry populated, env rig tagged `env-fallback`/`live:false` + visible badge | ui-money-path.md |
| O-5 | CSP `connect-src` blocked the RH RPC | ✅ testnet + mainnet RPC origins added, nothing else loosened | ui-money-path.md |
| C-6 (UI) | No slippage bounds in the UI | ✅ `depositWithMin` / `withdrawWithMin` with a shown 1% floor, feature-detected (`meta.supportsMin`) | ui-money-path.md |
| O-9 | One global absolute-L `minLiquidity` | ✅ per-pool from spot (`computeDeployMinLiquidity`); out-of-range ⇒ refuse; env demoted to a floor | ui-money-path.md |
| O-10 | Signed txHash/pool not bound to body; 15-min replay | ✅ strict compare (401) + same-signature replay 409; UNIQUE tx_hash backstop kept | ui-money-path.md |
| O-3 / A-7 | Registry trusts a lookalike PM; upserts over active rows; curator bearer in the browser | ✅ factory or code-hash verification (fail closed if neither), staging/controller/quote-vs-env checks, hooked keys rejected, read-before-write + logged `deactivateInstance`, append-only history table, curator = signed-message allowlist | [registry-ledger.md](registry-ledger.md) |
| O-4 / A-4 | DB-share-weighted harvest; ledger never written; monitor overwrites | ✅ event-indexed (`Harvested`+`Deposited`), on-chain-share-weighted at the harvest block, one idempotent plpgsql write, own tables (deny-all RLS), sweeps credited, reconciliation views; `restake` default; monitor refuses gateway-linked rows | registry-ledger.md |
| O-7 | Feed poisoning (score steerable, APR unbounded, USDG by name, prune evicts) | ✅ clamped numerics only, https+CDN allowlist, fee tier from pool field, APR bounded, USDG by address only (unset ⇒ empty feed, fail-closed), 8 s timeout + bounded retries, prune grace never touches curator rows | [discovery-hygiene.md](discovery-hygiene.md) |
| O-8 | `/sparklines` fan-out; rate limits no-ops | ✅ ≤12 ids, LRU+TTL, coalescing, in-memory per-IP 429 floor on discover/sparklines; `rate limiting INACTIVE` logged once at boot | discovery-hygiene.md |
| O-11 | Leaderboard Σ`entry_nav` inflates | ✅ ranks on-chain value (multicall `sharesOf`/`totalNav`/`totalShares` at one block), `source:'chain'|'db'` + `degraded` flag, never silently mixed | [profile-leaderboard.md](profile-leaderboard.md) |
| O-12 | Dev-mode bearer bypass | ✅ fails closed; local opt-in only with `ALLOW_DEV_BEARER_BYPASS=true` + `NODE_ENV=development` | discovery-hygiene.md |
| O-13 | `next` advisories | ✅ 16.1.6 → 16.2.12 (closes all 28 `next` advisories); webpack build verified | discovery-hygiene.md |
| O-14 | Docs drift (24 items) | ✅ rules/docs/runbook reconciled; full `LP_GATEWAY_*` env table with defaults + fail-closed behavior | discovery-hygiene.md |
| §1 | Mainnet deployment path | ✅ read-only preflight (41 checks) + Privy-signed deploy script with `--dry-run`; pool curation policy; mainnet runbook; risk-disclosure paragraphs | [mainnet-path.md](mainnet-path.md) |
| §6 | True PFP upload | ✅ Supabase Storage, magic-byte MIME sniff, content-bound signature, ≤2 MB | profile-leaderboard.md |
| — | Off-chain audit PoC suites | ✅ flipped to assert post-fix behavior (kept as evidence) | [offchain-pocs-flipped.md](offchain-pocs-flipped.md) |

## Left for a human (with steps in the linked records)

1. ~~**Apply migrations**~~ ✅ **applied 2026-09-08** via the SQL Editor (`20260908000001_gateway_registry_history`,
   `20260908000002_gateway_fee_ledger`, `20260908000010_profile_avatars_storage`). Verified from the app side: all six
   tables + two views answer, `record_gateway_harvest(p_log, p_credits)` is callable (rejects an incomplete log on
   NOT NULL, transaction rolled back), bucket `avatars` exists (public, 2 MB, png/jpeg/webp).
2. **Vercel env** (prod + preview): `LP_GATEWAY_USDG` (the feed is EMPTY until set — fail-closed), `LP_GATEWAY_PM_CODEHASHES`
   (or `LP_GATEWAY_FACTORY`), `LP_GATEWAY_CURATORS` (curator wallet addresses that will sign in the browser),
   `LP_GATEWAY_POOL_ADDRESS` = the 32-byte poolId, optional `LP_GATEWAY_MULTICALL3`, `UPSTASH_REDIS_REST_URL/_TOKEN`.
3. **Privy authorization keys** (O-6, code support shipped — `<ROLE>_ORACLE_PRIVY_AUTH_KEY`): in the Privy dashboard →
   *Wallet API → Authorization keys*, generate TWO keypairs (one per seat); attach each as an **owner** of the matching
   server wallet (`gateway` = `0x18AE…663c`, `root` = `0x7fD8…7E06`); set `GATEWAY_ORACLE_PRIVY_AUTH_KEY` and
   `ROOT_ORACLE_PRIVY_AUTH_KEY` on Vercel prod+preview (and the gateway one in `.env.robinhood.local` for the deploy/smoke
   scripts); redeploy; confirm `GET /api/oracle/signer-check` still resolves both seats. From then on `PRIVY_APP_SECRET`
   alone cannot sign for either wallet.
4. **Mainnet**: fund the gateway seat on 4663; choose a Morpho USDG vault with capacity (Steakhouse USDG currently
   `maxDeposit == 0`); second-person sign-off on the pool; `preflight → dry-run → deploy → record → smoke` per the runbook.
5. **External audit** of the converged stack before any third-party funds.

## Residuals (accepted, documented)
Adapter per-block cap is an instant owner lever (delay, not loss) · `lastKnownIdle` staleness during a source outage
is conservative for the withdrawer · factory runtime is 945 B under EIP-170 · replay set is per-process (Upstash
nonce is the stronger follow-up) · discovery numbers are upstream-asserted (verdict is a human gate) · paired-leg
proceeds under `buffer` destination are un-attributed (use `restake`).
