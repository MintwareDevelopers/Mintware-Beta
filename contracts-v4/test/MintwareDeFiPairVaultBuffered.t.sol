// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}          from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}         from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}               from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}              from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}             from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary}         from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {MintwareDeFiPairVault} from "../src/vaults/MintwareDeFiPairVault.sol";
import {PoolProfile, LockTier} from "../src/vaults/VaultTypes.sol";
import {AaveV3YieldAdapter}    from "../src/vaults/AaveV3YieldAdapter.sol";
import {IYieldAdapter}         from "../src/vaults/IYieldAdapter.sol";
import {IPoolAddressesProvider} from "../src/vaults/aave/IAaveV3.sol";

import {MockERC20}                from "./mocks/MockERC20.sol";
import {MockAavePool, MockAToken} from "./mocks/MockAavePool.sol";
import {TestSwapRouter}           from "./helpers/TestSwapRouter.sol";

/// @notice Focused tests for buffered rehypothecation: idle supply/recall conservation, pro-rata
///         idle redemption, buffer targeting, yield harvest, and the Aave-illiquid revert path.
contract MintwareDeFiPairVaultBufferedTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    address internal provider = makeAddr("provider");
    address internal treasury = makeAddr("treasury");
    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal trader   = makeAddr("trader");

    PoolManager    internal pm;
    TestSwapRouter internal router;
    MintwareDeFiPairVault internal vault;

    MockERC20 internal t0;
    MockERC20 internal t1;
    PoolKey   internal key;

    MockAavePool internal pool;
    MockAToken   internal a0Tok;
    MockAToken   internal a1Tok;
    AaveV3YieldAdapter internal adapter0;
    AaveV3YieldAdapter internal adapter1;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0

    function setUp() public {
        pm     = new PoolManager(address(this));
        router = new TestSwapRouter(IPoolManager(address(pm)));

        MockERC20 tokenA = new MockERC20("Token A", "AAA", 18);
        MockERC20 tokenB = new MockERC20("Token B", "BBB", 18);
        (Currency c0, Currency c1) = address(tokenA) < address(tokenB)
            ? (Currency.wrap(address(tokenA)), Currency.wrap(address(tokenB)))
            : (Currency.wrap(address(tokenB)), Currency.wrap(address(tokenA)));
        t0 = MockERC20(Currency.unwrap(c0));
        t1 = MockERC20(Currency.unwrap(c1));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});

        vault = new MintwareDeFiPairVault(
            address(pm), key, PoolProfile.EMERGING, treasury, provider, address(this)
        );

        pool  = new MockAavePool();
        a0Tok = new MockAToken(address(t0), address(pool));
        a1Tok = new MockAToken(address(t1), address(pool));
        pool.setAToken(address(t0), a0Tok);
        pool.setAToken(address(t1), a1Tok);
        pool.setConfig(address(t0), true, false, false);
        pool.setConfig(address(t1), true, false, false);

        adapter0 = new AaveV3YieldAdapter(
            IPoolAddressesProvider(address(pool)), address(t0), address(a0Tok), address(vault), address(this)
        );
        adapter1 = new AaveV3YieldAdapter(
            IPoolAddressesProvider(address(pool)), address(t1), address(a1Tok), address(vault), address(this)
        );
        vault.setAdapters(IYieldAdapter(address(adapter0)), IYieldAdapter(address(adapter1)));

        vm.prank(provider);
        vault.initializePool(INIT_SQRT_PRICE);

        for (uint256 i; i < 3; i++) {
            address who = [alice, bob, trader][i];
            t0.mint(who, 1e28);
            t1.mint(who, 1e28);
        }
    }

    // ── helpers ────────────────────────────────────────────────────────────
    function _deposit(address who, uint256 a0, uint256 a1, LockTier tier) internal returns (uint256 s) {
        vm.startPrank(who);
        t0.approve(address(vault), a0);
        t1.approve(address(vault), a1);
        s = vault.deposit(a0, a1, 0, tier);
        vm.stopPrank();
    }

    function _fullRedeem(address who, uint256 s) internal returns (uint256 o0, uint256 o1) {
        vm.warp(block.timestamp + 25 hours);
        vm.prank(who);
        vault.requestRedeem(s);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(who);
        (o0, o1) = vault.executeRedeem();
    }

    // ── setAdapters wiring guards ─────────────────────────────────────────────

    function test_setAdapters_is_one_time() public {
        vm.expectRevert(MintwareDeFiPairVault.AdaptersAlreadySet.selector);
        vault.setAdapters(IYieldAdapter(address(adapter0)), IYieldAdapter(address(adapter1)));
    }

    function test_setAdapters_rejects_mismatched_asset() public {
        // Fresh vault (no adapters yet) to exercise the asset-match guard.
        MintwareDeFiPairVault v2 = new MintwareDeFiPairVault(
            address(pm), key, PoolProfile.EMERGING, treasury, provider, address(this)
        );
        // adapter0 idles t0, adapter1 idles t1 — swapping them mismatches the asset() self-report.
        vm.expectRevert(MintwareDeFiPairVault.AdapterAssetMismatch.selector);
        v2.setAdapters(IYieldAdapter(address(adapter1)), IYieldAdapter(address(adapter0)));
    }

    function test_setBufferRatio_bounds() public {
        vm.expectRevert(MintwareDeFiPairVault.BadBufferRatio.selector);
        vault.setBufferRatio(10_001);
        vault.setBufferRatio(4_000);
        assertEq(vault.bufferRatioBps(), 4_000);
    }

    // ── supplyIdle: exact principal + liquidity move ─────────────────────────

    function test_supplyIdle_moves_exact_principal_and_liquidity() public {
        _deposit(alice, 100_000e18, 100_000e18, LockTier.Flex);
        uint128 pos0 = vault.positionLiquidity();

        uint128 dl = pos0 / 2;
        vm.prank(provider);
        vault.supplyIdle(dl);

        assertEq(vault.idleLiquidity(), dl, "idleLiquidity == removed liquidity units");
        assertEq(vault.positionLiquidity(), pos0 - dl, "position reduced by exactly dl");
        // Settled counters equal what the adapter now holds (no yield yet).
        assertEq(adapter0.totalAssets(), vault.idle0(), "adapter0 principal == idle0");
        assertEq(adapter1.totalAssets(), vault.idle1(), "adapter1 principal == idle1");
        assertGt(vault.idle0(), 0, "t0 idled");
        assertGt(vault.idle1(), 0, "t1 idled");

        // On-chain pool position matches the tracked pooled units.
        (uint128 onchain,,) = IPoolManager(address(pm)).getPositionInfo(key.toId(), address(vault), vault.tickLower(), vault.tickUpper(), bytes32(0));
        assertEq(uint256(onchain), uint256(vault.positionLiquidity()), "pool position == positionLiquidity");
    }

    // ── idle round-trip conservation ─────────────────────────────────────────

    function testFuzz_idle_roundtrip_conserves(uint256 fracBps) public {
        _deposit(alice, 500_000e18, 500_000e18, LockTier.Flex);
        uint128 pos0 = vault.positionLiquidity();
        fracBps = bound(fracBps, 100, 10_000); // 1%..100% of the position
        uint128 dl = uint128((uint256(pos0) * fracBps) / 10_000);
        if (dl == 0) return;

        vm.prank(provider);
        vault.supplyIdle(dl);
        assertEq(vault.idleLiquidity(), dl, "supply moved exact dl");

        vm.prank(provider);
        vault.recallIdle(dl);

        // Managed liquidity is conserved EXACTLY across the round-trip (every supply/refill move is
        // equal-and-opposite on positionLiquidity vs idleLiquidity).
        assertEq(
            uint256(vault.positionLiquidity()) + uint256(vault.idleLiquidity()),
            uint256(pos0),
            "managed liquidity conserved exactly"
        );
        // The refill unwinds all but V4 rounding dust: at least 99.9% of the idled liquidity returns,
        // and whatever residual idle remains is still fully backed by Aave (nothing invented/lost).
        assertLe(uint256(vault.idleLiquidity()), uint256(dl) / 1_000 + 1_000, "idle refilled >= 99.9%");
        assertGe(adapter0.totalAssets(), vault.idle0(), "aave backs residual idle0");
        assertGe(adapter1.totalAssets(), vault.idle1(), "aave backs residual idle1");
    }

    // ── redeem returns idle pro-rata ──────────────────────────────────────────

    function test_redeem_returns_idle_pro_rata() public {
        uint256 sa = _deposit(alice, 200_000e18, 200_000e18, LockTier.Flex);
        _deposit(bob, 200_000e18, 200_000e18, LockTier.Flex);

        // Idle 40% of the position.
        vm.prank(provider);
        vault.supplyIdle((vault.positionLiquidity() * 4) / 10);
        uint256 idle0Before = vault.idle0();
        uint256 idle1Before = vault.idle1();
        assertGt(idle0Before, 0, "idle present");

        // Alice (half the shares) redeems fully → she should pull ~half the idle leg too.
        (uint256 o0, uint256 o1) = _fullRedeem(alice, sa);
        assertGt(o0, 0, "t0 out");
        assertGt(o1, 0, "t1 out");

        // Idle counters dropped by ~alice's share (≈ half). Remaining idle still backs bob.
        assertApproxEqRel(vault.idle0(), idle0Before / 2, 0.02e18, "idle0 halved");
        assertApproxEqRel(vault.idle1(), idle1Before / 2, 0.02e18, "idle1 halved");
        assertGe(adapter0.totalAssets(), vault.idle0(), "aave still backs idle0");
        assertGe(adapter1.totalAssets(), vault.idle1(), "aave still backs idle1");
    }

    // ── no value creation across the idle leg ─────────────────────────────────

    function testFuzz_deposit_redeem_no_value_creation(uint256 amt, uint256 bufBps) public {
        amt = bound(amt, 1e18, 1_000_000e18);
        bufBps = bound(bufBps, 0, 10_000);

        uint256 before0 = t0.balanceOf(alice);
        uint256 before1 = t1.balanceOf(alice);
        uint256 s = _deposit(alice, amt, amt, LockTier.Flex);
        uint256 used0 = before0 - t0.balanceOf(alice);
        uint256 used1 = before1 - t1.balanceOf(alice);

        // Route capital through Aave and back to exercise the idle path in the round-trip.
        vault.setBufferRatio(bufBps);
        vm.prank(provider);
        vault.rebalanceBuffer();

        (uint256 o0, uint256 o1) = _fullRedeem(alice, s);

        // A same-price deposit→redeem (no swaps, no yield) can NEVER return more than contributed,
        // per token — rounding is always against the redeemer.
        assertLe(o0, used0, "t0 out <= contributed");
        assertLe(o1, used1, "t1 out <= contributed");
    }

    // ── buffer targeting ──────────────────────────────────────────────────────

    function test_rebalanceBuffer_moves_toward_target_and_is_idempotent() public {
        _deposit(alice, 300_000e18, 300_000e18, LockTier.Flex);
        uint256 managed = vault.totalManagedLiquidity();

        vault.setBufferRatio(6_000); // keep 60% pooled
        vm.prank(provider);
        vault.rebalanceBuffer();

        // ~40% of managed liquidity is now idled.
        assertApproxEqRel(uint256(vault.idleLiquidity()), (managed * 4_000) / 10_000, 0.001e18, "idled ~40%");
        assertApproxEqRel(uint256(vault.positionLiquidity()), (managed * 6_000) / 10_000, 0.001e18, "pooled ~60%");
        assertEq(vault.totalManagedLiquidity(), managed, "managed liquidity conserved");

        // Second call at the same target is a no-op.
        uint128 idleAfter = vault.idleLiquidity();
        vm.prank(provider);
        vault.rebalanceBuffer();
        assertEq(vault.idleLiquidity(), idleAfter, "idempotent at target");
    }

    function test_rebalanceBuffer_refills_when_target_raised() public {
        _deposit(alice, 300_000e18, 300_000e18, LockTier.Flex);
        vault.setBufferRatio(4_000); // idle 60%
        vm.prank(provider);
        vault.rebalanceBuffer();
        uint128 idledLots = vault.idleLiquidity();
        assertGt(idledLots, 0, "idled");

        // Raise the hot target → some idle must come back.
        vault.setBufferRatio(9_000); // idle only 10%
        vm.prank(provider);
        vault.rebalanceBuffer();
        assertLt(vault.idleLiquidity(), idledLots, "idle reduced after refill");
    }

    // ── yield harvest keeps idle principal out of share math ──────────────────

    function test_harvest_distributes_yield_and_keeps_idle_principal() public {
        _deposit(alice, 200_000e18, 200_000e18, LockTier.Flex);
        vm.prank(provider);
        vault.supplyIdle((vault.positionLiquidity() * 5) / 10);
        uint256 idle0Before = vault.idle0();
        uint256 idle1Before = vault.idle1();
        assertGt(idle0Before, 0, "idle present");

        // Simulate Aave supply yield: extra aTokens backed by pre-funded underlying.
        uint256 yield0 = 1_000e18;
        uint256 yield1 = 800e18;
        t0.mint(address(a0Tok), yield0);
        t1.mint(address(a1Tok), yield1);
        a0Tok.simulateYield(address(adapter0), yield0);
        a1Tok.simulateYield(address(adapter1), yield1);

        (uint256 ap0Before,) = vault.pendingFees(alice);
        uint256 treas0Before = t0.balanceOf(treasury);

        vm.prank(provider);
        vault.harvestYield();

        // Settled idle principal is UNCHANGED — only the yield surplus was pulled.
        assertEq(vault.idle0(), idle0Before, "idle0 principal untouched");
        assertEq(vault.idle1(), idle1Before, "idle1 principal untouched");
        assertEq(adapter0.totalAssets(), idle0Before, "adapter0 back to principal");
        assertEq(adapter1.totalAssets(), idle1Before, "adapter1 back to principal");

        // Mintware cut taken; LP fees now claimable via the accumulator.
        assertGt(t0.balanceOf(treasury) - treas0Before, 0, "mintware cut on yield");
        (uint256 ap0After, uint256 ap1After) = vault.pendingFees(alice);
        assertGt(ap0After, ap0Before, "alice t0 yield accrued");
        assertGt(ap1After, 0, "alice t1 yield accrued");

        uint256 bal0 = t0.balanceOf(alice);
        vm.prank(alice);
        vault.claimFees();
        assertGt(t0.balanceOf(alice) - bal0, 0, "alice claimed yield");
    }

    // ── redeem reverts if Aave cannot return the idle slice ───────────────────

    function test_redeem_reverts_when_aave_illiquid() public {
        uint256 s = _deposit(alice, 100_000e18, 100_000e18, LockTier.Flex);
        vm.prank(provider);
        vault.supplyIdle((vault.positionLiquidity() * 5) / 10);
        assertGt(vault.idle0(), 0, "idle present");

        // Pause the reserve → adapter.withdraw best-efforts to 0 → redeem must revert, not short-pay.
        pool.setConfig(address(t0), true, false, true);

        vm.warp(block.timestamp + 25 hours);
        vm.prank(alice);
        vault.requestRedeem(s);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(alice);
        vm.expectRevert(MintwareDeFiPairVault.AaveTemporarilyIlliquid.selector);
        vault.executeRedeem();
    }
}
