# LP Gateway V1 — Robinhood Chain MAINNET Runbook (bounded rollout, OWN funds only)

> **Scope + honesty.** This stands up one LP Gateway instance on **Robinhood Chain mainnet (4663)** against the
> real Paxos USDG, a real curated Morpho USDG vault, and an existing hookless V4 pool — for a **bounded amount of
> our OWN funds via direct contract calls**. That is the exact verdict of the round-2 audit
> ([`audits/2026-09-08-consolidated.md`](audits/2026-09-08-consolidated.md) §1/§4): *own funds via the UI* stays
> blocked (O-1/O-2/O-5), *third-party funds* stays blocked (O-1…O-6 + external audit). The contracts are
> **externally unaudited**. Nothing here is a deposit, savings, guaranteed or fixed-APY product; an LP position
> carries impermanent loss; every yield figure is an estimate.
>
> Companion docs: [`lp-gateway-pool-curation-policy.md`](lp-gateway-pool-curation-policy.md) (which pools),
> [`lp-gateway-testnet-runbook.md`](lp-gateway-testnet-runbook.md) (the rehearsal), rule file
> [`.claude/rules/lp-gateway.md`](../../.claude/rules/lp-gateway.md).

## 0. What's different from testnet

| | Testnet (`deploy-lp-gateway-robinhood.mjs`) | Mainnet (`deploy-lp-gateway-mainnet.mjs`) |
|---|---|---|
| Tokens | deploys mock tUSDG / tPONS, mints 1 M each | **none** — real USDG (pinned to the Paxos address), real paired token |
| Pool | initializes a fresh pool at price 1.0 | **must pre-exist**; key resolved from `LP_GATEWAY_POOL_ID` via `PositionManager.poolKeys` |
| Yield source | `MockERC4626` unless env | **required** env, verified 4626 over USDG with open capacity |
| Preflight | chain id + code checks | **the full read-only preflight runs first and blocks on any FAIL** |
| Signer | ROOT fallback accepted | **`gateway` seat only**; refuses if it equals the root seat (A-3) |
| Range | ±22 980 around tick 0 | ±22 980 **around spot**, aligned to `tickSpacing` |
| Dry-run | — | `--dry-run` simulates every creation via `eth_estimateGas` at the signer's predicted addresses |

## 1. Prerequisites (human)

1. **Fund the gateway seat with gas.** `GATEWAY_ORACLE_PRIVY_ADDRESS` (today `0x18AE027cF105393BF9Fe6a9F0d06A761D2a0663c`)
   holds **0 ETH on 4663** as of 2026-09-08 (preflight below). Bridge a small amount (deploy ≈ 5.2 M gas total in
   the dry-run; keep ≥ 0.02 ETH for crons). Never fund it from — or with — the shared root seat.
2. **Choose the pool** per the curation policy §2/§5 (two-person sign-off, recorded in
   [`audits/closeout/mainnet-path.md`](audits/closeout/mainnet-path.md)).
3. **Choose the yield source.** The intended one is Morpho's **Steakhouse USDG** vault on Robinhood Chain
   (`0xBeEff033F34C046626B8D0A041844C5d1A5409dd`, curator `0x9023…D2Fb`, ≈ 443 M USDG). On 2026-09-08 it reported
   **`maxDeposit == 0` for every address — its supply cap is full**, which makes every gateway `deposit` /
   `compoundQuote` / `deploy` re-stage revert (DOA, no loss). Either wait for the curator to raise the cap
   (re-run the preflight until `maxDeposit(signer) > 0`) or pick another Morpho USDG vault on 4663 with capacity.
   No other ERC-4626 (policy R6).
4. **Fresh artifacts.** `export PATH="$HOME/.foundry/bin:$PATH" && pnpm forge:build` from the repo root. The deploy
   script refuses if any gateway source is newer than its artifact or if the PositionManager artifact lacks the
   round-2 surface (`poke`, `depositWithMin`, `withdrawWithMin`, `deployedPrincipal`, `MAX_DEPLOY_BPS`).
5. **An env file, never the command line.** Create `.env.lp-gateway-mainnet` (git-ignored — check) with:

