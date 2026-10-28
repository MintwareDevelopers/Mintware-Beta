// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {Test} from "forge-std/Test.sol";
import {MintwarePaymentGateway} from "../../src/payments/MintwarePaymentGateway.sol";
import {MintwareYieldVault} from "../../src/payments/MintwareYieldVault.sol";
import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";
import {MWTimelockedRiskParams} from "../../src/lib/MWTimelockedRiskParams.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract RefillAdapter is IYieldAdapter {
    using SafeERC20 for MockERC20;
    MockERC20 public immutable token;
    uint256 public liquid = type(uint256).max;
    constructor(MockERC20 t) { token = t; }
    function asset() external view returns (address) { return address(token); }
    function setLiquid(uint256 n) external { liquid = n; }
    function deposit(uint256 n) external { token.safeTransferFrom(msg.sender, address(this), n); }
    function withdraw(uint256 n) external returns (uint256 got) {
        got = n < liquid ? n : liquid;
        token.safeTransfer(msg.sender, got);
    }
    function totalAssets() external view returns (uint256) { return token.balanceOf(address(this)); }
    function maxWithdrawable() external view returns (uint256) {
        uint256 b = token.balanceOf(address(this)); return b < liquid ? b : liquid;
    }
    function maxSuppliable() external pure returns (uint256) { return type(uint256).max; }
}

