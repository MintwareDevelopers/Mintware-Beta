# Vaults and liquidity

> **Current status:** testnet, unaudited. External audit gates real value. The old ULV/JIT/MEV and matched-launch
> descriptions below are not current product functionality.

## MarketEngine V1

The live liquidity product is [`lp-gateway.md`](lp-gateway.md): one `MintwareMarketEngine` per curated Uniswap v4
pool, one quote-valued share token, token-specific ERC-4626 adapters, a resting liquidity band, guarded recentering,
and pro-rata in-kind exits. Robinhood testnet adapters are idle custody only. Do not describe stage → deploy →
harvest automation, yield while staged, compounding, spend-in-place, JIT, or MEV capture as live.

## Earn

`MintwareYieldVault` (`mwEARN`) is a separate single-source ERC-4626 product, not the liquidity engine. Its behavior,
pause semantics, and partial illiquid exits are documented in [`payments-ypn.md`](payments-ypn.md).

## Retired / parked contracts

Older pair vaults, staged-liquidity router, matched-launch issuance, ULV/JIT hooks, Treasury senior/junior issuance,
and MarketEngine V3/JIT are retired or parked. Some testnet deployments and historical audit material remain; their
presence in source or on-chain is not evidence of current product support. Deployment status is maintained only in
[`config/deployments.json`](../../config/deployments.json).

## Code pointers

- `contracts-v4/src/vaults/MintwareMarketEngineCore.sol`
- `contracts-v4/src/vaults/MintwareMarketEngine.sol`
- `contracts-v4/src/vaults/MintwareMarketLifecycleModule.sol`
- `contracts-v4/src/payments/MintwareYieldVault.sol`
