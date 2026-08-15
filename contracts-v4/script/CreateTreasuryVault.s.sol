// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console}                    from "forge-std/Script.sol";
import {MintwareTreasuryVaultFactory}       from "../src/payments/MintwareTreasuryVaultFactory.sol";
import {MintwareTreasuryJitHook}            from "../src/payments/MintwareTreasuryJitHook.sol";
import {HookMiner}                          from "../src/lib/HookMiner.sol";
import {IHooks}                             from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}                            from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}                           from "@uniswap/v4-core/src/types/Currency.sol";

/// @notice Launch ONE team's YPN treasury vault through an already-deployed factory
///         (`DeployTreasuryFactory.s.sol`). Generalizes the single-shot `DeployTreasuryV2.s.sol`: it reads
///         the factory's predicted vault address, mines the JIT hook salt against the factory's HOOK
///         DEPLOYER, and calls `factory.createVault(params, salt)` — atomic deploy + wire + register.
///
/// ─── Required env ───────────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY (must be the factory owner — createVault is onlyOwner in v1),
///   TREASURY_FACTORY, V4_POOL_MANAGER, USDC_ADDRESS, TEAM_TOKEN_ADDRESS, ADAPTER_ADDRESS,
///   CIRCLE_TREASURY.
///   Optional: TEAM_ADDRESS (default deployer), VAULT_OWNER (default deployer — the ops owner the
///     vault + hook are transferred to), GATEWAY_ADMIN (default deployer), POOL_FEE (3000),
///     TICK_SPACING (60), INIT_SQRT_PRICE (default 1:1 @ tick 0).
///
/// ⚠ INIT_SQRT_PRICE: the 1:1 default is only correct when USDC + the team token share decimals. Pass a
///   decimal-adjusted price for real 6dp/18dp pairs (same caveat as DeployTreasuryV2).
///
/// ─── Run ────────────────────────────────────────────────────────────────────
///   forge script contracts-v4/script/CreateTreasuryVault.s.sol --rpc-url base_sepolia --broadcast -vvvv
contract CreateTreasuryVault is Script {
    uint160 constant DEFAULT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    uint160 constant JIT_HOOK_FLAGS     = 0xC0; // beforeSwap | afterSwap

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        MintwareTreasuryVaultFactory factory =
            MintwareTreasuryVaultFactory(vm.envAddress("TREASURY_FACTORY"));

        MintwareTreasuryVaultFactory.CreateParams memory p = MintwareTreasuryVaultFactory.CreateParams({
            usdc:          vm.envAddress("USDC_ADDRESS"),
            teamToken:     vm.envAddress("TEAM_TOKEN_ADDRESS"),
            adapter:       vm.envAddress("ADAPTER_ADDRESS"),
            team:          vm.envOr("TEAM_ADDRESS", deployer),
            owner:         vm.envOr("VAULT_OWNER", deployer),
            treasury:      vm.envAddress("CIRCLE_TREASURY"),
            poolFee:       uint24(vm.envOr("POOL_FEE", uint256(3000))),
            tickSpacing:   int24(uint24(vm.envOr("TICK_SPACING", uint256(60)))),
            initSqrtPrice: uint160(vm.envOr("INIT_SQRT_PRICE", uint256(DEFAULT_SQRT_PRICE))),
            gatewayAdmin:  vm.envOr("GATEWAY_ADMIN", deployer)
        });

        address poolMgr = vm.envAddress("V4_POOL_MANAGER");
        require(p.usdc != p.teamToken, "identical tokens");

        // The address the next createVault will land the vault at.
        address predictedVault = factory.predictNextVault();

        // Sorted, placeholder-hooks key for the hook ctor + mining (matches the factory exactly).
        (address c0, address c1) = p.usdc < p.teamToken ? (p.usdc, p.teamToken) : (p.teamToken, p.usdc);
        PoolKey memory ctorKey = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: p.poolFee,
            tickSpacing: p.tickSpacing,
            hooks: IHooks(address(0))
        });

        // Mine the JIT hook salt against the factory's HOOK DEPLOYER (the CREATE2 deployer), with the
        // hook owner = the factory (so the factory can wire before transferring ownership).
        address hookDeployer = address(factory.hookDeployer());
        bytes memory hookArgs = abi.encode(poolMgr, ctorKey, p.usdc, predictedVault, address(factory));
        (address minedHook, bytes32 hookSalt) =
            HookMiner.find(hookDeployer, JIT_HOOK_FLAGS, type(MintwareTreasuryJitHook).creationCode, hookArgs);

        console.log("=== Create YPN Treasury Vault ===");
        console.log("Factory:        ", address(factory));
        console.log("PredictedVault: ", predictedVault);
        console.log("MinedHook:      ", minedHook);

        vm.startBroadcast(deployerKey);
        (address vault, address hook, address gateway) = factory.createVault(p, hookSalt);
        vm.stopBroadcast();

        require(vault == predictedVault, "vault prediction drift");
        require(hook == minedHook, "hook prediction drift");

        console.log("Vault:   ", vault);
        console.log("Hook:    ", hook);
        console.log("Gateway: ", gateway);
        console.log("Next: team calls vault.commitTeam(...); adapter.setVault(vault) if it gates on one.");
    }
}
