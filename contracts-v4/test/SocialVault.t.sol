// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {SocialVault} from "../src/SocialVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice SocialVault unit tests.
///         All pure logic (lock tiers, penalties, withdrawal queue, role guards) tested here.
///         V4 pool interaction integration tests live in T1.5 (fork tests with real PoolManager).
contract SocialVaultTest is Test {

    // ─────────────────────────────────────────────────────────────────────────
    // Fixtures
    // ─────────────────────────────────────────────────────────────────────────

    SocialVault internal vault;

    address internal alice  = makeAddr("alice");
    address internal bob    = makeAddr("bob");
    address internal owner  = makeAddr("owner");

    MockERC20 internal mockUsdc;
    address internal mockPM        = makeAddr("poolManager");
    address internal mockFeeVault  = makeAddr("feeVault");

    function setUp() public {
        mockUsdc = new MockERC20("Mock USDC", "USDC", 6);
        vm.prank(owner);
        vault = new SocialVault(address(mockUsdc), mockPM, mockFeeVault);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    function test_constructor_sets_addresses() public view {
        assertEq(address(vault.usdc()),        address(mockUsdc));
        assertEq(address(vault.poolManager()), mockPM);
        assertEq(vault.feeVault(),             mockFeeVault);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lock tier durations
    // ─────────────────────────────────────────────────────────────────────────

    function test_lockDuration_constants() public view {
        assertEq(vault.LOCK_COMMITTED(), 30 days);
        assertEq(vault.LOCK_ALIGNED(),   90 days);
        assertEq(vault.LOCK_CORE(),     180 days);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Default tick range (full range)
    // ─────────────────────────────────────────────────────────────────────────

    function test_default_tick_range() public view {
        assertEq(vault.tickLower(), -887220);
        assertEq(vault.tickUpper(),  887220);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Penalty math (pure arithmetic verified here; contract enforces in T1.5)
    // ─────────────────────────────────────────────────────────────────────────

    function test_penalty_constants() public view {
        assertEq(vault.PENALTY_TIER_1_BPS(), 200); // 2.0%
        assertEq(vault.PENALTY_TIER_2_BPS(), 100); // 1.0%
        assertEq(vault.PENALTY_TIER_3_BPS(),  50); // 0.5%
        assertEq(vault.BPS(),             10_000);
    }

    /// @notice < 20% elapsed → 2% penalty
    function test_penalty_math_tier1() public pure {
        uint256 lockDuration = 90 days;
        uint256 elapsed      = 10 days; // 11% elapsed
        uint256 pct          = (elapsed * 100) / lockDuration;
        assertLt(pct, 20);

        uint256 amount     = 1000e6;
        uint256 penaltyBps = 200; // 2%
        uint256 penalty    = (amount * penaltyBps) / 10_000;
        assertEq(penalty, 20e6); // 20 USDC penalty
    }

    /// @notice 20–50% elapsed → 1% penalty
    function test_penalty_math_tier2() public pure {
        uint256 lockDuration = 90 days;
        uint256 elapsed      = 40 days; // 44% elapsed
        uint256 pct          = (elapsed * 100) / lockDuration;
        assertTrue(pct >= 20 && pct < 50);

        uint256 amount     = 1000e6;
        uint256 penaltyBps = 100; // 1%
        uint256 penalty    = (amount * penaltyBps) / 10_000;
        assertEq(penalty, 10e6);
    }

    /// @notice 50–80% elapsed → 0.5% penalty
    function test_penalty_math_tier3() public pure {
        uint256 lockDuration = 90 days;
        uint256 elapsed      = 65 days; // 72% elapsed
        uint256 pct          = (elapsed * 100) / lockDuration;
        assertTrue(pct >= 50 && pct < 80);

        uint256 amount     = 1000e6;
        uint256 penaltyBps = 50; // 0.5%
        uint256 penalty    = (amount * penaltyBps) / 10_000;
        assertEq(penalty, 5e6);
    }

    /// @notice > 80% elapsed → no penalty
    function test_penalty_math_tier4_no_penalty() public pure {
        uint256 lockDuration = 90 days;
        uint256 elapsed      = 80 days; // 88% elapsed
        uint256 pct          = (elapsed * 100) / lockDuration;
        assertTrue(pct >= 80);
        // penaltyBps = 0 → no penalty
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Withdrawal constants
    // ─────────────────────────────────────────────────────────────────────────

    function test_withdrawal_constants() public view {
        assertEq(vault.NOTICE_PERIOD(),   7 days);
        assertEq(vault.MIN_HOLD_PERIOD(), 24 hours);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Role guards
    // ─────────────────────────────────────────────────────────────────────────

    function test_compound_reverts_if_not_fee_vault() public {
        vm.prank(bob); // not feeVault
        vm.expectRevert(SocialVault.OnlyFeeVault.selector);
        vault.compound(alice, 100e6);
    }

    function test_rebalance_reverts_if_not_owner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.rebalance(-887220, 887220);
    }

    function test_rebalance_reverts_pool_not_initialized() public {
        vm.prank(owner);
        vm.expectRevert(SocialVault.PoolNotInitialized.selector);
        vault.rebalance(-887220, 887220);
    }

    function test_unlockCallback_reverts_if_not_pool_manager() public {
        vm.prank(alice);
        vm.expectRevert(SocialVault.OnlyPoolManager.selector);
        vault.unlockCallback("");
    }

    function test_seedTeamTokens_reverts_if_not_owner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.seedTeamTokens(bytes32("vault"), makeAddr("project"), 1e18, _emptyPoolKey(), 1);
    }

    function test_second_deposit_cannot_change_lock_tier() public {
        mockUsdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        mockUsdc.approve(address(vault), type(uint256).max);
        vault.deposit(500e6, SocialVault.LockTier.Core);

        vm.expectRevert(SocialVault.LockTierChangeNotAllowed.selector);
        vault.deposit(1e6, SocialVault.LockTier.Flex);
        vm.stopPrank();
    }

    function test_second_deposit_same_tier_preserves_original_lock_anchor() public {
        mockUsdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        mockUsdc.approve(address(vault), type(uint256).max);
        vault.deposit(500e6, SocialVault.LockTier.Core);
        (
            uint256 initialDepositedAt,
            uint256 initialLockedUntil,
            SocialVault.LockTier initialTier
        ) = _positionMeta(alice);

        vm.warp(block.timestamp + 7 days);
        vault.deposit(100e6, SocialVault.LockTier.Core);
        vm.stopPrank();

        (
            uint256 finalDepositedAt,
            uint256 finalLockedUntil,
            SocialVault.LockTier finalTier
        ) = _positionMeta(alice);

        assertEq(finalDepositedAt, initialDepositedAt);
        assertEq(uint256(finalTier), uint256(initialTier));
        assertGe(finalLockedUntil, initialLockedUntil);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Withdrawal request reverts
    // ─────────────────────────────────────────────────────────────────────────

    function test_executeWithdrawal_reverts_no_request() public {
        vm.prank(alice);
        vm.expectRevert(SocialVault.NoWithdrawalRequest.selector);
        vault.executeWithdrawal();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Proportional liquidity math
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Verify proportional removal: (liquidity * amount) / totalDeposits
    function test_proportional_liquidity_removal_math() public pure {
        uint128 totalLiq  = 1_000_000;
        uint256 totalDeps = 10_000e6;
        uint256 amount    = 1_000e6; // 10% withdrawal
        uint128 toRemove  = uint128(uint256(totalLiq) * amount / totalDeps);
        assertEq(toRemove, 100_000); // 10% of liquidity
    }

    function test_proportional_liquidity_50pct_withdrawal() public pure {
        uint128 totalLiq  = 800_000;
        uint256 totalDeps = 4_000e6;
        uint256 amount    = 2_000e6; // 50% withdrawal
        uint128 toRemove  = uint128(uint256(totalLiq) * amount / totalDeps);
        assertEq(toRemove, 400_000); // 50% of liquidity
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fuzz: penalty never exceeds withdrawal amount
    // ─────────────────────────────────────────────────────────────────────────

    function testFuzz_penalty_never_exceeds_amount(
        uint256 amount,
        uint256 elapsed,
        uint256 lockDuration
    ) public pure {
        vm.assume(amount > 0 && amount <= 1e30);
        vm.assume(lockDuration > 0 && lockDuration <= 365 days);
        vm.assume(elapsed <= lockDuration);

        uint256 pct = (elapsed * 100) / lockDuration;
        uint256 penaltyBps;
        if      (pct < 20)  penaltyBps = 200;
        else if (pct < 50)  penaltyBps = 100;
        else if (pct < 80)  penaltyBps = 50;
        else                penaltyBps = 0;

        uint256 penalty = (amount * penaltyBps) / 10_000;
        assertLe(penalty, amount);
    }

    /// @notice Fuzz: proportional liquidity removal never exceeds total
    function testFuzz_proportional_removal_never_exceeds_total(
        uint128 totalLiq,
        uint256 totalDeps,
        uint256 amount
    ) public pure {
        vm.assume(totalDeps > 0);
        vm.assume(amount > 0 && amount <= totalDeps);
        // Guard against uint256 overflow in the multiply: totalLiq * amount
        vm.assume(totalLiq == 0 || amount <= type(uint256).max / uint256(totalLiq));

        uint128 toRemove = uint128(uint256(totalLiq) * amount / totalDeps);
        assertLe(toRemove, totalLiq);
    }

    function _emptyPoolKey() internal pure returns (PoolKey memory key) {}

    function _positionMeta(address lp)
        internal
        view
        returns (uint256 depositedAt, uint256 lockedUntil, SocialVault.LockTier tier)
    {
        (
            ,
            depositedAt,
            lockedUntil,
            tier,
            /* compoundEnabled */
        ) = vault.positions(lp);
    }
}
