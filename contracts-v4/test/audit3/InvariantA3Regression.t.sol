// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/console2.sol";
import {InvariantIdleOnlyTest} from "./InvariantIdleOnly.t.sol";

/// @notice Deterministic replay of the shrunk 7-call counterexample that broke `invariant_A3_noValueCreation_perActor`
///         in CI (PR #515 run 37045519000, 2026-10-02): 1161067594170 > 1161067524608.
///         Root cause: a HARNESS gap, not a contract bug. `_withdraw` re-credits a capped exit
///         floor(shares·shortfall/claim) shares — rounding against the exiter (the safe direction) — so < 1 PM share of
///         value stays in the pool for the other holders. The handler counted that only as the exiter's `ownLoss`,
///         never as capturable `globalSlack`. A 150k compound into the EMPTY pool made 1 share ≈ 0.15 USDG, so two
///         capped exits moved ~0.43 USDG from the exiter to the other holder — no value created, A3's bound too tight.
///         Value accounting proof: ALICE −0.43, BOB +0.37 (sum ≤ 0: nothing minted).
contract InvariantA3RegressionTest is InvariantIdleOnlyTest {
    function _replay() internal {
        h.compound(150000000000);
        h.setCap(4147);
        h.deposit(1, 300224711459537403375638851736849840519333991436331305227966742, true, 37);
        h.deposit(17032, 29472087562412956986926902509734074508668594169481684425325950614917125216, false, 0);
        h.withdraw(5000000000000, 13583, false, 132);
        h.deposit(2479791699605568261343467692188302493932881461267714501809727, 0, false, 0);
        h.withdraw(149850000000000000000000, 5001, true, 163);
    }

    function test_A3_counterexample_replay() public {
        _replay();
        console2.log("totalShares / totalNav", pm.totalShares(), pm.totalNav());
        for (uint256 i; i < h.actorCount(); ++i) {
            address a = h.actors(i);
            if (h.deposited(a) == 0 && h.withdrawn(a) == 0) continue;
            console2.log("actor", i);
            console2.log("  deposited / withdrawn", h.deposited(a), h.withdrawn(a));
            console2.log("  shares / claim", pm.sharesOf(a), h.claimOf(a));
            console2.log("  yieldCredit / swept", h.yieldCredit(a), h.swept(a));
            console2.log("  LHS / RHS", h.withdrawn(a) + h.claimOf(a), h.deposited(a) + h.yieldCredit(a) + h.swept(a) + h.globalSlack());
        }
        console2.log("globalSlack / compoundedTotal", h.globalSlack(), h.compoundedTotal());
        console2.log("reCredits / cappedWithdraws / overDelivery", h.nReCredits(), h.nCappedWithdraws(), h.maxOverDelivery());
        invariant_A3_noValueCreation_perActor();

        // Conservation: across all actors, nothing was minted — total out + claims never exceed total in + compound.
        uint256 totIn = h.compoundedTotal();
        uint256 totOut;
        for (uint256 i; i < h.actorCount(); ++i) {
            address a = h.actors(i);
            totIn += h.deposited(a);
            totOut += h.withdrawn(a) + h.claimOf(a);
        }
        assertLe(totOut, totIn, "value created across actors");
        // The exiter (actor 0) lost to rounding against them, never gained.
        assertLe(h.withdrawn(h.actors(0)) + h.claimOf(h.actors(0)), h.deposited(h.actors(0)), "exiter gained");
    }
}
