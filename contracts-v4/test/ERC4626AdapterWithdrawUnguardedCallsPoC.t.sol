// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareERC4626YieldAdapter} from "../src/vaults/MintwareERC4626YieldAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockGatedViewERC4626} from "./mocks/MockGatedViewERC4626.sol";

/// @title  FIXED — MintwareERC4626YieldAdapter.withdraw() now honors IYieldAdapter's "never revert" contract
///
/// @notice Round-4 audit finding (High): `IYieldAdapter.withdraw()` (IYieldAdapter.sol:17-20) is documented
///         "NEVER reverts for a liquidity/availability reason — returns 0 or a partial amount so the caller
///         can fall back to its own reserves." Before the fix, `withdraw()` wrapped ONLY `yieldSource.
///         redeem(...)` in try/catch — `previewWithdraw`, `balanceOf`, and `maxRedeem` (and, transitively,
///         `maxWithdrawable()`'s own reads) were bare external calls that could revert the whole withdrawal
///         if the underlying 4626 gates its VIEW functions behind a pause/emergency-shutdown switch (a
///         common, realistic Morpho-shaped pattern — not just the already-guarded `redeem` failure the
///         sibling suite's `test_withdraw_is_best_effort_when_source_stalls` covered).
///
///         Fix: `withdraw()` now isolates the ENTIRE read-then-redeem sequence behind one self-call boundary
///         (`_withdrawCore`, try/catch'd from `withdraw()`), so ANY failure anywhere in it degrades to
///         "serve 0 from buffer" uniformly — this file's tests now assert exactly that.
///
/// @dev    Verified green post-fix: `forge test --match-contract ERC4626AdapterWithdrawUnguardedCallsPoC -vvv`
///         (run from the repo root, where foundry.toml lives).
contract ERC4626AdapterWithdrawUnguardedCallsPoC is Test {
    MockERC20             internal usdc;
    MockGatedViewERC4626  internal source;
    MintwareERC4626YieldAdapter internal adapter;

    address internal owner = makeAddr("owner");

    function setUp() public {
        usdc   = new MockERC20("USD Coin", "USDC", 6);
        source = new MockGatedViewERC4626(IERC20(address(usdc)));
        // vault = this test contract (the single onlyVault-authorized caller, mirroring the sibling suite).
        adapter = new MintwareERC4626YieldAdapter(address(usdc), address(source), address(this), owner);

        usdc.mint(address(this), 1_000_000e6);
        usdc.approve(address(adapter), type(uint256).max);

        adapter.deposit(100_000e6);
    }

    /// Baseline: with nothing gated, withdraw behaves as documented — the golden path, unchanged by the fix.
    function test_baseline_withdraw_succeeds_when_source_is_healthy() public {
        uint256 got = adapter.withdraw(40_000e6);
        assertEq(got, 40_000e6, "sanity: healthy source withdraws cleanly");
    }

    /// FIXED — L126: `yieldSource.previewWithdraw(want)` failing no longer reverts withdraw(); it now
    /// degrades to 0, exactly like the already-guarded `redeem` failure always did.
    function test_Fixed_previewWithdraw_revert_degradesToZero_notRevert() public {
        assertGt(adapter.totalAssets(), 0, "adapter is funded before the fault");

        // The underlying 4626 enters a paused state (upgrade / emergency shutdown / accounting fault) and
        // its `previewWithdraw` — a VIEW function — starts reverting instead of returning 0.
        source.setPreviewWithdrawPaused(true);

        // FIXED behavior: withdraw() no longer bubbles the revert — it degrades to 0, honoring
        // IYieldAdapter's documented "NEVER reverts for a liquidity/availability reason" contract.
        uint256 got = adapter.withdraw(40_000e6);
        assertEq(got, 0, "degrades to 0 instead of reverting - the fix");

        // Undo the fault and show the exact same request succeeds — the funds were always there; only the
        // unguarded view call (now guarded via _withdrawCore's try/catch boundary) was ever the problem.
        source.setPreviewWithdrawPaused(false);
        uint256 got2 = adapter.withdraw(40_000e6);
        assertEq(got2, 40_000e6, "and recovers cleanly once the fault clears");
    }

    /// FIXED — L127: `yieldSource.balanceOf(address(this))` failing (also reached, equally unguarded before
    /// the fix, inside `maxWithdrawable()`) no longer reverts withdraw().
    function test_Fixed_balanceOf_revert_degradesToZero_notRevert() public {
        assertGt(adapter.totalAssets(), 0, "adapter is funded before the fault");

        source.setBalanceOfPaused(true);
        uint256 got = adapter.withdraw(40_000e6);
        assertEq(got, 0, "degrades to 0 instead of reverting - the fix");

        source.setBalanceOfPaused(false);
        uint256 got2 = adapter.withdraw(40_000e6);
        assertEq(got2, 40_000e6, "and recovers cleanly once the fault clears");
    }

    /// FIXED — L129: `yieldSource.maxRedeem(address(this))` failing no longer reverts withdraw().
    function test_Fixed_maxRedeem_revert_degradesToZero_notRevert() public {
        assertGt(adapter.totalAssets(), 0, "adapter is funded before the fault");

        source.setMaxRedeemPaused(true);
        uint256 got = adapter.withdraw(40_000e6);
        assertEq(got, 0, "degrades to 0 instead of reverting - the fix");

        source.setMaxRedeemPaused(false);
        uint256 got2 = adapter.withdraw(40_000e6);
        assertEq(got2, 40_000e6, "and recovers cleanly once the fault clears");
    }

    /// The ONE call already guarded pre-fix (`redeem`, now inside `_withdrawCore`) still degrades correctly
    /// to 0-and-no-revert — unchanged behavior, still true post-refactor.
    function test_Contrast_guarded_redeem_failure_correctly_returns_zero_not_revert() public {
        vm.mockCallRevert(
            address(source),
            abi.encodeWithSelector(bytes4(keccak256("redeem(uint256,address,address)"))),
            "source stalled"
        );

        uint256 got = adapter.withdraw(40_000e6); // must NOT revert — and doesn't
        assertEq(got, 0, "guarded call degrades to 0, per IYieldAdapter's contract");
    }
}
