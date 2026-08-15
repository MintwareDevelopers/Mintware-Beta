# Phase 2 — YPN Vault Convergence Blueprint

_Branch `feat/ypn-vault-convergence`. Fold `MintwareTreasuryVault` onto the `MintwarePairVault` base and
absorb `MintwareV4LiquidityModule`, keeping the JIT hook separate. Security-critical rewrite of the contract
that holds community senior USDC at par — must NOT regress the audited invariants. Testnet-only + parked, so
we replace in place on this branch, but nothing deploys until the full invariant suite is re-proven + audited._

## The change in one line
`MintwareTreasuryVault is IYieldVault, Ownable, Pausable, ReentrancyGuard`  →
`MintwareTreasuryVault is MintwarePairVault, IUnlockCallback, IYieldVault` — the vault becomes the pool's LP
holder directly (no delegate module), reusing the base's audited V4 settlement + guardian + pool identity.

## What moves where

| Piece | Today | After |
|---|---|---|
| `Ownable`/`Pausable`/`ReentrancyGuard` | vault declares them | inherited via `MintwarePairVault → MWGuardianPausable` (+ **gains a guardian kill-switch** — upgrade) |
| `poolManager`, pool key, `tickLower/Upper`, `_settleDelta`/`_pay`/`_initializePool` | in the module | inherited from `MintwarePairVault` (one audited copy of the trickiest V4 code) |
| `positionLiquidity`, `deploy`/`recover`/`collect` ops, `recoverableUSDC`/`_valueAt`/`_valueTeamInUsdc`, `_swapTeamToUsdc`+`_swapLimit`+`_sqrtAtClamped` | `MintwareV4LiquidityModule` (its own `unlockCallback`) | absorbed into the vault's OWN `unlockCallback` (Op dispatch: DEPLOY/RECOVER/COLLECT) |
| Tranche accounting (senior shares via `SeniorSharesMath`, `deployedFromSenior`, `reservedJuniorUSDC`, `junior*`, `jitBorrowed`/breaker/oracle-min), gateway seam (`burnForPayment`), Aave adapter (idle-first), deposit/redeem | in the vault | **unchanged, stays** |
| JIT hook (`MintwareTreasuryJitHook`) + its truncated oracle | separate V4 hook; module reads `hook.oracleTick()` | **stays separate** (it's a hook); the VAULT now reads `hook.oracleTick()` directly in `recoverableUSDC` (same `min(spot,oracle)`) |
| `MintwareV4LiquidityModule.sol`, `ILiquidityModule.sol`, `setLiquidityModule`/`liquidityModule` wiring | live | **deleted** after the merged vault is green |

## The two real hazards (get these right or don't ship)

### 1. Reentrancy path — the #1 correctness point
Today a redemption is `redeemSenior`/`burnForPayment` (**`nonReentrant`**) → `_pullUSDC` → `_recoverFromLP`
→ `liquidityModule.recover()` → `module.unlock()` → PoolManager calls back `module.unlockCallback` (a
**separate** contract, so the vault's guard is untouched). After the merge that callback lands on the SAME
contract, mid-`nonReentrant`:
`redeemSenior` (nonReentrant) → `_pullUSDC` → internal `_recover` → `poolManager.unlock()` → PoolManager
makes an EXTERNAL call to **`this.unlockCallback()`**.
→ **`unlockCallback` MUST be guarded by `_onlyPoolManager()` only — NEVER `nonReentrant`** (it legitimately
re-enters during the locked outer call; a `nonReentrant` there would revert every redemption). The Op-dispatch
internals must call only INTERNAL helpers, never a `nonReentrant` external self-function. This is exactly the
module's current pattern — preserve it verbatim when absorbing.

### 2. EIP-170 bytecode size — the #1 shipping risk
The module (~20KB src) + vault (~38KB src) merged would likely exceed the 24,576-byte deployed limit (the
ULV already hit this — see `ulv_vault_eip170_blocker`). **Key correctness point:** a plain `internal` library
does NOT help — internal library functions are INLINED into the caller's bytecode. Real EIP-170 relief needs
a **delegatecall (`external`) library** whose code is deployed separately and linked — exactly how the pair
vault keeps size down with `MWPositionLib` (a "STATELESS, delegatecall-linked library holding the V4 unlock
handlers", taking a `Ctx` struct of the vault's immutables + live range because it can't read the vault's
storage directly).
**⇒ Absorbing the module is really "convert `MintwareV4LiquidityModule` from a separate CALLED contract into
a delegatecall LIBRARY the vault links"** (a YPN analog of `MWPositionLib`): the heavy V4 unlock handlers
(deploy/recover/collect) + valuation move into `library MWTreasuryPositionLib`, the vault holds the position
STATE and `delegatecall`s the library so `address(this)`/storage context is the vault. Measure `forge build
--sizes` at every step.

## Increment plan (each step: `forge build --sizes` + the 256×128k invariants green before the next)
> The increments are more coupled than a clean 1-2-3 (the base-state `poolKey`/ticks are unused until the
> vault holds the position, so re-basing and absorbing land together). Order chosen to keep a green suite
> at every commit.
1. **`MWTreasuryPositionLib` (delegatecall library):** lift the module's V4 unlock handlers
   (deploy/recover/collect) + valuation (`_valueAt`/`_valueTeamInUsdc`/swap-limit) into a stateless
   delegatecall library taking a `Ctx` (pool key, ticks, currency order, `usdcIsCurrency0`, live liquidity),
   mirroring `MWPositionLib`. This is where EIP-170 relief comes from — it must be `external`/delegatecall,
   not `internal`.
2. **Re-base + absorb (one commit, since coupled):** `MintwareTreasuryVault is MintwarePairVault,
   IUnlockCallback, IYieldVault`; drop own `Ownable/Pausable/ReentrancyGuard`; the vault holds
   `positionLiquidity` + range, sets `poolKey` via the base, and its `unlockCallback` (`_onlyPoolManager`,
   NOT `nonReentrant`) `delegatecall`s `MWTreasuryPositionLib` for DEPLOY/RECOVER/COLLECT; replace every
   `liquidityModule.*` call with an internal `poolManager.unlock(...)`. The vault reads `hook.oracleTick()`
   directly for the `min(spot,oracle)` floor.
3. **Re-prove:** port the module's unit + manipulation tests into the vault suite; update the invariant
   handler to deploy just the vault (self-holding the position); all 7 invariants green at 256×128k, plus the
   pool-key-binding / oracle-manipulation regressions. `--sizes` under 24KB.
4. **Delete** `MintwareV4LiquidityModule.sol` + `ILiquidityModule.sol` + the `setLiquidityModule`/
   `liquidityModule` wiring; full suite green.
5. **Gate:** external audit before any deploy. The current split vault is safe + green; convergence buys
   reduced surface + (with Phase 3) multi-tenancy — it must not regress safety, so a red invariant at any
   step halts the merge.

## What this explicitly does NOT change
- The JIT hook (stays a separate V4 hook), the gateway seam (`IYieldVault.burnForPayment`), the Aave adapter,
  the senior par / price-free NAV semantics, `SeniorSharesMath`, the `min(spot,oracle)` solvency floor, the
  H2/H4 JIT guards. Convergence is structural; the money semantics are preserved verbatim.
