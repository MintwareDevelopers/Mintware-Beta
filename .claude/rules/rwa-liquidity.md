# RWA owned pools — Base Sepolia only

The RWA vertical uses `MintwareOwnedPoolMarketEngine`, `MintwareRwaAppraisalHook`,
and Uniswap Permissioned Pools. The engine owns a direct PoolManager position.
See `docs/developers/rwa-on-engine.md` for the deployment sequence and current proof limits.

## Assets and claims

- PoolKey currencies are the verified PermissionsAdapter and chain USDC, sorted by address.
- Engine tokens, NAV, contributions, idle custody and payouts use underlying property and USDC
  in the corresponding pool order. Never sort the underlying addresses again.
- Adapter units map 1:1 to property units. PoolManager alone holds virtual adapter currency.
- Non-transferable engine shares track proportional holdings. New shares require issuer LP
  permission for recipient and engine, plus engine wrapper approval.
- Native issuer custody permission is separate: adapter, engine, idle adapter, contributors
  and payout recipients must satisfy the property's transfer rules.

## Permission and appraisal hook

- Pin one verified adapter/USDC key before publishing a dated appraisal and initializing.
- Bind one inactive engine after initialization; its mark, manager, assets and pool must match.
- Trusted wrappers report the principal via `msgSender()`. Check wrapper trust before calling it.
- Every trader needs `SWAP_ALLOWED`; the adapter swap switch must be enabled.
- Only the bound engine adds/removes liquidity. Adds need wrapper and LP permission.
- Removal and fee collection ignore permission revocation, checker outage, pause and freshness.
- Trading requires a fresh observed appraisal and an unpaused hook. No undated refresh exists.
- Fees use the pre-swap band. Trades ending outside the outer band must close the gap on the
  same side of appraisal. Crossing beyond the opposite boundary is refused.
- MW-03: sum absolute movements in every rolling 24-hour window, including reversals;
  each movement expires individually. Per-step cap and publication cadence also apply.
- Observation time cannot be zero, future or non-increasing; a report hash is mandatory.
- Keeper/config changes retain 48-hour timelocks; appraisal age/grace freeze at pinning.
- Full in-kind exits need no mark, even after grace. Incomplete delivery requires a valid
  grace mark and retains shares for the undelivered value. Issuer freezes still affect delivery.
- No forced recovery, seizure or PositionManager NFT fallback is supplied by this backend.

## Installation and routing

Canonical installer: `contracts-v4/script/DeployRwaOwnedPool.s.sol`.
It validates Base Sepolia manager/USDC, creates or validates the official factory adapter,
seeds/verifies it, mines/deploys the hook, pins/appraises/initializes, creates the inactive engine,
binds it, and configures two idle adapters. No private-key environment variable is read.
Issuer permissions, qualified holders and trusted Universal Router approval precede activation.
Only unsigned local dry-runs are authorized for this rollout; nothing has been broadcast.

Pins:
- v4-periphery-permissioned `3245c3cb99c48fa1dc2459c3b60abc37d4294aba`
- v4-hooks-public `f2aa843e266f8f9b34fdaf94ffb72eda5d9204f9`
- Universal Router 2.2.0 `64027f3372aa235734207c4e05667204f6f927e1`

The existing hookless v4-periphery checkout is unchanged. Actual Universal Router tests live
in the `permissioned_router` Forge profile, with the pinned v2/v3 dispatch dependencies initialized.
Run it alongside the default suite. The ordinary suite exercises the real permissioned router
core through its test-only allowance entrypoint. Module runtime pins include compiler metadata;
refresh all consumers and the checked-in creation hex together when build inputs change.

## App and registry

- `/api/rwa/unit` reads the configured `RWA_OWNED_ENGINE_ADDRESS` on Base Sepolia at one block.
- Shared ABI/readers: `lib/web3/artifacts/marketEngine.ts`, `lib/gateway/marketEngine.ts`.
- Reads expose NAV, share supply, holdings, position, dated appraisal, band and permission flags.
- No engine configured means **Not deployed yet**. RPC failures are unavailable or explicitly cached.
- Archived snapshots never substitute for live state. No projected interest or simulated rates.
- `MARKET_OWNED_ENGINE_CODEHASHES_84532` approves concrete owned wrapper runtimes.
  Verify hook/engine binding, factory verification, adapter→underlying mapping and canonical USDC.
- The previous transaction proof remains under `config/rwa-archive/`; only the archived proof
  page reads it. The old demo writer endpoint returns 410. Old trading/refresh scripts are removed.

## Boundaries

Testnet only, unaudited composition. No partner names, monetary-value claims, savings language
or promised returns. Keep the owned engine below EIP-170; move new logic into helpers rather
than growing its runtime. Preserve all existing engine invariants and meaningful refusal tests.
