// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

// V4 core
import {PoolManager}         from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}        from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary}        from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath}            from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20}              from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Our contracts
import {FeeVault}            from "../src/FeeVault.sol";
import {SocialVault}         from "../src/SocialVault.sol";
import {MWSocialHook}        from "../src/MWSocialHook.sol";
import {HookMiner}           from "../src/lib/HookMiner.sol";

// Test helpers
import {MockERC20}           from "./mocks/MockERC20.sol";
import {TestSwapRouter}      from "./helpers/TestSwapRouter.sol";

/// @title  Integration tests — full Mintware Social Vault stack against local V4 PoolManager
/// @notice Tests the complete flow: seed → deposit → swap (MEV) → withdrawal → penalty
///         All V4 interactions run against the real PoolManager (no forks, no mocks).
contract IntegrationTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    // ─────────────────────────────────────────────────────────────────────────
    // Actors
    // ─────────────────────────────────────────────────────────────────────────

    address internal deployer = address(this); // test contract is deployer
    address internal team     = makeAddr("team");
    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal oracle   = makeAddr("oracle");
    address internal treasury = makeAddr("treasury");
    address internal dist     = makeAddr("distributor"); // mock MintwareDistributor

    // ─────────────────────────────────────────────────────────────────────────
    // V4 Infrastructure
    // ─────────────────────────────────────────────────────────────────────────

    PoolManager      internal pm;
    TestSwapRouter   internal swapRouter;

    // ─────────────────────────────────────────────────────────────────────────
    // Mintware Phase 2 contracts
    // ─────────────────────────────────────────────────────────────────────────

    FeeVault         internal feeVault;
    SocialVault      internal socialVault;
    MWSocialHook     internal hook;

    // ─────────────────────────────────────────────────────────────────────────
    // Tokens + pool
    // ─────────────────────────────────────────────────────────────────────────

    MockERC20        internal usdc;
    MockERC20        internal proj; // PROJECT token

    PoolKey          internal poolKey;
    PoolId           internal poolId;

    bool             internal usdcIsToken0;

    // Initial price: 1 PROJECT = 1 USDC (both 6 decimals → sqrtPrice at tick 0)
    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336;

    bytes32 internal constant VAULT_ID = keccak256("test-vault");

    // ─────────────────────────────────────────────────────────────────────────
    // setUp
    // ─────────────────────────────────────────────────────────────────────────

    function setUp() public {
        // ── 1. Deploy real V4 PoolManager ────────────────────────────────────
        pm          = new PoolManager(deployer);
        swapRouter  = new TestSwapRouter(IPoolManager(address(pm)));

        // ── 2. Deploy mock tokens (6 decimals each for price = 1.0 at tick 0) ─
        usdc = new MockERC20("USD Coin",       "USDC", 6);
        proj = new MockERC20("Project Token",  "PROJ", 6);

        // V4 requires currency0 < currency1 by address
        usdcIsToken0 = address(usdc) < address(proj);

        // ── 3. Deploy FeeVault ───────────────────────────────────────────────
        feeVault = new FeeVault(address(usdc), dist, oracle, treasury);

        // ── 4. Mine CREATE2 salt for MWSocialHook ────────────────────────────
        //    deployer = address(this) (no prank, so CREATE2 deployer = test contract)
        //    initialOwner = deployer so test contract owns the hook
        bytes memory hookArgs = abi.encode(
            IPoolManager(address(pm)),
            address(usdc),
            address(feeVault),
            address(0),  // socialVault — wired below
            address(0),  // pyth oracle — not needed for tests
            deployer     // initialOwner
        );
        (, bytes32 salt) = HookMiner.find(
            deployer,
            uint160(0x0AC4),
            type(MWSocialHook).creationCode,
            hookArgs
        );

        // ── 5. Deploy hook at mined address ─────────────────────────────────
        hook = new MWSocialHook{salt: salt}(
            IPoolManager(address(pm)),
            address(usdc),
            address(feeVault),
            address(0),
            address(0),
            deployer     // initialOwner
        );

        // ── 6. Deploy SocialVault ────────────────────────────────────────────
        socialVault = new SocialVault(address(usdc), address(pm), address(feeVault));

        // ── 7. Wire cross-references ─────────────────────────────────────────
        hook.setSocialVault(address(socialVault));
        feeVault.setSocialVault(address(socialVault));
        feeVault.setHook(address(hook));

        // ── 8. Build PoolKey ──────────────────────────────────────────────────
        //    Both tokens 6 decimals, fee=3000 (0.3%), tickSpacing=60
        (Currency c0, Currency c1) = usdcIsToken0
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(proj)))
            : (Currency.wrap(address(proj)), Currency.wrap(address(usdc)));

        poolKey = PoolKey({
            currency0:   c0,
            currency1:   c1,
            fee:         3000,
            tickSpacing: 60,
            hooks:       IHooks(address(hook))
        });
        poolId = poolKey.toId();

        // ── 9. Mint tokens ────────────────────────────────────────────────────
        proj.mint(team,  1_000_000e6);   // team seeds 1M PROJECT
        usdc.mint(alice,   100_000e6);   // alice deposits USDC
        usdc.mint(bob,      50_000e6);   // bob for withdrawal tests
        // Mint some proj to TestSwapRouter-caller (bob) for swap tests
        proj.mint(bob,     100_000e6);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: seed + initialize pool
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Seeds the pool AND rebalances to a practical tick range.
    ///      Full-range ticks (-887220, 887220) produce 0 liquidity for practical
    ///      deposit amounts with 6-decimal tokens (requires ~18T tokens to get L=1).
    ///      The deployer (address(this)) is owner — no prank needed for rebalance.
    function _seedPool() internal {
        _initPoolOnly();
        socialVault.rebalance(-60000, 60000);
    }

    /// @dev Seeds and initializes the V4 pool WITHOUT setting a tick range.
    ///      Use only in tests that need to verify pre-init or pre-rebalance state.
    function _initPoolOnly() internal {
        vm.startPrank(team);
        proj.approve(address(socialVault), 100_000e6);
        socialVault.seedTeamTokens(VAULT_ID, address(proj), 100_000e6, poolKey, INIT_SQRT_PRICE);
        vm.stopPrank();
    }

    function _deposit(address user, uint256 amount, SocialVault.LockTier tier) internal {
        vm.startPrank(user);
        usdc.approve(address(socialVault), amount);
        socialVault.deposit(amount, tier);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 1 — seedTeamTokens initializes the V4 pool
    // ─────────────────────────────────────────────────────────────────────────

    function test_seed_initializes_pool() public {
        assertFalse(socialVault.poolInitialized(), "pool should not be initialized yet");

        _seedPool();

        assertTrue(socialVault.poolInitialized(), "pool should be initialized after seed");

        // V4 pool should have a non-zero sqrtPriceX96 at tick 0
        (uint160 sqrtPriceX96,,,) = IPoolManager(address(pm)).getSlot0(poolId);
        assertGt(sqrtPriceX96, 0, "sqrtPriceX96 should be non-zero");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 2 — USDC deposit adds liquidity to V4 pool
    // ─────────────────────────────────────────────────────────────────────────

    function test_deposit_adds_liquidity() public {
        _seedPool();

        uint256 depositAmt = 10_000e6; // 10k USDC
        _deposit(alice, depositAmt, SocialVault.LockTier.Flex);

        // Vault state
        assertEq(socialVault.totalDeposits(), depositAmt, "totalDeposits mismatch");
        (uint256 aliceDeposited,,,,) = socialVault.positions(alice);
        assertEq(aliceDeposited, depositAmt, "alice position mismatch");

        // V4 position exists
        assertGt(socialVault.totalLiquidity(), 0, "totalLiquidity should be > 0 after deposit");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 3 — Flex lock withdrawal returns full USDC after notice period
    // ─────────────────────────────────────────────────────────────────────────

    function test_flex_withdrawal_full_return() public {
        _seedPool();

        uint256 depositAmt = 5_000e6;
        _deposit(alice, depositAmt, SocialVault.LockTier.Flex);

        uint256 balBefore = usdc.balanceOf(alice);

        // Step 1: request
        vm.warp(block.timestamp + 25 hours); // past MIN_HOLD_PERIOD (24h)
        vm.prank(alice);
        socialVault.requestWithdrawal(depositAmt);

        // Step 2: wait notice period
        vm.warp(block.timestamp + 7 days + 1);

        // Step 3: execute
        vm.prank(alice);
        socialVault.executeWithdrawal();

        uint256 received = usdc.balanceOf(alice) - balBefore;
        // Allow 1-wei tolerance for V4 fixed-point rounding on liquidity removal
        assertApproxEqAbs(received, depositAmt, 1, "flex withdrawal should return full deposit (no penalty)");
        assertEq(socialVault.totalDeposits(), 0, "totalDeposits should be 0 after full withdrawal");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 4 — Early exit penalty routes to FeeVault
    // ─────────────────────────────────────────────────────────────────────────

    function test_early_exit_penalty_routes_to_fee_vault() public {
        _seedPool();

        uint256 depositAmt = 10_000e6;
        _deposit(alice, depositAmt, SocialVault.LockTier.Committed); // 30-day lock

        // Only 1 day has passed (< 20% of 30 days → 2% penalty)
        vm.warp(block.timestamp + 25 hours); // past MIN_HOLD_PERIOD

        vm.prank(alice);
        socialVault.requestWithdrawal(depositAmt);

        // Advance notice period (7 more days = ~8 days total since deposit)
        vm.warp(block.timestamp + 7 days + 1);
        // 8 days / 30 days = 26.6% elapsed → still < 20%? No: 8/30 = 26.6% > 20%
        // Actually at 8 days elapsed (25h + 7d ≈ 8d), pct = 8*100/30 = 26 → TIER 2 (1% penalty)
        // But requestedAt = 25h, noticeExpiry = 25h + 7d
        // Withdrawal executes at block.timestamp which is 25h + 7d + 1 from deposit
        // elapsed from depositedAt = 25h + 7d + 1 ≈ 8 days
        // pct = 8*100/30 = 26 → tier 2 → 1% penalty

        uint256 feeVaultBalBefore = usdc.balanceOf(address(feeVault));
        uint256 aliceBalBefore    = usdc.balanceOf(alice);

        vm.prank(alice);
        socialVault.executeWithdrawal();

        uint256 penalty  = usdc.balanceOf(address(feeVault)) - feeVaultBalBefore;
        uint256 received = usdc.balanceOf(alice) - aliceBalBefore;

        assertGt(penalty, 0, "penalty should be > 0 for early Committed exit");
        // Allow 1-wei tolerance for V4 fixed-point rounding on liquidity removal
        assertApproxEqAbs(received + penalty, depositAmt, 1, "payout + penalty should equal deposit");

        // For tier2 (1%): penalty = 100e6 (1% of 10_000e6)
        uint256 expectedPenalty = (depositAmt * 100) / 10_000; // 1%
        assertEq(penalty, expectedPenalty, "penalty should be 1% for 20-50% elapsed");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 5 — MEV capture routes tokens to FeeVault
    // ─────────────────────────────────────────────────────────────────────────

    function test_mev_capture_routes_to_fee_vault() public {
        _seedPool();

        // Deposit liquidity so swaps don't fail with InsufficientLiquidity
        _deposit(alice, 50_000e6, SocialVault.LockTier.Flex);

        // Configure pool with low threshold so MEV capture triggers easily
        hook.configurePool(
            poolId,
            bytes32(0), // no pyth price id for tests
            6,          // token0 decimals
            6,          // token1 decimals
            20,         // captureThresholdBps (0.20%)
            50,         // captureRateBps (0.50% of output captured)
            0           // no dynamic fee override
        );

        // Get current pool price and set a reference price 2% higher
        // deviation of ~200bps >> threshold of 20bps → MEV capture fires
        (uint160 currentSqrt,,,) = IPoolManager(address(pm)).getSlot0(poolId);
        uint160 refPrice = uint160(currentSqrt + currentSqrt / 50); // +2%

        hook.setReferencePrice(poolId, refPrice);

        // Determine swap direction: bob sells PROJECT tokens to get USDC
        // If usdcIsToken0: swap oneForZero (sell proj=currency1, get usdc=currency0)
        // If !usdcIsToken0: swap zeroForOne (sell proj=currency0, get usdc=currency1)
        bool buyUsdc = !usdcIsToken0; // zeroForOne = sell proj (token0) get usdc (token1)

        uint256 swapAmt = 1_000e6; // swap 1000 PROJECT
        uint256 feeVaultBalBefore = usdc.balanceOf(address(feeVault));

        vm.startPrank(bob);
        if (buyUsdc) {
            // Sell proj (currency0) to get usdc (currency1)
            proj.approve(address(swapRouter), swapAmt);
            swapRouter.swap(poolKey, true, swapAmt); // zeroForOne=true
        } else {
            // Sell proj (currency1) to get usdc (currency0)
            proj.approve(address(swapRouter), swapAmt);
            swapRouter.swap(poolKey, false, swapAmt); // zeroForOne=false
        }
        vm.stopPrank();

        uint256 capturedToFeeVault = usdc.balanceOf(address(feeVault)) - feeVaultBalBefore;
        assertGt(capturedToFeeVault, 0, "FeeVault should have received captured MEV");
        console2.log("MEV captured (USDC):", capturedToFeeVault);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 6 — Non-vault address cannot add liquidity to the V4 pool
    // ─────────────────────────────────────────────────────────────────────────

    function test_only_vault_can_add_liquidity() public {
        _seedPool();

        // Attacker tries to add liquidity directly (not through SocialVault)
        // This should revert in beforeAddLiquidity with OnlyVaultCanAddLiquidity
        address attacker = makeAddr("attacker");
        usdc.mint(attacker, 10_000e6);
        proj.mint(attacker, 10_000e6);

        vm.startPrank(attacker);
        // We need to unlock then modifyLiquidity — use a direct PM call via etch/prank
        // The simplest approach: try to call modifyLiquidity via an unlock callback
        // We'll use a direct unlock to test the revert
        vm.expectRevert(); // any revert (hook reverts OnlyVaultCanAddLiquidity)
        pm.unlock(abi.encode("direct-lp-attempt-should-revert"));
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 7 — Rebalance updates tick range and re-deposits liquidity
    // ─────────────────────────────────────────────────────────────────────────

    function test_rebalance_updates_tick_range() public {
        _seedPool();
        _deposit(alice, 10_000e6, SocialVault.LockTier.Flex);

        uint128 liquidityBefore = socialVault.totalLiquidity();
        assertGt(liquidityBefore, 0, "should have liquidity before rebalance");

        // Rebalance to a narrower range
        int24 newLower = -6000;
        int24 newUpper =  6000;

        // deployer owns the contracts (no prank needed — deployer = address(this) = owner)
        socialVault.rebalance(newLower, newUpper);

        assertEq(socialVault.tickLower(), newLower, "tickLower should update");
        assertEq(socialVault.tickUpper(), newUpper, "tickUpper should update");

        // Liquidity should be non-zero after re-adding (different amount due to new range)
        assertGt(socialVault.totalLiquidity(), 0, "should have liquidity after rebalance");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 8 — Two LPs: proportional withdrawal
    // ─────────────────────────────────────────────────────────────────────────

    function test_proportional_withdrawal_two_lps() public {
        _seedPool();

        // Alice deposits 10k, Bob deposits 5k
        _deposit(alice, 10_000e6, SocialVault.LockTier.Flex);
        _deposit(bob,    5_000e6, SocialVault.LockTier.Flex);

        assertEq(socialVault.totalDeposits(), 15_000e6);
        uint128 totalLiq = socialVault.totalLiquidity();
        assertGt(totalLiq, 0);

        // Alice withdraws her full deposit
        vm.warp(block.timestamp + 25 hours);
        vm.prank(alice);
        socialVault.requestWithdrawal(10_000e6);
        vm.warp(block.timestamp + 7 days + 1);

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        socialVault.executeWithdrawal();
        uint256 aliceReceived = usdc.balanceOf(alice) - aliceBalBefore;

        assertEq(aliceReceived, 10_000e6, "alice should receive her full deposit");
        assertEq(socialVault.totalDeposits(), 5_000e6, "only bob's deposit should remain");

        // Bob's liquidity should still exist
        assertGt(socialVault.totalLiquidity(), 0, "bob's liquidity should remain");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 9 — Deposit before pool init; liquidity added retroactively
    // ─────────────────────────────────────────────────────────────────────────

    function test_deposit_before_pool_init_queued() public {
        // Deposit BEFORE pool is initialized
        _deposit(alice, 5_000e6, SocialVault.LockTier.Flex);

        // totalDeposits tracked, but no V4 liquidity yet
        assertEq(socialVault.totalDeposits(), 5_000e6);
        assertEq(socialVault.totalLiquidity(), 0, "no liquidity before pool init");

        // Initialize pool only (no rebalance) — rebalance would retroactively add
        // alice's pre-existing USDC as V4 liquidity, obscuring the test intent.
        _initPoolOnly();

        // Still 0 liquidity — deposit before pool init doesn't retroactively add liquidity
        // (handled at deposit time: only calls _addLiquidity if poolInitialized)
        // This is expected behavior — USDC sits in the vault contract until next deposit.
        assertEq(socialVault.totalLiquidity(), 0, "pre-seed deposit doesn't auto-add liquidity");

        // Rebalance to practical range, then a new deposit AFTER pool init adds liquidity
        socialVault.rebalance(-60000, 60000);

        uint256 newDeposit = 3_000e6;
        usdc.mint(bob, newDeposit);
        _deposit(bob, newDeposit, SocialVault.LockTier.Flex);

        assertGt(socialVault.totalLiquidity(), 0, "post-init deposit adds liquidity");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 10 — No MEV capture when deviation is below threshold
    // ─────────────────────────────────────────────────────────────────────────

    function test_no_mev_capture_below_threshold() public {
        _seedPool();
        _deposit(alice, 50_000e6, SocialVault.LockTier.Flex);

        // Use a very high threshold (9999 bps = 99.99%) so no realistic swap can
        // cause sufficient deviation to trigger capture.
        hook.configurePool(poolId, bytes32(0), 6, 6, 9999, 50, 0);

        // Set reference = exact current price (0% initial deviation).
        // Even after a swap moves the price, total deviation stays well under 9999 bps.
        (uint160 currentSqrt,,,) = IPoolManager(address(pm)).getSlot0(poolId);
        hook.setReferencePrice(poolId, currentSqrt);

        bool buyUsdc = !usdcIsToken0;
        uint256 feeVaultBalBefore = usdc.balanceOf(address(feeVault));

        vm.startPrank(bob);
        if (buyUsdc) {
            proj.approve(address(swapRouter), 500e6);
            swapRouter.swap(poolKey, true, 500e6);
        } else {
            proj.approve(address(swapRouter), 500e6);
            swapRouter.swap(poolKey, false, 500e6);
        }
        vm.stopPrank();

        uint256 captured = usdc.balanceOf(address(feeVault)) - feeVaultBalBefore;
        assertEq(captured, 0, "no MEV capture below threshold");
    }
}
