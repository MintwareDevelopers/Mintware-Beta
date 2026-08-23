// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console}                 from "forge-std/Script.sol";
import {IPoolManager}                    from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                          from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}                         from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}                        from "@uniswap/v4-core/src/types/Currency.sol";
import {MintwareTreasuryFloatSettlement} from "../src/payments/MintwareTreasuryFloatSettlement.sol";
import {MockERC20}                       from "../test/mocks/MockERC20.sol";
import {MockLidoRate}                    from "../test/mocks/MockLidoRate.sol";

/// @notice Establish the deploy path for `MintwareTreasuryFloatSettlement` — the GO-FORWARD YPN settlement
///         that decouples card spend from collateral liquidation (supersedes `MintwareEthSettlement`, whose
///         swap-on-settle path is the emergency valve here). Modeled on `DeployEthSettlement.s.sol` (single
///         contract + a real V4 pool) and `DeployEthSeniorStackDemo.s.sol` (env-with-mock-fallback wiring).
///
///         The FloatSettlement constructor needs THREE tokens (wstETH 18dp / WETH 18dp / USDC ≤18dp) and TWO
///         canonical pools — the wstETH/ETH "stake" pool and the ETH/USDC "eth" pool — plus owner/relayer/keeper
///         roles. This script sources each from an env var and falls back to a freshly-deployed mock for a
///         self-contained testnet stand-up.
///
/// ⚠ AUDIT + REAL-DEEP-POOL GATED — THIS SCRIPT IS THE DEPLOY PATH, NOT A PRODUCTION-READY DEPLOY.
///   For any real (non-testnet) use, the settlement's async replenish / emergency-swap legs route through the
///   DEEP wstETH/ETH + ETH/USDC pools and are bounded against real references: a live Lido wstETH-rate source
///   (`stEthPerToken()`) on the wstETH/ETH leg and a ready truncated-oracle source on the ETH/USDC leg. Those
///   pools and reference contracts (Lido, the pools' oracle hook, and any real yield adapters) MUST already
///   exist and be funded. This script's mock tokens have no value, its mock Lido rate is pinned 1:1, and — on
///   testnet — it relaxes the fail-closed require-ready-oracle gate because a mock rig has no ETH/USDC oracle
///   hook to supply a truncated tick. It stands up the contract + wiring so the deploy path is real; it does
///   NOT mean the result is production-ready. External audit + real deep pools + real references gate real use.
///   Do NOT put real value on a mock deployment of this stack.
///
///   Env overrides (all optional — each falls back to a deployed mock / the deployer):
///     WSTETH_ADDRESS · WETH_ADDRESS · USDC_ADDRESS   (real token addresses; else mocks 18/18/6 dp)
///     SETTLEMENT_OWNER · SETTLEMENT_RELAYER · SETTLEMENT_KEEPER  (roles; else the deployer)
///     SETTLEMENT_RAIL                (USDC recipient / Gateway-CPN address; else the deployer)
///     ORACLE_SOURCE                  (ETH/USDC truncated-oracle source; if set, wired + gate stays fail-closed)
///     LIDO_RATE_SOURCE               (Lido wstETH-rate source; else a pinned-1:1 MockLidoRate on testnet)
///     STAKE_POOL_FEE / STAKE_POOL_SPACING · ETH_POOL_FEE / ETH_POOL_SPACING  (pool keys; else 3000 / 60)
///     INIT_POOLS                     (true on testnet to initialize the mock pools; set FALSE when the real
///                                     deep pools already exist on-chain — initializing an existing pool reverts)
///     SETTLE_MAX_PER_CALL            (optional per-call USDC ceiling; 0 = off, the default)
///
///   Run (testnet, self-contained mocks):
///     forge script contracts-v4/script/DeployFloatSettlement.s.sol --rpc-url base_sepolia --broadcast --slow -vvvv
contract DeployFloatSettlement is Script {
    /// Live Base Sepolia V4 PoolManager (matches config/treasury.ts + testnet_deploy_env; same as the sibling scripts).
    address constant POOL_MANAGER    = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    uint160 constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0 (coarse mock placeholder)

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        address owner   = vm.envOr("SETTLEMENT_OWNER",   deployer);
        address relayer = vm.envOr("SETTLEMENT_RELAYER", deployer);
        address keeper  = vm.envOr("SETTLEMENT_KEEPER",  deployer);
        address rail    = vm.envOr("SETTLEMENT_RAIL",    deployer);

        // Optional real references; ETH/USDC leg falls back to relaxing the fail-closed gate on testnet.
        address oracleSrc = vm.envOr("ORACLE_SOURCE",    address(0));
        address lidoSrc   = vm.envOr("LIDO_RATE_SOURCE", address(0));

        // Pool key params (defaults suit the mock demo; override for the real deep pools).
        uint24 stakeFee     = uint24(vm.envOr("STAKE_POOL_FEE",     uint256(3000)));
        int24  stakeSpacing = int24(int256(vm.envOr("STAKE_POOL_SPACING", uint256(60))));
        uint24 ethFee       = uint24(vm.envOr("ETH_POOL_FEE",       uint256(3000)));
        int24  ethSpacing   = int24(int256(vm.envOr("ETH_POOL_SPACING",   uint256(60))));

        bool    initPools       = vm.envOr("INIT_POOLS",         true);
        uint256 maxSettlePerCall = vm.envOr("SETTLE_MAX_PER_CALL", uint256(0));

        console.log("=== MintwareTreasuryFloatSettlement deploy (go-forward YPN settlement) ===");
        console.log("Chain:       ", block.chainid);
        console.log("Deployer:    ", deployer);
        console.log("PoolManager: ", POOL_MANAGER);

        vm.startBroadcast(deployerKey);

        // 1. Tokens: real addresses from env, else self-contained mocks (wstETH 18dp / WETH 18dp / USDC 6dp).
        //    The ctor verifies wstETH/WETH == 18dp and USDC <= 18dp, so mocks match those constraints.
        address wstEth = vm.envOr("WSTETH_ADDRESS", address(0));
        address weth   = vm.envOr("WETH_ADDRESS",   address(0));
        address usdc   = vm.envOr("USDC_ADDRESS",   address(0));
        if (wstEth == address(0)) wstEth = address(new MockERC20("Wrapped stETH (mock)", "mwstETH", 18));
        if (weth   == address(0)) weth   = address(new MockERC20("Wrapped Ether (mock)", "mWETH",   18));
        if (usdc   == address(0)) usdc   = address(new MockERC20("USD Coin (mock)",      "mUSDC",   6));

        // 2. Canonical pool keys, currencies sorted (V4 requires currency0 < currency1). Hookless in the mock
        //    rig; a real deploy points at the deep pools (which carry their own oracle hook on the ETH/USDC leg).
        PoolKey memory stakeKey = _poolKey(wstEth, weth, stakeFee, stakeSpacing);
        PoolKey memory ethKey   = _poolKey(weth,   usdc, ethFee,   ethSpacing);

        // Initialize the mock pools so they are real on-chain pools. Skip for real deep pools (already live —
        // re-initializing reverts). The ctor independently verifies each key's currency pair, not its existence.
        if (initPools) {
            IPoolManager(POOL_MANAGER).initialize(stakeKey, INIT_SQRT_PRICE);
            IPoolManager(POOL_MANAGER).initialize(ethKey,   INIT_SQRT_PRICE);
        }

        // 3. Deploy the settlement (9 ctor args: pm, stakeKey, ethKey, wstEth, weth, usdc, owner, relayer, keeper).
        MintwareTreasuryFloatSettlement settlement = new MintwareTreasuryFloatSettlement(
            IPoolManager(POOL_MANAGER), stakeKey, ethKey, wstEth, weth, usdc, owner, relayer, keeper
        );
        console.log("FloatSettlement: ", address(settlement));

        // 4. Wire references + rail — ALL of this is pre-rail, so risk-param sources set instantly and are then
        //    FROZEN once the rail is pinned (`_riskParamsLive()` flips true). Order: gate/sources FIRST, rail LAST.
        //    NOTE: owner-gated setters only succeed when owner == deployer (the default). With a distinct
        //    SETTLEMENT_OWNER, run this wiring separately from that owner after deploy.
        if (owner == deployer) {
            // ETH/USDC leg: wire a real truncated-oracle source when supplied (gate stays fail-closed); else, on
            // the mock rig (no oracle hook), relax the require-ready-oracle gate so the emergency swap can quote.
            if (oracleSrc != address(0)) {
                settlement.setOracleSource(oracleSrc);
            } else {
                settlement.setRequireReadyOracle(false); // TESTNET ONLY — a mock rig has no ETH/USDC oracle hook.
            }

            // wstETH/ETH leg: wire the Lido wstETH-rate reference (real source from env, else a pinned-1:1 mock).
            if (lidoSrc == address(0)) lidoSrc = address(new MockLidoRate(1e18));
            settlement.setLidoRateSource(lidoSrc);

            // AUDIT H4: pin the sole settlement destination (goes live; flips the risk-param timelock on).
            settlement.setSettlementRail(rail);

            // Optional per-call cap (skip when 0 = off, the contract default).
            if (maxSettlePerCall != 0) settlement.setMaxSettlePerCall(maxSettlePerCall);
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployed (settlement) - TESTNET + MOCK + UNAUDITED unless real env addresses supplied ===");
        console.log("wstETH (18dp):   ", wstEth);
        console.log("WETH (18dp):     ", weth);
        console.log("USDC:            ", usdc);
        console.log("owner:           ", owner);
        console.log("relayer:         ", relayer);
        console.log("keeper:          ", keeper);
        console.log("settlementRail:  ", rail);
        console.log("lidoRateSource:  ", lidoSrc);
        console.log("oracleSource:    ", oracleSrc);
        console.log("initPools:       ", initPools);
        console.log("maxSettlePerCall (0=off):", maxSettlePerCall);
        if (owner != deployer) {
            console.log("");
            console.log("NOTE: SETTLEMENT_OWNER != deployer -> reference/rail wiring was SKIPPED.");
            console.log("      Complete it from the owner: setLidoRateSource / (setOracleSource|setRequireReadyOracle) / setSettlementRail.");
        }
        console.log("");
        console.log("Real use gates: DEEP wstETH/ETH + ETH/USDC pools, a live Lido rate + ready ETH/USDC oracle,");
        console.log("real yield adapters, and an external audit. This script establishes the deploy path only.");
    }

    /// @dev Build a hookless V4 pool key with currencies sorted (currency0 < currency1).
    function _poolKey(address a, address b, uint24 fee, int24 spacing) internal pure returns (PoolKey memory) {
        (Currency c0, Currency c1) = a < b
            ? (Currency.wrap(a), Currency.wrap(b))
            : (Currency.wrap(b), Currency.wrap(a));
        return PoolKey({currency0: c0, currency1: c1, fee: fee, tickSpacing: spacing, hooks: IHooks(address(0))});
    }
}
