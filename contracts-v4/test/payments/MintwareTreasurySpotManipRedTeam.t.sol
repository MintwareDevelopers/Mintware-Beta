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
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @title  RED-TEAM: single-block spot manipulation of the hookless senior redeem NAV
/// @notice Thesis under test: on a pool with NO JIT-hook truncated oracle (`oReady == false`), the vault's
///         `recoverableUSDC()` falls back to PURE SPOT (see `MWTreasuryPositionLib._recoverable`). In the
///         impaired tail (junior buffer exhausted) the senior redeem NAV = `min(par, realizable)` where
///         `realizable` depends on that pure-spot LP mark. An IMPAIRED senior holder who pumps the pool
///         spot UP within their own redeem block should be able to lift `realizable` back toward par,
///         redeem at (near) par instead of taking their fair pro-rata solvency haircut, and shift the
///         loss to whoever redeems after them (the "first-redeemer run" H1 claims to have closed — but
///         its closure relies on the min(spot,oracle) oracle, which is ABSENT here).
///
/// @dev    Deliberately worst-case + thin (Tier-C) pool. Hookless pool ⇒ `oReady == false` ⇒ pure spot.
contract MintwareTreasurySpotManipRedTeam is Test {
    PoolManager             internal pm;
    PoolModifyLiquidityTest internal lpRouter;
    TestSwapRouter          internal swapRouter;

    MintwareTreasuryVault internal vault;
    MockYieldAdapter      internal adapter;

    MockERC20 internal usdc;
    MockERC20 internal team;
    PoolKey   internal key;

    address internal owner    = makeAddr("owner");
    address internal teamAddr = makeAddr("team");
    address internal gateway  = makeAddr("gateway");
    address internal alice    = makeAddr("alice");   // the attacker (an impaired senior holder)
    address internal bob      = makeAddr("bob");      // the victim (redeems after)
    address internal dumper   = makeAddr("dumper");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant TEAM_COMMIT = 5_000_000 ether;

    bool internal usdcIs0;
    bool internal teamIs0;

    function setUp() public {
        pm         = new PoolManager(address(this));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));

        usdc = new MockERC20("USD Coin", "USDC", 18);
        team = new MockERC20("Team Token", "TEAM", 18);
        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        // hooks = address(0) → hookless → recoverableUSDC() falls back to PURE SPOT.
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        pm.initialize(key, INIT_SQRT_PRICE);

        usdcIs0 = address(usdc) < address(team);
        teamIs0 = !usdcIs0;

        adapter = new MockYieldAdapter(address(usdc));
        vault   = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, teamAddr);

        vm.startPrank(owner);
        vault.setGateway(gateway);
        vault.setProtocolTreasury(makeAddr("protocol"));
        vm.stopPrank();

        // Team commits junior TOKENS only; juniorUsdcBuffer = 0 (matches the RealPool rig).
        team.mint(teamAddr, TEAM_COMMIT);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        vault.commitTeam(TEAM_COMMIT, 0, 365 days);
        vm.stopPrank();

        // THIN (Tier-C) baseline pool liquidity — cheap to move spot within a single block.
        usdc.mint(address(this), 2_000_000e18);
        team.mint(address(this), 2_000_000e18);
        usdc.approve(address(lpRouter), type(uint256).max);
        team.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 150_000e18, salt: bytes32(0)}),
            ""
        );

        // Two equal senior holders: alice + bob, $50k each → $100k senior.
        usdc.mint(alice, 50_000e18);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(50_000e18, 0, alice);
        vm.stopPrank();

        usdc.mint(bob, 50_000e18);
        vm.startPrank(bob);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(50_000e18, 0, bob);
        vm.stopPrank();
    }

    function _deployMax() internal {
        vm.prank(owner);
        vault.deployToLP(20_000e18, 20_000e18); // idle-first caps at 20% of $100k base
    }

    /// @dev Arm the coverage floor so that (in the tests below) a `deployToLP` that DID have a ready oracle
    ///      would not additionally trip the FIX-3 CoverageFloorUnset gate. Not needed for the OracleNotReady
    ///      assertions (that gate fires first), but keeps the intent explicit.
    function _armCoverage() internal {
        vm.prank(owner);
        vault.setMinCoverage(10_000);
    }

    // Sell team hard → team price collapses → vault LP marks low → impairment.
    function _impair() internal {
        team.mint(dumper, 5_000_000e18);
        vm.startPrank(dumper);
        team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, teamIs0, 1_500_000e18); // team -> usdc
        vm.stopPrank();
    }

    // Buy team hard within alice's block → team price pumps UP → vault LP marks HIGH again.
    function _pumpUp(address who, uint256 usdcIn) internal {
        usdc.mint(who, usdcIn);
        vm.startPrank(who);
        usdc.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, usdcIs0, usdcIn); // usdc -> team, pushes team price up
        vm.stopPrank();
    }

    /// @notice FIX 2a (oracle-tail spot-manip, High) — attack BLOCKED at the structural gate. The entire
    ///         exploit requires a LIVE LP position valued off PURE SPOT (a hookless pool ⇒ `oReady == false`).
    ///         `deployToLP` now refuses to expose senior to the LP without a ready (manipulation-resistant)
    ///         oracle, so the attacker can never establish the position the manipulation acts on. With no
    ///         position, `recoverableUSDC()` is 0 — a same-block pump has nothing to inflate.
    function test_RedTeam_SpotPump_deployBlockedByOracleGate() public {
        _armCoverage(); // isolate the oracle gate (so a CoverageFloorUnset can't be the reason)

        // The deploy that the attack depended on now reverts: no ready oracle on this hookless pool.
        vm.prank(owner);
        vm.expectRevert(MintwareTreasuryVault.OracleNotReady.selector);
        vault.deployToLP(20_000e18, 20_000e18);

        // The manipulable state is unreachable: nothing is deployed, so the pure-spot LP mark is 0 and a
        // single-block pump cannot lift the senior redeem NAV.
        assertEq(vault.positionLiquidity(), 0, "no LP position was ever created");
        assertEq(vault.deployedFromSenior(), 0, "no senior exposed to the LP");
        _impair();
        _pumpUp(alice, 400_000e18);
        assertEq(vault.recoverableUSDC(), 0, "no live position => nothing for the pump to inflate");
    }

    /// @notice FIX 2b (belt-and-suspenders) — even if a position existed, the senior redeem/settle valuation
    ///         fails CLOSED rather than pay off a manipulable spot: `recoverableUSDC()` (and therefore
    ///         `seniorRealizableAssets`/`_redeemNav`/`redeemSenior`) revert `OracleNotReady` whenever a live
    ///         position (`positionLiquidity>0`) has no ready oracle. Here we can only observe the structural
    ///         gate (the hookless config never lets a position form), which is the stronger guarantee. The
    ///         POSITIVE proof that the `min(spot,oracle)` mark neutralizes the pump under a REAL truncated
    ///         oracle lives in `MintwareTreasuryJitLeakPoC` (senior stays whole across 8 sandwich rounds).
    function test_RedTeam_NetProfitable_nowUnreachable() public {
        _armCoverage();

        // The full economic attack (pump → redeem-at-inflated-mark → unwind, shifting loss to bob) cannot
        // begin: the deploy it front-runs reverts, so there is no spot-priced LP leg to lift.
        vm.prank(owner);
        vm.expectRevert(MintwareTreasuryVault.OracleNotReady.selector);
        vault.deployToLP(20_000e18, 20_000e18);

        // Redemptions on the (fully-idle, uncrashed) vault price at par regardless of any pool spot move —
        // the senior claim is price-free until senior is LP-exposed, which the gate now prevents.
        _impair();
        _pumpUp(alice, 400_000e18);
        uint256 aliceShares = vault.seniorShares(alice);
        vm.prank(alice);
        uint256 aliceOut = vault.redeemSenior(aliceShares, 0);
        emit log_named_uint("alice out (idle senior, pump has no effect)", aliceOut);
        assertGe(aliceOut, 50_000e18 - 2, "idle senior redeems ~par; the spot pump is inert");
    }
}
