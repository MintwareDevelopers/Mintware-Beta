// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {MintwareYieldVault} from "../../src/payments/MintwareYieldVault.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";

contract MintwareYieldVaultBaseForkTest is Test {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant MORPHO_STEAKHOUSE_USDC = 0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183;
    function test_base_morpho_steakhouse_erc4626_deposit_yield_redeem() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) { vm.skip(true); return; }
        vm.createSelectFork(rpc, 53_000_000);
        assertEq(block.chainid, 8453);
        assertEq(IERC4626(MORPHO_STEAKHOUSE_USDC).asset(), USDC, "source asset mismatch");
        assertGt(MORPHO_STEAKHOUSE_USDC.code.length, 0, "source has no code at Base fork");

        MintwareERC4626YieldAdapter adapter = new MintwareERC4626YieldAdapter(
            USDC, MORPHO_STEAKHOUSE_USDC, address(0), address(this)
        );
        MintwareYieldVault vault = new MintwareYieldVault(USDC, address(adapter), address(this));
        adapter.setVault(address(vault));
        address usdcWhale = 0x20a9dC684B4d0407EF8c9a302bEa4fa0F3F1cF5f;
        deal(USDC, usdcWhale, 2_000e6);
        vm.startPrank(usdcWhale);
        IERC20(USDC).approve(address(vault), type(uint256).max);
        uint256 shares = vault.deposit(1_000e6, usdcWhale);
        vm.stopPrank();
        uint256 deposited = vault.convertToAssets(shares);
        vm.warp(block.timestamp + 30 days);
        assertGt(vault.convertToAssets(shares), deposited, "source yield did not accrue");
        vm.prank(usdcWhale);
        uint256 paid = vault.redeem(shares, usdcWhale, usdcWhale);
        assertGt(paid, 1_000e6, "redeem did not exceed deposit");
    }
}
