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

/// @title  SoakAmAmm — end-to-end am-AMM soak against LIVE Base Sepolia V4 state
/// @notice Exercises the full Phase-3 am-AMM flow (deploy the treasury vault + JIT hook against the REAL
///         Base Sepolia PoolManager, seat an auction manager, drive external swaps that promote the
///         manager, skim the fee, push rent to the senior, and prove `jitBorrowed == 0` because the
///         auction REPLACES the JIT lever on an enrolled pool) — all inside ONE `run()` simulation.
///
///         This mirrors `contracts-v4/test/payments/MintwareTreasuryJitHook.t.sol` (its `setUp` wiring +
///         the `test_amAmm_*` tests) and `contracts-v4/script/DeployTreasuryV2.s.sol` (the vault↔hook↔pool
///         CREATE-prediction ordering), but runs it against the live PoolManager rather than a fresh
///         in-test one.
///
/// ─── SAFETY ──────────────────────────────────────────────────────────────────────────────────────
///     DRY-RUN ONLY. Run WITHOUT `--broadcast`:
///         forge script contracts-v4/script/SoakAmAmm.s.sol --rpc-url base_sepolia -vvv
///     The on-chain-mutating work is wrapped in vm.startBroadcast/stopBroadcast so a FUTURE real
///     broadcast would work, but this artifact is for simulation + gas estimation only. `vm.roll` is
///     used to simulate the K-block manager-promotion wait (fine for a dry-run; a real broadcast would
///     instead wait real blocks between txs).
///
/// ─── Env ─────────────────────────────────────────────────────────────────────────────────────────
///     V4_POOL_MANAGER       Base Sepolia v4 PoolManager (default: the known Sepolia deployment)
///     DEPLOYER_PRIVATE_KEY  read via vm.envUint — deployer == owner == manager == trader (all one key)
contract SoakAmAmm is Script {
    using PoolIdLibrary for PoolKey;

    // Deterministic CREATE2 factory (present on Base Sepolia) — the deployer of the salted hook.
    address  constant C2_FACTORY      = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    // beforeInitialize | beforeSwap | afterSwap | beforeSwapReturnDelta
    uint160  constant JIT_HOOK_FLAGS  = 0x20C8;
    // 1:1 @ tick 0 (both mock tokens are 6dp, so a 1:1 sqrtPrice is correct here).
    uint160  constant INIT_SQRT_PRICE = 79228162514264337593543950336;
    int24    constant SPACING         = 60;
    uint256  constant ONE             = 1e6;      // 6dp
    // Live Base Sepolia V4 PoolManager (fallback if V4_POOL_MANAGER is unset). This is the address the
    // repo's own fork tests hit (MWPairVaultAmAmmFork / ULVDeploymentFork) and which carries code on
    // Base Sepolia — the docs/`V4_POOL_MANAGER` value `...7E2C1b33b63` has no code deployed at it.
    address  constant DEFAULT_PM      = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;

    // am-AMM manager terms (mirrors the JitHook test).
    uint24   constant MGR_FEE_PIPS    = 5_000;    // 0.5% manager-set fee
    uint128  constant MGR_RENT        = 100;      // rent per block (raw usdc units)
    uint128  constant MGR_DEPOSIT     = 1_000;    // = rent * K (K = 10)

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address poolMgr     = vm.envOr("V4_POOL_MANAGER", DEFAULT_PM);

        console.log("=== am-AMM soak (DRY-RUN) against live Base Sepolia ===");
        console.log("chainid :", block.chainid);
        console.log("PoolMgr :", poolMgr);
        console.log("deployer:", deployer);

        vm.startBroadcast(deployerKey);

        // 1. Mocks: USDC (6dp) + TEAM (6dp), an idle-yield adapter over USDC, and the test swap/LP routers.
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        MockERC20 team = new MockERC20("Team Token", "TEAM", 6);
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        TestSwapRouter          swapRouter = new TestSwapRouter(IPoolManager(poolMgr));
        PoolModifyLiquidityTest lpRouter   = new PoolModifyLiquidityTest(IPoolManager(poolMgr));

        // 2. Sort the pool tokens; build the placeholder-hooks ctor key (the hook ctor ignores key.hooks).
        bool usdcIsC0 = address(usdc) < address(team);
        (Currency c0, Currency c1) = usdcIsC0
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        PoolKey memory ctorKey = PoolKey({
            currency0: c0, currency1: c1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(address(0))
        });

        // 3. Break the vault↔hook circular dep: PREDICT the vault's CREATE address (its poolKey needs the
        //    mined hook, and the hook ctor needs the vault). The vault is the deployer's NEXT CREATE (the
        //    mocks above already consumed nonces); the hook is deployed via the CREATE2 factory (no
        //    deployer-nonce use), so the vault lands at computeCreateAddress(deployer, currentNonce).
        address predictedVault = vm.computeCreateAddress(deployer, vm.getNonce(deployer));

        bytes memory hookArgs = abi.encode(poolMgr, ctorKey, address(usdc), predictedVault, deployer);
        (address hookAddr, bytes32 hookSalt) =
            HookMiner.find(C2_FACTORY, JIT_HOOK_FLAGS, type(MintwareTreasuryJitHook).creationCode, hookArgs);

        PoolKey memory key = PoolKey({
            currency0: c0, currency1: c1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(hookAddr)
        });

        // 4. Vault (owner == team == deployer) lands at the predicted address; then the hook via CREATE2.
        MintwareTreasuryVault vault =
            new MintwareTreasuryVault(poolMgr, key, address(usdc), address(adapter), deployer, deployer);
        require(address(vault) == predictedVault, "vault addr mismatch");

        MintwareTreasuryJitHook hook =
            new MintwareTreasuryJitHook{salt: hookSalt}(poolMgr, ctorKey, address(usdc), address(vault), deployer);
        require(address(hook) == hookAddr, "hook addr mismatch");
        console.log("vault   :", address(vault));
        console.log("hook    :", address(hook));

        // 5. Initialize the LIVE pool WITH the mined hook (beforeInitialize gates sender==owner==deployer).
        IPoolManager(poolMgr).initialize(key, INIT_SQRT_PRICE);

        // 6. Wire the JIT seam + exempt the vault's own recover/collect swaps from the auction.
        vault.setJitHook(address(hook));
        hook.setJitSkipSender(address(vault));

        // 7. Fund the deployer and set allowances (deployer plays team + community + LP + manager + trader).
        usdc.mint(deployer, 100_000_000 * ONE);
        team.mint(deployer, 100_000_000 * ONE);
        usdc.approve(address(vault),      type(uint256).max);
        team.approve(address(vault),      type(uint256).max);
        usdc.approve(address(lpRouter),   type(uint256).max);
        team.approve(address(lpRouter),   type(uint256).max);
        usdc.approve(address(swapRouter), type(uint256).max);
        team.approve(address(swapRouter), type(uint256).max);

        // 8. Team commit (junior first-loss = 1M TEAM + 5k USDC buffer) + community senior deposit ($10k).
        vault.commitTeam(1_000_000 * ONE, 5_000 * ONE, 365 days);
        vault.depositUSDC(10_000 * ONE, 0, deployer);

        // 9. Deep baseline liquidity on the hooked pool (full range) so swaps have depth.
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 5_000_000 * int256(ONE), salt: bytes32(0)}),
            ""
        );

        // 10. Vault deploys a slice of senior USDC + junior TEAM into its OWN two-sided position (idle-first
        //     cap: <= base - 80% idle target, so <= 2,000 USDC of the 10k senior base here).
        vault.deployToLP(1_000 * ONE, 2_000 * ONE);

        // 11. Deploy + wire the am-AMM auction; enroll the canonical pool with USDC rent to the vault.
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

        // 12. Seat the deployer as manager: bid USDC rent (deposit = rent * K), then roll past K so the next
        //     swap's poke promotes them.
        usdc.approve(address(auction), type(uint256).max);
        auction.bid(poolId, MGR_FEE_PIPS, MGR_RENT, MGR_DEPOSIT);
        vm.roll(block.number + 11); // > K → next external swap promotes the manager

        // ── Managed swap #1: promote + skim; JIT is REPLACED (jitBorrowed stays 0) ──────────────────
        uint256 navInitial = vault.totalSeniorAssets();
        _buyTeam(swapRouter, key, usdcIsC0, 10_000 * ONE); // buy TEAM, USDC-in → skim lands in USDC

        uint256 owedUsdc1 = auction.owed(deployer, address(usdc));
        uint256 owedTeam1 = auction.owed(deployer, address(team));
        uint256 navAfter1 = vault.totalSeniorAssets();

        console.log("");
        console.log("--- after managed swap #1 (promotion + skim) ---");
        console.log("owed[mgr][usdc]     :", owedUsdc1);   // skim landed (input=usdc)
        console.log("owed[mgr][team]     :", owedTeam1);
        console.log("jitBorrowed         :", vault.jitBorrowed()); // == 0: am-AMM replaced JIT
        console.log("totalSeniorAssets(0):", navInitial);
        console.log("totalSeniorAssets(1):", navAfter1);

        // Accrue a few blocks of rent (< K so the manager survives), then swap again. This proves the
        // HIGH-fix exemption is not in play for external traders: a second EXTERNAL swap still settles,
        // the manager keeps skimming, and the elapsed rent is lifted into the senior via fundRent.
        vm.roll(block.number + 3);

        // ── Managed swap #2: still settles, manager keeps skimming, rent lifts the senior ────────────
        uint256 traderTeamBefore = team.balanceOf(deployer);
        _buyTeam(swapRouter, key, usdcIsC0, 10_000 * ONE);
        uint256 traderTeamAfter = team.balanceOf(deployer);

        uint256 owedUsdc2 = auction.owed(deployer, address(usdc));
        uint256 owedTeam2 = auction.owed(deployer, address(team));
        uint256 navAfter2 = vault.totalSeniorAssets();

        console.log("");
        console.log("--- after managed swap #2 (keeps skimming + rent lift) ---");
        console.log("owed[mgr][usdc]     :", owedUsdc2);   // grew vs #1 → manager kept skimming
        console.log("owed[mgr][team]     :", owedTeam2);
        console.log("jitBorrowed         :", vault.jitBorrowed()); // still 0
        console.log("totalSeniorAssets(2):", navAfter2);           // > navAfter1 by the accrued rent
        console.log("rent lifted senior  :", navAfter2 - navAfter1);
        console.log("reservedJuniorUSDC  :", vault.reservedJuniorUSDC());   // 0 during lock (rent → senior)
        console.log("reservedProtocolUSDC:", vault.reservedProtocolUSDC()); // 0 during lock
        console.log("swap#2 team-out     :", traderTeamAfter - traderTeamBefore); // > 0 → still settled

        require(traderTeamAfter > traderTeamBefore, "swap#2 did not settle");
        require(owedUsdc2 > owedUsdc1, "manager stopped skimming on swap#2");
        require(vault.jitBorrowed() == 0, "JIT fired on an am-AMM-enrolled pool");
        require(navAfter2 > navAfter1, "rent did not lift the senior");

        vm.stopBroadcast();

        console.log("");
        console.log("=== am-AMM soak simulation complete ===");
    }

    /// @dev Buy TEAM with an exact USDC input. USDC-in direction = (usdc is currency0) ? zeroForOne : oneForZero.
    function _buyTeam(TestSwapRouter router, PoolKey memory key, bool usdcIsC0, uint256 amtIn) internal {
        router.swap(key, usdcIsC0, amtIn); // zeroForOne == usdcIsC0 sells USDC (currency0) → buys TEAM
    }
}
