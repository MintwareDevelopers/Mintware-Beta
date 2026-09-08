// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {MockSlot0PoolManager} from "../mocks/MockSlot0PoolManager.sol";

/// @dev Idle-path (tokenId == 0) unit tests never call V4; a non-zero address satisfies the ctor guard.
///      The deployed round-trip (mint / harvest / deployed-NAV) is proven in the fork harness.
contract Stub {}

contract MintwareLpGatewayPositionManagerTest is Test {
    MintwareLpGatewayStaging staging;
    MintwareLpGatewayPositionManager pm;
    MockERC20 usdg;
    MockERC20 pons;
    MockYieldAdapter adapter;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address harvestSink = address(0x5151);

    function setUp() public {
        usdg = new MockERC20("USD Global", "USDG", 6);
        pons = new MockERC20("Pons", "PONS", 18);
        adapter = new MockYieldAdapter(address(usdg));
        staging = new MintwareLpGatewayStaging(IERC20(address(usdg)), adapter);

        (address c0, address c1) =
            address(usdg) < address(pons) ? (address(usdg), address(pons)) : (address(pons), address(usdg));
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        address stub = address(new Stub());
        pm = new MintwareLpGatewayPositionManager(
            IPoolManager(address(new MockSlot0PoolManager())), IPositionManager(stub), IPermit2Minimal(stub),
            key, IERC20(address(usdg)), -600, 600, staging, address(this), harvestSink, 2000
        );
        staging.setController(address(pm));

        usdg.mint(alice, 2_000_000e6);
        usdg.mint(bob, 2_000_000e6);
        vm.prank(alice);
        usdg.approve(address(pm), type(uint256).max);
        vm.prank(bob);
        usdg.approve(address(pm), type(uint256).max);
    }

    function _deposit(address who, uint256 amt) internal returns (uint256) {
        vm.prank(who);
        return pm.deposit(amt);
    }

    function test_firstDeposit_oneToOne() public {
        uint256 s = _deposit(alice, 100_000e6);
        assertEq(s, 100_000e6);
        assertEq(pm.totalNav(), 100_000e6);
    }

    function test_secondDeposit_pricedAtNav() public {
        _deposit(alice, 100_000e6);
        usdg.mint(address(adapter), 10_000e6); // simulated yield lifts NAV
        uint256 sBob = _deposit(bob, 100_000e6);
        assertLt(sBob, 100_000e6);
    }

    function test_withdraw_idle_returnsValue() public {
        uint256 s = _deposit(alice, 100_000e6);
        vm.roll(block.number + 1); // withdraw in a later block (same-block guard)
        vm.prank(alice);
        (uint256 q, uint256 p) = pm.withdraw(s / 2);
        assertApproxEqAbs(q, 50_000e6, 2);
        assertEq(p, 0);
    }

    /// The donation-inflation attack: attacker deposits dust then donates to inflate NAV. The virtual
    /// offset + offset-consistent withdraw must leave the next depositor whole (not zeroed, not robbed).
    function test_inflationDefense_secondDepositorWhole() public {
        _deposit(alice, 1);
        usdg.mint(address(adapter), 100_000e6); // donation
        uint256 sBob = _deposit(bob, 100_000e6);
        assertGt(sBob, 0);
        vm.roll(block.number + 1); // withdraw in a later block (same-block guard)
        vm.prank(bob);
        (uint256 q,) = pm.withdraw(sBob);
        assertApproxEqRel(q, 100_000e6, 0.01e18); // recovers ~his deposit; cannot steal the donation
    }

    function test_deploy_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pm.deploy(1, 1, 0, block.timestamp);
    }

    function test_harvest_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pm.harvest(block.timestamp);
    }

    function test_harvest_revertsWhenUndeployed() public {
        vm.expectRevert(MintwareLpGatewayPositionManager.NotDeployed.selector);
        pm.harvest(block.timestamp);
    }

    function test_withdraw_moreThanBalance_reverts() public {
        uint256 s = _deposit(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(MintwareLpGatewayPositionManager.InsufficientShares.selector);
        pm.withdraw(s + 1);
    }

    // harvestRecipient is set at construction; the ONLY way to change it is the 48h timelocked rotation below
    // (F-02 rec. 3). There is no instant setter — the owner can't redirect the fee stream on the spot.
    function test_harvestRecipient_setAtConstruction() public view {
        assertEq(pm.harvestRecipient(), harvestSink);
        assertEq(pm.pendingHarvestRecipient(), address(0));
        assertEq(pm.harvestRecipientEta(), 0);
        assertEq(pm.HARVEST_RECIPIENT_DELAY(), 48 hours);
    }

    // ── F-02 rec. 3: timelocked harvestRecipient rotation ─────────────────────────────────────

    // via-IR may CSE `block.timestamp` across `vm.warp` (same trap as `block.number`/`vm.roll`), so every
    // rotation test warps to an ABSOLUTE anchor first and does its clock math on that literal.
    uint256 constant T0 = 1_700_000_000;

    function test_harvestRecipientRotation_happyPath_after48h() public {
        address next = address(0x9999);
        vm.warp(T0);
        uint256 t0 = T0;
        vm.expectEmit(true, true, false, true);
        emit MintwareLpGatewayPositionManager.HarvestRecipientProposed(harvestSink, next, t0 + 48 hours);
        pm.proposeHarvestRecipient(next);
        assertEq(pm.harvestRecipient(), harvestSink, "unchanged until accepted");
        assertEq(pm.pendingHarvestRecipient(), next);
        assertEq(pm.harvestRecipientEta(), t0 + 48 hours);

        vm.warp(t0 + 48 hours);
        vm.expectEmit(true, true, false, false);
        emit MintwareLpGatewayPositionManager.HarvestRecipientRotated(harvestSink, next);
        pm.acceptHarvestRecipient();
        assertEq(pm.harvestRecipient(), next);
        assertEq(pm.pendingHarvestRecipient(), address(0), "rotation state cleared");
        assertEq(pm.harvestRecipientEta(), 0);
    }

    /// The invariant a compromised owner key cannot break: proposing does nothing for 48h. One second early → revert.
    function test_harvestRecipientRotation_earlyAccept_reverts() public {
        address next = address(0x9999);
        vm.warp(T0);
        uint256 t0 = T0;
        pm.proposeHarvestRecipient(next);
        vm.expectRevert(MintwareLpGatewayPositionManager.RotationNotReady.selector);
        pm.acceptHarvestRecipient();
        vm.warp(t0 + 48 hours - 1);
        vm.expectRevert(MintwareLpGatewayPositionManager.RotationNotReady.selector);
        pm.acceptHarvestRecipient();
        assertEq(pm.harvestRecipient(), harvestSink, "still the original recipient");
    }

    function test_harvestRecipientRotation_cancel() public {
        address next = address(0x9999);
        vm.warp(T0);
        pm.proposeHarvestRecipient(next);
        vm.expectEmit(true, false, false, false);
        emit MintwareLpGatewayPositionManager.HarvestRecipientRotationCancelled(next);
        pm.cancelHarvestRecipientRotation();
        assertEq(pm.pendingHarvestRecipient(), address(0));
        assertEq(pm.harvestRecipientEta(), 0);
        vm.warp(T0 + 48 hours);
        vm.expectRevert(MintwareLpGatewayPositionManager.NoPendingRotation.selector);
        pm.acceptHarvestRecipient(); // a cancelled proposal can't be accepted later
        assertEq(pm.harvestRecipient(), harvestSink);
    }

    /// Re-proposing overwrites the pending address AND restarts the 48h clock — no way to "pre-arm" a rotation.
    function test_harvestRecipientRotation_reproposeRestartsClock() public {
        vm.warp(T0);
        uint256 t0 = T0;
        pm.proposeHarvestRecipient(address(0x9999));
        vm.warp(t0 + 47 hours);
        pm.proposeHarvestRecipient(address(0x8888));
        assertEq(pm.harvestRecipientEta(), t0 + 47 hours + 48 hours);
        vm.warp(t0 + 48 hours);
        vm.expectRevert(MintwareLpGatewayPositionManager.RotationNotReady.selector);
        pm.acceptHarvestRecipient();
        vm.warp(t0 + 47 hours + 48 hours);
        pm.acceptHarvestRecipient();
        assertEq(pm.harvestRecipient(), address(0x8888));
    }

    function test_harvestRecipientRotation_guards() public {
        vm.expectRevert(MintwareLpGatewayPositionManager.NoPendingRotation.selector);
        pm.acceptHarvestRecipient();
        vm.expectRevert(MintwareLpGatewayPositionManager.NoPendingRotation.selector);
        pm.cancelHarvestRecipientRotation();
        vm.expectRevert(MintwareLpGatewayPositionManager.ZeroAddress.selector);
        pm.proposeHarvestRecipient(address(0));
        // owner-only on all three
        vm.startPrank(alice);
        vm.expectRevert();
        pm.proposeHarvestRecipient(alice);
        vm.expectRevert();
        pm.acceptHarvestRecipient();
        vm.expectRevert();
        pm.cancelHarvestRecipientRotation();
        vm.stopPrank();
        // a pending (not yet accepted) OWNER has no rotation powers either (Ownable2Step)
        pm.transferOwnership(bob);
        vm.prank(bob);
        vm.expectRevert();
        pm.proposeHarvestRecipient(bob);
    }

    // ── C-10: `lastKnownIdle` bookkeeping on the happy path (the outage behaviour lives in
    //    MintwareLpGatewaySourceOutage.t.sol + MintwareLpGatewayCloseoutFork.t.sol) ────────────────

    function test_lastKnownIdle_tracksReserve() public {
        assertEq(pm.lastKnownIdle(), 0);
        assertTrue(pm.sourceReadable());
        uint256 s = _deposit(alice, 100_000e6);
        assertEq(pm.lastKnownIdle(), 100_000e6, "refreshed post-stage");
        usdg.mint(address(this), 5_000e6);
        usdg.approve(address(pm), 5_000e6);
        pm.compoundQuote(5_000e6);
        assertEq(pm.lastKnownIdle(), 105_000e6, "refreshed after compound");
        vm.roll(block.number + 1);
        vm.prank(alice);
        pm.withdraw(s / 2);
        assertApproxEqRel(pm.lastKnownIdle(), 52_500e6, 0.001e18, "refreshed after the idle leg left");
    }

    // Same-block guard: a single address cannot deposit and withdraw in the same block (kills the
    // atomic round-trip pattern). A later block is fine (see test_withdraw_idle_returnsValue).
    function test_sameBlock_depositThenWithdraw_reverts() public {
        uint256 s = _deposit(alice, 100_000e6);
        vm.prank(alice);
        vm.expectRevert(MintwareLpGatewayPositionManager.SameBlockAction.selector);
        pm.withdraw(s);
    }

    function test_sameBlock_twoDeposits_reverts() public {
        _deposit(alice, 50_000e6);
        vm.prank(alice);
        vm.expectRevert(MintwareLpGatewayPositionManager.SameBlockAction.selector);
        pm.deposit(50_000e6);
    }

    // The deviation band (clamped-follower per-block step) is validated at construction (>0, <=5000). Full
    // follower + conservative-mark behaviour needs a real pool (the fork test) — the Stub keeps tokenId==0.
    function test_maxDeviationBps_set() public view {
        assertEq(pm.maxDeviationBps(), 2000);
    }

    // renounceOwnership is disabled — it would strip the operator and freeze the deployed position (M-01/L-06).
    function test_renounceOwnership_disabled() public {
        vm.expectRevert(MintwareLpGatewayPositionManager.RenounceDisabled.selector);
        pm.renounceOwnership();
    }

    // Circuit-breaker (item 13): pause blocks NEW deposits but NEVER withdraw — funds can't be trapped.
    function test_pause_blocksDeposit_allowsWithdraw() public {
        uint256 s = _deposit(alice, 100_000e6);
        pm.setPaused(true);
        vm.prank(bob);
        vm.expectRevert(MintwareLpGatewayPositionManager.DepositsPaused.selector);
        pm.deposit(50_000e6);
        // withdraw still works while paused
        vm.roll(block.number + 1);
        vm.prank(alice);
        (uint256 q,) = pm.withdraw(s / 2);
        assertApproxEqAbs(q, 50_000e6, 2);
        // unpause restores deposits
        pm.setPaused(false);
        vm.roll(block.number + 1);
        assertGt(_deposit(bob, 50_000e6), 0);
    }

    function test_setPaused_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pm.setPaused(true);
    }

    // compoundQuote (item 14): lifts NAV pro-rata with NO share mint — every holder's value rises.
    function test_compoundQuote_liftsNavNoMint() public {
        _deposit(alice, 100_000e6);
        uint256 tsBefore = pm.totalShares();
        uint256 navBefore = pm.totalNav();
        usdg.mint(address(this), 5_000e6);
        usdg.approve(address(pm), 5_000e6);
        pm.compoundQuote(5_000e6);
        assertEq(pm.totalShares(), tsBefore); // no mint
        assertApproxEqAbs(pm.totalNav(), navBefore + 5_000e6, 2); // NAV up by the compounded amount
    }

    function test_compoundQuote_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pm.compoundQuote(1e6);
    }

    // ── Re-audit A-1 REGRESSION ────────────────────────────────────────────────────────────────
    // Idle-only state (tokenId == 0), adapter illiquid/paused (totalAssets reports full principal but
    // withdraw returns partial — exactly a paused Morpho). Before the fix, withdraw burned ALL shares and
    // stranded the unserved 70k ownerless. After the fix, the withdrawer receives the liquid 30k and is
    // RE-CREDITED shares for the unserved 70k — then recovers it once the adapter is liquid again. No loss.
    function test_audit_A1_idleOnlyWithdraw_adapterIlliquid_reCreditsUnservedShares() public {
        uint256 shares = _deposit(alice, 100_000e6);
        assertEq(pm.totalNav(), 100_000e6);

        // Simulate the adapter going illiquid: only 30k withdrawable, totalAssets still 100k.
        adapter.setWithdrawableCap(30_000e6);
        assertEq(pm.totalNav(), 100_000e6); // NAV still reports the full principal

        uint256 balBefore = usdg.balanceOf(alice);
        // Anchor rolls to a captured baseline: two same-address actions need two DISTINCT advanced blocks,
        // and a relative `block.number + 1` re-evaluated inside the test landed on block 2 both times.
        uint256 b0 = block.number;
        vm.roll(b0 + 1);
        vm.prank(alice);
        (uint256 quoteOut, uint256 pairedOut) = pm.withdraw(shares); // withdraw ALL shares

        // Alice received only the liquid 30k …
        assertEq(quoteOut, 30_000e6);
        assertEq(pairedOut, 0);
        assertEq(usdg.balanceOf(alice) - balBefore, 30_000e6);
        // … and is RE-CREDITED exactly the shares for the unserved 70k (claim 100k, delivered 30k → 70%).
        assertEq(pm.sharesOf(alice), 70_000e6);
        assertEq(pm.totalShares(), 70_000e6);
        assertEq(usdg.balanceOf(address(adapter)), 70_000e6); // still hers, via the re-credited shares

        // Adapter becomes liquid again → she withdraws the remainder and recovers everything. No loss.
        adapter.setWithdrawableCap(type(uint256).max);
        vm.roll(b0 + 2);
        vm.prank(alice);
        (uint256 q2,) = pm.withdraw(70_000e6);
        assertEq(q2, 70_000e6);
        assertEq(usdg.balanceOf(alice) - balBefore, 100_000e6); // 30k + 70k = full principal back
        assertEq(pm.sharesOf(alice), 0);
        assertEq(pm.totalShares(), 0);
    }
}
