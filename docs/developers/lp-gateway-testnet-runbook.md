# LP Gateway — Robinhood Testnet Runbook (owner/ops)

Stand up + run the full phase-1 loop on **Robinhood Chain testnet (46630)** against the real,
bytecode-verified V4 stack. Everything here needs a funded testnet key (I can't run it). All amounts
are test tokens with no value.

## Verified testnet infrastructure (checked on-chain via `eth_getCode`)
- Chain id **46630** · RPC `https://rpc.testnet.chain.robinhood.com` · gas faucet
  `https://faucet.testnet.chain.robinhood.com/`
- V4 **PoolManager** `0x8366a39CC670B4001A1121B8F6A443A643e40951` — canonical (byte-identical to Base's V4 core).
- V4 **PositionManager** `0x58daec3116aae6D93017bAAea7749052E8a04fA7` — embeds the PoolManager + Permit2.
- **Permit2** `0x000000000022D473030F116dDEE9F6B43aC78BA3` — canonical.
- ⚠ No USDG / Morpho vault / meme pool on testnet — so the setup script deploys a **mock rig** (mock
  USDG + mock paired token + mock yield adapter + a fresh V4 pool). Mainnet uses the real USDG + Morpho.

## 1. Fund a deployer key
Add network 46630 (RPC above), then get gas from the faucet.

## 2. Stand up the rig
```bash
export PATH="$HOME/.foundry/bin:$PATH"
forge script contracts-v4/script/SetupLpGatewayTestnet.s.sol \
  --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast --private-key $DEPLOYER_KEY
```
Deploys tUSDG (6dp) + tPONS (18dp) + a mock yield adapter, **initializes a fresh V4 pool** (hookless,
0.30% / tickSpacing 60, price 1.0), deploys the gateway (owner + harvestRecipient = deployer), and mints
1M of each token to the deployer. It logs every address.

## 3. Apply the migration + set env
```bash
supabase db push   # applies 20260906000001_lp_gateway.sql
```
On Vercel (Production + Preview), from the script output:
```
LP_GATEWAY_POSITION_MANAGER = <PositionManager>
LP_GATEWAY_STAGING          = <Staging>
LP_GATEWAY_POOL_ADDRESS     = <a label/poolId you key the DB by, e.g. tpons-usdg>
LP_GATEWAY_CHAIN_ID         = 46630
LP_GATEWAY_RPC_URL          = https://rpc.testnet.chain.robinhood.com
```

## 4. Deposit (proves stage-and-earn)
Client flow: approve tUSDG → `positionManager.deposit(amount)` → `POST /api/gateway/deposit {address,txHash}`.
Or via cast:
```bash
cast send $TUSDG "approve(address,uint256)" $POSITION_MANAGER 1000000000 --private-key $KEY --rpc-url $RPC
cast send $POSITION_MANAGER "deposit(uint256)" 1000000000 --private-key $KEY --rpc-url $RPC   # 1,000 tUSDG
```
`totalNav()` should read back ~the deposit; the idle USDG is earning in the mock adapter.

## 5. Deploy staged capital into the pool
The router zap is unwired (deploy-gated seam), so supply the paired leg manually (the deployer holds
tPONS). Approve tPONS to the PositionManager (Permit2) and call `deploy(quoteToDeploy, pairedAmount, deadline)`
as the **owner**. This mints the aggregate V4 position — the pool now has real liquidity.

## 6. Generate swaps → harvest
Route a few swaps through the pool (Universal Router / cast) so it accrues fees, then hit the harvest
cron (or call `harvest(deadline)` as owner). Set `LP_GATEWAY_HARVEST_ENABLED=true` first; it collects fees
(zero-liquidity-delta), skims the perf fee, and credits the linked spend buffer pro-rata. `harvest_events`
records the run.

## Flags (all default OFF / fail-closed)
`LP_GATEWAY_HARVEST_ENABLED` · `LP_GATEWAY_DEPLOY_ENABLED` · `LP_GATEWAY_DEPLOY_THRESHOLD_ATOMIC` ·
`LP_GATEWAY_PERF_FEE_BPS` (default 1000 = 10%). The paired↔quote **router executor**
(`LP_GATEWAY_ROUTER_ADDRESS`) is the one code seam still to wire before harvest/deploy auto-run.

## What stays gated for MAINNET (not testnet)
Real USDG + the Morpho Steakhouse vault (via `MintwareERC4626YieldAdapter`) instead of the mock rig, a
real meme pool, the router executor, and an external audit before real value.
