// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";
import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayFactory} from "../../src/gateway/MintwareLpGatewayFactory.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {MockERC4626} from "../mocks/MockERC4626.sol";
import {RTMintableERC20, RTFlaky4626} from "./RedTeamOnchainTokens.sol";
import {MockSlot0PoolManager} from "../mocks/MockSlot0PoolManager.sol";

contract Stub {}

/// @title  LP Gateway V1 — on-chain red-team (unit, Stub V4, idle-only paths)
/// @notice The tokenId == 0 attack surface with the PRODUCTION `MintwareERC4626YieldAdapter` composed over a
///         runtime-flippable 4626 source. Naming: `test_RT_<n>_<scenario>_(SUCCEEDS|FAILS)`.
///         Run: forge test --match-contract RedTeamOnchainUnit -vv
contract RedTeamOnchainUnitTest is Test {
    RTMintableERC20 usdg; // 6dp — the real quote decimals
    RTMintableERC20 pons;
    RTFlaky4626 src;
    MintwareERC4626YieldAdapter adapter;
    MintwareLpGatewayStaging staging;
    MintwareLpGatewayPositionManager pm;
    PoolKey key;
    address stub;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address mallory = address(0x3A110);
    address adapterOwner = address(0xAD0);
    address harvestSink = address(0x5151);
    uint256 blk;

    function setUp() public {
        blk = block.number;
        usdg = new RTMintableERC20("USDG", "USDG", 6);
        pons = new RTMintableERC20("Pons", "PONS", 18);
        src = new RTFlaky4626(IERC20(address(usdg)));
        adapter = new MintwareERC4626YieldAdapter(address(usdg), address(src), address(0), adapterOwner);
        staging = new MintwareLpGatewayStaging(IERC20(address(usdg)), adapter);
        vm.prank(adapterOwner);
        adapter.setVault(address(staging));
        (address c0, address c1) =
            address(usdg) < address(pons) ? (address(usdg), address(pons)) : (address(pons), address(usdg));
        key = PoolKey({
            currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))
        });
        stub = address(new Stub());
        pm = new MintwareLpGatewayPositionManager(
            IPoolManager(address(new MockSlot0PoolManager())), IPositionManager(stub), IPermit2Minimal(stub),
            key, IERC20(address(usdg)), -600, 600, staging, address(this), harvestSink, 500,
            type(uint256).max // IA-11 principal cap: uncapped -- this test predates/is unrelated to the cap
        );
        staging.setController(address(pm));
        _fund(alice, 10_000_000e6);
        _fund(bob, 10_000_000e6);
        _fund(mallory, 10_000_000e6);
        _fund(address(this), 10_000_000e6);
    }

    function _fund(address who, uint256 amt) internal {
        usdg.mint(who, amt);
        vm.prank(who);
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

    function _wd(address who, uint256 s) internal returns (uint256 q) {
        vm.prank(who);
        (q,) = pm.withdraw(s);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // 1. Inflation / rounding (VIRTUAL = 1e6 with a 6dp quote)
    // ═══════════════════════════════════════════════════════════════════════════════════════

    /// First-depositor donation: 1 wei deposit, then donate 4626 shares straight to the adapter (the only
    /// donation path that moves `adapter.totalAssets`). FAILS: with VIRTUAL = 1e6 a VICTIM's entry is priced
    /// against the virtual offset, so their rounding loss is bounded at ~$1 per $1M donated; the attacker's
    /// exit as a NON-last holder returns only dust + the offset-diluted share of their OWN donation (never a
    /// cent of the victim's), and the burned remainder accrues to honest holders — whoever exits LAST sweeps it
    /// (the last-holder-takes-all rule is by design; it can only ever hand the attacker their own leftover,
    /// which is why the earlier version of this PoC, where the attacker was the sole last holder, "recovered"
    /// the donation without touching the victim).
    function test_RT_1f_firstDepositorDonation_6dp_victimPricedFairly_FAILS() public {
        _dep(mallory, 1);
        // donation: mint 4626 shares to mallory then transfer them to the adapter ($1,000,000)
        vm.startPrank(mallory);
        usdg.approve(address(src), 1_000_000e6);
        src.deposit(1_000_000e6, mallory);
        src.transfer(address(adapter), src.balanceOf(mallory));
        vm.stopPrank();
        assertApproxEqAbs(pm.totalNav(), 1_000_000e6 + 1, 2);

        uint256 sBob = _dep(bob, 1_000e6); // victim deposits $1,000
        assertGt(sBob, 0, "victim not zeroed");
        // The victim's shares are worth what they paid (±0.1%) — the inflation defense (offset pricing) holds.
        uint256 bobClaim = sBob * (pm.totalNav() + 1e6) / (pm.totalShares() + 1e6);
        console2.log("victim deposited 1000e6, claim right after", bobClaim);
        assertApproxEqRel(bobClaim, 1_000e6, 0.001e18, "victim priced fairly against a $1M donation");
        _roll(1);
        uint256 sAlice = _dep(alice, 1_000e6); // a second honest holder, so nobody below exits as the last holder

        // Attacker exits as a NON-last holder: gets dust + the offset-diluted fair share of its own donation.
        _roll(1);
        uint256 mShares = pm.sharesOf(mallory);
        uint256 mGot = _wd(mallory, mShares);
        console2.log("attacker put in (1 wei + $1M donation), exits with", mGot);
        assertLe(mGot, 1_000_000e6 + 1, "attacker can never take out more than it put in");
        assertLe(mGot, 1_000_000e6 * 501 / 1000, "attacker recovers at most ~half its donation (offset-diluted)");
        assertGe(pm.totalNav(), 1_000e6 * 2 + 1_000_000e6 * 499 / 1000, "the burned remainder stays with honest holders");

        // Victim exits (still not last): whole to within rounding — cannot be robbed.
        _roll(1);
        uint256 got = _wd(bob, sBob);
        console2.log("victim got back", got);
        assertGe(got, 1_000e6 - 1e6, "victim loses at most ~$1 to rounding on a $1M donation");
        assertApproxEqRel(got, 1_000e6, 0.001e18, "victim made whole (+-0.1%)");

        // The last honest holder sweeps the attacker's burned donation — the flow is attacker → holders only.
        _roll(1);
        uint256 aGot = _wd(alice, sAlice);
        console2.log("last honest holder exits with", aGot);
        assertGt(aGot, 1_000e6 + 1_000_000e6 * 499 / 1000, "attacker's burned donation accrues to honest holders");
        assertEq(pm.totalShares(), 0);
    }

    /// Rounding drain: 300 alternating dust deposit/withdraw cycles against a live pool of 100k. FAILS: the
    /// floor rounding is always against the actor; the attacker never nets a single unit.
    function test_RT_1g_roundingDrain_dustCycles_FAILS() public {
        _dep(alice, 100_000e6);
        usdg.approve(address(src), 3_333e6);
        src.simulateYield(3_333e6); // odd NAV so shares:assets is not 1:1
        uint256 m0 = usdg.balanceOf(mallory);
        for (uint256 i = 0; i < 300; i++) {
            _roll(1);
            uint256 s = _dep(mallory, 7);
            _roll(1);
            _wd(mallory, s);
        }
        assertLe(usdg.balanceOf(mallory), m0, "attacker never gains from rounding");
        assertGe(pm.totalNav(), 103_333e6 - 300, "pool value intact to within dust");
        console2.log("attacker net after 300 cycles (negative or 0):", int256(usdg.balanceOf(mallory)) - int256(m0));
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // 5. Adapter / source adversary (idle-only)
    // ═══════════════════════════════════════════════════════════════════════════════════════

    /// A source whose EXIT FEE can be raised transiently: previewRedeem (NAV) halves → a new depositor mints
    /// 2x shares → fee back to 0 → they own half of everyone's idle. ORIGINALLY SUCCEEDED (accepted as curator-trust;
    /// Morpho does not do this). FIXED as a side effect of round-3 XR-3: a deposit must grow the fee-net reserve by
    /// ≥ amount·(1 − STAGE_TOLERANCE_BPS), and while the exit fee is up mallory's own 100k stage only credits 50k →
    /// `StageShortfall`. No cheap shares can be minted against a fee-depressed NAV; alice is untouched.
    function test_RT_5d_transientExitFee_mintsCheapShares_FIXED() public {
        uint256 sA = _dep(alice, 100_000e6);
        src.setExitFeeBps(5_000); // 50% exit fee → NAV marks at 50k
        assertApproxEqAbs(pm.totalNav(), 50_000e6, 2);
        usdg.mint(mallory, 100_000e6);
        vm.prank(mallory);
        usdg.approve(address(pm), type(uint256).max);
        vm.prank(mallory);
        vm.expectRevert(MintwareLpGatewayPositionManager.StageShortfall.selector);
        pm.deposit(100_000e6);
        assertEq(pm.sharesOf(mallory), 0, "no shares minted against the fee-depressed mark");
        src.setExitFeeBps(0);
        _roll(1);
        assertApproxEqAbs(_wd(alice, sA), 100_000e6, 2, "alice's principal intact");
    }

    /// Source `maxDeposit == 0` / supply cap hit: deposits revert (DOS, no loss); withdraw unaffected. FAILS.
    function test_RT_5e_sourceSupplyCap_depositDOS_noLoss_FAILS() public {
        uint256 s = _dep(alice, 100_000e6);
        src.setDepositsDisabled(true);
        vm.prank(bob);
        vm.expectRevert();
        pm.deposit(1_000e6);
        _roll(1);
        assertApproxEqAbs(_wd(alice, s), 100_000e6, 2, "exit path intact");
    }

    /// Source `previewRedeem` reverts (a bricked/paused source). ORIGINALLY SUCCEEDED as a total availability brick:
    /// `stagedAssets()` reverted → deposit AND withdraw AND totalNav all reverted (A-8 noted, not fixed).
    /// FIXED (consolidated C-10, closeout 2026-09-08): the PM's staged read is tolerant — `totalNav` falls back to
    /// `lastKnownIdle` (flagged via `sourceReadable()`), deposits fail CLOSED (`SourceUnavailable` — an entry that
    /// can't be priced never mints), and an idle-only withdraw with nothing deliverable refuses with state untouched
    /// instead of burning shares against a zero claim. The deployed-state LP-only exit is proven in
    /// `test/fork/MintwareLpGatewayCloseoutFork.t.sol`. Recovers fully when the source does. No loss either way.
    function test_RT_5f_sourcePreviewReverts_availabilityPreserved_FIXED() public {
        uint256 s = _dep(alice, 100_000e6);
        src.setRevertPreview(true);
        assertFalse(pm.sourceReadable());
        assertEq(pm.totalNav(), 100_000e6, "view served from lastKnownIdle (pre-fix: revert)");
        vm.prank(bob);
        vm.expectRevert(MintwareLpGatewayPositionManager.SourceUnavailable.selector);
        pm.deposit(1e6); // fail closed, not blind
        _roll(1);
        vm.prank(alice);
        vm.expectRevert(MintwareLpGatewayPositionManager.SourceUnavailable.selector);
        pm.withdraw(s); // nothing deliverable (no LP) → refuse, shares intact
        assertEq(pm.sharesOf(alice), s, "claim intact");
        src.setRevertPreview(false);
        assertApproxEqAbs(_wd(alice, s), 100_000e6, 2, "recovers when the source does");
    }

    /// Reentrancy from inside the source's `redeem` (fires during `withdraw` → unstage → adapter.withdraw):
    /// FAILS. The PM is nonReentrant, so the probe reverts; the adapter's try/catch swallows the whole redeem
    /// (serves 0) and A-1 re-credits every share — no state corruption, no loss.
    function test_RT_5g_reentrancyFromSourceRedeem_FAILS() public {
        uint256 s = _dep(alice, 100_000e6);
        src.setReenter(address(pm), abi.encodeWithSelector(pm.withdraw.selector, 1));
        _roll(1);
        uint256 got = _wd(alice, s);
        assertFalse(src.reenterSucceeded(), "reentrant withdraw was rejected");
        assertEq(
            bytes4(src.reenterRevert()), bytes4(keccak256("ReentrancyGuardReentrantCall()")), "rejected by the PM's guard"
        );
        // the probe's failure is swallowed by this mock (low-level call), so the redeem itself completes normally
        assertApproxEqAbs(got, 100_000e6, 2, "state intact: the honest exit is served exactly once");
        assertEq(pm.sharesOf(alice), 0);
    }

    /// Reentrancy probe into `deposit` from the source's redeem — also rejected.
    function test_RT_5h_reentrancyDepositFromSourceRedeem_FAILS() public {
        uint256 s = _dep(alice, 100_000e6);
        src.setReenter(address(pm), abi.encodeWithSelector(pm.deposit.selector, 1e6));
        _roll(1);
        _wd(alice, s);
        assertFalse(src.reenterSucceeded(), "reentrant deposit was rejected");
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // 7. Ownership / factory / adapter-owner
    // ═══════════════════════════════════════════════════════════════════════════════════════

    /// The adapter owner (a DIFFERENT trust root from the PM owner in code — the same Privy seat in the deploy
    /// script) can set `perBlockWithdrawCap = 1`: every exit serves 1 wei and re-credits the rest. SUCCEEDS
    /// as an indefinite soft-lock of all exits by that key; no value is lost or moved.
    function test_RT_7d_adapterOwnerPerBlockCap_softLocksExits_SUCCEEDS() public {
        uint256 s = _dep(alice, 100_000e6);
        vm.prank(adapterOwner);
        adapter.setPerBlockWithdrawCap(1);
        uint256 total;
        for (uint256 i = 0; i < 5; i++) {
            _roll(1);
            total += _wd(alice, pm.sharesOf(alice));
        }
        console2.log("served over 5 blocks of full-exit attempts (wei)", total);
        assertEq(total, 5, "1 wei per block");
        assertEq(pm.sharesOf(alice), s - 5, "claim fully preserved");
        vm.prank(adapterOwner);
        adapter.setPerBlockWithdrawCap(0);
        _roll(1);
        assertApproxEqAbs(_wd(alice, pm.sharesOf(alice)), 100_000e6 - 5, 2);
    }

    /// setController front-run: only the deployer can wire the controller, once. FAILS.
    function test_RT_7a_setControllerRace_FAILS() public {
        MintwareLpGatewayStaging fresh = new MintwareLpGatewayStaging(IERC20(address(usdg)), adapter);
        vm.prank(mallory);
        vm.expectRevert(MintwareLpGatewayStaging.NotDeployer.selector);
        fresh.setController(mallory);
        fresh.setController(address(pm));
        vm.expectRevert(MintwareLpGatewayStaging.AlreadySet.selector);
        fresh.setController(mallory);
    }

    /// Factory adapter reuse → AdapterReused; a non-owner cannot create gateways. FAILS.
    function test_RT_7b_factoryAdapterReuse_and_curation_FAILS() public {
        MintwareLpGatewayFactory f =
            new MintwareLpGatewayFactory(IPoolManager(address(new MockSlot0PoolManager())), IPositionManager(stub), IPermit2Minimal(stub), address(this));
        MintwareERC4626YieldAdapter a1 =
            new MintwareERC4626YieldAdapter(address(usdg), address(src), address(0), address(this));
        f.createGateway(key, IERC20(address(usdg)), IYieldAdapter(address(a1)), -600, 600, address(this), harvestSink, 0, type(uint256).max);
        PoolKey memory key2 = key;
        key2.fee = 10_000;
        vm.expectRevert(MintwareLpGatewayFactory.AdapterReused.selector);
        f.createGateway(key2, IERC20(address(usdg)), IYieldAdapter(address(a1)), -600, 600, address(this), harvestSink, 0, type(uint256).max);
        vm.prank(mallory);
        vm.expectRevert();
        f.createGateway(key2, IERC20(address(usdg)), IYieldAdapter(address(a1)), -600, 600, mallory, mallory, 0, type(uint256).max);
    }

    /// Ownable2Step: a pending owner has no powers until accept; the current owner keeps them; renounce is
    /// disabled. FAILS.
    function test_RT_7c_ownable2Step_pendingOwnerPowerless_FAILS() public {
        pm.transferOwnership(mallory);
        vm.prank(mallory);
        vm.expectRevert();
        pm.setPaused(true);
        pm.setPaused(true); // current owner still operates
        pm.setPaused(false);
        vm.expectRevert(MintwareLpGatewayPositionManager.RenounceDisabled.selector);
        pm.renounceOwnership();
        vm.prank(mallory);
        pm.acceptOwnership();
        vm.expectRevert();
        pm.setPaused(true); // old owner is out
    }

    /// Compromised PM owner in the idle-only state: enumerate what the key can do. No principal-moving
    /// function exists — pause deposits, compound (donate), deploy (needs a live pool). FAILS to extract.
    function test_RT_9d_compromisedOwnerIdleOnly_noPrincipalSweep_FAILS() public {
        uint256 s = _dep(alice, 100_000e6);
        pm.setPaused(true);
        vm.prank(bob);
        vm.expectRevert(MintwareLpGatewayPositionManager.DepositsPaused.selector);
        pm.deposit(1e6);
        // the owner cannot call staging/adapter directly
        vm.expectRevert(MintwareLpGatewayStaging.NotController.selector);
        staging.unstage(1e6);
        vm.expectRevert(MintwareERC4626YieldAdapter.OnlyVault.selector);
        adapter.withdraw(1e6);
        _roll(1);
        assertApproxEqAbs(_wd(alice, s), 100_000e6, 2, "depositor exits in full while paused");
    }
}
