// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}           from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {MintwareV4LiquidityModule} from "../../src/payments/MintwareV4LiquidityModule.sol";
import {ILiquidityModule}          from "../../src/payments/ILiquidityModule.sol";

import {MockERC20}      from "../mocks/MockERC20.sol";
import {TestSwapRouter} from "../helpers/TestSwapRouter.sol";

/// @notice Proves the REAL Uniswap-V4 `ILiquidityModule` against the genuine `PoolManager` (deployed in-
///         test — the actual vendored v4-core singleton + math, no mock pool). The test contract plays the
///         VAULT (the module's sole caller). It seeds baseline external liquidity so the module's internal
///         team→USDC seniority swap always has depth, then exercises deploy / recoverableUSDC / recover /
///         collectFees + the seniority + IL behavior the treasury vault's solvency invariant relies on.
///
/// @dev    Both tokens are 18dp and the pool inits at 1:1 (tick 0), so raw amounts equal value — the
///         module is decimal-agnostic (it reads the pool price), and production encodes the 6dp/18dp
///         offset in the pool's init price. Here 1:1 keeps the assertions legible.
contract MintwareV4LiquidityModuleTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    PoolManager             internal pm;
    TestSwapRouter          internal swapRouter;
    PoolModifyLiquidityTest internal lpRouter;
    MintwareV4LiquidityModule internal module;

    MockERC20 internal usdc; // senior asset (labelled USDC; 18dp here for 1:1 clarity)
    MockERC20 internal team; // junior asset
    PoolKey   internal key;

    address internal trader  = makeAddr("trader");
    address internal stranger = makeAddr("stranger");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;

    function setUp() public {
        pm         = new PoolManager(address(this));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));

        usdc = new MockERC20("USD Coin", "USDC", 18);
        team = new MockERC20("Team Token", "TEAM", 18);
        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        pm.initialize(key, INIT_SQRT_PRICE);

        module = new MintwareV4LiquidityModule(address(pm), key, address(usdc), address(this), address(this));

        // Fund the vault (this), the trader, and this contract for the baseline LP seed.
        usdc.mint(address(this), 12_000_000e18);
        team.mint(address(this), 12_000_000e18);
        usdc.mint(trader, 2_000_000e18);
        team.mint(trader, 2_000_000e18);

        // Baseline external liquidity so the module's team→USDC swaps have realistic (deep-pool) depth —
        // in production the pool has other LPs. Full range, ~8,000,000 each side.
        usdc.approve(address(lpRouter), type(uint256).max);
        team.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 8_000_000e18, salt: bytes32(0)}),
            ""
        );
    }

    // ── helpers ────────────────────────────────────────────────────────────

    function _deploy(uint256 u, uint256 t) internal returns (uint256 usdcUsed, uint256 teamUsed) {
        usdc.approve(address(module), u);
        team.approve(address(module), t);
        (usdcUsed, teamUsed) = module.deploy(u, t);
    }

    function _genFees() internal {
        vm.startPrank(trader);
        usdc.approve(address(swapRouter), type(uint256).max);
        team.approve(address(swapRouter), type(uint256).max);
        bool usdcIs0 = address(usdc) < address(team);
        // swap both directions so the module's full-range position accrues fees in both tokens.
        swapRouter.swap(key, usdcIs0, 40_000e18);
        swapRouter.swap(key, !usdcIs0, 38_000e18);
        vm.stopPrank();
    }

    // ── tests ──────────────────────────────────────────────────────────────

    function test_DeployAddsBalancedJuniorCoveredLiquidity() public {
        (uint256 usdcUsed, uint256 teamUsed) = _deploy(100_000e18, 100_000e18);

        assertGt(usdcUsed, 0, "usdc used");
        assertGt(teamUsed, 0, "team used");
        assertGt(module.positionLiquidity(), 0, "liquidity added");
        // At 1:1 full range the two legs are balanced.
        assertApproxEqRel(usdcUsed, teamUsed, 0.01e18, "balanced legs");
        // Recoverable value ~= both legs at par (2x the USDC leg).
        assertApproxEqRel(module.recoverableUSDC(), usdcUsed + teamUsed, 0.005e18, "MTM = legs");
    }

    function test_RecoverableTracksBothLegs() public {
        (uint256 usdcUsed, uint256 teamUsed) = _deploy(250_000e18, 250_000e18);
        // The whole position marks to USDC = usdc leg + team leg valued at price 1.
        assertApproxEqRel(module.recoverableUSDC(), usdcUsed + teamUsed, 0.005e18, "recoverable");
    }

    function test_RecoverReturnsUSDC_AndSpendsJunior() public {
        _deploy(200_000e18, 200_000e18);
        uint256 rec0 = module.recoverableUSDC();
        assertApproxEqRel(rec0, 400_000e18, 0.01e18, "recoverable ~400k");

        uint256 vaultUsdcBefore = usdc.balanceOf(address(this));
        uint128 liqBefore = module.positionLiquidity();

        // Recover $100k — a quarter of the position value.
        (uint256 usdcReturned, uint256 teamReturned) = module.recover(100_000e18);

        // Delivered ~= requested (the team leg is SOLD to USDC — the junior bears the pool fee/slippage,
        // so it lands just under, never over, the ask — exactly the seniority contract).
        assertLe(usdcReturned, 100_000e18, "never overpays the ask");
        assertApproxEqRel(usdcReturned, 100_000e18, 0.015e18, "returned ~ wanted (deep pool)");
        assertLt(module.positionLiquidity(), liqBefore, "liquidity removed");
        // Junior spent (sold), not handed back — only dust remains.
        assertLt(teamReturned, 1e18, "junior sold, not returned");
        assertEq(usdc.balanceOf(address(this)) - vaultUsdcBefore, usdcReturned, "vault got the USDC");
        // Module never retains balances between ops.
        assertEq(usdc.balanceOf(address(module)), 0, "no usdc dust");
        assertEq(team.balanceOf(address(module)), 0, "no team dust");
    }

    function test_RecoverCapsAtRecoverable() public {
        _deploy(50_000e18, 50_000e18);
        uint256 rec = module.recoverableUSDC();
        // Asking for far more than exists returns at most ~the whole recoverable value.
        (uint256 usdcReturned,) = module.recover(10_000_000e18);
        assertLe(usdcReturned, rec + 1, "cannot exceed recoverable");
        assertGt(usdcReturned, (rec * 90) / 100, "returns ~all of it");
    }

    function test_CollectFeesDeliversUsdcOnly() public {
        _deploy(300_000e18, 300_000e18);
        _genFees();

        uint256 vaultUsdcBefore = usdc.balanceOf(address(this));
        uint256 usdcFees = module.collectFees();

        assertGt(usdcFees, 0, "fees collected");
        assertEq(usdc.balanceOf(address(this)) - vaultUsdcBefore, usdcFees, "USDC delivered to vault");
        // team-side fees were swapped to USDC — module holds nothing.
        assertEq(team.balanceOf(address(module)), 0, "team fees swapped out");
        assertEq(usdc.balanceOf(address(module)), 0, "no usdc dust");
    }

    function test_AdversePriceMoveShrinksRecoverable_IL() public {
        _deploy(200_000e18, 200_000e18);
        uint256 recBefore = module.recoverableUSDC();

        // A large team→USDC dump pushes the team price DOWN → the position rotates into the cheaper team
        // token; marked to the new price, recoverable falls below par. That IL is what the junior covers.
        vm.startPrank(trader);
        team.approve(address(swapRouter), type(uint256).max);
        bool teamIs0 = address(team) < address(usdc);
        swapRouter.swap(key, teamIs0, 300_000e18); // sell team
        vm.stopPrank();

        uint256 recAfter = module.recoverableUSDC();
        assertLt(recAfter, recBefore, "adverse move realizes IL");
        assertGt(recAfter, 0, "position still has value");
    }

    function test_OnlyVaultGuards() public {
        vm.startPrank(stranger);
        vm.expectRevert(MintwareV4LiquidityModule.OnlyVault.selector);
        module.deploy(1, 1);
        vm.expectRevert(MintwareV4LiquidityModule.OnlyVault.selector);
        module.recover(1);
        vm.expectRevert(MintwareV4LiquidityModule.OnlyVault.selector);
        module.collectFees();
        vm.stopPrank();
    }

    function test_OnlyPoolManagerCallback() public {
        vm.expectRevert(MintwareV4LiquidityModule.OnlyPoolManager.selector);
        module.unlockCallback(abi.encode(uint8(0), uint256(0), uint256(0)));
    }

    function test_ConstructorRejectsUsdcNotInPool() public {
        MockERC20 outsider = new MockERC20("Outsider", "OUT", 18);
        vm.expectRevert(MintwareV4LiquidityModule.UsdcNotInPool.selector);
        new MintwareV4LiquidityModule(address(pm), key, address(outsider), address(this), address(this));
    }
}
