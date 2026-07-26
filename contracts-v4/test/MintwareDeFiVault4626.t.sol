// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}         from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary}        from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {FeeVault}                from "../src/FeeVault.sol";
import {MWSocialHook}            from "../src/MWSocialHook.sol";
import {HookMiner}               from "../src/lib/HookMiner.sol";
import {MintwareDeFiVault4626}   from "../src/vaults/MintwareDeFiVault4626.sol";
import {MintwareBaseVault4626}   from "../src/vaults/MintwareBaseVault4626.sol";
import {VaultSurface, LockTier, VaultConfig, PoolProfile} from "../src/vaults/VaultTypes.sol";

import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Integration tests for the Phase-3 ERC-4626 DeFi vault against a real V4 PoolManager.
///         Proves: deposit → shares minted + liquidity deployed → async lock redeem →
///         penalty routing → synchronous-redemption disabled. Mirrors the existing
///         Integration.t.sol harness (real PoolManager, mined MWSocialHook).
contract MintwareDeFiVault4626Test is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    address internal deployer = address(this);
    address internal team     = makeAddr("team");
    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal oracle   = makeAddr("oracle");
    address internal treasury = makeAddr("treasury");
    address internal feeTreasury = makeAddr("feeTreasury");
    address internal dist     = makeAddr("distributor");

    PoolManager internal pm;
    FeeVault    internal feeVault;
    MWSocialHook internal hook;
    MintwareDeFiVault4626 internal vault;

    MockERC20 internal usdc;
    MockERC20 internal proj;
    bool      internal usdcIsToken0;

    PoolKey internal poolKey;
    PoolId  internal poolId;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    bytes32 internal constant VAULT_ID = keccak256("defi-vault");

    function setUp() public {
        pm = new PoolManager(deployer);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        proj = new MockERC20("Project Token", "PROJ", 6);
        usdcIsToken0 = address(usdc) < address(proj);

        feeVault = new FeeVault(address(usdc), dist, oracle, treasury);

        // Mine + deploy MWSocialHook at an address with the correct permission bits.
        bytes memory hookArgs = abi.encode(
            IPoolManager(address(pm)), address(usdc), address(feeVault),
            treasury, address(0), address(0), deployer
        );
        (, bytes32 salt) = HookMiner.find(
            deployer, uint160(0x0AC4), type(MWSocialHook).creationCode, hookArgs
        );
        hook = new MWSocialHook{salt: salt}(
            IPoolManager(address(pm)), address(usdc), address(feeVault),
            treasury, address(0), address(0), deployer
        );

        // Deploy the ERC-4626 DeFi vault.
        vault = new MintwareDeFiVault4626(_cfg(0, 0), address(pm), address(feeVault));

        // Wire cross-references (hook gates LP to the vault).
        hook.setSocialVault(address(vault));
        feeVault.setSocialVault(address(vault));
        feeVault.setHook(address(hook));

        (Currency c0, Currency c1) = usdcIsToken0
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(proj)))
            : (Currency.wrap(address(proj)), Currency.wrap(address(usdc)));
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(hook))});
        poolId = poolKey.toId();

        proj.mint(team, 1_000_000e6);
        usdc.mint(alice, 100_000e6);
        usdc.mint(bob, 50_000e6);
    }

    // ── helpers ────────────────────────────────────────────────────────────

    function _cfg(uint256 entryBps, uint256 exitBps) internal view returns (VaultConfig memory) {
        return VaultConfig({
            surface:             VaultSurface.DeFi,
            provider:            deployer,
            underlyingToken:     address(usdc),
            treasury:            feeTreasury,
            name:                "MW DeFi Vault Share",
            symbol:              "mwDEFI",
            minDeposit:          0,
            entryFeeBps:         entryBps,
            exitFeeBps:          exitBps,
            enableMEVProtection: true,
            enableIdleCapital:   false,
            idleTargetRatio:     0
        });
    }

    function _seedPool() internal {
        // Provider == owner seeds the pool (factory hands vault ownership to provider).
        proj.mint(address(this), 100_000e6);
        proj.approve(address(vault), 100_000e6);
        vault.seedTeamTokens(VAULT_ID, address(proj), 100_000e6, poolKey, INIT_SQRT_PRICE);
        vault.rebalance(-60000, 60000); // practical range (owner = deployer)
    }

    function _deposit(address user, uint256 amount, LockTier tier) internal returns (uint256 shares) {
        vm.startPrank(user);
        usdc.approve(address(vault), amount);
        shares = vault.depositWithLock(amount, user, tier);
        vm.stopPrank();
    }

    // ── tests ──────────────────────────────────────────────────────────────

    function test_deposit_mints_shares_and_deploys_liquidity() public {
        _seedPool();
        uint256 amount = 10_000e6;
        uint256 shares = _deposit(alice, amount, LockTier.Flex);

        assertEq(vault.balanceOf(alice), shares, "share balance");
        assertGt(shares, 0, "shares minted");
        assertEq(vault.totalPrincipal(), amount, "principal tracked");
        assertEq(vault.totalAssets(), amount, "totalAssets = principal (D5)");
        assertGt(vault.totalLiquidity(), 0, "liquidity deployed");
    }

    function test_flex_async_redeem_returns_principal() public {
        _seedPool();
        uint256 amount = 5_000e6;
        uint256 shares = _deposit(alice, amount, LockTier.Flex);

        uint256 balBefore = usdc.balanceOf(alice);

        vm.warp(block.timestamp + 25 hours); // past MIN_HOLD
        vm.prank(alice);
        vault.requestRedeem(shares);

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(alice);
        vault.executeRedeem();

        uint256 received = usdc.balanceOf(alice) - balBefore;
        assertApproxEqAbs(received, amount, 1, "flex redeem returns full principal");
        assertEq(vault.balanceOf(alice), 0, "shares burned");
        assertEq(vault.totalPrincipal(), 0, "principal zeroed");
    }

    function test_early_exit_penalty_routes_to_fee_vault() public {
        _seedPool();
        uint256 amount = 10_000e6;
        uint256 shares = _deposit(alice, amount, LockTier.Committed); // 30-day lock

        vm.warp(block.timestamp + 25 hours);
        vm.prank(alice);
        vault.requestRedeem(shares);
        vm.warp(block.timestamp + 7 days + 1); // ~8 days elapsed → 20-50% band → 1%

        uint256 feeVaultBefore = usdc.balanceOf(address(feeVault));
        uint256 aliceBefore    = usdc.balanceOf(alice);

        vm.prank(alice);
        vault.executeRedeem();

        uint256 penalty  = usdc.balanceOf(address(feeVault)) - feeVaultBefore;
        uint256 received = usdc.balanceOf(alice) - aliceBefore;

        assertEq(penalty, (amount * 100) / 10_000, "1% penalty for 20-50% elapsed");
        assertApproxEqAbs(received + penalty, amount, 1, "payout + penalty = principal");
    }

    function test_synchronous_redemption_disabled() public {
        _seedPool();
        _deposit(alice, 1_000e6, LockTier.Flex);

        assertEq(vault.maxWithdraw(alice), 0, "maxWithdraw 0");
        assertEq(vault.maxRedeem(alice), 0, "maxRedeem 0");

        vm.startPrank(alice);
        vm.expectRevert(MintwareBaseVault4626.SynchronousRedemptionDisabled.selector);
        vault.withdraw(1, alice, alice);
        vm.expectRevert(MintwareBaseVault4626.SynchronousRedemptionDisabled.selector);
        vault.redeem(1, alice, alice);
        vm.stopPrank();
    }

    function test_second_deposit_cannot_change_lock_tier() public {
        _seedPool();
        _deposit(alice, 1_000e6, LockTier.Core);

        vm.startPrank(alice);
        usdc.approve(address(vault), 1e6);
        vm.expectRevert(MintwareBaseVault4626.LockTierChangeNotAllowed.selector);
        vault.depositWithLock(1e6, alice, LockTier.Flex);
        vm.stopPrank();
    }

    function test_totalAssets_is_principal_not_nav() public {
        _seedPool();
        _deposit(alice, 10_000e6, LockTier.Flex);
        // Even though assets are deployed as V4 liquidity, totalAssets reports principal.
        assertEq(vault.totalAssets(), 10_000e6, "principal accounting (D5)");
        assertEq(vault.convertToAssets(vault.balanceOf(alice)), 10_000e6, "1:1 share:principal");
    }

    // ── Track A1: pool profiles ──────────────────────────────────────────────

    function test_profileHalfWidth_values() public view {
        assertEq(vault.profileHalfWidth(PoolProfile.BLUE_CHIP), 600);
        assertEq(vault.profileHalfWidth(PoolProfile.EMERGING), 1200);
        assertEq(vault.profileHalfWidth(PoolProfile.MEME), 2400);
    }

    function test_rebalanceToProfile_blue_chip_sets_range() public {
        _seedPool();
        _deposit(alice, 10_000e6, LockTier.Flex);

        vault.rebalanceToProfile(PoolProfile.BLUE_CHIP); // current tick 0, spacing 60
        assertEq(vault.tickLower(), -600, "BLUE_CHIP lower");
        assertEq(vault.tickUpper(), 600, "BLUE_CHIP upper");
        assertEq(uint256(vault.profile()), uint256(PoolProfile.BLUE_CHIP), "profile stored");
        assertGt(vault.totalLiquidity(), 0, "liquidity redeployed");
    }

    function test_profile_ranges_scale_with_risk() public {
        _seedPool();
        _deposit(alice, 10_000e6, LockTier.Flex);

        vault.rebalanceToProfile(PoolProfile.EMERGING);
        assertEq(vault.tickLower(), -1200);
        assertEq(vault.tickUpper(), 1200);

        vault.rebalanceToProfile(PoolProfile.MEME);
        assertEq(vault.tickLower(), -2400);
        assertEq(vault.tickUpper(), 2400);
    }

    function test_rebalanceToProfile_onlyOwner() public {
        _seedPool();
        vm.prank(alice);
        vm.expectRevert();
        vault.rebalanceToProfile(PoolProfile.MEME);
    }

    // ── Track A: entry/exit fees (spec fee model) ────────────────────────────

    function test_entry_fee_to_treasury_shares_for_net() public {
        // Fee-enabled vault, no pool wiring — assets held in vault, isolates fee logic.
        MintwareDeFiVault4626 fv = new MintwareDeFiVault4626(_cfg(50, 100), address(pm), address(feeVault));
        usdc.mint(alice, 10_000e6);

        vm.startPrank(alice);
        usdc.approve(address(fv), 10_000e6);
        uint256 shares = fv.depositWithLock(10_000e6, alice, LockTier.Flex);
        vm.stopPrank();

        assertEq(usdc.balanceOf(feeTreasury), 50e6, "entry fee 0.5% to treasury");
        assertEq(fv.totalPrincipal(), 9_950e6, "net principal = gross - entry fee");
        assertEq(fv.totalAssets(), 9_950e6, "totalAssets = net principal");
        assertApproxEqAbs(shares, 9_950e6, 1, "shares minted for net");
    }

    function test_exit_fee_to_treasury() public {
        MintwareDeFiVault4626 fv = new MintwareDeFiVault4626(_cfg(0, 100), address(pm), address(feeVault));
        usdc.mint(alice, 10_000e6);

        vm.startPrank(alice);
        usdc.approve(address(fv), 10_000e6);
        uint256 shares = fv.depositWithLock(10_000e6, alice, LockTier.Flex);
        vm.warp(block.timestamp + 25 hours);
        fv.requestRedeem(shares);
        vm.warp(block.timestamp + 7 days + 1);

        uint256 tBefore = usdc.balanceOf(feeTreasury);
        uint256 aBefore = usdc.balanceOf(alice);
        fv.executeRedeem();
        vm.stopPrank();

        assertEq(usdc.balanceOf(feeTreasury) - tBefore, 100e6, "exit fee 1% to treasury");
        assertApproxEqAbs(usdc.balanceOf(alice) - aBefore, 9_900e6, 1, "payout net of exit fee");
    }
}
