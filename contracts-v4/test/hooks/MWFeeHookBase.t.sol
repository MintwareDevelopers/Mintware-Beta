// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}          from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}         from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}               from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}              from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}             from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary}         from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LPFeeLibrary}         from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {HookMiner} from "../../src/lib/HookMiner.sol";
import {MWFeeHook} from "../../src/hooks/MWFeeHook.sol";

import {MockERC20}      from "../mocks/MockERC20.sol";
import {TestSwapRouter} from "../helpers/TestSwapRouter.sol";

/// @notice Shared harness: a real V4 PoolManager, a DYNAMIC-FEE pool that installs the mined
///         `MWFeeHook`, permissionless liquidity (the hook has NO LP gate), and a swap router.
abstract contract MWFeeHookBase is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    address internal deployer = address(this);
    address internal lp       = makeAddr("lp");
    address internal trader   = makeAddr("trader");

    PoolManager             internal pm;
    TestSwapRouter          internal swapRouter;
    PoolModifyLiquidityTest internal lpRouter;
    MWFeeHook               internal hook;

    MockERC20 internal t0;
    MockERC20 internal t1;

    PoolKey internal poolKey;
    PoolId  internal poolId;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0

    // Default immutable fee config used by the harness (mirrors DeployFeeHook defaults, but with a
    // steeper slope so volatility is visible at test sizes and the LVR lever ON for directional tests).
    uint24  internal constant BASE_FEE   = 3000;    // 0.30%
    uint24  internal constant MAX_FEE    = 100000;  // 10%
    uint256 internal constant SLOPE      = 30;      // pips/tick
    uint256 internal constant QUAD       = 0;
    uint24  internal constant FEE_STEP   = 0;       // rate-limit OFF by default (per-test override rebuilds)
    uint256 internal constant LVR_SLOPE  = 3000;    // LVR lever ON
    uint256 internal constant LVR_QUAD   = 0;
    bool    internal constant GUARD      = true;
    int24   internal constant MAX_MOVE   = 60;
    int24   internal constant MAX_DEV    = 6000;
    uint32  internal constant CATCHUP    = 10;

    function _deployHook(
        uint24  baseFee,
        uint24  maxFee,
        uint256 slope,
        uint256 quad,
        uint24  feeStep,
        uint256 lvrSlope,
        uint256 lvrQuad,
        bool    guard,
        int24   maxMove,
        int24   maxDev,
        uint32  catchup
    ) internal returns (MWFeeHook) {
        bytes memory args = abi.encode(
            IPoolManager(address(pm)), baseFee, maxFee, slope, quad, feeStep,
            lvrSlope, lvrQuad, guard, maxMove, maxDev, catchup
        );
        (address expected, bytes32 salt) =
            HookMiner.find(deployer, uint160(0xC0), type(MWFeeHook).creationCode, args);
        MWFeeHook h = new MWFeeHook{salt: salt}(
            IPoolManager(address(pm)), baseFee, maxFee, slope, quad, feeStep,
            lvrSlope, lvrQuad, guard, maxMove, maxDev, catchup
        );
        require(address(h) == expected, "hook addr mismatch");
        return h;
    }

    function setUp() public virtual {
        pm         = new PoolManager(deployer);
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));

        MockERC20 a = new MockERC20("USD Coin", "USDC", 18);
        MockERC20 b = new MockERC20("Project Token", "PROJ", 18);
        (Currency c0, Currency c1) = address(a) < address(b)
            ? (Currency.wrap(address(a)), Currency.wrap(address(b)))
            : (Currency.wrap(address(b)), Currency.wrap(address(a)));
        t0 = MockERC20(Currency.unwrap(c0));
        t1 = MockERC20(Currency.unwrap(c1));

        hook = _deployHook(BASE_FEE, MAX_FEE, SLOPE, QUAD, FEE_STEP, LVR_SLOPE, LVR_QUAD, GUARD, MAX_MOVE, MAX_DEV, CATCHUP);

        // DYNAMIC-FEE pool (required for the override to apply) installing the mined hook.
        poolKey = PoolKey({
            currency0:   c0,
            currency1:   c1,
            fee:         LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks:       IHooks(address(hook))
        });
        poolId = poolKey.toId();
        pm.initialize(poolKey, INIT_SQRT_PRICE);

        // Permissionless LP: anyone can add liquidity (no vault gate on this hook).
        t0.mint(lp, 1e30); t1.mint(lp, 1e30);
        vm.startPrank(lp);
        t0.approve(address(lpRouter), type(uint256).max);
        t1.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: -12000, tickUpper: 12000, liquidityDelta: int256(50_000_000e18), salt: bytes32(0)}),
            ""
        );
        vm.stopPrank();

        t0.mint(trader, 1e30); t1.mint(trader, 1e30);
        vm.roll(1000);
    }

    function _swap(bool zeroForOne, uint256 amtIn) internal {
        vm.startPrank(trader, trader);
        (zeroForOne ? t0 : t1).approve(address(swapRouter), amtIn);
        swapRouter.swap(poolKey, zeroForOne, amtIn);
        vm.stopPrank();
    }

    function _tick() internal view returns (int24 t) {
        (, t,,) = IPoolManager(address(pm)).getSlot0(poolId);
    }

    function _tickOf(PoolId id) internal view returns (int24 t) {
        (, t,,) = IPoolManager(address(pm)).getSlot0(id);
    }
}
