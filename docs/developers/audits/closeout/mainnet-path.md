# Closeout record — LP Gateway V1 mainnet path (Robinhood Chain 4663)

**Date:** 2026-09-08 · **Branch:** `feat/lp-gateway-audit-closeout` · **Author:** Claude (Fable 5.1) for the
operator · **Status:** everything below is **code + docs + read-only verification**. **No transaction was sent;
no contract exists on mainnet yet.** The gates that remain are human (§4).

## 1. Files

| File | What it does |
|---|---|
| `scripts/preflight-lp-gateway-mainnet.mjs` | **Read-only** mainnet gate (`pnpm preflight:lp-gateway:mainnet`). viem only — `eth_call` / `getCode` / `getStorageAt` / `getBalance`. Verifies chain 4663 + the canonical V4 stack; USDG pinned to the Paxos RH-mainnet address (symbol, 6 dp, EIP-1967 UUPS impl, `paused()==false`, seat + recipient not `isFrozen`); the ERC-4626 source (code, `asset()==USDG`, `totalAssets>0`, `maxDeposit(seat)>0`, `previewRedeem` works, name/symbol); the target pool (key via `PositionManager.poolKeys(bytes25)` or explicit env, initialized via `extsload` of `POOLS_SLOT`, hookless, USDG present, paired != 0, in-range `L ≥ LP_GATEWAY_MIN_POOL_LIQUIDITY` (REQUIRED), USDG virtual-reserve est. ≥ `LP_GATEWAY_MIN_POOL_USDG` (default 250 k), spot-centred default ticks aligned + containing spot, band sanity); the paired token (name/symbol/decimals/supply + admin-control heuristics: proxy slot, `owner()`, `paused()`, `isBlacklisted`/`isFrozen` probes, bytecode selector scan for pause/blacklist/freeze/wipe/upgrade/mint — FAIL unless `LP_GATEWAY_ALLOW_ADMIN_TOKEN=true`); the gateway seat has gas + is an EOA. PASS/FAIL table, exit 1 on any FAIL. Exports `runPreflight` / `resolveConfig` / `poolIdOf` for the deploy script. |
| `scripts/deploy-lp-gateway-mainnet.mjs` | Privy-signed mainnet deploy (`pnpm deploy:lp-gateway:mainnet [-- --dry-run]`). Gateway seat only (refuses ROOT, refuses seat == root). Artifact freshness + round-2-surface check. **Runs the preflight first; a real run stops on FAIL.** Deploys `MintwareERC4626YieldAdapter(USDG, source, 0, seat)` → `MintwareLpGatewayStaging(USDG, adapter)` → `MintwareLpGatewayPositionManager(PM, PosM, Permit2, poolKey, USDG, ticks, staging, owner=seat, harvestRecipient=env|seat, band 500)`; wires `setController` / `setVault` / optional per-block cap; 22 post-wire assertions incl. `MAX_DEPLOY_BPS==5000`, `deployedPrincipal==0`, poolKey hash, `poke()` via eth_call. Prints the Vercel env block + a `deployments.json` snippet (never edits the file). `--dry-run` predicts CREATE addresses from the seat nonce and `eth_estimateGas`-simulates all three constructors, prints wiring calldata, sends nothing. |
| `docs/developers/lp-gateway-mainnet-runbook.md` | Bounded rollout: prerequisites → preflight (real output) → dry-run (real output) → deploy → record → Vercel env (incl. `LP_GATEWAY_HARVEST_DESTINATION=restake`, `LP_GATEWAY_USDG`, `GATEWAY_ORACLE_PRIVY_*`) → tiny `cast` smoke (operator-run, no auto value-moving script) → monitoring checklist → scale-up criteria → incident playbook (pause, exit, issuer freeze, seat compromise). |
| `docs/developers/lp-gateway-pool-curation-policy.md` | The written rule: hookless, pinned USDG, no admin-controlled paired token, min depth (L + USDG), max gateway share (2 % at deploy / 5 % running), fee-tier guidance, out-of-range = pause, `riskScore` ranks never certifies, two-person curator sign-off, exclusion rationale (C-2 / C-10 / RT-6 / H-03 / RT-9a / M-07). |
| `app/risk-disclosures/page.tsx` | +2 `<Risk>` items under §5: **USDG issuer controls** (pause / freeze / wipe; issuer not Mintware; possible permanent loss; same class as any USDG holder) and **third-party paired-token controls** (LP leg of a withdrawal can be blocked; idle leg still pays; claim kept as shares; curation is a heuristic, not a guarantee). |
| `app/legal/page.tsx` | +2 `DISCLOSURES` entries with the same two facts in the page's shorter register. No deposit / savings / guaranteed / fixed-APY wording added anywhere. |
| `package.json` | +2 script lines only: `preflight:lp-gateway:mainnet`, `deploy:lp-gateway:mainnet`. |

## 2. Real preflight output (read-only, 2026-09-08 02:13 UTC, RH mainnet RPC)

