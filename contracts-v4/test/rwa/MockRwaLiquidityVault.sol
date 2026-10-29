// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Testnet/test-only liquidity actor for the RWA appraisal-hook suite. It supplies the pool key
///      and is the sole liquidity caller, without asserting Treasury-vault behavior.
contract MockRwaLiquidityVault is PoolModifyLiquidityTest {
    PoolKey private _key;
    uint128 public positionLiquidity;

    constructor(IPoolManager manager_, PoolKey memory key_) PoolModifyLiquidityTest(manager_) {
        _key = key_;
        IERC20(Currency.unwrap(key_.currency0)).approve(address(manager_), type(uint256).max);
        IERC20(Currency.unwrap(key_.currency1)).approve(address(manager_), type(uint256).max);
    }

    function poolKey() external view returns (Currency, Currency, uint24, int24, IHooks) {
        PoolKey memory key = _key;
        return (key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks);
    }

    function addPosition(int24 tickLower, int24 tickUpper, uint128 liquidity) external {
        this.modifyLiquidity(
            _key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int128(int256(uint256(liquidity))),
                salt: bytes32(0)
            }),
            ""
        );
        positionLiquidity += liquidity;
    }
}
