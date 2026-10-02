// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}           from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LPFeeLibrary}          from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {CustomRevert}          from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {Hooks}                 from "@uniswap/v4-core/src/libraries/Hooks.sol";
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
///         the property token; trading is anchored to the appraisal band; a stale appraisal halts trading,
///         opens an exit window, then fails closed. Every refusal is asserted by its EXACT inner error.
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
            specFeePips: 10_000,      // 1.00%
            maxDriftTicksPerDay: 2_000, // ≈ 22% aggregate per 24 h
            oracleGraceSecs: 7 days   // exit window after trading goes stale
        });
    }

    function _deployHook(uint160 salt) internal returns (MintwareRwaAppraisalHook h) {
        address a = address(HOOK_FLAGS | (salt << 140));
        deployCodeTo(
            "MintwareRwaAppraisalHook.sol:MintwareRwaAppraisalHook",
            abi.encode(IPoolManager(address(pm)), owner, keeper, guardian, _config()),
            a
        );
        h = MintwareRwaAppraisalHook(a);
    }

    function _keyFor(address h, uint24 fee) internal view returns (PoolKey memory k) {
        (Currency c0, Currency c1) = propIs0
            ? (Currency.wrap(address(prop)), Currency.wrap(address(usdc)))
            : (Currency.wrap(address(usdc)), Currency.wrap(address(prop)));
        k = PoolKey({currency0: c0, currency1: c1, fee: fee, tickSpacing: SPACING, hooks: IHooks(h)});
    }

    function setUp() public {
        pm     = new PoolManager(address(this));
        router = new TestSwapRouter(IPoolManager(address(pm)));

        registry = new MockRwaIdentityRegistry(issuer);
        usdc     = new MockERC20("USD Coin", "USDC", 6);
        prop     = new MockPermissionedPropertyToken("Demo Parcel 1", "PARCEL1", 18, IRwaIdentityRegistry(address(registry)), issuer);

        propIs0   = address(prop) < address(usdc);
        appraisal = propIs0 ? int24(-230_270) : int24(230_270);

        hook = _deployHook(0xA11CE);
        key  = _keyFor(address(hook), LPFeeLibrary.DYNAMIC_FEE_FLAG);

        adapter = new MockYieldAdapter(address(usdc));
        vault   = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, issuer);

        vm.startPrank(owner);
        vault.setProtocolTreasury(protocol);
        vault.setJitHook(address(hook)); // the appraisal hook IS the vault's oracle
        vault.setMinCoverage(1);
        hook.setVault(address(vault));   // also pins the one pool id the hook may ever serve
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
        int24 a = hook.appraisalTick();
        return t >= a ? uint256(int256(t) - int256(a)) : uint256(int256(a) - int256(t));
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
    function _raiseTick(address who, uint256 amount) internal {
        if (propIs0) _buy(who, amount); // c1 = usdc
        else _sell(who, amount);        // c1 = prop
    }

    function externalBuy(address who, uint256 a) external { _buy(who, a); }
    function externalSell(address who, uint256 a) external { _sell(who, a); }

    /// The v4 / Currency wrapping: WrappedError(target, selector, reason, details). Returns (target, inner selector).
    function _unwrap(bytes memory err) internal pure returns (address target, bytes4 inner) {
        require(err.length >= 4 && bytes4(err) == CustomRevert.WrappedError.selector, "not a WrappedError");
        bytes memory body = new bytes(err.length - 4);
        for (uint256 i; i < body.length; ++i) body[i] = err[i + 4];
        (address t,, bytes memory reason,) = abi.decode(body, (address, bytes4, bytes, bytes));
        target = t;
        inner  = bytes4(reason);
    }

    /// Asserts a buy reverts with `inner` raised inside `target`.
    function _expectBuyRevert(address who, uint256 amt, address target, bytes4 inner) internal {
        try this.externalBuy(who, amt) { revert("expected a revert"); } catch (bytes memory err) {
            (address t, bytes4 s) = _unwrap(err);
            assertEq(t, target, "reverted in the expected contract");
            assertEq(s, inner, "reverted with the expected inner error");
        }
    }

    function _expectSellRevert(address who, uint256 amt, address target, bytes4 inner) internal {
        try this.externalSell(who, amt) { revert("expected a revert"); } catch (bytes memory err) {
            (address t, bytes4 s) = _unwrap(err);
            assertEq(t, target, "reverted in the expected contract");
            assertEq(s, inner, "reverted with the expected inner error");
        }
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
        assertEq(PoolId.unwrap(hook.poolId()), PoolId.unwrap(key.toId()), "bound to the vault's pool");
    }

    function test_VerifiedTraderBuysInBand() public {
        uint256 before = prop.balanceOf(bob);
        _buy(bob, 500e6);
        assertGt(prop.balanceOf(bob), before, "verified trader received the property token");
        assertLe(_dev(), 1_500, "price stays inside the spec band");
    }

    function test_UnverifiedTraderIsRefusedByTheToken() public {
        int24 t0 = _tick();
        // PoolManager.take → token.transfer → NotPermitted(eve), wrapped by v4's CurrencyLibrary.
        _expectBuyRevert(eve, 500e6, address(prop), MockPermissionedPropertyToken.NotPermitted.selector);
        assertEq(prop.balanceOf(eve), 0, "unverified wallet never receives the asset");
        assertEq(_tick(), t0, "nothing moved");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MockPermissionedPropertyToken.NotPermitted.selector, eve));
        prop.transfer(eve, 1e18);
    }

    function test_RevokedHolderCannotSell() public {
        _buy(bob, 500e6);
        vm.prank(issuer);
        registry.setVerified(bob, 0);
        // The router pulls the seller's tokens first: transferFrom(bob → router) is refused on the sender side.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MockPermissionedPropertyToken.NotPermitted.selector, bob));
        router.swap(key, propIs0, 1e18);
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

    // ── the band + fee ────────────────────────────────────────────────────────

    function test_SwapEndingOutsideTheBandReverts() public {
        int24 t0 = _tick();
        _expectBuyRevert(bob, 15_000e6, address(hook), MintwareRwaAppraisalHook.PriceOutOfBand.selector);
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

        // Moving AWAY (lowering the tick) reverts with the band error.
        if (propIs0) _expectSellRevert(bob, 1e18, address(hook), MintwareRwaAppraisalHook.PriceOutOfBand.selector);
        else _expectBuyRevert(bob, 100e6, address(hook), MintwareRwaAppraisalHook.PriceOutOfBand.selector);

        // Moving TOWARD the appraisal is allowed even though it still ends outside the band.
        uint256 devBefore = _dev();
        _raiseTick(bob, propIs0 ? 100e6 : 1e18);
        assertLt(_dev(), devBefore, "price moved toward the appraisal");
    }

    function test_BandFeeTiers() public {
        Config memory c = _cfg();
        SwapParams memory p = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1});

        // At the appraisal: core fee (with the override flag).
        vm.prank(address(pm));
        (, , uint24 fee) = hook.beforeSwap(bob, key, p, "");
        assertEq(fee, c.coreFeePips | LPFeeLibrary.OVERRIDE_FEE_FLAG, "core band pays the core fee");

        // Push spot past the core band (still inside spec): spec fee.
        _buy(bob, 700e6); // ≈ +7% on a ~$20k pool: past the ±5% core band, inside the ±16% spec band
        assertGt(_dev(), c.coreBandTicks, "now outside the core band");
        assertLe(_dev(), c.specBandTicks, "but inside the spec band");
        vm.prank(address(pm));
        (, , fee) = hook.beforeSwap(bob, key, p, "");
        assertEq(fee, c.specFeePips | LPFeeLibrary.OVERRIDE_FEE_FLAG, "spec band pays the spec fee");

        // The vault's own unwind always pays the core fee.
        vm.prank(address(pm));
        (, , fee) = hook.beforeSwap(address(vault), key, p, "");
        assertEq(fee, c.coreFeePips | LPFeeLibrary.OVERRIDE_FEE_FLAG, "vault unwind pays the core fee");
    }

    struct Config { uint24 coreBandTicks; uint24 specBandTicks; uint24 coreFeePips; uint24 specFeePips; }
    function _cfg() internal view returns (Config memory c) {
        (c.coreBandTicks, c.specBandTicks,,,, c.coreFeePips, c.specFeePips,,) = hook.config();
    }

    function testFuzz_TradesNeverLeaveTheBand(uint256 amount, bool buy) public {
        amount = bound(amount, 1e6, 50_000e6);
        uint256 propAmt = bound(amount * 1e10, 1e16, 900e18); // same $ order of magnitude in property units
        if (buy) {
            try this.externalBuy(bob, amount) {} catch {}
        } else {
            try this.externalSell(bob, propAmt) {} catch {}
        }
        assertLe(_dev(), 1_500, "a trader can never leave the price outside the spec band");
    }

    // ── appraisal safety ──────────────────────────────────────────────────────

    function test_StaleAppraisalHaltsTradingButOpensAnExitWindow() public {
        uint256 t0 = block.timestamp;
        vm.warp(t0 + 31 days);
        assertFalse(hook.isFresh(), "trading is stale");
        (, bool ready) = hook.oracleTick();
        assertTrue(ready, "exit window: the vault can still value its position");

        _expectBuyRevert(bob, 100e6, address(hook), MintwareRwaAppraisalHook.AppraisalStale.selector);

        // LPs can still leave during the exit window — in USDC.
        uint256 shares = vault.seniorShares(alice);
        vm.prank(alice);
        uint256 out = vault.redeemSenior(shares / 4, 0);
        assertApproxEqRel(out, SENIOR_USDC / 4, 0.01e18, "a senior exit is served during the exit window");
    }

    function test_AfterTheExitWindowTheVaultFailsClosed() public {
        uint256 t0 = block.timestamp;
        vm.warp(t0 + 30 days + 7 days + 1);
        (, bool ready) = hook.oracleTick();
        assertFalse(ready, "past the exit window the oracle is not ready");
        vm.expectRevert(MintwareTreasuryVault.OracleNotReady.selector);
        vault.recoverableUSDC();

        // A fresh appraisal restores everything.
        vm.prank(keeper);
        hook.postAppraisal(appraisal + 10);
        assertGt(vault.recoverableUSDC(), 0, "valuation back once a fresh appraisal lands");
        _buy(bob, 100e6);
    }

    function test_AppraisalStepsAreBoundedAndRateLimited() public {
        vm.prank(keeper);
        vm.expectRevert(MintwareRwaAppraisalHook.UpdateTooSoon.selector);
        hook.postAppraisal(appraisal + 10);

        uint256 t0 = block.timestamp;
        vm.warp(t0 + 1 hours);
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

    function test_DailyDriftIsCapped() public {
        uint256 t0 = block.timestamp;
        vm.warp(t0 + 1 hours);
        vm.prank(keeper);
        hook.postAppraisal(appraisal + 1_000);
        vm.warp(t0 + 2 hours);
        vm.prank(keeper);
        hook.postAppraisal(appraisal + 2_000); // = the 24 h cap
        vm.warp(t0 + 3 hours);
        vm.prank(keeper);
        vm.expectRevert(MintwareRwaAppraisalHook.DailyDriftExceeded.selector);
        hook.postAppraisal(appraisal + 2_500); // each step is legal; the aggregate is not

        // A new 24 h window re-anchors at the current appraisal.
        vm.warp(t0 + 1 days + 1);
        vm.prank(keeper);
        hook.postAppraisal(appraisal + 2_500);
        assertEq(hook.appraisalTick(), appraisal + 2_500);
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
        (, uint24 specNow,,,,,,,) = hook.config();
        assertEq(specNow, 1_500, "not applied yet");
        vm.warp(block.timestamp + 48 hours);
        vm.prank(owner);
        hook.confirmConfig();
        (, specNow,,,,,,,) = hook.config();
        assertEq(specNow, 3_000);
    }

    function test_BadConfigRejected() public {
        MintwareRwaAppraisalHook.Config memory c = _config();
        c.coreBandTicks = 2_000; // core wider than spec
        vm.prank(owner);
        vm.expectRevert(MintwareRwaAppraisalHook.BadConfig.selector);
        hook.proposeConfig(c);

        c = _config();
        c.maxStepTicks = c.specBandTicks + 1; // a single step larger than the band
        vm.prank(owner);
        vm.expectRevert(MintwareRwaAppraisalHook.BadConfig.selector);
        hook.proposeConfig(c);

        c = _config();
        c.maxDriftTicksPerDay = c.maxStepTicks - 1; // a day's cap smaller than one step
        vm.prank(owner);
        vm.expectRevert(MintwareRwaAppraisalHook.BadConfig.selector);
        hook.proposeConfig(c);
    }

    // ── the pool ──────────────────────────────────────────────────────────────

    function test_OnlyTheVaultMayAddLiquidity() public {
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        usdc.mint(address(this), 1_000_000e6);
        usdc.approve(address(lp), type(uint256).max);
        try lp.modifyLiquidity(key, ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: 1e12, salt: 0}), "") {
            revert("expected a revert");
        } catch (bytes memory err) {
            (address t, bytes4 s) = _unwrap(err);
            assertEq(t, address(hook));
            assertEq(s, MintwareRwaAppraisalHook.OnlyVault.selector, "add refused by the LP gate, not something else");
        }
    }

    function test_OnlyTheVaultMayRemoveLiquidity() public {
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        try lp.modifyLiquidity(key, ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: -1, salt: 0}), "") {
            revert("expected a revert");
        } catch (bytes memory err) {
            (address t, bytes4 s) = _unwrap(err);
            assertEq(t, address(hook));
            assertEq(s, MintwareRwaAppraisalHook.OnlyVault.selector, "remove refused by the LP gate");
        }
    }

    function test_HookServesExactlyOnePool() public {
        PoolKey memory k2 = key;
        k2.tickSpacing = 10;
        vm.expectRevert(); // already bound + not the pinned pool
        pm.initialize(k2, TickMath.getSqrtPriceAtTick(appraisal));
    }

    /// The review's front-run: before the real initialise, anyone binds the hook to a junk pool. Now refused.
    function test_NobodyCanBindTheHookToAnotherPool() public {
        MintwareRwaAppraisalHook h = _deployHook(0xF00D);
        PoolKey memory real = _keyFor(address(h), LPFeeLibrary.DYNAMIC_FEE_FLAG);
        MintwareTreasuryVault v = new MintwareTreasuryVault(address(pm), real, address(usdc), address(new MockYieldAdapter(address(usdc))), owner, issuer);
        vm.prank(owner);
        h.setVault(address(v));
        vm.prank(keeper);
        h.initAppraisal(appraisal);

        MockERC20 j0 = new MockERC20("Junk A", "JA", 18);
        MockERC20 j1 = new MockERC20("Junk B", "JB", 18);
        (Currency a, Currency b) = address(j0) < address(j1) ? (Currency.wrap(address(j0)), Currency.wrap(address(j1))) : (Currency.wrap(address(j1)), Currency.wrap(address(j0)));
        PoolKey memory junk = PoolKey({currency0: a, currency1: b, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: 1, hooks: IHooks(address(h))});

        vm.prank(makeAddr("attacker"));
        vm.expectRevert(); // WrongPool, wrapped by v4
        pm.initialize(junk, TickMath.getSqrtPriceAtTick(appraisal));
        assertFalse(h.poolBound(), "the junk pool did not bind");

        pm.initialize(real, TickMath.getSqrtPriceAtTick(appraisal));
        assertTrue(h.poolBound(), "the real pool still binds");
        assertEq(PoolId.unwrap(h.poolId()), PoolId.unwrap(real.toId()));
    }

    function test_SetVaultRejectsAVaultForAnotherHook() public {
        MintwareRwaAppraisalHook h = _deployHook(0xBEEF);
        vm.prank(owner);
        vm.expectRevert(MintwareRwaAppraisalHook.WrongPool.selector);
        h.setVault(address(vault)); // `vault`'s pool key names a different hook
    }

    function test_PoolMustLaunchAtTheAppraisal() public {
        MintwareRwaAppraisalHook h = _deployHook(0xB0B);
        PoolKey memory k2 = _keyFor(address(h), LPFeeLibrary.DYNAMIC_FEE_FLAG);
        MintwareTreasuryVault v = new MintwareTreasuryVault(address(pm), k2, address(usdc), address(new MockYieldAdapter(address(usdc))), owner, issuer);
        vm.prank(owner);
        h.setVault(address(v));
        vm.prank(keeper);
        h.initAppraisal(appraisal);
        vm.expectRevert(); // InitOutsideCoreBand, wrapped: 600 ticks off > 500 core band
        pm.initialize(k2, TickMath.getSqrtPriceAtTick(appraisal + 600));
        assertFalse(h.poolBound());
    }

    function test_PoolMustUseADynamicFee() public {
        MintwareRwaAppraisalHook h = _deployHook(0xFEE);
        PoolKey memory k2 = _keyFor(address(h), 3000); // static fee
        MintwareTreasuryVault v = new MintwareTreasuryVault(address(pm), k2, address(usdc), address(new MockYieldAdapter(address(usdc))), owner, issuer);
        vm.prank(owner);
        h.setVault(address(v));
        vm.prank(keeper);
        h.initAppraisal(appraisal);
        try pm.initialize(k2, TickMath.getSqrtPriceAtTick(appraisal)) { revert("expected a revert"); } catch (bytes memory err) {
            (address t, bytes4 s) = _unwrap(err);
            assertEq(t, address(h));
            assertEq(s, MintwareRwaAppraisalHook.NotDynamicFee.selector);
        }
    }

    // ── emergency + redemptions ───────────────────────────────────────────────

    function test_PauseStopsTradingButNotTheVault() public {
        _buy(bob, 500e6);
        vm.prank(guardian);
        hook.pauseTrading();

        _expectBuyRevert(bob, 10e6, address(hook), MintwareRwaAppraisalHook.TradingIsPaused.selector);

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
