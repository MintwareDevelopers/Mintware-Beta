// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MintwareVaultRegistry} from "../src/vaults/MintwareVaultRegistry.sol";
import {VaultSurface, VaultRecord} from "../src/vaults/VaultTypes.sol";

contract MintwareVaultRegistryTest is Test {
    MintwareVaultRegistry internal reg;

    address internal vault    = makeAddr("vault");
    address internal feeVault = makeAddr("feeVault");
    address internal hook     = makeAddr("hook");
    address internal provider = makeAddr("provider");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant ID = keccak256("v1");

    function setUp() public {
        reg = new MintwareVaultRegistry();
    }

    function _register() internal {
        reg.registerVault(ID, VaultSurface.DeFi, vault, feeVault, hook, address(0), provider);
    }

    function test_register_and_read() public {
        _register();
        VaultRecord memory r = reg.getVault(ID);
        assertEq(r.vault, vault);
        assertEq(r.feeVault, feeVault);
        assertEq(r.hook, hook);
        assertEq(uint256(r.surface), uint256(VaultSurface.DeFi));
        assertEq(r.provider, provider);
        assertEq(reg.vaultCount(), 1);
        assertEq(reg.allVaultIds()[0], ID);
    }

    function test_register_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        reg.registerVault(ID, VaultSurface.DeFi, vault, feeVault, hook, address(0), provider);
    }

    function test_register_rejects_duplicate() public {
        _register();
        vm.expectRevert(MintwareVaultRegistry.VaultExists.selector);
        _register();
    }

    function test_register_rejects_zero() public {
        vm.expectRevert(MintwareVaultRegistry.ZeroAddress.selector);
        reg.registerVault(ID, VaultSurface.DeFi, address(0), feeVault, hook, address(0), provider);
    }

    function test_getVault_unknown_reverts() public {
        vm.expectRevert(MintwareVaultRegistry.UnknownVault.selector);
        reg.getVault(keccak256("nope"));
    }
}
