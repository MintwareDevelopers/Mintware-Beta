// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console}       from "forge-std/Script.sol";

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary}          from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

import {MintwareTreasuryVault} from "../src/payments/MintwareTreasuryVault.sol";
import {MWAmAuction}           from "../src/hooks/MWAmAuction.sol";
import {MockERC20}             from "../test/mocks/MockERC20.sol";
import {TestSwapRouter}        from "../test/helpers/TestSwapRouter.sol";

/// @title  SoakAmAmmSwap — am-AMM soak, PART 2 (the external swap) on live Base Sepolia
/// @notice Half 2 of the split soak. Reads the PART-1 addresses from env, reconstructs the hooked
///         PoolKey, mints itself mock USDC, and fires ONE external buy-TEAM (USDC-in) exact-input swap
///         through the deployed TestSwapRouter. It then LOGS the resulting on-chain state.
///
/// ⚠ CRITICAL — NO ASSERTIONS ON PROMOTION: whether the manager seated in PART 1 is promoted depends on
///     K (=10) REAL blocks having elapsed on-chain between the two broadcasts. This script makes NO
///     `require`/assert about a promoted manager or a nonzero skim. Both outcomes are valid results:
///       • manager promoted   → owed[mgr][usdc] rises (the skim), LP fee 0, JIT skipped;
///       • not yet promoted    → unmanaged deviation-fee fallback, no skim, JIT still skipped.
///     It just settles the swap and prints whatever the real state produced.
///
/// ─── SAFETY ──────────────────────────────────────────────────────────────────────────────────────
///     DRY-RUN unless you deliberately broadcast. (A standalone dry-run needs the PART-1 addresses to be
///     live on-chain; without a real PART-1 broadcast it will revert at the swap — that is expected.)
///         forge script contracts-v4/script/SoakAmAmmSwap.s.sol --rpc-url base_sepolia -vvv
///     Reads DEPLOYER_PRIVATE_KEY via vm.envUint; SOAK_* addresses via vm.envAddress.
///
/// ─── Required env (from PART 1's SOAK_* output) ────────────────────────────────────────────────────
///     SOAK_USDC, SOAK_TEAM, SOAK_VAULT, SOAK_HOOK, SOAK_AUCTION, SOAK_SWAPROUTER  (addresses)
///     SOAK_TICKSPACING (int, e.g. 60)      — optional, defaults 60
///     SOAK_SWAP_USDC_IN (uint, raw 6dp)    — optional, defaults 10_000e6
contract SoakAmAmmSwap is Script {
    int24 constant DEFAULT_SPACING = 60;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey); // == the seated manager (same key as PART 1)

        address usdcAddr   = vm.envAddress("SOAK_USDC");
        address teamAddr   = vm.envAddress("SOAK_TEAM");
        address vaultAddr  = vm.envAddress("SOAK_VAULT");
        address hookAddr   = vm.envAddress("SOAK_HOOK");
        address auctionAddr= vm.envAddress("SOAK_AUCTION");
        address routerAddr = vm.envAddress("SOAK_SWAPROUTER");
        int24   spacing    = int24(int256(vm.envOr("SOAK_TICKSPACING", uint256(uint24(DEFAULT_SPACING)))));
        uint256 amtIn      = vm.envOr("SOAK_SWAP_USDC_IN", uint256(10_000) * 1e6);

        MockERC20             usdc    = MockERC20(usdcAddr);
        MockERC20             team    = MockERC20(teamAddr);
        MintwareTreasuryVault vault   = MintwareTreasuryVault(vaultAddr);
        MWAmAuction           auction = MWAmAuction(auctionAddr);
        TestSwapRouter        router  = TestSwapRouter(routerAddr);

        // Reconstruct the hooked, dynamic-fee PoolKey exactly as PART 1 built it.
        bool usdcIsC0 = usdcAddr < teamAddr;
        (Currency c0, Currency c1) = usdcIsC0
            ? (Currency.wrap(usdcAddr), Currency.wrap(teamAddr))
            : (Currency.wrap(teamAddr), Currency.wrap(usdcAddr));
        PoolKey memory key = PoolKey({
            currency0: c0, currency1: c1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: spacing, hooks: IHooks(hookAddr)
        });

        console.log("=== am-AMM soak PART 2 (external buy-TEAM swap) - live Base Sepolia ===");
        console.log("deployer/mgr:", deployer);
        console.log("vault       :", vaultAddr);
        console.log("hook        :", hookAddr);
        console.log("usdc in     :", amtIn);

        uint256 owedUsdcBefore = auction.owed(deployer, usdcAddr);
        uint256 owedTeamBefore = auction.owed(deployer, teamAddr);
        uint256 navBefore      = vault.totalSeniorAssets();
        uint256 teamBefore     = team.balanceOf(deployer);

        vm.startBroadcast(deployerKey);
        // Mint ourselves the USDC input and approve the router.
        usdc.mint(deployer, amtIn);
        usdc.approve(routerAddr, type(uint256).max);
        // ONE external buy-TEAM (USDC-in) exact-input swap. zeroForOne == usdcIsC0 sells USDC → buys TEAM.
        router.swap(key, usdcIsC0, amtIn);
        vm.stopBroadcast();

        uint256 owedUsdcAfter = auction.owed(deployer, usdcAddr);
        uint256 owedTeamAfter = auction.owed(deployer, teamAddr);
        uint256 navAfter      = vault.totalSeniorAssets();
        uint256 teamAfter     = team.balanceOf(deployer);

        console.log("");
        console.log("--- result (whatever the real on-chain state produced) ---");
        console.log("owed[mgr][usdc]     :", owedUsdcAfter);
        console.log("  (delta vs before) :", owedUsdcAfter - owedUsdcBefore); // > 0 iff manager promoted + skimmed
        console.log("owed[mgr][team]     :", owedTeamAfter);
        console.log("  (delta vs before) :", owedTeamAfter - owedTeamBefore);
        console.log("totalSeniorAssets   :", navAfter);
        console.log("  (delta vs before) :", navAfter - navBefore);            // rent lifted senior (if any elapsed)
        console.log("reservedJuniorUSDC  :", vault.reservedJuniorUSDC());
        console.log("reservedProtocolUSDC:", vault.reservedProtocolUSDC());
        console.log("jitBorrowed         :", vault.jitBorrowed());             // 0 — am-AMM replaces JIT on enrolled pool
        console.log("team received       :", teamAfter - teamBefore);         // > 0 — the swap settled
        console.log("");
        console.log(owedUsdcAfter > owedUsdcBefore
            ? "=> MANAGED: manager promoted and skimmed the fee."
            : "=> UNMANAGED fallback: manager not yet promoted (need K real blocks); swap settled on the deviation fee.");
    }
}
