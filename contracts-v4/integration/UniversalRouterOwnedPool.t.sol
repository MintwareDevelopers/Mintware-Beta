// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {OwnedPoolEngineFixture} from "../test/rwa/OwnedPoolEngine.t.sol";
import {UniversalRouter} from "../lib/universal-router/contracts/UniversalRouter.sol";
import {RouterParameters} from "../lib/universal-router/contracts/types/RouterParameters.sol";
import {DeployPermit2} from "../lib/universal-router/lib/permit2/test/utils/DeployPermit2.sol";
import {IAllowanceTransfer} from "../lib/universal-router/lib/permit2/src/interfaces/IAllowanceTransfer.sol";
import {PermissionFlags} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/libraries/PermissionFlags.sol";
import {MintwareRwaAppraisalHook} from "../src/rwa/MintwareRwaAppraisalHook.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

/// @dev Run with FOUNDRY_PROFILE=permissioned_router for the full Universal Router dispatch path.
/// Permit2 is the pinned upstream precompiled runtime, installed by its own DeployPermit2 helper.
abstract contract UniversalRouterOwnedPoolProof is OwnedPoolEngineFixture {
    UniversalRouter universal;
    IAllowanceTransfer permit2;
    function setUp() public override {
        super.setUp();
        permit2 = IAllowanceTransfer(new DeployPermit2().deployPermit2());
        RouterParameters memory params;
        params.permit2 = address(permit2);
        params.v4PoolManager = address(manager);
        params.permissionsAdapterFactory = address(factory);
        universal = new UniversalRouter(params);
        adapter.updateAllowedWrapper(address(universal),true);
        vm.startPrank(bob);
        property.approve(address(permit2),type(uint256).max);
        usdc.approve(address(permit2),type(uint256).max);
        permit2.approve(address(property),address(universal),type(uint160).max,uint48(block.timestamp+1 days));
        permit2.approve(address(usdc),address(universal),type(uint160).max,uint48(block.timestamp+1 days));
        vm.stopPrank();
        _seed();
    }
    function _inputs(bool propertyIn,uint128 amount) internal view returns (bytes[] memory inputs) {
        inputs=new bytes[](1); inputs[0]=_plan(propertyIn==propertyFirst(),amount);
    }
    function test_universalRouterPermit2BothDirections() public {
        uint256 beforeProperty=property.balanceOf(bob);
        bytes[] memory inputs=_inputs(false,100e6);
        vm.prank(bob); universal.execute(hex"10",inputs,block.timestamp);
        assertGt(property.balanceOf(bob),beforeProperty);
        uint256 beforeQuote=usdc.balanceOf(bob);
        inputs=_inputs(true,1e18);
        vm.prank(bob); universal.execute(hex"10",inputs,block.timestamp);
        assertGt(usdc.balanceOf(bob),beforeQuote);
        assertEq(property.balanceOf(address(universal)),0);
        assertEq(usdc.balanceOf(address(universal)),0);
        assertEq(adapter.balanceOf(address(universal)),0);
        _assertCustody(1);
    }
    function test_universalRouterUnpermittedTraderRefused() public {
        checker.set(bob,address(property),PermissionFlags.LIQUIDITY_ALLOWED);
        bytes memory reason=_hookError(IHooks.beforeSwap.selector,abi.encodeWithSelector(MintwareRwaAppraisalHook.Unauthorized.selector));
        bytes[] memory inputs=_inputs(true,1e18);
        vm.prank(bob); vm.expectRevert(reason); universal.execute(hex"10",inputs,block.timestamp);
        inputs=_inputs(false,100e6);
        vm.prank(bob); vm.expectRevert(reason); universal.execute(hex"10",inputs,block.timestamp);
    }
    function test_universalRouterUntrustedWrapperRefused() public {
        adapter.updateAllowedWrapper(address(universal),false);
        bytes[] memory inputs=_inputs(false,100e6);
        vm.prank(bob); vm.expectRevert(_hookError(IHooks.beforeSwap.selector,abi.encodeWithSelector(MintwareRwaAppraisalHook.Unauthorized.selector)));
        universal.execute(hex"10",inputs,block.timestamp);
    }
    function test_universalRouterRequiresPermit2Allowance() public {
        vm.prank(bob); permit2.approve(address(usdc),address(universal),0,uint48(block.timestamp+1 days));
        bytes[] memory inputs=_inputs(false,100e6);
        vm.prank(bob); vm.expectRevert(abi.encodeWithSignature("InsufficientAllowance(uint256)",uint256(0)));
        universal.execute(hex"10",inputs,block.timestamp);
    }
}
contract UniversalRouterProperty0Test is UniversalRouterOwnedPoolProof {
    function propertyFirst() internal pure override returns (bool) { return true; }
}
contract UniversalRouterProperty1Test is UniversalRouterOwnedPoolProof {
    function propertyFirst() internal pure override returns (bool) { return false; }
}
