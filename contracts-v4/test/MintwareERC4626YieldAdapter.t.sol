// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareERC4626YieldAdapter} from "../src/vaults/MintwareERC4626YieldAdapter.sol";
import {MockERC20}   from "./mocks/MockERC20.sol";
import {MockERC4626} from "./mocks/MockERC4626.sol";

/// @notice Proof for the Arc yield adapter (`MintwareERC4626YieldAdapter`): supply/withdraw round-trip,
///         yield accrual into `totalAssets`, best-effort withdraw when the source stalls, the per-block
///         drain cap, and the vault-only / one-time-vault / asset-mismatch guards. The test contract acts
///         as the "vault" (the sole authorized caller).
contract MintwareERC4626YieldAdapterTest is Test {
    MockERC20   internal usdc;
    MockERC4626 internal source;
    MintwareERC4626YieldAdapter internal adapter;

    address internal owner = makeAddr("owner");

    function setUp() public {
        usdc   = new MockERC20("USD Coin", "USDC", 6);
        source = new MockERC4626(IERC20(address(usdc)));
        // vault = this test contract (the single authorized caller).
        adapter = new MintwareERC4626YieldAdapter(address(usdc), address(source), address(this), owner);

        usdc.mint(address(this), 1_000_000e6);
        usdc.approve(address(adapter), type(uint256).max);
    }

    function _deposit(uint256 amount) internal {
        adapter.deposit(amount);
    }

    // ── core round-trip ─────────────────────────────────────────────────────────

    function test_deposit_supplies_and_tracks_assets() public {
        _deposit(100_000e6);
        assertApproxEqAbs(adapter.totalAssets(), 100_000e6, 1, "totalAssets ~= deposited");
        assertEq(usdc.balanceOf(address(adapter)), 0, "no idle underlying left in adapter");
        assertGt(source.balanceOf(address(adapter)), 0, "adapter holds 4626 shares");
    }

    function test_withdraw_returns_assets_to_vault() public {
        _deposit(100_000e6);
        uint256 balBefore = usdc.balanceOf(address(this));
        uint256 got = adapter.withdraw(40_000e6);
        assertEq(got, 40_000e6, "withdrew exactly requested");
        assertEq(usdc.balanceOf(address(this)) - balBefore, 40_000e6, "assets reached the vault");
        assertApproxEqAbs(adapter.totalAssets(), 60_000e6, 2, "remainder still supplied");
    }

    function test_yield_accrues_into_totalAssets() public {
        _deposit(100_000e6);
        // Donate 10k underlying to the source → assets-per-share rises → our totalAssets grows.
        usdc.approve(address(source), type(uint256).max);
        source.simulateYield(10_000e6);
        assertApproxEqRel(adapter.totalAssets(), 110_000e6, 0.001e18, "yield accrued into totalAssets");
    }

    // ── best-effort / safety ──────────────────────────────────────────────────

    function test_withdraw_is_best_effort_when_source_stalls() public {
        _deposit(100_000e6);
        source.setFailWithdrawals(true);
        uint256 balBefore = usdc.balanceOf(address(this));
        uint256 got = adapter.withdraw(40_000e6); // must NOT revert
        assertEq(got, 0, "stalled source returns 0, no revert");
        assertEq(usdc.balanceOf(address(this)), balBefore, "vault balance unchanged");
    }

    function test_per_block_withdraw_cap_clamps() public {
        _deposit(100_000e6);
        vm.prank(owner);
        adapter.setPerBlockWithdrawCap(25_000e6);
        assertEq(adapter.maxWithdrawable(), 25_000e6, "capped");
        uint256 got = adapter.withdraw(100_000e6);
        assertEq(got, 25_000e6, "clamped to the per-block cap");
        // A second withdraw in the SAME block gets nothing more.
        assertEq(adapter.withdraw(100_000e6), 0, "cap exhausted this block");
        // Next block resets the budget.
        vm.roll(block.number + 1);
        assertEq(adapter.withdraw(10_000e6), 10_000e6, "budget resets next block");
    }

    function test_maxSuppliable_reflects_source() public view {
        assertGt(adapter.maxSuppliable(), 0, "source accepts deposits");
    }

    // ── access control + wiring guards ────────────────────────────────────────

    function test_only_vault_can_supply_and_withdraw() public {
        vm.startPrank(makeAddr("stranger"));
        vm.expectRevert(MintwareERC4626YieldAdapter.OnlyVault.selector);
        adapter.deposit(1e6);
        vm.expectRevert(MintwareERC4626YieldAdapter.OnlyVault.selector);
        adapter.withdraw(1e6);
        vm.stopPrank();
    }

    function test_setVault_is_one_time() public {
        // A fresh adapter with no vault, so setVault can run once.
        MintwareERC4626YieldAdapter a =
            new MintwareERC4626YieldAdapter(address(usdc), address(source), address(0), owner);
        vm.prank(owner);
        a.setVault(address(this));
        vm.prank(owner);
        vm.expectRevert(MintwareERC4626YieldAdapter.VaultAlreadySet.selector);
        a.setVault(makeAddr("attacker"));
    }

    function test_constructor_rejects_asset_mismatch() public {
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        MockERC4626 wrongSource = new MockERC4626(IERC20(address(other))); // underlying != usdc
        vm.expectRevert(MintwareERC4626YieldAdapter.AssetMismatch.selector);
        new MintwareERC4626YieldAdapter(address(usdc), address(wrongSource), address(this), owner);
    }
}
