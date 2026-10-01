// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}           from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LPFeeLibrary}          from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {IERC20}                from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareTreasuryVault}         from "../../src/payments/MintwareTreasuryVault.sol";
import {MintwareRwaAppraisalHook}      from "../../src/rwa/MintwareRwaAppraisalHook.sol";
import {MockRwaIdentityRegistry}       from "../../src/rwa/testnet/MockRwaIdentityRegistry.sol";
import {MockPermissionedPropertyToken} from "../../src/rwa/testnet/MockPermissionedPropertyToken.sol";
import {IRwaIdentityRegistry}          from "../../src/rwa/interfaces/IRwaIdentityRegistry.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @notice V2-RWAs — one RWA liquidity unit end to end against a real v4 PoolManager:
///         issuer junior (permissioned property token) + community senior USDC in the UNCHANGED
///         `MintwareTreasuryVault`, a dynamic-fee pool behind `MintwareRwaAppraisalHook`.
///         Proves the three-role model on-chain: LPs only ever hold USDC; only verified wallets can receive
///         the property token; trading is anchored to the appraisal band; a stale appraisal fails closed.
contract MintwareRwaLiquidityUnitTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    PoolManager    internal pm;
    TestSwapRouter internal router;

    MockERC20                     internal usdc;
    MockPermissionedPropertyToken internal prop;
    MockRwaIdentityRegistry       internal registry;
    MintwareRwaAppraisalHook      internal hook;
    MintwareTreasuryVault         internal vault;
    MockYieldAdapter              internal adapter;
    PoolKey                       internal key;

    address internal owner    = makeAddr("owner");
    address internal issuer   = makeAddr("issuer");
    address internal keeper   = makeAddr("keeper");
    address internal guardian = makeAddr("guardian");
    address internal protocol = makeAddr("protocol");
    address internal alice    = makeAddr("aliceLP");
    address internal bob      = makeAddr("bobVerified");
    address internal eve      = makeAddr("eveUnverified");

    uint160 internal constant HOOK_FLAGS = uint160(0x2AC0); // beforeInit | beforeAdd | beforeRemove | beforeSwap | afterSwap
    int24   internal constant SPACING    = 60;

    // $100 per property token (18dp) in USDC (6dp): raw price 1e-10 ⇒ tick ±230270.
    int24   internal appraisal;
    bool    internal propIs0;

    uint256 internal constant COMMIT_TOKENS = 5_000e18;    // $500k of property inventory (junior)
    uint256 internal constant JUNIOR_USDC   = 10e6;
    uint256 internal constant SENIOR_USDC   = 100_000e6;
    uint256 internal constant DEPLOY_USDC   = 20_000e6;    // idle-first: ≤20% of senior in the pool

    function _config() internal pure returns (MintwareRwaAppraisalHook.Config memory c) {
        c = MintwareRwaAppraisalHook.Config({
            coreBandTicks: 500,       // ≈ ±5%
            specBandTicks: 1_500,     // ≈ ±16%
            maxStepTicks: 1_000,      // ≈ 10% per update
            minUpdateInterval: 1 hours,
            maxAppraisalAge: 30 days,
            coreFeePips: 3_000,       // 0.30%
            specFeePips: 10_000       // 1.00%
        });
    }

    function setUp() public {
        pm     = new PoolManager(address(this));
        router = new TestSwapRouter(IPoolManager(address(pm)));

        registry = new MockRwaIdentityRegistry(issuer);
        usdc     = new MockERC20("USD Coin", "USDC", 6);
        prop     = new MockPermissionedPropertyToken("Demo Parcel 1", "PARCEL1", 18, IRwaIdentityRegistry(address(registry)), issuer);

        propIs0   = address(prop) < address(usdc);
        appraisal = propIs0 ? int24(-230_270) : int24(230_270);

        address hookAddr = address(HOOK_FLAGS | (uint160(0xA11CE) << 140));
        deployCodeTo(
            "MintwareRwaAppraisalHook.sol:MintwareRwaAppraisalHook",
            abi.encode(IPoolManager(address(pm)), owner, keeper, guardian, _config()),
            hookAddr
        );
        hook = MintwareRwaAppraisalHook(hookAddr);

        (Currency c0, Currency c1) = propIs0
            ? (Currency.wrap(address(prop)), Currency.wrap(address(usdc)))
            : (Currency.wrap(address(usdc)), Currency.wrap(address(prop)));
        key = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(hookAddr)});

        adapter = new MockYieldAdapter(address(usdc));
        vault   = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, issuer);

        vm.startPrank(owner);
        vault.setProtocolTreasury(protocol);
        vault.setJitHook(hookAddr); // the appraisal hook IS the vault's oracle
        vault.setMinCoverage(1);
        hook.setVault(address(vault));
        vm.stopPrank();

        // Enroll infra as permitted holders (in production: the issuer enrolls Mintware's contracts once).
        vm.startPrank(issuer);
        prop.setPermittedHolder(address(pm), true);
        prop.setPermittedHolder(address(vault), true);
        prop.setPermittedHolder(address(router), true);
        registry.setVerified(bob, type(uint64).max);
        prop.mint(issuer, COMMIT_TOKENS);
        prop.mint(bob, 1_000e18);
        vm.stopPrank();

        vm.prank(keeper);
        hook.initAppraisal(appraisal);
        pm.initialize(key, TickMath.getSqrtPriceAtTick(appraisal));

        // Issuer commits the junior (property inventory + a small USDC first-loss buffer), 1-year lock.
        usdc.mint(issuer, JUNIOR_USDC);
        vm.startPrank(issuer);
        IERC20(address(prop)).approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(COMMIT_TOKENS, JUNIOR_USDC, 365 days);
        vm.stopPrank();

        // Alice (an open, unverified LP) supplies senior USDC.
        usdc.mint(alice, SENIOR_USDC);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(SENIOR_USDC, 0, alice);
        vm.stopPrank();

        // A slice goes into the pool; the rest stays earning in the lending adapter.
        vm.prank(owner);
        vault.deployToLP(DEPLOY_USDC, 1_000e18);

        usdc.mint(bob, 1_000_000e6);
        usdc.mint(eve, 1_000_000e6);
        vm.startPrank(bob);
        usdc.approve(address(router), type(uint256).max);
        IERC20(address(prop)).approve(address(router), type(uint256).max);
        vm.stopPrank();
        vm.prank(eve);
        usdc.approve(address(router), type(uint256).max);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    function _tick() internal view returns (int24 t) {
        (, t,,) = IPoolManager(address(pm)).getSlot0(key.toId());
    }

    function _dev() internal view returns (uint256) {
        int24 t = _tick();
        return t >= appraisalNow() ? uint256(int256(t) - int256(appraisalNow())) : uint256(int256(appraisalNow()) - int256(t));
    }

    function appraisalNow() internal view returns (int24) {
        return hook.appraisalTick();
    }

    /// Buy the property token with USDC.
    function _buy(address who, uint256 usdcIn) internal {
        vm.prank(who);
        router.swap(key, !propIs0, usdcIn); // usdc is c0 ⇒ zeroForOne
    }

    /// Sell the property token for USDC.
    function _sell(address who, uint256 propIn) internal {
        vm.prank(who);
        router.swap(key, propIs0, propIn);
    }

    /// Swap in the direction that raises the pool tick (pays currency1).
    function _raiseTick(address who, uint256 usdcOrPropAmount) internal {
        if (propIs0) _buy(who, usdcOrPropAmount); // c1 = usdc
        else _sell(who, usdcOrPropAmount);        // c1 = prop
    }

    // ── the three-role model ──────────────────────────────────────────────────

    function test_SetupIsLiveAndBalanced() public view {
        assertGt(vault.positionLiquidity(), 0, "vault holds the pool position");
        assertEq(vault.deployedFromSenior(), DEPLOY_USDC, "senior slice deployed at par");
        assertApproxEqAbs(adapter.totalAssets(), SENIOR_USDC - DEPLOY_USDC, 1, "rest of senior earning in lending");
        (int24 t, bool ready) = hook.oracleTick();
        assertEq(t, appraisal);
        assertTrue(ready, "fresh appraisal is ready");
        assertLe(_dev(), 1, "pool launched at the appraisal");
    }

    function test_VerifiedTraderBuysInBand() public {
        uint256 before = prop.balanceOf(bob);
        _buy(bob, 500e6);
        assertGt(prop.balanceOf(bob), before, "verified trader received the property token");
        assertLe(_dev(), 1_500, "price stays inside the spec band");
    }

    function test_UnverifiedTraderIsRefusedByTheToken() public {
        int24 t0 = _tick();
        vm.expectRevert();
        _buy(eve, 500e6);
        assertEq(prop.balanceOf(eve), 0, "unverified wallet never receives the asset");
        assertEq(_tick(), t0, "nothing moved");

        // The refusal lives in the token itself, not the pool.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MockPermissionedPropertyToken.NotPermitted.selector, eve));
        prop.transfer(eve, 1e18);
    }

    function test_RevokedHolderCannotSell() public {
        _buy(bob, 500e6);
        vm.prank(issuer);
        registry.setVerified(bob, 0);
        vm.expectRevert();
        _sell(bob, 1e18);
    }

    function test_LpNeverHoldsTheAssetAndExitsInUsdc() public {
        _buy(bob, 500e6);
        _sell(bob, 2e18);

        uint256 shares = vault.seniorShares(alice);
        vm.prank(alice);
        uint256 out = vault.redeemSenior(shares / 2, 0);
        assertApproxEqRel(out, SENIOR_USDC / 2, 0.01e18, "half the senior back in USDC");
        assertEq(prop.balanceOf(alice), 0, "the LP never touched the property token");
        assertFalse(prop.isPermitted(alice), "and isn't even eligible to hold it");
    }

    // ── the band ──────────────────────────────────────────────────────────────

    function test_SwapEndingOutsideTheBandReverts() public {
        int24 t0 = _tick();
        vm.expectRevert(); // hook revert (wrapped by the PoolManager)
        _buy(bob, 15_000e6); // ~75% of pool-side USDC — far past ±16%
        assertEq(_tick(), t0, "price unchanged");
    }

    function test_GapClosingTradeIsAllowedAfterAppraisalMoves() public {
        // Walk the appraisal up 2 × 1000 ticks so spot sits 2000 ticks (> spec) below it.
        uint256 t0 = block.timestamp; // anchor: via-IR may re-read block.timestamp across warps
        vm.warp(t0 + 1 hours);
        vm.prank(keeper);
        hook.postAppraisal(appraisal + 1_000);
        vm.warp(t0 + 2 hours);
        vm.prank(keeper);
        hook.postAppraisal(appraisal + 2_000);
        assertGt(_dev(), 1_500, "spot now outside the band");

        // Moving AWAY (lowering the tick) reverts.
        vm.expectRevert();
        if (propIs0) _sell(bob, 1e18); else _buy(bob, 100e6);

        // Moving TOWARD the appraisal is allowed even though it still ends outside the band.
        uint256 devBefore = _dev();
        _raiseTick(bob, propIs0 ? 100e6 : 1e18);
        assertLt(_dev(), devBefore, "price moved toward the appraisal");
    }

    function testFuzz_TradesNeverLeaveTheBand(uint256 amount, bool buy) public {
        amount = bound(amount, 1e6, 50_000e6);
        uint256 propAmt = bound(amount * 1e10, 1e16, 900e18); // same $ order of magnitude in property units
        if (buy) {
            try this.externalBuy(amount) {} catch {}
        } else {
            try this.externalSell(propAmt) {} catch {}
        }
        assertLe(_dev(), 1_500, "a trader can never leave the price outside the spec band");
    }

    function externalBuy(uint256 a) external { _buy(bob, a); }
    function externalSell(uint256 a) external { _sell(bob, a); }

    // ── appraisal safety ──────────────────────────────────────────────────────

    function test_StaleAppraisalHaltsTradingAndFailsClosed() public {
        vm.warp(block.timestamp + 31 days);
        (, bool ready) = hook.oracleTick();
        assertFalse(ready, "stale appraisal is not ready");

        vm.expectRevert();
        _buy(bob, 100e6);

        vm.expectRevert(MintwareTreasuryVault.OracleNotReady.selector);
        vault.recoverableUSDC();
    }

    function test_AppraisalStepsAreBoundedAndRateLimited() public {
        vm.prank(keeper);
        vm.expectRevert(MintwareRwaAppraisalHook.UpdateTooSoon.selector);
        hook.postAppraisal(appraisal + 10);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(keeper);
        vm.expectRevert(MintwareRwaAppraisalHook.StepTooLarge.selector);
        hook.postAppraisal(appraisal + 1_001);

        vm.prank(bob);
        vm.expectRevert(MintwareRwaAppraisalHook.OnlyKeeper.selector);
        hook.postAppraisal(appraisal + 10);

        vm.prank(keeper);
        hook.postAppraisal(appraisal + 1_000);
        assertEq(hook.appraisalTick(), appraisal + 1_000);
    }

    function test_KeeperRotationIsTimelocked() public {
        address next = makeAddr("nextKeeper");
        vm.prank(owner);
        hook.proposeKeeper(next);
        vm.prank(owner);
        vm.expectRevert(MintwareRwaAppraisalHook.TimelockActive.selector);
        hook.confirmKeeper();
        vm.warp(block.timestamp + 48 hours);
        vm.prank(owner);
        hook.confirmKeeper();
        assertEq(hook.keeper(), next);
    }

    function test_ConfigIsTimelockedAfterLaunch() public {
        MintwareRwaAppraisalHook.Config memory c = _config();
        c.specBandTicks = 3_000;
        vm.prank(owner);
        hook.proposeConfig(c);
        (, uint24 specNow,,,,,) = hook.config();
        assertEq(specNow, 1_500, "not applied yet");
        vm.warp(block.timestamp + 48 hours);
        vm.prank(owner);
        hook.confirmConfig();
        (, specNow,,,,,) = hook.config();
        assertEq(specNow, 3_000);
    }

    function test_BadConfigRejected() public {
        MintwareRwaAppraisalHook.Config memory c = _config();
        c.coreBandTicks = 2_000; // core wider than spec
        vm.prank(owner);
        vm.expectRevert(MintwareRwaAppraisalHook.BadConfig.selector);
        hook.proposeConfig(c);
    }

    // ── the pool ──────────────────────────────────────────────────────────────

    function test_OnlyTheVaultMayProvideLiquidity() public {
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        usdc.mint(address(this), 1_000_000e6);
        usdc.approve(address(lp), type(uint256).max);
        vm.expectRevert();
        lp.modifyLiquidity(key, ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: 1e12, salt: 0}), "");
    }

    function test_HookServesExactlyOnePool() public {
        PoolKey memory k2 = key;
        k2.tickSpacing = 10;
        vm.expectRevert();
        pm.initialize(k2, TickMath.getSqrtPriceAtTick(appraisal));
    }

    function test_PoolMustLaunchAtTheAppraisal() public {
        address h2 = address(HOOK_FLAGS | (uint160(0xB0B) << 140));
        deployCodeTo(
            "MintwareRwaAppraisalHook.sol:MintwareRwaAppraisalHook",
            abi.encode(IPoolManager(address(pm)), owner, keeper, guardian, _config()),
            h2
        );
        vm.prank(keeper);
        MintwareRwaAppraisalHook(h2).initAppraisal(appraisal);
        PoolKey memory k2 = key;
        k2.hooks = IHooks(h2);
        vm.expectRevert(); // 600 ticks off > 500 core band
        pm.initialize(k2, TickMath.getSqrtPriceAtTick(appraisal + 600));
    }

    // ── emergency + redemptions ───────────────────────────────────────────────

    function test_PauseStopsTradingButNotTheVault() public {
        _buy(bob, 500e6);
        vm.prank(guardian);
        hook.pauseTrading();

        vm.expectRevert();
        _buy(bob, 10e6);

        // The vault's own unwind (it sells its recovered property leg through the pool) still works.
        vm.prank(owner);
        vault.recoverFromLP(5_000e6);
        assertLt(vault.deployedFromSenior(), DEPLOY_USDC, "senior pulled back out of the pool");
        assertLe(vault.deployedFromSenior(), vault.recoverableUSDC(), "solvency invariant holds");
    }

    function test_SolvencyInvariantAcrossTrading() public {
        for (uint256 i; i < 6; ++i) {
            _buy(bob, 400e6);
            _sell(bob, 3e18);
        }
        assertLe(vault.deployedFromSenior(), vault.recoverableUSDC(), "deployed senior covered");
        assertGe(vault.totalSeniorAssets(), SENIOR_USDC, "senior NAV never below par");
    }
}
