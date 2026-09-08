# LP Gateway V1 — Pool Curation Policy (mainnet)

**Status:** binding operating rule for any Robinhood Chain **mainnet** instance of the LP Gateway. Written from
the two audit rounds ([`lp-gateway-v1-realfunds-audit-findings.md`](lp-gateway-v1-realfunds-audit-findings.md),
[`audits/2026-09-08-consolidated.md`](audits/2026-09-08-consolidated.md)) — every rule below cites the finding it
closes. Enforced mechanically where the code can (`scripts/preflight-lp-gateway-mainnet.mjs`, the on-chain
constructor guards, `MAX_DEPLOY_BPS`) and by a named human where it cannot. **Nothing in this document is a
safety certification.** The gateway is externally unaudited; the policy bounds *our own* exposure.

Framing that survives every edit: idle-buffer, never "spend the fees" or "100 % spendable"; no *deposit / savings /
guaranteed / fixed-APY* wording; estimates are labelled "est."; a liquidity position carries impermanent loss.

---

## 1. Why curation is the backstop (not a nice-to-have)

The gateway's price defense on a **hookless** pool is a clamped follower + conservative marks + a cost-basis deploy
cap — there is no on-chain TWAP. The reviews were explicit that the residual attacker is *a patient, cross-block
manipulator on a THIN pool* (H-03, RT-1e, C-6) and that the availability of the LP leg depends on the **paired
token behaving like a plain ERC-20** (C-2, RT-6a/b/c). Both residuals are closed economically, by choosing pools,
not cryptographically. So curation *is* the security control, and it has to be written down.

## 2. Hard rules (any one fails → the pool is not eligible)

