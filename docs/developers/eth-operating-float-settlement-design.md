# ETH spend via an operating float — settlement design (supersedes swap-on-settle)

> **The problem this solves.** The original `MintwareEthSettlement` swapped the ETH-side collateral →
> USDC **atomically, on the card hot path, against a single canonical pool.** With wstETH as the collateral
> that hard-requires a deep *single-hop* `wstETH/USDC` pool — which doesn't exist (deep wstETH liquidity is
> `wstETH/ETH`). The coupling of *"pay the rail"* with *"liquidate the collateral"* in one swap is the real
> defect. This design **decouples them**: spend from an operating USDC float; replenish the float
> asynchronously via the deep `wstETH→ETH→USDC` route. Both sides keep earning. It's how a real treasury
> runs — cash float + yield assets, not liquidate-on-every-purchase.

## The model

Three balances, two of them productive, one hot:

| Balance | Role | Earns |
|---|---|---|
| **wstETH backing** | the ETH-side reserve | staking **appreciation** (+ optional lending double-stack) |
| **USDC operating float** | pays card settlements instantly | **USDC lending** yield (Aave/Morpho) while above the working min |
| **junior USDC buffer** (existing) | first-loss top-up | — |

**Hot path (card settlement):** pay `totalUsdc` to the pinned rail **from the USDC float** — no swap, no
pool, no same-block liquidity dependency. If the float is short, junior tops up (existing), else revert-and-
retry (keeper replenishes first). An **emergency inline-swap valve** (the old oracle-bounded path, now
2-hop) exists but is off the normal path.

**Async (keeper `rebalanceFloat`):** when the float drops below target, a keeper converts a slice of wstETH
→ USDC via **`wstETH→ETH→USDC`** (deep liquidity), oracle-bounded on the ETH/USDC leg, and credits the
float. Off the latency-critical path, in optimized size, at good timing.

## Why 2-hop, and why it's not a liquidity problem

