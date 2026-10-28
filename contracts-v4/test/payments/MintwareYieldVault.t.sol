// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {Test} from "forge-std/Test.sol";
import {MintwareYieldVault} from "../../src/payments/MintwareYieldVault.sol";
import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract EarnAdapter is IYieldAdapter {
    using SafeERC20 for MockERC20;
    MockERC20 public immutable token;
    uint256 public liquid = type(uint256).max;
    uint256 public feeBps;
    constructor(MockERC20 t) { token = t; }
    function asset() external view returns (address) { return address(token); }
    function setLiquid(uint256 n) external { liquid = n; }
    function setFee(uint256 n) external { feeBps = n; }
    function deposit(uint256 n) external { token.safeTransferFrom(msg.sender, address(this), n); }
    function withdraw(uint256 n) external returns (uint256 got) {
        uint256 amount = n < liquid ? n : liquid;
        uint256 fee = amount * feeBps / 10_000;
        token.safeTransfer(msg.sender, amount - fee);
        if (fee != 0) token.safeTransfer(address(0xdead), fee);
        got = amount - fee;
    }
    function totalAssets() external view returns (uint256) { return token.balanceOf(address(this)); }
    function maxWithdrawable() external view returns (uint256) {
        uint256 bal = token.balanceOf(address(this)); return bal < liquid ? bal : liquid;
    }
    function maxSuppliable() external pure returns (uint256) { return type(uint256).max; }
}

contract EarnGatewayHarness {
    mapping(address => address) public bufferOf;
    function destination(MintwareYieldVault v, address member, address to) external {
        bufferOf[member] = to; v.registerDestination(member, to);
    }
    function redeem(MintwareYieldVault v, address member, uint256 shares_) external returns (uint256) {
        return v.gatewayRedeem(member, shares_);
    }
}

contract MintwareYieldVaultTest is Test {
    MockERC20 token;
    EarnAdapter adapter;
    MintwareYieldVault vault;
    EarnGatewayHarness gateway;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address destination = makeAddr("destination");

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        adapter = new EarnAdapter(token);
        vault = new MintwareYieldVault(address(token), address(adapter), address(this));
        gateway = new EarnGatewayHarness();
        vault.setGateway(address(gateway));
        token.mint(alice, 1_000_000e6);
        token.mint(bob, 1_000_000e6);
        vm.prank(alice); token.approve(address(vault), type(uint256).max);
        vm.prank(bob); token.approve(address(vault), type(uint256).max);
    }
    function _deposit(address who, uint256 amount) internal returns (uint256 s) {
        vm.prank(who); s = vault.deposit(amount, who);
    }
    function test_erc4626_deposit_mint_withdraw_redeem_and_transfer() public {
        uint256 s = _deposit(alice, 10_000e6);
        assertEq(vault.asset(), address(token)); assertEq(vault.totalAssets(), 10_000e6);
        assertEq(vault.convertToShares(100e6), 100e9);
        assertEq(vault.previewWithdraw(100e6), 100e9);
        assertEq(vault.maxWithdraw(alice), 10_000e6);
        assertEq(vault.maxRedeem(alice), s);
        assertEq(vault.previewRedeem(s), 10_000e6);
        vm.prank(alice); vault.transfer(bob, s / 2);
        assertEq(vault.balanceOf(bob), s / 2);
        vm.prank(alice); uint256 mintedAssets = vault.mint(100e9, alice);
        assertEq(vault.previewMint(100e9), mintedAssets);
        vm.prank(bob); uint256 out = vault.redeem(s / 2, bob, bob);
        assertEq(out, 5_000e6);
        vm.prank(alice); vault.withdraw(100e6, alice, alice);
    }
    function test_pause_blocks_deposit_and_mint_but_exit_is_open() public {
        _deposit(alice, 100e6); vault.pause();
        assertEq(vault.maxDeposit(alice), 0); assertEq(vault.maxMint(alice), 0);
        vm.prank(alice); vm.expectRevert(); vault.deposit(1e6, alice);
        vm.prank(alice); vm.expectRevert(); vault.mint(1e9, alice);
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice); uint256 out = vault.redeem(aliceShares, alice, alice);
        assertGt(out, 0);
    }
    function test_illiquid_exit_pays_available_and_keeps_unpaid_shares() public {
        uint256 s = _deposit(alice, 1_000e6); _deposit(bob, 1_000e6);
        adapter.setLiquid(100e6);
        uint256 bobClaimBefore = vault.convertToAssets(vault.balanceOf(bob));
        vm.prank(alice); uint256 paid = vault.redeem(s, alice, alice);
        assertEq(paid, 100e6);
        assertGt(vault.balanceOf(alice), 0);
        assertGe(vault.convertToAssets(vault.balanceOf(bob)), bobClaimBefore);
    }
    function test_fee_source_charges_exit_holder_for_gross_source_cost() public {
        uint256 s = _deposit(alice, 1_000e6); _deposit(bob, 1_000e6);
        adapter.setFee(100); // 1% source fee
        uint256 bobPpsBefore = vault.convertToAssets(vault.balanceOf(bob));
        vm.prank(alice); uint256 paid = vault.redeem(s, alice, alice);
        assertLt(paid, 1_000e6);
        assertGe(vault.convertToAssets(vault.balanceOf(bob)), bobPpsBefore);
    }
    function test_donation_inflation_defense() public {
        _deposit(alice, 1);
        token.mint(address(vault), 100_000e6);
        uint256 victimShares = _deposit(bob, 10_000e6);
        assertGt(victimShares, 0);
        assertGe(vault.previewRedeem(victimShares), 9_950e6);
    }
    function test_gateway_only_own_shares_and_registered_destination() public {
        uint256 s = _deposit(alice, 100e6);
        vm.expectRevert(MintwareYieldVault.OnlyGateway.selector); vault.gatewayRedeem(alice, s);
        gateway.destination(vault, alice, destination);
        assertEq(gateway.redeem(vault, alice, s / 2), 50e6);
        assertEq(token.balanceOf(destination), 50e6);
        uint256 bobShares = _deposit(bob, 100e6);
        vm.prank(bob); vault.setDestination(bob);
        uint256 aliceSharesBefore = vault.balanceOf(alice);
        gateway.redeem(vault, bob, bobShares);
        assertEq(vault.balanceOf(alice), aliceSharesBefore);
        assertEq(token.balanceOf(bob), 1_000_000e6 - 100e6 + 100e6);
        vm.expectRevert(MintwareYieldVault.InsufficientShares.selector);
        gateway.redeem(vault, alice, s);
        vm.prank(bob); vm.expectRevert(MintwareYieldVault.InsufficientShares.selector);
        gateway.redeem(vault, bob, 1);
    }
    function test_gateway_destination_cannot_be_chosen_by_gateway() public {
        uint256 s = _deposit(alice, 100e6);
        vm.prank(alice); vault.setDestination(destination);
        vm.expectRevert(MintwareYieldVault.OnlyGateway.selector);
        vault.registerDestination(alice, bob);
        assertEq(vault.destinationOf(alice), destination);
        uint256 bobBefore = token.balanceOf(bob);
        gateway.redeem(vault, alice, s);
        assertEq(token.balanceOf(bob), bobBefore);
    }
}