| # | Rule | Closes | Enforced by |
|---|---|---|---|
| R1 | **Hookless only** — `poolKey.hooks == 0x0`. | A-6 (hook callbacks brick deploy/withdraw; conservative-mark reasoning assumes no callbacks) | PM constructor `HookedPoolUnsupported`; preflight |
| R2 | **USDG is one currency** and it is the Paxos-documented RH-mainnet USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6 dp, UUPS proxy, `paused()==false`). | M-07 | preflight (address pinned; symbol/decimals/proxy/pause checked) |
| R3 | **Paired token != 0x0** (no native-ETH pools) and has code. | A-8 | PM constructor `ZeroAddress`; preflight |
| R4 | **No admin-controlled paired token.** Refuse if the token (or its implementation, if proxied) shows ANY of: EIP-1967 implementation slot set (upgradeable proxy) · `owner()` answers with a non-zero address · `paused()` answers · `isBlacklisted()` / `isFrozen()` answer · bytecode carries the selectors for `pause/unpause`, `blacklist/unBlacklist/addBlackList/removeBlackList/setBlacklisted/isBlacklisted/getBlackListStatus/blacklisted`, `freeze/unfreeze/isFrozen/frozen/wipeFrozenAddress/destroyBlackFunds`, `upgradeTo/upgradeToAndCall`, or `mint(address,uint256)`. | C-2, C-4, C-10, RT-2, RT-6a/b/c | preflight heuristic (FAIL unless `LP_GATEWAY_ALLOW_ADMIN_TOKEN=true`, which **is never set**) + human review (§5) |
| R5 | **Minimum depth.** In-range liquidity `L ≥ LP_GATEWAY_MIN_POOL_LIQUIDITY` (absolute, pool-specific, REQUIRED — unset is a FAIL, mirroring the deploy cron's refusal of `minLiquidity = 0`, A-3) **and** the USDG-side virtual reserve estimate `≥ LP_GATEWAY_MIN_POOL_USDG` (default **250,000 USDG**; the first mainnet instance uses ≥ 1,000,000). | H-03, RT-1a/1e, C-6, O-9 | preflight |
| R6 | **Yield source is a real ERC-4626 over USDG with open capacity**: `asset()==USDG`, `totalAssets()>0`, `maxDeposit(adapter)>0`, `previewRedeem` does not revert. Morpho vaults only (their previews don't revert). A full supply cap (`maxDeposit==0`) makes `deposit`, `compoundQuote` and the `deploy` re-stage revert — DOA, no loss, but ineligible until capacity opens. | C-10, A-8, C-5 | adapter constructor `AssetMismatch`; preflight |
| R7 | **The deploy range holds spot at birth** — `tickLower < spot < tickUpper`, both aligned to `tickSpacing`. Default = spot-centred ±22 980 ticks (≈ −90 % / +10×). | A-8 | PM constructor `BadTicks`; preflight |
| R8 | **Max gateway share of the pool.** At first deploy the gateway's quote leg is ≤ **2 %** of the pool's USDG-side virtual reserve (est.); at any later time ≤ **5 %**. Above 5 % → `setPaused(true)` (stops new deposits) until the ratio falls. The gateway must never *be* the pool — a dominant LP is its own price oracle, and the follower's manipulation resistance assumes outside liquidity. | H-03 residual, C-3 | operator (monitoring, runbook §7) |
| R9 | **Cost-basis deploy cap** — at most `MAX_DEPLOY_BPS = 5000` of depositor principal (at cost) is ever in the LP; the rest idles in the yield source. Constant, not owner-settable. | A-3, RT-9a/9b, C-3 | on-chain |

## 3. Fee-tier guidance

| Pair class | Fee / spacing | Why |
|---|---|---|
| Volatile community / meme (the V1 thesis) | **0.30 % / 60** | Fee flow is the whole point; 60-tick spacing keeps the ±22 980 range alignable and the position cheap to manage. |
| Majors (WETH/USDG) | 0.05 % / 10 (or 0.01 % / 1 only with ≥ 5 M USDG depth) | Thin fee, so only worth it on very deep pools; tighter spacing → more precise range. |
| 1.00 % / 200 | **Avoid** | Wide spacing, fewer swaps, usually thin — the exact profile the follower is weakest on. |

Est. fee APR in Discover (`feeRate × 24h vol ÷ TVL`) is a ranking signal, labelled "est.", never a projection.
Prefer a pool whose 24 h volume is ≥ 0.5× its TVL over a higher-APR pool with thinner depth.

## 4. Out-of-range handling

The range is **fixed per instance** (immutable ticks). When spot leaves it, the position stops earning and is
100 % one-sided:

1. The circuit breaker (`LP_GATEWAY_CIRCUIT_BREAKER_ENABLED=true`, debounced by `LP_GATEWAY_ALERT_DEBOUNCE_SECS`)
   or the operator calls **`setPaused(true)`** — this blocks *new deposits only*; **withdraw is never gated**.
2. Depositors exit at pro-rata NAV via `withdrawWithMin` (C-1 fixed: pure pro-rata, no conservative under-pay).
3. If the move is judged durable, the owner exits the position (own shares) and a **new instance** with a new
   range is deployed (the factory's one-instance-per-pool rule applies — retire the old instance in the registry).
4. Never "wait for it to come back" with new deposits paused *and* the flag left unset — pause is the default
   posture for an out-of-range instance.

## 5. Who signs off (curator allowlist) — the two-person rule

- **Curators** are the holders of `LP_GATEWAY_CURATOR_SECRET` (`POST /api/gateway/curate`). The allowlist is the
  named people in `docs/developers/audits/closeout/mainnet-path.md` §"Curators"; adding a name is a PR.
- Every mainnet listing needs **two** people: one runs the preflight and attaches its output; a **different**
  person does the paired-token review (source verified on the explorer; no admin functions beyond the heuristic
  list; ownership absent or renounced; total supply fully minted; not a proxy; holder distribution not
  single-wallet-dominated) and records "reviewed, no admin controls" with the block number in the record file.
- `LP_GATEWAY_ALLOW_ADMIN_TOKEN` is **never** set on Vercel or in any env file. It exists so the preflight can be
  exercised against a flagged token on a fork; a mainnet run with it set is a policy breach.
- **`riskScore` (`lib/gateway/riskScore.ts`) RANKS the discover queue; it never certifies.** Its verdict is
  always `'review'`; it runs no honeypot or hook simulation; its inputs are GeckoTerminal-steerable (O-7). A high
  score moves a pool up the list for a human — it is never a reason to skip §5.

## 6. Exclusion list — rationale (the residuals the rules exist for)

| Residual | What still happens after the fixes | Why we exclude rather than "handle" |
|---|---|---|
| **C-2 / RT-6a/b/c** — paired token paused / blacklists the PM / frozen harvest recipient | `withdraw` now pays the idle leg and **re-credits shares** for the LP leg (`LpLegUnavailable`); nothing is lost, but the LP leg is **frozen until the third party relents**. | We can't make a paused token move. A token with a pause switch turns "never locked" into "locked at someone else's discretion". |
| **C-10 / RT-5f** — a 4626 source whose `previewRedeem` reverts | Every NAV read bricks (`totalAssets` is in the deposit *and* withdraw path). | Morpho vault previews are total functions; an arbitrary 4626 is not. Source = Morpho only. |
| **RT-2 / C-4** — transfer-hook paired token dumping inside the exit | Fixed (spot cached once, weight-only) — but a hook token is still a token that runs code on every transfer. | Same admin-control class: excluded by R4's proxy/upgrade heuristics and the human review. |
| **H-03 / RT-1e** — patient cross-block pump on a thin pool | Bounded per block by `maxDeviationBps` (500 = 5 % of √price per block); `depositWithMin` / `withdrawWithMin` bound each user's slippage. | The bound is per block; over many blocks on a thin pool it is only capital-expensive, not impossible. Depth (R5) and share (R8) make it *more* expensive than the prize. |
| **RT-9a / C-3** — dumping paired token + honest top-up rule cycling principal into the LP | Fixed (cost-basis cap). | The cap bounds *how much* principal can be exposed, not whether the pool is worth being in. A token designed to dump is excluded on merit (R4 + §5). |
| **M-07** — USDG issuer freeze / wipe | Not fixable on-chain; disclosed on `/legal` and `/risk-disclosures`. | Accepted for any USDG holder. It is a reason to keep exposure bounded (runbook §8), not a pool criterion. |

## 7. Depth numbers, concretely

The preflight prints two USDG-side estimates from the pool's in-range `L` and √price:
- **virtual USDG reserve** — v3-style, `L·√P/Q96` (USDG = currency1) or `L·Q96/√P` (currency0). An upper-bound-ish
  proxy for what sits on the USDG side; the `LP_GATEWAY_MIN_POOL_USDG` gate uses this one.
- **±2 % depth** — the USDG required to move price 2 %. The practical "how thin is it" number; use it to size
  the max gateway deploy: the first mainnet deploy's quote leg should be well under the ±2 % depth.

Reference reading on 2026-09-08 (PONS/USDG 0.30 %/60): in-range `L ≈ 1.62e19`, virtual reserve ≈ 14.0 M USDG,
±2 % ≈ 139 k USDG — eligible on depth; the paired token showed no admin controls under the heuristic (human
review still required).
