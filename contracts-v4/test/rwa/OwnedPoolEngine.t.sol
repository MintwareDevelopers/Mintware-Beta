// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PermissionsAdapterFactory} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/PermissionsAdapterFactory.sol";
import {PermissionsAdapter} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/PermissionsAdapter.sol";
import {PermissionFlags} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/libraries/PermissionFlags.sol";
import {IV4Router} from "@uniswap/v4-periphery-permissioned/src/interfaces/IV4Router.sol";
import {Actions} from "@uniswap/v4-periphery-permissioned/src/libraries/Actions.sol";
import {MintwareRwaAppraisalHook} from "../../src/rwa/MintwareRwaAppraisalHook.sol";
import {MintwareOwnedPoolMarketEngine} from "../../src/vaults/MintwareOwnedPoolMarketEngine.sol";
import {MintwareMarketEngineCore} from "../../src/vaults/MintwareMarketEngineCore.sol";
import {MintwareMarketLifecycleModule} from "../../src/vaults/MintwareMarketLifecycleModule.sol";
import {MintwareIdleYieldAdapter} from "../../src/vaults/MintwareIdleYieldAdapter.sol";
import {MWV4Settlement} from "../../src/lib/MWV4Settlement.sol";
import {MWMarketValuation} from "../../src/lib/MWMarketValuation.sol";
import {OwnedIssuerToken, IssuerAllowlist, PermissionedRoutingEntrypoint, ForgedPrincipalRouter} from "./OwnedPoolFixtures.sol";

