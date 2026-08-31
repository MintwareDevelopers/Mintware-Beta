// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PoolManager}  from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}       from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}      from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}     from "@uniswap/v4-core/src/types/Currency.sol";

import {MintwareTreasuryVault}          from "../../src/payments/MintwareTreasuryVault.sol";
import {MintwareMultiVenueYieldAdapter} from "../../src/vaults/MintwareMultiVenueYieldAdapter.sol";
import {IYieldAdapter}                  from "../../src/vaults/IYieldAdapter.sol";

import {MockERC20}             from "../mocks/MockERC20.sol";
import {MockVenueAdapter}      from "../mocks/MockVenueAdapter.sol";
import {MaliciousVenueAdapter} from "../mocks/MaliciousVenueAdapter.sol";

/// @title  FIX-1 verification - inflated multi-venue NAV can NO LONGER extract value from a TreasuryVault
/// @notice End-to-end: back a REAL MintwareTreasuryVault's senior tranche with a
///         MintwareMultiVenueYieldAdapter, wire a lying child (a curator action), and show that after the
///         principal-clamp FIX the phantom NAV is DROPPED - the attacker's redeem stays at ~par (net profit
///         ~ 0) and the junior first-loss buffer is NOT drained. The vault reads `adapter.totalAssets()`
///         straight into its senior NAV (MintwareTreasuryVault `totalSeniorAssets` / `seniorRealizableAssets`),
///         so the clamp is what keeps a fabricated child NAV from flowing into the redeem price.
contract MultiVenueTreasuryExtractionPoC is Test {
    MockERC20 internal usdc; // 6dp senior asset
    MockERC20 internal team; // 6dp junior asset

    PoolManager                    internal pm;
    MintwareTreasuryVault          internal vault;
    MintwareMultiVenueYieldAdapter internal router;
    MockVenueAdapter               internal honest;
    MaliciousVenueAdapter          internal evil;
    PoolKey                        internal key;

    address internal owner    = makeAddr("owner");
    address internal curator  = makeAddr("curator");  // multi-venue owner (wires children)
    address internal teamAddr = makeAddr("team");
    address internal gateway  = makeAddr("gateway");
    address internal protocol = makeAddr("protocol");
    address internal alice    = makeAddr("alice");    // honest senior depositor
    address internal attacker = makeAddr("attacker");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant ONE_USDC = 1e6;
    uint256 internal constant LOCK_DUR = 365 days;
    uint256 internal constant TEAM_COMMIT = 5_000_000 * 1e6;
    uint256 internal constant JUNIOR_USDC = 200_000 * 1e6; // team first-loss buffer

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Team Token", "TEAM", 6);

        pm = new PoolManager(address(this));
        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        pm.initialize(key, INIT_SQRT_PRICE);

        // The vault's idle sink is the MULTI-VENUE ROUTER (drop-in for the single Aave adapter).
        honest = new MockVenueAdapter(IERC20(address(usdc)));
        evil   = new MaliciousVenueAdapter(IERC20(address(usdc)));
        router = new MintwareMultiVenueYieldAdapter(address(usdc), address(0), curator); // vault set post-deploy

        vault = new MintwareTreasuryVault(address(pm), key, address(usdc), address(router), owner, teamAddr);

        // Chicken-and-egg: bind the router to the vault (one-time), then trust + wire the children.
        vm.startPrank(curator);
        router.setVault(address(vault));
        router.setVenueTrust(address(honest), true);
        router.setVenueTrust(address(evil), true);   // evil = a vetted-then-compromised venue
        router.setMaxVenueWeightBps(10_000);          // allow the 100% honest routing this PoC uses
        IYieldAdapter[] memory v = new IYieldAdapter[](2);
        v[0] = honest; v[1] = evil;
        uint16[] memory w = new uint16[](2);
        w[0] = 10_000; w[1] = 0; // 100% honest routing; evil holds nothing - pure phantom NAV
        router.setVenues(v, w);
        vm.stopPrank();

        vm.startPrank(owner);
        vault.setGateway(gateway);
        vault.setProtocolTreasury(protocol);
        vm.stopPrank();

        // Team commits + funds a $200k junior first-loss USDC buffer, then activates.
        team.mint(teamAddr, TEAM_COMMIT);
        usdc.mint(teamAddr, JUNIOR_USDC);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(TEAM_COMMIT, JUNIOR_USDC, LOCK_DUR);
        vm.stopPrank();
    }

    function _deposit(address who, uint256 amt) internal returns (uint256 shares) {
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(vault), type(uint256).max);
        shares = vault.depositUSDC(amt, 0, who);
        vm.stopPrank();
    }

    function test_Fix_phantom_nav_cannot_extract_real_value() public {
        // Honest state: alice + attacker each deposit $100k at ~par.
        _deposit(alice, 100_000 * ONE_USDC);
        uint256 attackerShares = _deposit(attacker, 100_000 * ONE_USDC);

        uint256 navHonest = vault.totalSeniorAssets();
        uint256 juniorBefore = vault.juniorUsdcBuffer();
        emit log_named_decimal_uint("senior NAV (honest)", navHonest, 6);
        emit log_named_decimal_uint("junior first-loss buffer (before)", juniorBefore, 6);
        assertApproxEqAbs(navHonest, 200_000 * ONE_USDC, 5 * ONE_USDC, "roughly $200k real senior backing");
        assertEq(juniorBefore, JUNIOR_USDC, "team committed $200k first-loss");

        // ── THE LIE ── curator's compromised child fabricates $200k of NAV out of thin air.
        //    NO real loss event has occurred; the phantom is pure fabrication.
        evil.setPhantom(200_000 * ONE_USDC);

        // ── FIX ── the router clamps evil's contribution to its deployed principal ($0) + band ($0) = $0,
        //    so the fabricated NAV never reaches the senior mark.
        uint256 navAfterLie = vault.totalSeniorAssets();
        emit log_named_decimal_uint("senior NAV (after the lie, clamped)", navAfterLie, 6);
        assertApproxEqAbs(navAfterLie, navHonest, 1 * ONE_USDC, "phantom NAV DROPPED - senior mark unchanged");

        // Attacker redeems ALL their shares. With the phantom clamped, they get ~par (no extraction).
        uint256 attackerBefore = usdc.balanceOf(attacker);
        vm.prank(attacker);
        uint256 aOut = vault.redeemSenior(attackerShares, 0);
        emit log_named_decimal_uint("attacker redeemed (deposited $100k)", aOut, 6);

        // ── ATTACK BLOCKED ── deposited $100k, pulled out ~$100k. Net profit ~ 0 (allow $1 rounding dust).
        assertLe(aOut, 100_000 * ONE_USDC + 1 * ONE_USDC, "attacker cannot extract MORE than deposited");
        emit log_named_decimal_uint(
            "attacker net (should be ~0)",
            aOut > 100_000 * ONE_USDC ? aOut - 100_000 * ONE_USDC : 0,
            6
        );

        // Alice (honest holder) also redeems - at par, not at an inflated mark.
        uint256 aliceOut = redeemSenior_as(alice);
        emit log_named_decimal_uint("alice redeemed (deposited $100k)", aliceOut, 6);
        assertLe(aliceOut, 100_000 * ONE_USDC + 1 * ONE_USDC, "alice also redeems at ~par, not inflated");

        // ── THE JUNIOR BUFFER IS SAFE ── no fabricated "yield" was paid, so first-loss capital is intact.
        uint256 juniorAfter = vault.juniorUsdcBuffer();
        emit log_named_decimal_uint("junior first-loss buffer (after)", juniorAfter, 6);
        emit log_named_decimal_uint("total paid to senior redeemers", aOut + aliceOut, 6);
        assertEq(juniorAfter, juniorBefore, "junior first-loss capital NOT drained by the fabricated NAV");
        assertLe(aOut + aliceOut, 200_000 * ONE_USDC + 2 * ONE_USDC, "seniors paid only ~their real principal");
    }

    /// @dev helper: `who` redeems their whole senior balance.
    function redeemSenior_as(address who) internal returns (uint256) {
        uint256 sh = vault.seniorShares(who);
        vm.prank(who);
        return vault.redeemSenior(sh, 0);
    }
}
