// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}             from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}            from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                  from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}                 from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}                from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams}   from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}                from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {MintwareTreasuryVault} from "../../src/payments/MintwareTreasuryVault.sol";
import {MockERC20}             from "../mocks/MockERC20.sol";
import {MockYieldAdapter}      from "../mocks/MockYieldAdapter.sol";
import {MockReadyOracle}       from "../mocks/MockReadyOracle.sol";
import {TestSwapRouter}        from "../helpers/TestSwapRouter.sol";

/// @notice REGRESSION — deploy/recover seam senior-inflation (the deterministic minimization of the fuzzed
///         `invariant_D3a_no_senior_inflation`, TreasuryRebalanceSeamInvariant).
///
///         ROOT CAUSE. `MintwareTreasuryVault.recoverFromLP(usdcWanted)` does NOT bound `usdcWanted` by
///         `deployedFromSenior` — only the fuzz handler / the deposit/idle-first path do. The REDEMPTION
///         waterfall (`_pullUSDC`) calls the same seam with `usdcWanted = f × recoverableUSDC()`, i.e. a
///         fraction of the FULL mid-mark INCLUDING the volatile team leg, which can exceed the deployed
///         senior par. When it does, `recover` unwinds a slice, SELLS its junior team leg to USDC, and the
///         M4 write-down of `deployedFromSenior` is CLAMPED at the deployed par (`dec = deployedFromSenior`).
///         The recovered USDC BEYOND that par (`usdcReturned - dec`) is the proceeds of selling JUNIOR
///         first-loss team tokens — but pre-fix it was left in the free senior buffer, so `totalSeniorAssets`
///         (which counts the free buffer + `deployedFromSenior` at par) rose ABOVE senior capital-in. That
///         is value minted at the seam: junior team-token value promoted into the senior claim.
///
///         The bug is INDEPENDENT of the MWTimelockedRiskParams "L1" change (no risk-param setter runs after
///         activation here) — it reproduces on origin/main too. See the invariant natspec + the report.
///
///         FIX. `_recoverFromLP` earmarks `usdcReturned - dec` to `juniorUsdcBuffer` (the junior first-loss
///         reserve — the team's own liquidated junior capital, excluded from every senior view and returned
///         to the team on `redeemJunior`). A recover then NEVER raises `totalSeniorAssets`.
contract MintwareTreasurySeamSeniorInflationReproTest is Test {
    PoolManager             internal pm;
    PoolModifyLiquidityTest internal lpRouter;
    TestSwapRouter          internal swapRouter;

    MintwareTreasuryVault internal vault;
    MockYieldAdapter      internal adapter;
    MockERC20             internal usdc;
    MockERC20             internal team;
    PoolKey               internal key;

    address internal owner    = makeAddr("owner");
    address internal teamAddr = makeAddr("team");
    address internal lp       = makeAddr("lp");
    address internal alice    = makeAddr("alice");
    address internal trader   = makeAddr("trader");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant LOCK_DUR = 365 days;
    uint256 internal constant JUNIOR_USDC_SEED = 50_000_000_000; // $50k first-loss buffer
    uint256 internal constant SENIOR_DEPOSIT   = 100_000_000_000; // $100k
    uint256 internal constant DUST = 100_000; // 0.1 USDC (matches the invariant)

    function setUp() public {
        pm         = new PoolManager(address(this));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));

        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Team Token", "TEAM", 6);
        adapter = new MockYieldAdapter(address(usdc));

        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        key = PoolKey({currency0: c0, currency1: c1, fee: 0, tickSpacing: SPACING, hooks: IHooks(address(0))});

        vault = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, teamAddr);
        pm.initialize(key, INIT_SQRT_PRICE);

        team.mint(teamAddr, 5_000_000e6);
        usdc.mint(teamAddr, JUNIOR_USDC_SEED);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(5_000_000e6, JUNIOR_USDC_SEED, LOCK_DUR);
        vm.stopPrank();

        vm.startPrank(owner);
        vault.setJitHook(address(new MockReadyOracle(IPoolManager(address(pm)), key)));
        vault.setMinCoverage(1);
        vm.stopPrank();

        // deep baseline pool liquidity (mirrors the invariant rig; keeps the seniority swap ~lossless).
        usdc.mint(lp, 50_000_000e6);
        team.mint(lp, 50_000_000e6);
        vm.startPrank(lp);
        usdc.approve(address(lpRouter), type(uint256).max);
        team.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 40_000_000 * int256(uint256(1e6)), salt: bytes32(0)}),
            ""
        );
        vm.stopPrank();

        usdc.mint(alice, SENIOR_DEPOSIT);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(SENIOR_DEPOSIT, 0, alice);
        vm.stopPrank();

        usdc.mint(trader, 1e30);
        team.mint(trader, 1e30);
        vm.startPrank(trader);
        usdc.approve(address(swapRouter), type(uint256).max);
        team.approve(address(swapRouter), type(uint256).max);
        vm.stopPrank();
    }

    function _deployMax() internal returns (uint256 deployed) {
        uint256 base    = vault.totalSeniorAssets();
        uint256 minIdle = (base * vault.idleBufferTargetBps() + 10_000 - 1) / 10_000;
        uint256 room    = base - minIdle - vault.deployedFromSenior();
        uint256 maxTeam = vault.juniorTokens(); // read BEFORE the prank (arg eval consumes it)
        vm.prank(owner);
        vault.deployToLP(room, maxTeam);
        return vault.deployedFromSenior();
    }

    /// @dev THE seam property: a `recoverFromLP` with `usdcWanted` above the deployed par (exactly what the
    ///      redemption `_pullUSDC` requests) must NOT raise `totalSeniorAssets`. Pre-fix, the team-leg sale
    ///      surplus is promoted into the senior buffer and NAV jumps up.
    function test_recover_beyond_deployedPar_does_not_inflate_senior() public {
        uint256 deployed = _deployMax();
        assertGt(deployed, 0, "precondition: senior deployed");

        uint256 navBefore     = vault.totalSeniorAssets();
        uint256 juniorBefore  = vault.juniorUsdcBuffer();

        // Recover ~1.5x the deployed par — `usdcWanted > deployedFromSenior`, still below the full mark
        // (~2x deployed at 1:1), so `recover` unwinds a slice and sells the team leg. This is the exact
        // shape `_pullUSDC` produces for a senior redeemer holding > 50% of the tranche.
        uint256 usdcWanted = deployed + deployed / 2;
        vm.prank(owner);
        vault.recoverFromLP(usdcWanted);

        uint256 navAfter    = vault.totalSeniorAssets();
        uint256 juniorAfter = vault.juniorUsdcBuffer();

        emit log_named_uint("navBefore        ", navBefore);
        emit log_named_uint("navAfter         ", navAfter);
        emit log_named_uint("juniorUsdc before", juniorBefore);
        emit log_named_uint("juniorUsdc after ", juniorAfter);
        emit log_named_uint("deployedAfter    ", vault.deployedFromSenior());

        // The core invariant: recover cannot MINT senior NAV. Team-leg sale surplus is junior, not senior.
        assertLe(navAfter, navBefore + DUST, "recover minted senior NAV (team-leg sale promoted to senior)");
        // And the surplus is correctly credited to the junior first-loss buffer.
        assertGe(juniorAfter, juniorBefore, "team-leg sale surplus must accrue to junior, never senior");
    }

    /// @dev Broad fuzz of the same property across recover sizes, price moves, and deploy sizes: NO
    ///      single `recoverFromLP` may ever raise senior NAV.
    function testFuzz_recover_never_increases_senior_nav(
        uint256 depSeed,
        uint256 moveSeed,
        bool    up,
        uint256 recSeed
    ) public {
        uint256 base    = vault.totalSeniorAssets();
        uint256 minIdle = (base * vault.idleBufferTargetBps() + 10_000 - 1) / 10_000;
        uint256 room    = base - minIdle - vault.deployedFromSenior();
        uint256 depAmt  = bound(depSeed, 1_000_000, room);
        uint256 maxTeam = vault.juniorTokens();
        vm.prank(owner);
        vault.deployToLP(depAmt, maxTeam);

        uint256 move = bound(moveSeed, 0, 10_000_000e6);
        if (move > 0) {
            bool buyTeam = up;
            bool zeroForOne = buyTeam
                ? (Currency.unwrap(key.currency0) == address(usdc))
                : (Currency.unwrap(key.currency0) == address(team));
            vm.prank(trader);
            swapRouter.swap(key, zeroForOne, move);
        }

        uint256 dep = vault.deployedFromSenior();
        if (dep == 0) return;
        // request up to ~2x the deployed par (the redemption path's f × full-mark shape).
        uint256 recAmt = bound(recSeed, 1, dep * 2);

        uint256 navBefore = vault.totalSeniorAssets();
        vm.prank(owner);
        vault.recoverFromLP(recAmt);
        uint256 navAfter = vault.totalSeniorAssets();

        assertLe(navAfter, navBefore + DUST, "recover minted senior NAV at the seam");
    }
}