abstract contract OwnedPoolEngineFixture is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    IPoolManager manager;
    PermissionsAdapterFactory factory;
    PermissionsAdapter adapter;
    IssuerAllowlist checker;
    OwnedIssuerToken property;
    OwnedIssuerToken usdc;
    MintwareRwaAppraisalHook hook;
    MintwareOwnedPoolMarketEngine engine;
    PermissionedRoutingEntrypoint router;
    MintwareIdleYieldAdapter idle0;
    MintwareIdleYieldAdapter idle1;
    PoolKey key;
    address alice = makeAddr("qualified holder");
    address bob = makeAddr("swap only");
    int24 initialTick;
    function propertyFirst() internal pure virtual returns (bool);

    function setUp() public {
        vm.warp(10 days);
        manager = IPoolManager(address(new PoolManager(address(this))));
        checker = new IssuerAllowlist();
        factory = new PermissionsAdapterFactory(address(manager));
        // Deliberately make underlying address order the reverse of virtual currency order.
        address quote = propertyFirst() ? address(type(uint160).max - 100) : address(0x1000);
        address prop = propertyFirst() ? address(type(uint160).max - 10) : address(0x900);
        deployCodeTo("OwnedPoolFixtures.sol:OwnedIssuerToken", abi.encode(uint8(6), false), quote);
        deployCodeTo("OwnedPoolFixtures.sol:OwnedIssuerToken", abi.encode(uint8(18), true), prop);
        property = OwnedIssuerToken(prop); usdc = OwnedIssuerToken(quote);
        adapter = PermissionsAdapter(factory.createPermissionsAdapter(IERC20(prop), address(this), checker));
        assertEq(address(adapter) < quote, propertyFirst());
        property.setEligible(address(adapter), true);
        property.mint(address(adapter), 1); // Required verification seed is not engine capital.
        factory.verifyPermissionsAdapter(address(adapter));
        hook = _deployHook();
        key = propertyFirst()
            ? PoolKey(Currency.wrap(address(adapter)), Currency.wrap(quote), 0x800000, 60, IHooks(hook))
            : PoolKey(Currency.wrap(quote), Currency.wrap(address(adapter)), 0x800000, 60, IHooks(hook));
        hook.pinPoolKey(key, factory, quote);
        initialTick = propertyFirst() ? int24(-230280) : int24(230280);
        hook.initAppraisal(initialTick, uint64(vm.getBlockTimestamp()), keccak256("dated report"));
        manager.initialize(key, TickMath.getSqrtPriceAtTick(initialTick));
        address module = deployCode("MintwareMarketLifecycleModule.sol:MintwareMarketLifecycleModule");
        engine = MintwareOwnedPoolMarketEngine(deployCode("MintwareOwnedPoolMarketEngine.sol:MintwareOwnedPoolMarketEngine", abi.encode(_engineConfig(module))));
        hook.setVault(address(engine));
        idle0 = new MintwareIdleYieldAdapter(address(engine.token0()), address(engine), address(this), type(uint256).max);
        idle1 = new MintwareIdleYieldAdapter(address(engine.token1()), address(engine), address(this), type(uint256).max);
        engine.configureAdapters(address(idle0), address(idle1));
        property.setEligible(address(engine), true);
        property.setEligible(address(idle0), true);
        property.setEligible(address(idle1), true);
        adapter.updateAllowedWrapper(address(engine), true);
        checker.set(address(engine), address(property), PermissionFlags.LIQUIDITY_ALLOWED);
        engine.activate();
        router = new PermissionedRoutingEntrypoint(manager, factory);
        adapter.updateAllowedWrapper(address(router), true);
        adapter.updateSwappingEnabled(true);
        for (uint256 i; i < 2; ++i) {
            address who = i == 0 ? alice : bob;
            property.setEligible(who, true);
            property.mint(who, 100_000e18);
            usdc.mint(who, 10_000_000e6);
            checker.set(who, address(property), i == 0 ? PermissionFlags.ALL_ALLOWED : PermissionFlags.SWAP_ALLOWED);
            vm.startPrank(who);
            property.approve(address(engine), type(uint256).max); usdc.approve(address(engine), type(uint256).max);
            property.approve(address(router), type(uint256).max); usdc.approve(address(router), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _deployHook() internal returns (MintwareRwaAppraisalHook deployed) {
        MintwareRwaAppraisalHook.Config memory c = MintwareRwaAppraisalHook.Config(500, 1500, 1000, 1 hours, 30 days, 3000, 10000, 2000, 7 days);
        bytes memory code = abi.encodePacked(vm.getCode("MintwareRwaAppraisalHook.sol:MintwareRwaAppraisalHook"), abi.encode(manager, address(this), address(this), address(this), c));
        bytes32 hash = keccak256(code);
        for (uint256 i; ; ++i) {
            bytes32 salt = bytes32(i);
            address predicted = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, hash)))));
            if (uint160(predicted) & 0x3fff != 0x2ac0 || predicted.code.length != 0) continue;
            address created;
            assembly ("memory-safe") { created := create2(0, add(code, 32), mload(code), salt) }
            require(created == predicted, "hook deployment");
            return MintwareRwaAppraisalHook(created);
        }
    }

    function _engineConfig(address module) internal view returns (MintwareMarketEngineCore.MarketConfig memory c) {
        c.poolManager = address(manager); c.poolKey = key; c.quoteAsset = address(usdc); c.nonQuoteMark = address(hook);
        c.lifecycleModule = module; c.initialOwner = address(this); c.tickLower = initialTick - 600; c.tickUpper = initialTick + 600;
        c.maxMarkAge = 30 days; c.maxSpotMarkDeviationBps = 2500; c.minInitialContribution = 1e6;
        c.principalCap = 10_000_000e6; c.maxPositionBps = 8000; c.recenterEdgeTicks = 120;
        c.maxRecenterTickMove = 600; c.recenterCooldown = 1 hours;
    }
    function _deposit(address who, uint256 prop, uint256 quote) internal {
        vm.prank(who);
        engine.deposit(propertyFirst() ? prop : quote, propertyFirst() ? quote : prop, 1);
    }
    function _seed() internal {
        _deposit(alice, 1000e18, 100_000e6);
        engine.deployLiquidity(idle0.totalAssets(), idle1.totalAssets(), false, 0, 0, 0, 1);
    }
    function _plan(bool zeroForOne, uint128 amount) internal view returns (bytes memory) {
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(IV4Router.ExactInputSingleParams(key, zeroForOne, amount, 1, 0, bytes("")));
        params[1] = abi.encode(zeroForOne ? key.currency0 : key.currency1, uint256(amount));
        params[2] = abi.encode(zeroForOne ? key.currency1 : key.currency0, uint256(1));
        return abi.encode(abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL)), params);
    }
    function _trade(address who, bool propertyIn, uint128 amount) internal {
        bytes memory plan = _plan(propertyIn == propertyFirst(), amount);
        vm.prank(who); router.execute(plan);
    }
    function _hookError(bytes4 callback, bytes memory reason) internal view returns (bytes memory) {
        return abi.encodeWithSelector(CustomRevert.WrappedError.selector, address(hook), callback, reason, abi.encodeWithSelector(Hooks.HookCallFailed.selector));
    }
    function _tick() internal view returns (int24 tick) { (, tick,,) = manager.getSlot0(key.toId()); }
    function _assertCustody(uint256 slack) internal view {
        assertEq(adapter.balanceOf(address(engine)), 0);
        assertEq(adapter.balanceOf(address(router)), 0);
        assertEq(adapter.balanceOf(address(adapter)), 0);
        assertEq(adapter.balanceOf(address(manager)), adapter.totalSupply());
        assertEq(property.balanceOf(address(manager)), 0);
        assertEq(property.balanceOf(address(adapter)), adapter.totalSupply() + slack);
        assertEq(usdc.balanceOf(address(adapter)), 0);
    }

    function test_deployActivateLPAndUnderlyingCustody() public {
        _seed();
        assertGt(engine.positionLiquidity(), 0);
        assertEq(engine.msgSender(), address(engine));
        assertEq(address(engine.token0()), propertyFirst() ? address(property) : address(usdc));
        assertEq(address(engine.token1()), propertyFirst() ? address(usdc) : address(property));
        assertGt(uint160(address(engine.token0())), uint160(address(engine.token1())));
        assertGt(adapter.totalSupply(), 0);
        _assertCustody(1);
    }
    function test_swapsBothDirectionsDeliverUnderlyingAndFees() public {
        _seed();
        uint256 beforeProp = property.balanceOf(bob);
        _trade(bob, false, 100e6);
        assertGt(property.balanceOf(bob), beforeProp);
        uint256 beforeQuote = usdc.balanceOf(bob);
        _trade(bob, true, 1e18);
        assertGt(usdc.balanceOf(bob), beforeQuote);
        (uint256 a, uint256 b) = engine.harvest();
        assertGt(a, 0); assertGt(b, 0);
        _assertCustody(1);
    }
    function test_swapWithoutFlagRefusesBothDirections() public {
        _seed(); checker.set(bob, address(property), PermissionFlags.LIQUIDITY_ALLOWED);
        bytes memory reason = _hookError(IHooks.beforeSwap.selector, abi.encodeWithSelector(MintwareRwaAppraisalHook.Unauthorized.selector));
        bytes memory plan = _plan(propertyFirst(), 1e18);
        vm.prank(bob); vm.expectRevert(reason); router.execute(plan);
        plan = _plan(!propertyFirst(), 100e6);
        vm.prank(bob); vm.expectRevert(reason); router.execute(plan);
    }
    function test_fakeRouterCannotBorrowQualifiedPrincipal() public {
        _seed();
        ForgedPrincipalRouter fake = new ForgedPrincipalRouter(manager, factory, alice);
        bytes memory plan = _plan(propertyFirst(), 1e18);
        vm.expectRevert(_hookError(IHooks.beforeSwap.selector, abi.encodeWithSelector(MintwareRwaAppraisalHook.Unauthorized.selector)));
        fake.execute(plan);
    }
    function test_nonTransferableSharesAndQuoteOnlyMintPermission() public {
        _seed();
        vm.prank(alice); vm.expectRevert(MintwareOwnedPoolMarketEngine.SharesNonTransferable.selector); engine.transfer(bob, 1);
        vm.prank(alice); engine.approve(bob, 1);
        vm.prank(bob); vm.expectRevert(MintwareOwnedPoolMarketEngine.SharesNonTransferable.selector); engine.transferFrom(alice, bob, 1);
        vm.expectRevert(MintwareOwnedPoolMarketEngine.LiquidityNotAllowed.selector); _deposit(bob, 0, 100e6);
        checker.set(bob, address(property), PermissionFlags.LIQUIDITY_ALLOWED);
        _deposit(bob, 0, 100e6);
        assertGt(engine.balanceOf(bob), 0);
    }
    function test_harvestAndFullExitIgnoreAllHookEntryRestrictions() public {
        _seed(); _trade(bob, false, 100e6); _trade(bob, true, 1e18);
        checker.set(address(engine), address(property), PermissionFlags.NONE);
        checker.set(alice, address(property), PermissionFlags.NONE);
        adapter.updateAllowedWrapper(address(engine), false);
        adapter.updateSwappingEnabled(false); hook.pauseTrading(); engine.pause();
        checker.setUnavailable(true);
        vm.warp(vm.getBlockTimestamp() + 40 days); // Beyond grace: full delivery needs no mark.
        (uint256 a, uint256 b) = engine.harvest(); assertGt(a, 0); assertGt(b, 0);
        uint256 shares = engine.balanceOf(alice);
        vm.prank(alice); (uint256 burned, uint256 out0, uint256 out1) = engine.withdraw(shares, bob, 0, 0);
        assertEq(burned, shares); assertGt(out0, 0); assertGt(out1, 0);
        assertEq(engine.totalSupply(), 0); assertEq(engine.positionLiquidity(), 0);
        _assertCustody(1);
    }
    function test_markUsesObservationAndDecimalsNotSpot() public {
        _seed(); (uint256 mark, uint64 at) = hook.latestMark();
        assertApproxEqRel(mark, 100e18, 0.002e18);
        assertEq(at, 10 days);
        _trade(bob, false, 100e6);
        (uint256 afterMark,) = hook.latestMark(); assertEq(afterMark, mark);
        vm.warp(vm.getBlockTimestamp() + 2 hours);
        hook.postAppraisal(initialTick + 100, uint64(vm.getBlockTimestamp() - 1 hours), keccak256("new report"));
        (uint256 next, uint64 observed) = hook.latestMark(); assertEq(observed, vm.getBlockTimestamp() - 1 hours);
        if (propertyFirst()) assertGt(next, mark); else assertLt(next, mark);
        vm.warp(vm.getBlockTimestamp() + 31 days);
        vm.expectRevert(MintwareMarketEngineCore.ExitMarkUnavailable.selector); engine.totalNav();
        vm.prank(address(engine)); engine.readPricesForExit();
        vm.warp(vm.getBlockTimestamp() + 7 days);
        vm.prank(address(engine)); vm.expectRevert(MWMarketValuation.StaleMark.selector); engine.readPricesForExit();
    }
    function test_observationCannotBeRejuvenatedOrFutureOrZero() public {
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.expectRevert(MintwareRwaAppraisalHook.InvalidObservation.selector); hook.postAppraisal(initialTick);
        vm.expectRevert(MintwareRwaAppraisalHook.InvalidObservation.selector); hook.postAppraisal(initialTick, 10 days, keccak256("repeat"));
        vm.expectRevert(MintwareRwaAppraisalHook.InvalidObservation.selector); hook.postAppraisal(initialTick, uint64(vm.getBlockTimestamp() + 1), keccak256("future"));
        vm.expectRevert(MintwareRwaAppraisalHook.InvalidObservation.selector); hook.postAppraisal(initialTick, 0, keccak256("zero"));
    }
    function test_exactFundingDoesNotSpendSeedOrDonations() public {
        property.mint(address(adapter), 100e18);
        _seed(); _assertCustody(100e18 + 1);
        property.setTaxed(true);
        // Direct engine balances isolate settlement from contribution/idle transfer checks.
        property.mint(address(engine), 10e18); usdc.mint(address(engine), 1000e6);
        vm.expectRevert(MWV4Settlement.InexactAdapterFunding.selector);
        engine.deployLiquidity(0, 0, false, 0, 0, 0, 1);
        _assertCustody(100e18 + 1);
    }
    function _expectBandRefusal(bool propertyIn, uint128 amount) internal {
        bytes memory plan = _plan(propertyIn == propertyFirst(), amount);
        vm.prank(bob);
        (bool ok, bytes memory error) = address(router).call(abi.encodeCall(router.execute, (plan)));
        assertFalse(ok);
        assertEq(bytes4(error), CustomRevert.WrappedError.selector);
        bytes memory inner = new bytes(error.length - 4);
        for (uint256 i; i < inner.length; ++i) inner[i] = error[i + 4];
        (address failed, bytes4 callback, bytes memory reason,) = abi.decode(inner, (address, bytes4, bytes, bytes));
        assertEq(failed, address(hook)); assertEq(callback, IHooks.afterSwap.selector);
        assertEq(bytes4(reason), MintwareRwaAppraisalHook.PriceOutOfBand.selector);
    }
    function test_bandRefusesOutsideAndAllowsOnlyGapClosing() public {
        _seed();
        int24 beforeTick = _tick();
        _expectBandRefusal(true, 100_000e18);
        assertEq(_tick(), beforeTick);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        hook.postAppraisal(initialTick + 1000, uint64(vm.getBlockTimestamp()), keccak256("move one"));
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        hook.postAppraisal(initialTick + 2000, uint64(vm.getBlockTimestamp()), keccak256("move two"));
        // Price is below the new band. Increasing tick closes the gap without yet entering it.
        _trade(bob, !propertyFirst(), propertyFirst() ? uint128(1000e6) : uint128(10e18));
        assertGt(_tick(), beforeTick); assertLt(_tick(), hook.appraisalTick() - 1500);
        _expectBandRefusal(propertyFirst(), propertyFirst() ? uint128(10e18) : uint128(1000e6));
    }
    function test_recenterAndRevokedAddRollback() public {
        _seed();
        // Move toward the lower edge without using state writes or synthetic pool mocks.
        for (uint256 i; _tick() > initialTick - 480 && i < 100; ++i) {
            _trade(bob, propertyFirst(), propertyFirst() ? uint128(10e18) : uint128(1000e6));
        }
        assertLe(_tick(), initialTick - 480);
        uint128 beforeLiquidity = engine.positionLiquidity();
        int24 lower = engine.tickLower();
        checker.set(address(engine), address(property), PermissionFlags.NONE);
        vm.expectRevert(_hookError(IHooks.beforeAddLiquidity.selector, abi.encodeWithSelector(MintwareRwaAppraisalHook.Unauthorized.selector)));
        engine.recenter(1);
        assertEq(engine.positionLiquidity(), beforeLiquidity); assertEq(engine.tickLower(), lower);
        _assertCustody(1);
        checker.set(address(engine), address(property), PermissionFlags.LIQUIDITY_ALLOWED);
        vm.prank(bob); engine.recenter(1); // Caller has no LP permission; pooled principal does.
        assertLt(engine.tickLower(), lower); assertGt(engine.positionLiquidity(), 0);
        assertEq(engine.tickUpper() - engine.tickLower(), 1200);
        _assertCustody(1);
    }
    function test_mintNeedsEnginePermissionAndWrapper() public {
        checker.set(address(engine), address(property), PermissionFlags.NONE);
        vm.expectRevert(MintwareOwnedPoolMarketEngine.LiquidityNotAllowed.selector); _deposit(alice, 0, 100e6);
        checker.set(address(engine), address(property), PermissionFlags.LIQUIDITY_ALLOWED);
        adapter.updateAllowedWrapper(address(engine), false);
        vm.expectRevert(MintwareOwnedPoolMarketEngine.LiquidityNotAllowed.selector); _deposit(alice, 0, 100e6);
        assertEq(engine.totalSupply(), 0);
    }
    function test_pauseStalenessAndAdapterSwapSwitchRejectNewTrades() public {
        _seed(); bytes memory plan = _plan(propertyFirst(), 1e18);
        hook.pauseTrading();
        vm.prank(bob); vm.expectRevert(_hookError(IHooks.beforeSwap.selector, abi.encodeWithSelector(MintwareRwaAppraisalHook.TradingIsPaused.selector))); router.execute(plan);
        hook.resumeTrading(); adapter.updateSwappingEnabled(false);
        vm.prank(bob); vm.expectRevert(_hookError(IHooks.beforeSwap.selector, abi.encodeWithSelector(MintwareRwaAppraisalHook.SwappingDisabled.selector))); router.execute(plan);
        adapter.updateSwappingEnabled(true); vm.warp(vm.getBlockTimestamp() + 30 days + 1);
        vm.prank(bob); vm.expectRevert(_hookError(IHooks.beforeSwap.selector, abi.encodeWithSelector(MintwareRwaAppraisalHook.AppraisalStale.selector))); router.execute(plan);
    }
    function test_agePolicyPinnedAndDatedRollingDriftRetained() public {
        MintwareRwaAppraisalHook.Config memory c = MintwareRwaAppraisalHook.Config(500, 1500, 1000, 1 hours, 31 days, 3000, 10000, 2000, 7 days);
        vm.expectRevert(MintwareRwaAppraisalHook.BadConfig.selector); hook.proposeConfig(c);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        hook.postAppraisal(initialTick + 1000, uint64(vm.getBlockTimestamp()), keccak256("first"));
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        hook.postAppraisal(initialTick, uint64(vm.getBlockTimestamp()), keccak256("reversal"));
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.expectRevert(MintwareRwaAppraisalHook.DailyDriftExceeded.selector);
        hook.postAppraisal(initialTick + 1, uint64(vm.getBlockTimestamp()), keccak256("over budget"));
        (, uint64 date) = hook.latestMark(); assertEq(date, 10 days + 2 hours);
    }
    function test_nativeRecipientFreezeUsesExistingGraceExitAndRetainsShares() public {
        _seed();
        property.setEligible(bob, false);
        vm.warp(vm.getBlockTimestamp() + 31 days);
        uint256 shares = engine.balanceOf(alice);
        vm.prank(alice); (uint256 burned, uint256 a, uint256 b) = engine.withdraw(shares, bob, 0, 0);
        assertGt(burned, 0); assertLt(burned, shares);
        assertEq(propertyFirst() ? a : b, 0); assertGt(propertyFirst() ? b : a, 0);
        assertEq(engine.balanceOf(alice), shares - burned);
    }

    function test_rejectUnverifiedAdapterAndSecondPin() public {
        MintwareRwaAppraisalHook other = _deployHook();
        address unverified = factory.createPermissionsAdapter(IERC20(address(property)), address(this), checker);
        PoolKey memory bad = address(unverified) < address(usdc)
            ? PoolKey(Currency.wrap(unverified), Currency.wrap(address(usdc)), 0x800000, 60, IHooks(other))
            : PoolKey(Currency.wrap(address(usdc)), Currency.wrap(unverified), 0x800000, 60, IHooks(other));
        vm.expectRevert(MintwareRwaAppraisalHook.UnverifiedAdapter.selector); other.pinPoolKey(bad, factory, address(usdc));
        vm.expectRevert(MintwareRwaAppraisalHook.AlreadySet.selector); hook.pinPoolKey(key, factory, address(usdc));
    }
    function test_ownerInitializesAndUnboundPoolCannotTradeOrMark() public {
        MintwareRwaAppraisalHook other = _deployHook();
        PoolKey memory otherKey = key; otherKey.hooks = IHooks(other);
        other.pinPoolKey(otherKey, factory, address(usdc));
        other.initAppraisal(initialTick, uint64(vm.getBlockTimestamp()), keccak256("initial"));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CustomRevert.WrappedError.selector, address(other), IHooks.beforeInitialize.selector,
            abi.encodeWithSelector(MintwareRwaAppraisalHook.Unauthorized.selector), abi.encodeWithSelector(Hooks.HookCallFailed.selector)));
        manager.initialize(otherKey, TickMath.getSqrtPriceAtTick(initialTick));
        manager.initialize(otherKey, TickMath.getSqrtPriceAtTick(initialTick));
        vm.expectRevert(MintwareRwaAppraisalHook.NoAppraisal.selector); other.latestMark();
        key = otherKey;
        bytes memory plan = _plan(propertyFirst(), 1e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CustomRevert.WrappedError.selector, address(other), IHooks.beforeSwap.selector,
            abi.encodeWithSelector(MintwareRwaAppraisalHook.VaultNotSet.selector), abi.encodeWithSelector(Hooks.HookCallFailed.selector)));
        router.execute(plan);
    }
    function test_markRejectsZeroAndHandlesExtremeWithoutOverflow() public {
        MintwareRwaAppraisalHook other = _deployHook();
        PoolKey memory otherKey = key; otherKey.hooks = IHooks(other);
        other.pinPoolKey(otherKey, factory, address(usdc));
        int24 zeroTick = propertyFirst() ? TickMath.MIN_TICK + 1 : TickMath.MAX_TICK - 1;
        vm.expectRevert(MintwareRwaAppraisalHook.InvalidObservation.selector);
        other.initAppraisal(zeroTick, uint64(vm.getBlockTimestamp()), keccak256("zero"));
        assertFalse(other.hasAppraisal()); assertEq(other.observedAt(), 0);
        // At supported decimals, even the opposite extreme fits uint256; prove full-precision conversion.
        other.initAppraisal(-zeroTick, uint64(vm.getBlockTimestamp()), keccak256("large representable price"));
        assertTrue(other.hasAppraisal()); assertEq(other.appraisalTick(), -zeroTick);
    }

    function test_secondEngineCannotActivateAgainstAnAlreadyBoundHook() public {
        address module = address(engine.lifecycleModule());
        MintwareOwnedPoolMarketEngine other = MintwareOwnedPoolMarketEngine(deployCode(
            "MintwareOwnedPoolMarketEngine.sol:MintwareOwnedPoolMarketEngine", abi.encode(_engineConfig(module))));
        MintwareIdleYieldAdapter a = new MintwareIdleYieldAdapter(address(other.token0()), address(other), address(this), type(uint256).max);
        MintwareIdleYieldAdapter b = new MintwareIdleYieldAdapter(address(other.token1()), address(other), address(this), type(uint256).max);
        other.configureAdapters(address(a), address(b));
        vm.expectRevert(MintwareMarketEngineCore.InvalidConfiguration.selector); other.activate();
        assertFalse(other.activated());
    }

    function test_ownedEngineSwapDisabled() public {
        _deposit(alice, 1000e18, 100_000e6);
        uint256 a = idle0.totalAssets(); uint256 b = idle1.totalAssets();
        vm.expectRevert(MintwareMarketEngineCore.InvalidSwap.selector);
        engine.deployLiquidity(a, b, true, 1, 1, 1, 1);
    }
}

contract OwnedPoolProperty0Test is OwnedPoolEngineFixture {
    function propertyFirst() internal pure override returns (bool) { return true; }
}
contract OwnedPoolProperty1Test is OwnedPoolEngineFixture {
    function propertyFirst() internal pure override returns (bool) { return false; }
}
