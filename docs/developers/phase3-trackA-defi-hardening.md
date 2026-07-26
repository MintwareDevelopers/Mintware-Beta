# Phase 3 · Track A — DeFi Surface Hardening (Plan)

**Status:** In progress
**Parent:** [`phase3-two-surface-architecture.md`](phase3-two-surface-architecture.md)
**Builds on:** Track 0 (`MintwareBaseVault4626` / `MintwareDeFiVault4626` / registry).

Track A closes the DeFi gaps from the gap analysis: static fee → dynamic, MEV-capture → MEV-*protection*, full-range → profile-based ranges, no idle routing → idle routing. Per D7 we extend capabilities incrementally rather than splitting into 6 separate hooks.

## Increments (sequenced by self-containment)

| # | Increment | Where | Notes |
|---|---|---|---|
| **A1** | **Pool profiles** (BLUE_CHIP ±/EMERGING/MEME tick ranges) | `MintwareDeFiVault4626` | Self-contained vault range logic; no hook change. **← first** |
| A2 | Volatility/depth dynamic fee (`_calculateDynamicFee`) | DeFiVault override + `MWSocialHook.beforeSwap` wiring | Replace static admin fee with computed fee |
| A3 | MEV protection: TWAP + `detectSandwich` + cooldown | `MWSocialHook` before/afterSwap | Layer on top of existing deviation-capture |
| A4 | Idle-capital routing (`_rebalanceIdleCapital`, 60% target) | DeFiVault + hook | Needs capital-model design (deposits are single-sided LP today) |
| A5 | Clones + initializer factory (deferred from Track 0) | new `MintwareVaultFactory` + base initializer refactor + vendored OZ-upgradeable | Enables on-chain `createVault` under the 24 KB limit |

## A1 — Pool profiles (this increment)

Spec §3.3 / §5: `enum PoolProfile { BLUE_CHIP, EMERGING, MEME }` with tick half-widths (matching the spec's illustrative numbers, aligned to the pool's `tickSpacing`):

| Profile | Half-width (ticks) | ≈ range |
|---|---|---|
| BLUE_CHIP | 600 | ±~6% |
| EMERGING | 1200 | ±~13% |
| MEME | 2400 | ±~27% |

`rebalanceToProfile(PoolProfile)` (owner) reads the current pool tick, computes a symmetric range `[tick−hw, tick+hw]` aligned to `tickSpacing`, and reuses the base rebalance path (`Action.Rebalance` → `_rebalanceLiquidity`). Additive — `seedTeamTokens` still defaults to full range; profile takes effect when set. Emits `ProfileRebalanced`.

## Fee-model decision (carried, resolve at A2)
Spec wants entry/exit fees + a 50/25/25 swap-fee split; current model is early-exit penalty + FeeVault 70/15/10/5 buckets. Decide at A2 whether to adopt the spec split or keep the current outcome. `VaultConfig` already carries `entryFeeBps`/`exitFeeBps` (unused until decided).
