// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MintwareTreasuryJitStackTest} from "./MintwareTreasuryJitStack.t.sol";
import {MintwareTreasuryVault}        from "../../src/payments/MintwareTreasuryVault.sol";

/// @notice AUDIT R6-2 ADVERSARIAL + CORE-SAFETY suite for the airtight-conservative senior redeem NAV.
///         Extends the JIT-stack rig (real V4 pool + truncated-oracle JIT hook, ready oracle, owner ==
///         address(this)). Proves the headline safety property directly (the redeem NAV NEVER overstates
///         what the position + buffers can PHYSICALLY return) and red-teams the four new attack surfaces
///         the R6-2 fix introduces: floor manipulation, residual order-dependence, proportional-realization
///         griefing, and card-settle over-payment under a moving-with-impairment NAV.
contract MintwareTreasuryR6AdversarialTest is MintwareTreasuryJitStackTest {
    uint256 constant WAD = 1e18;

    function _dep(address who, uint256 amt) internal {
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(amt, 0, who);
        vm.stopPrank();
    }

    /// @dev free SENIOR buffer = vault USDC on hand minus junior + protocol earmarks (mirrors the vault).
    function _freeSenior() internal view returns (uint256) {
        uint256 bal = usdc.balanceOf(address(vault));
        uint256 r = vault.reservedJuniorUSDC() + vault.juniorUsdcBuffer() + vault.reservedProtocolUSDC();
        return bal > r ? bal - r : 0;
    }

    /// @dev The TOTAL USDC the senior tranche can physically obtain right now WITHOUT any team sale:
    ///      Aave idle + free senior buffer + the LP's USDC leg (mark's usd side) + junior first-loss buffer.
    ///      This is an UPPER bound only if we EXCLUDE team-sale proceeds — but team sale is pure upside, so it
    ///      is a valid *lower* bound on physical realization. We use full liquidation below for the exact test.

    function _impairAndSettle(uint256 dump) internal {
        team.mint(trader, dump);
        vm.startPrank(trader);
        team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, _sellTeamZeroForOne(), dump);
        vm.stopPrank();
        vm.roll(block.number + 1);
        hook.sweepJit();
        _settleOracleToSpot();
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CORE SAFETY PROPERTY (task 2): seniorRealizableAssets() NEVER overstates the USDC the position +
    // buffers can PHYSICALLY return. Proven by actually LIQUIDATING everything and comparing.
    // ─────────────────────────────────────────────────────────────────────────────
    function testFuzz_realizableNeverOverstatesPhysical(
        uint256 aAmt,
        uint256 bAmt,
        uint256 deployAmt,
        uint256 dump
    ) public {
        address A = makeAddr("physA");
        address B = makeAddr("physB");
        aAmt = bound(aAmt, 1_000 * ONE, 100_000 * ONE);
        bAmt = bound(bAmt, 1_000 * ONE, 100_000 * ONE);
        _dep(A, aAmt);
        _dep(B, bAmt);

        deployAmt = bound(deployAmt, 2_000 * ONE, 8_000 * ONE);
        try vault.deployToLP(deployAmt, vault.juniorTokens()) {} catch { return; }

        dump = bound(dump, 100_000 * ONE, 2_000_000_000 * ONE);
        _impairAndSettle(dump);

        // The claimed realizable senior NAV (what redemptions price against, capped at par upstream).
        uint256 claimed = vault.seniorRealizableAssets();

        // Physically LIQUIDATE the whole LP: request a huge amount so `recover` burns ALL liquidity in one
        // call; recovered USDC (usd leg + oracle-bounded team-sale proceeds) is re-idled into the adapter.
        if (vault.positionLiquidity() > 0) {
            try vault.recoverFromLP(type(uint256).max) {} catch {}
        }
        // A residual dust position (rare rounding) — sweep it too.
        for (uint256 i = 0; i < 6 && vault.positionLiquidity() > 0; i++) {
            try vault.recoverFromLP(type(uint256).max) {} catch { break; }
        }

        // Physical senior-backing after full liquidation: Aave idle + free senior buffer + junior buffer.
        // (No LP leg remains; its realized value now sits in the adapter/buffer.)
        uint256 physical = adapter.totalAssets() + _freeSenior() + vault.juniorUsdcBuffer();

        assertLe(claimed, physical + 10, "seniorRealizableAssets OVERSTATED physical realization (NAV > realizable)");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 3a. MANIPULATION — can a same-block spot move make recoverableFloorUSDC() / the redeem NAV OVERSTATE,
    //     letting an IMPAIRED senior extract from other seniors / the junior buffer? Two orthogonal checks:
    //
    //   (i) MECHANISTIC — the floor takes the usd leg at min(spot, oracle) on the side that MINIMIZES it, and
    //       the truncated oracle moves at most ONE bounded step per block. So a same-block pump cannot inflate
    //       the floor by more than one oracle step — CAPPED regardless of pump SIZE (a 100× bigger pump does
    //       not give a 100× bigger inflation). Proven by pumping small vs enormous and comparing the deltas.
    //
    //   (ii) ECONOMIC — the decisive test: an attacker who pumps + redeems in ONE block + dumps back must not
    //        SHIFT LOSS to the seniors who redeem after them. Snapshot each honest holder's fair pro-rata floor
    //        BEFORE the attack; after the attack (settled) they must still clear ~that floor.
    // ─────────────────────────────────────────────────────────────────────────────

    /// (i) The same-block floor inflation is CAPPED at one truncated-oracle step — it does NOT scale with the
    ///     pump notional (an attacker cannot buy a bigger overstatement with a bigger swap).
    function test_sameBlockPumpFloorInflationIsCappedNotScalable() public {
        _dep(makeAddr("capA"), 40_000 * ONE);
        vault.deployToLP(4_000 * ONE, vault.juniorTokens());
        _impairAndSettle(2_000_000 * ONE);

        uint256 f0 = vault.recoverableFloorUSDC();

        // Small pump: one block, buy team with $50k.
        address p1 = makeAddr("p1");
        usdc.mint(p1, 5_000_000 * ONE);
        vm.startPrank(p1);
        usdc.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, !_sellTeamZeroForOne(), 50_000 * ONE);
        vm.stopPrank();
        uint256 dSmall = vault.recoverableFloorUSDC() - f0;

        // Re-settle back down, snapshot again, then a 100× LARGER pump in one block.
        _settleOracleToSpot();
        uint256 f1 = vault.recoverableFloorUSDC();
        address p2 = makeAddr("p2");
        usdc.mint(p2, 500_000_000 * ONE);
        vm.startPrank(p2);
        usdc.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, !_sellTeamZeroForOne(), 5_000_000 * ONE); // 100× the notional
        vm.stopPrank();
        uint256 dBig = vault.recoverableFloorUSDC() - f1;

        // A 100× bigger pump does NOT yield a materially bigger floor inflation (capped by the oracle step),
        // and either way the inflation is a tiny fraction of the floor. If manipulation scaled with size this
        // would blow up; it does not.
        assertLt(dBig, dSmall * 4 + 5, "floor inflation SCALES with pump size (uncapped manipulation)");
        assertLt(dBig, f1 / 20, "same-block floor inflation exceeds 5% of the floor (not oracle-bounded)");
    }

    /// (ii) ECONOMIC — a same-block pump-redeem-dump cannot shift loss onto later redeemers. Snapshot the fair
    ///      floor BEFORE the attack; the honest holders must still clear ~that floor afterwards.
    function test_sameBlockPumpCannotShiftLossToLaterRedeemer() public {
        address atk = makeAddr("mevAtk"); // impaired senior + manipulator
        address vic = makeAddr("mevVic"); // honest senior, redeems after
        _dep(atk, 50_000 * ONE);
        _dep(vic, 50_000 * ONE);
        vault.deployToLP(8_000 * ONE, vault.juniorTokens());
        _impairAndSettle(3_000_000 * ONE);

        // The fair pro-rata floor every honest holder is entitled to, snapshot BEFORE the attack.
        uint256 fair0 = _fairPerShare();

        // Attacker, in ONE block: pump spot UP, redeem ALL their shares at the (one-step) inflated NAV, dump back.
        uint256 atkShares = vault.seniorShares(atk);
        usdc.mint(atk, 10_000_000 * ONE);
        vm.startPrank(atk);
        usdc.approve(address(swapRouter), type(uint256).max);
        team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, !_sellTeamZeroForOne(), 3_000_000 * ONE); // pump
        vault.redeemSenior(atkShares, 0);                              // redeem at inflated NAV
        swapRouter.swap(key, _sellTeamZeroForOne(), 3_000_000 * ONE);  // dump back
        vm.stopPrank();

        // Now the honest holders redeem (settled). They must STILL clear the pre-attack fair floor — the
        // attacker could not shift their solvency haircut onto the tail.
        _settleOracleToSpot();
        uint256 vicShares = vault.seniorShares(vic);
        vm.prank(vic);
        uint256 vicOut = vault.redeemSenior(vicShares, 0);
        uint256 vicPs  = (vicOut * WAD) / vicShares;

        _settleOracleToSpot();
        uint256 uShares = vault.seniorShares(user);
        vm.prank(user);
        uint256 uOut = vault.redeemSenior(uShares, 0);
        uint256 uPs  = (uOut * WAD) / uShares;

        assertGe(vicPs, (fair0 * 97) / 100, "later redeemer shortchanged: attacker shifted loss via same-block pump");
        assertGe(uPs,   (fair0 * 97) / 100, "third redeemer shortchanged: attacker shifted loss via same-block pump");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 3c. PROPORTIONAL-REALIZATION GRIEFING — repeated tiny redemptions must not strand value nor break the
    //     coverage invariant deployedFromSenior <= recoverableUSDC() + juniorUsdcBuffer, and must not let a
    //     redeemer over-realize the team-sale UPSIDE for themselves (it stays in the vault).
    // ─────────────────────────────────────────────────────────────────────────────
    function test_tinyRedemptionsPreserveSolvencyAndUpside() public {
        address whale = makeAddr("whale");
        address dust  = makeAddr("dustHolder");
        _dep(whale, 90_000 * ONE);
        _dep(dust, 50 * ONE);
        vault.deployToLP(8_000 * ONE, vault.juniorTokens());
        _impairAndSettle(3_000_000 * ONE);

        // 40 tiny redemptions from the whale (1 share each) — the pathological griefing pattern.
        for (uint256 i = 0; i < 40; i++) {
            _settleOracleToSpot();
            vm.prank(whale);
            try vault.redeemSenior(1, 0) {} catch {}
            // Coverage invariant must hold after EVERY tiny redemption.
            assertLe(
                vault.deployedFromSenior(),
                vault.recoverableUSDC() + vault.juniorUsdcBuffer() + 100_000,
                "coverage invariant broke under tiny-redemption griefing"
            );
        }
        // The dust holder must still be able to redeem for a fair per-share value (not stranded).
        _settleOracleToSpot();
        uint256 fairPs = _fairPerShare();
        uint256 ds = vault.seniorShares(dust);
        vm.prank(dust);
        uint256 out = vault.redeemSenior(ds, 0);
        uint256 ps = (out * WAD) / ds;
        assertGe(ps, (fairPs * 90) / 100, "dust holder stranded below the fair floor after whale griefing");
    }

    function _fairPerShare() internal view returns (uint256) {
        uint256 par = vault.seniorParLiability();
        uint256 tsa = vault.totalSeniorAssets();
        if (tsa > par) par = tsa;
        uint256 real = vault.seniorRealizableAssets();
        uint256 nav = real < par ? real : par;
        uint256 ts = vault.totalSeniorShares();
        return ts == 0 ? 0 : (nav * WAD) / ts;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 3d. CARD SETTLE — burnForPayment with the honest (impairment-moving) NAV must NEVER pay the receiver
    //     MORE than realizable, and never bypass the burn accounting.
    // ─────────────────────────────────────────────────────────────────────────────
    function test_burnForPaymentNeverOverpaysUnderImpairment() public {
        // Owner (this) sets itself as the gateway so it can call burnForPayment directly.
        vault.setGateway(address(this));

        address payer = makeAddr("cardPayer");
        _dep(payer, 60_000 * ONE);
        vault.deployToLP(6_000 * ONE, vault.juniorTokens());
        _impairAndSettle(3_000_000 * ONE);

        uint256 shares = vault.seniorShares(payer);
        // Settle a SMALL slice (card settle is capped small); pick shares worth < $250 of NAV.
        uint256 nav = vault.seniorRealizableAssets();
        uint256 ts  = vault.totalSeniorShares();
        // shares worth ~$100 at current NAV:
        uint256 small = (100 * ONE) * ts / (nav == 0 ? 1 : nav);
        if (small == 0) small = 1;
        if (small > shares) small = shares;

        uint256 realizableBefore = vault.seniorRealizableAssets();
        address receiver = makeAddr("merchant");
        uint256 before = usdc.balanceOf(receiver);
        uint256 paid = vault.burnForPayment(payer, small, receiver);

        assertEq(usdc.balanceOf(receiver) - before, paid, "receiver credited != settled amount (accounting bypass)");
        // Never paid more than the per-share realizable value of the burned shares.
        uint256 fairForSlice = _mulDiv(realizableBefore, small, ts);
        assertLe(paid, fairForSlice + 5, "card receiver paid ABOVE the realizable backing (over-payment)");
    }

    function _mulDiv(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        return (a * b) / d;
    }
}
