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
| O-6 | One `PRIVY_APP_SECRET` reaches every server wallet — `root`/`gateway` separation was address-level only | ✅ per-seat wallet-API authorization keys, attached as required wallet owners on prod, re-verified | item 3 below |
| §4 | Mainnet: which USDG yield source has capacity | ✅ exhaustively checked (all 39 vaults) — **none does**; documented as the standing blocker | [mainnet-yield-sources.md](mainnet-yield-sources.md) |
| §5 | External audit scope | ✅ audit-firm-ready scope/RFP package, measured LOC/toolchain/test inventory | [`../../lp-gateway-external-audit-scope.md`](../../lp-gateway-external-audit-scope.md) |
| — | Prod deploy break: `opengraph-image` crossed the Vercel Edge Function 1 MB cap (next 16.2.12) | ✅ moved off edge runtime (`next/og` doesn't require it) — now static, no size class applies | this file, §"Ops" below |

## Left for a human (with steps in the linked records)

1. ~~**Apply migrations**~~ ✅ **applied 2026-09-08** via the SQL Editor (`20260908000001_gateway_registry_history`,
   `20260908000002_gateway_fee_ledger`, `20260908000010_profile_avatars_storage`). Verified from the app side: all six
   tables + two views answer, `record_gateway_harvest(p_log, p_credits)` is callable (rejects an incomplete log on
   NOT NULL, transaction rolled back), bucket `avatars` exists (public, 2 MB, png/jpeg/webp).
2. ~~**Vercel env**~~ ✅ **done 2026-09-08**: `LP_GATEWAY_USDG`, `LP_GATEWAY_PM_CODEHASHES`, `LP_GATEWAY_CURATORS`
   (set to the gateway seat `0x18AE…663c`), `LP_GATEWAY_POSITION_MANAGER`/`STAGING`/`POOL_ADDRESS` (= the real 32-byte
   poolId) all set on prod+preview against rig **e** (`0x259a…f442`); `UPSTASH_REDIS_REST_URL/_TOKEN` were already set.
   `LP_GATEWAY_MULTICALL3` left at its canonical default (unset).
3. ~~**Privy authorization keys**~~ ✅ **done 2026-09-08** (O-6). Two P-256 keypairs generated in the Privy dashboard
   (*Keys and quorums*): `lp-gateway-seat-owner` and `root-seat-owner-2` (a first `root-seat-owner` attempt was
   closed before its private key was copied — Privy never shows it again — and is orphaned/unused, harmless).
   Private keys stored ONLY as `GATEWAY_ORACLE_PRIVY_AUTH_KEY` / `ROOT_ORACLE_PRIVY_AUTH_KEY` on Vercel prod+preview
   (+ the gateway one in `.env.robinhood.local`, root in `.env.local`) — never displayed in any tool output or chat.
   Sequenced to avoid an outage: keys generated + env set first (harmless — unused code path on `main` at the time);
   only AFTER PR #479 merged, deployed, and `/api/oracle/signer-check` confirmed both seats resolving with the new
   code, each key was attached as the wallet's **Owner** in the Privy dashboard (`0x18AE…663c` → `lp-gateway-seat-owner`;
   the "Execution Wallet" `0x7fD8…7E06` → `root-seat-owner-2`). Re-verified immediately after each: both `root` and
   `gateway` still resolve (`ok:true`, `matchesExpected:true`) on prod. `PRIVY_APP_SECRET` alone can no longer sign
   for either wallet — Privy requires the matching authorization signature per wallet.
4. **Mainnet**: fund the gateway seat (`0x18AE…663c`) with ETH on chain 4663; **yield-source capacity is the
   real blocker** — [`mainnet-yield-sources.md`](mainnet-yield-sources.md) enumerated ALL 39 USDG vaults on Robinhood
   Chain (not just the 2 known ones) and every single one currently returns `maxDeposit == 0` — there is no USDG
   yield source with open capacity today, and no T-bill/RWA alternative has deployed on this chain yet. Re-run the
   preflight periodically (or when Robinhood/Morpho announce a cap raise) to check; second-person sign-off on the
   pool; `preflight → dry-run → deploy → record → smoke` per the runbook once a source clears.
5. **External audit** of the converged stack before any third-party funds. Scope package ready:
   [`../../lp-gateway-external-audit-scope.md`](../../lp-gateway-external-audit-scope.md) — freeze the target commit
   on `main`, tag it `audit/lp-gateway-v1-freeze`, hand the firm that SHA.

## Ops: production deploy break + fix (2026-09-08, same day)

The auto-deploy of PR #479's merge (`74f9b9b1`) failed at the Vercel platform level — not a code bug in this round:
`The Edge Function "opengraph-image" size is 1.07 MB and your plan size limit is 1 MB.` `app/opengraph-image.tsx`
hadn't been touched since PR #354; the growth is in `next/og`'s own edge bundle (Satori + resvg), which grew just
enough between `next` 16.1.6 and 16.2.12 (O-13) to cross the cap. Fix: `next/og`'s `ImageResponse` doesn't require
the edge runtime — switched the route to `runtime = 'nodejs'`; since the image has no dynamic params it now
prerenders fully static (`ƒ` → `○`), so no Edge Function size class applies at all. Verified with a clean-cache
production build, pushed as a direct fast-forward to `main` (`865d504c`) given the live outage, redeployed,
re-verified `/api/gateway/meta`, `/api/oracle/signer-check`, and `/opengraph-image` (`200 image/png`) on prod.

## Residuals (accepted, documented)
Adapter per-block cap is an instant owner lever (delay, not loss) · `lastKnownIdle` staleness during a source outage
is conservative for the withdrawer · factory runtime is 945 B under EIP-170 · replay set is per-process (Upstash
nonce is the stronger follow-up) · discovery numbers are upstream-asserted (verdict is a human gate) · paired-leg
proceeds under `buffer` destination are un-attributed (use `restake`).
