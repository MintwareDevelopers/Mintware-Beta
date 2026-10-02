# V2-RWAs — the RWA liquidity vertical

> **Status (2026-10-01): testnet demo LIVE on Base Sepolia, unaudited, dark-launched.** A VERTICAL inside V2,
> not the hero (user decision 2026-10-01). Revived from the 2026-08-05 RWA shelve for the LiquidAcre
> partnership (land / real estate issuer, licensed). Campaigns, the RWA incentive layer, the issuer portal and
> the old `/rwa` venue stay shelved — see `docs/archive/rwa/SHELVED.md` (now marked superseded for the
> liquidity engine only).

## What it is

"Permissionless liquidity, compliant ownership." One **liquidity unit** per tokenized asset:

| Part | Contract | Note |
|---|---|---|
| Liquidity vault | `MintwareTreasuryVault` (**unchanged** V2 code) | senior = open LPs' USD at par, exits in USD only; junior = issuer's property inventory, locked ≥ 90 d, first-loss; idle-first (~80%) in an `IYieldAdapter` |
| Pool + hook | Uniswap v4 dynamic-fee pool + `contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol` | appraisal band (swaps ending outside revert unless they move TOWARD the appraisal), band fee, LP gated to the vault, vault's own unwind swaps exempt (already ±500-tick bounded by `MWTreasuryPositionLib`), **is the vault's oracle** via `oracleTick()`. Pinned at `setVault` to the vault's own pool id (no front-run binding to another pool). **Exit window:** trading stops when the appraisal goes stale (`maxAppraisalAge`); the oracle stays ready for `oracleGraceSecs` more (spot is frozen — only the vault's bounded unwinds move it), so LPs can still redeem; after that the vault fails closed until a fresh appraisal |
| Compliance | the issuer's permissioned token (ERC-3643-shaped) | the only gate is the token's transfer rule: BOTH sides of every transfer must be a permitted holder (enrolled infra) or registry-verified — so a buyer must be verified to receive, and a revoked holder cannot sell. LPs never touch the token. Vault, PoolManager, router enrolled once as permitted holders. Read through `src/rwa/interfaces/IRwaIdentityRegistry.sol`. |

Appraisal hardening: per-update step cap, min interval, a rolling-24 h aggregate drift cap (`maxDriftTicksPerDay`), max age + exit-window grace, keeper + config changes 48 h-timelocked after the
pool exists, pool must launch inside the core band of a fresh appraisal, guardian `pauseTrading` (never blocks
redemptions). Trust anchors are never instantly repointable (round-4 lesson).

