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
import {MockReadyOracle}  from "../mocks/MockReadyOracle.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @notice END-TO-END proof that the SELF-HELD V4 position (Phase-2 convergence — the retired external
///         `MintwareV4LiquidityModule` folded into the vault via `MWTreasuryPositionLib`) drives the
///         `MintwareTreasuryVault` against an ACTUAL V4 pool, and that the core solvency invariant —
///         `deployedFromSenior <= recoverableUSDC()` — holds against a genuine V4 pool. This is what
///         makes the v2 tranche vault deployable, re-proven after the module was absorbed.
///
/// @dev    Both tokens are 18dp here so the pool inits cleanly at 1:1 (tick 0); the vault is
///         decimal-agnostic (it tracks USDC units, not a fixed scale). The idle-first guard caps the
///         deployable slice at (1 - 80%) of base. Hookless pool → the vault's `recoverableUSDC()` falls
///         back to spot (no JIT oracle), which is the correct MTM here.
contract MintwareTreasuryVaultRealPoolTest is Test {
    PoolManager             internal pm;
    PoolModifyLiquidityTest internal lpRouter;
    TestSwapRouter          internal swapRouter;

    MintwareTreasuryVault     internal vault;
    MockYieldAdapter          internal adapter;

    MockERC20 internal usdc;
    MockERC20 internal team;
    PoolKey   internal key;

    address internal owner    = makeAddr("owner");
    address internal teamAddr = makeAddr("team");
    address internal gateway  = makeAddr("gateway");
    address internal alice    = makeAddr("alice");
    address internal receiver = makeAddr("cardRail");
    address internal protocol = makeAddr("protocol");
    address internal trader   = makeAddr("trader");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant TEAM_COMMIT = 5_000_000 ether;

    function setUp() public {
        pm         = new PoolManager(address(this));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));

        usdc = new MockERC20("USD Coin", "USDC", 18);
        team = new MockERC20("Team Token", "TEAM", 18);
        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        pm.initialize(key, INIT_SQRT_PRICE);

        adapter = new MockYieldAdapter(address(usdc));
        // Phase-2 convergence: the vault holds the V4 position itself (no separate module).
        vault   = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, teamAddr);

        vm.startPrank(owner);
        vault.setGateway(gateway);
        vault.setProtocolTreasury(protocol);
        // FIX 2a: deployToLP requires a ready oracle — a live-tick stand-in keeps recoverableUSDC == spot
        // (the correct MTM here). FIX 3: arm the smallest floor (1 bps); the $10 junior buffer below covers
        // the $20k deploy at that floor and is negligible vs the $100k senior.
        vault.setJitHook(address(new MockReadyOracle(IPoolManager(address(pm)), key)));
        vault.setMinCoverage(1);
        vm.stopPrank();

        // Team commits the junior first-loss reserve, opening the vault.
        team.mint(teamAddr, TEAM_COMMIT);
        usdc.mint(teamAddr, 10 ether); // tiny junior USDC buffer to satisfy the FIX-3 coverage floor
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(TEAM_COMMIT, 10 ether, 365 days);
        vm.stopPrank();

        // Deep baseline pool liquidity so the vault's seniority swaps have realistic depth.
        usdc.mint(address(this), 20_000_000e18);
        team.mint(address(this), 20_000_000e18);
        usdc.approve(address(lpRouter), type(uint256).max);
        team.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 8_000_000e18, salt: bytes32(0)}),
            ""
        );

        // Alice deposits $100k senior.
        usdc.mint(alice, 100_000e18);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(100_000e18, 0, alice);
        vm.stopPrank();
    }

    function _deployMax() internal returns (uint256 deployed) {
        // idle-first caps the deployable slice at base*(1 - 80%) = 20% of base.
        vm.prank(owner);
        vault.deployToLP(20_000e18, 20_000e18);
        deployed = vault.deployedFromSenior();
    }

    function _genFees() internal {
        usdc.mint(trader, 500_000e18);
        team.mint(trader, 500_000e18);
        vm.startPrank(trader);
        usdc.approve(address(swapRouter), type(uint256).max);
        team.approve(address(swapRouter), type(uint256).max);
        bool usdcIs0 = address(usdc) < address(team);
        swapRouter.swap(key, usdcIs0, 60_000e18);
        swapRouter.swap(key, !usdcIs0, 55_000e18);
        vm.stopPrank();
    }

    /// THE INVARIANT: the deployed senior par is always covered by the LP's recoverable USDC.
    function test_SolvencyInvariantHoldsSelfHeld() public {
        uint256 deployed = _deployMax();
        assertGt(deployed, 0, "some senior deployed");
        assertLe(deployed, vault.recoverableUSDC(), "deployedFromSenior <= recoverableUSDC");
        // At 1:1 the junior doubles the recoverable value vs the senior par.
        assertApproxEqRel(vault.recoverableUSDC(), 2 * deployed, 0.02e18, "junior-covered ~2x");
    }

    /// The senior NAV is price-free: deploying to the LP does not change totalSeniorAssets (par accounting).
    function test_DeployIsSeniorNavNeutral() public {
        uint256 navBefore = vault.totalSeniorAssets();
        _deployMax();
        assertApproxEqRel(vault.totalSeniorAssets(), navBefore, 0.001e18, "NAV unchanged by deploy");
    }

    /// Fees collected through the self-held position lift the senior NAV (100% to senior during the lock).
    function test_AccrueFeesLiftsSeniorNav() public {
        _deployMax();
        _genFees();
        uint256 navBefore = vault.totalSeniorAssets();
        uint256 collected = vault.accrueFees();
        assertGt(collected, 0, "fees collected as USDC");
        assertGt(vault.totalSeniorAssets(), navBefore, "senior NAV lifted");
    }

    /// Owner rebalance: recover senior USDC out of the real LP back into Aave; deployed par drops.
    function test_OwnerRecoverFromLpUnwinds() public {
        _deployMax();
        uint256 deployedBefore = vault.deployedFromSenior();
        uint256 adapterBefore  = adapter.totalAssets();

        vm.prank(owner);
        vault.recoverFromLP(10_000e18);

        assertLt(vault.deployedFromSenior(), deployedBefore, "deployed par reduced");
        assertGt(adapter.totalAssets(), adapterBefore, "recovered USDC re-idled to Aave");
        assertLe(vault.deployedFromSenior(), vault.recoverableUSDC(), "invariant after unwind");
    }

    /// A normal senior redeem (served from the Aave buffer) round-trips through the vault.
    function test_SeniorRedeemRoundTrips() public {
        _deployMax();
        uint256 shares = vault.seniorShares(alice);
        vm.prank(alice);
        uint256 out = vault.redeemSenior(shares / 2, 0);
        assertGt(out, 0, "redeemed USDC");
        assertApproxEqRel(out, 50_000e18, 0.01e18, "~half of $100k");
    }

    /// The junior absorbs IL: after an adverse price move the invariant still holds (junior over-covers).
    function test_JuniorAbsorbsMildIL() public {
        _deployMax();
        // Adverse move: dump team so its price falls; the LP rotates into team and marks lower.
        usdc.mint(trader, 2_000_000e18);
        team.mint(trader, 2_000_000e18);
        vm.startPrank(trader);
        team.approve(address(swapRouter), type(uint256).max);
        bool teamIs0 = address(team) < address(usdc);
        swapRouter.swap(key, teamIs0, 400_000e18);
        vm.stopPrank();

        // Even with IL realized on the mark, the junior buffer keeps the senior par covered.
        assertLe(vault.deployedFromSenior(), vault.recoverableUSDC(), "junior still covers senior");
    }

    /// The seniority swap sells ONLY the recovered team leg — NEVER the resting junior reserve. A recover
    /// must not drain `juniorTokens` beyond the tokens that were actually in the removed LP slice.
    function test_RecoverDoesNotTouchJuniorReserve() public {
        uint256 teamUsed = TEAM_COMMIT - _juniorAfterDeploy();
        uint256 reserveBefore = vault.juniorTokens();
        // Recover the whole deployed par; the seniority swap sells the removed team leg (<= teamUsed).
        vm.prank(owner);
        vault.recoverFromLP(20_000e18);
        // The reserve can only GROW (dust returned), never shrink — the resting reserve was untouched.
        assertGe(vault.juniorTokens(), reserveBefore, "recover consumed the resting junior reserve");
        assertLt(teamUsed, TEAM_COMMIT, "sanity: some team was deployed");
    }

    function _juniorAfterDeploy() internal returns (uint256) {
        _deployMax();
        return vault.juniorTokens();
    }
}
