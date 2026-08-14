// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {MintwareTreasuryVault} from "../../src/payments/MintwareTreasuryVault.sol";
import {IERC20}                from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";

/// @dev Stand-in for the real V4 JIT hook — it only exercises the vault's borrow-seam accounting: borrow
///      a slice, then return `returnAmount` USDC and settle, all in one call (mirrors the atomic
///      beforeSwap→afterSwap of a real swap). Pre-fund it to simulate a fee (profit); return less to
///      simulate a close cost (loss the junior must cover).
contract MockJitHook {
    MintwareTreasuryVault public vault;
    IERC20 public usdc;

    constructor(MintwareTreasuryVault v, IERC20 u) {
        vault = v;
        usdc = u;
    }

    /// Borrow up to `want`, then return `returnAmount` to the vault and settle. Returns what was lent.
    function round(uint256 want, uint256 returnAmount) external returns (uint256 lent) {
        lent = vault.borrowIdleForJit(want);
        usdc.transfer(address(vault), returnAmount);
        vault.settleJitReturn(returnAmount);
    }

    /// Borrow only (to probe the per-block cap) without settling — test resets by never leaving state
    /// outstanding across assertions that read NAV. Used only in the cap test which settles right after.
    function borrow(uint256 want) external returns (uint256 lent) {
        lent = vault.borrowIdleForJit(want);
    }

    function settle(uint256 amount) external {
        usdc.transfer(address(vault), amount);
        vault.settleJitReturn(amount);
    }
}

/// @notice Increment 1 of the JIT/surge build (#5, option C): proves the vault's JIT borrow-seam in
///         isolation. A bounded senior slice is lent per block; a profitable round lifts the senior, a
///         lossy round is absorbed by the junior USDC buffer (senior stays whole at par), and past the
///         buffer the senior dips only by a bounded residual — never reverting.
contract MintwareTreasuryVaultJitTest is Test {
    MockERC20             internal usdc; // 6dp
    MockERC20             internal team; // 6dp
    MockYieldAdapter      internal adapter;
    MintwareTreasuryVault internal vault;
    MockJitHook           internal hook;

    address internal teamAddr = makeAddr("team");
    address internal user     = makeAddr("user");

    uint256 internal constant ONE = 1e6;
    uint256 internal constant JUNIOR_BUFFER = 5_000 * ONE;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Team Token", "TEAM", 6);
        (vault, adapter, hook) = _newVault(JUNIOR_BUFFER);
    }

    /// Spin up a fresh wired vault (owner = this) with `$10k` senior + a `juniorBuffer` first-loss buffer.
    function _newVault(uint256 juniorBuffer)
        internal
        returns (MintwareTreasuryVault v, MockYieldAdapter a, MockJitHook h)
    {
        a = new MockYieldAdapter(address(usdc));
        v = new MintwareTreasuryVault(address(usdc), address(team), address(a), address(this)); // owner=this

        team.mint(teamAddr, 1_000_000 * ONE);
        usdc.mint(teamAddr, juniorBuffer);
        vm.startPrank(teamAddr);
        team.approve(address(v), type(uint256).max);
        usdc.approve(address(v), type(uint256).max);
        v.commitTeam(1_000_000 * ONE, juniorBuffer, 365 days);
        vm.stopPrank();

        usdc.mint(user, 10_000 * ONE);
        vm.startPrank(user);
        usdc.approve(address(v), type(uint256).max);
        v.depositUSDC(10_000 * ONE, 0, user);
        vm.stopPrank();

        h = new MockJitHook(v, IERC20(address(usdc)));
        v.setJitHook(address(h)); // owner=this
    }

    // ── the bounded per-block slice ───────────────────────────────────────────

    function test_borrow_capped_per_block() public {
        // 5% default × $10,000 senior = $500 cap.
        uint256 lent = hook.borrow(20_000 * ONE); // ask for way more
        assertEq(lent, 500 * ONE, "not capped to 5% of senior base");
        // second borrow same block → nothing left.
        assertEq(hook.borrow(1 * ONE), 0, "per-block cap not enforced across calls");
        // settle both so no state dangles.
        usdc.mint(address(hook), 1); // dust to cover rounding
        hook.settle(lent);
        assertEq(vault.jitBorrowed(), 0, "jitBorrowed not cleared");
    }

    function test_cap_zero_disables_jit() public {
        vault.setJitCap(0);
        assertEq(hook.borrow(1_000 * ONE), 0, "cap 0 should lend nothing");
    }

    // ── profit / loss accounting ──────────────────────────────────────────────

    function test_profitable_round_lifts_senior() public {
        uint256 navBefore = vault.totalSeniorAssets();
        uint256 fee = 3 * ONE;
        usdc.mint(address(hook), fee); // the hook's captured fee
        uint256 lent = hook.round(400 * ONE, 400 * ONE + fee); // return principal + fee
        assertGt(lent, 0, "nothing lent");
        assertEq(vault.jitBorrowed(), 0, "jitBorrowed not cleared");
        assertEq(vault.totalSeniorAssets(), navBefore + fee, "fee did not lift senior NAV");
        assertEq(vault.juniorUsdcBuffer(), JUNIOR_BUFFER, "junior buffer touched on a profit");
    }

    function test_lossy_round_absorbed_by_junior_buffer() public {
        uint256 navBefore = vault.totalSeniorAssets();
        uint256 bufBefore = vault.juniorUsdcBuffer();
        // Borrow $400, return only $390 (a $10 close cost) — the junior buffer covers it, senior whole.
        hook.round(400 * ONE, 390 * ONE);
        assertEq(vault.totalSeniorAssets(), navBefore, "senior not made whole on a loss");
        assertEq(vault.juniorUsdcBuffer(), bufBefore - 10 * ONE, "junior buffer did not absorb the loss");
        assertEq(vault.jitBorrowed(), 0, "jitBorrowed not cleared");
    }

    function test_loss_beyond_buffer_is_bounded_senior_dip_not_revert() public {
        // Fresh vault with a TINY $3 junior buffer, so a single $10 loss overshoots it.
        (MintwareTreasuryVault v,, MockJitHook h) = _newVault(3 * ONE);
        uint256 navBefore = v.totalSeniorAssets();
        // Borrow $400, return $390 → $10 loss; only $3 of buffer → senior dips the $7 residual, no revert.
        h.round(400 * ONE, 390 * ONE);
        assertEq(v.juniorUsdcBuffer(), 0, "buffer should be exhausted");
        assertApproxEqAbs(v.totalSeniorAssets(), navBefore - 7 * ONE, 2, "senior dip not bounded to the residual");
        assertEq(v.jitBorrowed(), 0, "jitBorrowed not cleared");
    }

    // ── access control ────────────────────────────────────────────────────────

    function test_only_jit_hook_can_borrow() public {
        vm.expectRevert(MintwareTreasuryVault.OnlyJitHook.selector);
        vault.borrowIdleForJit(1 * ONE); // caller is the test, not the hook
    }

    function test_only_jit_hook_can_settle() public {
        vm.expectRevert(MintwareTreasuryVault.OnlyJitHook.selector);
        vault.settleJitReturn(1 * ONE);
    }

    function test_set_jit_hook_is_set_once() public {
        vm.expectRevert(MintwareTreasuryVault.AlreadySet.selector);
        vault.setJitHook(makeAddr("other"));
    }
}
