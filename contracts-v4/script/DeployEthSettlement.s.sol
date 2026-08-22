// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console}       from "forge-std/Script.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {MintwareEthSettlement} from "../src/payments/MintwareEthSettlement.sol";
import {MockERC20}             from "../test/mocks/MockERC20.sol";

/// @notice Deploy `MintwareEthSettlement` to Base Sepolia, wired to the LIVE V4 PoolManager and a
///         {WETH, USDC} pool. Reuses the mock WETH the deployed ETH-collateral vault already holds
///         (0x0228…ccCA) so the settlement contract can later be funded from that vault; a fresh mock USDC
///         (6dp) completes the pair. Initializes the pool at tick 0 so it's a real on-chain pool.
///
///   Run:  forge script contracts-v4/script/DeployEthSettlement.s.sol --rpc-url base_sepolia --broadcast --slow
contract DeployEthSettlement is Script {
    /// Live Base Sepolia V4 PoolManager (per testnet_deploy_env).
    address constant POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    /// Mock WETH (18dp) the deployed ETH-collateral vault holds.
    address constant WETH = 0x022809602CCa80BD898Bcaa1C853940ca722ccCA;
    uint160 constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // AUDIT H4 wiring: `batchSettleEth` reverts `RailNotSet` until the sole settlement destination is
        // pinned, so the deploy MUST call `setSettlementRail(...)` or the contract ships unusable. The rail
        // is the address that RECEIVES the settled USDC (the Gateway / CPN settlement address). It is not
        // deployed by THIS script, so it's read from `SETTLEMENT_RAIL`; the fallback is the deployer itself
        // — a safe testnet default (settlement pays back to the operator's own EOA for a soak), and it keeps
        // the deployer-as-owner/relayer pattern this script already uses. Point it at the real Gateway/CPN
        // address for anything beyond a local soak.
        address settlementRail = vm.envOr("SETTLEMENT_RAIL", deployer);
        // AUDIT H4 (optional, defense in depth): per-call `totalUsdc` ceiling. 0 = off (default).
        uint256 maxSettlePerCall = vm.envOr("SETTLE_MAX_PER_CALL", uint256(0));

        vm.startBroadcast(deployerKey);
        MockERC20 usdc = new MockERC20("USD Coin (mock)", "USDC", 6);

        (Currency c0, Currency c1) = WETH < address(usdc)
            ? (Currency.wrap(WETH), Currency.wrap(address(usdc)))
            : (Currency.wrap(address(usdc)), Currency.wrap(WETH));
        PoolKey memory key =
            PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
        IPoolManager(POOL_MANAGER).initialize(key, INIT_SQRT_PRICE);

        // relayer = deployer for the testnet contract (rotate for a real relayer). requireReadyOracle stays
        // TRUE by default — real settlements revert until an oracle hook is wired (a full soak's job).
        MintwareEthSettlement settlement =
            new MintwareEthSettlement(IPoolManager(POOL_MANAGER), key, address(usdc), WETH, deployer, deployer);

        // Pin the settlement rail (deployer is owner → this onlyOwner call succeeds). Without it, every
        // `batchSettleEth` reverts `RailNotSet`; the passed `rail` at settle time must equal this address.
        settlement.setSettlementRail(settlementRail);
        // Optional per-call cap (skip when 0 = off, the contract default).
        if (maxSettlePerCall != 0) settlement.setMaxSettlePerCall(maxSettlePerCall);
        vm.stopBroadcast();

        console.log("=== MintwareEthSettlement deployed (Base Sepolia) ===");
        console.log("deployer:      ", deployer);
        console.log("PoolManager:   ", POOL_MANAGER);
        console.log("WETH (18dp):   ", WETH);
        console.log("USDC (mock,6dp):", address(usdc));
        console.log("Settlement:    ", address(settlement));
        console.log("relayer:       ", deployer);
        console.log("settlementRail:", settlementRail);
        console.log("maxSettlePerCall (0=off):", maxSettlePerCall);
        console.log("");
        console.log("Gated dry-run (proves calldata dispatches on-chain):");
        console.log("  RELAYER_RPC_URL=<base-sepolia> SETTLEMENT_ADDRESS=", address(settlement));
        console.log("  cargo test --test live_settlement  (expects OnlyRelayer())");
    }
}
