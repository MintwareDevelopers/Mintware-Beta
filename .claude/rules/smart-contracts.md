# Smart contracts

## Current product contracts

| Contract | Current behavior |
|---|---|
| `MintwareMarketEngine` / `MintwareMarketEngineCore` | One curated Uniswap v4 pool per engine; one quote-valued `MWMS` share; one- or two-token deposits with minimum shares; resting liquidity band plus per-token adapters; fresh mark and spot-deviation checks for deposits; guarded recenter; pro-rata in-kind withdrawals with minimum outputs. See [`lp-gateway.md`](lp-gateway.md). |
| `MintwareMarketLifecycleModule` | Lifecycle support module used by MarketEngine deployments. |
| `MintwareYieldVault` | ERC-4626 `mwEARN` vault over one yield adapter. Pause blocks deposits/mints only; exits can pay available liquidity while unpaid shares remain. |
| `MintwarePaymentGateway` | Relayer-only Earn-share refill to a member's registered buffer wallet. No merchant settlement or spend-from-NAV entry point. |
| `MintwareIdleYieldAdapter` | Custody-only adapter; assets remain held and do not earn yield. Used by the Robinhood testnet MarketEngine. |
| `AIAttribution` v3 | Fundless attestation ledger on Base mainnet; the only current mainnet contract entry. |
| `MintwareRwaAppraisalHook` and RWA demo contracts | Testnet demonstration only; not a production asset or valuation service. |

## Deployment status

MarketEngine and Earn deployments are testnet-only and unaudited; external audit gates real value. The current
deployment record is [`config/deployments.json`](../../config/deployments.json), which also marks retained legacy
deployments as deprecated. Source files or historical deployments do not establish that a feature is current.

## Retired and parked systems

The LP Gateway PositionManager/Staging system and its stage/deploy/harvest/compound/restake mechanics are retired.
Arc/CCTP, Lithic, spend-in-place YPN, Treasury senior/junior issuance, matched launch, lock tiers, and live ULV/JIT/MEV
claims are also retired or parked. MarketEngine V3/JIT is parked. Do not use these as descriptions of the current
product. Dated audit and design documents remain historical records.

## Forge

- Solidity sources: `contracts-v4/src/`
- Tests: `contracts-v4/test/`
- Run `pnpm exec vitest run` for the TypeScript suite; Forge command details are in [`testing.md`](testing.md).
