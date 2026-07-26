// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}          from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts}      from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {MintwareBaseVault4626} from "./MintwareBaseVault4626.sol";
import {VaultConfig}           from "./VaultTypes.sol";

/// @title  MintwareDeFiVault4626
/// @notice Surface-1 (DeFi) vault. Extends the ERC-4626 base with single-sided
///         USDC liquidity deployment into a Uniswap V4 pool paired against a
///         team-seeded PROJECT token. This is the ERC-4626 evolution of the
///         Phase-2 SocialVault (behavior preserved; now a tokenized share vault).
///
/// @dev    Implements the base's liquidity hooks (_deployLiquidity / _removeLiquidity
///         / _rebalanceLiquidity). Volatility/depth dynamic fees, pool profiles, and
///         idle-capital routing arrive in Track A.
contract MintwareDeFiVault4626 is MintwareBaseVault4626 {
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;

    struct TeamSeed {
        address projectToken;
        uint256 amount;
        uint256 seededAt;
    }

    mapping(bytes32 => TeamSeed) public teamSeeds;

    event TeamSeeded(bytes32 indexed vaultId, address token, uint256 amount);

    error InvalidSeed();
    error SeedAlreadyInitialized();
    error InvalidPoolKey();

    constructor(VaultConfig memory cfg, address _poolManager, address _feeVault)
        MintwareBaseVault4626(cfg, _poolManager, _feeVault)
    {}

    // ─────────────────────────────────────────────────────────────────────────
    // Team seeding + pool init (DeFi-surface specific)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Team seeds PROJECT tokens and initializes the V4 pool.
    function seedTeamTokens(
        bytes32 vaultId,
        address projectToken,
        uint256 amount,
        PoolKey calldata key,
        uint160 sqrtPriceX96
    ) external onlyOwner nonReentrant {
        if (projectToken == address(0) || amount == 0) revert InvalidSeed();
        if (teamSeeds[vaultId].projectToken != address(0)) revert SeedAlreadyInitialized();

        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool validPair =
            (c0 == projectToken && c1 == asset()) ||
            (c1 == projectToken && c0 == asset());
        if (!validPair) revert InvalidPoolKey();

        if (poolInitialized && PoolId.unwrap(key.toId()) != PoolId.unwrap(poolKey.toId())) {
            revert InvalidPoolKey();
        }

        IERC20(projectToken).safeTransferFrom(msg.sender, address(this), amount);

        teamSeeds[vaultId] = TeamSeed({
            projectToken: projectToken,
            amount:       amount,
            seededAt:     block.timestamp
        });

        if (!poolInitialized) {
            _initializePool(key, sqrtPriceX96);
        }

        emit TeamSeeded(vaultId, projectToken, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Liquidity hooks — implement the base's virtuals
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Add `assets` USDC as single-sided liquidity at the current tick range.
    function _deployLiquidity(uint256 assets) internal override returns (bytes memory) {
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);
        bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == asset();

        uint128 liquidity = usdcIsToken0
            ? LiquidityAmounts.getLiquidityForAmount0(sqrtLower, sqrtUpper, assets)
            : LiquidityAmounts.getLiquidityForAmount1(sqrtLower, sqrtUpper, assets);

        if (liquidity == 0) return "";

        (BalanceDelta callerDelta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower:      tickLower,
                tickUpper:      tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt:           bytes32(0)
            }),
            ""
        );
        _settleDelta(callerDelta);
        totalLiquidity += liquidity;
        return abi.encode(liquidity);
    }

    /// @dev Remove exact `liquidity` from the current range, returning tokens here.
    function _removeLiquidity(uint128 liquidity) internal override returns (bytes memory) {
        (BalanceDelta callerDelta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower:      tickLower,
                tickUpper:      tickUpper,
                liquidityDelta: -int256(uint256(liquidity)),
                salt:           bytes32(0)
            }),
            ""
        );
        _settleDelta(callerDelta);
        totalLiquidity -= liquidity;
        return "";
    }

    /// @dev Atomically remove all liquidity and re-add all principal at a new range.
    function _rebalanceLiquidity(int24 newTickLower, int24 newTickUpper)
        internal
        override
        returns (bytes memory)
    {
        if (totalLiquidity > 0) {
            (BalanceDelta removeDelta,) = poolManager.modifyLiquidity(
                poolKey,
                ModifyLiquidityParams({
                    tickLower:      tickLower,
                    tickUpper:      tickUpper,
                    liquidityDelta: -int256(uint256(totalLiquidity)),
                    salt:           bytes32(0)
                }),
                ""
            );
            _settleDelta(removeDelta);
            totalLiquidity = 0;
        }

        tickLower = newTickLower;
        tickUpper = newTickUpper;

        if (totalPrincipal > 0) {
            uint160 sqrtLower = TickMath.getSqrtPriceAtTick(newTickLower);
            uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(newTickUpper);
            bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == asset();

            uint128 newLiquidity = usdcIsToken0
                ? LiquidityAmounts.getLiquidityForAmount0(sqrtLower, sqrtUpper, totalPrincipal)
                : LiquidityAmounts.getLiquidityForAmount1(sqrtLower, sqrtUpper, totalPrincipal);

            if (newLiquidity > 0) {
                (BalanceDelta addDelta,) = poolManager.modifyLiquidity(
                    poolKey,
                    ModifyLiquidityParams({
                        tickLower:      newTickLower,
                        tickUpper:      newTickUpper,
                        liquidityDelta: int256(uint256(newLiquidity)),
                        salt:           bytes32(0)
                    }),
                    ""
                );
                _settleDelta(addDelta);
                totalLiquidity = newLiquidity;
            }
        }
        return "";
    }
}
