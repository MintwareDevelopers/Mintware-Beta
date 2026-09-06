// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {MintwareLpGatewayStaging} from "../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockYieldAdapter} from "../test/mocks/MockYieldAdapter.sol";

/// @notice Stand up the FULL LP-gateway rig on Robinhood Chain TESTNET (46630), against the real,
///         bytecode-verified V4 PoolManager/PositionManager + canonical Permit2. Robinhood testnet has
///         V4 + a gas faucet, but no USDG / Morpho vault / meme pool — so this deploys a mock USDG + a
///         mock paired token + a mock yield adapter, initializes a fresh V4 pool, and wires the gateway
///         to them. Everything downstream (deposit → deploy → harvest) then runs against a real pool.
///
///         V4 addresses default to the VERIFIED testnet canonical set (overridable via env). Run with a
///         faucet-funded key:
///           forge script contracts-v4/script/SetupLpGatewayTestnet.s.sol \
///             --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast
contract SetupLpGatewayTestnet is Script {
    // Verified on-chain (eth_getCode diff vs Base canonical); same addresses on testnet + mainnet.
    address constant V4_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant V4_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function run() external {
        IPoolManager poolManager = IPoolManager(vm.envOr("LP_POOL_MANAGER", V4_POOL_MANAGER));
        IPositionManager positionManager = IPositionManager(vm.envOr("LP_POSITION_MANAGER", V4_POSITION_MANAGER));
        IPermit2Minimal permit2 = IPermit2Minimal(vm.envOr("LP_PERMIT2", PERMIT2));
        // IL control: WIDE default range for a volatile meme pool — ±22980 ticks ≈ a 10x-up / −90%-down
        // price swing before the position falls out of range. Much lower IL + no out-of-range cliff + no
        // rebalancing vs a tight range. Aligned to tickSpacing 60. Env-override for full-range (±887220,
        // the lowest-IL / least-fee-efficient extreme) or a tighter, higher-fee band.
        int24 tickLower = int24(vm.envOr("LP_TICK_LOWER", int256(-22980)));
        int24 tickUpper = int24(vm.envOr("LP_TICK_UPPER", int256(22980)));

        vm.startBroadcast();
        address deployer = msg.sender;

        // 1) mock quote (USDG, 6dp) + paired (PONS, 18dp) + a mock USDG yield adapter for staging.
        MockERC20 usdg = new MockERC20("Test USD Global", "tUSDG", 6);
        MockERC20 pons = new MockERC20("Test Pons", "tPONS", 18);
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdg));

        // 2) ordered PoolKey (hookless, 0.30% / tickSpacing 60) + initialize the pool at price 1.0.
        (address c0, address c1) =
            address(usdg) < address(pons) ? (address(usdg), address(pons)) : (address(pons), address(usdg));
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(0));

        // 3) the gateway (owner + harvestRecipient = deployer for the testnet run).
        MintwareLpGatewayStaging staging = new MintwareLpGatewayStaging(IERC20(address(usdg)), adapter);
        MintwareLpGatewayPositionManager pm = new MintwareLpGatewayPositionManager(
            poolManager, positionManager, permit2, key, IERC20(address(usdg)), tickLower, tickUpper, staging, deployer, deployer
        );
        staging.setController(address(pm));

        // 4) fund the deployer to exercise the loop (deposit + a manual deploy paired leg).
        usdg.mint(deployer, 1_000_000e6);
        pons.mint(deployer, 1_000_000e18);

        vm.stopBroadcast();

        console2.log("== Robinhood testnet LP-gateway rig ==");
        console2.log("tUSDG (quote)      ", address(usdg));
        console2.log("tPONS (paired)     ", address(pons));
        console2.log("MockYieldAdapter   ", address(adapter));
        console2.log("Staging            ", address(staging));
        console2.log("PositionManager    ", address(pm));
        console2.log("pool currency0     ", c0);
        console2.log("pool currency1     ", c1);
        console2.log("-- set on Vercel --");
        console2.log("LP_GATEWAY_POSITION_MANAGER =", address(pm));
        console2.log("LP_GATEWAY_STAGING =", address(staging));
        console2.log("LP_GATEWAY_POOL_ADDRESS = (use the poolId or a label; the config keys by it)");
        console2.log("LP_GATEWAY_CHAIN_ID = 46630");
    }
}
