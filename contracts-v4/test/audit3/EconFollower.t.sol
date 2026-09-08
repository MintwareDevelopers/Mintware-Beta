// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Test.sol";
import {EconBase} from "./EconBase.sol";
import {MintwareLpGatewayPositionManager} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";

/// @title  Econ Q1 / Q3 -- follower speed, entry-mark cheapening, in-band deploy sandwich
/// @notice Fork simulations for docs/developers/audits/round3/economic-models.md. Model targets come from
///         scripts/audit3/econ_models.py (same CL math); each test asserts the simulation lands within
///         tolerance of the model and logs the raw numbers.
///
///         Run: LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com forge test --match-contract EconFollower -vv
contract EconFollowerTest is EconBase {
    /// Harness depth: 2.2M external L (R ~ 2.35M with the gateway) ; gateway 100k/100k -> share s = q/R = 4.3%.
    function _harness(uint256 aliceDep, uint256 q) internal {
        _addExternalLiquidity(2_200_000e18);
        vm.prank(alice);
        pm.deposit(aliceDep);
        pm.deploy(q, q, 0, block.timestamp);
        _roll(1);
    }

    // =====================================================================================
    // E-1 : same-block follower snap. dump (<= 1 step) -> poke -> deposit -> reverse -> exit next block.
    //       No patience, no mempool, no held inventory across blocks. gain/cost ~ s/phi (model 7.2x here).
    // =====================================================================================

    function test_E1_sameBlockSnap_dumpPokeDeposit_extracts_FIXED() public {
        if (!live) return;
        _harness(200_000e18, 100_000e18); // NAV 300k = 100k idle + 200k LP ; s = 100k / 2.35M = 4.26%
        uint256 navFair = pm.totalNav();
        uint256 D = navFair; // D_mult = 1
        uint256 w0 = _wealth(mallory, SQRT_1);
        uint256 s0 = pm.totalShares();

        // (1) dump paired one follower step (sqrtP -4.9% => price -9.6%)
        (uint256 pIn,) = _swapToSqrt(mallory, false, _sqrtForPairedSqrt(SQ_DOWN_1STEP));
        // (2) permissionless poke: the follower is one step behind -> it lands EXACTLY on the dumped spot
        pm.poke();
        assertEq(_ref(), _spot(), "poke snapped the reference onto the dumped spot (dev <= 1 step)");
        uint256 navLow = pm.totalNav();
        // (3) deposit at the cheapened mark: max(spot, ref) == the dumped spot
        vm.prank(mallory);
        uint256 sM = pm.deposit(D);
        // (4) reverse: buy paired back to fair in the same block
        _swapToSqrt(mallory, true, SQRT_1);
        // (5) next block: pro-rata exit at fair
        _roll(1);
        vm.prank(mallory);
        pm.withdraw(sM);
        _arbToFair();

        int256 gain = int256(_wealth(mallory, SQRT_1)) - int256(w0); // negative = the attacker paid fees for nothing
        uint256 aliceNav = pm.totalNav();
        uint256 fairShares = (D * s0) / navFair;

        _logQ("NAV fair", navFair);
        _logQ("NAV at dumped mark (spot view)", navLow);
        _logQ("paired dumped (units)", pIn);
        console2.log("shares minted vs fair (bps)", _pct(sM, fairShares));
        _logI("attacker NET gain (negative = loss)", gain);

        // FIXED (round-3 XR-1 / E-1): the deposit is priced at the holder-favourable mark over spot, the follower AND
        // the entry-mark memory, so a follower snapped onto the dumped spot no longer cheapens entry.
        // Pre-fix (same rig): +3.4% shares, attacker +4,329 / alice -5,038 on 300k NAV.
        assertLe(sM, fairShares + fairShares / 1000, "no cheapening: <= fair shares (+0.1% rounding)");
        assertLt(gain, 0, "the attacker only paid the round-trip fees");
        assertGe(aliceNav + 50e18, navFair, "alice whole (dust)");
    }

    /// Control: the SAME dump without the poke. The deposit is priced at max(spot, ref_previous) -> no
    /// cheapening; the attacker only pays fees. Proves the poke/any-action-in-block is the primitive.
    function test_E1_control_noPoke_maxMarkProtects_FAILS() public {
        if (!live) return;
        _harness(200_000e18, 100_000e18);
        uint256 navFair = pm.totalNav();
        uint256 w0 = _wealth(mallory, SQRT_1);
        uint256 s0 = pm.totalShares();
        _swapToSqrt(mallory, false, _sqrtForPairedSqrt(SQ_DOWN_1STEP));
        vm.prank(mallory);
        uint256 sM = pm.deposit(navFair);
        _swapToSqrt(mallory, true, SQRT_1);
        _roll(1);
        vm.prank(mallory);
        pm.withdraw(sM);
        _arbToFair();
        uint256 fairShares = (navFair * s0) / navFair;
        console2.log("shares minted vs fair (bps)", _pct(sM, fairShares));
        assertLe(sM, fairShares + fairShares / 1000, "no cheapening: <= fair shares (+0.1% rounding)");
        assertLt(_wealth(mallory, SQRT_1), w0, "attacker lost the fees");
        assertGe(pm.totalNav() + 50e18, navFair, "alice whole (dust)");
    }

    /// Policy-minimum pool (R = 250k) at the R8 deploy share (2%): the SAME attack, scale-invariant ratio.
    function test_E1_sameBlockSnap_policyMinDepth_2pctShare_FIXED() public {
        if (!live) return;
        // gateway q = 5k -> L_g = 5k/0.683 = 7,318 ; external = 250k - 7,318 so R = 250k exactly
        _addExternalLiquidity(242_682e18);
        vm.prank(alice);
        pm.deposit(10_000e18);
        pm.deploy(5_000e18, 5_000e18, 0, block.timestamp);
        _roll(1);
        uint256 navFair = pm.totalNav(); // 15k
        uint256 w0 = _wealth(mallory, SQRT_1);
        _swapToSqrt(mallory, false, _sqrtForPairedSqrt(SQ_DOWN_1STEP));
        pm.poke();
        vm.prank(mallory);
        uint256 sM = pm.deposit(navFair);
        _swapToSqrt(mallory, true, SQRT_1);
        _roll(1);
        vm.prank(mallory);
        pm.withdraw(sM);
        _arbToFair();
        int256 gain = int256(_wealth(mallory, SQRT_1)) - int256(w0);
        _logQ("policy-min: NAV", navFair);
        _logI("policy-min: attacker net gain (negative = loss)", gain);
        // FIXED: pre-fix +176 net on a 15k NAV at the R8 2% share (ratio 3.3x); the mark now ignores the snapped follower.
        assertLt(gain, 0, "unprofitable at the 2% policy share");
        assertGe(pm.totalNav() + 5e18, navFair, "alice whole (dust)");
    }

    // =====================================================================================
    // Q1 : walk the follower 2x. Blocks, capital, fee cost; then the extraction the walk unlocks.
    // =====================================================================================

    function test_Q1_walkFollower2x_costAndExtraction() public {
        if (!live) return;
        _harness(200_000e18, 100_000e18);
        uint256 navFair = pm.totalNav();
        uint256 w0 = _wealth(mallory, SQRT_1);
        uint256 s0 = pm.totalShares();
        uint256 R = uint256(_poolLiq()); // virtual quote reserve at P=1

        // dump paired to price /2 (sqrtP x 0.7071) in one block
        (uint256 pIn, uint256 qOut) = _swapToSqrt(mallory, false, _sqrtForPairedSqrt(SQ_HALF));
        uint256 dev0 = _devBps();
        uint256 blocks = _walkFollower(20, 0); // poke per block until ref == spot
        console2.log("initial deviation bps", dev0);
        console2.log("blocks to walk the reference 2x", blocks);
        assertEq(blocks, 7, "model: 7 steps of 5% sqrtP to cover a 29.3% sqrtP dump");
        assertEq(_ref(), _spot());

        uint256 navLow = pm.totalNav();
        vm.prank(mallory);
        uint256 sM = pm.deposit(navFair); // D = NAV at the fully-walked low mark
        (uint256 qIn,) = _swapToSqrt(mallory, true, SQRT_1); // reverse
        _roll(1);
        vm.prank(mallory);
        pm.withdraw(sM);
        _arbToFair();

        int256 gain = int256(_wealth(mallory, SQRT_1)) - int256(w0);
        uint256 fairShares = (navFair * s0) / navFair;
        console2.log("quote paid to re-buy minus quote received on the dump", (qIn > qOut ? qIn - qOut : 0) / 1e18);
        _logQ("R (pool virtual quote reserve)", R);
        _logQ("paired sold for the 2x dump (capital)", pIn);
        _logQ("NAV at walked-down mark (spot view)", navLow);
        console2.log("shares vs fair bps", _pct(sM, fairShares));
        _logI("attacker NET gain (negative = loss)", gain);
        // FIXED (round-3 XR-1): the walk still converges in 7 blocks, but the entry-mark memory (current + previous
        // ENTRY_MEMORY_BLOCKS period) still carries the pre-dump reference, so the deposit is priced at fair.
        // Pre-fix (same rig): round trip 4,987 (0.21% of R) unlocked +30.2k net for the attacker / alice -35.2k.
        assertLe(sM, fairShares + fairShares / 1000, "no cheapening after a fully-walked 2x dump");
        assertLt(gain, 0, "the 2x walk costs fees and unlocks nothing");
        assertGe(pm.totalNav() + 50e18, navFair, "alice whole (dust)");
    }

    // =====================================================================================
    // Q3 : in-band deploy sandwich. With a same-block poke the band is effectively TWO steps.
    // =====================================================================================

    function test_Q3_deploySandwich_twoStepsViaPoke_10pctShare_marginal_SUCCEEDS() public {
        if (!live) return;
        _addExternalLiquidity(2_200_000e18);
        vm.prank(alice);
        pm.deposit(600_000e18);
        pm.deploy(10_000e18, 10_000e18, 0, block.timestamp); // anchor
        _roll(1);
        uint256 R = uint256(_poolLiq());
        uint256 qDeploy = R / 10; // 10% share for the fresh deploy
        uint256 w0 = _wealth(mallory, SQRT_1);
        uint256 navBefore = pm.totalNav();
        uint256 ownerP0 = paired.balanceOf(address(this));

        (, uint256 pGot) = _swapToSqrt(mallory, true, _sqrtForPairedSqrt(SQ_UP_2STEP)); // +10% sqrtP (~2 steps)
        assertGt(_devBps(), BAND, "two steps out: a deploy would revert DeployPriceOutOfBand...");
        pm.poke(); // ...but a poke moves the reference one step -> spot is now inside the band
        assertLe(_devBps(), BAND, "same-block poke widened the effective band to two steps");
        pm.deploy(qDeploy, qDeploy, 0, block.timestamp); // owner deploy lands at the pushed price
        _swapExactIn(mallory, false, pGot); // reverse on the deeper pool
        uint256 ownerPairedUsed = ownerP0 - paired.balanceOf(address(this));
        _roll(1);
        _arbToFair();

        int256 pnl = int256(_wealth(mallory, SQRT_1)) - int256(w0);
        // the deployed quote moves idle -> LP (NAV-neutral); only the owner's paired leg is new value (at fair 1.0)
        uint256 contributed = navBefore + ownerPairedUsed;
        _logQ("quote actually deployed (deployedPrincipal delta)", pm.deployedPrincipal() - 10_000e18);
        _logQ("owner paired used", ownerPairedUsed);
        uint256 loss = contributed > pm.totalNav() ? contributed - pm.totalNav() : 0;
        _logQ("R", R);
        _logQ("deploy quote (10% of R)", qDeploy);
        _logI("attacker PnL (net of fees)", pnl);
        _logQ("depositor loss vs no-sandwich", loss);
        console2.log("depositor loss bps of deployed quote", _pct(loss, qDeploy));
        // model (harness, share 0.10, d=0.10 ~ 2 steps): attacker +1,081 ; depositor loss 2,175 ; break-even dL/L = 2*phi/d = 6%
        assertGt(pnl, 0, "profitable at 10% share only because the poke doubled the band");
        assertLt(pnl, int256(qDeploy) / 100, "...and bounded to <1% of the deploy");
        assertApproxEqRel(loss, 2_175e18, 0.25e18, "depositor loss ~ model 2.2k (0.9% of the deploy)");
    }

    function test_Q3_deploySandwich_twoStepsViaPoke_2pctShare_FAILS() public {
        if (!live) return;
        _addExternalLiquidity(2_200_000e18);
        vm.prank(alice);
        pm.deposit(600_000e18);
        pm.deploy(10_000e18, 10_000e18, 0, block.timestamp);
        _roll(1);
        uint256 qDeploy = uint256(_poolLiq()) / 50; // 2% share (R8 at deploy)
        uint256 w0 = _wealth(mallory, SQRT_1);
        (, uint256 pGot) = _swapToSqrt(mallory, true, _sqrtForPairedSqrt(SQ_UP_2STEP));
        pm.poke();
        pm.deploy(qDeploy, qDeploy, 0, block.timestamp);
        _swapExactIn(mallory, false, pGot);
        _roll(1);
        _arbToFair();
        int256 pnl = int256(_wealth(mallory, SQRT_1)) - int256(w0);
        _logI("attacker PnL at 2% share (negative = loss)", pnl);
        assertLt(pnl, 0, "R8's 2% deploy share keeps the in-band sandwich unprofitable (model -817)");
    }
}
