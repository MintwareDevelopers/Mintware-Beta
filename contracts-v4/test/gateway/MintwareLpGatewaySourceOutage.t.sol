// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {RTMintableERC20, RTFlaky4626} from "../audit/RedTeamOnchainTokens.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

contract Stub {}

/// @title  C-10 / RT-5f — a 4626 source whose `previewRedeem` reverts must NOT brick the gateway (idle-only paths)
/// @notice Production `MintwareERC4626YieldAdapter` over the red-team `RTFlaky4626` (runtime-flippable
///         `revertPreview`). Before the fix every NAV read, deposit AND withdraw reverted for as long as the source
///         misbehaved. After: `totalNav` falls back to `lastKnownIdle`, deposits fail closed (`SourceUnavailable` —
///         an entry can't be priced), and a withdraw with nothing deliverable refuses (state untouched) rather than
///         burning shares against a zero claim. The deployed-state LP-only exit is proven in
///         `test/fork/MintwareLpGatewayCloseoutFork.t.sol`.
contract MintwareLpGatewaySourceOutageTest is Test {
    RTMintableERC20 usdg;
    RTMintableERC20 pons;
    RTFlaky4626 src;
    MintwareERC4626YieldAdapter adapter;
    MintwareLpGatewayStaging staging;
    MintwareLpGatewayPositionManager pm;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint256 blk;

    function setUp() public {
        blk = block.number;
        usdg = new RTMintableERC20("USDG", "USDG", 6);
        pons = new RTMintableERC20("Pons", "PONS", 18);
        src = new RTFlaky4626(IERC20(address(usdg)));
        adapter = new MintwareERC4626YieldAdapter(address(usdg), address(src), address(0), address(this));
        staging = new MintwareLpGatewayStaging(IERC20(address(usdg)), adapter);
        adapter.setVault(address(staging));
        (address c0, address c1) =
            address(usdg) < address(pons) ? (address(usdg), address(pons)) : (address(pons), address(usdg));
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))
        });
        address stub = address(new Stub());
        pm = new MintwareLpGatewayPositionManager(
            IPoolManager(stub), IPositionManager(stub), IPermit2Minimal(stub),
            key, IERC20(address(usdg)), -600, 600, staging, address(this), address(0x5151), 500
        );
        staging.setController(address(pm));
        for (uint256 i; i < 2; i++) {
            address u = i == 0 ? alice : bob;
            usdg.mint(u, 1_000_000e6);
            vm.prank(u);
            usdg.approve(address(pm), type(uint256).max);
        }
        usdg.mint(address(this), 1_000_000e6);
        usdg.approve(address(pm), type(uint256).max);
    }

    function _roll(uint256 n) internal {
        blk += n;
        vm.roll(blk);
    }

    function _dep(address who, uint256 amt) internal returns (uint256) {
        vm.prank(who);
        return pm.deposit(amt);
    }

    /// Views survive the outage: `totalNav` reports the last known idle (flagged by `sourceReadable() == false`).
    function test_C10_totalNav_fallsBackToLastKnownIdle_neverReverts() public {
        _dep(alice, 100_000e6);
        assertEq(pm.lastKnownIdle(), 100_000e6);
        src.setRevertPreview(true);
        assertFalse(pm.sourceReadable());
        vm.expectRevert(); // sanity: the raw staged read really is down
        staging.stagedAssets();
        assertEq(pm.totalNav(), 100_000e6, "stale-but-served, not a revert");
        src.setRevertPreview(false);
        assertTrue(pm.sourceReadable());
        assertEq(pm.totalNav(), 100_000e6);
    }

    /// Deposits fail CLOSED during the outage — an entry that can't be priced never mints. No state change.
    function test_C10_deposit_revertsSourceUnavailable_noMint() public {
        _dep(alice, 100_000e6);
        src.setRevertPreview(true);
        uint256 ts = pm.totalShares();
        vm.prank(bob);
        vm.expectRevert(MintwareLpGatewayPositionManager.SourceUnavailable.selector);
        pm.deposit(1_000e6);
        vm.prank(bob);
        vm.expectRevert(MintwareLpGatewayPositionManager.SourceUnavailable.selector);
        pm.depositWithMin(1_000e6, 0);
        assertEq(pm.totalShares(), ts);
        assertEq(pm.sharesOf(bob), 0);
        assertEq(usdg.balanceOf(bob), 1_000_000e6, "nothing pulled");
    }

    /// Idle-only (tokenId == 0) + outage: there is NO leg that can pay, so the exit refuses with state untouched —
    /// shares are NOT burned against a zero claim. It completes in full the moment the source answers again.
    function test_C10_withdraw_idleOnly_refusesWithoutBurning_thenRecovers() public {
        uint256 s = _dep(alice, 100_000e6);
        src.setRevertPreview(true);
        _roll(1);
        vm.prank(alice);
        vm.expectRevert(MintwareLpGatewayPositionManager.SourceUnavailable.selector);
        pm.withdraw(s);
        assertEq(pm.sharesOf(alice), s, "claim fully intact");
        assertEq(pm.totalShares(), s);
        // A refused exit did not consume the same-block slot either.
        src.setRevertPreview(false);
        vm.prank(alice);
        (uint256 q,) = pm.withdraw(s);
        assertApproxEqAbs(q, 100_000e6, 2, "recovers everything when the source does");
        assertEq(pm.sharesOf(alice), 0);
    }

    /// Owner paths that must size off the reserve (deploy cap, compound) fail closed too — never blind.
    function test_C10_deploy_and_compound_failClosed() public {
        _dep(alice, 100_000e6);
        src.setRevertPreview(true);
        vm.expectRevert(MintwareLpGatewayPositionManager.SourceUnavailable.selector);
        pm.deploy(10_000e6, 0, 0, block.timestamp);
        // stage() itself succeeds (a 4626 deposit never touches previewRedeem) — it is the post-stage `_syncIdle`
        // refresh that trips, so the WHOLE tx reverts and nothing is stranded half-staged.
        vm.expectRevert(MintwareLpGatewayPositionManager.SourceUnavailable.selector);
        pm.compoundQuote(1_000e6);
        assertEq(usdg.balanceOf(address(this)), 1_000_000e6, "compound rolled back in full");
    }

    /// `lastKnownIdle` is the value of the LAST successful read — yield that accrued during an outage is not
    /// visible until the source answers, and is then picked up by the next state-changing read.
    function test_C10_lastKnownIdle_isLastSuccessfulRead() public {
        _dep(alice, 100_000e6);
        usdg.approve(address(src), 10_000e6);
        src.simulateYield(10_000e6); // accrues in the source
        assertEq(pm.lastKnownIdle(), 100_000e6, "not refreshed by a view");
        assertApproxEqAbs(pm.totalNav(), 110_000e6, 2, "live read sees the yield");
        src.setRevertPreview(true);
        assertEq(pm.totalNav(), 100_000e6, "outage -> last successful read (stale, conservative)");
        src.setRevertPreview(false);
        _roll(1);
        _dep(bob, 1e6);
        assertApproxEqAbs(pm.lastKnownIdle(), 110_000e6 + 1e6, 2, "next state-changing read refreshes");
    }
}
