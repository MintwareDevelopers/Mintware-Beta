// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}  from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}       from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}      from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}     from "@uniswap/v4-core/src/types/Currency.sol";

import {Ownable}                 from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20}                  from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MintwareTreasuryVault}   from "../../src/payments/MintwareTreasuryVault.sol";
import {MWTimelockedRiskParams}  from "../../src/lib/MWTimelockedRiskParams.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";

/// @dev Minimal borrow-seam stand-in (borrow → return → settle in one call) so the breaker path can be
///      driven directly. Mirrors `MintwareTreasuryVaultJit.t.sol`'s MockJitHook.
contract MockJit {
    MintwareTreasuryVault public vault;
    IERC20 public usdc;
    constructor(MintwareTreasuryVault v, IERC20 u) { vault = v; usdc = u; }
    function round(uint256 want, uint256 ret) external returns (uint256 lent) {
        lent = vault.borrowIdleForJit(want);
        usdc.transfer(address(vault), ret);
        vault.settleJitReturn(ret);
    }
}

/// @title  MWTimelockedRiskParams — governance-rail tests (legal 48h timelock on vault risk parameters)
/// @notice Proves the bounded, 48h-timelocked, disclosed change process on `MintwareTreasuryVault` (the
///         richest risk-param surface): first-set-immediate before activation, propose→wait→confirm,
///         out-of-bounds rejection at propose time, cancel, unauthorized reverts, tightening-is-instant,
///         and — critically — that the guardian pause and the automatic JIT loss-breaker stay INSTANT
///         (never routed through the timelock). Settlement + hook variants live in their own suites.
contract MWTimelockedRiskParamsTest is Test {
    MockERC20             internal usdc;
    MockERC20             internal team;
    PoolManager           internal pm;

    address internal owner    = makeAddr("owner");
    address internal teamAddr  = makeAddr("team");
    address internal guardian  = makeAddr("guardian");
    address internal stranger  = makeAddr("stranger");
    address internal user      = makeAddr("user");

    uint256 internal constant ONE = 1e6;
    uint256 internal constant DELAY = 48 hours;

    function setUp() public {
        pm   = new PoolManager(address(this));
        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Team Token", "TEAM", 6);
    }

    function _key() internal view returns (PoolKey memory) {
        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        return PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
    }

    /// @dev Fresh vault (owner = `owner`). `commit == false` leaves it PRE-ACTIVATION (first-set window).
    function _vault(bool commit) internal returns (MintwareTreasuryVault v, MockYieldAdapter a) {
        a = new MockYieldAdapter(address(usdc));
        v = new MintwareTreasuryVault(address(pm), _key(), address(usdc), address(a), owner, teamAddr);
        if (!commit) return (v, a);

        team.mint(teamAddr, 1_000_000 * ONE);
        usdc.mint(teamAddr, 5_000 * ONE);
        vm.startPrank(teamAddr);
        team.approve(address(v), type(uint256).max);
        usdc.approve(address(v), type(uint256).max);
        v.commitTeam(1_000_000 * ONE, 5_000 * ONE, 365 days);
        vm.stopPrank();

        usdc.mint(user, 10_000 * ONE);
        vm.startPrank(user);
        usdc.approve(address(v), type(uint256).max);
        v.depositUSDC(10_000 * ONE, 0, user);
        vm.stopPrank();
    }

    // ── first-set-immediate: before activation, EVERY change applies instantly (both directions) ─────
    function test_first_set_immediate_before_activation() public {
        (MintwareTreasuryVault v,) = _vault(false);
        assertFalse(v.activated(), "precondition: not activated");
        vm.startPrank(owner);
        // A risk-INCREASING change (raise JIT cap) would be timelocked post-activation — instant here.
        v.setJitCap(1_500);
        assertEq(v.jitMaxPerBlockBps(), 1_500, "pre-activation set must be instant");
        // Lowering the idle target (risk-increasing) is likewise instant pre-activation.
        v.setIdleBufferTarget(5_000);
        assertEq(v.idleBufferTargetBps(), 5_000, "pre-activation idle set must be instant");
        // Nothing was scheduled.
        (,, uint256 eta) = v.pendingRiskParam(v.RP_JIT_CAP());
        assertEq(eta, 0, "no timelock should be scheduled pre-activation");
        vm.stopPrank();
    }

    // ── propose → wait 48h → confirm (risk-INCREASING change is delayed + disclosed) ─────────────────
    function test_propose_wait_confirm_happy_path() public {
        (MintwareTreasuryVault v,) = _vault(true);
        bytes32 id = v.RP_JIT_CAP();
        uint256 eta = block.timestamp + DELAY;

        vm.expectEmit(true, false, false, true, address(v));
        emit MWTimelockedRiskParams.RiskParamProposed(id, 500, 1_500, 0, eta); // raise 500 -> 1500 (loosen)
        vm.prank(owner);
        v.setJitCap(1_500);

        // Not applied yet; a pending change is recorded.
        assertEq(v.jitMaxPerBlockBps(), 500, "loosening applied before delay");
        (uint256 pv,, uint256 peta) = v.pendingRiskParam(id);
        assertEq(pv, 1_500, "pending value");
        assertEq(peta, eta, "pending eta");

        // Early confirm reverts.
        vm.prank(owner);
        vm.expectRevert(MWTimelockedRiskParams.RiskParamDelayNotElapsed.selector);
        v.confirmRiskParam(id);

        // After 48h, confirm applies + discloses.
        vm.warp(eta + 1);
        vm.expectEmit(true, false, false, true, address(v));
        emit MWTimelockedRiskParams.RiskParamConfirmed(id, 500, 1_500, 0);
        vm.prank(owner);
        v.confirmRiskParam(id);
        assertEq(v.jitMaxPerBlockBps(), 1_500, "confirmed value not applied");
        (,, uint256 cleared) = v.pendingRiskParam(id);
        assertEq(cleared, 0, "pending not cleared after confirm");
    }

    // ── tightening for safety is INSTANT (never delayed) ─────────────────────────────────────────────
    function test_tightening_is_instant() public {
        (MintwareTreasuryVault v,) = _vault(true);
        vm.startPrank(owner);
        // Lower the JIT cap (safety) — instant.
        v.setJitCap(100);
        assertEq(v.jitMaxPerBlockBps(), 100, "tightening JIT cap must be instant");
        // Raise the idle-buffer target (safety) — instant.
        v.setIdleBufferTarget(9_000);
        assertEq(v.idleBufferTargetBps(), 9_000, "raising idle target must be instant");
        // Enable/raise the coverage floor (safety) — instant.
        v.setMinCoverage(2_000);
        assertEq(v.minCoverageBps(), 2_000, "raising coverage floor must be instant");
        // Arm the burn-rate cap from OFF (tightening) — instant; then LOWER it (tighter) — instant.
        v.setMaxBurnPerBlock(1_000 * ONE);
        assertEq(v.maxBurnPerBlock(), 1_000 * ONE, "arming burn cap must be instant");
        v.setMaxBurnPerBlock(500 * ONE);
        assertEq(v.maxBurnPerBlock(), 500 * ONE, "lowering burn cap must be instant");
        vm.stopPrank();
    }

    // ── loosening the "0==off" caps (raise or disable) is timelocked ─────────────────────────────────
    function test_loosening_off_caps_is_timelocked() public {
        (MintwareTreasuryVault v,) = _vault(true);
        vm.startPrank(owner);
        v.setMaxBurnPerBlock(1_000 * ONE); // arm (instant)
        // Raise the cap = loosen → timelocked.
        v.setMaxBurnPerBlock(5_000 * ONE);
        assertEq(v.maxBurnPerBlock(), 1_000 * ONE, "raise must not apply before delay");
        // Disable (→0) = loosen → also timelocked (re-propose overwrites the pending change).
        v.setMaxBurnPerBlock(0);
        (uint256 pv,,) = v.pendingRiskParam(v.RP_MAX_BURN_PER_BLOCK());
        assertEq(pv, 0, "re-propose should overwrite the pending value");
        vm.warp(block.timestamp + DELAY + 1);
        v.confirmRiskParam(v.RP_MAX_BURN_PER_BLOCK());
        assertEq(v.maxBurnPerBlock(), 0, "disable should apply after confirm");
        vm.stopPrank();
    }

    // ── out-of-bounds values are rejected at PROPOSE time (can't even be scheduled) ──────────────────
    function test_out_of_bounds_rejected_at_propose() public {
        (MintwareTreasuryVault v,) = _vault(true);
        vm.startPrank(owner);
        vm.expectRevert(MintwareTreasuryVault.BadParam.selector);
        v.setJitCap(2_001); // > MAX_JIT_PER_BLOCK_BPS (2000)
        vm.expectRevert(MintwareTreasuryVault.BadParam.selector);
        v.setIdleBufferTarget(4_999); // < MIN_IDLE_TARGET_BPS
        vm.stopPrank();
    }

    // MAX_MIN_COVERAGE_BPS is 50_000 (fits uint16); 50_001 is over-range and rejected at propose time.
    function test_min_coverage_bound() public {
        (MintwareTreasuryVault v,) = _vault(true);
        vm.startPrank(owner);
        vm.expectRevert(MintwareTreasuryVault.BadParam.selector);
        v.setMinCoverage(50_001); // > MAX_MIN_COVERAGE_BPS
        v.setMinCoverage(50_000); // exactly the bound is OK (tightening from 0 → instant)
        assertEq(v.minCoverageBps(), 50_000);
        vm.stopPrank();
    }

    // ── cancel a pending change ──────────────────────────────────────────────────────────────────────
    function test_cancel_pending() public {
        (MintwareTreasuryVault v,) = _vault(true);
        bytes32 id = v.RP_JIT_CAP();
        vm.startPrank(owner);
        v.setJitCap(1_500); // schedule (loosen)
        (,, uint256 eta) = v.pendingRiskParam(id);
        assertGt(eta, 0, "not scheduled");

        vm.expectEmit(true, false, false, true, address(v));
        emit MWTimelockedRiskParams.RiskParamCancelled(id, 1_500, 0);
        v.cancelRiskParam(id);

        (,, uint256 clr) = v.pendingRiskParam(id);
        assertEq(clr, 0, "pending not cleared on cancel");
        assertEq(v.jitMaxPerBlockBps(), 500, "cancel must not change the live value");

        // Confirming a cancelled (nonexistent) change reverts.
        vm.warp(block.timestamp + DELAY + 1);
        vm.expectRevert(MWTimelockedRiskParams.NoRiskParamPending.selector);
        v.confirmRiskParam(id);
        vm.stopPrank();
    }

    // ── unauthorized: only the owner can propose / confirm / cancel ──────────────────────────────────
    function test_unauthorized_reverts() public {
        (MintwareTreasuryVault v,) = _vault(true);
        bytes32 id = v.RP_JIT_CAP();

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        v.setJitCap(100);

        vm.prank(owner);
        v.setJitCap(1_500); // schedule

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        v.confirmRiskParam(id);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        v.cancelRiskParam(id);
    }

    // ── EMERGENCY SAFETY STAYS INSTANT: guardian pause is never routed through the timelock ──────────
    function test_guardian_pause_stays_instant() public {
        (MintwareTreasuryVault v,) = _vault(true);
        vm.prank(owner);
        v.setGuardian(guardian);
        // Guardian fast-pauses instantly — no 48h, no proposal.
        vm.prank(guardian);
        v.pause();
        assertTrue(v.paused(), "guardian pause did not take effect instantly");
    }

    // ── EMERGENCY SAFETY STAYS INSTANT: the automatic JIT loss-breaker trips without any delay ───────
    function test_jit_breaker_trips_instantly() public {
        (MintwareTreasuryVault v,) = _vault(true);
        MockJit jit = new MockJit(v, IERC20(address(usdc)));
        vm.prank(owner);
        v.setJitHook(address(jit));

        // Arm the breaker threshold — enabling it from OFF is a tightening → instant.
        vm.prank(owner);
        v.setJitMaxCumulativeLoss(1);
        assertEq(v.jitMaxCumulativeLoss(), 1, "arming the breaker must be instant");

        // A single lossy JIT round trips the breaker in the SAME call — no timelock on the breaker firing.
        jit.round(500 * ONE, 495 * ONE); // lend 500, return 495 → -5 realized loss
        assertTrue(v.jitAutoDisabled(), "breaker did not trip instantly on cumulative loss");
    }
}
