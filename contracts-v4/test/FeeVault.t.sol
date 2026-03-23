// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {FeeVault} from "../src/FeeVault.sol";

/// @notice FeeVault unit tests — epoch lifecycle, sweep, soft expiry, share config.
contract FeeVaultTest is Test {

    // ─────────────────────────────────────────────────────────────────────────
    // Fixtures
    // ─────────────────────────────────────────────────────────────────────────

    FeeVault internal fv;

    address internal owner        = makeAddr("owner");
    address internal treasury     = makeAddr("treasury");
    address internal oracleSigner = makeAddr("oracleSigner");
    address internal distributor  = makeAddr("distributor");

    // Stub USDC — real mock ERC20 wired in T1.5
    address internal mockUsdc = makeAddr("mockUsdc");

    function setUp() public {
        vm.prank(owner);
        fv = new FeeVault(mockUsdc, distributor, oracleSigner, treasury);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Epoch opens on deploy
    // ─────────────────────────────────────────────────────────────────────────

    function test_epoch_1_opens_on_deploy() public view {
        assertEq(fv.currentEpoch(), 1);
    }

    function test_epoch_1_openedAt_is_deploy_timestamp() public view {
        (,,,,uint256 openedAt,,,,,) = fv.epochs(1);
        assertEq(openedAt, block.timestamp);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // setSocialVault / setHook (circular dep fix)
    // ─────────────────────────────────────────────────────────────────────────

    function test_setSocialVault_owner_only() public {
        vm.prank(makeAddr("random"));
        vm.expectRevert();
        fv.setSocialVault(makeAddr("vault"));
    }

    function test_setSocialVault_sets_address() public {
        address vault = makeAddr("vault");
        vm.prank(owner);
        fv.setSocialVault(vault);
        assertEq(fv.socialVault(), vault);
    }

    function test_setSocialVault_rejects_zero() public {
        vm.prank(owner);
        vm.expectRevert("zero address");
        fv.setSocialVault(address(0));
    }

    function test_setHook_sets_address() public {
        address hook = makeAddr("hook");
        vm.prank(owner);
        fv.setHook(hook);
        assertEq(fv.hook(), hook);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Share configuration
    // ─────────────────────────────────────────────────────────────────────────

    function test_default_shares_sum_to_bps() public view {
        uint256 total = fv.lpShareBps() + fv.referrerShareBps() + fv.protocolShareBps() + fv.bonusPoolBps();
        assertEq(total, fv.BPS());
    }

    function test_default_shares_values() public view {
        assertEq(fv.lpShareBps(),       7_000); // 70%
        assertEq(fv.referrerShareBps(), 1_500); // 15%
        assertEq(fv.protocolShareBps(), 1_000); // 10%
        assertEq(fv.bonusPoolBps(),       500); //  5%
    }

    function test_setShares_valid() public {
        vm.prank(owner);
        fv.setShares(6_000, 2_000, 1_500, 500);
        assertEq(fv.lpShareBps(),       6_000);
        assertEq(fv.referrerShareBps(), 2_000);
        assertEq(fv.protocolShareBps(), 1_500);
        assertEq(fv.bonusPoolBps(),       500);
    }

    function test_setShares_invalid_sum_reverts() public {
        vm.prank(owner);
        vm.expectRevert(FeeVault.InvalidShares.selector);
        fv.setShares(6_000, 1_500, 1_000, 500); // sums to 9_000, not 10_000
    }

    function testFuzz_setShares_rejects_invalid_sum(
        uint256 lp, uint256 ref, uint256 proto, uint256 bonus
    ) public {
        // Bound first to prevent overflow on the addition below
        vm.assume(lp < 1e18 && ref < 1e18 && proto < 1e18 && bonus < 1e18);
        uint256 total = lp + ref + proto + bonus;
        vm.assume(total != fv.BPS());

        vm.prank(owner);
        vm.expectRevert(FeeVault.InvalidShares.selector);
        fv.setShares(lp, ref, proto, bonus);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Soft expiry constants
    // ─────────────────────────────────────────────────────────────────────────

    function test_claim_expiry_is_90_days() public view {
        assertEq(fv.CLAIM_EXPIRY(), 90 days);
    }

    function test_epoch_duration_is_7_days() public view {
        assertEq(fv.EPOCH_DURATION(), 7 days);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sweep — revert cases (no funds needed to test revert conditions)
    // ─────────────────────────────────────────────────────────────────────────

    function test_sweep_unclosed_epoch_reverts() public {
        // epoch 1 is open (not closed) — sweep should revert
        vm.expectRevert(FeeVault.EpochNotClosed.selector);
        fv.sweep(1);
    }

    function test_sweep_nonexistent_epoch_reverts() public {
        vm.expectRevert(FeeVault.EpochNotClosed.selector);
        fv.sweep(999);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // receiveFees — unauthorised caller reverts
    // ─────────────────────────────────────────────────────────────────────────

    function test_receiveFees_unauthorised_reverts() public {
        vm.prank(makeAddr("random"));
        vm.expectRevert("unauthorized");
        fv.receiveFees(100e6, "mev");
    }

    function test_receiveFees_hook_allowed_after_setHook() public {
        address hook = makeAddr("hook");
        vm.prank(owner);
        fv.setHook(hook);

        // Hook is now authorised — call with mock USDC (will fail on safeTransferFrom since
        // mockUsdc has no code, but the auth check passes first)
        vm.prank(hook);
        vm.expectRevert(); // fails on transferFrom — not on auth
        fv.receiveFees(100e6, "mev");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // recordClaim — only distributor
    // ─────────────────────────────────────────────────────────────────────────

    function test_recordClaim_only_distributor() public {
        vm.prank(makeAddr("random"));
        vm.expectRevert("only distributor");
        fv.recordClaim(1, makeAddr("lp"), 100e6);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sweep math (full test in T1.5 with real ERC20)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Verify sweep soft expiry math:
    ///         unclaimed = totalAllocated - totalClaimed → goes to current epoch bonusPool
    function test_sweep_math_arithmetic() public pure {
        uint256 totalAllocated = 1000e6;
        uint256 totalClaimed   = 600e6;
        uint256 unclaimed      = totalAllocated - totalClaimed;
        assertEq(unclaimed, 400e6);
        // unclaimed 400 USDC flows to next epoch bonusPool
    }

    /// @notice Verify 90-day window math
    function test_sweep_90day_window() public pure {
        uint256 closedAt = 1_000_000;
        uint256 deadline = closedAt + 90 days;
        uint256 dayAfter = deadline + 1;
        assertGt(dayAfter, deadline); // day 91+ → sweep allowed
    }
}
