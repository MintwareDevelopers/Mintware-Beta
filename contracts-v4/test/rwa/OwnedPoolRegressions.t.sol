// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {OwnedPoolEngineFixture} from "./OwnedPoolEngine.t.sol";
import {MintwareRwaAppraisalHook} from "../../src/rwa/MintwareRwaAppraisalHook.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PermissionFlags} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/libraries/PermissionFlags.sol";
import {CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OwnedIssuerToken} from "./OwnedPoolFixtures.sol";

contract OwnedPoolRegressions is OwnedPoolEngineFixture {
    function propertyFirst() internal pure override returns (bool) { return true; }
    function _config() internal pure returns (MintwareRwaAppraisalHook.Config memory) {
        return MintwareRwaAppraisalHook.Config(500,1500,1000,1 hours,30 days,3000,10000,2000,7 days);
    }
    function test_lifecycleInstallerArtifactMatchesCompiledSource() public {
        bytes memory pinned = vm.parseBytes(vm.readLine(
            "contracts-v4/script/data/MintwareMarketLifecycleModuleV2.creation.hex"
        ));
        assertEq(pinned, vm.getCode("MintwareMarketLifecycleModule.sol:MintwareMarketLifecycleModule"));
    }
    function test_keeperAndConfigTimelocks() public {
        hook.proposeKeeper(bob);
        vm.expectRevert(MintwareRwaAppraisalHook.TimelockActive.selector); hook.confirmKeeper();
        MintwareRwaAppraisalHook.Config memory c = _config(); c.specBandTicks = 3000;
        hook.proposeConfig(c);
        (,uint24 spec,,,,,,,) = hook.config(); assertEq(spec,1500);
        vm.expectRevert(MintwareRwaAppraisalHook.TimelockActive.selector); hook.confirmConfig();
        vm.warp(vm.getBlockTimestamp()+48 hours); hook.confirmKeeper(); hook.confirmConfig();
        assertEq(hook.keeper(),bob); (,spec,,,,,,,) = hook.config(); assertEq(spec,3000);
    }
    function test_badConfigRefusals() public {
        MintwareRwaAppraisalHook.Config memory c = _config(); c.coreBandTicks=2000;
        vm.expectRevert(MintwareRwaAppraisalHook.BadConfig.selector); hook.proposeConfig(c);
        c=_config(); c.maxStepTicks=1501;
        vm.expectRevert(MintwareRwaAppraisalHook.BadConfig.selector); hook.proposeConfig(c);
        c=_config(); c.maxDriftTicksPerDay=999;
        vm.expectRevert(MintwareRwaAppraisalHook.BadConfig.selector); hook.proposeConfig(c);
    }
    function test_stepsCadenceAndKeeperRefusals() public {
        vm.warp(vm.getBlockTimestamp()+1);
        vm.expectRevert(MintwareRwaAppraisalHook.UpdateTooSoon.selector);
        hook.postAppraisal(initialTick+10,uint64(vm.getBlockTimestamp()),keccak256("report"));
        vm.warp(vm.getBlockTimestamp()+1 hours);
        vm.expectRevert(MintwareRwaAppraisalHook.StepTooLarge.selector);
        hook.postAppraisal(initialTick+1001,uint64(vm.getBlockTimestamp()),keccak256("report"));
        vm.prank(bob); vm.expectRevert(MintwareRwaAppraisalHook.OnlyKeeper.selector);
        hook.postAppraisal(initialTick+10,uint64(vm.getBlockTimestamp()),keccak256("report"));
        hook.postAppraisal(initialTick+1000,uint64(vm.getBlockTimestamp()),keccak256("report"));
        assertEq(hook.appraisalTick(),initialTick+1000);
    }
    function test_nativeRevokedHolderCannotSellOrReceive() public {
        _seed(); property.setEligible(bob,false);
        vm.expectRevert(OwnedIssuerToken.NativePermissionDenied.selector);
        _trade(bob,true,1e18);
        vm.expectRevert(abi.encodeWithSelector(CustomRevert.WrappedError.selector,address(adapter),IERC20.transfer.selector,
            abi.encodeWithSignature("Error(string)","TRANSFER_FAILED"),abi.encodeWithSelector(CurrencyLibrary.ERC20TransferFailed.selector)));
        _trade(bob,false,100e6);
        vm.prank(alice); vm.expectRevert(OwnedIssuerToken.NativePermissionDenied.selector);
        property.transfer(bob,1e18);
    }
    function test_onlyEngineAddsAndRemoves() public {
        ModifyLiquidityParams memory p = ModifyLiquidityParams(initialTick-600,initialTick+600,1,0);
        vm.prank(address(manager)); vm.expectRevert(MintwareRwaAppraisalHook.OnlyVault.selector);
        hook.beforeAddLiquidity(bob,key,p,"");
        p.liquidityDelta=-1;
        vm.prank(address(manager)); vm.expectRevert(MintwareRwaAppraisalHook.OnlyVault.selector);
        hook.beforeRemoveLiquidity(bob,key,p,"");
    }
    function test_boundHookRefusesAnotherPool() public {
        PoolKey memory other=key; other.tickSpacing=10;
        vm.expectRevert(_hookError(IHooks.beforeInitialize.selector,abi.encodeWithSelector(MintwareRwaAppraisalHook.PoolAlreadyBound.selector)));
        manager.initialize(other,TickMath.getSqrtPriceAtTick(initialTick));
    }
    function test_pinAndInitializationRefusals() public {
        MintwareRwaAppraisalHook other=_deployHook(); PoolKey memory k=key; k.hooks=IHooks(other); k.fee=3000;
        vm.expectRevert(MintwareRwaAppraisalHook.WrongPool.selector); other.pinPoolKey(k,factory,address(usdc));
        k.fee=0x800000; other.pinPoolKey(k,factory,address(usdc));
        other.initAppraisal(initialTick,uint64(vm.getBlockTimestamp()),keccak256("report"));
        vm.expectRevert(abi.encodeWithSelector(CustomRevert.WrappedError.selector,address(other),IHooks.beforeInitialize.selector,
            abi.encodeWithSelector(MintwareRwaAppraisalHook.InitOutsideCoreBand.selector),abi.encodeWithSelector(Hooks.HookCallFailed.selector)));
        manager.initialize(k,TickMath.getSqrtPriceAtTick(initialTick+600)); assertFalse(other.poolBound());
        k.tickSpacing=10;
        vm.expectRevert(abi.encodeWithSelector(CustomRevert.WrappedError.selector,address(other),IHooks.beforeInitialize.selector,
            abi.encodeWithSelector(MintwareRwaAppraisalHook.WrongPool.selector),abi.encodeWithSelector(Hooks.HookCallFailed.selector)));
        manager.initialize(k,TickMath.getSqrtPriceAtTick(initialTick)); assertFalse(other.poolBound());
        vm.expectRevert(MintwareRwaAppraisalHook.WrongPool.selector); other.setVault(address(engine));
    }
    function test_pausePreservesPositionAndFreshObservationRestoresTrading() public {
        _seed(); uint128 liq=engine.positionLiquidity(); hook.pauseTrading();
        vm.expectRevert(_hookError(IHooks.beforeSwap.selector,abi.encodeWithSelector(MintwareRwaAppraisalHook.TradingIsPaused.selector)));
        _trade(bob,false,100e6); assertEq(engine.positionLiquidity(),liq); hook.resumeTrading();
        vm.warp(vm.getBlockTimestamp()+31 days); assertFalse(hook.isFresh()); assertTrue(hook.oracleReady());
        vm.warp(vm.getBlockTimestamp()+7 days); assertFalse(hook.oracleReady());
        hook.postAppraisal(initialTick,uint64(vm.getBlockTimestamp()),keccak256("new report"));
        assertTrue(hook.oracleReady()); _trade(bob,false,100e6);
    }
    function test_coreAndSpecFeesUsePreSwapTick() public {
        _seed(); SwapParams memory p=SwapParams(true,-1,TickMath.MIN_SQRT_PRICE+1);
        checker.set(address(engine),address(property),PermissionFlags.ALL_ALLOWED);
        vm.prank(address(manager)); (, , uint24 fee)=hook.beforeSwap(address(engine),key,p,"");
        assertEq(fee,3000 | LPFeeLibrary.OVERRIDE_FEE_FLAG);
        for (uint256 i; _tick() < initialTick+510 && i<100; ++i) _trade(bob,false,1000e6);
        assertGt(_tick(),initialTick+500); assertLe(_tick(),initialTick+1500);
        vm.prank(address(manager)); (, , fee)=hook.beforeSwap(address(engine),key,p,"");
        assertEq(fee,10000 | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function testFuzz_tradesNeverLeaveBand(uint256 amount,bool propertyIn) public {
        _seed(); amount=bound(amount,1e6,50000e6);
        bytes memory plan=_plan(propertyIn,propertyIn ? uint128(amount*1e10) : uint128(amount));
        vm.prank(bob); address(router).call(abi.encodeCall(router.execute,(plan)));
        (, , uint256 dev,, ,)=hook.bandStatus(); assertLe(dev,1500);
    }
}
