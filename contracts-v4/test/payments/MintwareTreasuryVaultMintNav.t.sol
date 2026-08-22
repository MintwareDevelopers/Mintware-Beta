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

import {MintwareTreasuryVault}     from "../../src/payments/MintwareTreasuryVault.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @notice AUDIT R2-H1 regression. Round-1 H1 priced BOTH mint and redeem against the solvency-aware
///         `min(spot,oracle)` NAV. That let a depositor DEFLATE the mint price in-tx by pushing the vault's
///         own pool spot DOWN (recoverableUSDC → realizable NAV collapses → MORE shares minted per USDC),
///         then restore spot and redeem at par → extract from existing senior holders. The fix prices the
///         MINT path at par (`totalSeniorAssets()`, non-downward-manipulable) while keeping `min(spot,oracle)`
///         on the REDEEM path. This proves the mint side is now spot-invariant and the deposit→redeem arb is
///         closed, while confirming the redeem-side protection still reacts to a genuine impairment.
///
/// @dev    Deliberately THIN baseline pool liquidity (vs `MintwareTreasuryVaultRealPool.t.sol`'s deep one) so
///         a modest team dump can crater the team leg's mark below the deployed senior par — the condition
///         under which the round-1 NAV would have differed on the mint path.
contract MintwareTreasuryVaultMintNavTest is Test {
    PoolManager             internal pm;
    PoolModifyLiquidityTest internal lpRouter;
    TestSwapRouter          internal swapRouter;

    MintwareTreasuryVault internal vault;
    MockYieldAdapter      internal adapter;

    MockERC20 internal usdc;
    MockERC20 internal team;
    PoolKey   internal key;
    bool      internal usdcIs0;

    address internal owner    = makeAddr("owner");
    address internal teamAddr = makeAddr("team");
    address internal gateway  = makeAddr("gateway");
    address internal alice    = makeAddr("alice");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant TEAM_COMMIT = 5_000_000 ether;

    function setUp() public {
        pm         = new PoolManager(address(this));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));

        usdc = new MockERC20("USD Coin", "USDC", 18);
        team = new MockERC20("Team Token", "TEAM", 18);
        usdcIs0 = address(usdc) < address(team);
        (Currency c0, Currency c1) = usdcIs0
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        pm.initialize(key, INIT_SQRT_PRICE);

        adapter = new MockYieldAdapter(address(usdc));
        vault   = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, teamAddr);

        vm.prank(owner);
        vault.setGateway(gateway);

        team.mint(teamAddr, TEAM_COMMIT);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        vault.commitTeam(TEAM_COMMIT, 0, 365 days);
        vm.stopPrank();

        // THIN baseline liquidity so a team dump can crater the mark below deployed par.
        usdc.mint(address(this), 2_000_000e18);
        team.mint(address(this), 2_000_000e18);
        usdc.approve(address(lpRouter), type(uint256).max);
        team.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 120_000e18, salt: bytes32(0)}),
            ""
        );

        // Alice deposits $100k senior, then the keeper deploys the idle-first slice (20% of base).
        usdc.mint(alice, 100_000e18);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(100_000e18, 0, alice);
        vm.stopPrank();

        vm.prank(owner);
        vault.deployToLP(20_000e18, 20_000e18);
    }

    /// @dev Dump `amt` team into the pool → team's USDC price craters → recoverableUSDC collapses.
    function _crashTeam(uint256 amt) internal {
        address t = makeAddr("crasher");
        team.mint(t, amt);
        vm.startPrank(t);
        team.approve(address(swapRouter), type(uint256).max);
        bool teamIs0 = !usdcIs0;
        swapRouter.swap(key, teamIs0, amt); // selling team lowers its price
        vm.stopPrank();
    }

    /// @dev Buy team back to push spot roughly back up (approximate restore).
    function _restoreTeam(uint256 amt) internal {
        address t = makeAddr("restorer");
        usdc.mint(t, amt);
        vm.startPrank(t);
        usdc.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, usdcIs0, amt); // selling USDC raises team price
        vm.stopPrank();
    }

    /// The MINT path is priced at par → invariant to a spot manipulation, while the REDEEM path reacts.
    function test_R2H1_mintNavIsSpotInvariant() public {
        uint256 parBefore  = vault.totalSeniorAssets();
        uint256 realBefore = vault.seniorRealizableAssets();
        uint256 pdBefore   = vault.previewDeposit(10_000e18);
        uint256 caBefore   = vault.convertToAssets(1e18);
        uint256 deployed   = vault.deployedFromSenior();
        assertGt(deployed, 0, "some senior deployed");

        _crashTeam(1_000_000e18);

        // Precondition: the manipulation genuinely depressed the redeem-side (solvency-aware) NAV below par.
        assertLt(vault.recoverableUSDC(), deployed, "sanity: recoverableUSDC crashed below deployed par");
        assertLt(vault.seniorRealizableAssets(), realBefore, "sanity: realizable NAV dropped");
        assertLt(vault.seniorRealizableAssets(), parBefore, "sanity: realizable < par under the crash");

        // The mint side must be UNMOVED — par accounting is not downward-manipulable.
        assertEq(vault.totalSeniorAssets(), parBefore, "par NAV spot-invariant");
        assertEq(vault.previewDeposit(10_000e18), pdBefore, "previewDeposit spot-invariant (R2-H1)");
        assertEq(vault.convertToAssets(1e18), caBefore, "convertToAssets spot-invariant (R2-H1)");
    }

    /// The full attack: deposit while spot is depressed, restore spot, redeem at par → NO profit.
    function test_R2H1_noDepositRedeemArb() public {
        address attacker = makeAddr("attacker");
        uint256 stake = 40_000e18;
        usdc.mint(attacker, stake);
        vm.prank(attacker);
        usdc.approve(address(vault), type(uint256).max);

        _crashTeam(1_000_000e18);
        vm.prank(attacker);
        uint256 shares = vault.depositUSDC(stake, 0, attacker);

        _restoreTeam(1_100_000e18);

        vm.prank(attacker);
        uint256 out = vault.redeemSenior(shares, 0);

        // With mint priced at par, depositing into a spot-depressed pool cannot over-issue shares, so a
        // later redeem at (restored) par can never return more than was staked. On the round-1 code the
        // depressed mint NAV would have over-issued shares → out > stake.
        assertLe(out, stake, "R2-H1: deposit-at-low-spot then redeem-at-par must not profit");
    }
}
