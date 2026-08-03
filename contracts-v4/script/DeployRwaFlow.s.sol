// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager}   from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}         from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}        from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}       from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary}   from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

import {IERC20}            from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HookMiner}            from "../src/lib/HookMiner.sol";
import {MintwareVRWA}         from "../src/rwa/MintwareVRWA.sol";
import {MintwareRWAVault4626} from "../src/rwa/MintwareRWAVault4626.sol";
import {MintwareOracleHook}   from "../src/rwa/MintwareOracleHook.sol";
import {SPVBeneficiaryRegistry} from "../src/rwa/SPVBeneficiaryRegistry.sol";
import {FeeVault}             from "../src/FeeVault.sol";
import {VaultSurface, VaultConfig} from "../src/vaults/VaultTypes.sol";

/// @notice Turnkey deploy of ONE connected RWA deal: mints a real vRWA, deploys the
///         RWA vault, wires a CREATE2-mined MintwareOracleHook to THAT vault, and lists
///         + seeds the oracle-banded vRWA/USDC pool. Unlike the two prior demos (which
///         used disjoint tokens), this produces a single stack where deposit→vRWA→pool→swap
///         all share one token — the flow proven in MintwareRWAFlow.t.sol.
///
///         After running, feed the logged addresses to POST /api/admin/vaults/rwa/[id]/list
///         to record them on the deal and seed a `router_pools` row (hands the pair to the
///         MW meta-router). See docs/developers/phase3-router-design.md + rwa docs.
///
/// ─── Required env ────────────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY  — funded with gas; plays owner/issuer/keeper + seeds USDC
///   POOL_MANAGER          — Uniswap V4 PoolManager on the target chain
///   USDC                  — underlying asset (real testnet USDC or a mock you control)
/// ─── Optional env ────────────────────────────────────────────────────────────
///   TREASURY (default: deployer) · USDC_SEED (default 50000e6) · VRWA_SEED (default 50000e6)
contract DeployRwaFlow is Script {
    using PoolIdLibrary for PoolKey;

    address constant C2_FACTORY  = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint160 constant HOOK_FLAGS  = 0xA80;
    uint160 constant SQRT_1_0    = 79228162514264337593543950336; // price 1.0 @ tick 0
    uint16  constant CORE_BPS    = 1500; // ±15%
    uint16  constant SPEC_BPS    = 4500; // ±45%

    function run() external {
        uint256 pk      = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address me      = vm.addr(pk);
        address pmAddr  = vm.envAddress("POOL_MANAGER");
        address usdc    = vm.envAddress("USDC");
        address treasury = vm.envOr("TREASURY", me);
        uint256 usdcSeed = vm.envOr("USDC_SEED", uint256(50_000e6));
        uint256 vrwaSeed = vm.envOr("VRWA_SEED", uint256(50_000e6));

        vm.startBroadcast(pk);

        // 1) vRWA (6dp, matches USDC so the appraisal sits at tick 0), registry, feeVault.
        MintwareVRWA vrwa = new MintwareVRWA("Mintware vRWA", "vRWA", 6, me);
        SPVBeneficiaryRegistry registry = new SPVBeneficiaryRegistry(me);
        FeeVault feeVault = new FeeVault(usdc, me, me, treasury);

        // 2) RWA vault.
        VaultConfig memory cfg = VaultConfig({
            surface:             VaultSurface.RWA,
            provider:            me,
            underlyingToken:     usdc,
            treasury:            treasury,
            name:                "MW RWA Vault Share",
            symbol:              "mwRWA",
            minDeposit:          0,
            entryFeeBps:         0,
            exitFeeBps:          0,
            enableMEVProtection: false,
            enableIdleCapital:   false,
            idleTargetRatio:     0
        });
        MintwareRWAVault4626 vault =
            new MintwareRWAVault4626(cfg, pmAddr, address(feeVault), address(vrwa), address(registry), me);
        vrwa.setMinter(address(vault));

        // 3) Mine + deploy the oracle hook wired to THIS vault (it gates LP to `vault`).
        bytes memory ctorArgs = abi.encode(IPoolManager(pmAddr), address(vault), me, me);
        (address hookAddr, bytes32 salt) =
            HookMiner.find(C2_FACTORY, HOOK_FLAGS, type(MintwareOracleHook).creationCode, ctorArgs);
        MintwareOracleHook hook =
            new MintwareOracleHook{salt: salt}(IPoolManager(pmAddr), address(vault), me, me);
        require(address(hook) == hookAddr, "hook address mismatch");

        // 4) Build the vRWA/USDC dynamic-fee PoolKey; configure bands + appraisal (1:1).
        bool usdcIsToken0 = usdc < address(vrwa);
        PoolKey memory poolKey = PoolKey({
            currency0:   Currency.wrap(usdcIsToken0 ? usdc : address(vrwa)),
            currency1:   Currency.wrap(usdcIsToken0 ? address(vrwa) : usdc),
            fee:         LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks:       IHooks(address(hook))
        });
        PoolId id = poolKey.toId();
        hook.configurePool(id, CORE_BPS, SPEC_BPS);
        hook.setAppraisal(id, hook.priceX96FromSqrt(SQRT_1_0));

        // 5) List + seed: approve the vault to pull seed USDC, then list (mints vRWA
        //    inventory + adds two-sided liquidity, gated to the vault by the hook).
        IERC20(usdc).approve(address(vault), usdcSeed);
        vault.listAndSeedPool(poolKey, SQRT_1_0, -6000, 6000, usdcSeed, vrwaSeed);

        vm.stopBroadcast();

        console2.log("=== Mintware RWA flow deployed (connected stack) ===");
        console2.log("chainId:      ", block.chainid);
        console2.log("vault:        ", address(vault));
        console2.log("vRWA:         ", address(vrwa));
        console2.log("oracleHook:   ", address(hook));
        console2.log("feeVault:     ", address(feeVault));
        console2.log("registry:     ", address(registry));
        console2.log("--- router_pools row ---");
        console2.log("currency0:    ", Currency.unwrap(poolKey.currency0));
        console2.log("currency1:    ", Currency.unwrap(poolKey.currency1));
        console2.log("fee (dynamic):", uint256(poolKey.fee));
        console2.log("tickSpacing:  ", uint256(uint24(poolKey.tickSpacing)));
        console2.log("=> vRWA pool live; POST these to /api/admin/vaults/rwa/[id]/list");
    }
}
