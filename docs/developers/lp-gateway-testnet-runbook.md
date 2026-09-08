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
  USDG + mock paired token + a mock ERC-4626 yield *source* + a fresh V4 pool) behind the **production
  yield adapter** (`MintwareERC4626YieldAdapter`: `onlyVault`, one-time `setVault`, fee-net best-effort
  exits). Re-audit A-5: the earlier rigs ran the test `MockYieldAdapter`, whose `withdraw` had no access
  control — anyone could drain the staged reserve; never point value at such a rig. Mainnet swaps only
  the *source* (the curated Morpho vault, via `LP_GATEWAY_YIELD_SOURCE`) and the real Paxos USDG.

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
`scripts/deploy-lp-gateway-robinhood.mjs` deploys tUSDG (6dp) + tPONS (18dp) + a `MockERC4626` yield
source (or uses `LP_GATEWAY_YIELD_SOURCE`, asset-checked) + the `MintwareERC4626YieldAdapter`,
**initializes a fresh V4 pool** (hookless, 0.30% / tickSpacing 60, price 1.0), deploys the gateway
(owner + harvestRecipient = **the Privy signer**), wires `setController` **and the adapter's one-time
`setVault(staging)`** (asserting both read back), mints 1M of each token to the
signer, and prints the exact `LP_GATEWAY_*` env block. It gas-preflights and fails closed with a faucet
nudge if the signer is unfunded.

