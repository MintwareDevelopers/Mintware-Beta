// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareYieldVault}             from "../../src/payments/MintwareYieldVault.sol";
import {MintwareMultiVenueYieldAdapter} from "../../src/vaults/MintwareMultiVenueYieldAdapter.sol";
import {IYieldAdapter}                  from "../../src/vaults/IYieldAdapter.sol";
import {MockERC20}                      from "../mocks/MockERC20.sol";
import {MockVenueAdapter}               from "../mocks/MockVenueAdapter.sol";

/// @title  YieldLoopIntegration
/// @notice END-TO-END, ASSEMBLED proof of the multi-source baseline-yield loop — NOT a per-unit test.
///         It wires the REAL settlement vault (`MintwareYieldVault`) to the REAL curator router
///         (`MintwareMultiVenueYieldAdapter`) sitting over three child venues, then drives the full
///         cycle a keeper/curator actually runs:
///
///             deposit senior USDC → capital fans across venues by weight
///                → keeper re-weights toward the "best" venue (respecting the per-venue risk cap)
///                → rebalance realigns holdings
///                → yield accrues in the best venue
///                → depositor redeems → CONSERVATION end-to-end (out ≤ in + yield, nothing stranded)
///                → a stalled venue degrades gracefully (best-effort withdraw never bricks the loop).
///
///         The vault's `adapter` slot is `immutable`, so the vault is WIRED by CONSTRUCTION with the
///         multi-venue router as its `adapter_`. This surfaces integration bugs a unit test can't:
///         the vault's `maxSuppliable`/`_supplyToAdapter`/`_pullUSDC` seams calling into a router that
///         itself fans across N children — the exact assembly, not each part in isolation.
contract YieldLoopIntegration is Test {
    // ── actors ──────────────────────────────────────────────────────────────────────
    address internal curator   = makeAddr("curator");   // owns the router (allocation + rebalance)
    address internal vaultOwner = makeAddr("vaultOwner"); // owns the vault (pause/gateway)
    address internal alice      = makeAddr("alice");      // senior depositor

    // ── stack ───────────────────────────────────────────────────────────────────────
    MockERC20                       internal usdc;
    MockVenueAdapter                internal aave;   // stand-in child venues at different "rates"
    MockVenueAdapter                internal morpho;
    MockVenueAdapter                internal euler;
    MintwareMultiVenueYieldAdapter  internal router; // the curator multi-venue adapter (vault's idle adapter)
    MintwareYieldVault              internal vault;   // the real v1 settlement vault

    uint256 internal constant DEPOSIT   = 100_000e6;    // 100k USDC senior deposit
    // Finite venue caps so the router's maxSuppliable() (Σ of children) can never overflow when the
    // vault reads it before supplying. Realistic: real venues have finite capacity anyway.
    uint256 internal constant VENUE_CAP = 10_000_000e6;

    function setUp() public {
        usdc   = new MockERC20("USD Coin", "USDC", 6);
        aave   = new MockVenueAdapter(IERC20(address(usdc)));
        morpho = new MockVenueAdapter(IERC20(address(usdc)));
        euler  = new MockVenueAdapter(IERC20(address(usdc)));
        aave.setSupplyCap(VENUE_CAP);
        morpho.setSupplyCap(VENUE_CAP);
        euler.setSupplyCap(VENUE_CAP);

        // Deploy the router BEFORE the vault (vault unknown yet → set later via setVault, the deploy
        // chicken-and-egg the router is designed for).
        router = new MintwareMultiVenueYieldAdapter(address(usdc), address(0), curator);

        // Construct the vault WITH the router as its immutable idle adapter — the wiring under test.
        vault = new MintwareYieldVault(address(usdc), address(router), vaultOwner);

        // Wire vault ↔ router both ways: router now trusts the vault as its sole money-path caller.
        // (In prod each CHILD also `setVault(address(router))`; MockVenueAdapter has no such gate and
        //  simply accepts the router as caller, which is the assembled relationship being proven.)
        vm.prank(curator);
        router.setVault(address(vault));

        // Curator's opening allocation: 50 / 30 / 20 across aave / morpho / euler.
        _setWeights(_venues(aave, morpho, euler), _w3(5000, 3000, 2000));

        usdc.mint(alice, 1_000_000e6);
    }

    // ─────────────────────────────────────────────────────────────────────────────────
    //  MAIN: the whole assembled loop, deposit → fan-out → re-weight → rebalance → redeem
    // ─────────────────────────────────────────────────────────────────────────────────
    function test_assembled_loop_fanout_reweight_rebalance_conserves() public {
        // ── 1. deposit senior USDC through the REAL vault ────────────────────────────
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        uint256 sharesMinted = vault.deposit(DEPOSIT, alice);
        vm.stopPrank();

        assertGt(sharesMinted, 0, "shares minted");
        assertEq(vault.totalAssets(), DEPOSIT, "vault NAV == deposit (nothing lost in the seams)");

        // ── 2. assert capital FANNED across children by weight (through vault → router → venues) ──
        assertEq(aave.totalAssets(),   50_000e6, "aave got 50%");
        assertEq(morpho.totalAssets(), 30_000e6, "morpho got 30%");
        assertEq(euler.totalAssets(),  20_000e6, "euler got 20%");
        assertEq(usdc.balanceOf(address(router)), 0, "nothing stranded idle in the router at 100% weight");
        assertEq(router.totalAssets(), DEPOSIT, "router sees the whole deposit");

        // ── 3. keeper re-weights toward the BEST venue (morpho), respecting the per-venue risk cap ──
        //     Cap at 60% first, then push morpho to exactly the cap. Proves the cap is enforced on
        //     the assembled re-weight, not just in a unit test.
        vm.prank(curator);
        router.setMaxVenueWeightBps(6_000);

        // Sanity: an over-cap re-weight is rejected (morpho 70% > 60% cap).
        vm.prank(curator);
        vm.expectRevert(MintwareMultiVenueYieldAdapter.VenueWeightCapExceeded.selector);
        router.setVenues(_venues(morpho, aave, euler), _w3(7_000, 2_000, 1_000));

        // Within cap: morpho 60 / aave 20 / euler 20.
        _setWeights(_venues(morpho, aave, euler), _w3(6_000, 2_000, 2_000));

        // ── 4. rebalance: pull everything back, redeploy by the new weights ──────────
        vm.prank(curator);
        router.rebalance();

        assertEq(morpho.totalAssets(), 60_000e6, "morpho re-weighted to 60%");
        assertEq(aave.totalAssets(),   20_000e6, "aave down to 20%");
        assertEq(euler.totalAssets(),  20_000e6, "euler 20%");
        assertEq(router.totalAssets(), DEPOSIT,  "rebalance conserved capital");
        assertEq(vault.totalAssets(),  DEPOSIT,  "vault NAV unchanged by an off-path rebalance");

        // ── 5. yield accrues in the best venue (curator's bet pays off) ──────────────
        uint256 yield_ = 3_000e6;
        _accrueYield(morpho, yield_);
        assertEq(vault.totalAssets(), DEPOSIT + yield_, "yield surfaces all the way up to vault NAV");

        // ── 6. depositor redeems ALL shares → conservation end-to-end ────────────────
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(sharesMinted);

        assertEq(usdc.balanceOf(alice) - aliceBefore, out, "redeem paid alice");

        // out ≤ in + yield: the loop NEVER creates value out of thin air (rounding favors the vault).
        assertLe(out, DEPOSIT + yield_, "CONSERVATION: out never exceeds in + yield");
        // …and it's essentially all of it: only sub-cent virtual-offset dust is left behind.
        uint256 DUST = 1e4; // 0.01 USDC
        assertGe(out, DEPOSIT + yield_ - DUST, "depositor recovers principal + yield (minus dust)");

        // Nothing meaningfully stranded anywhere in the assembled stack.
        assertEq(vault.totalShares(), 0, "all shares burned");
        assertLe(vault.totalAssets(), DUST, "residual across router+venues is only virtual-offset dust");
        assertLe(usdc.balanceOf(address(vault)), DUST, "no USDC stuck in the vault buffer");
    }

    // ─────────────────────────────────────────────────────────────────────────────────
    //  DEGRADATION: a stalled venue must degrade gracefully — best-effort, never a brick
    // ─────────────────────────────────────────────────────────────────────────────────
    function test_stalled_venue_degrades_gracefully() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        uint256 sharesMinted = vault.deposit(DEPOSIT, alice); // 50k / 30k / 20k
        vm.stopPrank();

        // euler (20k) stalls — paused, contributes 0 to any withdraw, must not brick the loop.
        euler.setPaused(true);
        assertEq(router.maxWithdrawable(), 80_000e6, "only the two live venues are withdrawable");

        // A redeem the LIVE venues can cover (70k ≤ aave 50k + morpho 30k) succeeds and pays fairly —
        // the router serves it best-effort across the two live venues, no revert anywhere.
        uint256 seventyPct = sharesMinted * 70 / 100;
        uint256 before1 = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 out1 = vault.redeem(seventyPct);
        assertEq(out1, 70_000e6, "served 70k from the live venues despite a stalled one");
        assertEq(usdc.balanceOf(alice) - before1, out1, "alice paid");
        assertEq(euler.totalAssets(), 20_000e6, "the stalled venue's 20k is PRESENT, not lost");

        // An OVER-sized redeem (needs more than the ~10k still live) degrades to a CLEAN revert —
        // the vault refuses to pay short rather than bricking or silently underpaying. Funds stay safe.
        uint256 rest = sharesMinted - seventyPct; // ~30k of shares, only ~10k live liquidity
        vm.prank(alice);
        vm.expectRevert(MintwareYieldVault.InsufficientIdleLiquidity.selector);
        vault.redeem(rest);

        // Recovery: unpause the stalled venue → the same redeem now clears. Total conservation holds.
        euler.setPaused(false);
        uint256 before2 = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 out2 = vault.redeem(rest);
        assertEq(usdc.balanceOf(alice) - before2, out2, "alice paid after recovery");

        assertEq(vault.totalShares(), 0, "all shares eventually redeemed");
        // Full round-trip conservation: alice never gets more than she put in (no yield here).
        assertLe(out1 + out2, DEPOSIT, "CONSERVATION across the stall+recovery cycle");
        assertGe(out1 + out2, DEPOSIT - 1e4, "and recovers ~all of it once the venue heals");
    }

    // ─────────────────────────────────────────────────────────────────────────────────
    //  INTEGRATION FINDING (documented, not fixed here — src/ is untouched by this test):
    //  the router's maxSuppliable() sums children UNCHECKED, so ≥2 uncapped children overflow.
    // ─────────────────────────────────────────────────────────────────────────────────
    /// @notice **Assembled-only DoS a unit test can't see.** `MintwareMultiVenueYieldAdapter.maxSuppliable()`
    ///         returns `Σ child.maxSuppliable()` with no saturation. A real `AaveV3YieldAdapter` returns
    ///         `type(uint256).max` when its Aave reserve has no supply cap, and `MintwareERC4626YieldAdapter`
    ///         returns `yieldSource.maxDeposit()` — `type(uint256).max` for a standard OZ ERC-4626 with no
    ///         deposit limit. So the EXACT "curator over Aave + Morpho/Euler" composition the contract's own
    ///         NatSpec advertises puts two `uint256.max` values into that sum → it overflows and REVERTS.
    ///
    ///         Because `MintwareYieldVault._supplyToAdapter` reads `adapter.maxSuppliable()` on the deposit
    ///         path OUTSIDE any try/catch, that revert bricks EVERY deposit into a vault wired to such a
    ///         router — a full deposit-path DoS. The router's own unit suite never catches it: those tests
    ///         call `router.deposit()` directly (the test contract is the "vault") and never read
    ///         `maxSuppliable()`, and they always set finite mock supply caps. Only the ASSEMBLED vault→router
    ///         path surfaces it.
    ///
    ///         FIXED (fix/multivenue-headroom-overflow): `maxSuppliable()`/`maxWithdrawable()` now use a
    ///         SATURATING sum (`_satAdd`), so two uncapped children report `type(uint256).max` (effectively
    ///         unbounded headroom) instead of overflowing and bricking the deposit path. This test now
    ///         asserts the deposit SUCCEEDS — it will go red again if the saturation is ever removed.
    function test_FIXED_uncapped_children_deposit_succeeds() public {
        MockVenueAdapter c1 = new MockVenueAdapter(IERC20(address(usdc))); // no cap => maxSuppliable == uint256.max
        MockVenueAdapter c2 = new MockVenueAdapter(IERC20(address(usdc))); // no cap => maxSuppliable == uint256.max

        MintwareMultiVenueYieldAdapter r2 =
            new MintwareMultiVenueYieldAdapter(address(usdc), address(0), curator);
        MintwareYieldVault v2 = new MintwareYieldVault(address(usdc), address(r2), vaultOwner);
        vm.prank(curator);
        r2.setVault(address(v2));

        IYieldAdapter[] memory vs = new IYieldAdapter[](2);
        vs[0] = c1; vs[1] = c2;
        uint16[] memory ws = new uint16[](2);
        ws[0] = 5_000; ws[1] = 5_000;
        vm.prank(curator);
        r2.setVenues(vs, ws);

        // The two uncapped children saturate to an unbounded ceiling instead of overflowing.
        assertEq(r2.maxSuppliable(), type(uint256).max, "saturating sum should report unbounded, not revert");

        vm.startPrank(alice);
        usdc.approve(address(v2), type(uint256).max);
        uint256 shares = v2.deposit(1_000e6, alice); // no longer reverts
        vm.stopPrank();
        assertGt(shares, 0, "deposit should mint shares");
        assertEq(v2.totalAssets(), 1_000e6, "deposited capital accounted, money path not bricked");
    }

    // ─────────────────────────────────────────────────────────────────────────────────
    //  helpers
    // ─────────────────────────────────────────────────────────────────────────────────
    function _venues(MockVenueAdapter a, MockVenueAdapter b, MockVenueAdapter c)
        internal
        pure
        returns (IYieldAdapter[] memory v)
    {
        v = new IYieldAdapter[](3);
        v[0] = a; v[1] = b; v[2] = c;
    }

    function _w3(uint16 a, uint16 b, uint16 c) internal pure returns (uint16[] memory w) {
        w = new uint16[](3);
        w[0] = a; w[1] = b; w[2] = c;
    }

    function _setWeights(IYieldAdapter[] memory v, uint16[] memory w) internal {
        vm.prank(curator);
        router.setVenues(v, w);
    }

    /// @dev Accrue yield in a venue the way the MockVenueAdapter models it — donate underlying it holds,
    ///      which raises its totalAssets and thus the whole stack's NAV.
    function _accrueYield(MockVenueAdapter venue, uint256 amount) internal {
        usdc.mint(address(this), amount);
        usdc.approve(address(venue), amount);
        venue.simulateYield(amount);
    }
}
