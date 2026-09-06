// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IYieldAdapter} from "../src/vaults/IYieldAdapter.sol";
import {MintwareLpGatewayStaging} from "../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../src/gateway/MintwareLpGatewayPositionManager.sol";

/// @notice Deploy the LP gateway (staging reserve + position manager) against an EXISTING third-party
///         Uniswap V4 pool. Fully env-driven — NO address or chain id is hardcoded here. The V4
///         PoolManager/PositionManager/Permit2 must be the canonical verified addresses for the target
///         chain (verify bytecode before pointing mainnet at them). The yield adapter is a
///         MintwareERC4626YieldAdapter wrapping the pool-chain's Morpho USDG vault (deploy separately).
///
///         Run (Robinhood Chain testnet first):
///           forge script contracts-v4/script/DeployLpGateway.s.sol --rpc-url $RPC --broadcast
contract DeployLpGateway is Script {
    function run() external {
        IERC20 quoteAsset = IERC20(vm.envAddress("LP_QUOTE_ASSET")); // USDG on Robinhood Chain
        IYieldAdapter adapter = IYieldAdapter(vm.envAddress("LP_YIELD_ADAPTER")); // ERC4626 adapter → Morpho

        IPoolManager poolManager = IPoolManager(vm.envAddress("LP_POOL_MANAGER"));
        IPositionManager positionManager = IPositionManager(vm.envAddress("LP_POSITION_MANAGER"));
        IPermit2Minimal permit2 = IPermit2Minimal(vm.envAddress("LP_PERMIT2"));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(vm.envAddress("LP_POOL_CURRENCY0")),
            currency1: Currency.wrap(vm.envAddress("LP_POOL_CURRENCY1")),
            fee: uint24(vm.envUint("LP_POOL_FEE")),
            tickSpacing: int24(vm.envInt("LP_POOL_TICK_SPACING")),
            hooks: IHooks(vm.envAddress("LP_POOL_HOOKS")) // address(0) for a hookless pool
        });

        int24 tickLower = int24(vm.envInt("LP_TICK_LOWER"));
        int24 tickUpper = int24(vm.envInt("LP_TICK_UPPER"));
        address owner = vm.envAddress("LP_OWNER"); // getOracleSigner('root') seat — cron owner
        address harvestRecipient = vm.envAddress("LP_HARVEST_RECIPIENT");

        vm.startBroadcast();

        MintwareLpGatewayStaging staging = new MintwareLpGatewayStaging(quoteAsset, adapter);
        MintwareLpGatewayPositionManager pm = new MintwareLpGatewayPositionManager(
            poolManager, positionManager, permit2, key, quoteAsset, tickLower, tickUpper, staging, owner, harvestRecipient
        );
        staging.setController(address(pm));

        vm.stopBroadcast();

        console2.log("MintwareLpGatewayStaging       ", address(staging));
        console2.log("MintwareLpGatewayPositionManager", address(pm));
        console2.log("set LP_GATEWAY_STAGING / LP_GATEWAY_POSITION_MANAGER to the above in Vercel env");
    }
}
