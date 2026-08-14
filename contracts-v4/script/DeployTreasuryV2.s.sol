// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console}          from "forge-std/Script.sol";
import {MintwareTreasuryVault}    from "../src/payments/MintwareTreasuryVault.sol";
import {MintwareV4LiquidityModule} from "../src/payments/MintwareV4LiquidityModule.sol";
import {MintwarePaymentGateway}   from "../src/payments/MintwarePaymentGateway.sol";
import {IPoolManager}             from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                   from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}                  from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}                 from "@uniswap/v4-core/src/types/Currency.sol";

/// @notice Deploy the YPN v2 treasury-vault stack (the "spend-while-you-earn" LSA) — the treasury vault,
///         the REAL Uniswap-V4 liquidity module behind its `ILiquidityModule` seam, and the payment
///         Gateway — against a live V4 PoolManager. This is the "make v2 real" deploy artifact;
///         `DeployTreasuryV2.t.sol` proves the exact assembly + a full deposit→deployToLP→swap→recover→
///         Gateway-burn lifecycle hermetically.
///
/// ─── Deploy order ─────────────────────────────────────────────────────────
///   1. Sort (USDC, teamToken) → PoolKey (NO hook — passive full-range module; the JIT/surge hook is a
///      later layer that composes IN FRONT of this seam)
///   2. poolManager.initialize(key, INIT_SQRT_PRICE)   ← the module reads slot0, so the pool must exist
///   3. MintwareTreasuryVault(usdc, teamToken, adapter, owner)
///   4. MintwareV4LiquidityModule(poolManager, key, usdc, vault, owner) ; vault.setLiquidityModule(module)
///   5. MintwarePaymentGateway(vault, usdc, circleTreasury, admin) ; vault.setGateway(gateway)
///   6. Grant EDGE_SIGNER_ROLE / RELAYER_ROLE on the Gateway (edge engine + relayer), if provided
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

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee:       poolFee,
            tickSpacing: tickSpacing,
            hooks:     IHooks(address(0)) // passive full-range module — no hook
        });

        console.log("=== YPN v2 Treasury Vault Deploy ===");
        console.log("Chain:    ", block.chainid);
        console.log("Deployer: ", deployer);
        console.log("USDC:     ", usdc);
        console.log("TeamToken:", teamToken);

        vm.startBroadcast(deployerKey);

        // 2. Open the V4 pool (the module reads slot0).
        IPoolManager(poolMgr).initialize(key, initPrice);

        // 3. Treasury vault (senior = community USDC; junior = team token).
        MintwareTreasuryVault vault = new MintwareTreasuryVault(usdc, teamToken, adapter, deployer);
        console.log("TreasuryVault:", address(vault));

        // 4. Real V4 liquidity module behind the ILiquidityModule seam.
        MintwareV4LiquidityModule module = new MintwareV4LiquidityModule(poolMgr, key, usdc, address(vault), deployer);
        vault.setLiquidityModule(address(module));
        console.log("V4Module:     ", address(module));

        // 5. Payment Gateway (settles card charges against the senior side).
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
