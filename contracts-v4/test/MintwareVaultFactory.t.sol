// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";

import {MintwareVaultFactory}  from "../src/vaults/MintwareVaultFactory.sol";
import {MintwareDeFiVault4626} from "../src/vaults/MintwareDeFiVault4626.sol";
import {FeeVault}              from "../src/FeeVault.sol";
import {VaultSurface, LockTier, VaultConfig, VaultRecord} from "../src/vaults/VaultTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract MintwareVaultFactoryTest is Test {
    address internal deployer = address(this);
    address internal provider = makeAddr("provider");
    address internal treasury = makeAddr("treasury");
    address internal oracle   = makeAddr("oracle");
    address internal dist     = makeAddr("distributor");

    PoolManager internal pm;
    MockERC20   internal usdc;
    MintwareVaultFactory internal factory;

    function setUp() public {
        pm      = new PoolManager(deployer);
        usdc    = new MockERC20("USD Coin", "USDC", 6);
        factory = new MintwareVaultFactory(address(pm), dist);
    }

    function _cfg() internal view returns (VaultConfig memory) {
        return VaultConfig({
            surface:             VaultSurface.DeFi,
            provider:            provider,
            underlyingToken:     address(usdc),
            treasury:            treasury,
            name:                "MW DeFi Vault Share",
            symbol:              "mwDEFI",
            minDeposit:          0,
            entryFeeBps:         50,
            exitFeeBps:          100,
            enableMEVProtection: true,
            enableIdleCapital:   false,
            idleTargetRatio:     0
        });
    }

    function _initcode(VaultConfig memory cfg) internal view returns (bytes memory) {
        return abi.encodePacked(
            type(MintwareDeFiVault4626).creationCode,
            abi.encode(cfg, address(pm), address(0))
        );
    }

    function test_createVault_deploys_wires_registers() public {
        VaultConfig memory cfg = _cfg();
        (bytes32 id, address vault, address feeVault) =
            factory.createVault(_initcode(cfg), keccak256("v1"), cfg, address(0), oracle, treasury);

        assertTrue(vault != address(0) && feeVault != address(0), "deployed");

        // wiring
        assertEq(MintwareDeFiVault4626(vault).feeVault(), feeVault, "feeVault set on vault");
        assertEq(FeeVault(feeVault).socialVault(), vault, "socialVault set on FeeVault");

        // ownership handed to provider
        assertEq(MintwareDeFiVault4626(vault).owner(), provider, "vault owner = provider");
        assertEq(FeeVault(feeVault).owner(), provider, "feeVault owner = provider");

        // config carried through
        assertEq(MintwareDeFiVault4626(vault).asset(), address(usdc));
        assertEq(MintwareDeFiVault4626(vault).provider(), provider);
        assertEq(MintwareDeFiVault4626(vault).entryFeeBps(), 50);

        // registry
        VaultRecord memory r = factory.getVault(id);
        assertEq(r.vault, vault);
        assertEq(r.feeVault, feeVault);
        assertEq(r.provider, provider);
        assertEq(factory.vaultCount(), 1);
    }

    function test_createVault_config_mismatch_reverts() public {
        VaultConfig memory cfg = _cfg();
        bytes memory initcode = _initcode(cfg); // vault will carry provider = `provider`
        cfg.provider = makeAddr("other");       // cfg passed to factory now disagrees
        vm.expectRevert(MintwareVaultFactory.VaultConfigMismatch.selector);
        factory.createVault(initcode, keccak256("v2"), cfg, address(0), oracle, treasury);
    }

    function test_createVault_onlyOwner() public {
        VaultConfig memory cfg = _cfg();
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        factory.createVault(_initcode(cfg), keccak256("v3"), cfg, address(0), oracle, treasury);
    }

    function test_created_vault_functions() public {
        VaultConfig memory cfg = _cfg();
        cfg.entryFeeBps = 0;
        cfg.exitFeeBps  = 0;
        (, address vault,) =
            factory.createVault(_initcode(cfg), keccak256("v4"), cfg, address(0), oracle, treasury);

        // A factory-produced vault is fully functional (deposit works; no pool → holds assets).
        address alice = makeAddr("alice");
        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(vault, 1_000e6);
        MintwareDeFiVault4626(vault).depositWithLock(1_000e6, alice, LockTier.Flex);
        vm.stopPrank();

        assertEq(MintwareDeFiVault4626(vault).totalPrincipal(), 1_000e6);
        assertEq(MintwareDeFiVault4626(vault).balanceOf(alice), 1_000e6);
    }
}
