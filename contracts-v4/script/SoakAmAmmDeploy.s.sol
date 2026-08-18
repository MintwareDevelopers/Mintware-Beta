// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console}          from "forge-std/Script.sol";

import {IPoolManager}             from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                   from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}                  from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}                 from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams}    from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}                 from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary}             from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolId, PoolIdLibrary}    from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolModifyLiquidityTest}  from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {HookMiner}                from "../src/lib/HookMiner.sol";
import {MintwareTreasuryVault}    from "../src/payments/MintwareTreasuryVault.sol";
import {MintwareTreasuryJitHook}  from "../src/payments/MintwareTreasuryJitHook.sol";
import {MWAmAuction}              from "../src/hooks/MWAmAuction.sol";
import {AmParams}                 from "../src/hooks/MWAmAuctionLib.sol";

import {MockERC20}                from "../test/mocks/MockERC20.sol";
import {MockYieldAdapter}         from "../test/mocks/MockYieldAdapter.sol";
import {TestSwapRouter}           from "../test/helpers/TestSwapRouter.sol";

/// @title  SoakAmAmmDeploy — am-AMM soak, PART 1 (deploy + wire + seat manager) on live Base Sepolia
/// @notice Half 1 of the split soak. Deploys the whole am-AMM stack against the REAL Base Sepolia V4
///         PoolManager, enrolls the pool, and SEATS the deployer as the auction manager (`auction.bid`).
///         It does NO `vm.roll` and NO swaps — because a REAL broadcast can't fast-forward blocks: after
///         this runs, K (=10) real blocks must elapse on-chain before `SoakAmAmmSwap.s.sol` fires the
///         external swap that PROMOTES the manager + skims. At the end it prints every address in an
///         exact `SOAK_*=0x...` greppable form to thread into the swap script's env.
///
/// ─── SAFETY ──────────────────────────────────────────────────────────────────────────────────────
///     DRY-RUN unless you deliberately broadcast. To simulate (no state change):
///         forge script contracts-v4/script/SoakAmAmmDeploy.s.sol --rpc-url base_sepolia -vvv
///     Deployer == owner == team == manager (one key). Reads DEPLOYER_PRIVATE_KEY via vm.envUint;
///     V4_POOL_MANAGER via env (defaults to the live Base Sepolia PoolManager the repo's fork tests use).
contract SoakAmAmmDeploy is Script {
    using PoolIdLibrary for PoolKey;

    address  constant C2_FACTORY      = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint160  constant JIT_HOOK_FLAGS  = 0x20C8; // beforeInitialize | beforeSwap | afterSwap | beforeSwapReturnDelta
    uint160  constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0 (both mocks 6dp)
    int24    constant SPACING         = 60;
    uint256  constant ONE             = 1e6;
    // Live Base Sepolia V4 PoolManager the repo's fork tests hit (has code on-chain). The docs
    // `V4_POOL_MANAGER` value `...7E2C1b33b63` is NOT deployed — do not use it.
    address  constant DEFAULT_PM      = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;

    uint24   constant MGR_FEE_PIPS    = 5_000;   // 0.5% manager-set fee
    uint128  constant MGR_RENT        = 100;     // rent per block (raw usdc units)
    uint128  constant MGR_DEPOSIT     = 1_000;   // = rent * K (K = 10)

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address poolMgr     = vm.envOr("V4_POOL_MANAGER", DEFAULT_PM);

        console.log("=== am-AMM soak PART 1 (deploy + seat manager) - live Base Sepolia ===");
        console.log("chainid :", block.chainid);
        console.log("PoolMgr :", poolMgr);
        console.log("deployer:", deployer);

        vm.startBroadcast(deployerKey);

        // 1. Mocks + routers.
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        MockERC20 team = new MockERC20("Team Token", "TEAM", 6);
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        TestSwapRouter          swapRouter = new TestSwapRouter(IPoolManager(poolMgr));
        PoolModifyLiquidityTest lpRouter   = new PoolModifyLiquidityTest(IPoolManager(poolMgr));

        // 2. Sort tokens; placeholder-hooks ctor key.
        bool usdcIsC0 = address(usdc) < address(team);
        (Currency c0, Currency c1) = usdcIsC0
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        PoolKey memory ctorKey = PoolKey({
            currency0: c0, currency1: c1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(address(0))
        });

        // 3. Predict vault CREATE addr; mine the JIT hook (0x20C8) against it via the CREATE2 factory.
        address predictedVault = vm.computeCreateAddress(deployer, vm.getNonce(deployer));
        bytes memory hookArgs  = abi.encode(poolMgr, ctorKey, address(usdc), predictedVault, deployer);
        (address hookAddr, bytes32 hookSalt) =
            HookMiner.find(C2_FACTORY, JIT_HOOK_FLAGS, type(MintwareTreasuryJitHook).creationCode, hookArgs);

        PoolKey memory key = PoolKey({
            currency0: c0, currency1: c1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(hookAddr)
        });

        // 4. Vault (owner == team == deployer) lands at predicted; hook via CREATE2. (deploy-time sanity only)
        MintwareTreasuryVault vault =
            new MintwareTreasuryVault(poolMgr, key, address(usdc), address(adapter), deployer, deployer);
        require(address(vault) == predictedVault, "vault addr mismatch");

        MintwareTreasuryJitHook hook =
            new MintwareTreasuryJitHook{salt: hookSalt}(poolMgr, ctorKey, address(usdc), address(vault), deployer);
        require(address(hook) == hookAddr, "hook addr mismatch");

        // 5. Initialize the live pool WITH the hook (beforeInitialize gates sender==owner==deployer).
        IPoolManager(poolMgr).initialize(key, INIT_SQRT_PRICE);

        // 6. Wire the JIT seam + exempt the vault's own recover/collect swaps.
        vault.setJitHook(address(hook));
        hook.setJitSkipSender(address(vault));

        // 7. Fund + approve (deployer plays team + community + LP + manager).
        usdc.mint(deployer, 100_000_000 * ONE);
        team.mint(deployer, 100_000_000 * ONE);
        usdc.approve(address(vault),    type(uint256).max);
        team.approve(address(vault),    type(uint256).max);
        usdc.approve(address(lpRouter), type(uint256).max);
        team.approve(address(lpRouter), type(uint256).max);

        // 8. Team commit (junior first-loss) + community senior deposit.
        vault.commitTeam(1_000_000 * ONE, 5_000 * ONE, 365 days);
        vault.depositUSDC(10_000 * ONE, 0, deployer);

        // 9. Deep baseline liquidity (full range) so the later swap has depth.
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 5_000_000 * int256(ONE), salt: bytes32(0)}),
            ""
        );

        // 10. Vault deploys a senior USDC + junior TEAM slice into its OWN position (<= base - 80% idle).
        vault.deployToLP(1_000 * ONE, 2_000 * ONE);

        // 11. Deploy + wire + enroll the am-AMM auction (USDC rent → the vault).
        MWAmAuction auction = new MWAmAuction(deployer);
        auction.setCoordinator(address(hook));
        hook.setAuction(address(auction));
        hook.setAmAmmEnabled(true);
        PoolId poolId = key.toId();
        auction.configurePool(poolId, address(vault), AmParams({
            enabled: true, bidToken: address(usdc), feeMaxPips: 30_000, defaultFeePips: 3000,
            minRent: MGR_RENT, K: 10, minBidMultBps: 11_000
        }));
        vault.setRentFunder(address(auction));

        // 12. Seat the deployer as manager: bid USDC rent (deposit = rent * K). NO vm.roll here — the
        //     K-block notice must elapse as REAL blocks before the swap script promotes them.
        usdc.approve(address(auction), type(uint256).max);
        auction.bid(poolId, MGR_FEE_PIPS, MGR_RENT, MGR_DEPOSIT);

        vm.stopBroadcast();

        // ── Greppable address block for PART 2 (SoakAmAmmSwap.s.sol) env ────────────────────────────
        console.log("");
        console.log("=== SOAK ADDRESSES (export these for SoakAmAmmSwap.s.sol) ===");
        console.log(string.concat("SOAK_USDC=",       vm.toString(address(usdc))));
        console.log(string.concat("SOAK_TEAM=",       vm.toString(address(team))));
        console.log(string.concat("SOAK_ADAPTER=",    vm.toString(address(adapter))));
        console.log(string.concat("SOAK_VAULT=",      vm.toString(address(vault))));
        console.log(string.concat("SOAK_HOOK=",       vm.toString(address(hook))));
        console.log(string.concat("SOAK_AUCTION=",    vm.toString(address(auction))));
        console.log(string.concat("SOAK_SWAPROUTER=", vm.toString(address(swapRouter))));
        console.log(string.concat("SOAK_POOLMANAGER=", vm.toString(poolMgr)));
        console.log("SOAK_TICKSPACING=60");
        console.log("SOAK_POOLFEE=8388608"); // LPFeeLibrary.DYNAMIC_FEE_FLAG sentinel (0x800000)
        console.log("SOAK_K=10");
        console.log("(wait >= 10 real blocks after broadcasting this, THEN run SoakAmAmmSwap)");
    }
}