**Testnet-only stand-ins** (`contracts-v4/src/rwa/testnet/`): `MockRwaIdentityRegistry`, `MockPermissionedPropertyToken`,
`DemoUSD` (valueless 6-dp), `DemoLendingAdapter` (SIMULATED yield — label it), `DemoSwapRouter` (stands in for the
issuer's licensed front end; delivers output straight to the buyer so the token gate checks the real recipient).
Never deploy these to a mainnet.

## Deployed (Base Sepolia 84532) — one home: `config/rwaDemo.deployment.json` + `config/rwaDemo.json`

Deployer / owner / keeper / guardian = the **dedicated `rwa` Privy seat** `0xAF8E…d5ca`
(`RWA_ORACLE_PRIVY_WALLET_ID` / `_ADDRESS` in `.env.robinhood.local`, created 2026-10-01). **No fallback to the
root or gateway seats** (`scripts/lib/rwaSigner.mjs`). All 8 contracts source-verified on BaseScan.
⚠ The seat has no wallet-API authorization key yet (O-6 pattern) — add one before anything beyond the demo.

## Scripts

| Script | Does |
|---|---|
| `scripts/deploy-rwa-demo.mjs` | pure-Privy deploy + wire + appraise + open + junior commit; resumable (`*.progress.json`) |
| `scripts/rwa-demo-lifecycle.mjs` | the 9-leg proof story → `config/rwaDemo.json`; the unverified buy and the over-band buy are sent with a fixed gas limit so they are MINED reverted (and it refuses an out-of-gas revert as proof); resumable |
| `scripts/verify-rwa-demo.mjs` | BaseScan source verification (Etherscan V2 API) |
| `contracts-v4/script/DeployRwaLiquidityUnit.s.sol` | Forge equivalent, for local fork rehearsals |

Rehearse on a fork: `anvil --fork-url https://base-sepolia-rpc.publicnode.com` + `RWA_REHEARSAL=1 RWA_REHEARSAL_KEY=<anvil key>`.
Gotchas learned: load-balanced RPCs serve reads a block behind the receipt → every post-write read/simulate retries;
gas estimates from a lagging node can be too low (the lending adapter mints accrued interest on deposit) → sends use
estimate × 1.6; `sepolia.base.org` works for viem but rejects anvil's fork probe (use publicnode for anvil).

## Live trading for demos

- **Demo trader** = a second Privy server wallet `0x6539…0bAC` (`RWA_TRADER_PRIVY_WALLET_ID` / `_ADDRESS`),
  VERIFIED in the registry, funded with testnet dUSD + WCP7 + gas, router-approved — `scripts/setup-rwa-demo-trader.mjs`
  (idempotent).
- **"Run a live trade" button** (market page, connected wallet) → `POST /api/rwa/live-trade` → `lib/rwa/liveTrade.ts`
  places ONE real trade leaning toward the appraisal (below → buy, above → sell, small random at par), sized to close
  part of the gap, clamped 40–250 dUSD. Gates (fail-closed): V2-RWAs flag + V2 gate; signed-message bound to action
  `mintware-rwa-live-trade`; signer ∈ `RWA_DEMO_OPERATORS` (falls back to `LP_GATEWAY_CURATORS`; unset ⇒ 503);
  rate limit + 12 s in-process cooldown. Proven locally: stranger 403, cross-action replay 401, operator 200 + real tx.
- **Background activity**: `node --env-file=.env.robinhood.local scripts/rwa-demo-activity.mjs` — same sizing, one
  trade every ~4 min (`RWA_ACTIVITY_SECS`, `RWA_ACTIVITY_MAX`). Run it before / during a meeting.
- **getLogs ranges:** `sepolia.base.org` caps `eth_getLogs` at 1,000 blocks — the live API reads history from
  `RWA_LOGS_RPC_URL` (default publicnode, ~10k ranges), incrementally (warm instances only scan new blocks).

## App surface (gated)

`/app/rwa` (overview) + `/app/rwa/[unit]` (live market) + `GET /api/rwa/unit` (live chain reads, 10 s cache).
Visible only when `NEXT_PUBLIC_V2_RWA_ENABLED === 'true'` **and** the V2 gate passes (`lib/v2/rwaGate.ts`) —
pages `notFound()`, the API 404s otherwise. Proof data: `lib/rwa/demo.ts` (reads `config/rwaDemo.json`).

## Open / not built

- Accredited / qualified-purchaser LP gate (3(c)(7) question) would need a vault change — out of v1 by decision.
- Collateral oracle (`RwaCollateralOracle`, branch `feat/rwa-data-oracle-poc`), rental-income routing, factory.
- External audit before any real value. Copy rules: no deposit / savings / guaranteed / fixed-APY framing.
- Tests: `contracts-v4/test/rwa/MintwareRwaLiquidityUnit.t.sol` (25, incl. a band fuzz) — every refusal asserted by its EXACT inner error (v4 `WrappedError` unwrapped); LP-gate tests mutation-checked.
- Adversarial review (2026-10-02, 54 agents, 23 confirmed): fixed — pool-binding front-run, stale-appraisal redemption freeze (exit window), daily drift cap, send-once resumable scripts, decoded revert reasons, exact-error tests, doc drift. Accepted + documented: band fee chosen from the PRE-swap tick (one swap can start core and end in spec at the core fee).
