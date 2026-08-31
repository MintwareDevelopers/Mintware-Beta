// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console}  from "forge-std/Script.sol";
import {MWFeeHook}        from "../src/hooks/MWFeeHook.sol";
import {HookMiner}        from "../src/lib/HookMiner.sol";
import {IPoolManager}     from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}           from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}          from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}         from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary}     from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

/// @notice Deploy the routable, auto-allowlistable fee-only hook (`MWFeeHook`) and initialize a
///         DYNAMIC-FEE V4 pool that installs it.
///
/// ─── Why the pool MUST be dynamic-fee ────────────────────────────────────────
///   MWFeeHook prices every swap via `fee | LPFeeLibrary.OVERRIDE_FEE_FLAG` in `beforeSwap`. The V4
///   PoolManager only honours a fee override when the pool was initialized with `fee ==
///   LPFeeLibrary.DYNAMIC_FEE_FLAG` (0x800000). This script initializes with that flag; a static-fee
///   pool would silently ignore the override.
///
/// ─── CREATE2 salt mining (flags == 0xC0) ─────────────────────────────────────
///   The hook address low-14-bits must encode EXACTLY beforeSwap(bit 7) + afterSwap(bit 6) = 0xC0,
///   and nothing else. We mine the salt against the canonical CREATE2 deployer proxy (Foundry routes
///   salted `new` through it when broadcasting), then deploy at the mined address.
///
/// ─── Required env vars ───────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY, V4_POOL_MANAGER, TOKEN_A_ADDRESS, TOKEN_B_ADDRESS
///   Optional (with production-sane defaults):
///     TICK_SPACING (60), INIT_SQRT_PRICE (1:1),
///     BASE_FEE_PIPS (3000 = 0.30%), MAX_FEE_PIPS (100000 = 10%),
///     SLOPE_PIPS_PER_TICK (30), QUAD_PIPS_PER_TICK_SQ (0),
///     MAX_FEE_STEP_PER_BLOCK (2000), LVR_SLOPE_PIPS_PER_TICK (0), LVR_QUAD_PIPS_PER_TICK_SQ (0),
///     GUARD_ENABLED (true), MAX_TICK_MOVE_PER_BLOCK (60), MAX_DEVIATION_TICKS (6000),
///     MAX_CATCHUP_BLOCKS (10), INIT_POOL (true — set false to deploy the hook only)
///
/// ─── Run ─────────────────────────────────────────────────────────────────────
///   forge script contracts-v4/script/DeployFeeHook.s.sol --rpc-url <net> --broadcast -vvvv
contract DeployFeeHook is Script {
    address constant C2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint160 constant DEFAULT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        address poolMgr = vm.envAddress("V4_POOL_MANAGER");
        address tokenA  = vm.envAddress("TOKEN_A_ADDRESS");
        address tokenB  = vm.envAddress("TOKEN_B_ADDRESS");
        require(tokenA != tokenB, "identical tokens");

        int24   tickSpacing = int24(uint24(vm.envOr("TICK_SPACING", uint256(60))));
        uint160 initPrice   = uint160(vm.envOr("INIT_SQRT_PRICE", uint256(DEFAULT_SQRT_PRICE)));

        uint24  baseFee   = uint24(vm.envOr("BASE_FEE_PIPS", uint256(3000)));
        uint24  maxFee    = uint24(vm.envOr("MAX_FEE_PIPS", uint256(100000)));
        uint256 slope     = vm.envOr("SLOPE_PIPS_PER_TICK", uint256(30));
        uint256 quad      = vm.envOr("QUAD_PIPS_PER_TICK_SQ", uint256(0));
        uint24  feeStep   = uint24(vm.envOr("MAX_FEE_STEP_PER_BLOCK", uint256(2000)));
        uint256 lvrSlope  = vm.envOr("LVR_SLOPE_PIPS_PER_TICK", uint256(0));
        uint256 lvrQuad   = vm.envOr("LVR_QUAD_PIPS_PER_TICK_SQ", uint256(0));
        bool    guard     = vm.envOr("GUARD_ENABLED", true);
        int24   maxMove   = int24(uint24(vm.envOr("MAX_TICK_MOVE_PER_BLOCK", uint256(60))));
        int24   maxDev    = int24(uint24(vm.envOr("MAX_DEVIATION_TICKS", uint256(6000))));
        uint32  catchup   = uint32(vm.envOr("MAX_CATCHUP_BLOCKS", uint256(10)));
        bool    initPool  = vm.envOr("INIT_POOL", true);

        (address c0, address c1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        bytes memory args = abi.encode(
            IPoolManager(poolMgr), baseFee, maxFee, slope, quad, feeStep,
            lvrSlope, lvrQuad, guard, maxMove, maxDev, catchup
        );
        // Flags 0xC0 == beforeSwap(bit 7) + afterSwap(bit 6), and nothing else (== MWFeeHook.HOOK_FLAGS).
        (address expectedHook, bytes32 salt) = HookMiner.find(
            C2_FACTORY, uint160(0xC0), type(MWFeeHook).creationCode, args
        );

        console.log("=== MWFeeHook Deploy (routable fee-only hook) ===");
        console.log("Chain:        ", block.chainid);
        console.log("Deployer:     ", deployer);
        console.log("Expected hook:", expectedHook);
        console.log("token0:       ", c0);
        console.log("token1:       ", c1);

        vm.startBroadcast(deployerKey);

        MWFeeHook hook = new MWFeeHook{salt: salt}(
            IPoolManager(poolMgr), baseFee, maxFee, slope, quad, feeStep,
            lvrSlope, lvrQuad, guard, maxMove, maxDev, catchup
        );
        require(address(hook) == expectedHook, "hook address mismatch");
        require(uint160(address(hook)) & 0x3FFF == 0xC0, "flags != 0xC0");
        console.log("Hook:         ", address(hook));

        if (initPool) {
            PoolKey memory key = PoolKey({
                currency0:   Currency.wrap(c0),
                currency1:   Currency.wrap(c1),
                fee:         LPFeeLibrary.DYNAMIC_FEE_FLAG, // ← required for the fee override to apply
                tickSpacing: tickSpacing,
                hooks:       IHooks(address(hook))
            });
            IPoolManager(poolMgr).initialize(key, initPrice);
            console.log("Dynamic-fee pool initialized (fee flag 0x800000).");
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deploy complete ===");
        console.log("Aggregators can route to this hook with no gatekeeper: fee-override only,");
        console.log("zero-delta, no hookData, immutable, address flags == 0xC0.");
    }
}