Inputs: pool `0x4be9657ec9002e528f4f17a5c43edc525a07f888f7b180c2afbf75e096c4f38a` (PONS/USDG 0.30 %/60, the top pool
in the live discover feed), source `0xBeEff033F34C046626B8D0A041844C5d1A5409dd` (Morpho **Steakhouse USDG**, found
via Morpho's app listing for chain 4663), seat `0x18AE027cF105393BF9Fe6a9F0d06A761D2a0663c`,
`LP_GATEWAY_MIN_POOL_LIQUIDITY=8e18`.

Result: **41 rows, 2 FAIL** (full table pasted verbatim in the runbook §2):

- ✓ chain 4663; PoolManager 24 009 B, PositionManager 23 877 B, Permit2 9 152 B; `PositionManager.poolManager()` matches.
- ✓ USDG `0x5fc5…d168`: symbol USDG, 6 dp, EIP-1967 impl `0x68184C449E1a8f34fA18d289737129FD27B66f8F` (admin slot zero → UUPS, consistent with M-07), `paused()==false`, supply 677.2 M, seat + recipient not frozen.
- ✓ Source: code 21 808 B, `asset()==USDG`, "Steakhouse USDG / steakUSDG", `totalAssets` 443.5 M USDG, `previewRedeem(1 USDG) = 0.999999`.
- **✗ Source `maxDeposit(seat) == 0`** — confirmed 0 for arbitrary addresses and `maxMint == 0`: the vault's supply cap is full (`owner 0xCa50…db73`, `curator 0x9023…D2Fb`). Gateway deposits / compounding / deploy re-stage would revert (DOA, no loss). Human gate: wait for cap headroom or choose another Morpho USDG vault on 4663.
- ✓ Pool: key resolved from `poolKeys(bytes25)` — `0x39dBED3a2bd333467115dE45665cC57F813C4571` (PONS, 18 dp, 1 B supply) / USDG, fee 3000, spacing 60, hooks 0x0; initialized; USDG = currency1; spot tick −279 268, in-range `L = 16 216 902 026 521 451 603`; USDG virtual reserve ≈ 13.998 M, ±2 % depth ≈ 139 k USDG; default range `[-302220, -256260]` (spot-centred ±22 980) contains spot, ≈ −89.9 % / 9.98×.
- ✓ Paired token PONS: 5 274 B code; **no admin controls detected** by the heuristic (no proxy slot, no `owner()`, no `paused()`, no blacklist/freeze/upgrade/mint selectors). Human review per policy §5 still required.
- **✗ Seat has 0 ETH on 4663.** Human gate.

Bug found + fixed by running it: the first draft defaulted the range to ±22 980 **around tick 0**, which is
out-of-range for any 6 dp/18 dp pair (spot ≈ −279 k). Default is now spot-centred.

## 3. Real dry-run output (2026-09-08 02:14 UTC)

All three constructors simulate cleanly on mainnet against the real pool key at the seat's predicted nonce-0
addresses (`adapter 0xAD77…c6d4`, `staging 0xb810…800c`, `pm 0x8AC1…7b38`): est. gas 873 426 / 553 240 / 3 748 238.
Wiring calldata printed. Exit 1 (inherited from the two preflight FAILs). Nothing sent. Run with
`--allow-stale-artifacts` because the working tree's `MintwareLpGatewayStaging.sol` (another agent's edits) was
newer than `contracts-v4/out/`; a real run must `forge build` first — the script enforces that.

## 4. What remains for a human

1. **Fund the gateway seat** `0x18AE…663c` with gas on 4663 (≈ 5.2 M gas for deploy + cron headroom). Not from the root seat.
2. **Yield source with capacity** — Steakhouse USDG is capped out today; re-run the preflight until `maxDeposit(seat) > 0`, or select another Morpho USDG vault on 4663 (policy R6: Morpho only).
3. **Pool decision + two-person sign-off** (policy §5). PONS/USDG passes every mechanical check; the second reviewer must verify PONS source on the explorer (no admin functions, no proxy, supply fully minted, holder distribution) and record it here.
4. **Execute**: `forge build` → preflight PASS → `--dry-run` CLEAN → deploy → paste the `deployments.json` snippet → Vercel env (`restake`, `LP_GATEWAY_USDG`, seat vars) → redeploy Vercel → §6 smoke with 5 USDG → record hashes → enable crons one at a time.
5. **Nothing here unlocks** UI deposits, third-party funds, the router zap, or amounts beyond the runbook's step table without an external audit.

## Curators (policy §5 allowlist)

| Name | Role | Since |
|---|---|---|
| _(add by PR — holders of `LP_GATEWAY_CURATOR_SECRET`)_ | | |

## Runs

| Date | Action | Block | Addresses / tx | Ran by | Paired-token reviewer |
|---|---|---|---|---|---|
| 2026-09-08 | preflight + dry-run (read-only, no tx) | — | none | Claude session | — |