```
ORACLE_SIGNER_PROVIDER=privy
PRIVY_APP_ID=…                      PRIVY_APP_SECRET=…
GATEWAY_ORACLE_PRIVY_WALLET_ID=…    GATEWAY_ORACLE_PRIVY_ADDRESS=0x18AE027cF105393BF9Fe6a9F0d06A761D2a0663c
LP_GATEWAY_RPC_URL=https://rpc.mainnet.chain.robinhood.com     # default
LP_GATEWAY_USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168     # default; anything else FAILS
LP_GATEWAY_YIELD_SOURCE=0xBeEff033F34C046626B8D0A041844C5d1A5409dd
LP_GATEWAY_POOL_ID=0x4be9657ec9002e528f4f17a5c43edc525a07f888f7b180c2afbf75e096c4f38a   # 32-byte v4 poolId
#  (or, if PositionManager.poolKeys has no entry: LP_GATEWAY_POOL_CURRENCY0/1, LP_GATEWAY_POOL_FEE, LP_GATEWAY_POOL_TICK_SPACING)
LP_GATEWAY_MIN_POOL_LIQUIDITY=8000000000000000000   # absolute L — REQUIRED; ≤ ~50 % of the live in-range L the preflight prints
LP_GATEWAY_MIN_POOL_USDG=1000000                    # first mainnet instance: 1 M (policy default 250 k)
# LP_GATEWAY_HARVEST_RECIPIENT=0x…                  # default = signer. A cold address is allowed but see §5 (restake)
# LP_TICK_LOWER / LP_TICK_UPPER                      # default: spot-centred ±22 980 aligned to tickSpacing (see §2)
# LP_MAX_DEVIATION_BPS=500                           # follower step per block (0 < x ≤ 5000)
# LP_ADAPTER_PER_BLOCK_CAP=…                         # optional adapter drain bound, atomic USDG (A-1 re-credits above it)
```

Run every script through `bash -c '…'` in this repo (the RTK hook otherwise re-formats node/forge output).

## 2. Preflight (read-only — run until it says PASS)

```bash
bash -c 'node --env-file=.env.lp-gateway-mainnet scripts/preflight-lp-gateway-mainnet.mjs'   # or pnpm preflight:lp-gateway:mainnet
```

**Choosing the tick range.** The default is symmetric ±22 980 ticks around the *current* tick, each bound rounded
toward zero to a multiple of `tickSpacing` — ≈ −90 % / +10× of spot, the same width the testnet used. It is
**not** ±22 980 around 0: a 6 dp / 18 dp pair trades ~280 000 ticks away from 0 and a 0-centred range is
out-of-range at birth (the preflight fails that row). Override with `LP_TICK_LOWER` / `LP_TICK_UPPER` (multiples
of `tickSpacing`, lower < spot < upper) to widen (full range = ±887 220, lowest IL, least fee-efficient) or tighten
(more fee capture, more out-of-range risk). The range is immutable per instance.

**Real output, 2026-09-08 (PONS/USDG 0.30 %/60, Steakhouse USDG source, gateway seat), captured verbatim:**

