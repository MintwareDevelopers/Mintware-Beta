// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {Audit3FlakySource, Audit3Stub} from "./InvariantMocks.sol";
import {MockSlot0PoolManager} from "../mocks/MockSlot0PoolManager.sol";

/// @title  Round-3 invariant-fuzzing counterexamples, reproduced as concrete regressions — POST-FIX (2026-09-08)
/// @notice Each test replays the SHRUNK sequence the stateful fuzzer (InvariantIdleOnly.t.sol) produced against the
///         pre-fix source, with the exact numbers, and now asserts the FIXED behaviour. The pre-fix numbers are kept
///         in the comments as evidence. Do not delete these when refactoring — they are the regression fence.
///
///         F1 (per-leg VIRTUAL double count → phantom LP entitlement) — FIXED:
///           `_withdraw` used to size BOTH legs with `toAssets(shares, leg, ts, VIRTUAL)`, adding the 1e6 virtual assets
///           to EACH leg; with no position `lpEntitled = shares·V/(ts+V) > 0` although the LP leg was worth 0, so every
///           partial exit re-credited ≈ shares·V/(ts+V) UNBACKED shares (F1-a: 2,090 shares on the shrunk sequence,
///           $0.50/cycle in the drain test) and the documented `SourceUnavailable` refusal was dead code (F1-b).
///           Fixed source: ONE offset on the whole claim (`claimTotal = toAssets(shares, idle + lpVal_w, ts, V)`, capped
///           at what exists), legs split by un-offset weights, `liqToRemove = min(liq, liq·lpEntitled/lpVal)`.
///
///         F2 (adapter inherits the yield source's first-depositor inflation attack) — FIXED (XR-3 `StageShortfall`):
///           a deposit must grow the staged reserve by ≥ amount·(1 − 50 bps) or the PM reverts. Against an empty
///           offset-0 source primed with a donation D, any deposit A ≤ D mints 0 source shares and is refused; the
///           first deposit large enough to pass (loss = r/(m+1) ≤ 50 bps, m = ⌊A/(D+1)⌋) captures the donation.
///
///         F3 (adapter over-delivers < 1 source share per unstage) — informational, unchanged, still true.
contract InvariantRegressionsTest is Test {
    uint256 constant V = 1e6;

    MintwareLpGatewayPositionManager pm;
    MintwareLpGatewayStaging staging;
    MintwareERC4626YieldAdapter adapter;
    Audit3FlakySource src;
    MockERC20 usdg;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address mallory = address(0x3A110);
    uint256 blk;

    function setUp() public {
        usdg = new MockERC20("USD Global", "USDG", 6);
        MockERC20 pons = new MockERC20("Pons", "PONS", 18);
        src = new Audit3FlakySource(IERC20(address(usdg)));
        adapter = new MintwareERC4626YieldAdapter(address(usdg), address(src), address(0), address(this));
        staging = new MintwareLpGatewayStaging(IERC20(address(usdg)), adapter);
        adapter.setVault(address(staging));
        (address c0, address c1) =
            address(usdg) < address(pons) ? (address(usdg), address(pons)) : (address(pons), address(usdg));
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))
        });
        address stub = address(new Audit3Stub());
        // Post-fix: the constructor reads slot0 (XR-2) — the idle rig passes the slot0 stand-in as the pool manager.
        pm = new MintwareLpGatewayPositionManager(
            IPoolManager(address(new MockSlot0PoolManager())), IPositionManager(stub), IPermit2Minimal(stub),
            key, IERC20(address(usdg)), -600, 600, staging, address(this), address(0x5151), 2000
        );
        staging.setController(address(pm));
        blk = block.number;
        address[3] memory us = [alice, bob, mallory];
        for (uint256 i; i < 3; ++i) {
            usdg.mint(us[i], 100_000_000e6);
            vm.prank(us[i]);
            usdg.approve(address(pm), type(uint256).max);
            vm.prank(us[i]);
            usdg.approve(address(src), type(uint256).max);
        }
    }

    function _roll() internal {
        blk += 1;
        vm.roll(blk);
    }

    // ── Zero-value exit (second pass, R3-INV-1 per-leg re-credit): nothing to deliver ⇒ every share returned ──────
    //    Fuzzer's shrunk sequence on the 10-bps FEE source (A4, seed 0x6012…): deposit(bob, 16,384) · withdraw(bob,
    //    16,383) — the fee-net reserve is 16,368 (16,384 − ⌊16.384⌋), the 16,382 offset claim is capped there and
    //    paid in full (all 16,383 burned) and the source is now EMPTY (16 raw of retained fee sit in its virtual
    //    share) · withdraw(bob, 1): the last share is worth 0, `fromIdle == 0`, nothing is unstaged, and the fixed
    //    source hands the share back instead of burning it against a zero claim. Value-neutral (< 1 raw unit either
    //    way); the harness's "fully paid ⇒ nothing re-credited" detector had read it as an F1 phantom.

    function test_R3_zeroValueExit_nothingDelivered_allSharesReturned() public {
        src.setExitFeeBps(10);
        vm.prank(bob);
        pm.deposit(16_384);
        _roll();
        assertEq(staging.stagedAssets(), 16_368, "fee-net reserve");
        uint256 bQ = usdg.balanceOf(bob);
        vm.prank(bob);
        (uint256 q1,) = pm.withdraw(16_383);
        assertEq(q1, 16_368, "claim capped at the whole reserve and paid in full");
        assertEq(usdg.balanceOf(bob) - bQ, q1);
        assertEq(pm.sharesOf(bob), 1, "all 16,383 burned: fully paid, no re-credit");
        assertEq(staging.stagedAssets(), 0, "source empty");
        _roll();
        vm.prank(bob);
        (uint256 q2, uint256 p2) = pm.withdraw(1);
        assertEq(q2 + p2, 0, "nothing to deliver");
        assertEq(pm.sharesOf(bob), 1, "the zero-value share is returned, not burned against a zero claim");
        assertEq(pm.totalShares(), 1);
        assertEq(pm.totalNav(), 0);
    }

    // ── F1-a FIXED: the fuzzer's shrunk sequence (deposit; deposit; partial withdraw) with exact numbers ────────
    //    Pre-fix: q == S == 590,214,548 delivered, only 590,212,458 shares burned → 2,090 phantom shares re-credited,
    //    totalShares > NAV, bob's claim < 213,526,339,862.

    function test_R3_F1a_partialExit_burnsExactShares_reCreditsZero_FIXED() public {
        vm.prank(alice);
        pm.deposit(68_719_476_735); // carol in the fuzz run
        _roll();
        vm.prank(bob);
        pm.deposit(213_526_339_862);
        _roll();
        uint256 ts = pm.totalShares();
        assertEq(pm.totalNav(), ts, "price is exactly 1 - no yield, no fee, no rounding");

        uint256 S = 590_214_548;
        uint256 aliceBefore = usdg.balanceOf(alice);
        uint256 sharesBefore = pm.sharesOf(alice);
        uint256 tsBefore = ts;
        vm.prank(alice);
        (uint256 q, uint256 p) = pm.withdraw(S);

        // The whole entitlement was delivered: claimTotal = S·(idle+V)/(ts+V) = S at price 1, ONE offset.
        assertEq(q, S, "idle leg paid in full");
        assertEq(p, 0);
        assertEq(usdg.balanceOf(alice) - aliceBefore, S);
        // ...and EXACTLY S shares were burned — the phantom `lpEntitled = floor(S·V/(ts+V))` (= 2,091 pre-fix) is gone.
        uint256 burned = sharesBefore - pm.sharesOf(alice);
        assertEq(burned, S, "burned == shares withdrawn: zero re-credit on a fully-paid exit (F1-a FIXED)");
        assertEq(pm.totalShares(), tsBefore - S);
        // Par holds exactly: shares == NAV; bob (never acted) keeps his full claim.
        assertEq(pm.totalShares(), pm.totalNav(), "no unbacked shares - par intact");
        uint256 bobClaim = Math.mulDiv(pm.sharesOf(bob), pm.totalNav() + V, pm.totalShares() + V);
        assertEq(bobClaim, 213_526_339_862, "bob's claim untouched by alice's exit");
    }

    // ── F1-a economics FIXED: the deposit/withdraw cycle nets the attacker ≤ 0 (rounding goes to the pool) ─────
    //    Pre-fix: +$100.24 after 200 cycles ($0.50/cycle at f = 0.5), victim's claim 9,899.77 USDG.

    function test_R3_F1a_cycleDrain_attackerNetsNothing_FIXED() public {
        vm.prank(alice);
        pm.deposit(10_000e6); // victim: 10,000 USDG
        _roll();
        uint256 X = 10_000e6; // attacker matches (f = 0.5 → the pre-fix maximum of V·f·(1−f) per cycle)
        uint256 mBefore = usdg.balanceOf(mallory);
        uint256 cycles = 200;
        for (uint256 i; i < cycles; ++i) {
            vm.prank(mallory);
            pm.deposit(X);
            _roll();
            uint256 s = pm.sharesOf(mallory);
            vm.prank(mallory);
            pm.withdraw(s - 1); // never the last holder (alice remains) → never the clean-sweep branch
            _roll();
        }
        uint256 left = pm.sharesOf(mallory);
        vm.prank(mallory);
        pm.withdraw(left);
        int256 gain = int256(usdg.balanceOf(mallory)) - int256(mBefore);
        assertLe(gain, 0, "pure deposit/withdraw cycling can no longer extract value (F1-a FIXED)");
        // The victim never acted and is whole (any rounding the cycler lost accrued to the pool, i.e. to alice).
        uint256 aliceClaim = Math.mulDiv(pm.sharesOf(alice), pm.totalNav() + V, pm.totalShares() + V);
        assertGe(aliceClaim, 10_000e6, "victim keeps >= principal");
        assertGe(pm.totalNav(), pm.totalShares(), "par or better after 200 cycles");
        emit log_named_int("attacker P&L (raw USDG, 6dp) after 200 cycles", gain);
        emit log_named_uint("victim claim (raw USDG)", aliceClaim);
    }

    // ── F1-b FIXED: the SourceUnavailable refusal fires for EVERY size (no phantom liqToRemove to skip it) ──────
    //    Pre-fix: withdraw(15,091,932) during the outage "succeeded" with 0 delivered, 0 burned, and consumed the
    //    caller's per-block slot.

    function test_R3_F1b_sourceOutage_refusalFires_forAnySize_FIXED() public {
        vm.prank(alice);
        pm.deposit(2_000_000e6);
        _roll();
        src.setRevertPreview(true);
        assertFalse(pm.sourceReadable());

        vm.prank(alice);
        vm.expectRevert(MintwareLpGatewayPositionManager.SourceUnavailable.selector);
        pm.withdraw(1);

        uint256 S = 15_091_932; // the fuzzer's value — pre-fix liqToRemove = floor(S·V/(ts+V)) = 7 skipped the guard
        assertGt(Math.mulDiv(S, V, pm.totalShares() + V), 0, "the size that bypassed the refusal pre-fix");
        uint256 before = usdg.balanceOf(alice);
        uint256 sharesBefore = pm.sharesOf(alice);
        vm.prank(alice);
        vm.expectRevert(MintwareLpGatewayPositionManager.SourceUnavailable.selector);
        pm.withdraw(S); // scope inv. 9: nothing to deliver → refuse, state untouched
        assertEq(usdg.balanceOf(alice), before);
        assertEq(pm.sharesOf(alice), sharesBefore);

        // A refusal, not a brick: once the source answers again the SAME withdraw (same block — the reverted attempt
        // did not consume the per-block slot) delivers in full.
        src.setRevertPreview(false);
        vm.prank(alice);
        (uint256 q, uint256 p) = pm.withdraw(S);
        assertEq(q, S, "delivered in full once readable (price 1)");
        assertEq(p, 0);
        assertEq(pm.sharesOf(alice), sharesBefore - S, "exactly S burned");
    }

    // ── F2 FIXED: empty offset-0 source + donation → the zero-source-share stage is REFUSED (StageShortfall) ─────
    //    Pre-fix: alice's 1.31M USDG deposit minted 0 source shares, PM NAV stayed 0, mallory's next deposit was
    //    priced at ~0 and alice kept < 0.1 % of her principal.

    function test_R3_F2_emptySourceDonation_zeroShareStageRefused_StageShortfall_FIXED() public {
        uint256 D = 2_278_727_784_463; // the fuzzer's donation (~2.28M USDG) into the EMPTY source
        vm.prank(mallory);
        src.simulateYield(D);
        assertEq(src.totalSupply(), 0);

        uint256 A = 1_312_889_136_061; // 1.31M USDG, less than the donation → floor(A·1/(D+1)) = 0 source shares
        assertEq(src.previewDeposit(A), 0, "the stage would mint ZERO source shares");
        uint256 aBefore = usdg.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(MintwareLpGatewayPositionManager.StageShortfall.selector);
        pm.deposit(A);
        assertEq(usdg.balanceOf(alice), aBefore, "alice keeps her funds");
        assertEq(pm.totalShares(), 0, "no PM shares minted against a zero-growth reserve");
        assertEq(src.totalSupply(), 0, "source untouched");
        _roll();

        // The whole griefing window is closed: EVERY A ≤ D is refused (m = 0 → the reserve does not grow at all).
        vm.prank(bob);
        vm.expectRevert(MintwareLpGatewayPositionManager.StageShortfall.selector);
        pm.deposit(D);
        _roll();

        // What passes: a deposit whose source-rounding loss r/(m+1) (A = m·(D+1) + r) is within 50 bps. Worst-case
        // remainder r = D needs m·(m+1) ≥ 200 ⇒ m ≥ 14. Take m = 20, r = D: loss = D/21 ≈ 0.48 % < 0.5 %.
        uint256 big = 20 * (D + 1) + D;
        vm.prank(alice);
        uint256 shares = pm.deposit(big);
        assertGt(src.balanceOf(address(adapter)), 0, "source shares minted");
        assertEq(shares, big, "PM mints 1:1 at NAV 0 (first depositor)");
        uint256 reserve = staging.stagedAssets();
        assertGe(reserve, big - (big * pm.STAGE_TOLERANCE_BPS()) / 10_000, "reserve grew within tolerance");
        // The depositor's loss is EXACTLY r/(m+1) = D/21 (the OZ +1 virtual share owns 1/(m+1) of the pool, i.e. the
        // whole donation plus this remainder) - bounded by the 50 bps gate. The donation itself is STRANDED in the
        // source's virtual share: griefing costs the griefer D to inflict D/21 (< 0.5 %) on the first depositor.
        uint256 loss = big - reserve;
        assertApproxEqAbs(loss, D / 21, 2, "loss == r/(m+1) with r = D, m = 20");
        assertLe(loss, (big * pm.STAGE_TOLERANCE_BPS()) / 10_000, "within the XR-3 gate");
        emit log_named_uint("first passing deposit (raw USDG)", big);
        emit log_named_uint("reserve after (raw USDG)", reserve);
        emit log_named_uint("rounding loss on that deposit (raw USDG) = D/21", loss);
        emit log_named_uint("griefer's stranded donation (raw USDG)", D);
    }

    // ── F3 (informational, unchanged): adapter over-delivers up to (source price − 1) raw units per unstage ─────
    //    `previewWithdraw` rounds source shares UP, `redeem` pays floor(shares·price): delivered ≥ want by < 1 source
    //    share. Nil for an 18-dp-share source (Morpho), up to price−1 raw units for an offset-0 source with yield.
    //    Still true on the fixed source; ACCEPTED (wei-level, bounded by one source share).

    function test_R3_F3_adapterCeilSharesOverDelivery_boundedByOneSourceShare() public {
        vm.prank(alice);
        pm.deposit(1_000e6);
        vm.prank(mallory);
        src.simulateYield(3_000e6); // source price = 4 (offset 0)
        _roll();
        vm.prank(bob);
        pm.deposit(1_000e6);
        _roll();
        // bob withdraws a slice; entitlement at PM price (~4 quote per PM share now).
        uint256 S = pm.sharesOf(bob) / 3;
        uint256 ts = pm.totalShares();
        uint256 idle = staging.stagedAssets();
        uint256 entitled = Math.mulDiv(S, idle + V, ts + V);
        uint256 srcPrice = Math.ceilDiv(src.totalAssets() + 1, src.totalSupply() + 1);
        vm.prank(bob);
        (uint256 q,) = pm.withdraw(S);
        assertGe(q, entitled, "never under-delivers on a liquid source");
        assertLt(q, entitled + srcPrice, "over-delivery < one source share (F3 bound)");
    }
}
