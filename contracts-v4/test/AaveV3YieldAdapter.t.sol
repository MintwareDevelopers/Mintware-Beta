// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AaveV3YieldAdapter} from "../src/vaults/AaveV3YieldAdapter.sol";
import {IPoolAddressesProvider} from "../src/vaults/aave/IAaveV3.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockAavePool, MockAToken} from "./mocks/MockAavePool.sol";

/// @notice Unit tests for AaveV3YieldAdapter. The test contract acts as the `vault`. Focus: the
///         safety-critical properties — best-effort withdraw (never reverts), per-block drain cap,
///         paused/hostile-pool degradation, access control, aToken verification.
contract AaveV3YieldAdapterTest is Test {
    MockERC20    internal usdc;
    MockAavePool internal pool;
    MockAToken   internal aUsdc;
    AaveV3YieldAdapter internal adapter;

    address internal stranger = makeAddr("stranger");
    uint256 internal constant AMT = 1_000e6;

    function setUp() public {
        usdc  = new MockERC20("USD Coin", "USDC", 6);
        pool  = new MockAavePool();
        aUsdc = new MockAToken(address(usdc), address(pool));
        pool.setAToken(address(usdc), aUsdc);
        pool.setConfig(address(usdc), true, false, false); // active, not frozen/paused

        // this test contract == the vault
        adapter = new AaveV3YieldAdapter(
            IPoolAddressesProvider(address(pool)), address(usdc), address(aUsdc), address(this), address(this)
        );
        usdc.mint(address(this), 1_000_000e6);
        usdc.approve(address(adapter), type(uint256).max);
    }

    function _deposit(uint256 amt) internal { adapter.deposit(amt); }

    // ── supply / totalAssets ──────────────────────────────────────────────────
    function test_deposit_supplies_to_aave() public {
        _deposit(AMT);
        assertEq(adapter.totalAssets(), AMT, "totalAssets == aToken balance");
        assertEq(aUsdc.balanceOf(address(adapter)), AMT);
        assertEq(usdc.balanceOf(address(aUsdc)), AMT, "underlying held by aToken");
    }

    // ── full withdraw ─────────────────────────────────────────────────────────
    function test_withdraw_full_returns_all() public {
        _deposit(AMT);
        uint256 before = usdc.balanceOf(address(this));
        uint256 got = adapter.withdraw(AMT);
        assertEq(got, AMT);
        assertEq(usdc.balanceOf(address(this)) - before, AMT, "vault got underlying back");
        assertEq(adapter.totalAssets(), 0);
    }

    // ── best-effort: high utilization → partial, never reverts ────────────────
    function test_withdraw_best_effort_on_low_liquidity() public {
        _deposit(AMT);
        aUsdc.simulateBorrow(600e6); // only 400 underlying left backing the aToken
        assertEq(adapter.maxWithdrawable(), 400e6);
        uint256 got = adapter.withdraw(AMT); // ask 1000, get 400, no revert
        assertEq(got, 400e6, "clamped to available liquidity");
    }

    // ── paused reserve → maxWithdrawable 0 → withdraw returns 0 ────────────────
    function test_withdraw_zero_when_paused() public {
        _deposit(AMT);
        pool.setConfig(address(usdc), true, false, true); // paused
        assertEq(adapter.maxWithdrawable(), 0);
        assertEq(adapter.withdraw(AMT), 0, "no revert, returns 0");
        assertEq(adapter.totalAssets(), AMT, "nothing burned");
    }

    // ── hostile/broken pool that reverts → try/catch returns 0 (swap never bricks) ──
    function test_withdraw_zero_when_pool_reverts() public {
        _deposit(AMT);
        pool.setRevertOnWithdraw(true);
        assertEq(adapter.withdraw(AMT), 0, "try/catch swallows the revert");
        assertEq(adapter.totalAssets(), AMT, "position intact");
    }

    // ── per-block drain cap bounds inventory pulled per block ──────────────────
    function test_per_block_withdraw_cap() public {
        adapter.setPerBlockWithdrawCap(300e6);
        _deposit(AMT);
        assertEq(adapter.withdraw(AMT), 300e6, "first pull capped");
        assertEq(adapter.withdraw(AMT), 0, "cap exhausted this block");
        vm.roll(block.number + 1);
        assertEq(adapter.withdraw(AMT), 300e6, "cap resets next block");
    }

    // ── access control ─────────────────────────────────────────────────────────
    function test_onlyVault_gates_deposit_and_withdraw() public {
        vm.startPrank(stranger);
        vm.expectRevert(AaveV3YieldAdapter.OnlyVault.selector);
        adapter.deposit(1);
        vm.expectRevert(AaveV3YieldAdapter.OnlyVault.selector);
        adapter.withdraw(1);
        vm.stopPrank();
    }

    // ── constructor verifies the aToken really represents the asset ────────────
    function test_constructor_rejects_mismatched_aToken() public {
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        MockAToken wrong = new MockAToken(address(other), address(pool)); // aToken for a DIFFERENT asset
        vm.expectRevert(AaveV3YieldAdapter.ATokenMismatch.selector);
        new AaveV3YieldAdapter(
            IPoolAddressesProvider(address(pool)), address(usdc), address(wrong), address(this), address(this)
        );
    }
}
