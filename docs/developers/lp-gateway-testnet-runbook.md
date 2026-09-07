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

## 1. Provision + fund the Privy signer (no raw key)
The recommended path is **pure-Privy**: the Privy ROOT server wallet signs every deploy tx, so no raw
key exists anywhere and the same seat that runs the harvest/deploy crons stands the rig up.

```bash
# a) create the Privy root server wallet (prints the public id + address)
PRIVY_APP_ID=... PRIVY_APP_SECRET=... node scripts/provision-privy-oracle-wallet.mjs
# b) add network 46630 (RPC above) and fund ROOT_ORACLE_PRIVY_ADDRESS from the faucet
#    https://faucet.testnet.chain.robinhood.com/
```

## 2. Stand up the rig (pure-Privy)
```bash
export PATH="$HOME/.foundry/bin:$PATH"
pnpm forge:build     # produce contracts-v4/out artifacts the deploy reads
ORACLE_SIGNER_PROVIDER=privy PRIVY_APP_ID=... PRIVY_APP_SECRET=... \
ROOT_ORACLE_PRIVY_WALLET_ID=... ROOT_ORACLE_PRIVY_ADDRESS=0x... \
pnpm deploy:lp-gateway:robinhood
```
`scripts/deploy-lp-gateway-robinhood.mjs` deploys tUSDG (6dp) + tPONS (18dp) + a mock yield adapter,
**initializes a fresh V4 pool** (hookless, 0.30% / tickSpacing 60, price 1.0), deploys the gateway
(owner + harvestRecipient = **the Privy signer**), wires `setController`, mints 1M of each token to the
signer, and prints the exact `LP_GATEWAY_*` env block. It gas-preflights and fails closed with a faucet
nudge if the signer is unfunded.

> Raw-key alternative (only if you don't want Privy): the equivalent Foundry script is
> `contracts-v4/script/SetupLpGatewayTestnet.s.sol` (`forge script … --broadcast --private-key $DEPLOYER_KEY`)
> — same rig, but a raw key signs. The pure-Privy path above is preferred.

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
`LP_MAX_DEVIATION_BPS` (deploy-time, default `2000`) sizes the flash-manipulation breaker (below).

## Self-audit hardening (in the contracts — see `lp-gateway-v1-audit.md`)
Four findings from the V1 blockchain self-audit are fixed on-chain:
- **C1 (spot-NAV flash manipulation).** The deployed LP leg is spot-priced and a hookless meme pool has
  no on-chain TWAP. Defense is layered: a **deposit/withdraw deviation breaker** (`maxDeviationBps`,
  default 20% of sqrtPrice) that reverts when live spot deviates from a per-block-anchored reference — a
  single-block flash pump can't move NAV without tripping it — plus a **same-block guard** (one address
  can't deposit+withdraw in a block) and the **capped deploy ratio** (most capital stays idle in Morpho,
  which is spot-immune). If sharp *legitimate* volatility ever locks the breaker against a stale anchor,
  the owner calls **`pokePrice()`** to re-anchor (moves no funds). Residual: a patient cross-block
  manipulator on a THIN pool isn't fully stopped on-chain — **deep-pool curation is the backstop**, and
  mainnet stays audit-gated.
- **M1 (staging controller front-run).** `setController` is now deployer-only (the factory), so no one
  can claim the un-set controller seat between deploy and wiring.
- **M2 (adapter reuse).** The factory rejects reusing one yield adapter across two gateways (which would
  pool their staged capital and cross-contaminate NAV). Each gateway gets its own adapter.
- **Owner fee-redirect.** `harvestRecipient` is now **immutable** — the owner can never repoint the fee
  stream after deploy.

## IL control (the two knobs that diminish impermanent loss)
We are NOT locked into a pool's range — the gateway picks its own. Two levers, minimized by default:
- **Range width** — set at deploy via `LP_TICK_LOWER`/`LP_TICK_UPPER`. Default **±22980 ticks (~10x-up /
  −90%-down)** for meme pools: low IL, no out-of-range cliff, no rebalancing. Widen to ±887220
  (full-range, lowest IL, least fee-efficient) or tighten for more fee capture. A fixed range per
  gateway instance — redeploy to change it.
- **Deploy ratio** — `LP_GATEWAY_DEPLOY_RATIO_BPS` (default **5000 = 50%**). Only this fraction of staged
  capital enters the IL-bearing LP; the rest stays idle in Morpho earning lending yield with **zero IL**.
  Lower it for a more conservative posture.

Note: IL can be *diminished*, never *eliminated*, for a fee-earning LP — earning swap fees requires being
in-range, which requires two-sided exposure. The thesis is that the high meme fee flow out-earns the
residual IL; "no par claim" stays honest. Managed rebalancing + a fee-funded IL reserve are phase-2.

## Flip on the V1/V2 split (serve V1, gate V2 for investors)
The whole site defaults to the V2 vision until you flip it. On Vercel:
```
NEXT_PUBLIC_V1_MODE_ENABLED = true     # default visitors now get V1 (the live LP Gateway) everywhere
V2_PASSWORD                 = <share with investors out-of-band>
```
Then: a normal visitor lands on the LP Gateway (homepage, `/app`, and every marketing page render their
V1 face; "Launch app" → the gateway, no V2 modal). An investor opens **`/v2`**, types the password → the
whole site flips to the full V2 vision (treasury OS, YPN, cards, agents) for their session. With the flag
OFF (default) nothing changes — V2 shows everywhere, exactly as today.

## Curate pools (auto-surfaced → one-click approve)
- The `/cron/gateway-discover` cron auto-ingests the top-30 hottest RH-Chain pools (GeckoTerminal) as
  **pending candidates** with a risk score — visible at `GET /api/gateway/curate`, ranked safest-first.
- Set `LP_GATEWAY_CURATOR_SECRET` on Vercel to enable curation. Approve/reject via `POST /api/gateway/curate`
  (bearer = that secret). An approve carrying the deployed gateway addresses registers the live instance in
  one call. The risk score RANKS the queue; it never certifies safety (no honeypot/hook sim) — every pool
  is a human decision.

## What stays gated for MAINNET (not testnet)
Real USDG + the Morpho Steakhouse vault (via `MintwareERC4626YieldAdapter`) instead of the mock rig, a
real meme pool, the router executor, and an external audit before real value.
