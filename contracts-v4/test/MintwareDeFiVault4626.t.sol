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
import {MWHookCoordinator}       from "../src/hooks/MWHookCoordinator.sol";
import {HookMiner}               from "../src/lib/HookMiner.sol";
import {MintwareDeFiVault4626}   from "../src/vaults/MintwareDeFiVault4626.sol";
import {MintwareBaseVault4626}   from "../src/vaults/MintwareBaseVault4626.sol";
import {VaultSurface, LockTier, VaultConfig, PoolProfile} from "../src/vaults/VaultTypes.sol";

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {MWGuardianPausable} from "../src/lib/MWGuardianPausable.sol";

import {MockERC20} from "./mocks/MockERC20.sol";
import {MockYieldAdapter} from "./mocks/MockYieldAdapter.sol";
import {MockHostileYieldAdapter} from "./mocks/MockHostileYieldAdapter.sol";

/// @notice Integration tests for the Phase-3 ERC-4626 DeFi vault against a real V4 PoolManager.
///         Proves: deposit → shares minted + liquidity deployed → async lock redeem →
///         penalty routing → synchronous-redemption disabled. Mirrors the existing
///         Integration.t.sol harness (real PoolManager, mined MWHookCoordinator).
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
    MWHookCoordinator internal hook;
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

        // Mine + deploy the canonical MWHookCoordinator at an address with the right bits.
        bytes memory hookArgs = abi.encode(IPoolManager(address(pm)), address(0), deployer);
        (, bytes32 salt) = HookMiner.find(
            deployer, uint160(0xAC8), type(MWHookCoordinator).creationCode, hookArgs
        );
        hook = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), address(0), deployer);

        // Deploy the ERC-4626 DeFi vault.
        vault = new MintwareDeFiVault4626(_cfg(0, 0), address(pm), address(feeVault));

        // Wire cross-references (hook gates LP to the vault).
        hook.setVault(address(vault));
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

    /// @dev Allowlist + activate a yield adapter (propose → 48h timelock → confirm → set).
    function _enableAdapter(address adapter) internal {
        vault.proposeAdapter(adapter);
        vm.warp(block.timestamp + vault.ADAPTER_TIMELOCK());
        vault.confirmAdapter(adapter);
        vault.setYieldAdapter(adapter);
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

    // ── D6: instant redemption for unlocked/Flex, async for locked ───────────

    function test_flex_instant_withdraw_after_min_hold() public {
        _seedPool();
        uint256 amount = 5_000e6;
        uint256 shares = _deposit(alice, amount, LockTier.Flex);

        // Not instant-eligible during the 24h anti-JIT window.
        assertEq(vault.maxRedeem(alice), 0, "not instant before min-hold");

        vm.warp(block.timestamp + 25 hours);
        assertEq(vault.maxRedeem(alice), shares, "instant-eligible after 24h");

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice); // instant — no 7-day notice
        assertApproxEqAbs(usdc.balanceOf(alice) - balBefore, amount, 1, "instant redeem returns principal");
        assertEq(vault.balanceOf(alice), 0, "shares burned");
    }

    function test_locked_tier_cannot_instant_withdraw() public {
        _seedPool();
        uint256 shares = _deposit(alice, 10_000e6, LockTier.Committed); // 30-day lock
        vm.warp(block.timestamp + 25 hours); // past min-hold but still locked

        assertEq(vault.maxRedeem(alice), 0, "locked - not instant-eligible");
        vm.prank(alice);
        vm.expectRevert(MintwareBaseVault4626.SynchronousRedemptionDisabled.selector);
        vault.redeem(shares, alice, alice);
    }

    function test_expired_lock_can_instant_withdraw() public {
        _seedPool();
        uint256 shares = _deposit(alice, 10_000e6, LockTier.Committed);
        vm.warp(block.timestamp + 31 days); // past the 30-day lock → unlocked, no penalty

        assertEq(vault.maxRedeem(alice), shares, "expired lock - instant-eligible");
        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);
        assertApproxEqAbs(usdc.balanceOf(alice) - balBefore, 10_000e6, 1, "full principal, no penalty");
        assertEq(vault.balanceOf(alice), 0, "shares burned");
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

    // ── Track A4: idle-capital routing ───────────────────────────────────────

    function test_idle_reduces_deployed_liquidity_to_40pct() public {
        // Single-sided LP at a straddling range doesn't consume a clean USDC amount, but
        // deployed liquidity is LINEAR in the input, so a 60%-idle deposit deploys ~40% of
        // the liquidity a full deposit would (price is static across single-sided adds).
        _seedPool();
        _deposit(alice, 10_000e6, LockTier.Flex); // idle off
        uint128 lFull = vault.totalLiquidity();
        assertGt(lFull, 0, "full deposit deploys liquidity");

        vault.setIdleConfig(true, 6_000); // 60% reserve
        _deposit(bob, 10_000e6, LockTier.Flex); // idle on
        uint128 lIdle = vault.totalLiquidity() - lFull; // incremental from bob's deposit

        assertApproxEqRel(uint256(lIdle), (uint256(lFull) * 40) / 100, 0.01e18, "idle deploys ~40%");
        assertEq(vault.totalPrincipal(), 20_000e6, "principal counts both deposits fully");
        assertGt(vault.idleReserve(), 0, "idle reserve accumulates");
    }

    function test_route_and_harvest_yield_splits_70_30() public {
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        _seedPool();
        vault.setIdleConfig(true, 6_000);
        _enableAdapter(address(adapter));

        _deposit(alice, 10_000e6, LockTier.Flex); // 6_000 reserve in vault
        vault.routeIdleToYield(6_000e6);
        assertEq(adapter.totalAssets(), 6_000e6, "reserve routed to adapter");
        assertEq(vault.principalInAdapter(), 6_000e6);

        // Simulate 600 USDC of yield accruing in the adapter.
        usdc.mint(address(adapter), 600e6);

        uint256 fBefore = usdc.balanceOf(address(feeVault));
        uint256 tBefore = usdc.balanceOf(feeTreasury); // setUp vault's treasury == feeTreasury
        uint256 yield = vault.harvestYield();

        assertEq(yield, 600e6, "yield = balance above principal");
        assertEq(usdc.balanceOf(address(feeVault)) - fBefore, 420e6, "70% depositors -> FeeVault");
        assertEq(usdc.balanceOf(feeTreasury) - tBefore, 180e6, "30% Mintware -> treasury");
        assertEq(vault.principalInAdapter(), 6_000e6, "principal untouched by harvest");
    }

    function test_harvest_no_yield_returns_zero() public {
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        _enableAdapter(address(adapter));
        assertEq(vault.harvestYield(), 0, "no yield");
    }

    function test_setIdleConfig_rejects_ratio_over_100pct() public {
        vm.expectRevert(MintwareDeFiVault4626.RatioTooHigh.selector);
        vault.setIdleConfig(true, 10_001);
    }

    function test_routeIdleToYield_requires_enabled() public {
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        _enableAdapter(address(adapter));
        vm.expectRevert(MintwareDeFiVault4626.IdleNotEnabled.selector);
        vault.routeIdleToYield(1e6);
    }

    // ── Stage 1.1: adapter allowlist + 48h timelock ──────────────────────────

    function test_setYieldAdapter_rejects_non_allowlisted() public {
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        vm.expectRevert(MintwareDeFiVault4626.AdapterNotAllowed.selector);
        vault.setYieldAdapter(address(adapter));
    }

    function test_confirmAdapter_reverts_before_timelock() public {
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        vault.proposeAdapter(address(adapter));
        vm.warp(block.timestamp + vault.ADAPTER_TIMELOCK() - 1);
        vm.expectRevert(MintwareDeFiVault4626.AdapterTimelockPending.selector);
        vault.confirmAdapter(address(adapter));
    }

    function test_confirmAdapter_reverts_if_not_proposed() public {
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        vm.expectRevert(MintwareDeFiVault4626.AdapterNotProposed.selector);
        vault.confirmAdapter(address(adapter));
    }

    function test_revoked_adapter_cannot_receive_routing() public {
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        _seedPool();
        vault.setIdleConfig(true, 6_000);
        _enableAdapter(address(adapter));
        _deposit(alice, 10_000e6, LockTier.Flex);

        vault.revokeAdapter(address(adapter));
        vm.expectRevert(MintwareDeFiVault4626.AdapterNotAllowed.selector);
        vault.routeIdleToYield(1_000e6);
    }

    // ── Stage 1.1: withdrawal-buffer invariant (rehypothecation cap) ──────────

    function test_route_reverts_above_rehypothecation_cap() public {
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        _seedPool();
        vault.setIdleConfig(true, 9_000); // 90% reserve so plenty is idle
        _enableAdapter(address(adapter));
        _deposit(alice, 10_000e6, LockTier.Flex);

        // Default cap = 70% of 10_000 = 7_000. Routing 7_001 must revert.
        vm.expectRevert(MintwareDeFiVault4626.RehypothecationCapExceeded.selector);
        vault.routeIdleToYield(7_001e6);

        // Exactly at the cap is allowed.
        vault.routeIdleToYield(7_000e6);
        assertEq(vault.principalInAdapter(), 7_000e6, "routed up to the cap");
    }

    function test_setRehypothecationCap_hard_ceiling() public {
        vm.expectRevert(MintwareDeFiVault4626.RatioTooHigh.selector);
        vault.setRehypothecationCap(8_001); // > MAX_REHYP_CAP_BPS (80%)
        vault.setRehypothecationCap(5_000);
        assertEq(vault.rehypothecationCapBps(), 5_000, "cap updated");
    }

    // ── Stage 1.1: adapter-trust — post-transfer balance assertions ───────────

    function test_route_reverts_on_short_pulling_adapter() public {
        MockHostileYieldAdapter adapter = new MockHostileYieldAdapter(address(usdc));
        adapter.setDepositShortfall(1e6); // pull 1 USDC less than requested
        _seedPool();
        vault.setIdleConfig(true, 6_000);
        _enableAdapter(address(adapter));
        _deposit(alice, 10_000e6, LockTier.Flex);

        vm.expectRevert(MintwareDeFiVault4626.AdapterTransferMismatch.selector);
        vault.routeIdleToYield(5_000e6);
    }

    function test_harvest_reverts_on_short_sending_adapter() public {
        MockHostileYieldAdapter adapter = new MockHostileYieldAdapter(address(usdc));
        _seedPool();
        vault.setIdleConfig(true, 6_000);
        _enableAdapter(address(adapter));
        _deposit(alice, 10_000e6, LockTier.Flex);
        vault.routeIdleToYield(6_000e6);

        // Real 600 USDC of yield accrues, but the adapter short-sends on withdraw.
        usdc.mint(address(adapter), 600e6);
        adapter.setWithdrawShortfall(1e6); // sends 1 USDC less than requested
        vm.expectRevert(MintwareDeFiVault4626.AdapterTransferMismatch.selector);
        vault.harvestYield();
    }

    // ── Stage 1.4: kill-switch (pause / guardian) ────────────────────────────

    function test_pause_blocks_deposit() public {
        _seedPool();
        vault.pause();
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000e6);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.depositWithLock(1_000e6, alice, LockTier.Flex);
        vm.stopPrank();
    }

    function test_pause_freezes_executeRedeem_but_allows_requestRedeem() public {
        _seedPool();
        uint256 shares = _deposit(alice, 5_000e6, LockTier.Flex);
        vm.warp(block.timestamp + 25 hours);

        vault.pause();

        // requestRedeem stays open during a pause…
        vm.prank(alice);
        vault.requestRedeem(shares);

        // …but the money-out path is frozen.
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.executeRedeem();

        // After unpause, redemption proceeds.
        vault.unpause();
        vm.prank(alice);
        vault.executeRedeem();
        assertEq(vault.balanceOf(alice), 0, "redeemed after unpause");
    }

    function test_pause_blocks_route_but_allows_recall() public {
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        _seedPool();
        vault.setIdleConfig(true, 6_000);
        _enableAdapter(address(adapter));
        _deposit(alice, 10_000e6, LockTier.Flex);
        vault.routeIdleToYield(5_000e6);

        vault.pause();

        // Routing more is frozen…
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.routeIdleToYield(1_000e6);

        // …but recalling capital to safety still works while paused.
        vault.recallIdleFromYield(5_000e6);
        assertEq(vault.principalInAdapter(), 0, "recalled during pause");
    }

    function test_guardian_can_pause_owner_unpauses() public {
        address guardian = makeAddr("guardian");
        vault.setGuardian(guardian);

        vm.prank(guardian);
        vault.pause();
        assertTrue(vault.paused(), "guardian paused");

        // Guardian cannot unpause — owner only.
        vm.prank(guardian);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        vault.unpause();

        vault.unpause();
        assertFalse(vault.paused(), "owner unpaused");
    }

    function test_non_guardian_cannot_pause() public {
        vm.prank(alice);
        vm.expectRevert(MWGuardianPausable.NotGuardianOrOwner.selector);
        vault.pause();
    }
}
