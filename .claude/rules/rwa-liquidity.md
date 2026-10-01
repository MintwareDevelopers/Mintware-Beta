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
| Pool + hook | Uniswap v4 dynamic-fee pool + `contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol` | appraisal band (swaps ending outside revert unless they move TOWARD the appraisal), band fee, LP gated to the vault, vault's own unwind swaps exempt (already ±500-tick bounded by `MWTreasuryPositionLib`), **is the vault's oracle** via `oracleTick()` (stale ⇒ not ready ⇒ fail closed) |
| Compliance | the issuer's permissioned token (ERC-3643-shaped) | the ONLY check: whoever RECEIVES the token. Vault, PoolManager, router enrolled once as permitted holders. Read through `src/rwa/interfaces/IRwaIdentityRegistry.sol`. |

Appraisal hardening: per-update step cap, min interval, max age, keeper + config changes 48 h-timelocked after the
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

## App surface (gated)

`/app/rwa` (overview) + `/app/rwa/[unit]` (live market) + `GET /api/rwa/unit` (live chain reads, 10 s cache).
Visible only when `NEXT_PUBLIC_V2_RWA_ENABLED === 'true'` **and** the V2 gate passes (`lib/v2/rwaGate.ts`) —
pages `notFound()`, the API 404s otherwise. Proof data: `lib/rwa/demo.ts` (reads `config/rwaDemo.json`).

## Open / not built

- Accredited / qualified-purchaser LP gate (3(c)(7) question) would need a vault change — out of v1 by decision.
- Collateral oracle (`RwaCollateralOracle`, branch `feat/rwa-data-oracle-poc`), rental-income routing, factory.
- External audit before any real value. Copy rules: no deposit / savings / guaranteed / fixed-APY framing.
- Tests: `contracts-v4/test/rwa/MintwareRwaLiquidityUnit.t.sol` (18, incl. a band fuzz).
