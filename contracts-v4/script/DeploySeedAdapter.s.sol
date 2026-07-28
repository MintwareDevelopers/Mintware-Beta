// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PoolKey}  from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks}   from "@uniswap/v4-core/src/interfaces/IHooks.sol";

import {MintwareSeedAdapter}   from "../src/MintwareSeedAdapter.sol";
import {MintwareDeFiVault4626} from "../src/vaults/MintwareDeFiVault4626.sol";

/// @notice Deploy a per-vault MintwareSeedAdapter and hand it the vault's ownership
///         so it can seed + set the LP range during a fair-launch raise.
///
/// ─── Required env ────────────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY   — must be the vault's CURRENT owner (to transferOwnership)
///   VAULT_ADDRESS          — the MintwareDeFiVault4626 to seed into
///   SEED_POOL_ADDRESS      — the MintwareSeedPool singleton
///   VAULT_ID               — bytes32 vaultId the seed's poolInit will carry
///   POOL_CURRENCY0/1       — the pool pair (sorted; one is the vault's asset(), one the project token)
///   POOL_FEE               — uint24 fee (e.g. 3000)
///   POOL_TICK_SPACING      — int24 tick spacing (e.g. 60)
///   POOL_HOOKS             — the MWSocialHook address
///   TICK_LOWER / TICK_UPPER — int24 LP range set right after seeding (e.g. -60000 / 60000)
///
/// ─── Run ─────────────────────────────────────────────────────────────────────
///   forge script contracts-v4/script/DeploySeedAdapter.s.sol --rpc-url base_sepolia --broadcast --verify -vvvv
///
/// After deploy: open the seed on the SeedPool with target = adapter,
/// poolInit = VAULT_ID, fullReserveOnFinalize = true.
contract DeploySeedAdapter is Script {
    function run() external {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");

        address vault     = vm.envAddress("VAULT_ADDRESS");
        address seedPool  = vm.envAddress("SEED_POOL_ADDRESS");
        bytes32 vaultId   = vm.envBytes32("VAULT_ID");
        address c0        = vm.envAddress("POOL_CURRENCY0");
        address c1        = vm.envAddress("POOL_CURRENCY1");
        uint256 fee       = vm.envUint("POOL_FEE");
        int256  spacing   = vm.envInt("POOL_TICK_SPACING");
        address hooks     = vm.envAddress("POOL_HOOKS");
        int256  tickLower = vm.envInt("TICK_LOWER");
        int256  tickUpper = vm.envInt("TICK_UPPER");

        PoolKey memory poolKey = PoolKey({
            currency0:   Currency.wrap(c0),
            currency1:   Currency.wrap(c1),
            fee:         uint24(fee),
            tickSpacing: int24(spacing),
            hooks:       IHooks(hooks)
        });

        vm.startBroadcast(key);
        MintwareSeedAdapter adapter = new MintwareSeedAdapter(
            vault, seedPool, vaultId, poolKey, int24(tickLower), int24(tickUpper)
        );
        // Hand the vault to the adapter so it can seedTeamTokens + rebalance.
        MintwareDeFiVault4626(vault).transferOwnership(address(adapter));
        vm.stopBroadcast();

        console.log("MintwareSeedAdapter deployed:", address(adapter));
        console.log("Vault ownership transferred to adapter:", vault);
    }
}
