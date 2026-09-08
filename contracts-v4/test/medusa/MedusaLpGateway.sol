// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EchidnaLpGatewayIdle} from "../echidna/EchidnaLpGatewayIdle.sol";
import {EchidnaLpGatewayDeploy} from "../echidna/EchidnaLpGatewayDeploy.sol";

/// @title  Medusa property harnesses — LP gateway
/// @notice Medusa's own idiom is a `property_`-prefixed view returning bool (`propertyTesting.testPrefixes`),
///         plus assertion-mode tests that simply revert on a panic. These subclasses re-expose the SAME state
///         machine and the SAME violation counters as the Echidna harnesses, under Medusa's prefix — deliberately
///         by inheritance rather than by copy, so the two engines can never drift apart and any difference in
///         outcome is attributable to the ENGINE, not to two subtly different harnesses.
///
/// @dev    Medusa additionally advances `block.number` / `block.timestamp` by its own random schedule
///         (`blockNumberDelayMax` / `blockTimestampDelayMax`), which is a different exploration axis again from
///         both Echidna's and the Foundry handler's `vm.roll` counter.
contract MedusaLpGatewayIdle is EchidnaLpGatewayIdle {
    function property_shares_conserved() public view returns (bool) {
        return echidna_shares_conserved();
    }

    function property_solvent() public view returns (bool) {
        return echidna_solvent();
    }

    function property_token_conservation() public view returns (bool) {
        return echidna_token_conservation();
    }

    function property_mint_shadow() public view returns (bool) {
        return echidna_mint_shadow();
    }

    function property_exit_shadow() public view returns (bool) {
        return echidna_exit_shadow();
    }

    function property_no_free_lunch() public view returns (bool) {
        return echidna_no_free_lunch();
    }

    function property_follower_band() public view returns (bool) {
        return echidna_follower_band();
    }

    function property_last_known_idle() public view returns (bool) {
        return echidna_last_known_idle();
    }

    function property_no_unexpected_revert() public view returns (bool) {
        return echidna_no_unexpected_revert();
    }

    function property_no_phantom_recredit() public view returns (bool) {
        return echidna_no_phantom_recredit();
    }

    function property_idle_rig_never_deploys() public view returns (bool) {
        return echidna_idle_rig_never_deploys();
    }

    /// Assertion-mode companion (Medusa `assertionTesting`): the same facts as hard asserts, so Medusa's
    /// panic detector — a genuinely different failure channel from the boolean-property one — can also fire.
    function assertInvariants() public view {
        assert(echidna_shares_conserved());
        assert(echidna_solvent());
        assert(echidna_token_conservation());
        assert(echidna_mint_shadow());
        assert(echidna_exit_shadow());
        assert(echidna_follower_band());
        assert(echidna_no_phantom_recredit());
        assert(echidna_no_unexpected_revert());
    }
}

contract MedusaLpGatewayDeploy is EchidnaLpGatewayDeploy {
    function property_deploy_cap_at_deploy() public view returns (bool) {
        return echidna_deploy_cap_at_deploy();
    }

    function property_deploy_cap_continuous() public view returns (bool) {
        return echidna_deploy_cap_continuous();
    }

    function property_dp_moves_only_lawfully() public view returns (bool) {
        return echidna_dp_moves_only_lawfully();
    }

    function property_shares_conserved_deployed() public view returns (bool) {
        return echidna_shares_conserved();
    }

    function property_follower_band_deployed() public view returns (bool) {
        return echidna_follower_band();
    }

    function property_dp_zero_iff_empty() public view returns (bool) {
        return echidna_dp_zero_iff_empty();
    }

    function assertInvariants() public view {
        assert(echidna_deploy_cap_at_deploy());
        assert(echidna_dp_moves_only_lawfully());
        assert(echidna_shares_conserved());
        assert(echidna_follower_band());
    }
}
