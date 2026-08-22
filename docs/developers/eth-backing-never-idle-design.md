# Making the ETH backing "never idle" — design + research

> **Problem (verified in code, 2026-08-22).** The product ethos is *"never idle."* It is **true for the
> senior USDC** — `MintwareTreasuryVault.depositUSDC` auto-supplies capital into a yield adapter on deposit
> (`_supplyToAdapter → adapter.deposit`, proven on Arc against a live yield source). It is **NOT true for the
> ETH backing**: in `MintwareEthSettlement`, `wethBacking` is a raw WETH balance that just sits — funded,
> then only ever spent on a settlement swap or withdrawn. **No staking, no adapter, no yield.** This design
> makes the ETH backing earn liquid-staking yield while staying settlement-liquid, so the claim is honest.

## Design goal (one sentence)

The WETH backing earns liquid-staking yield through a **ministerial** adapter, keeping only a **liquid
buffer** on hand, and **unwinds on demand** before a settlement swap — so settlements are never starved and
the ETH is never idle. Same proven idle-buffer/supply/pull shape the treasury vault already uses for USDC.

## Why this shape (research)

### The binding constraint: settlement needs *liquid* WETH
`batchSettleEth` runs an **exact-output** WETH→USDC swap that consumes WETH from `weth.balanceOf(this)`
(`MintwareEthSettlement.sol:376,384`). If the backing is staked, it isn't on hand at swap time. So we cannot
simply "stake it all" — we must keep enough liquid WETH to feed the swap, and unwind more when a settlement
is large. This is *exactly* the tension the treasury vault already solved for USDC with
`idleBufferTargetBps` + `_supplyToAdapter` + `_pullUSDC`. We reuse that shape, not invent one.

### The interface is already the right seam
`IYieldAdapter` (`src/vaults/IYieldAdapter.sol`) is perfect for this:
- `deposit(amount)` — stake WETH (buffer excess).
- `withdraw(amount) → withdrawn` — **best-effort, never reverts for liquidity** (returns partial/0). Ideal
  for a pre-settlement pull: a partial unwind is safe because the swap + junior top-up + `minUsdcOut`
  catastrophe floor already handle a shortfall (revert-and-retry, rail never underpaid).
- `totalAssets()` — WETH attributable (principal + yield), **fee-/rate-aware** so we never overstate backing.
- `maxWithdrawable()` — instant liquidity (size the pull as `min(need, maxWithdrawable())`).
- `maxSuppliable()` — supply headroom.

So the settlement contract talks only to this interface; the wstETH specifics live behind the adapter
(built separately, `legal/ministerial-adapter`).

## The build (Phase B — wiring `MintwareEthSettlement`)

**Safe default — this is additive and off until deliberately turned on.** New `IYieldAdapter public
wethAdapter` defaults to `address(0)`. **While unset, behaviour is byte-for-byte today's** (WETH fully
liquid, no staking). Setting an audited adapter is what turns on earning. No behaviour change ships without
an explicit, audited enablement.

New/changed surface:
1. **`wethAdapter`** (`IYieldAdapter`, settable) + **`wethIdleBufferBps`** (default e.g. `3000` = keep 30%
   liquid, stake 70% — deliberately more conservative than the USDC vault's 20%, because settlement WETH
   turns over frequently and unwind slippage should be rare). Both are **risk parameters** → they go through
   the **48h bounded timelock** the governance workstream is adding (`legal/timelock-risk-params`); the
   adapter is *set-once-then-timelocked* like the oracle signer.
2. **`totalWethBacking()` view** = `weth.balanceOf(this)` (on-hand) `+ wethAdapter.totalAssets()` (staked,
   fee-aware). This is the number NAV/solvency reads — **valued at the adapter's realistic exit price, never
   the wrapped face value**, so a wstETH discount can't overstate the backing.
3. **`_supplyExcessWeth()`** — internal: `liquid = weth.balanceOf(this)`; `target = totalWethBacking() *
   wethIdleBufferBps / 1e4`; if `liquid > target`, `deposit(min(liquid - target, maxSuppliable()))` into the
   adapter (forceApprove→deposit→reset-on-catch, mirroring `_supplyToAdapter`). Called from
   `fundWethBacking` and an owner/keeper `sweepWethToAdapter()`.
4. **`_ensureLiquidWeth(need)`** — internal: if `weth.balanceOf(this) < need`, pull `min(need − onHand,
   maxWithdrawable())` via `wethAdapter.withdraw` (best-effort). Called **before** the settlement swap.