contract MintwarePaymentGatewayRiskParamsTest is Test {
    MockERC20 internal token;
    RefillAdapter internal adapter;
    MintwareYieldVault internal vault;
    MintwarePaymentGateway internal gateway;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal buffer = makeAddr("buffer");
    address internal nextBuffer = makeAddr("nextBuffer");
    address internal outsider = makeAddr("outsider");
    uint256 internal constant DELAY = 48 hours;

    function setUp() public {
        token = new MockERC20("USD Coin", "USDC", 6);
        adapter = new RefillAdapter(token);
        vault = new MintwareYieldVault(address(token), address(adapter), address(this));
        gateway = new MintwarePaymentGateway(address(vault), address(this));
        vault.setGateway(address(gateway));
        token.mint(alice, 10_000e6);
        token.mint(bob, 10_000e6);
        vm.prank(alice); token.approve(address(vault), type(uint256).max);
        vm.prank(bob); token.approve(address(vault), type(uint256).max);
        vm.prank(alice); vault.deposit(1_000e6, alice);
        vm.prank(bob); vault.deposit(1_000e6, bob);
        _register(alice, buffer);
        _register(bob, makeAddr("bobBuffer"));
    }

    function _register(address member, address destination) internal {
        vm.prank(member); gateway.proposeBuffer(destination);
        vm.warp(block.timestamp + DELAY);
        vm.prank(member); gateway.acceptBuffer();
    }

    function _refill(address member, uint256 assets, bytes32 id) internal returns (uint256) {
        uint256 shares = vault.previewWithdraw(assets);
        return gateway.refill(id, member, shares);
    }

    function test_relayerOnly_memberOwnShares_andRegisteredDestination() public {
        vm.expectRevert(); vm.prank(outsider); gateway.refill(keccak256("x"), alice, 1);
        vm.expectRevert(MintwarePaymentGateway.NoBuffer.selector);
        gateway.refill(keccak256("unregistered"), outsider, 1);
        uint256 aliceBefore = vault.balanceOf(alice);
        uint256 bobBefore = vault.balanceOf(bob);
        uint256 paid = _refill(alice, 25e6, keccak256("own"));
        assertEq(paid, 25e6);
        assertEq(token.balanceOf(buffer), 25e6);
        assertLt(vault.balanceOf(alice), aliceBefore);
        assertEq(vault.balanceOf(bob), bobBefore);
        _register(outsider, makeAddr("outsiderBuffer"));
        vm.expectRevert(MintwareYieldVault.InsufficientShares.selector);
        gateway.refill(keccak256("overshares"), outsider, 1);
    }

    function test_userAndGlobalCaps_andFixedWindowRollover() public {
        gateway.setUserCap(alice, 100e6);
        assertEq(_refill(alice, 70e6, keccak256("u1")), 70e6);
        uint256 shares = vault.previewWithdraw(31e6);
        assertEq(gateway.refill(keccak256("u2"), alice, shares), 30e6);
        gateway.setGlobalCap(120e6);
        assertEq(_refill(bob, 50e6, keccak256("g1")), 20e6);
        shares = vault.previewWithdraw(1e6);
        vm.expectRevert(MintwarePaymentGateway.RefillLimitExceeded.selector);
        gateway.refill(keccak256("g2"), bob, shares);
        vm.warp(6 days);
        assertEq(_refill(alice, 100e6, keccak256("nextday")), 100e6);
        assertEq(gateway.userRefilled(alice, block.timestamp / 1 days), 100e6);
        assertEq(gateway.globalRefilled(block.timestamp / 1 days), 100e6);
    }

    function test_refillIdIsGlobalAndSingleUse() public {
        bytes32 id = keccak256("unique");
        _refill(alice, 10e6, id);
        uint256 shares = vault.previewWithdraw(10e6);
        vm.expectRevert(MintwarePaymentGateway.RefillAlreadyDone.selector);
        gateway.refill(id, bob, shares);
    }

    function test_destinationProposal_acceptCancelAndRevoke() public {
        vm.prank(alice); gateway.proposeBuffer(nextBuffer);
        vm.expectRevert(MintwarePaymentGateway.DestinationDelayNotElapsed.selector);
        vm.prank(alice); gateway.acceptBuffer();
        vm.warp(block.timestamp + DELAY);
        vm.prank(alice); gateway.acceptBuffer();
        assertEq(gateway.bufferOf(alice), nextBuffer);
        assertEq(vault.destinationOf(alice), nextBuffer);
        vm.prank(alice); gateway.proposeBuffer(buffer);
        vm.prank(alice); gateway.cancelBufferProposal();
        vm.prank(alice); gateway.revokeBuffer();
        assertEq(gateway.bufferOf(alice), address(0));
        uint256 shares = vault.previewWithdraw(1e6);
        vm.expectRevert(MintwarePaymentGateway.NoBuffer.selector);
        gateway.refill(keccak256("revoked"), alice, shares);
    }

    function test_pauseStopsOnlyGatewayRefills_memberVaultExitStillWorks() public {
        gateway.pause();
        uint256 shares = vault.previewWithdraw(1e6);
        vm.expectRevert(); gateway.refill(keccak256("paused"), alice, shares);
        uint256 exitShares = vault.balanceOf(alice);
        vm.prank(alice); uint256 paid = vault.redeem(exitShares, alice, alice);
        assertGt(paid, 0);
    }

    function test_riskCapIncreaseTimelockedAndDecreaseInstant_cancelable() public {
        gateway.setUserCap(alice, 100e6);
        bytes32 userParam = keccak256(abi.encode("MW_USER_REFILL_CAP", alice));
        gateway.setUserCap(alice, 200e6);
        (uint256 proposed,, uint256 eta) = gateway.pendingRiskParam(userParam);
        assertEq(proposed, 200e6);
        vm.expectRevert(MWTimelockedRiskParams.RiskParamDelayNotElapsed.selector);
        gateway.confirmUserCap(alice);
        gateway.setUserCap(alice, 50e6);
        (,, eta) = gateway.pendingRiskParam(userParam);
        assertEq(eta, 0);
        gateway.setGlobalCap(2_000e6);
        bytes32 globalParam = keccak256("MW_GLOBAL_REFILL_CAP");
        assertGt(_pendingEta(globalParam), block.timestamp);
        gateway.cancelGlobalCap();
        assertEq(_pendingEta(globalParam), 0);
        gateway.setGlobalCap(2_000e6);
        vm.warp(block.timestamp + DELAY);
        gateway.confirmGlobalCap();
        assertEq(gateway.globalCap(), 2_000e6);
    }

    function test_illiquidRefillCountsOnlyDeliveredAmount() public {
        adapter.setLiquid(40e6);
        assertEq(_refill(alice, 300e6, keccak256("partial")), 40e6);
        uint256 day = block.timestamp / 1 days;
        assertEq(gateway.userRefilled(alice, day), 40e6);
        assertEq(gateway.globalRefilled(day), 40e6);
        adapter.setLiquid(type(uint256).max);
        assertEq(_refill(alice, 60e6, keccak256("afterpartial")), 60e6);
        assertEq(gateway.userRefilled(alice, day), 100e6);
    }

    function _pendingEta(bytes32 param) internal view returns (uint256 eta) {
        (,, eta) = gateway.pendingRiskParam(param);
    }
}
