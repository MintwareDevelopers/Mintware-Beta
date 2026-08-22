# Making the ETH backing "never idle" — via lending (Aave/Morpho), not staking

> **Decision (2026-08-22).** The ETH backing must earn so *"never idle"* is honest — but via
> **DeFi lending** (Aave/Morpho supply), **not liquid staking.** Staking-as-a-service is the exact
> profile the SEC pursued (Kraken, Coinbase); non-custodial, over-collateralized, algorithmic lending
> into a public protocol is a different posture and is the one counsel cleared. Same "never idle" outcome,
> no staking-securities exposure. See the staking analysis lower down (considered + rejected).

> **Problem (verified in code).** The senior **USDC** already earns — `MintwareTreasuryVault.depositUSDC`
> auto-supplies into a yield adapter on deposit (proven on Arc). The **ETH backing does not**: in
> `MintwareEthSettlement`, `wethBacking` is a raw WETH balance that just sits until spent or withdrawn.
> This wires it to earn **lending** yield while staying settlement-liquid — the same seam the USDC uses,
> so the model is consistent across both sides.

## Design goal (one sentence)

The WETH backing earns **Aave/Morpho lending** yield through the existing `IYieldAdapter` seam, keeping only
a **liquid buffer** on hand and **unwinding on demand** before a settlement swap — so the ETH is never idle
and settlements are never starved. Identical idle-buffer/supply/pull shape the treasury vault already uses
for USDC.

## Why this is the clean path (research)

### The yield source is a lending market, not consensus
Supply WETH → borrowers pay interest → yield. No validator role, no network-securing service, no promised
rate — the interest is set by supply/demand (utilization). Honest caveat: WETH lending yield is **modest**
(~1–3%, usually below USDC's because ETH borrow demand is low) — but the ETH is *collateral*, so any yield
is a bonus that makes "never idle" true, not the headline. The earning story stays a **USDC** story.

### The adapter already exists and already speaks WETH — NO new yield contract
`AaveV3YieldAdapter` is **asset-generic**: constructor takes `_asset` + `_aToken`; its NatSpec reads *"The
underlying token this adapter idles (e.g. USDC or WETH)."* So the real instance is just
`AaveV3YieldAdapter(WETH, aWETH)` — or `MintwareMultiVenueYieldAdapter` to fan across **Aave + Morpho** for
WETH. The settlement contract talks only to `IYieldAdapter`; the venue lives behind it.

### The binding constraint: settlement needs *liquid* WETH
`batchSettleEth` runs an **exact-output** WETH→USDC swap that consumes WETH from `weth.balanceOf(this)`
(`:376,384`). So we cannot lend it all — keep a liquid buffer to feed the swap, unwind more when a
settlement is large. This is exactly what the treasury vault does for USDC (`idleBufferTargetBps` +
`_supplyToAdapter` + `_pullUSDC`). We reuse that shape. `IYieldAdapter.withdraw` is **best-effort / never
reverts for liquidity** — ideal for a pre-settlement pull, because a partial unwind is already safe (junior
top-up + `minUsdcOut` floor + revert-and-retry handle any shortfall; the rail is never underpaid).

## The build (wiring `MintwareEthSettlement`)

**Safe default — additive, off until deliberately enabled.** New `IYieldAdapter public wethAdapter`
defaults to `address(0)`. **While unset, behaviour is byte-for-byte today's** (WETH fully liquid, no
lending). Setting an audited WETH lending adapter is what turns on earning. Nothing changes silently.

1. **`wethAdapter`** (`IYieldAdapter`, owner-settable, first-set-immediate then locked — will adopt the
   shared 48h risk-param timelock the governance branch adds).
2. **`wethIdleBufferBps`** (default `3000` = keep 30% liquid, lend 70%), bounded — conservative because
   settlement WETH turns over and unwinds should be rare.