```
LP Gateway V1 — MAINNET PREFLIGHT (read-only) · 2026-09-08T02:13:02.635Z
[chain]
  ✓ PASS  chain id == 4663                                              rpc reports 4663
  ✓ PASS  PoolManager has code                                          0x8366a39CC670B4001A1121B8F6A443A643e40951 · 24009 bytes
  ✓ PASS  PositionManager has code                                      0x58daec3116aae6D93017bAAea7749052E8a04fA7 · 23877 bytes
  ✓ PASS  Permit2 has code                                              0x000000000022D473030F116dDEE9F6B43aC78BA3 · 9152 bytes
  ✓ PASS  PositionManager.poolManager() == PoolManager                  0x8366a39CC670B4001A1121B8F6A443A643e40951
[usdg]
  ✓ PASS  address == Paxos-documented RH-mainnet USDG                   0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
  ✓ PASS  has code                                                      170 bytes
  ✓ PASS  symbol() == USDG                                              USDG
  ✓ PASS  decimals() == 6                                               6
  ✓ PASS  EIP-1967 proxy (impl non-zero — Paxos UUPS, M-07)             impl 0x68184C449E1a8f34fA18d289737129FD27B66f8F
  · info  EIP-1967 admin slot                                           zero (UUPS — upgrade authority lives in the implementation)
  ✓ PASS  paused() == false                                             false
  · info  totalSupply                                                   677,233,161 USDG
  ✓ PASS  gateway signer not frozen by issuer                           isFrozen(0x18AE027cF105393BF9Fe6a9F0d06A761D2a0663c) = false
  ✓ PASS  harvest recipient not frozen by issuer                        isFrozen(0x18AE027cF105393BF9Fe6a9F0d06A761D2a0663c) = false
[source]
  ✓ PASS  has code                                                      0xBeEff033F34C046626B8D0A041844C5d1A5409dd · 21808 bytes
  ✓ PASS  asset() == USDG                                               0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
  · info  name / symbol                                                 Steakhouse USDG / steakUSDG
  ✓ PASS  totalAssets() > 0                                             443,510,259 USDG
  ✗ FAIL  maxDeposit(signer) > 0 (supply cap open)                      0 USDG
  ✓ PASS  previewRedeem(convertToShares(1 USDG)) works [C-10]           0.999999 USDG
[pool]
  ✓ PASS  pool key resolved via PositionManager.poolKeys(poolId)        0x39dBED3a2bd333467115dE45665cC57F813C4571 / 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 · fee 3000 · spacing 60 · hooks 0x0000000000000000000000000000000000000000
  ✓ PASS  pool initialized on canonical PoolManager                     poolId 0x4be9657ec9002e528f4f17a5c43edc525a07f888f7b180c2afbf75e096c4f38a
  ✓ PASS  hooks == 0x0 [A-6]                                            0x0000000000000000000000000000000000000000
  ✓ PASS  USDG is one of the currencies                                 USDG = currency1
  ✓ PASS  paired token != 0x0 (no native-ETH pools) [A-8]               0x39dBED3a2bd333467115dE45665cC57F813C4571
  · info  spot                                                          sqrtPriceX96 68387069377881643948287 · tick -279268 · in-range L 16216902026521451603
  ✓ PASS  in-range liquidity ≥ LP_GATEWAY_MIN_POOL_LIQUIDITY            L 16216902026521451603 vs floor 8000000000000000000
  · info  USDG depth (est.)                                             virtual USDG reserve ≈ 13,997,881 · ±2% move ≈ 139,279 USDG
  ✓ PASS  USDG-side depth est. ≥ LP_GATEWAY_MIN_POOL_USDG               13,997,881 vs floor 250,000 USDG
  ✓ PASS  deploy ticks ordered + aligned to tickSpacing [A-8]           [-302220, -256260] · spacing 60 · default: spot-centered ±22980
  ✓ PASS  current tick inside the deploy range (not out-of-range at birth)  tick -279268 ∈ (-302220, -256260)
  · info  range coverage (est.)                                         stays in range from −89.9% to 9.98× of spot
  ✓ PASS  LP_MAX_DEVIATION_BPS in (0, 5000]                             500
[paired]
  ✓ PASS  has code                                                      0x39dBED3a2bd333467115dE45665cC57F813C4571 · 5274 bytes
  · info  name / symbol / decimals                                      Pons / PONS / 18
  · info  totalSupply                                                   1,000,000,000 PONS
  ✓ PASS  no admin controls detected (proxy / owner / pause / blacklist / freeze / upgrade / mint)  heuristic — the curation policy still requires a human review
[signer]
  ✗ FAIL  gateway signer has gas                                        0x18AE027cF105393BF9Fe6a9F0d06A761D2a0663c · 0 ETH
  ✓ PASS  gateway signer is an EOA (Privy wallet)                       no code
  · info  harvest recipient                                             0x18AE027cF105393BF9Fe6a9F0d06A761D2a0663c (= gateway signer; restake-compatible)
RESULT: FAIL (2 failures) — do NOT deploy
```

Read: chain, USDG, pool, and paired-token rows all pass; the two FAILs are exactly the two things only a human can
change (§1 items 1 and 3). The deploy script will not run while either stands.

## 3. Dry-run (sends nothing)

```bash
bash -c 'node --env-file=.env.lp-gateway-mainnet scripts/deploy-lp-gateway-mainnet.mjs --dry-run'
```

