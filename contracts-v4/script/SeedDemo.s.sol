// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}       from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}      from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}     from "@uniswap/v4-core/src/types/Currency.sol";

import {FeeVault}                from "../src/FeeVault.sol";
import {MWSocialHook}            from "../src/MWSocialHook.sol";
import {HookMiner}               from "../src/lib/HookMiner.sol";
import {MintwareDeFiVault4626}   from "../src/vaults/MintwareDeFiVault4626.sol";
import {VaultSurface, VaultConfig} from "../src/vaults/VaultTypes.sol";
import {MintwareSeedPool}        from "../src/MintwareSeedPool.sol";
import {MintwareSeedAdapter}     from "../src/MintwareSeedAdapter.sol";
import {MockERC20}               from "../test/mocks/MockERC20.sol";

/// @notice ONE-SHOT testnet demo. Deploys a self-contained stack (test tokens →
///         FeeVault → mined MWSocialHook → DeFi vault → SeedPool → per-vault adapter),
///         then runs a full fair-launch raise: openSeed → contribute → finalize → grow.
///         The deployer wallet plays every role (team + public). Logs every address.
///
///         Uses FRESH test tokens so no faucet is needed — the deployer only needs
///         Base Sepolia ETH for gas. This is a demo of the mechanics on a real V4
///         PoolManager, NOT a production deploy (see seed-deploy-runbook.md for that).
///
/// ─── Required env ────────────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY  — funded with Base Sepolia ETH (plays team + contributor)
///                           Expected wallet: 0x9c646C48a302f4725450669f1218d3FDb3e933AD
///   Optional: V4_POOL_MANAGER (defaults to Base Sepolia PoolManager)
///
/// ─── Run ─────────────────────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY=0x… pnpm forge:seed-demo:base-sepolia
contract SeedDemo is Script {
    address constant C2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant BASE_SEPOLIA_PM = 0x05e73354CfDd6745C338B50bcFDfA7e2c1b33b63;
    uint160 constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    bytes32 constant VAULT_ID = keccak256("seed-demo-vault");
    bytes32 constant SEED     = keccak256("seed-demo-1");

    uint256 constant RESERVE = 100_000e6; // tPROJ (6dp)
    uint256 constant TEAM_QUOTE = 4_000e6; // tUSDC
    uint256 constant PUBLIC_TARGET = 6_000e6;

    function run() external {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address me  = vm.addr(key);
        address poolMgr = vm.envOr("V4_POOL_MANAGER", BASE_SEPOLIA_PM);

        console.log("=== Mintware Seed Demo ===");
        console.log("Chain:      ", block.chainid);
        console.log("Deployer:   ", me);
        console.log("PoolManager:", poolMgr);

        // 1) Test tokens + FeeVault (broadcast)
        vm.startBroadcast(key);
        MockERC20 usdc = new MockERC20("Test USDC", "tUSDC", 6);
        MockERC20 proj = new MockERC20("Demo Project", "tPROJ", 6);
        usdc.mint(me, 20_000e6);
        proj.mint(me, RESERVE);
        FeeVault feeVault = new FeeVault(address(usdc), me, me, me);
        vm.stopBroadcast();

        // 2) Mine the hook salt (off-chain compute — C2 factory as CREATE2 origin)
        bytes memory hookArgs = abi.encode(
            IPoolManager(poolMgr), address(usdc), address(feeVault),
            me, address(0), address(0), me
        );
        (address expectedHook, bytes32 hookSalt) =
            HookMiner.find(C2_FACTORY, uint160(0x0AC4), type(MWSocialHook).creationCode, hookArgs);

        // 3) Vault + hook + wiring + seed stack + full raise (broadcast)
        vm.startBroadcast(key);
        MintwareDeFiVault4626 vault = new MintwareDeFiVault4626(_cfg(address(usdc), me), poolMgr, address(feeVault));
        MWSocialHook hook = new MWSocialHook{salt: hookSalt}(
            IPoolManager(poolMgr), address(usdc), address(feeVault),
            me, address(0), address(0), me
        );
        require(address(hook) == expectedHook, "hook addr mismatch");
        hook.setSocialVault(address(vault));
        feeVault.setSocialVault(address(vault));
        feeVault.setHook(address(hook));

        bool u0 = address(usdc) < address(proj);
        PoolKey memory poolKey = PoolKey({
            currency0:   Currency.wrap(u0 ? address(usdc) : address(proj)),
            currency1:   Currency.wrap(u0 ? address(proj) : address(usdc)),
            fee:         3000,
            tickSpacing: 60,
            hooks:       IHooks(address(hook))
        });

        MintwareSeedPool seedPool = new MintwareSeedPool();
        MintwareSeedAdapter adapter =
            new MintwareSeedAdapter(address(vault), address(seedPool), VAULT_ID, poolKey, -60000, 60000);
        vault.transferOwnership(address(adapter)); // adapter drives owner-only seed/rebalance

        // openSeed (deployer = team)
        proj.approve(address(seedPool), RESERVE);
        usdc.approve(address(seedPool), TEAM_QUOTE);
        seedPool.openSeed(SEED, MintwareSeedPool.OpenParams({
            projectToken: address(proj), quoteToken: address(usdc), target: address(adapter),
            tokenReserve: RESERVE, teamQuote: TEAM_QUOTE, publicQuoteTarget: PUBLIC_TARGET,
            deployThresholdBps: 5_000, raiseDeadline: uint64(block.timestamp + 14 days),
            sqrtPriceX96: INIT_SQRT_PRICE, poolInit: VAULT_ID, fullReserveOnFinalize: true
        }));

        // contribute to threshold, finalize, then fill + grow (deployer = public)
        usdc.approve(address(seedPool), 6_000e6);
        seedPool.contributeQuote(SEED, 1_000e6); // raised 5_000e6 == threshold
        seedPool.finalizeSeed(SEED);             // pool live
        seedPool.contributeQuote(SEED, 5_000e6); // fill to target
        seedPool.growLiquidity(SEED);            // grown
        vm.stopBroadcast();

        // 4) Report
        (MintwareSeedPool.Phase phase, uint256 raised, , uint256 dTok, uint256 dQuote) = seedPool.getState(SEED);
        console.log("");
        console.log("=== Deployed ===");
        console.log("tUSDC:       ", address(usdc));
        console.log("tPROJ:       ", address(proj));
        console.log("FeeVault:    ", address(feeVault));
        console.log("MWSocialHook:", address(hook));
        console.log("DeFiVault:   ", address(vault));
        console.log("SeedPool:    ", address(seedPool));
        console.log("SeedAdapter: ", address(adapter));
        console.log("VAULT_ID:"); console.logBytes32(VAULT_ID);
        console.log("SEED id:");  console.logBytes32(SEED);
        console.log("");
        console.log("=== Raise result ===");
        console.log("phase (0=None,1=Seeding,2=Live,3=Grown):", uint256(phase));
        console.log("quoteRaised:      ", raised);
        console.log("deployedToken:    ", dTok);
        console.log("deployedQuote:    ", dQuote);
        console.log("adapter shares:   ", adapter.totalShares());
        console.log("vault liquidity:  ", vault.totalLiquidity());
        console.log("vault principal:  ", vault.totalPrincipal());
    }

    function _cfg(address usdc, address provider) internal pure returns (VaultConfig memory) {
        return VaultConfig({
            surface:             VaultSurface.DeFi,
            provider:            provider,
            underlyingToken:     usdc,
            treasury:            provider,
            name:                "Seed Demo Vault Share",
            symbol:              "mwDEMO",
            minDeposit:          0,
            entryFeeBps:         0,
            exitFeeBps:          0,
            enableMEVProtection: true,
            enableIdleCapital:   false,
            idleTargetRatio:     0
        });
    }
}