> Raw-key alternative (only if you don't want Privy): the equivalent Foundry script is
> `contracts-v4/script/SetupLpGatewayTestnet.s.sol` (`forge script … --broadcast --private-key $DEPLOYER_KEY`)
> — same rig, but a raw key signs. The pure-Privy path above is preferred.

## 3. Apply the migrations + set env
```bash
supabase db push   # applies 20260906000001 (positions/harvest) · 20260906000002 (registry) ·
                   # 20260907000001 (idempotency) · 20260907000002 (snapshots) · 20260907000003 (alerts)
```
On Vercel (Production + Preview), from the script output:
```
LP_GATEWAY_POSITION_MANAGER = <PositionManager>
LP_GATEWAY_STAGING          = <Staging>
LP_GATEWAY_POOL_ADDRESS     = <the 32-byte v4 poolId — NEVER a label like "tpons-usdg" (audit HO-2/HO-14)>
LP_GATEWAY_CHAIN_ID         = 46630
LP_GATEWAY_RPC_URL          = https://rpc.testnet.chain.robinhood.com
LP_GATEWAY_USDG             = <the rig's tUSDG address; RH mainnet = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168>
LP_GATEWAY_CURATOR_SECRET   = <random bearer for /api/gateway/curate>
GATEWAY_ORACLE_PRIVY_WALLET_ID / GATEWAY_ORACLE_PRIVY_ADDRESS = <the dedicated gateway seat that owns the rig>
```
`LP_GATEWAY_USDG` is **required for the Discover feed and the curator queue to show anything** — USDG is
matched by address only; unset means "quote asset unknown", every pool is ineligible and the feed is empty
(fail-closed, round-2 audit O-7). The full `LP_GATEWAY_*` table (defaults + fail-closed behaviour) lives in
`.claude/rules/deployments.md`.

## 4. Deposit (proves stage-and-earn)
Client flow: approve tUSDG → `positionManager.deposit(amount)` (or `depositWithMin`) → record it with
`POST /api/gateway/deposit` — a **wallet-signed** body (`{ address, txHash, authMessage, authSignature,
issuedAt }`, action `mintware-gateway-deposit`, built with `lib/web3/signedActionMessages.ts`), which the
route verifies against the mined receipt (`receipt.to`, the deposit event's user, on-chain `sharesOf`) and
de-duplicates by tx hash. An unsigned `{address, txHash}` body is **rejected (401)** — the older client did
exactly that (audit HO-1/O-1); check the closeout records for the client's current state.
Or via cast:
```bash
cast send $TUSDG "approve(address,uint256)" $POSITION_MANAGER 1000000000 --private-key $KEY --rpc-url $RPC
cast send $POSITION_MANAGER "deposit(uint256)" 1000000000 --private-key $KEY --rpc-url $RPC   # 1,000 tUSDG
```
`totalNav()` should read back ~the deposit; the idle USDG sits as 4626 shares held by the adapter (only the
staging can move them — `adapter.withdraw` from any other caller reverts `OnlyVault`).

## 5. Deploy staged capital into the pool
The router zap is unwired (deploy-gated seam), so supply the paired leg manually (the deployer holds
tPONS). Approve tPONS to the PositionManager (Permit2) and call `deploy(quoteToDeploy, pairedAmount, minLiquidity, deadline)`
(pass a real `minLiquidity` slippage floor — 0 only for a first bootstrap into a fresh pool)
as the **owner**. This mints the aggregate V4 position — the pool now has real liquidity.

## 6. Generate swaps → harvest
Route a few swaps through the pool (Universal Router / cast) so it accrues fees, then hit the harvest
cron (or call `harvest(deadline)` as owner). Set `LP_GATEWAY_HARVEST_ENABLED=true` first; it collects fees
(zero-liquidity-delta), skims the perf fee, and credits the linked spend buffer pro-rata. `harvest_events`
records the run.

## Flags (all default OFF / fail-closed)
`LP_GATEWAY_HARVEST_ENABLED` · `LP_GATEWAY_DEPLOY_ENABLED` · `LP_GATEWAY_DEPLOY_THRESHOLD_ATOMIC` (`0` =
never deploys) · `LP_GATEWAY_DEPLOY_MIN_LIQUIDITY` (`0` = the cron refuses to deploy, A-3) ·
`LP_GATEWAY_DEPLOY_RATIO_BPS` (default 5000) · `LP_GATEWAY_PERF_FEE_BPS` (default 1000 = 10%) ·
`LP_GATEWAY_HARVEST_MIN_ATOMIC` (default 1 USDG) · `LP_GATEWAY_HARVEST_DESTINATION` (`buffer` | `restake`
— use `restake` until the A-4 ledger is event-indexed) · `LP_GATEWAY_CIRCUIT_BREAKER_ENABLED`. The
paired↔quote **router executor** (`LP_GATEWAY_ROUTER_ADDRESS` + `LP_GATEWAY_QUOTER`) is the one code seam
still to wire before harvest/deploy auto-run. **Neither harvest nor deploy is on the `vercel.json` schedule** —
only `gateway-discover` (daily 05:00 UTC) and `gateway-snapshot` (daily 06:00 UTC) are; hit the others
by hand with `CRON_SECRET`. `LP_MAX_DEVIATION_BPS` (deploy-time, **default `500`** = 5%) sizes the
clamped-follower step (below). Full table: `.claude/rules/deployments.md`.

## Contract hardening (see `lp-gateway-v1-security-review.md` + `audits/2026-09-08-consolidated.md`)
The V1 self-audit findings, the firm-grade review and the round-2 audit are fixed on-chain:
- **Spot-NAV flash manipulation.** The deployed LP leg is spot-priced and a hookless meme pool has no
  on-chain TWAP. Defense is layered: a **clamped-follower reference** that tracks spot by at most
  `maxDeviationBps` per block (nothing reverts on price — withdrawals never brick), a **conservative entry
  mark** (`max(spot, ref)` on deposit; `depositWithMin` bounds a pump), a **pure pro-rata exit** on both
  legs (`withdrawWithMin` bounds it), a **same-block guard**, and the **cost-basis deploy cap** (most capital
  stays idle in Morpho, which is spot-immune). Anyone can **`poke()`** the follower one bounded step so the
  mark can't go stale (the older owner-only `pokePrice()` no longer exists). Residual: a patient cross-block
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

## V1 is a product, not a site mode (do NOT flip `NEXT_PUBLIC_V1_MODE_ENABLED`)
`/v1` is reachable at any time and the site links to it (the "Live now" band + the Launch chooser's
"V1 · Live" track). `NEXT_PUBLIC_V1_MODE_ENABLED` is a **legacy dark-launch flag — leave it OFF**: turning it
on swaps the ENTIRE public site to V1 faces (it replaced the landing once, 2026-09-07 incident). The
`/v2` + `V2_PASSWORD` investor gate only matters in that legacy mode. See `.claude/rules/lp-gateway.md`.

## Curate pools (auto-surfaced → one-click approve)
- The `/api/cron/gateway-discover` cron runs **daily at 05:00 UTC** and ingests the top-30 hottest RH-Chain
  pools (GeckoTerminal, mainnet slug `robinhood`) that are v4 **and USDG-quoted by address** as **pending
  candidates** with a risk score — visible at `GET /api/gateway/curate`, ranked safest-first. It needs
  `LP_GATEWAY_USDG`; without it nothing is eligible (fail-closed). A candidate that drops out of the top-30 is
  pruned only after 72 h unseen (`LP_GATEWAY_DISCOVER_PRUNE_GRACE_HOURS`); approved/rejected/manual rows are
  never pruned; a failed or malformed upstream read leaves the queue untouched.
- Set `LP_GATEWAY_CURATOR_SECRET` on Vercel to enable curation (unset ⇒ the route fails closed, 500 — and
  there is no `NODE_ENV=development` free pass any more; local dev needs `ALLOW_DEV_BEARER_BYPASS=true`).
  Approve/reject via `POST /api/gateway/curate` (bearer = that secret). An approve carrying the deployed
  gateway addresses registers the live instance in one call — after `registerInstance` verifies the
  PositionManager on-chain (`quoteAsset()` / `poolKey()`), which is what makes a pool depositable. The risk
  score RANKS the queue; it never certifies safety (no honeypot/hook sim) — every pool is a human decision.

## What stays gated for MAINNET (not testnet)
Real USDG + the Morpho Steakhouse vault (via `MintwareERC4626YieldAdapter`) instead of the mock rig, a
real meme pool, the router executor, and an external audit before real value.