Re-runs the preflight, then `eth_estimateGas`-simulates the three creations at the signer's predicted CREATE
addresses (the constructors' own guards — `AssetMismatch`, `HookedPoolUnsupported`, `BadTicks`, `ZeroAddress` —
execute for real), prints the wiring calldata, the env block and a `deployments.json` snippet with the predicted
addresses. Exit 0 only when preflight AND every simulation pass.

**Real output, 2026-09-08 (preflight rows elided; run with `--allow-stale-artifacts` because the working tree's
`MintwareLpGatewayStaging.sol` was newer than `out/` — a real run must `forge build` first):**

```
LP Gateway V1 — MAINNET DRY-RUN (no transactions will be sent) · Robinhood Chain 4663
signer (gateway seat): 0x18AE027cF105393BF9Fe6a9F0d06A761D2a0663c
RESULT: FAIL (2 failures) — do NOT deploy
!! PREFLIGHT FAILED — the dry-run continues for SIMULATION ONLY; a real deploy stops here. Exit code will be 1.

Plan:
  USDG (quote)         0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
  yield source (4626)  0xBeEff033F34C046626B8D0A041844C5d1A5409dd
  pool                 0x39dBED3a2bd333467115dE45665cC57F813C4571 / 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 · fee 3000 · spacing 60 · hooks 0x0000000000000000000000000000000000000000
  poolId               0x4be9657ec9002e528f4f17a5c43edc525a07f888f7b180c2afbf75e096c4f38a
  paired token         0x39dBED3a2bd333467115dE45665cC57F813C4571  (USDG is currency1)
  tick range           [-302220, -256260]
  owner                0x18AE027cF105393BF9Fe6a9F0d06A761D2a0663c
  harvestRecipient     0x18AE027cF105393BF9Fe6a9F0d06A761D2a0663c (= signer)
  maxDeviationBps      500
  adapter per-block cap uncapped

Predicted addresses (signer nonce 0):
  adapter 0xAD77283eE63f563f3200d7bC26c8eAB19e0Cc6d4
  staging 0xb810C3D4dA4129593E51301A914EB488CBf7800c
  pm      0x8AC1ab49d9C8eB8adC9EDd8D6380220598007b38

Simulating contract creations (eth_estimateGas from the signer):
  ✓ MintwareERC4626YieldAdapter        constructor OK · est. gas 873426
  ✓ MintwareLpGatewayStaging           constructor OK · est. gas 553240
  ✓ MintwareLpGatewayPositionManager   constructor OK · est. gas 3748238

Wiring transactions that WOULD be sent (calldata, not simulated — targets do not exist yet):
  0xb810C3D4dA4129593E51301A914EB488CBf7800c ← staging.setController(0x8AC1ab49d9C8eB8adC9EDd8D6380220598007b38)
  0xAD77283eE63f563f3200d7bC26c8eAB19e0Cc6d4 ← adapter.setVault(0xb810C3D4dA4129593E51301A914EB488CBf7800c)

Signer gas balance: 0 ETH
DRY-RUN NOT CLEAN — nothing was sent.
```

The three constructors execute cleanly against the real pool key on mainnet; "NOT CLEAN" is inherited from the
two preflight FAILs. Predicted addresses assume nonce 0 — they change if the seat sends anything first.

## 4. Deploy (Privy-signed; ~5.2 M gas)

```bash
bash -c 'export PATH="$HOME/.foundry/bin:$PATH" && pnpm forge:build && node --env-file=.env.lp-gateway-mainnet scripts/deploy-lp-gateway-mainnet.mjs'
```

