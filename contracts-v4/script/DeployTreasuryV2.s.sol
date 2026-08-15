// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console}          from "forge-std/Script.sol";
import {MintwareTreasuryVault}    from "../src/payments/MintwareTreasuryVault.sol";
import {MintwareTreasuryJitHook}  from "../src/payments/MintwareTreasuryJitHook.sol";
import {MintwarePaymentGateway}   from "../src/payments/MintwarePaymentGateway.sol";
import {HookMiner}                from "../src/lib/HookMiner.sol";
import {IPoolManager}             from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                   from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}                  from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}                 from "@uniswap/v4-core/src/types/Currency.sol";

/// @notice Deploy the YPN v2 treasury-vault stack (the "spend-while-you-earn" LSA) — the treasury vault
///         (which HOLDS its Uniswap-V4 position itself, Phase-2 convergence), the JIT hook, and the
///         payment Gateway — against a live V4 PoolManager. This is the "make v2 real" deploy artifact;
///         `DeployTreasuryV2.t.sol` proves the exact assembly + a full deposit→deployToLP→swap→recover→
///         Gateway-burn lifecycle hermetically.
///
/// ─── Deploy order (the vault LPs into the HOOKED pool, so its key needs the mined hook address — a
///     circular dependency broken by PREDICTING the vault's CREATE address) ────────────────────────
///   1. Sort (USDC, teamToken); predict the vault address; mine the JIT hook against it; build the
///      HOOKED PoolKey.
///   2. MintwareTreasuryVault(poolManager, hookedKey, usdc, adapter, owner, team)  ← lands at predicted
///   3. MintwareTreasuryJitHook{salt}(poolManager, ctorKey, usdc, vault, owner)  (CREATE2 factory)
///   4. poolManager.initialize(hookedKey, INIT_SQRT_PRICE)
///   5. vault.setJitHook(hook) ; hook.setJitSkipSender(vault)  (exempt the vault's own recover swaps)
///   6. MintwarePaymentGateway(vault, usdc, circleTreasury, admin) ; vault.setGateway(gateway)
///   7. Grant EDGE_SIGNER_ROLE / RELAYER_ROLE on the Gateway (edge engine + relayer), if provided
///
/// ─── Required env vars ──────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY, V4_POOL_MANAGER, USDC_ADDRESS, TEAM_TOKEN_ADDRESS,
///   ADAPTER_ADDRESS (an IYieldAdapter over USDC — deploy AaveV3YieldAdapter separately and, if it
///     gates on a vault, call its setVault(vault) after step 3), CIRCLE_TREASURY (the card rail).
///   Optional: GATEWAY_ADMIN (default deployer), EDGE_SIGNER, RELAYER, POOL_FEE (3000),
///     TICK_SPACING (60), INIT_SQRT_PRICE (default 1:1 @ tick 0).
///
/// ⚠ INIT_SQRT_PRICE: the default (1:1 @ tick 0) is only right when USDC and the team token share
///   decimals. Production USDC is 6dp; a 6dp/18dp pool must be initialized at the DECIMAL-ADJUSTED price
///   or the module will mis-size liquidity. Pass INIT_SQRT_PRICE explicitly for real tokens.
///
/// ─── Run ────────────────────────────────────────────────────────────────────
///   forge script contracts-v4/script/DeployTreasuryV2.s.sol --rpc-url base_sepolia --broadcast -vvvv
///   (Teams commit their junior via vault.commitTeam(...) afterwards — that is not a deployer action.)
contract DeployTreasuryV2 is Script {
    uint160 constant DEFAULT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    address constant C2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C; // deterministic CREATE2 factory
    uint160 constant JIT_HOOK_FLAGS = 0x20C0; // beforeInitialize | beforeSwap | afterSwap

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        address poolMgr   = vm.envAddress("V4_POOL_MANAGER");
        address usdc      = vm.envAddress("USDC_ADDRESS");
        address teamToken = vm.envAddress("TEAM_TOKEN_ADDRESS");
        address adapter   = vm.envAddress("ADAPTER_ADDRESS");
        address treasury  = vm.envAddress("CIRCLE_TREASURY");
        address admin     = vm.envOr("GATEWAY_ADMIN", deployer);
        uint24  poolFee     = uint24(vm.envOr("POOL_FEE", uint256(3000)));
        int24   tickSpacing = int24(uint24(vm.envOr("TICK_SPACING", uint256(60))));
        uint160 initPrice   = uint160(vm.envOr("INIT_SQRT_PRICE", uint256(DEFAULT_SQRT_PRICE)));
        address edgeSigner  = vm.envOr("EDGE_SIGNER", address(0));
        address relayer     = vm.envOr("RELAYER", address(0));

        require(usdc != teamToken, "identical tokens");
        (address c0, address c1) = usdc < teamToken ? (usdc, teamToken) : (teamToken, usdc);

        // Placeholder-hooks key for the hook ctor + mining (the hook ctor ignores key.hooks).
        PoolKey memory ctorKey = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee:       poolFee,
            tickSpacing: tickSpacing,
            hooks:     IHooks(address(0))
        });

        console.log("=== YPN v2 Treasury Vault Deploy ===");
        console.log("Chain:    ", block.chainid);
        console.log("Deployer: ", deployer);
        console.log("USDC:     ", usdc);
        console.log("TeamToken:", teamToken);

        // Phase-2 convergence: the vault HOLDS the V4 position itself (the `MintwareV4LiquidityModule`
        // was folded into it via the `MWTreasuryPositionLib` delegatecall library). The vault must LP
        // into the HOOKED pool, so its poolKey carries the JIT hook — which is circular (the hook ctor
        // takes the vault address, and the vault's key needs the mined hook address). Break it by
        // PREDICTING the vault's CREATE address: the vault is the deployer's FIRST broadcast CREATE, and
        // the hook is deployed via the CREATE2 factory (which does NOT consume the deployer's CREATE
        // nonce), so the vault lands at computeCreateAddress(deployer, currentNonce).
        address team = vm.envOr("TEAM_ADDRESS", deployer);
        address predictedVault = vm.computeCreateAddress(deployer, vm.getNonce(deployer));

        // 1. Mine the JIT hook (flags 0xC0 = beforeSwap|afterSwap) against the PREDICTED vault address.
        bytes memory hookArgs = abi.encode(poolMgr, ctorKey, usdc, predictedVault, deployer);
        (address hookAddr, bytes32 hookSalt) =
            HookMiner.find(C2_FACTORY, JIT_HOOK_FLAGS, type(MintwareTreasuryJitHook).creationCode, hookArgs);

        // 2. The hooked pool key (the vault LPs into this pool; the hook JITs team->USDC swaps).
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0), currency1: Currency.wrap(c1),
            fee: poolFee, tickSpacing: tickSpacing, hooks: IHooks(hookAddr)
        });

        vm.startBroadcast(deployerKey);

        // 3. Treasury vault (senior = community USDC; junior = team token) — the deployer's FIRST CREATE,
        //    so it lands at `predictedVault`. AUDIT M1: the team address is bound at creation.
        MintwareTreasuryVault vault = new MintwareTreasuryVault(poolMgr, key, usdc, adapter, deployer, team);
        require(address(vault) == predictedVault, "vault address mismatch");
        console.log("TreasuryVault:", address(vault));

        // 4. Deploy the JIT hook via the CREATE2 factory (mined permission bits hold; no CREATE-nonce use).
        MintwareTreasuryJitHook hook =
            new MintwareTreasuryJitHook{salt: hookSalt}(poolMgr, ctorKey, usdc, address(vault), deployer);
        require(address(hook) == hookAddr, "hook address mismatch");
        console.log("JitHook:      ", address(hook));

        // 5. Open the V4 pool WITH the hook (the vault reads slot0; the hook JITs team->USDC swaps).
        IPoolManager(poolMgr).initialize(key, initPrice);

        // 6. Wire the JIT seam: vault <-> hook, and exempt the vault's OWN recover/collect swaps.
        vault.setJitHook(address(hook));
        hook.setJitSkipSender(address(vault));

        // 7. Payment Gateway (settles card charges against the senior side).
        MintwarePaymentGateway gateway = new MintwarePaymentGateway(address(vault), usdc, treasury, admin);
        vault.setGateway(address(gateway));
        vault.setProtocolTreasury(treasury);
        console.log("Gateway:      ", address(gateway));

        // 6. Grant edge/relayer roles (admin holds them by default; add the operational EOAs).
        if (edgeSigner != address(0)) gateway.grantRole(gateway.EDGE_SIGNER_ROLE(), edgeSigner);
        if (relayer    != address(0)) gateway.grantRole(gateway.RELAYER_ROLE(),     relayer);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deploy complete ===");
        console.log("Next: adapter.setVault(vault) if the adapter gates on it; team calls vault.commitTeam(...);");
        console.log("point edge-auth EDGE_VAULT_ADDRESS + the relayer/gateway envs at the addresses above.");
    }
}
