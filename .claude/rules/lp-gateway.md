# MarketEngine V1 (formerly LP Gateway)

> **Gateway retired.** The former PositionManager/Staging product, staged-deploy-harvest loop, fee/cost-basis
> ledger, and portfolio / leaderboard surfaces are retired. The `gateway_*` names remain in routes and registry
> tables for compatibility. Do not describe the old Gateway mechanics as current.

## Product and status

`MintwareMarketEngine` (`contracts-v4/src/vaults/MintwareMarketEngine*.sol`) is the current V1 liquidity product.
There is one engine for each curated Uniswap v4 pool. It issues one share token (`MWMS`) valued in the pool's
configured quote asset. Capital is held in a resting v4 liquidity band and in per-token ERC-4626 adapters;
Robinhood testnet's adapters are idle-custody adapters, so assets there are held ready and do not earn yield.

Deposits can contain either or both pool tokens and require a fresh external mark, spot within the configured
mark-deviation limit, and a nonzero minimum-shares floor. Withdrawals are pro-rata and in-kind (both pool tokens)
with caller-supplied minimum outputs; full delivery needs no fresh mark, while a failed recipient leg requires a fresh mark and retains shares worth the undelivered value. Owner/keeper lifecycle actions deploy or
remove liquidity, collect fees, swap idle balances with explicit limits, and guardedly recenter the band.
Automated zapping, JIT liquidity, and a staged-buffer flow are not implemented.

Live deployments are testnet-only and unaudited; external audit gates real value. The Robinhood Chain testnet
instance is `0x38E426D6671FB2c07C07a468e59f954Dcd0eDeb8`, registered for pool
`0x07340da7…0dfa2` (tUSDG/tPONS); its mark is fixed with a one-year maximum age. Base Sepolia engine (USDC/WETH, relaunched
2026-10-30 because the first one's immutable fixed mark went stale — `StaleMark()`): `0x961534db8C0EbB7cEb729E74CaB698A83A9c827e`,
same one-year-max-age fixed-mark shape; registering it needs `MARKET_ENGINE_{CODEHASHES,OWNER,QUOTE_ASSET}_84532`. Robinhood lifecycle module:
`0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421`. Full addresses belong in [`config/deployments.json`](../../config/deployments.json).

## Discovery, curation, registry

Discover consumes GeckoTerminal pool data and assigns a risk score that ranks candidates; it never certifies a
pool. Curated instances live in `gateway_instances`; actions/history in `gateway_instance_history`, requests in
`gateway_pool_requests`, and receipt-verified user actions in `market_engine_tx_events`. Position balances are
read from the engine on-chain. The legacy routes under `/api/gateway/*` now resolve or act on MarketEngine
instances; `POST /api/gateway/position` returns 410 because buffers are unsupported. `/v1/portfolio` and
`/v1/leaderboard` are retired.

Current configuration is `MARKET_ENGINE_INSTANCES`, `MARKET_ENGINE_CHAIN_ID`, `MARKET_ENGINE_RPC_URL`,
`MARKET_ENGINE_OWNER`, `MARKET_ENGINE_QUOTE_ASSET`, and `MARKET_ENGINE_CODEHASHES`. Legacy `LP_GATEWAY_*`
settings are not MarketEngine deployment configuration. A small subset remains read for Discover and curator
authorization; see [`deployments.md`](deployments.md) and `rg -n 'LP_GATEWAY_' app lib scripts`.

## Code pointers

- Contracts: `contracts-v4/src/vaults/MintwareMarketEngineCore.sol`, `MintwareMarketEngine.sol`,
  `MintwareMarketLifecycleModule.sol`, `MintwareIdleYieldAdapter.sol`.
- App integration and registry: `lib/gateway/marketEngine.ts`, `lib/gateway/registry.ts`,
  `app/api/gateway/*`, `app/(web2)/v1/*`, and `components/web2/v1/*`.
- Discover: `lib/gateway/discovery.ts`, `lib/gateway/riskScore.ts`, and the scheduled Discover route.
- Deployment truth: [`config/deployments.json`](../../config/deployments.json).
