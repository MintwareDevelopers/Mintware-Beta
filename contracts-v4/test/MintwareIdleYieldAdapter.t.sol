// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareIdleYieldAdapter} from "../src/vaults/MintwareIdleYieldAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Proof for the zero-yield fallback adapter: supply/withdraw round-trip (always exact -- nothing is
///         ever deployed elsewhere), the deposit cap (the on-chain bound for "small amount, no external audit
///         yet"), donation neutrality, and the vault-only / one-time-vault / ownership guards mirrored from
///         `MintwareERC4626YieldAdapter`. The test contract acts as the "vault" (the sole authorized caller).
contract MintwareIdleYieldAdapterTest is Test {
    MockERC20 internal usdg;
    MintwareIdleYieldAdapter internal adapter;

    address internal owner = makeAddr("owner");
    uint256 internal constant CAP = 10_000e6;

    function setUp() public {
        usdg = new MockERC20("USD Global", "USDG", 6);
        // vault = this test contract (the single authorized caller).
        adapter = new MintwareIdleYieldAdapter(address(usdg), address(this), owner, CAP);

        usdg.mint(address(this), 1_000_000e6);
        usdg.approve(address(adapter), type(uint256).max);
    }

    // ── core round-trip ─────────────────────────────────────────────────────────

    function test_deposit_holds_exactly_what_was_supplied() public {
        adapter.deposit(4_000e6);
        assertEq(adapter.totalAssets(), 4_000e6, "totalAssets == deposited, exactly (no share math to round)");
        assertEq(usdg.balanceOf(address(adapter)), 4_000e6, "underlying sits in the adapter, not swept elsewhere");
    }

    function test_withdraw_returns_assets_to_vault_exactly() public {
        adapter.deposit(4_000e6);
        uint256 balBefore = usdg.balanceOf(address(this));
        uint256 got = adapter.withdraw(1_500e6);
        assertEq(got, 1_500e6, "withdrew exactly requested -- always full, never best-effort-partial");
        assertEq(usdg.balanceOf(address(this)) - balBefore, 1_500e6);
        assertEq(adapter.totalAssets(), 2_500e6, "remainder still held");
    }

    function test_withdraw_never_reverts_and_clamps_to_balance() public {
        adapter.deposit(1_000e6);
        // ask for more than is held -- the interface promises "up to amount, never reverts for liquidity"
        uint256 got = adapter.withdraw(1_000_000e6);
        assertEq(got, 1_000e6, "clamped to the actual balance");
        assertEq(adapter.totalAssets(), 0);
        // a second withdraw with nothing left returns 0, does not revert
        assertEq(adapter.withdraw(1e6), 0);
    }

    function test_withdraw_zero_amount_is_a_noop_returns_zero() public {
        adapter.deposit(1_000e6);
        assertEq(adapter.withdraw(0), 0);
        assertEq(adapter.totalAssets(), 1_000e6, "untouched");
    }

    function test_deposit_zero_amount_is_a_true_noop() public {
        adapter.deposit(0); // must not revert, must not emit a transfer
        assertEq(adapter.totalAssets(), 0);
    }

    // ── no yield, ever ──────────────────────────────────────────────────────────

    function test_no_yield_accrues_ever_totalAssets_is_exactly_balance() public {
        adapter.deposit(5_000e6);
        vm.warp(block.timestamp + 365 days);
        vm.roll(block.number + 1_000_000);
        assertEq(adapter.totalAssets(), 5_000e6, "time and blocks passing change nothing -- no external position exists");
    }

    /// A plain donation only ever inflates NAV for whoever is credited by the caller above (the position
    /// manager's share math) -- it can never be used to bypass the deposit cap on a REAL `deposit()` call,
    /// since the cap check reads the live balance at call time, after the donation is already counted.
    function test_donation_is_counted_in_totalAssets_but_cannot_bypass_the_cap() public {
        address donor = makeAddr("donor"); // an outsider, not the vault
        usdg.mint(donor, CAP);
        vm.prank(donor);
        usdg.transfer(address(adapter), CAP);
        assertEq(adapter.totalAssets(), CAP, "donation counted like any other balance");

        vm.expectRevert(MintwareIdleYieldAdapter.DepositCapExceeded.selector);
        adapter.deposit(1); // the cap is already full from the donation alone
    }

    // ── deposit cap: the on-chain bound for "small amount, no external audit yet" ────────────────────────

    function test_depositCap_blocks_a_deposit_that_would_exceed_it() public {
        adapter.deposit(CAP); // exactly at the cap -- must succeed
        assertEq(adapter.totalAssets(), CAP);
        vm.expectRevert(MintwareIdleYieldAdapter.DepositCapExceeded.selector);
        adapter.deposit(1);
    }

    function test_depositCap_zero_at_construction_closes_deposits_until_raised() public {
        MintwareIdleYieldAdapter closed = new MintwareIdleYieldAdapter(address(usdg), address(this), owner, 0);
        assertEq(closed.maxSuppliable(), 0, "a forgotten cap reads as fully closed, never unlimited");
        vm.expectRevert(MintwareIdleYieldAdapter.DepositCapExceeded.selector);
        closed.deposit(1);

        vm.prank(owner);
        closed.setDepositCap(1_000e6);
        usdg.approve(address(closed), type(uint256).max);
        closed.deposit(1_000e6); // now open
        assertEq(closed.totalAssets(), 1_000e6);
    }

    function test_maxSuppliable_tracks_remaining_headroom() public {
        assertEq(adapter.maxSuppliable(), CAP);
        adapter.deposit(3_000e6);
        assertEq(adapter.maxSuppliable(), CAP - 3_000e6);
        adapter.deposit(CAP - 3_000e6);
        assertEq(adapter.maxSuppliable(), 0);
    }

    /// Lowering the cap below the current balance blocks further deposits but never touches existing funds --
    /// the cap is a deposit gate, not a forced-withdrawal lever.
    function test_lowering_the_cap_below_balance_does_not_touch_existing_deposits() public {
        adapter.deposit(CAP);
        vm.prank(owner);
        adapter.setDepositCap(1);
        assertEq(adapter.totalAssets(), CAP, "existing balance untouched");
        assertEq(adapter.maxSuppliable(), 0, "no further deposit room");
        assertEq(adapter.withdraw(CAP), CAP, "withdrawal still works normally");
    }

    // ── access control (mirrors MintwareERC4626YieldAdapter) ─────────────────────────────────────────────

    function test_onlyVault_gates_deposit_and_withdraw() public {
        vm.startPrank(makeAddr("stranger"));
        vm.expectRevert(MintwareIdleYieldAdapter.OnlyVault.selector);
        adapter.deposit(1);
        vm.expectRevert(MintwareIdleYieldAdapter.OnlyVault.selector);
        adapter.withdraw(1);
        vm.stopPrank();
    }

    function test_setVault_is_one_time() public {
        MintwareIdleYieldAdapter fresh = new MintwareIdleYieldAdapter(address(usdg), address(0), owner, CAP);
        vm.startPrank(owner);
        fresh.setVault(address(this));
        assertEq(fresh.vault(), address(this));
        vm.expectRevert(MintwareIdleYieldAdapter.VaultAlreadySet.selector);
        fresh.setVault(makeAddr("someoneElse"));
        vm.stopPrank();
    }

    function test_setVault_rejects_zero_address() public {
        MintwareIdleYieldAdapter fresh = new MintwareIdleYieldAdapter(address(usdg), address(0), owner, CAP);
        vm.prank(owner);
        vm.expectRevert(MintwareIdleYieldAdapter.ZeroAddress.selector);
        fresh.setVault(address(0));
    }

    function test_constructor_rejects_zero_asset() public {
        vm.expectRevert(MintwareIdleYieldAdapter.ZeroAddress.selector);
        new MintwareIdleYieldAdapter(address(0), address(this), owner, CAP);
    }

    function test_only_owner_can_set_vault_or_cap() public {
        MintwareIdleYieldAdapter fresh = new MintwareIdleYieldAdapter(address(usdg), address(0), owner, CAP);
        vm.startPrank(makeAddr("stranger"));
        vm.expectRevert(); // Ownable: caller is not the owner
        fresh.setVault(address(this));
        vm.expectRevert();
        fresh.setDepositCap(1);
        vm.stopPrank();
    }

    /// Renounce is disabled for the same reason as the production adapter -- it would freeze `depositCap`
    /// (here, permanently CLOSING deposits if the cap were low, or permanently OPEN if high) with no key able
    /// to lift it. Ownership moves only via the two-step transfer.
    function test_renounceOwnership_disabled() public {
        vm.prank(owner);
        vm.expectRevert(MintwareIdleYieldAdapter.RenounceDisabled.selector);
        adapter.renounceOwnership();
    }

    function test_ownership_transfer_is_two_step() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        adapter.transferOwnership(newOwner);
        assertEq(adapter.owner(), owner, "old owner still in control until accepted");
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(); // not the pending owner
        adapter.acceptOwnership();
        vm.prank(newOwner);
        adapter.acceptOwnership();
        assertEq(adapter.owner(), newOwner);
    }
}