5. **`batchSettleEth` change** — before `poolManager.unlock`, estimate the WETH the exact-output swap will
   consume: `wethNeed ≈ (totalUsdc / oraclePrice) * marginBps` (oracle tick → price; `marginBps` ~120% to
   cover slippage), then `_ensureLiquidWeth(wethNeed)`. If the adapter can't fully unwind, the swap consumes
   what's liquid and the **existing** shortfall path (junior top-up, `minUsdcOut` floor, revert-and-retry)
   applies unchanged — **the rail is still paid in full or not at all.** No new underpayment risk.
6. **Backing conservation across buffer + adapter.** Today `wethBacking` tracks physical WETH and decays by
   `wethSpent` (`:403`, with the L4 donation clamp). With staking, the tracked-backing invariant becomes
   **`totalWethBacking()` decreases by exactly the WETH the swap consumed** (the unwind just moves WETH from
   adapter→on-hand, conserving the total). The invariant suite must assert this across a fund→stake→settle→
   unwind sequence.
7. **`withdrawWethBacking`** — pull from the adapter first if on-hand is short (`_ensureLiquidWeth` then
   transfer); never sell staked position at a loss for a routine withdraw (bound to `maxWithdrawable`).

## Risk analysis (the part staking actually introduces)

| Risk | Mitigation in this design |
|---|---|
| **stETH/wstETH depeg** (value < 1:1 WETH; ~7% in 2022) — shrinks backing for par settlements | `totalWethBacking()` values via the adapter's **fee-/rate-aware exit preview**, never face value → NAV can't overstate. A depeg is an **ETH-side move the junior first-loss tranche already exists to absorb** (same tranche that absorbs ETH price moves). Conservative default buffer (30% liquid) means most settlements never touch staked WETH. |
| **Withdrawal illiquidity** — real Lido withdrawals are a multi-day queue | The adapter's `withdraw`/`maxWithdrawable` use the **instant** path (wstETH→WETH DEX swap, bounded slippage), **not** the queue. The liquid buffer covers routine settlement; only large batches unwind, and `withdraw` is best-effort so a thin moment degrades gracefully (revert-and-retry), never a DoS. |
| **Ministerial / SEC Aug-2025** | The adapter has **no discretion** over stake timing/amount (driven only by the buffer rule + caller amount) and **no promised rate** — see `legal/ministerial-adapter`. Settlement just calls `deposit`/`withdraw`; it never "decides" to stake. |
| **Edge-auth coherence** | edge-auth's VaR haircut `γ = 1 − (z·σ·√T + slippage)` should fold in a small **wstETH/ETH basis σ** so the reserved buffer covers the staking basis too. Off-chain follow-up (note in `services/edge-auth`), not a contract change. |
| **New external dependency (adapter) on the settlement hot path** | `withdraw` is best-effort/non-reverting; adapter `deposit` is wrapped in try/catch (like `_supplyToAdapter`); `wethAdapter == 0` fully bypasses everything. A broken adapter degrades to "stays liquid," never bricks settlement. |

## Phasing

- **Phase A — the adapter** (`legal/ministerial-adapter`, in progress): ministerial wstETH `IYieldAdapter`
  + mock (Lido isn't on testnet) + tests + SEC mapping doc.
- **Phase B — the wiring** (this doc): buffer + supply + pull-on-settle + fee-aware `totalWethBacking` +
  invariants, in `MintwareEthSettlement`. **Interface-only dependency on Phase A** → can be built in parallel
  against `IYieldAdapter` with a mock, integrated at deploy by setting `wethAdapter`.
- **Enablement** (post-audit): deploy the real wstETH adapter, timelock-set it as `wethAdapter`, size the
  buffer. Until then the settlement behaves exactly as today (safe default).

## What must stay green / true

- All existing `MintwareEthSettlement` tests pass with `wethAdapter == 0` (proves the safe default is a
  no-op).
- New tests: fund→auto-stake, settle-pulls-from-adapter, large-settle-partial-unwind-still-pays-or-reverts,
  `totalWethBacking` conservation across the whole sequence, depeg-shrinks-NAV-not-overstated, adapter-broken
  degrades-to-liquid, withdraw-pulls-from-adapter.
- The H4 rail pin, R2-M2 caps, oracle band, junior top-up, and `minUsdcOut` floor are **unchanged** — the
  staking layer sits *underneath* them.