Order: preflight (blocks on FAIL) → adapter → staging → position manager → `setController` → `setVault` →
[`setPerBlockWithdrawCap`] → **22 post-wire assertions** (`adapter.vault/asset/yieldSource/owner`,
`staging.controller/deployer`, `pm.quoteAsset/pairedAsset/staging/owner/harvestRecipient/MAX_DEPLOY_BPS==5000/
maxDeviationBps/deployedPrincipal==0/tokenId==0/paused==false/ticks/quoteIsCurrency0/poolManager/poolKey hash/
totalNav==0`, `poke()` via eth_call). Any mismatch aborts *after* deploy — read the message, do not re-run
blindly (the predicted-vs-landed address warning tells you if the seat's nonce moved).

**Record immediately** (the script never edits files):
1. Paste its `robinhood-mainnet` snippet into `config/deployments.json` (keep `"status": "mainnet-bounded"`; add
   the three tx hashes to `note`).
2. Append the run to `docs/developers/audits/closeout/mainnet-path.md` (date, block, addresses, who ran it, who
   did the paired-token review).
3. `.claude/STATE.md` + `.claude/rules/lp-gateway.md`: one line each ("mainnet instance live, bounded, unaudited").

## 5. Vercel env (Production + Preview) — paste from the script's block

| Variable | Value / note |
|---|---|
| `LP_GATEWAY_CHAIN_ID` / `LP_GATEWAY_RPC_URL` | `4663` / `https://rpc.mainnet.chain.robinhood.com` |
| `LP_GATEWAY_USDG` | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` — the discover feed matches USDG by **address** only when this is set (O-7) |
| `LP_GATEWAY_POSITION_MANAGER` / `LP_GATEWAY_STAGING` | the deployed addresses |
| `LP_GATEWAY_POOL_ADDRESS` | the 32-byte poolId (what the registry keys by) |
| `LP_GATEWAY_YIELD_SOURCE` | the Morpho vault |
| **`LP_GATEWAY_HARVEST_DESTINATION=restake`** | **mandatory** — `compoundQuote` the net back into the yield source. The buffer-credit path (`card_spend_buffers`) is the un-fixed A-4/O-4 ledger; never enable it on mainnet. Restake needs the harvest **recipient = the gateway seat** (the cron approves + compounds from the seat). With a cold `LP_GATEWAY_HARVEST_RECIPIENT`, harvesting still lands fees there but compounding is a manual `compoundQuote` from the owner. |
| `GATEWAY_ORACLE_PRIVY_WALLET_ID` / `GATEWAY_ORACLE_PRIVY_ADDRESS` | the gateway seat (already set for testnet — confirm it's the same seat that deployed) |
| `LP_GATEWAY_DEPLOY_MIN_LIQUIDITY` | set from the smoke's computed `minLiquidity` (§6) — the cron refuses `0` |
| `LP_GATEWAY_DEPLOY_RATIO_BPS` | ≤ `5000`; start at `2000` |
| `LP_GATEWAY_DEPLOY_THRESHOLD_ATOMIC` | ≥ 100 USDG (`100000000`) so dust never triggers a deploy |
| `LP_GATEWAY_PERF_FEE_BPS` | `1000` (10 %) |
| `LP_GATEWAY_DEPLOY_ENABLED` / `LP_GATEWAY_HARVEST_ENABLED` / `LP_GATEWAY_CIRCUIT_BREAKER_ENABLED` | **unset until §6 passes**; then `true` one at a time |
| `LP_GATEWAY_ALLOW_ADMIN_TOKEN` | **never set** |
| `NEXT_PUBLIC_V1_MODE_ENABLED` | leave OFF (site-wide swap incident, 2026-09-07) |

Redeploy Vercel after setting (env is snapshotted at build).

## 6. Smoke with a TINY amount (operator-run `cast`; no script moves real value)

Amounts: **5 USDG** in, then a half withdraw, then a **2.5 USDG** first deploy. Use a Foundry keystore or a hardware
wallet for the *depositor* leg (`--account <name>` / `--ledger`) — **never a raw `--private-key` on the command
line**. The *owner* legs (deploy / harvest / setPaused) are signed by the Privy gateway seat: mirror
`scripts/smoke-lp-gateway-robinhood.mjs`'s signer setup in a throw-away node snippet, or wait for the crons.

```bash
export RPC=https://rpc.mainnet.chain.robinhood.com
export USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 PM=<pm> STAGING=<staging> ADAPTER=<adapter> SRC=<yield source>
export ME=<your depositor address>

# 6.1  baseline reads (all zero / clean)
cast call $PM "totalNav()(uint256)"            --rpc-url $RPC   # 0
cast call $PM "paused()(bool)"                 --rpc-url $RPC   # false
cast call $SRC "maxDeposit(address)(uint256)" $ADAPTER --rpc-url $RPC   # > 5e6 or STOP (cap full → deposit reverts)

# 6.2  deposit 5 USDG with a slippage floor (C-6): min shares = 99.9 % of 1:1 at an empty gateway
cast send $USDG "approve(address,uint256)" $PM 5000000 --rpc-url $RPC --account <name>
cast send $PM "depositWithMin(uint256,uint256)" 5000000 4995000 --rpc-url $RPC --account <name>
cast call $PM "sharesOf(address)(uint256)" $ME  --rpc-url $RPC   # ≈ 5000000
cast call $PM "totalNav()(uint256)"            --rpc-url $RPC   # ≈ 5000000 (fee-net via previewRedeem)
cast call $STAGING "stagedAssets()(uint256)"   --rpc-url $RPC
cast call $SRC "balanceOf(address)(uint256)" $ADAPTER --rpc-url $RPC   # > 0 — the USDG is in Morpho, held by the adapter
cast call $ADAPTER "withdraw(uint256)" 1 --from $ME --rpc-url $RPC      # must REVERT OnlyVault (A-5 drain block)

# 6.3  round-trip half (proves "never locked"; pure pro-rata, C-1). Different block from 6.2 (same-block guard).
cast send $PM "withdrawWithMin(uint256,uint256,uint256)" 2500000 2495000 0 --rpc-url $RPC --account <name>
cast call $PM "sharesOf(address)(uint256)" $ME --rpc-url $RPC   # ≈ 2500000; USDG balance up ≈ 2.5

# 6.4  follower liveness (permissionless)
cast send $PM "poke()" --rpc-url $RPC --account <name>          # emits nothing before first deploy (tokenId==0) — that's expected

# 6.5  owner: pause blocks NEW deposits only (Privy seat)
#   setPaused(true) → depositWithMin reverts DepositsPaused → withdrawWithMin still works → setPaused(false)

# 6.6  owner: FIRST deploy, 2.5 USDG + the matching paired amount (the seat must hold the paired token)
#   quoteToDeploy=2500000 (≤ 50 % of principal — MAX_DEPLOY_BPS, else DeployCapExceeded)
#   pairedAmount = 2.5 USDG worth at spot, minLiquidity = LiquidityAmounts.getLiquidityForAmounts(spot, √tickLower, √tickUpper, amounts) × 0.98
#   deploy(2500000, pairedAmount, minLiquidity, now+600)
cast call $PM "tokenId()(uint256)"             --rpc-url $RPC   # > 0
cast call $PM "deployedPrincipal()(uint256)"   --rpc-url $RPC   # ≈ 2500000 (cost basis, never moves with price)
cast call 0x58daec3116aae6D93017bAAea7749052E8a04fA7 "getPositionLiquidity(uint256)(uint128)" <tokenId> --rpc-url $RPC
cast call $PM "totalNav()(uint256)"            --rpc-url $RPC   # idle + LP leg at spot
cast send $PM "poke()" --rpc-url $RPC --account <name>          # now emits PriceAnchored

# 6.7  harvest after the pool has traded (owner): harvest(now+600) → Harvested event → fees at harvestRecipient
#      With LP_GATEWAY_HARVEST_DESTINATION=restake the cron then compoundQuote()s the net: totalNav up, totalShares unchanged.

# 6.8  exit everything (proves the last-holder path, A-2): withdrawWithMin(all shares, …) → tokenId stays, liquidity 0,
#      then a fresh deposit + deploy must succeed (no CannotUpdateEmptyPosition brick).
```

Record every tx hash in the closeout record. If **any** step deviates, stop and go to §9.

## 7. Monitoring checklist (daily while bounded; the cron does most of it once enabled)

| Watch | How | Act when |
|---|---|---|
| Harvest events | `Harvested(quoteFees, pairedFees, recipient)` logs on the PM; `harvest_events` rows | none for 7 days on a pool with volume → check `LP_GATEWAY_HARVEST_ENABLED` + seat gas |
| Out-of-range | `getSlot0` tick vs `pm.tickLower/tickUpper` (`/api/gateway/position`) | outside → `setPaused(true)` (breaker does it when enabled); see policy §4 |
| Breaker / pause | `pm.paused()` | paused and you didn't expect it → the breaker fired; find the alert |
| Follower staleness | age of the last `PriceAnchored` event; `poke()` is permissionless | > 1 day quiet → call `poke()` (the cron should; it costs a tx) |
| Adapter liquidity | `adapter.maxWithdrawable()` vs `staging.stagedAssets()` | maxWithdrawable ≪ staged → the Morpho vault is illiquid/paused; exits re-credit shares (A-1) — don't panic-exit |
| Yield-source capacity | `source.maxDeposit(adapter)` | `0` → deposits, compounding and deploy re-stage all revert; pause deposits, contact curator |
| Deploy share | `deployedPrincipal / (stagedAssets + deployedPrincipal)` ≤ 50 %; gateway quote leg vs pool USDG depth ≤ 5 % (policy R8) | over → pause |
| LP-leg failures | `LpLegUnavailable(user, liquidityRequested)` events | any → the paired token or recipient is restricted; policy §6 row 1 |
| USDG issuer | `USDG.paused()`; `USDG.isFrozen(pm / staging / adapter / seat)` | any true → §9 issuer scenario |
| Signer gas | `eth_getBalance(seat)` | < 0.01 ETH → top up |
| Pool depth trend | discover feed TVL / ±2 % depth vs the preflight baseline | −50 % → raise `LP_GATEWAY_DEPLOY_MIN_LIQUIDITY`, consider pause |

## 8. Scale-up criteria (exposure cap is the control)

Start with the smoke amounts. Raise the **own-funds cap** only when ALL hold for the stated window:

| Step | Cap (own funds) | Requires |
|---|---|---|
| 0 | ≤ 10 USDG | §6 complete, all hashes recorded |
| 1 | ≤ 1 000 USDG | 7 clean days: ≥ 2 harvests, 0 `LpLegUnavailable`, follower fresh, one full withdraw round-trip proven |
| 2 | ≤ 10 000 USDG | 30 clean days at step 1; quote leg still < 2 % of pool USDG depth; second person re-reviews the paired token |
| 3 | > 10 000 USDG | **external audit** of the converged stack; nothing here authorizes it |

Third-party deposits remain blocked at every step (O-1 → O-6). A cap is a decision recorded in the closeout file,
not a config flag.

## 9. Incident playbook

| Scenario | First move | Then |
|---|---|---|
| Anything unexpected | **`setPaused(true)`** (owner) — stops new deposits, never withdraw | diagnose; withdraw is the universal exit |
| Out-of-range, durable | pause | exit own shares (`withdrawWithMin`), deploy a new instance with a new range, retire the old one in the registry |
| Paired token paused / blacklists the PM | pause; expect `LpLegUnavailable` | idle leg pays, LP-leg claim stays as shares; exit the LP leg when the restriction lifts; delist the pool (policy §6) |
| Morpho vault paused / illiquid | nothing to click — exits re-credit unserved value (A-1) | wait for liquidity; do not force a full exit into a shortfall |
| Morpho cap full (`maxDeposit==0`) | pause deposits (they'd revert anyway) | ask the curator; harvest still works; compounding reverts until capacity returns |
| **USDG freeze of the PM / staging / adapter / seat** | nothing on-chain can move it; pause; publish | contact Paxos compliance; disclose on `/legal` + `/risk-disclosures` (already lists the risk); a **wipe** is a permanent loss — this is why exposure stays bounded |
| USDG global pause | wait | every path reverts; no loss at rest |
| Gateway seat compromise | `transferOwnership(newSeat)` from the seat if still yours (two-step — new seat must `acceptOwnership`) | a hostile owner can only: pause deposits, `deploy` ≤ 50 % principal inside the follower band, and collect fees to the **immutable** `harvestRecipient` — no principal-sweep function exists (verified). Exit own shares; rotate `GATEWAY_ORACLE_PRIVY_*`; audit Privy policies (O-6) |
| Pool depth collapses | raise `LP_GATEWAY_DEPLOY_MIN_LIQUIDITY`; pause | exit the LP leg on a calm block; consider delisting |

## 10. What this runbook does NOT unlock

UI deposits (O-1/O-2/O-5), third-party deposits (A-4/O-4 ledger, A-7/O-3 registry, O-6 seat separation), the
router zap (`LP_GATEWAY_ROUTER_ADDRESS` seam stays fail-closed), a second pool without a second two-person review,
or any copy that says deposit / savings / guaranteed / fixed APY.
