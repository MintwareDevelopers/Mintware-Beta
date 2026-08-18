// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareMultiVenueYieldAdapter} from "../src/vaults/MintwareMultiVenueYieldAdapter.sol";
import {IYieldAdapter} from "../src/vaults/IYieldAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockVenueAdapter} from "./mocks/MockVenueAdapter.sol";

/// @notice The multi-venue baseline-yield router: weighted allocation across child adapters, best-effort
///         never-revert withdraw, rebalance, and the access gates. The test contract acts as the vault.
contract MintwareMultiVenueYieldAdapterTest is Test {
    MockERC20 internal usdc;
    MockVenueAdapter internal aave; // stand-in child venues
    MockVenueAdapter internal morpho;
    MockVenueAdapter internal euler;
    MintwareMultiVenueYieldAdapter internal router;

    address internal owner = makeAddr("owner");

    function setUp() public {
        usdc   = new MockERC20("USD Coin", "USDC", 6);
        aave   = new MockVenueAdapter(IERC20(address(usdc)));
        morpho = new MockVenueAdapter(IERC20(address(usdc)));
        euler  = new MockVenueAdapter(IERC20(address(usdc)));

        // vault = this test contract (sole authorized caller).
        router = new MintwareMultiVenueYieldAdapter(address(usdc), address(this), owner);

        IYieldAdapter[] memory v = new IYieldAdapter[](3);
        v[0] = aave; v[1] = morpho; v[2] = euler;
        uint16[] memory w = new uint16[](3);
        w[0] = 5000; w[1] = 3000; w[2] = 2000; // 50 / 30 / 20
        vm.prank(owner);
        router.setVenues(v, w);

        usdc.mint(address(this), 1_000_000e6);
        usdc.approve(address(router), type(uint256).max);
    }

    function _deposit(uint256 a) internal { router.deposit(a); }

    // ── allocation ────────────────────────────────────────────────────────────────

    function test_deposit_splits_by_weight() public {
        _deposit(100_000e6);
        assertEq(aave.totalAssets(), 50_000e6, "aave 50%");
        assertEq(morpho.totalAssets(), 30_000e6, "morpho 30%");
        assertEq(euler.totalAssets(), 20_000e6, "euler 20%");
        assertEq(router.totalAssets(), 100_000e6, "router totalAssets = sum");
        assertEq(usdc.balanceOf(address(router)), 0, "nothing left idle at 100% weight");
    }

    function test_partial_weights_leave_idle_buffer() public {
        IYieldAdapter[] memory v = new IYieldAdapter[](2);
        v[0] = aave; v[1] = morpho;
        uint16[] memory w = new uint16[](2);
        w[0] = 6000; w[1] = 3000; // 90% total -> 10% idle buffer
        vm.prank(owner);
        router.setVenues(v, w);

        _deposit(100_000e6);
        assertEq(aave.totalAssets(), 60_000e6);
        assertEq(morpho.totalAssets(), 30_000e6);
        assertEq(usdc.balanceOf(address(router)), 10_000e6, "10% held idle");
        assertEq(router.totalAssets(), 100_000e6, "idle still counted");
    }

    function test_supply_cap_overflow_stays_idle() public {
        aave.setSupplyCap(10_000e6); // aave can only take 10k of its 50k share
        _deposit(100_000e6);
        assertEq(aave.totalAssets(), 10_000e6, "capped at 10k");
        assertEq(morpho.totalAssets(), 30_000e6);
        assertEq(euler.totalAssets(), 20_000e6);
        assertEq(usdc.balanceOf(address(router)), 40_000e6, "aave's un-deployable 40k held idle");
        assertEq(router.totalAssets(), 100_000e6, "no funds lost");
    }

    function test_reverting_venue_is_swallowed() public {
        morpho.setRevertDeposit(true); // morpho.deposit() reverts
        _deposit(100_000e6);
        assertEq(aave.totalAssets(), 50_000e6);
        assertEq(morpho.totalAssets(), 0, "reverting venue got nothing");
        assertEq(euler.totalAssets(), 20_000e6);
        assertEq(usdc.balanceOf(address(router)), 30_000e6, "morpho's share held idle, deposit didn't brick");
        assertEq(router.totalAssets(), 100_000e6);
    }

    // ── withdraw (best-effort, never reverts) ───────────────────────────────────────

    function test_withdraw_pulls_across_venues_to_vault() public {
        _deposit(100_000e6);
        uint256 balBefore = usdc.balanceOf(address(this));
        uint256 got = router.withdraw(70_000e6);
        assertEq(got, 70_000e6, "withdrew requested");
        assertEq(usdc.balanceOf(address(this)) - balBefore, 70_000e6, "reached the vault");
        assertEq(router.totalAssets(), 30_000e6, "remainder still supplied");
    }

    function test_withdraw_best_effort_when_a_venue_is_paused() public {
        _deposit(100_000e6); // aave 50k, morpho 30k, euler 20k
        aave.setPaused(true); // 50k stuck
        uint256 got = router.withdraw(100_000e6); // must NOT revert; can only get morpho+euler = 50k
        assertEq(got, 50_000e6, "served what was available, no revert");
        assertEq(router.totalAssets(), 50_000e6, "the paused venue still holds its 50k (present, not lost)");
        assertEq(router.maxWithdrawable(), 0, "but none is withdrawable while that venue is paused");
        aave.setPaused(false);
        assertEq(router.maxWithdrawable(), 50_000e6, "unpausing frees it");
    }

    function test_withdraw_serves_idle_first() public {
        // 90% weighted -> 10k idle; withdraw 5k should come straight from idle without touching venues.
        IYieldAdapter[] memory v = new IYieldAdapter[](1);
        v[0] = aave;
        uint16[] memory w = new uint16[](1);
        w[0] = 9000;
        vm.prank(owner);
        router.setVenues(v, w);
        _deposit(100_000e6); // aave 90k, idle 10k
        uint256 got = router.withdraw(5_000e6);
        assertEq(got, 5_000e6);
        assertEq(aave.totalAssets(), 90_000e6, "venue untouched - idle covered it");
    }

    function test_yield_accrues_into_totalAssets() public {
        _deposit(100_000e6);
        usdc.mint(address(this), 5_000e6);
        usdc.approve(address(morpho), type(uint256).max);
        morpho.simulateYield(5_000e6); // morpho earns 5k
        assertEq(router.totalAssets(), 105_000e6, "yield surfaces through the router");
    }

    // ── rebalance ───────────────────────────────────────────────────────────────

    function test_rebalance_realigns_to_new_weights() public {
        _deposit(100_000e6); // 50/30/20
        // Re-weight to 20/20/60 and rebalance.
        IYieldAdapter[] memory v = new IYieldAdapter[](3);
        v[0] = aave; v[1] = morpho; v[2] = euler;
        uint16[] memory w = new uint16[](3);
        w[0] = 2000; w[1] = 2000; w[2] = 6000;
        vm.prank(owner);
        router.setVenues(v, w);
        vm.prank(owner);
        router.rebalance();
        assertEq(aave.totalAssets(), 20_000e6, "aave -> 20%");
        assertEq(morpho.totalAssets(), 20_000e6, "morpho -> 20%");
        assertEq(euler.totalAssets(), 60_000e6, "euler -> 60%");
        assertEq(router.totalAssets(), 100_000e6, "conserved");
    }

    // ── access + config guards ────────────────────────────────────────────────────

    function test_only_vault_can_supply_and_withdraw() public {
        vm.startPrank(makeAddr("stranger"));
        vm.expectRevert(MintwareMultiVenueYieldAdapter.OnlyVault.selector);
        router.deposit(1e6);
        vm.expectRevert(MintwareMultiVenueYieldAdapter.OnlyVault.selector);
        router.withdraw(1e6);
        vm.stopPrank();
    }

    function test_setVenues_rejects_weight_overflow() public {
        IYieldAdapter[] memory v = new IYieldAdapter[](2);
        v[0] = aave; v[1] = morpho;
        uint16[] memory w = new uint16[](2);
        w[0] = 6000; w[1] = 5000; // 110%
        vm.prank(owner);
        vm.expectRevert(MintwareMultiVenueYieldAdapter.WeightOverflow.selector);
        router.setVenues(v, w);
    }

    function test_setVault_is_one_time() public {
        MintwareMultiVenueYieldAdapter r =
            new MintwareMultiVenueYieldAdapter(address(usdc), address(0), owner);
        vm.prank(owner);
        r.setVault(address(this));
        vm.prank(owner);
        vm.expectRevert(MintwareMultiVenueYieldAdapter.VaultAlreadySet.selector);
        r.setVault(makeAddr("attacker"));
    }
}
