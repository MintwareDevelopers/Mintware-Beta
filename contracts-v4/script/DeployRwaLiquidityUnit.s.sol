// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console}  from "forge-std/Script.sol";
import {IPoolManager}     from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}           from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}          from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}         from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary}     from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath}         from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20}           from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HookMiner}                     from "../src/lib/HookMiner.sol";
import {MintwareTreasuryVault}         from "../src/payments/MintwareTreasuryVault.sol";
import {MintwareRwaAppraisalHook}      from "../src/rwa/MintwareRwaAppraisalHook.sol";
import {IRwaIdentityRegistry}          from "../src/rwa/interfaces/IRwaIdentityRegistry.sol";
import {MockRwaIdentityRegistry}       from "../src/rwa/testnet/MockRwaIdentityRegistry.sol";
import {MockPermissionedPropertyToken} from "../src/rwa/testnet/MockPermissionedPropertyToken.sol";
import {DemoUSD}                       from "../src/rwa/testnet/DemoUSD.sol";
import {DemoLendingAdapter}            from "../src/rwa/testnet/DemoLendingAdapter.sol";
import {DemoSwapRouter}                from "../src/rwa/testnet/DemoSwapRouter.sol";

/// @notice V2-RWAs — deploy ONE demo RWA liquidity unit on a testnet (Base Sepolia by default) and open it:
///         registry + permissioned property token + demo USD + simulated lending adapter + appraisal hook
///         (CREATE2-mined) + the UNCHANGED `MintwareTreasuryVault` + a demo router, all wired; appraisal
///         posted; pool initialised AT the appraisal; the issuer's junior committed. Senior LP deposits, the
///         pool deploy and every trade are done afterwards by `scripts/rwa-demo-lifecycle.mjs`, which records
///         the proof hashes.
///
///         TESTNET ONLY. The deployer plays issuer, keeper and guardian for the demo; the property is
///         fictional and every token is valueless.
///
/// Env: DEPLOYER_PRIVATE_KEY (0x-prefixed). Optional: V4_POOL_MANAGER (Base Sepolia default),
///      APPRAISAL_TICK_ABS (230270 ≈ $100 per 18-dp unit in 6-dp dUSD), PROPERTY_NAME, PROPERTY_SYMBOL,
///      JUNIOR_TOKENS (5000e18), JUNIOR_USD (500e6), LEND_APR_BPS (450).
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
        DemoLendingAdapter            adapter;
        MintwareRwaAppraisalHook      hook;
        MintwareTreasuryVault         vault;
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
        uint256 juniorTokens = vm.envOr("JUNIOR_TOKENS", uint256(5_000e18));
        uint256 juniorUsd    = vm.envOr("JUNIOR_USD", uint256(500e6));
        uint256 aprBps       = vm.envOr("LEND_APR_BPS", uint256(450));

        vm.startBroadcast(pk);

        d.usd      = new DemoUSD(deployer);
        d.registry = new MockRwaIdentityRegistry(deployer);
        d.property = new MockPermissionedPropertyToken(name, symbol, 18, IRwaIdentityRegistry(address(d.registry)), deployer);
        d.adapter  = new DemoLendingAdapter(d.usd, aprBps, deployer);
        d.usd.setMinter(address(d.adapter), true);

        // Hook: CREATE2-mined so its address carries the permission bits.
        bytes memory hookArgs = abi.encode(pm, deployer, deployer, deployer, demoConfig());
        (address hookAddr, bytes32 salt) =
            HookMiner.find(C2_FACTORY, HOOK_FLAGS, type(MintwareRwaAppraisalHook).creationCode, hookArgs);
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

        // The UNCHANGED treasury vault: senior = dUSD LPs, junior = the issuer's property inventory.
        d.vault  = new MintwareTreasuryVault(address(pm), d.key, address(d.usd), address(d.adapter), deployer, deployer);
        d.router = new DemoSwapRouter(pm);

        d.adapter.setVault(address(d.vault));
        d.vault.setProtocolTreasury(deployer);
        d.vault.setJitHook(hookAddr); // the appraisal hook is the vault's oracle
        d.vault.setMinCoverage(100);  // 1% junior-USD first-loss cushion over deployed senior
        d.hook.setVault(address(d.vault));

        // Enroll Mintware's contracts as permitted holders of the property token (the issuer's one-time act).
        d.property.setPermittedHolder(address(pm), true);
        d.property.setPermittedHolder(address(d.vault), true);
        d.property.setPermittedHolder(address(d.router), true);

        // Appraisal first, then open the pool exactly at it.
        d.hook.initAppraisal(d.appraisal);
        pm.initialize(d.key, TickMath.getSqrtPriceAtTick(d.appraisal));

        // Issuer commits the junior: property inventory + a dUSD first-loss buffer, 1-year lock.
        d.property.mint(deployer, juniorTokens);
        d.usd.mint(deployer, juniorUsd);
        IERC20(address(d.property)).approve(address(d.vault), juniorTokens);
        IERC20(address(d.usd)).approve(address(d.vault), juniorUsd);
        d.vault.commitTeam(juniorTokens, juniorUsd, 365 days);

        vm.stopBroadcast();

        console.log("=== V2-RWAs demo liquidity unit ===");
        console.log("chainId         ", block.chainid);
        console.log("deployer/issuer ", deployer);
        console.log("DemoUSD         ", address(d.usd));
        console.log("IdentityRegistry", address(d.registry));
        console.log("PropertyToken   ", address(d.property));
        console.log("LendingAdapter  ", address(d.adapter));
        console.log("AppraisalHook   ", address(d.hook));
        console.log("TreasuryVault   ", address(d.vault));
        console.log("DemoSwapRouter  ", address(d.router));
        console.log("propertyIsCurrency0", propIs0);
        console.logInt(d.appraisal);
    }
}
