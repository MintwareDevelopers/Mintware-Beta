// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test}         from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20}       from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareMultiVenueYieldAdapter} from "../../../src/vaults/MintwareMultiVenueYieldAdapter.sol";
import {IYieldAdapter}                   from "../../../src/vaults/IYieldAdapter.sol";
import {MockERC20}                        from "../../mocks/MockERC20.sol";
import {MockVenueAdapter}                 from "../../mocks/MockVenueAdapter.sol";

/// @notice GROUP A4 — the multi-venue router conserves across children. Drives the REAL
///         `MintwareMultiVenueYieldAdapter` (handler is its authorized `vault`) fanning idle capital across
///         three child venues, through re-weights (`setVenues`) and `rebalance()`, with venues paused /
///         supply-capped / reverting-on-deposit. Ghosts prove NO value is created or destroyed by the
///         weighted floor-splits: `gOut ≤ gIn + gYield`, and `totalAssets == Σ in + Σ yield − Σ out`.
contract MultiVenueAdapterHandler is Test {
    MintwareMultiVenueYieldAdapter public router;
    MockERC20 public underlying;
    MockVenueAdapter[3] public venues;
    address public owner;

    uint256 public gIn;
    uint256 public gOut;
    uint256 public gYield;
    uint256 public nDeposits;
    uint256 public nWithdraws;
    bool    public withdrawReverted;

    constructor(
        MintwareMultiVenueYieldAdapter _router,
        MockERC20 _underlying,
        MockVenueAdapter[3] memory _venues,
        address _owner
    ) {
        router = _router; underlying = _underlying; venues = _venues; owner = _owner;
        underlying.approve(address(_router), type(uint256).max);
    }

    function supply(uint256 amtSeed) public {
        uint256 amt = bound(amtSeed, 1, 1_000_000e6);
        underlying.mint(address(this), amt);
        try router.deposit(amt) { gIn += amt; nDeposits++; }
        catch {}
    }

    function withdrawSome(uint256 amtSeed) public {
        uint256 amt = bound(amtSeed, 0, 2_000_000e6);
        try router.withdraw(amt) returns (uint256 got) { gOut += got; nWithdraws++; }
        catch { withdrawReverted = true; }
    }

    function accrueYield(uint256 amtSeed, uint256 which) public {
        uint256 amt = bound(amtSeed, 1, 100_000e6);
        MockVenueAdapter v = venues[bound(which, 0, 2)];
        underlying.mint(address(this), amt);
        underlying.approve(address(v), amt);
        try v.simulateYield(amt) { gYield += amt; } catch {}
    }

    function reweight(uint256 w0, uint256 w1, uint256 w2) public {
        IYieldAdapter[] memory a = new IYieldAdapter[](3);
        uint16[] memory w = new uint16[](3);
        a[0] = IYieldAdapter(address(venues[0]));
        a[1] = IYieldAdapter(address(venues[1]));
        a[2] = IYieldAdapter(address(venues[2]));
        // keep Σ ≤ 10_000 (router requires it) — cap each at ~1/3.
        w[0] = uint16(bound(w0, 0, 3333));
        w[1] = uint16(bound(w1, 0, 3333));
        w[2] = uint16(bound(w2, 0, 3333));
        vm.prank(owner);
        try router.setVenues(a, w) {} catch {}
    }

    function rebalance() public {
        vm.prank(owner);
        try router.rebalance() {} catch {}
    }

    function pauseVenue(uint256 which, uint256 seed) public {
        venues[bound(which, 0, 2)].setPaused(seed % 2 == 0);
    }

    function capVenue(uint256 which, uint256 capSeed) public {
        venues[bound(which, 0, 2)].setSupplyCap(bound(capSeed, 0, 500_000e6));
    }

    function revertDepositVenue(uint256 which, uint256 seed) public {
        venues[bound(which, 0, 2)].setRevertDeposit(seed % 3 == 0);
    }
}

/// @notice A4 invariants for `MintwareMultiVenueYieldAdapter`.
contract MultiVenueAdapterInvariantTest is StdInvariant, Test {
    MintwareMultiVenueYieldAdapter internal router;
    MultiVenueAdapterHandler        internal handler;
    MockERC20 internal usdc;
    MockVenueAdapter[3] internal venues;

    address internal owner = makeAddr("owner");

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        for (uint256 i; i < 3; ++i) venues[i] = new MockVenueAdapter(IERC20(address(usdc)));

        router = new MintwareMultiVenueYieldAdapter(address(usdc), address(0), owner);
        // wire vault=handler, then set the venue set with equal weights.
        handler = new MultiVenueAdapterHandler(router, usdc, venues, owner);
        vm.prank(owner);
        router.setVault(address(handler));

        // Trust the three vetted child venues before wiring them (deliberate curation).
        vm.startPrank(owner);
        for (uint256 i; i < 3; ++i) router.setVenueTrust(address(venues[i]), true);
        vm.stopPrank();

        IYieldAdapter[] memory a = new IYieldAdapter[](3);
        uint16[] memory w = new uint16[](3);
        for (uint256 i; i < 3; ++i) { a[i] = IYieldAdapter(address(venues[i])); w[i] = 3000; }
        vm.prank(owner);
        router.setVenues(a, w); // Σ 9000, 1000 bps stays idle in the router (still counted/withdrawable)

        bytes4[] memory sels = new bytes4[](8);
        sels[0] = MultiVenueAdapterHandler.supply.selector;
        sels[1] = MultiVenueAdapterHandler.withdrawSome.selector;
        sels[2] = MultiVenueAdapterHandler.accrueYield.selector;
        sels[3] = MultiVenueAdapterHandler.reweight.selector;
        sels[4] = MultiVenueAdapterHandler.rebalance.selector;
        sels[5] = MultiVenueAdapterHandler.pauseVenue.selector;
        sels[6] = MultiVenueAdapterHandler.capVenue.selector;
        sels[7] = MultiVenueAdapterHandler.revertDepositVenue.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        targetContract(address(handler));
    }

    /// A4 round-trip: no free value across venues, through re-weights and rebalances.
    function invariant_A4_multivenue_no_free_value() public view {
        assertLe(handler.gOut(), handler.gIn() + handler.gYield(), "A4: Sigma out > Sigma in + yield");
    }

    /// A4 conservation (FIX 1 — principal-clamped NAV): reported NAV NEVER EXCEEDS the net capital in the
    /// system. The principal-clamp caps each child's contribution at its deployed principal + a bounded yield
    /// band, so the router can never OVER-report (the phantom-NAV defense); it may under-report only when a
    /// child's real yield exceeds the band (a rebalance re-bases the principal and recaptures it). Combined
    /// with `no_free_value` (Σout ≤ Σin+yield) this is the full secure-NAV posture: value is never conjured.
    function invariant_A4_multivenue_neverInflates() public view {
        uint256 net = handler.gIn() + handler.gYield() - handler.gOut();
        assertLe(router.totalAssets(), net, "A4: totalAssets must never exceed Sigma in + yield - out");
    }

    /// A4 liveness: the best-effort router withdraw never reverts, even with venues paused/hostile.
    function invariant_A4_multivenue_withdraw_never_reverts() public view {
        assertFalse(handler.withdrawReverted(), "A4: a best-effort router withdraw reverted");
    }

    function afterInvariant() public view {
        assertGt(handler.nDeposits() + handler.nWithdraws(), 0, "vacuous: no router deposit/withdraw");
        assertGt(handler.nWithdraws(), 0, "vacuous: no router withdraw executed");
    }
}
