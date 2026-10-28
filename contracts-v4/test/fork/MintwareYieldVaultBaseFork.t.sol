// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test, console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { MintwareYieldVault } from "../../src/payments/MintwareYieldVault.sol";
import { MintwarePaymentGateway } from "../../src/payments/MintwarePaymentGateway.sol";
import { MintwareERC4626YieldAdapter } from "../../src/vaults/MintwareERC4626YieldAdapter.sol";

contract MintwareYieldVaultBaseForkTest is Test {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant MORPHO_STEAKHOUSE_USDC = 0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183;
    address constant USDC_WHALE = 0x20a9dC684B4d0407EF8c9a302bEa4fa0F3F1cF5f;
    uint256 constant DEPOSIT = 1_000e6;
    uint256 constant REFILL_CAP = 100e6;

    function test_base_morpho_steakhouse_full_earn_refill_lane() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, 53_000_000);
        assertEq(block.chainid, 8453, "expected Base mainnet fork");
        assertEq(IERC4626(MORPHO_STEAKHOUSE_USDC).asset(), USDC, "source asset mismatch");
        assertGt(MORPHO_STEAKHOUSE_USDC.code.length, 0, "source has no code at Base fork");

        address member = makeAddr("earn-member");
        address buffer = makeAddr("earn-buffer-wallet");
        address relayer = makeAddr("earn-relayer");
        MintwareERC4626YieldAdapter adapter = new MintwareERC4626YieldAdapter(
            USDC, MORPHO_STEAKHOUSE_USDC, address(0), address(this)
        );
        MintwareYieldVault vault = new MintwareYieldVault(USDC, address(adapter), address(this));
        adapter.setVault(address(vault));
        MintwarePaymentGateway gateway = new MintwarePaymentGateway(address(vault), address(this));
        vault.setGateway(address(gateway));
        gateway.grantRole(gateway.RELAYER_ROLE(), relayer);
        gateway.setUserCap(member, REFILL_CAP);
        gateway.setGlobalCap(REFILL_CAP);

        deal(USDC, USDC_WHALE, 2_000e6);
        vm.startPrank(USDC_WHALE);
        IERC20(USDC).transfer(member, DEPOSIT);
        vm.stopPrank();
        vm.startPrank(member);
        IERC20(USDC).approve(address(vault), type(uint256).max);
        uint256 memberShares = vault.deposit(DEPOSIT, member);
        gateway.proposeBuffer(buffer);
        vm.expectRevert(MintwarePaymentGateway.DestinationDelayNotElapsed.selector);
        gateway.acceptBuffer();
        vm.warp(block.timestamp + 48 hours);
        gateway.acceptBuffer();
        vm.stopPrank();
        assertEq(gateway.bufferOf(member), buffer, "buffer not accepted");

        uint256 initialAssets = vault.convertToAssets(memberShares);
        vm.warp(block.timestamp + 30 days);
        uint256 grownAssets = vault.convertToAssets(vault.balanceOf(member));
        assertGt(grownAssets, initialAssets, "Morpho yield did not accrue");

        bytes32 refillId = keccak256("base-fork-earn-refill-1");
        uint256 requestedShares = vault.previewWithdraw(150e6);
        vm.prank(relayer);
        uint256 delivered = gateway.refill(refillId, member, requestedShares);
        assertEq(delivered, REFILL_CAP, "refill was not clipped to cap");
        assertEq(IERC20(USDC).balanceOf(buffer), delivered, "buffer USDC mismatch");
        assertEq(gateway.userRefilled(member, block.timestamp / 1 days), delivered);
        uint256 replayShares = vault.previewWithdraw(1e6);
        vm.expectRevert(MintwarePaymentGateway.RefillAlreadyDone.selector);
        vm.prank(relayer);
        gateway.refill(refillId, member, replayShares);

        vm.prank(member);
        gateway.revokeBuffer();
        uint256 revokedShares = vault.previewWithdraw(1e6);
        vm.expectRevert(MintwarePaymentGateway.NoBuffer.selector);
        vm.prank(relayer);
        gateway.refill(keccak256("base-fork-after-revoke"), member, revokedShares);

        uint256 remainingShares = vault.balanceOf(member);
        vm.prank(member);
        uint256 redeemed = vault.redeem(remainingShares, member, member);
        uint256 combined = IERC20(USDC).balanceOf(buffer) + redeemed;
        assertGt(combined, DEPOSIT, "buffer plus redeem did not exceed deposit");

        console2.log("BASE EARN+REFILL FORK PASS");
        console2.log("deposit_usdc_6dp", DEPOSIT);
        console2.log("assets_before_yield_usdc_6dp", initialAssets);
        console2.log("assets_after_yield_usdc_6dp", grownAssets);
        console2.log("refill_requested_usdc_6dp", uint256(150e6));
        console2.log("refill_delivered_usdc_6dp", delivered);
        console2.log("redeemed_usdc_6dp", redeemed);
        console2.log("buffer_plus_redeem_usdc_6dp", combined);
    }
}
