// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

/// @dev Idle-path (tokenId == 0) unit tests never call V4; a non-zero address satisfies the ctor guard.
///      The deployed round-trip (mint / harvest / deployed-NAV) is proven in the fork harness.
contract Stub {}

contract MintwareLpGatewayPositionManagerTest is Test {
    MintwareLpGatewayStaging staging;
    MintwareLpGatewayPositionManager pm;
    MockERC20 usdg;
    MockERC20 pons;
    MockYieldAdapter adapter;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address harvestSink = address(0x5151);

    function setUp() public {
        usdg = new MockERC20("USD Global", "USDG", 6);
        pons = new MockERC20("Pons", "PONS", 18);
        adapter = new MockYieldAdapter(address(usdg));
        staging = new MintwareLpGatewayStaging(IERC20(address(usdg)), adapter);

        (address c0, address c1) =
            address(usdg) < address(pons) ? (address(usdg), address(pons)) : (address(pons), address(usdg));
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        address stub = address(new Stub());
        pm = new MintwareLpGatewayPositionManager(
            IPoolManager(stub), IPositionManager(stub), IPermit2Minimal(stub),
            key, IERC20(address(usdg)), -600, 600, staging, address(this), harvestSink
        );
        staging.setController(address(pm));

        usdg.mint(alice, 2_000_000e6);
        usdg.mint(bob, 2_000_000e6);
        vm.prank(alice);
        usdg.approve(address(pm), type(uint256).max);
        vm.prank(bob);
        usdg.approve(address(pm), type(uint256).max);
    }

    function _deposit(address who, uint256 amt) internal returns (uint256) {
        vm.prank(who);
        return pm.deposit(amt);
    }

    function test_firstDeposit_oneToOne() public {
        uint256 s = _deposit(alice, 100_000e6);
        assertEq(s, 100_000e6);
        assertEq(pm.totalNav(), 100_000e6);
    }

    function test_secondDeposit_pricedAtNav() public {
        _deposit(alice, 100_000e6);
        usdg.mint(address(adapter), 10_000e6); // simulated yield lifts NAV
        uint256 sBob = _deposit(bob, 100_000e6);
        assertLt(sBob, 100_000e6);
    }

    function test_withdraw_idle_returnsValue() public {
        uint256 s = _deposit(alice, 100_000e6);
        vm.prank(alice);
        (uint256 q, uint256 p) = pm.withdraw(s / 2);
        assertApproxEqAbs(q, 50_000e6, 2);
        assertEq(p, 0);
    }

    /// The donation-inflation attack: attacker deposits dust then donates to inflate NAV. The virtual
    /// offset + offset-consistent withdraw must leave the next depositor whole (not zeroed, not robbed).
    function test_inflationDefense_secondDepositorWhole() public {
        _deposit(alice, 1);
        usdg.mint(address(adapter), 100_000e6); // donation
        uint256 sBob = _deposit(bob, 100_000e6);
        assertGt(sBob, 0);
        vm.prank(bob);
        (uint256 q,) = pm.withdraw(sBob);
        assertApproxEqRel(q, 100_000e6, 0.01e18); // recovers ~his deposit; cannot steal the donation
    }

    function test_deploy_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pm.deploy(1, 1, block.timestamp);
    }

    function test_harvest_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pm.harvest(block.timestamp);
    }

    function test_harvest_revertsWhenUndeployed() public {
        vm.expectRevert(MintwareLpGatewayPositionManager.NotDeployed.selector);
        pm.harvest(block.timestamp);
    }

    function test_withdraw_moreThanBalance_reverts() public {
        uint256 s = _deposit(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(MintwareLpGatewayPositionManager.InsufficientShares.selector);
        pm.withdraw(s + 1);
    }

    function test_setHarvestRecipient_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pm.setHarvestRecipient(bob);
    }
}
