// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console}  from "forge-std/Script.sol";
import {IPoolManager}     from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}           from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}          from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}         from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary}     from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath}         from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {MintwareRwaAppraisalHook}      from "../src/rwa/MintwareRwaAppraisalHook.sol";
import {IRwaIdentityRegistry}          from "../src/rwa/interfaces/IRwaIdentityRegistry.sol";
import {MockRwaIdentityRegistry}       from "../src/rwa/testnet/MockRwaIdentityRegistry.sol";
import {MockPermissionedPropertyToken} from "../src/rwa/testnet/MockPermissionedPropertyToken.sol";
import {DemoUSD}                       from "../src/rwa/testnet/DemoUSD.sol";
import {DemoSwapRouter}                from "../src/rwa/testnet/DemoSwapRouter.sol";
import {MockRwaLiquidityVault}         from "../test/rwa/MockRwaLiquidityVault.sol";

/// @notice V2-RWAs — deploy ONE demo RWA liquidity unit on a testnet (Base Sepolia by default) and open it:
///         registry + permissioned property token + demo USD + appraisal hook (CREATE2-mined) + a test-only
///         liquidity actor + demo router. The actor seeds a real pool position; this script exercises the
///         RWA hook without deploying the retired Treasury product.
///
///         TESTNET ONLY. The deployer plays issuer, keeper and guardian for the demo; the property is
///         fictional and every token is valueless.
///
/// Env: DEPLOYER_PRIVATE_KEY (0x-prefixed). Optional: V4_POOL_MANAGER (Base Sepolia default),
///      APPRAISAL_TICK_ABS (230270 ≈ $100 per 18-dp unit in 6-dp dUSD), PROPERTY_NAME, PROPERTY_SYMBOL.
///
/// Run: forge script contracts-v4/script/DeployRwaLiquidityUnit.s.sol --rpc-url base_sepolia --broadcast -vv
contract DeployRwaLiquidityUnit is Script {
    address constant C2_FACTORY  = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant BASE_SEPOLIA_POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    uint160 constant HOOK_FLAGS  = 0x2AC0; // beforeInit | beforeAdd | beforeRemove | beforeSwap | afterSwap

    struct Deployed {
        DemoUSD                       usd;
        MockRwaIdentityRegistry       registry;
        MockPermissionedPropertyToken property;
        MintwareRwaAppraisalHook      hook;
        MockRwaLiquidityVault         vault;
        DemoSwapRouter                router;
        PoolKey                       key;
        int24                         appraisal;
    }

    function demoConfig() public pure returns (MintwareRwaAppraisalHook.Config memory) {
        return MintwareRwaAppraisalHook.Config({
            coreBandTicks: 300,          // ≈ ±3%   — low-fee zone
            specBandTicks: 1_000,        // ≈ ±10.5% — hard band
            maxStepTicks: 500,           // ≈ 5% per appraisal update
            minUpdateInterval: 10 minutes,
            maxAppraisalAge: 30 days,
            coreFeePips: 3_000,          // 0.30%
            specFeePips: 10_000,         // 1.00%
            maxDriftTicksPerDay: 1_000,  // ≈ 10.5% aggregate per 24 h
            oracleGraceSecs: 7 days      // exit window after trading goes stale
        });
    }

    function run() external returns (Deployed memory d) {
        uint256 pk       = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        IPoolManager pm  = IPoolManager(vm.envOr("V4_POOL_MANAGER", BASE_SEPOLIA_POOL_MANAGER));

        string memory name   = vm.envOr("PROPERTY_NAME", string("Willow Creek Parcel 7 (demo)"));
        string memory symbol = vm.envOr("PROPERTY_SYMBOL", string("WCP7"));
        int24   tickAbs      = int24(uint24(vm.envOr("APPRAISAL_TICK_ABS", uint256(230_270))));

        vm.startBroadcast(pk);

        d.usd      = new DemoUSD(deployer);
        d.registry = new MockRwaIdentityRegistry(deployer);
        d.property = new MockPermissionedPropertyToken(name, symbol, 18, IRwaIdentityRegistry(address(d.registry)), deployer);
        // Hook: CREATE2-mined so its address carries the permission bits.
        bytes memory hookArgs = abi.encode(pm, deployer, deployer, deployer, demoConfig());
        (address hookAddr, bytes32 salt) = _findHook(HOOK_FLAGS, type(MintwareRwaAppraisalHook).creationCode, hookArgs);
        // Deploy THROUGH the deterministic CREATE2 factory explicitly (calldata = salt ‖ initcode). Forge's
        // `new X{salt:}` is not guaranteed to route via this factory in every mode, which would land the hook
        // at an address without the mined permission bits.
        (bool ok, bytes memory ret) =
            C2_FACTORY.call(abi.encodePacked(salt, type(MintwareRwaAppraisalHook).creationCode, hookArgs));
        require(ok && ret.length == 20 && address(bytes20(ret)) == hookAddr, "hook CREATE2 failed");
        d.hook = MintwareRwaAppraisalHook(hookAddr);

        bool propIs0 = address(d.property) < address(d.usd);
        d.key = PoolKey({
            currency0: Currency.wrap(propIs0 ? address(d.property) : address(d.usd)),
            currency1: Currency.wrap(propIs0 ? address(d.usd) : address(d.property)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(hookAddr)
        });
        d.appraisal = propIs0 ? -tickAbs : tickAbs;

        // A test-only liquidity actor lets this deployment exercise the RWA hook independently.
        d.vault  = new MockRwaLiquidityVault(pm, d.key);
        d.router = new DemoSwapRouter(pm);

        d.hook.setVault(address(d.vault));

        // Enroll Mintware's contracts as permitted holders of the property token (the issuer's one-time act).
        d.property.setPermittedHolder(address(pm), true);
        d.property.setPermittedHolder(address(d.vault), true);
        d.property.setPermittedHolder(address(d.router), true);

        // Appraisal first, then open the pool exactly at it.
        d.hook.initAppraisal(d.appraisal);
        pm.initialize(d.key, TickMath.getSqrtPriceAtTick(d.appraisal));

        // Seed testnet-only liquidity directly; the actor is deliberately not a Treasury replacement.
        d.property.mint(deployer, 5_000e18);
        d.property.transfer(address(d.vault), 5_000e18);
        d.usd.mint(address(d.vault), 1_000_000e6);
        d.vault.addPosition(-887_220, 887_220, 2e15);

        vm.stopBroadcast();

        console.log("=== V2-RWAs demo liquidity unit ===");
        console.log("chainId         ", block.chainid);
        console.log("deployer/issuer ", deployer);
        console.log("DemoUSD         ", address(d.usd));
        console.log("IdentityRegistry", address(d.registry));
        console.log("PropertyToken   ", address(d.property));
        console.log("AppraisalHook   ", address(d.hook));
        console.log("TestLiquidityActor", address(d.vault));
        console.log("DemoSwapRouter  ", address(d.router));
        console.log("propertyIsCurrency0", propIs0);
        console.logInt(d.appraisal);
    }

    function _findHook(uint160 flags, bytes memory creationCode, bytes memory constructorArgs)
        internal
        pure
        returns (address hookAddress, bytes32 salt)
    {
        uint160 mask = uint160((1 << 14) - 1);
        bytes32 initCodeHash = keccak256(abi.encodePacked(creationCode, constructorArgs));
        for (uint256 nonce; nonce < 160_000; ++nonce) {
            salt = bytes32(nonce);
            hookAddress = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff), C2_FACTORY, salt, initCodeHash
            )))));
            if (uint160(hookAddress) & mask == flags & mask) return (hookAddress, salt);
        }
        revert("hook salt not found");
    }
}