`wstETH/ETH` is one of the deepest pairs in DeFi (Curve stETH pool, Balancer, Uni); `ETH/USDC` is the
deepest pair anywhere. The `wstETH→ETH` leg is a near-1:1 **rate** swap (wstETH is a rate, not a volatile
market price — negligible slippage outside a depeg). So `wstETH→ETH→USDC` has excellent execution **today**,
with no pool to bootstrap. The manipulation-sensitive leg is `ETH/USDC` — keep the truncated-oracle band
there (reuse the audited `_swapLimit`/`_sqrtAtClamped` logic); the `wstETH/ETH` leg is bounded against the
Lido exchange rate (a reference that can't be sandwiched).

## Contract shape

Reuse the **audited primitives** — rail pin (H4), per-call + windowed caps (R2-M2), `minUsdcOut` catastrophe
floor, junior top-up, oracle-bounded swap — do NOT reinvent them. Cleanest structure (build agent may refine):
a go-forward **`MintwareTreasuryFloatSettlement`** (or a clearly-versioned evolution of the existing
contract) with:

**State**
- `wstEth` (IERC20, collateral), `usdc`, `weth` (the ETH hop token), the two canonical pools
  `wstEth/ETH` + `ETH/USDC` (each verified in the constructor).
- `usdcFloat`, `floatTargetUsdc`, `floatMinUsdc` (bounded risk params → adopt the 48h timelock).
- `usdcFloatAdapter` (optional `IYieldAdapter`, safe-default off) — lends idle float above `floatMinUsdc`.
- `wstEthAdapter` (optional `IYieldAdapter`, safe-default off) — the double-stack lending on idle wstETH.
- existing: `juniorUsdcBuffer`, `settlementRail`, caps, oracle source, breaker.

**Functions**
- `batchSettle(totalUsdc, rail)` — onlyRelayer, pinned-rail, caps: pull `totalUsdc` from float (unwind the
  float adapter best-effort if needed) → junior top-up on shortfall → pay rail. **No wstETH swap.** Emergency
  valve `batchSettleViaSwap(...)` = the old 2-hop oracle-bounded path if the float is exhausted.
- `rebalanceFloat(wstEthIn, minUsdcOut)` — onlyKeeper: 2-hop `wstETH→ETH→USDC`, oracle-bounded ETH/USDC leg,
  `minUsdcOut` floor, credit `usdcFloat`. Bounded by a per-call / windowed cap so a rogue keeper can't churn
  the backing. Emits full disclosure.
- `fundWstEthBacking` / `withdrawWstEthBacking`, `fundFloat` / `withdrawFloat`, `fund/withdrawJuniorBuffer`,
  `sweepFloatToAdapter` / `sweepWstEthToAdapter` (double-stack), setters (timelocked risk params).
- `totalBackingUsd()` = `usdcFloat` + `wstEth-value-in-USDC` (via the Lido rate × oracle ETH price, fee-aware)
  + adapters' `totalAssets`. Never overstate.

## Float sizing + safety

- **Size the float** to cover expected settlement flow between rebalances (e.g. a day's card volume ×
  headroom). The keeper targets `floatTargetUsdc`; settlements can dip it to `floatMinUsdc` before junior
  fallback / retry. Idle float above `floatMinUsdc` is lent for USDC yield, so the float is **not idle**.
- **Spend-spike protection:** if settlements outrun rebalancing and the float hits min, the order is: junior
  top-up (bounded) → the emergency inline 2-hop swap valve → revert-and-retry. The rail is **never underpaid**.
- **Keeper is bounded, not trusted with funds:** it only converts backing→float (additive to the treasury,
  never a payout); the rail stays pinned; `rebalanceFloat` has its own cap + oracle band + `minUsdcOut`.
- Reserve-floor + circuit-breaker (the edge-auth pre-audit #6 guards) map cleanly onto the float.

## Solvency invariant (the one that matters)

`totalBackingUsd() + junior ≥ senior claimable at par` — and each op preserves it: a settlement moves
float→rail (backing down by exactly what's paid); a rebalance moves wstETH→float (conserves total, minus
swap slippage which is bounded by `minUsdcOut` and absorbed by junior if it bites). Fuzz + invariant-test
this across settle/rebalance/fund/withdraw sequences.

## Both sides earning (the "never idle" payoff, honestly)

- wstETH backing: **appreciation** (~3–4%) + optional idle-wstETH lending double-stack.
- USDC float: **USDC lending** (~5–8%) on the idle portion.
- So the treasury earns on *both* legs continuously, and the ETH is genuinely never idle — via **holding**
  wstETH, not staking-as-a-service (plain Lido LST, no restaking; SEC Aug-2025 safe shape).

## Deploy prerequisites (now satisfiable — the win)

- A deep `wstETH/ETH` v4 pool + a deep `ETH/USDC` v4 pool for the keeper's 2-hop. **These liquidity sources
  exist** (unlike single-hop wstETH/USDC) — on v4 specifically, verify/seed depth, but you're routing through
  the two deepest pairs in DeFi, not a bespoke thin pool.
- Real wstETH/Lido + Aave WETH/USDC adapter addresses set post-audit via the timelock. Testnet uses mocks.

## Supersedes / migrates

- Supersedes the swap-on-settle path in PR #356 (WETH + lending adapter). The wstETH backing + optional
  double-stack from that line carry over; the *primary* spend mechanism becomes the float, not the atomic
  swap. Fold #356 into this PR.

## Considered + rejected

- **Inline 2-hop swap-on-settle** (no float): simpler, but re-couples spend latency to same-block 2-hop
  liquidity + keeps the manipulation surface on the hot path. The float removes both. (Keep it only as the
  emergency valve.)
- **Aggregator/universal-router settle:** widest liquidity but forfeits on-chain oracle-bound
  sandwich-resistance. Not for the core path.
- **Bootstrap a bespoke wstETH/USDC pool:** capital-heavy, circular, chicken-and-egg. Unnecessary once you
  route through ETH.
- **Raw ETH staking / restaking:** physical liquidity conflict / SEC exposure (see prior docs).

## Out of scope (still open)

The senior/junior **tranche split** under the vault — whether community ETH-side is "senior/protected" vs
team "junior/first-loss" — is the separate, unresolved wrapper question. This design is the spend/yield
plumbing beneath it, tranche-agnostic.