3. **`totalWethBacking()` view** = on-hand WETH `+ wethAdapter.totalAssets()` (0 adapter → just on-hand).
   Aave aTokens rebase, so `totalAssets` already reflects accrued interest at redeemable value — never
   overstates.
4. **`_supplyExcessWeth()`** (forceApprove→deposit→reset-on-catch, respect `maxSuppliable`) from
   `fundWethBacking` + an owner/keeper `sweepWethToAdapter()`.
5. **`_ensureLiquidWeth(need)`** — pull `min(need−onHand, maxWithdrawable())` via `wethAdapter.withdraw`
   (best-effort) when on-hand is short.
6. **`batchSettleEth`** — before `poolManager.unlock`, estimate `wethNeed ≈ (totalUsdc / oraclePrice) *
   marginBps` (~120%) and `_ensureLiquidWeth(wethNeed)`. If the adapter can't fully unwind, the EXISTING
   shortfall path applies unchanged — rail paid in full or not at all. H4 rail-pin, R2-M2 caps, oracle band,
   junior top-up, `minUsdcOut` floor all **unchanged** — the lending layer sits underneath them.
7. **Conservation** — invariant becomes `totalWethBacking()` decreases by exactly the WETH the swap consumed
   (unwind just moves WETH adapter→on-hand). Keep the L4 donation clamp. `withdrawWethBacking` pulls from the
   adapter first if on-hand is short.

## Risk analysis (what lending actually introduces — different from staking)

| Risk | Mitigation |
|---|---|
| **Lending-protocol smart-contract risk** (Aave/Morpho hack) | The **same risk the USDC side already accepts.** Aave v3 is battle-tested; Morpho via curated vaults. Backing exposed only to the amount lent (buffer stays on-hand). |
| **Utilization / withdrawal crunch** (near-100% utilization → supply temporarily illiquid) | `withdraw`/`maxWithdrawable` reflect available liquidity; a thin moment degrades to partial-unwind → junior top-up → revert-and-retry, never a settlement DoS. The 30% liquid buffer keeps routine settlements off the adapter. |
| **Rate variability** | No guaranteed rate — consistent with the no-APY discipline. |
| **New dependency on the settlement hot path** | `withdraw` best-effort/non-reverting; `deposit` in try/catch; `wethAdapter == 0` bypasses everything → a broken adapter degrades to "stays liquid," never bricks settlement. |
| ~~stETH depeg / slashing / staking-securities~~ | **N/A — not staking.** This is why lending was chosen. |

## Deployment

Real WETH lending isn't on Base Sepolia → tests use a **mock** `IYieldAdapter` (best-effort withdraw +
settable utilization/illiquidity). Real instance = `AaveV3YieldAdapter(WETH, aWETH)` (or MultiVenue) on
mainnet, set as `wethAdapter` **post-audit** via the timelock. Until then the settlement behaves exactly as
today (safe default).

## Considered + rejected: liquid staking (wstETH)

Higher headline yield (~3–4% vs ~1–3%), but: (1) **SEC** — staking-on-behalf + yield pass-through is the
Kraken/Coinbase enforcement profile; a "ministerial" wrapper only narrows it. (2) **Depeg** — stETH can
trade below ETH (~7% in 2022), shrinking backing. (3) **Withdrawal queue** — multi-day, forcing reliance on
a DEX exit. Lending avoids all three for a small yield give-up on an asset that's collateral anyway.

## What must stay green / true

- All existing `MintwareEthSettlement` tests pass with `wethAdapter == 0` (safe default is a no-op).
- New tests: fund→auto-lend; settle-pulls-from-adapter; large-settle→partial-unwind→still-pays-or-cleanly-
  reverts; `totalWethBacking` conservation across fund→lend→settle→unwind; utilization/illiquidity degrades
  gracefully; broken-adapter degrades-to-liquid; withdraw-pulls-from-adapter; an invariant if tractable.
- H4 / R2-M2 / oracle band / junior top-up / `minUsdcOut` floor unchanged — lending sits underneath them.
