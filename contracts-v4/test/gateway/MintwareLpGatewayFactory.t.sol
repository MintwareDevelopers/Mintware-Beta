// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MintwareLpGatewayFactory} from "../../src/gateway/MintwareLpGatewayFactory.sol";
import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

contract Stub {}

contract MintwareLpGatewayFactoryTest is Test {
    using PoolIdLibrary for PoolKey;

    MintwareLpGatewayFactory factory;
    MockERC20 usdg;
    MockERC20 pons;
    MockYieldAdapter adapter;
    address stranger = address(0xBEEF);
    address gwOwner = address(0x0011);
    address sink = address(0x5151);

    function setUp() public {
        usdg = new MockERC20("USD Global", "USDG", 6);
        pons = new MockERC20("Pons", "PONS", 18);
        adapter = new MockYieldAdapter(address(usdg));
        address stub = address(new Stub());
        factory = new MintwareLpGatewayFactory(
            IPoolManager(stub), IPositionManager(stub), IPermit2Minimal(stub), address(this)
        );
    }

    function _key(uint24 fee) internal view returns (PoolKey memory) {
        (address c0, address c1) =
            address(usdg) < address(pons) ? (address(usdg), address(pons)) : (address(pons), address(usdg));
        return PoolKey({currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: fee, tickSpacing: 60, hooks: IHooks(address(0))});
    }

    function test_createGateway_isolatedInstance() public {
        PoolKey memory key = _key(3000);
        (address s, address p) = factory.createGateway(key, IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink);
        assertTrue(s != address(0) && p != address(0));
        assertEq(MintwareLpGatewayStaging(s).controller(), p);
        assertEq(factory.poolCount(), 1);
        (address rs, address rp, bool active) = factory.instanceForPool(PoolId.unwrap(key.toId()));
        assertEq(rs, s);
        assertEq(rp, p);
        assertTrue(active);
    }

    function test_createGateway_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        factory.createGateway(_key(3000), IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink);
    }

    function test_createGateway_duplicateReverts() public {
        factory.createGateway(_key(3000), IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink);
        vm.expectRevert(MintwareLpGatewayFactory.AlreadyExists.selector);
        factory.createGateway(_key(3000), IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink);
    }

    function test_twoPools_isolated() public {
        (, address p1) = factory.createGateway(_key(3000), IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink);
        (, address p2) = factory.createGateway(_key(500), IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink);
        assertTrue(p1 != p2);
        assertEq(factory.poolCount(), 2);
    }

    function test_deactivate() public {
        PoolKey memory key = _key(3000);
        factory.createGateway(key, IERC20(address(usdg)), adapter, -22980, 22980, gwOwner, sink);
        factory.deactivate(PoolId.unwrap(key.toId()));
        (,, bool active) = factory.instanceForPool(PoolId.unwrap(key.toId()));
        assertFalse(active);
        vm.expectRevert(MintwareLpGatewayFactory.NotFound.selector);
        factory.deactivate(bytes32(uint256(0xdead)));
    }
}
