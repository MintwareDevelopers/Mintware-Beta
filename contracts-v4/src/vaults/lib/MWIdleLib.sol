// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SqrtPriceMath}         from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IYieldAdapter} from "../IYieldAdapter.sol";

/// @dev Minimal view of MintwareWeightedDistributor used for oracle-weighted fee routing (harvest leg).
interface IMWWeightedDistributorFees {
    function fundFees(bytes32 vaultId, uint256 amount0, uint256 amount1) external;
}

/// @title  MWIdleLib
/// @notice STATELESS, delegatecall-linked library holding the buffered-rehypothecation idle-capital
///         CORE of MintwareDeFiPairVault (`_supplyIdleCore` / `_refillIdleCore` / `_amountsForLiquidity`),
///         extracted verbatim to keep the vault under the EIP-170 24,576-byte runtime limit — the same
///         stateless-library pattern as MWJitLib. Delegatecalled from the vault, so `address(this)`,
///         `c.pm.unlock(...)` (which re-enters the vault's `unlockCallback` as the vault), and every
///         `adapter.deposit`/`withdraw` resolve AS the vault.
///
/// @dev    Owns NO storage. The idle-mutable counters travel in `IdleState` (in → out); the vault's
///         `_loadIdle`/`_storeIdle` mirror the COMPLETE set (positionLiquidity, idleLiquidity, idle0,
///         idle1) in and back out. Vault immutables + the live range travel in `Ctx`. Behavior is
///         byte-for-byte identical to the pre-extraction inline code: same clamps, same round-DOWN
///         (vault-favoring) `want` math, same graceful `maxSuppliable()==0` / dust no-op returns, same
///         leftover re-idle, same `Idled`/`Refilled` events (emitted here under delegatecall ⇒ logged
///         with the vault's address + identical topic0). Adapters are guaranteed non-zero by the vault's
///         `AdaptersNotSet` guard on every calling entrypoint.
///
///         Storage-timing note (non-behavioral): the vault writes the counters back AFTER this call
///         returns (`_storeIdle`), so during the internal `c.pm.unlock` / adapter calls the counter
///         STORAGE is momentarily stale. This is unobservable: the unlock callback (`_deploy`/`_remove`)
///         never reads these counters, and every calling entrypoint is `nonReentrant` — identical
///         protection to the pre-extraction code, and to how MWJitLib defers its writes.
library MWIdleLib {
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    /// @dev Same action set + order as MintwareDeFiPairVault.Action, so the abi-encoded action word the
    ///      vault's `unlockCallback` decodes matches by index (Deploy=0, Remove=1, …).
    enum Action { Deploy, Remove, Rebalance, Collect, SweepClaims }

    // Harvest constants — MUST equal the vault's (MINTWARE_FEE_BPS=2500, BPS=10000, ACC_PRECISION=1e18).
    uint256 private constant MINTWARE_FEE_BPS = 2_500;
    uint256 private constant BPS              = 10_000;
    uint256 private constant ACC_PRECISION    = 1e18;

    event Idled(uint128 liquidity, uint256 amount0, uint256 amount1);
    event Refilled(uint128 liquidity, uint256 amount0, uint256 amount1);
    event YieldHarvested(uint256 lp0, uint256 lp1, uint256 mintware0, uint256 mintware1);
    event FeesRoutedToDistributor(bytes32 indexed vaultId, uint256 lp0, uint256 lp1);

    /// @dev Vault immutables + the live active range the library needs but cannot read under delegatecall.
    struct Ctx {
        IPoolManager  pm;
        PoolKey       key;
        IERC20        t0;
        IERC20        t1;
        IYieldAdapter a0;
        IYieldAdapter a1;
        int24         tickLower;
        int24         tickUpper;
    }

    /// @dev The COMPLETE set of idle-core-mutable vault storage. Loaded before the call, written back
    ///      after. A missed field on either side is silent state corruption.
    struct IdleState {
        uint128 positionLiquidity;
        uint128 idleLiquidity;
        uint256 idle0;
        uint256 idle1;
    }

    /// @notice Remove `deltaL` pooled liquidity and supply the resulting principal to Aave. Mirrors the
    ///         old `_supplyIdleCore` EXACTLY. Fees must already be realized by the vault (so out0/out1 are
    ///         clean principal). Graceful no-op returns (unchanged state) on: zero delta / no position /
    ///         either reserve full / a dust removal that frees nothing.
    function supplyIdle(Ctx memory c, IdleState memory s, uint128 deltaL) external returns (IdleState memory) {
        if (deltaL == 0 || s.positionLiquidity == 0) return s;
        if (deltaL > s.positionLiquidity) deltaL = s.positionLiquidity;
        // Graceful gate: only idle if BOTH reserves can currently accept supply (else no-op).
        if (c.a0.maxSuppliable() == 0 || c.a1.maxSuppliable() == 0) return s;
        // Skip a dust removal that would free zero tokens on both sides (would burn pooled liquidity
        // for nothing and bleed a phantom idleLiquidity counter). Pure view calc, no state.
        {
            (uint256 exp0, uint256 exp1) = _amountsForLiquidity(c, deltaL);
            if (exp0 == 0 && exp1 == 0) return s;
        }

        s.positionLiquidity -= deltaL;
        s.idleLiquidity     += deltaL;

        bytes memory res = c.pm.unlock(abi.encode(Action.Remove, abi.encode(deltaL)));
        (uint256 out0, uint256 out1) = abi.decode(res, (uint256, uint256));
        s.idle0 += out0;
        s.idle1 += out1;

        // Supply to Aave. Exact-amount approvals; the adapter pulls from the vault.
        if (out0 > 0) { c.t0.forceApprove(address(c.a0), out0); c.a0.deposit(out0); }
        if (out1 > 0) { c.t1.forceApprove(address(c.a1), out1); c.a1.deposit(out1); }
        emit Idled(deltaL, out0, out1);
        return s;
    }

    /// @notice Withdraw a pro-rata slice of idle principal from Aave and redeploy it into the active
    ///         range. Mirrors the old `_refillIdleCore` EXACTLY, including the leftover re-idle so no
    ///         tokens strand in the vault and `idleN` only ever moves by the deployed amount.
    function refillIdle(Ctx memory c, IdleState memory s, uint128 deltaL) external returns (IdleState memory) {
        if (deltaL == 0 || s.idleLiquidity == 0) return s;
        if (deltaL > s.idleLiquidity) deltaL = s.idleLiquidity;

        // Token amounts backing this liquidity-equiv slice (round DOWN — vault-favoring).
        uint256 want0 = (s.idle0 * deltaL) / s.idleLiquidity;
        uint256 want1 = (s.idle1 * deltaL) / s.idleLiquidity;

        // Best-effort withdraw from Aave (tokens land in the vault).
        uint256 got0 = want0 > 0 ? c.a0.withdraw(want0) : 0;
        uint256 got1 = want1 > 0 ? c.a1.withdraw(want1) : 0;

        // Redeploy what we pulled into the active range.
        uint128 addedL;
        uint256 used0;
        uint256 used1;
        if (got0 > 0 || got1 > 0) {
            bytes memory res = c.pm.unlock(abi.encode(Action.Deploy, abi.encode(got0, got1)));
            (addedL, used0, used1) = abi.decode(res, (uint128, uint256, uint256));
        }

        // Net idle change = principal that actually left Aave for the pool (`used`). The ratio-mismatch
        // leftover (`got - used`) is re-supplied to Aave, so `idleN` only ever moves by the deployed
        // amount and no tokens strand in the vault.
        s.idle0 -= used0;
        s.idle1 -= used1;
        s.positionLiquidity += addedL;
        // managed-liquidity conserving: pool gained `addedL`, so idle-equiv drops by `addedL`.
        s.idleLiquidity -= addedL <= s.idleLiquidity ? addedL : s.idleLiquidity;

        uint256 left0 = got0 - used0;
        uint256 left1 = got1 - used1;
        if (left0 > 0) { c.t0.forceApprove(address(c.a0), left0); c.a0.deposit(left0); }
        if (left1 > 0) { c.t1.forceApprove(address(c.a1), left1); c.a1.deposit(left1); }
        emit Refilled(addedL, used0, used1);
        return s;
    }

    /// @dev Token amounts that removing `liquidity` from the active range would free at the current
    ///      price (round DOWN, matching V4's own removal rounding). Pure view. Private copy of
    ///      MintwareDeFiPairVault._amountsForLiquidity — the SqrtPriceMath usage lives here now.
    function _amountsForLiquidity(Ctx memory c, uint128 liquidity)
        private
        view
        returns (uint256 amount0, uint256 amount1)
    {
        (uint160 sqrtP,,,) = c.pm.getSlot0(c.key.toId());
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(c.tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(c.tickUpper);
        if (sqrtP <= sqrtLower) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtLower, sqrtUpper, liquidity, false);
        } else if (sqrtP < sqrtUpper) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtP, sqrtUpper, liquidity, false);
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtP, liquidity, false);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtUpper, liquidity, false);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Aave yield harvest (moved verbatim from MintwareDeFiPairVault.harvestYield/_harvestOne)
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Immutables + routing config the harvest needs (idleN is the settled principal basis; the
    ///      live aToken surplus over it is the yield). `totalLiquidity` chooses the credit path.
    struct HarvestCtx {
        IERC20        t0;
        IERC20        t1;
        IYieldAdapter a0;
        IYieldAdapter a1;
        address       treasury;
        address       weightedDistributor;
        bytes32       distributorVaultId;
        uint256       idle0;
        uint256       idle1;
        uint128       totalLiquidity;
    }

    /// @dev The COMPLETE set of harvest-mutable vault storage (the pro-rata fee accumulators + the
    ///      segregated reserve). idleN is NOT touched by harvest (yield is not principal), so it is
    ///      read-only via HarvestCtx and NOT part of this write-back set.
    struct HarvestState {
        uint256 accFee0PerShare;
        uint256 accFee1PerShare;
        uint256 feeReserve0;
        uint256 feeReserve1;
    }

    /// @notice Harvest Aave supply yield (surplus of `adapter.totalAssets()` over settled `idleN`) and
    ///         distribute it to LPs EXACTLY like swap fees — weighted distributor if wired, else the
    ///         pro-rata per-share accumulator + segregated reserve. `idleN` untouched (Bunni-safe).
    ///         Mirrors the old `harvestYield`/`_harvestOne` bodies EXACTLY (minus the `AdaptersNotSet`
    ///         guard kept in the vault wrapper).
    function harvest(HarvestCtx memory c, HarvestState memory s)
        external
        returns (HarvestState memory, uint256 lp0, uint256 lp1)
    {
        (uint256 g0, uint256 mint0) = _harvestOne(c, s, c.a0, c.t0, c.idle0, true);
        (uint256 g1, uint256 mint1) = _harvestOne(c, s, c.a1, c.t1, c.idle1, false);
        lp0 = g0;
        lp1 = g1;
        if (g0 > 0 || g1 > 0) emit YieldHarvested(g0, g1, mint0, mint1);
        return (s, lp0, lp1);
    }

    /// @dev Realize one token's yield surplus into distributable fees. Returns (lpPortion, mintwareCut);
    ///      mutates `s` accumulators on the pro-rata path.
    function _harvestOne(
        HarvestCtx memory c,
        HarvestState memory s,
        IYieldAdapter adapter,
        IERC20 token,
        uint256 idleN,
        bool isToken0
    ) private returns (uint256 lpAmt, uint256 mintwareAmt) {
        uint256 assets = adapter.totalAssets();
        if (assets <= idleN) return (0, 0);
        uint256 surplus = assets - idleN;
        // Pull yield only — principal (`idleN`) stays supplied, so the settled counter is unchanged.
        uint256 got = adapter.withdraw(surplus);
        if (got == 0) return (0, 0);

        mintwareAmt = (got * MINTWARE_FEE_BPS) / BPS;
        if (mintwareAmt > 0) token.safeTransfer(c.treasury, mintwareAmt);
        lpAmt = got - mintwareAmt;
        if (lpAmt == 0) return (0, mintwareAmt);

        if (c.weightedDistributor != address(0)) {
            (uint256 r0, uint256 r1) = isToken0 ? (lpAmt, uint256(0)) : (uint256(0), lpAmt);
            IMWWeightedDistributorFees(c.weightedDistributor).fundFees(c.distributorVaultId, r0, r1);
            emit FeesRoutedToDistributor(c.distributorVaultId, r0, r1);
        } else if (c.totalLiquidity == 0) {
            // No LPs to credit — forward to treasury rather than strand it or divide by zero.
            token.safeTransfer(c.treasury, lpAmt);
            mintwareAmt += lpAmt;
            lpAmt = 0;
        } else if (isToken0) {
            s.accFee0PerShare += (lpAmt * ACC_PRECISION) / c.totalLiquidity;
            s.feeReserve0 += lpAmt;
        } else {
            s.accFee1PerShare += (lpAmt * ACC_PRECISION) / c.totalLiquidity;
            s.feeReserve1 += lpAmt;
        }
    }
}
