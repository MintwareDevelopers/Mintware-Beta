// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}         from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";

import {FeeVault}                 from "../src/FeeVault.sol";
import {HookMiner}                from "../src/lib/HookMiner.sol";
import {MWHookCoordinator}        from "../src/hooks/MWHookCoordinator.sol";
import {MintwareDeFiVault4626}    from "../src/vaults/MintwareDeFiVault4626.sol";
import {MintwareVaultRegistry}    from "../src/vaults/MintwareVaultRegistry.sol";
import {VaultSurface, LockTier, VaultConfig} from "../src/vaults/VaultTypes.sol";

import {MockERC20}      from "./mocks/MockERC20.sol";
import {TestSwapRouter} from "./helpers/TestSwapRouter.sol";

/// @notice Deploy-path verification: replicates DeployPhase3.s.sol's exact sequence + config,
///         then drives a full deposit → swap → collectFees → async-redeem lifecycle. Proves the
///         production go-live wiring (FeeVault ↔ 4626 vault ↔ coordinator ↔ registry) actually
///         produces a working system — the script was rewired to the coordinator in PR #40 but
///         had never been executed. This is the standing regression guard for go-live.
///
/// @dev    The CREATE2 salt is mined with `address(this)` as the deployer (a test deploys the
///         hook itself); DeployPhase3 instead relies on Foundry routing salted `new` through the
///         canonical CREATE2 factory (0x4e59…) during broadcast — a chain precondition, noted in
///         the go-live runbook. Everything else here mirrors the script 1:1.
contract DeployPhase3Test is Test {
    using PoolIdLibrary for PoolKey;

    address internal deployer  = address(this);
    address internal treasury  = makeAddr("treasury");
    address internal oracle    = makeAddr("oracle");
    address internal dist      = makeAddr("distributor");
    address internal alice     = makeAddr("alice");
    address internal trader    = makeAddr("trader");

    PoolManager    internal pm;
    TestSwapRouter internal swapRouter;
    FeeVault       internal feeVault;
    MWHookCoordinator internal hook;
    MintwareDeFiVault4626 internal vault;
    MintwareVaultRegistry internal registry;

    MockERC20 internal usdc;
    MockERC20 internal proj;
    bool      internal usdcIsToken0;

    PoolKey internal poolKey;
    PoolId  internal poolId;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    bytes32 internal constant VAULT_ID = keccak256("defi-vault-golive");

    // ── mirror of the DeployPhase3 sequence (steps 1–7) ──────────────────────

    function _deployAsScriptWould() internal {
        pm         = new PoolManager(deployer);
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));

        usdc = new MockERC20("USD Coin", "USDC", 6);
        proj = new MockERC20("Project", "PROJ", 6);
        usdcIsToken0 = address(usdc) < address(proj);

        // 1. FeeVault
        feeVault = new FeeVault(address(usdc), dist, oracle, treasury);

        // 2. Mine coordinator salt (vault wired post-deploy → vault == address(0))
        bytes memory hookArgs = abi.encode(IPoolManager(address(pm)), address(0), deployer);
        (address expected, bytes32 salt) =
            HookMiner.find(deployer, uint160(0xAC0), type(MWHookCoordinator).creationCode, hookArgs);

        // 3. Vault (script config: 0.5% entry / 1.0% exit fee)
        VaultConfig memory cfg = VaultConfig({
            surface:             VaultSurface.DeFi,
            provider:            deployer,
            underlyingToken:     address(usdc),
            treasury:            treasury,
            name:                "Mintware DeFi Vault Share",
            symbol:              "mwDEFI",
            minDeposit:          0,
            entryFeeBps:         50,
            exitFeeBps:          100,
            enableMEVProtection: true,
            enableIdleCapital:   false,
            idleTargetRatio:     0
        });
        vault = new MintwareDeFiVault4626(cfg, address(pm), address(feeVault));

        // 4. Hook at the mined address
        hook = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), address(0), deployer);
        require(address(hook) == expected, "hook address mismatch");

        // 5. Wiring
        hook.setVault(address(vault));
        feeVault.setSocialVault(address(vault));
        feeVault.setHook(address(hook));

        // 6. Registry
        registry = new MintwareVaultRegistry();

        // 7. Register
        bytes32 vaultId = keccak256(abi.encode(block.chainid, address(vault)));
        registry.registerVault(
            vaultId, VaultSurface.DeFi, address(vault), address(feeVault), address(hook), address(0), deployer
        );

        // Post-deploy pool config (coordinator dynamic fee + oracle guard, wide band).
        (Currency c0, Currency c1) = usdcIsToken0
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(proj)))
            : (Currency.wrap(address(proj)), Currency.wrap(address(usdc)));
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(hook))});
        poolId  = poolKey.toId();
        hook.configurePool(poolId, 3000, 100000, 0, 0, false, true, 60, 6000, 10);
    }

    function setUp() public {
        _deployAsScriptWould();
        proj.mint(deployer, 1_000_000e6);
        usdc.mint(alice, 100_000e6);
        usdc.mint(trader, 1_000_000e6);
        proj.mint(trader, 1_000_000e6);
    }

    // ── the deploy produced a working, correctly-wired system ────────────────

    function test_deploy_wiring_is_correct() public view {
        assertEq(hook.vault(), address(vault),        "hook.vault -> vault");
        assertEq(vault.feeVault(), address(feeVault), "vault.feeVault -> feeVault");
        assertEq(feeVault.socialVault(), address(vault), "feeVault.vault -> vault");
        assertEq(feeVault.hook(), address(hook),      "feeVault.hook -> hook");
        assertEq(uint160(address(hook)) & 0x3FFF, 0xAC0, "hook permission bits");
        bytes32 vaultId = keccak256(abi.encode(block.chainid, address(vault)));
        assertEq(registry.getVault(vaultId).vault, address(vault), "registry has the vault");
    }

    /// @notice Full go-live lifecycle against the freshly-"deployed" stack: seed → deposit
    ///         (LP gated to the vault by the coordinator) → swap (coordinator hot path) →
    ///         collectFees (50/25/25 split to FeeVault/treasury/provider) → async redeem.
    function test_full_lifecycle_deposit_swap_collect_redeem() public {
        // seed the pool + open a practical range
        proj.approve(address(vault), 100_000e6);
        vault.seedTeamTokens(VAULT_ID, address(proj), 100_000e6, poolKey, INIT_SQRT_PRICE);
        vault.rebalance(-60000, 60000);

        // deposit (entry fee 0.5% → treasury; liquidity deployed via the coordinator LP gate)
        uint256 tBefore = usdc.balanceOf(treasury);
        vm.startPrank(alice);
        usdc.approve(address(vault), 50_000e6);
        uint256 shares = vault.depositWithLock(50_000e6, alice, LockTier.Flex);
        vm.stopPrank();
        assertGt(shares, 0, "shares minted");
        assertEq(usdc.balanceOf(treasury) - tBefore, 250e6, "0.5% entry fee to treasury");
        assertGt(vault.totalLiquidity(), 0, "liquidity deployed through the coordinator");

        // swap through the pool → coordinator beforeSwap/afterSwap run; fees accrue on the position
        vm.startPrank(trader, trader);
        usdc.approve(address(swapRouter), type(uint256).max);
        proj.approve(address(swapRouter), type(uint256).max);
        bool usdcInIsZero = usdcIsToken0;
        swapRouter.swap(poolKey, usdcInIsZero, 10_000e6);   // buy proj with usdc
        swapRouter.swap(poolKey, !usdcInIsZero, 8_000e6);   // sell some back
        vm.stopPrank();

        // collect swap fees → 50 depositors (FeeVault) / 25 Mintware (treasury) / 25 provider
        uint256 fvBefore = usdc.balanceOf(address(feeVault));
        (uint256 usdcFees,) = vault.collectFees();
        assertGt(usdcFees, 0, "swap fees realized in USDC");
        assertGt(usdc.balanceOf(address(feeVault)) - fvBefore, 0, "depositor share routed to FeeVault");

        // async redeem: request → 7-day notice → execute (Flex → no penalty)
        vm.warp(block.timestamp + 25 hours);
        vm.prank(alice);
        vault.requestRedeem(shares);
        vm.warp(block.timestamp + 7 days + 1);
        uint256 aBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        vault.executeRedeem();
        assertGt(usdc.balanceOf(alice) - aBefore, 0, "redeemed principal back");
        assertEq(vault.balanceOf(alice), 0, "shares burned");
    }
}
