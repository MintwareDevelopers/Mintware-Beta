// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}           from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {MintwareTreasuryVault} from "../../src/payments/MintwareTreasuryVault.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {MockReadyOracle}  from "../mocks/MockReadyOracle.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @title  Red-team PoCs — tranche invariant (A), first-depositor inflation (B), recall-liveness (C)
/// @notice Adversarial harness for the three theses. Each test is written to DEMONSTRATE the actual
///         behavior; the pass/fail assertions encode the CONFIRMED/REFUTED verdict. Modeled on the
///         existing `MintwareTreasuryVault.t.sol` harness (isolated PoolManager + real V4 swaps).
contract RedTeamTrancheInflationRecall is Test {
    MockERC20 internal usdc; // 6dp senior asset
    MockERC20 internal team; // 6dp junior asset

    struct Stack {
        PoolManager             pm;
        TestSwapRouter          sr;
        PoolModifyLiquidityTest lr;
        MintwareTreasuryVault   v;
        MockYieldAdapter        a;
        PoolKey                 key;
        bool                    teamIs0;
    }

    address internal owner    = makeAddr("owner");
    address internal teamAddr = makeAddr("team");
    address internal gateway  = makeAddr("gateway");
    address internal receiver = makeAddr("cardRail");
    address internal protocol = makeAddr("protocol");
    address internal alice    = makeAddr("alice");
    address internal attacker = makeAddr("attacker");
    address internal victim   = makeAddr("victim");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant ONE_USDC = 1e6;
    uint256 internal constant LOCK_DUR = 365 days;
    uint256 internal constant TEAM_COMMIT = 5_000_000 * 1e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Team Token", "TEAM", 6);
    }

    // ── harness ───────────────────────────────────────────────────────────────────

    function _spawn(uint256 juniorUsdc, int256 baselineLiq) internal returns (Stack memory s) {
        s.pm = new PoolManager(address(this));
        s.sr = new TestSwapRouter(IPoolManager(address(s.pm)));
        s.lr = new PoolModifyLiquidityTest(IPoolManager(address(s.pm)));

        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        s.key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        s.teamIs0 = address(team) < address(usdc);
        s.pm.initialize(s.key, INIT_SQRT_PRICE);

        s.a = new MockYieldAdapter(address(usdc));
        s.v = new MintwareTreasuryVault(address(s.pm), s.key, address(usdc), address(s.a), owner, teamAddr);

        vm.startPrank(owner);
        s.v.setGateway(gateway);
        s.v.setProtocolTreasury(protocol);
        // FIX 2a: `deployToLP` now requires a ready oracle. Wire a minimal ready-oracle stand-in so the
        // coverage-floor tests below exercise the FIX-3 gate (not the oracle gate). Unused by the no-deploy
        // theses (B donation, C recall). Set-once; reads the live tick (⇒ valuation == pure spot, unchanged).
        s.v.setJitHook(address(new MockReadyOracle(IPoolManager(address(s.pm)), s.key)));
        vm.stopPrank();

        team.mint(teamAddr, TEAM_COMMIT);
        if (juniorUsdc > 0) usdc.mint(teamAddr, juniorUsdc);
        vm.startPrank(teamAddr);
        team.approve(address(s.v), type(uint256).max);
        usdc.approve(address(s.v), type(uint256).max);
        s.v.commitTeam(TEAM_COMMIT, juniorUsdc, LOCK_DUR);
        vm.stopPrank();

        if (baselineLiq > 0) {
            usdc.mint(address(this), 100_000_000 * ONE_USDC);
            team.mint(address(this), 100_000_000 * ONE_USDC);
            usdc.approve(address(s.lr), type(uint256).max);
            team.approve(address(s.lr), type(uint256).max);
            int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
            int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
            s.lr.modifyLiquidity(
                s.key,
                ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: baselineLiq, salt: bytes32(0)}),
                ""
            );
        }
    }

    function _deposit(Stack memory s, address who, uint256 amt) internal returns (uint256 shares) {
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(s.v), type(uint256).max);
        shares = s.v.depositUSDC(amt, 0, who);
        vm.stopPrank();
    }

    /// @dev Crash the team token by dumping a large team→USDC swap through the pool (pushes team price down,
    ///      which collapses `recoverableUSDC()` of the vault's own team-heavy LP leg).
    function _crashTeam(Stack memory s, uint256 teamIn) internal {
        team.mint(address(this), teamIn);
        team.approve(address(s.sr), type(uint256).max);
        // sell team: zeroForOne == teamIs0
        s.sr.swap(s.key, s.teamIs0, teamIn);
    }

    // ════════════════════════════════════════════════════════════════════════════════
    // THESIS B — first-depositor share-inflation (donation) attack → REFUTED
    // ════════════════════════════════════════════════════════════════════════════════

    /// @notice Classic 4626 first-depositor + donation attack against a FRESH isolated vault. Attacker mints
    ///         1 share for 1 unit, then donates a large USDC slug directly to the vault to inflate share price,
    ///         hoping the victim's real deposit rounds to 0 shares (attacker then redeems everything). The
    ///         symmetric virtual offset (`VIRTUAL = 1e6`) must neutralize it: the victim gets fair shares and
    ///         can redeem ~their deposit; the attacker cannot profit.
    function test_B_firstDepositorDonation_REFUTED() public {
        Stack memory s = _spawn(0, 2_000_000 * int256(ONE_USDC));

        // 1) attacker seeds 1 unit → 1 share (nav before = 0, VIRTUAL makes it 1:1).
        uint256 aShares = _deposit(s, attacker, 1);
        assertEq(aShares, 1, "attacker first-deposit shares");

        // 2) attacker DONATES $1,000,000 straight to the vault (raw transfer → lifts free senior buffer).
        uint256 donation = 1_000_000 * ONE_USDC;
        usdc.mint(attacker, donation);
        vm.prank(attacker);
        usdc.transfer(address(s.v), donation);

        // 3) victim deposits $10,000. If the offset failed, this would round to 0 shares.
        uint256 vDeposit = 10_000 * ONE_USDC;
        uint256 vShares = _deposit(s, victim, vDeposit);
        assertGt(vShares, 0, "victim must receive non-zero shares (offset holds)");

        // 4) victim redeems: must recover ~their deposit (not be robbed by the donation).
        vm.prank(victim);
        uint256 out = s.v.redeemSenior(vShares, 0);

        // Victim keeps essentially all of their principal (>= 99.9%; only virtual-offset dust is lost).
        assertGe(out, (vDeposit * 999) / 1000, "victim redemption must be >= 99.9% of deposit");

        // Attacker's economic position: they sank `1 + donation` and hold 1 share. Redeeming it cannot
        // recover the donation — the donation was shared with the virtual offset + the victim's stake.
        vm.prank(attacker);
        uint256 aOut = s.v.redeemSenior(aShares, 0);
        uint256 attackerSpent = 1 + donation;
        assertLt(aOut, attackerSpent, "attacker cannot profit from the donation");
        // The attack is not merely unprofitable — it is a massive self-inflicted loss.
        assertLt(aOut, donation / 100, "attacker recovers <1% of what they sank: attack irrational");

        emit log_named_uint("victim deposit     ", vDeposit);
        emit log_named_uint("victim redeemed    ", out);
        emit log_named_uint("attacker sank      ", attackerSpent);
        emit log_named_uint("attacker recovered ", aOut);
    }

    // ════════════════════════════════════════════════════════════════════════════════
    // THESIS A — coverage floor default-0 lets senior be deployed with ZERO USDC cushion
    // ════════════════════════════════════════════════════════════════════════════════

    /// @notice With the SHIPPED default (`minCoverageBps == 0`), `deployToLP` puts senior USDC into the
    ///         IL-bearing LP with the junior USDC first-loss buffer at ZERO — `_coverageOkAfter` short-circuits
    ///         to `true` and never blocks it. A subsequent team-token crash then imposes a REAL senior
    ///         principal haircut. The planned floor (10_000 / 18_000) would have blocked the deploy entirely.
    ///         Severity: low/config, but silent (no revert, `coverageBps()==0`), so worth flagging.
    function test_A_coverageFloorOff_uncushionedSeniorDeploy_BLOCKED() public {
        Stack memory s = _spawn(0, 2_000_000 * int256(ONE_USDC)); // juniorUsdc = 0 (no USDC first-loss)
        _deposit(s, alice, 100_000 * ONE_USDC);

        // Default posture: floor is OFF (shipped default). A ready oracle is wired (see _spawn), so the
        // ONLY thing standing between the attacker and an uncushioned deploy is the FIX-3 coverage gate.
        assertEq(s.v.minCoverageBps(), 0, "shipped default coverage floor is 0 (OFF)");

        // FIX 3: deploying senior into the IL-bearing LP with the coverage floor OFF now reverts. The
        // uncushioned-senior-deploy (which a later team crash would have haircut) is structurally refused.
        vm.prank(owner);
        vm.expectRevert(MintwareTreasuryVault.CoverageFloorUnset.selector);
        s.v.deployToLP(20_000 * ONE_USDC, TEAM_COMMIT);

        // Nothing was exposed: senior stays fully idle/par, immune to a subsequent team crash.
        assertEq(s.v.deployedFromSenior(), 0, "BLOCKED: no senior exposed to the LP");
        _crashTeam(s, 40_000_000 * ONE_USDC);
        uint256 aliceShares = s.v.seniorShares(alice);
        vm.prank(alice);
        uint256 out = s.v.redeemSenior(aliceShares, 0);
        emit log_named_uint("senior redeemed (idle, post-crash)", out);
        assertGe(out, 100_000 * ONE_USDC - 2, "senior redeems ~par: no LP exposure, so the crash is inert");
    }

    /// @notice Counterpart: once the operator ENABLES the planned floor, the SAME uncushioned deploy is
    ///         blocked. Confirms the guard is real when set — the finding is the default, not a broken guard.
    function test_A_coverageFloorOn_blocksUncushionedDeploy_ENFORCED() public {
        Stack memory s = _spawn(0, 2_000_000 * int256(ONE_USDC)); // juniorUsdc = 0
        _deposit(s, alice, 100_000 * ONE_USDC);

        // Raising the floor 0 -> 10_000 is a safety-tightening => applies INSTANTLY (no timelock).
        vm.prank(owner);
        s.v.setMinCoverage(10_000);
        assertEq(s.v.minCoverageBps(), 10_000, "floor enabled at par (100%)");

        // Same deploy now reverts CoverageTooLow (junior USDC buffer = 0 cannot cover any deploy).
        vm.prank(owner);
        vm.expectRevert(MintwareTreasuryVault.CoverageTooLow.selector);
        s.v.deployToLP(20_000 * ONE_USDC, TEAM_COMMIT);
    }

    // ════════════════════════════════════════════════════════════════════════════════
    // THESIS C — recall-liveness: no on-chain always-liquid hot-buffer floor
    // ════════════════════════════════════════════════════════════════════════════════

    /// @notice Deposits are immediately swept into the yield adapter (`_supplyToAdapter`), and there is NO
    ///         on-chain always-liquid reserve independent of the adapter/LP. If the adapter goes fully
    ///         illiquid (utilization spike / malicious child venue) while nothing is deployed to the LP, a
    ///         full-or-revert card settle (`burnForPayment`) BRICKS even though `totalSeniorAssets` shows the
    ///         funds. `idleBuffer()` correctly reads ~0. It is a LIVENESS (temporary) DoS, not a permanent
    ///         strand: once adapter liquidity returns, settle/redeem succeed. CONFIRMED (liveness, low sev).
    function test_C_hotBuffer_survivesAdapterFreeze_FIX4() public {
        // ── Gate OFF (shipped default, hotBufferBps == 0): the finding — a total adapter freeze BRICKS a
        //    bounded card settle even though `totalSeniorAssets` shows the funds (everything was swept to the
        //    now-frozen adapter; no always-liquid on-vault reserve). This is the CONFIRMED behavior. ─────────
        Stack memory off = _spawn(0, 2_000_000 * int256(ONE_USDC));
        assertEq(off.v.hotBufferBps(), 0, "hot buffer off by default");
        _deposit(off, alice, 100_000 * ONE_USDC);
        off.a.setWithdrawableCap(0); // adapter fully illiquid (Aave utilization spike / withholding venue)
        assertEq(off.v.idleBuffer(), 0, "gate OFF: idleBuffer starves - no reserve independent of the adapter");
        uint256 sharesOff = off.v.previewWithdraw(100 * ONE_USDC);
        vm.prank(gateway);
        vm.expectRevert(MintwareTreasuryVault.InsufficientIdleLiquidity.selector);
        off.v.burnForPayment(alice, sharesOff, receiver);

        // ── FIX 4 (hotBufferBps armed): a small always-liquid reserve stays UN-swept on the vault, so a
        //    BOUNDED card settle SURVIVES the SAME total adapter freeze. ─────────────────────────────────────
        Stack memory on = _spawn(0, 2_000_000 * int256(ONE_USDC));
        vm.prank(owner);
        on.v.setHotBufferBps(500); // 5% always-liquid reserve — set BEFORE deposits so the sweep withholds it
        _deposit(on, alice, 100_000 * ONE_USDC);
        // ~5% ($5k) stays on-hand un-swept; the rest idles in the adapter (so idleBuffer is ~$100k for now).

        // Freeze the adapter totally. The hot buffer is INDEPENDENT of the adapter, so idleBuffer stays ~$5k
        // (the always-liquid reserve) instead of collapsing to 0 as in the gate-OFF stack above.
        on.a.setWithdrawableCap(0);
        assertApproxEqAbs(on.v.idleBuffer(), 5_000 * ONE_USDC, 10 * ONE_USDC, "FIX 4: ~5% reserve survives the freeze");

        // A bounded ($100) card settle now SUCCEEDS off the hot buffer despite the frozen adapter (was a brick).
        uint256 sharesOn = on.v.previewWithdraw(100 * ONE_USDC);
        uint256 rcvBefore = usdc.balanceOf(receiver);
        vm.prank(gateway);
        uint256 paid = on.v.burnForPayment(alice, sharesOn, receiver);
        assertGe(paid, 100 * ONE_USDC - 2, "FIX 4: bounded settle survives total adapter freeze via the hot buffer");
        assertGe(usdc.balanceOf(receiver) - rcvBefore, 100 * ONE_USDC - 2, "receiver paid from the hot buffer");
    }
}
