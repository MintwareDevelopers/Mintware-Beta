// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareMultiVenueYieldAdapter} from "../src/vaults/MintwareMultiVenueYieldAdapter.sol";
import {IYieldAdapter} from "../src/vaults/IYieldAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockVenueAdapter} from "./mocks/MockVenueAdapter.sol";
import {MaliciousVenueAdapter} from "./mocks/MaliciousVenueAdapter.sol";

/// @title  FIX-1 verification - principal-clamped NAV blocks the multi-venue child-NAV lie
/// @notice Originally a red-team PoC proving a single lying child corrupted the router's `totalAssets()`
///         (the NAV a treasury vault reads for its senior mark). After the FIX (principal-clamp: a child's
///         NAV contribution is capped at `deployedPrincipal + bounded yield band`), the phantom NAV is
///         DROPPED - a 0-principal child contributes ~0 no matter what it claims. These tests now assert
///         the attack is BLOCKED. See MultiVenueTreasuryExtractionPoC.t.sol for the end-to-end proof.
contract MultiVenueNavCorruptionPoC is Test {
    MockERC20 internal usdc;
    MockVenueAdapter     internal honest;    // holds all the real USDC
    MaliciousVenueAdapter internal evil;     // holds nothing, lies about totalAssets
    MintwareMultiVenueYieldAdapter internal router;

    address internal owner = makeAddr("curator");

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        honest = new MockVenueAdapter(IERC20(address(usdc)));
        evil   = new MaliciousVenueAdapter(IERC20(address(usdc)));
        // vault = this test contract (sole authorized caller / stand-in for the treasury vault).
        router = new MintwareMultiVenueYieldAdapter(address(usdc), address(this), owner);

        // Curator trusts BOTH children (deliberate) - evil models a vetted-then-compromised venue.
        vm.startPrank(owner);
        router.setVenueTrust(address(honest), true);
        router.setVenueTrust(address(evil), true);
        router.setMaxVenueWeightBps(10_000); // allow the 100% honest routing these tests use
        vm.stopPrank();

        usdc.mint(address(this), 10_000_000e6);
        usdc.approve(address(router), type(uint256).max);
    }

    function _wire(uint16 honestW, uint16 evilW) internal {
        IYieldAdapter[] memory v = new IYieldAdapter[](2);
        v[0] = honest; v[1] = evil;
        uint16[] memory w = new uint16[](2);
        w[0] = honestW; w[1] = evilW;
        vm.prank(owner);
        router.setVenues(v, w);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 1) FIX: a lying child at 0 principal can NO LONGER inflate the router's NAV read.
    // ─────────────────────────────────────────────────────────────────────────────
    function test_Fix_lying_child_cannot_inflate_router_totalAssets() public {
        _wire(10_000, 0); // 100% honest, evil at 0% weight (receives no real capital → 0 principal)
        router.deposit(1_000_000e6); // all real capital → honest venue

        assertEq(router.totalAssets(), 1_000_000e6, "honest baseline NAV");
        assertEq(evil.totalAssets(), 0, "evil holds nothing");
        assertEq(router.deployedPrincipal(address(evil)), 0, "router deployed 0 principal to evil");

        // Curator's compromised child fabricates $5M of NAV out of thin air.
        evil.setPhantom(5_000_000e6);

        // BLOCKED: evil's contribution is clamped to min(reported, principal + band) = min($5M, 0) = 0.
        assertEq(router.totalAssets(), 1_000_000e6, "phantom NAV DROPPED - NAV stays at the real $1M");
        assertEq(router.maxWithdrawable(), 1_000_000e6, "only the real $1M is (still) withdrawable");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 2) A phantom on a 0-principal venue lands as ~0 regardless of weight.
    // ─────────────────────────────────────────────────────────────────────────────
    function test_Fix_phantom_on_zero_principal_venue_is_clamped_out() public {
        _wire(10_000, 0); // evil wired at 0 weight → 0 real principal
        router.deposit(1_000_000e6);

        uint256 realBefore = router.totalAssets();
        evil.setPhantom(9_000_000e6); // 0-principal venue fabricates $9M

        assertEq(router.totalAssets(), realBefore, "phantom clamped out - NAV unchanged");
        assertEq(router.maxWithdrawable(), realBefore, "real withdrawable untouched by the lie");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 3) The bounded yield band still lets a child surface LEGITIMATE yield (not over-clamped).
    // ─────────────────────────────────────────────────────────────────────────────
    function test_Fix_legit_yield_within_band_still_counts() public {
        _wire(10_000, 0);
        router.deposit(1_000_000e6); // honest principal = $1M

        // Honest venue earns $150k (15% < the 20% default band) via a real underlying donation.
        usdc.mint(address(this), 150_000e6);
        usdc.approve(address(honest), type(uint256).max);
        honest.simulateYield(150_000e6);

        assertEq(router.totalAssets(), 1_150_000e6, "real yield within the band surfaces fully");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 4) Yield ABOVE the band is clamped to principal + band (over-report ceiling).
    // ─────────────────────────────────────────────────────────────────────────────
    function test_Fix_overband_report_is_capped_at_principal_plus_band() public {
        _wire(10_000, 0);
        router.deposit(1_000_000e6); // honest principal = $1M, band = 20% → ceiling $1.2M

        // Honest venue "reports" $1.5M of underlying (30% > band). Only $1.2M is trusted.
        usdc.mint(address(this), 500_000e6);
        usdc.approve(address(honest), type(uint256).max);
        honest.simulateYield(500_000e6);

        assertEq(router.totalAssets(), 1_200_000e6, "capped at principal + 20% band");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 5) A child reporting a real LOSS (below principal) still surfaces the lower value -
    //    the clamp is an UPPER bound only, never a floor.
    // ─────────────────────────────────────────────────────────────────────────────
    function test_Fix_real_loss_below_principal_passes_through() public {
        _wire(10_000, 0);
        router.deposit(1_000_000e6); // honest principal = $1M

        // Honest venue suffers a real $300k loss (underlying seized/slashed).
        vm.prank(address(honest));
        usdc.transfer(address(0xdead), 300_000e6);

        assertEq(honest.totalAssets(), 700_000e6, "venue really holds $700k now");
        assertEq(router.totalAssets(), 700_000e6, "loss surfaces - clamp does not floor it back to principal");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 6) Even the uint256.max over-report saturates to the clamp ceiling (0 for a 0-principal venue).
    // ─────────────────────────────────────────────────────────────────────────────
    function test_Fix_uint_max_report_clamped_to_zero_on_zero_principal() public {
        _wire(10_000, 0);
        router.deposit(1_000e6);
        evil.setPhantom(type(uint256).max);
        assertEq(router.totalAssets(), 1_000e6, "uint256.max report clamped to evil's 0 principal");
    }
}
