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
import {LPFeeLibrary}          from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {HookMiner}               from "../../src/lib/HookMiner.sol";
import {MintwareTreasuryVault}   from "../../src/payments/MintwareTreasuryVault.sol";
import {MintwareTreasuryJitHook} from "../../src/payments/MintwareTreasuryJitHook.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @notice GAPS #2 + #3 — hardening the Phase-2 counter (ETH) leg against ADVERSARIAL SPOT. Uses the REAL
///         `MintwareTreasuryVault` + hook + an ERC-20 counter token (6dp, clean 1:1 pool), same as the
///         counter invariant/teeth suites. Two probes:
///           #2 — move spot with a large pre-swap, THEN fire the counter buy, and assert the safety envelope
///                still holds (senior whole at par, junior absorbs, borrow reconciles, no fund-stranding).
///           #3 — a fast spot move that makes the oracle-banded ETH-debt unwind unable to complete PROVES a
///                clean SAFE-REVERT of the whole swap (borrow rolls back, nothing stranded, vault unchanged).
contract MintwareTreasuryJitCounterHardeningTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    PoolManager             internal pm;
    TestSwapRouter          internal swapRouter;
    PoolModifyLiquidityTest internal lpRouter;
    MockERC20               internal usdc;
    MockERC20               internal team;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant ONE = 1e6;

    address internal teamAddr   = makeAddr("team");
    address internal userA      = makeAddr("userA");
    address internal trader     = makeAddr("trader");
    address internal manipulator= makeAddr("manipulator");

    /// @dev Stand up a wired treasury vault + counter-enabled hook over a `baselineLiquidity`-deep 1:1 pool.
    ///      A SHALLOWER baseline lets a bounded swap move spot further (needed to probe the band boundary).
    function _stand(uint256 baselineLiquidity)
        internal
        returns (MintwareTreasuryVault vault, MintwareTreasuryJitHook hook, PoolKey memory key, bool teamIs0)
    {
        pm         = new PoolManager(address(this));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));

        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Wrapped ETH", "ETH", 6);
        teamIs0 = address(team) < address(usdc);
        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));

        PoolKey memory ctorKey = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(address(0))});
        address predictedVault = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        bytes memory args = abi.encode(address(pm), ctorKey, address(usdc), predictedVault, address(this));
        (address hookAddr, bytes32 salt) = HookMiner.find(address(this), uint160(0x20C8), type(MintwareTreasuryJitHook).creationCode, args);
        hook = new MintwareTreasuryJitHook{salt: salt}(address(pm), ctorKey, address(usdc), predictedVault, address(this));
        require(address(hook) == hookAddr, "hook addr");

        key = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(hookAddr)});
        vault = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), address(this), teamAddr);
        require(address(vault) == predictedVault, "vault addr");
        pm.initialize(key, INIT_SQRT_PRICE);

        vault.setJitHook(address(hook));
        vault.setJitCounterEnabled(true);

        team.mint(teamAddr, 1_000_000 * ONE);
        usdc.mint(teamAddr, 50_000 * ONE);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(1_000_000 * ONE, 50_000 * ONE, 365 days);
        vm.stopPrank();

        usdc.mint(userA, 100_000 * ONE);
        vm.startPrank(userA);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(100_000 * ONE, 0, userA);
        vm.stopPrank();

        usdc.mint(address(this), 500_000_000 * ONE);
        team.mint(address(this), 500_000_000 * ONE);
        usdc.approve(address(lpRouter), type(uint256).max);
        team.approve(address(lpRouter), type(uint256).max);
        usdc.approve(address(swapRouter), type(uint256).max);
        team.approve(address(swapRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(key, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: int256(baselineLiquidity), salt: bytes32(0)}), "");
    }

    /// buy ETH = sell USDC (usdc in). zeroForOne is true iff USDC is currency0 (team is NOT currency0).
    function _buyEth(bool teamIs0, PoolKey memory key, address who, uint256 amtIn) internal {
        usdc.mint(who, amtIn);
        vm.startPrank(who);
        usdc.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, !teamIs0, amtIn);
        vm.stopPrank();
    }

    /// buy ETH from `address(this)` (already funded + approved in `_stand`) via a low-level call so a
    /// swap revert is observable rather than aborting the test.
    function _tryBuyEthSelf(bool teamIs0, PoolKey memory key, uint256 amtIn) internal returns (bool ok) {
        (ok, ) = address(swapRouter).call(abi.encodeWithSelector(TestSwapRouter.swap.selector, key, !teamIs0, amtIn));
    }

    function _curTick(PoolKey memory key) internal view returns (int24 t) { (, t,,) = IPoolManager(address(pm)).getSlot0(key.toId()); }

    // A 1:1, 6dp pool of ~2,000,000 units of depth: a bounded pre-swap moves spot far enough to probe BOTH
    // the within-band (gap #2) and beyond-band (gap #3) regimes. `WHOLE_TOL` mirrors the invariant suite's
    // senior "whole-or-up" rounding slack.
    uint256 internal constant BASE_LIQ  = 2_000_000 * ONE;
    uint256 internal constant COUNTER   = 2_000 * ONE;
    uint256 internal constant WHOLE_TOL = 1_000; // 0.001 USDC

    /// @dev Warm the oracle (a prior-block swap), then move spot by `preMove` with the counter leg DISABLED,
    ///      so the pre-move is a plain price-manipulation swap that does NOT fire/serialize the counter
    ///      borrow. Re-enable the counter leg for the actual round, which sizes `_usdcToEthAtSpot` off the
    ///      MANIPULATED spot — the adversarial condition under test in gaps #2/#3.
    function _standWarmAndManipulate(uint256 preMove)
        internal
        returns (MintwareTreasuryVault vault, MintwareTreasuryJitHook hook, PoolKey memory key, bool teamIs0)
    {
        (vault, hook, key, teamIs0) = _stand(BASE_LIQ);
        _buyEth(teamIs0, key, manipulator, 500 * ONE);
        hook.sweepJit();
        vm.roll(block.number + 1);
        vault.setJitCounterEnabled(false);
        _buyEth(teamIs0, key, manipulator, preMove);
        vault.setJitCounterEnabled(true);
    }

    // ── GAP #2 — adversarial spot WITHIN the oracle band → the counter round completes SAFELY ───────────
    /// A large pre-swap dislocates spot to ~tick -400 (≈4%, inside the truncated-oracle band). The counter
    /// leg then sizes its ETH provision (`_usdcToEthAtSpot`) off that manipulated spot. The safety envelope
    /// must still hold: the leg fires, the ETH flash debt unwinds, the borrow reconciles to zero, the senior
    /// is whole-or-up (par), the junior — never the senior — absorbs any round-trip cost, and nothing strands.
    function test_gap2_adversarialSpotWithinBand_completesSafely() public {
        (MintwareTreasuryVault vault, MintwareTreasuryJitHook hook, PoolKey memory key, bool teamIs0) =
            _standWarmAndManipulate(40_000 * ONE);
        assertLt(_curTick(key), int24(-200), "pre-move did not dislocate spot as expected");

        uint256 navBefore = vault.totalSeniorAssets();
        uint256 bufBefore = vault.juniorUsdcBuffer();

        assertTrue(_tryBuyEthSelf(teamIs0, key, COUNTER), "counter swap should complete within the band");
        assertGt(vault.jitBorrowed(), 0, "counter leg did not fire at the manipulated spot");

        hook.sweepJit();

        assertEq(vault.jitBorrowed(), 0, "borrow not reconciled after sweep");
        assertGe(vault.totalSeniorAssets() + WHOLE_TOL, navBefore, "senior not whole after adversarial-spot round");
        assertLe(vault.juniorUsdcBuffer(), bufBefore, "junior buffer grew from a JIT round (accounting error)");
        assertEq(team.balanceOf(address(hook)), 0, "ETH counter-asset stranded in the hook");
        assertEq(usdc.balanceOf(address(hook)), 0, "USDC stranded in the hook after sweep");
    }

    // ── GAP #3 — spot BEYOND the band blocks the ETH-debt unwind → the whole swap SAFE-REVERTS ──────────
    /// A much larger pre-swap dislocates spot to ~tick -2792 (≈24%, WELL beyond the oracle band). When the
    /// counter round tries to unwind its ETH flash debt, `_zeroCounterEthDebt`'s exact-output repay is
    /// oracle-BANDED (`_swapLimit`) and cannot buy the full owed ETH → a nonzero ETH delta remains →
    /// `_closeCounter`'s `require(currencyDelta == 0, "eth debt")` fires → the ENTIRE trader swap reverts.
    /// This is the intended, documented behavior: a band-block is a clean SAFE-REVERT (a LIVENESS cost), NOT
    /// a safety hole. The borrow (taken in the same tx's beforeSwap) rolls back, and NOTHING is stranded or
    /// mis-accounted: `jitBorrowed`, senior NAV, and the junior buffer are all exactly as before the swap.
    function test_gap3_bandBlockedUnwind_safeRevertsTheSwap() public {
        (MintwareTreasuryVault vault, MintwareTreasuryJitHook hook, PoolKey memory key, bool teamIs0) =
            _standWarmAndManipulate(300_000 * ONE);
        assertLt(_curTick(key), int24(-1500), "pre-move did not push spot beyond the band");

        uint256 navBefore = vault.totalSeniorAssets();
        uint256 bufBefore = vault.juniorUsdcBuffer();
        assertEq(vault.jitBorrowed(), 0, "precondition: no borrow outstanding before the counter swap");

        // The band-clamped ETH-debt repay can't complete → the whole swap reverts ("eth debt").
        assertFalse(_tryBuyEthSelf(teamIs0, key, COUNTER), "beyond-band counter swap must safe-revert, not settle unsafely");

        // Clean rollback: borrow undone, vault state byte-for-byte unchanged, nothing stranded.
        assertEq(vault.jitBorrowed(), 0, "borrow did not roll back after the safe-revert");
        assertEq(vault.totalSeniorAssets(), navBefore, "senior NAV changed despite the swap reverting");
        assertEq(vault.juniorUsdcBuffer(), bufBefore, "junior buffer changed despite the swap reverting");
        assertEq(team.balanceOf(address(hook)), 0, "ETH stranded after the safe-revert");
        assertEq(usdc.balanceOf(address(hook)), 0, "USDC stranded after the safe-revert");
    }

    /// CONTROL for gap #3: the SAME counter swap, with only a MODERATE (within-band) manipulation, COMPLETES.
    /// This proves the gap-#3 revert is caused specifically by the beyond-band spot (the band-blocked unwind),
    /// not by the counter swap being intrinsically infeasible.
    function test_gap3_control_withinBandSameSwapCompletes() public {
        (MintwareTreasuryVault vault, MintwareTreasuryJitHook hook, PoolKey memory key, bool teamIs0) =
            _standWarmAndManipulate(40_000 * ONE);
        assertTrue(_tryBuyEthSelf(teamIs0, key, COUNTER), "within-band control swap should complete");
        assertGt(vault.jitBorrowed(), 0, "control: counter leg should have fired");
        hook.sweepJit();
        assertEq(vault.jitBorrowed(), 0, "control: borrow should reconcile");
    }
}
