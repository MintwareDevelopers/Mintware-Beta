// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks}   from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}  from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

import {MWFeeHook}     from "../../src/hooks/MWFeeHook.sol";
import {MWFeeHookBase} from "./MWFeeHookBase.t.sol";

/// @notice Property tests for the routable, auto-allowlistable fee-only hook. Proves the four
///         allowlist properties (flags 0xC0, zero-delta/routability, no-hookData, immutability) and
///         fee correctness (volatility rise, directional LVR, rate-limit).
contract MWFeeHookTest is MWFeeHookBase {
    // ── (1) Flags == 0xC0 + permission surface ───────────────────────────────

    function test_flags_are_exactly_0xC0() public view {
        assertEq(hook.HOOK_FLAGS(), uint160(0xC0), "declared flags");
        assertEq(uint160(address(hook)) & 0x3FFF, 0xC0, "address-encoded flags == 0xC0");
    }

    function test_permissions_only_beforeSwap_afterSwap() public view {
        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(p.beforeSwap, "beforeSwap on");
        assertTrue(p.afterSwap,  "afterSwap on");
        // Everything else — especially the return-delta and liquidity bits — must be OFF.
        assertFalse(p.beforeInitialize);
        assertFalse(p.afterInitialize);
        assertFalse(p.beforeAddLiquidity);
        assertFalse(p.afterAddLiquidity);
        assertFalse(p.beforeRemoveLiquidity);
        assertFalse(p.afterRemoveLiquidity);
        assertFalse(p.beforeDonate);
        assertFalse(p.afterDonate);
        assertFalse(p.beforeSwapReturnDelta, "no beforeSwapReturnDelta bit");
        assertFalse(p.afterSwapReturnDelta,  "no afterSwapReturnDelta bit");
        assertFalse(p.afterAddLiquidityReturnDelta);
        assertFalse(p.afterRemoveLiquidityReturnDelta);
    }

    /// @notice The `0xC0` flag bits encode NO liquidity/return-delta/donate/initialize hook, so the
    ///         hook truly carries only the two swap callbacks. Bit-mask the address to prove it.
    function test_no_extra_flag_bits_set() public view {
        uint160 bits = uint160(address(hook)) & 0x3FFF;
        // beforeSwap = bit7 (0x80), afterSwap = bit6 (0x40).
        assertEq(bits & 0x80, 0x80, "beforeSwap bit");
        assertEq(bits & 0x40, 0x40, "afterSwap bit");
        assertEq(bits & ~uint160(0xC0), 0, "no other permission bit set");
    }

    // ── (2) Zero-delta / routability ─────────────────────────────────────────

    /// @notice A router can simulate this pool as "normal AMM + fee": beforeSwap returns a ZERO
    ///         BeforeSwapDelta and only a fee override; afterSwap returns a ZERO int128 delta.
    function test_beforeSwap_returns_zero_delta_and_fee_override() public {
        // Seed the oracle + some deviation so a NON-trivial fee is produced (proving zero-delta even
        // when the fee is dynamic, not just at the base).
        _swap(true, 5_000e18);
        vm.roll(block.number + 1);
        _swap(true, 200_000e18);
        vm.roll(block.number + 1);

        SwapParams memory sp = SwapParams(true, -int256(1_000e18), 0);
        vm.prank(address(pm));
        (bytes4 sel, BeforeSwapDelta bsd, uint24 fee) = hook.beforeSwap(trader, poolKey, sp, "");

        assertEq(sel, IHooks.beforeSwap.selector, "selector");
        assertEq(BeforeSwapDelta.unwrap(bsd), BeforeSwapDelta.unwrap(toBeforeSwapDelta(0, 0)), "ZERO before-swap delta");
        assertTrue(fee & LPFeeLibrary.OVERRIDE_FEE_FLAG != 0, "fee carries the OVERRIDE flag");
        uint24 rawFee = fee & ~LPFeeLibrary.OVERRIDE_FEE_FLAG;
        assertLe(rawFee, hook.MAX_FEE_PIPS(), "fee within cap");
    }

    function test_afterSwap_returns_zero_delta() public {
        SwapParams memory sp = SwapParams(true, -int256(1_000e18), 0);
        vm.prank(address(pm));
        (bytes4 sel, int128 d) = hook.afterSwap(trader, poolKey, sp, BalanceDelta.wrap(0), "");
        assertEq(sel, IHooks.afterSwap.selector, "selector");
        assertEq(d, int128(0), "ZERO after-swap delta");
    }

    /// @notice A REAL swap through the PoolManager on the dynamic-fee pool succeeds and moves no value
    ///         to the hook (the hook holds no token balance) — i.e. it only priced the swap, took nothing.
    function test_real_swap_leaves_hook_balanceless() public {
        _swap(true, 10_000e18);
        _swap(false, 8_000e18);
        assertEq(t0.balanceOf(address(hook)), 0, "hook holds no token0");
        assertEq(t1.balanceOf(address(hook)), 0, "hook holds no token1");
    }

    /// @notice The fee quote is a deterministic function of (tick, oracle, direction): identical pool
    ///         state ⇒ identical quote across calls. This is what lets an aggregator price the pool.
    function test_quote_is_deterministic_given_state() public {
        _swap(true, 5_000e18);
        vm.roll(block.number + 1);
        _swap(true, 150_000e18);

        uint24 q1 = hook.quoteFee(poolId, true);
        uint24 q2 = hook.quoteFee(poolId, true);
        assertEq(q1, q2, "same state => same quote");
    }

    // ── (3) no hookData dependency ───────────────────────────────────────────

    /// @notice The fee is identical whether hookData is empty or arbitrary garbage — the hook never
    ///         reads caller-supplied bytes. (Aggregators pass no hookData; a malicious one is inert.)
    function test_fee_independent_of_hookData() public {
        _swap(true, 5_000e18);
        vm.roll(block.number + 1);
        _swap(true, 150_000e18);
        vm.roll(block.number + 1);

        SwapParams memory sp = SwapParams(true, -int256(1_000e18), 0);

        uint256 s = vm.snapshotState();
        vm.prank(address(pm));
        (, , uint24 feeEmpty) = hook.beforeSwap(trader, poolKey, sp, "");
        vm.revertToState(s);
        vm.prank(address(pm));
        (, , uint24 feeGarbage) = hook.beforeSwap(trader, poolKey, sp, hex"deadbeefcafef00dba5eba11");
        assertEq(feeEmpty, feeGarbage, "hookData must not change the fee");
    }

    // ── (4) fee correctness ──────────────────────────────────────────────────

    /// @notice The dynamic fee RISES with volatility (deviation from the truncated oracle). The fee is
    ///         priced on the PRE-swap deviation, so the swap that pushes price is itself ~base and the
    ///         elevated fee lands on the next swap, once the truncated oracle lags behind the new spot.
    ///         Isolated on a fresh guard-off / LVR-off pool so only the symmetric volatility term acts.
    function test_fee_rises_with_volatility() public {
        MWFeeHook h = _deployHook(3000, 200000, /*slope*/ 100, 0, 0, 0, 0, false, 60, 0, 10);
        PoolKey memory k = PoolKey({
            currency0: poolKey.currency0, currency1: poolKey.currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: IHooks(address(h))
        });
        pm.initialize(k, INIT_SQRT_PRICE);
        vm.startPrank(lp);
        lpRouter.modifyLiquidity(k, _lpParams(), "");
        vm.stopPrank();

        // Calm: first swap seeds the oracle at ~spot (priced at base).
        _swapKey(k, true, 5_000e18);
        uint24 calm = h.lastFee(k.toId());

        // Push spot far in a new block (this swap still prices at ~base — pre-swap dev ~0).
        vm.roll(block.number + 1);
        _swapKey(k, true, 600_000e18);
        // Next block: a small swap now sees the large standing deviation ⇒ elevated fee.
        vm.roll(block.number + 1);
        _swapKey(k, true, 1_000e18);
        uint24 volatile_ = h.lastFee(k.toId());

        assertApproxEqAbs(calm, uint24(3000), 200, "calm swap prices near base");
        assertGt(volatile_, calm, "fee rises with deviation");
        assertLe(volatile_, uint24(200000), "fee never exceeds cap");
    }

    /// @notice The Diamond-LVR surcharge is DIRECTIONAL: only the gap-closing (arb) swap pays it;
    ///         benign, gap-widening flow pays the symmetric volatility fee.
    function test_lvr_surcharge_is_directional() public {
        // Push spot far BELOW the oracle within one block (oracle truncates/lags).
        _swap(true, 5_000e18);
        vm.roll(block.number + 1);
        _swap(true, 300_000e18);

        int24 cur = _tick();
        (int24 oTick,) = hook.oracleTick(poolId);
        assertLt(cur, oTick, "spot pushed below oracle");
        // spot < oracle ⇒ ARB (gap-closing) = buy up = !zeroForOne; BENIGN = sell down = zeroForOne.

        uint256 s = vm.snapshotState();
        _swap(true, 1_000e18);            // benign direction
        uint24 benign = hook.lastFee(poolId);
        vm.revertToState(s);
        _swap(false, 1_000e18);           // arb / gap-closing direction
        uint24 arb = hook.lastFee(poolId);

        assertGt(arb, benign, "arb (gap-closing) swap pays the LVR surcharge");
    }

    /// @notice Even an absurd LVR slope can never push the applied fee past the pool's cap.
    function test_fee_clamped_to_cap() public {
        MWFeeHook capped = _deployHook(3000, 10000, 5, 0, 0, 1_000_000, 1_000_000, false, 60, 0, 10); // cap 1%
        // Re-point a fresh dynamic-fee pool at the capped hook.
        PoolKey memory k = PoolKey({
            currency0: poolKey.currency0, currency1: poolKey.currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: IHooks(address(capped))
        });
        pm.initialize(k, INIT_SQRT_PRICE);
        vm.startPrank(lp);
        // (approvals already set on lpRouter in setUp)
        lpRouter.modifyLiquidity(k, _lpParams(), "");
        vm.stopPrank();

        _swapKey(k, true, 5_000e18);
        vm.roll(block.number + 1);
        _swapKey(k, true, 300_000e18);   // spot below oracle
        _swapKey(k, false, 1_000e18);    // arb direction, huge surcharge → must clamp
        assertLe(capped.lastFee(k.toId()), uint24(10000), "applied fee clamped to MAX_FEE_PIPS");
    }

    /// @notice The per-block fee rate-limit clamps how far the fee can move in one block.
    function test_rate_limit_clamps_per_block_move() public {
        MWFeeHook limited = _deployHook(3000, 200000, 100, 0, /*feeStep*/ 500, 0, 0, false, 60, 0, 10);
        PoolKey memory k = PoolKey({
            currency0: poolKey.currency0, currency1: poolKey.currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: IHooks(address(limited))
        });
        pm.initialize(k, INIT_SQRT_PRICE);
        vm.startPrank(lp);
        lpRouter.modifyLiquidity(k, _lpParams(), "");
        vm.stopPrank();

        vm.roll(2000);
        _swapKey(k, true, 5_000e18);       // seeds lastFee near base (3000)
        uint24 first = limited.lastFee(k.toId());
        vm.roll(2001);
        _swapKey(k, true, 600_000e18);     // pushes spot (still priced ~base: pre-swap dev ~0)
        vm.roll(2002);
        _swapKey(k, true, 1_000e18);       // target fee now spikes, but the move is clamped to +500/block
        uint24 second = limited.lastFee(k.toId());

        assertLe(second, first + 500, "fee move clamped to maxFeeStepPerBlock in one block");
        assertGt(second, first, "fee still moved toward target");
    }

    // ── (5) immutability — no admin/param setters ────────────────────────────

    /// @notice The fee/oracle params are constructor immutables with NO setters. We prove there is no
    ///         owner surface and that common setter selectors simply do not exist (call reverts).
    function test_no_owner_and_no_setters() public {
        // The go-forward coordinator has these admin selectors; the fee hook must have NONE.
        string[7] memory sigs = [
            "setVault(address)",
            "configurePool(bytes32,uint24,uint24,uint256,uint24,bool,bool,int24,int24,uint32)",
            "setLvrParams(bytes32,uint256,uint256,bool)",
            "setJitEnabled(bytes32,bool)",
            "owner()",
            "setGuardian(address)",
            "pause()"
        ];
        for (uint256 i = 0; i < sigs.length; i++) {
            (bool ok,) = address(hook).call(abi.encodeWithSignature(sigs[i]));
            assertFalse(ok, string(abi.encodePacked("selector must not exist: ", sigs[i])));
        }
    }

    /// @notice The immutables echo exactly what the constructor was given (no post-deploy mutation path).
    function test_immutables_are_fixed() public view {
        assertEq(hook.BASE_FEE_PIPS(), BASE_FEE);
        assertEq(hook.MAX_FEE_PIPS(),  MAX_FEE);
        assertEq(hook.SLOPE_PIPS_PER_TICK(), SLOPE);
        assertEq(hook.LVR_SLOPE_PIPS_PER_TICK(), LVR_SLOPE);
        assertEq(hook.MAX_DEVIATION_TICKS(), MAX_DEV);
        assertTrue(hook.GUARD_ENABLED());
    }

    // ── constructor guards ───────────────────────────────────────────────────

    function test_constructor_rejects_bad_fee_config() public {
        vm.expectRevert(MWFeeHook.BadFeeConfig.selector);
        _deployHook(3000, 0, SLOPE, QUAD, FEE_STEP, 0, 0, GUARD, MAX_MOVE, MAX_DEV, CATCHUP); // maxFee == 0
        vm.expectRevert(MWFeeHook.BadFeeConfig.selector);
        _deployHook(200000, 100000, SLOPE, QUAD, FEE_STEP, 0, 0, GUARD, MAX_MOVE, MAX_DEV, CATCHUP); // base > max
    }

    function test_constructor_rejects_negative_guard_params() public {
        vm.expectRevert(MWFeeHook.NegativeGuardParam.selector);
        _deployHook(BASE_FEE, MAX_FEE, SLOPE, QUAD, FEE_STEP, 0, 0, GUARD, -1, MAX_DEV, CATCHUP);
    }

    // ── callback gating ──────────────────────────────────────────────────────

    function test_callbacks_reject_non_pool_manager() public {
        SwapParams memory sp = SwapParams(true, -1, 0);
        vm.expectRevert(MWFeeHook.OnlyPoolManager.selector);
        hook.beforeSwap(trader, poolKey, sp, "");
        vm.expectRevert(MWFeeHook.OnlyPoolManager.selector);
        hook.afterSwap(trader, poolKey, sp, BalanceDelta.wrap(0), "");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _lpParams() internal pure returns (ModifyLiquidityParams memory) {
        return ModifyLiquidityParams({
            tickLower: -12000, tickUpper: 12000, liquidityDelta: int256(50_000_000e18), salt: bytes32(0)
        });
    }

    function _swapKey(PoolKey memory k, bool zeroForOne, uint256 amtIn) internal {
        vm.startPrank(trader, trader);
        (zeroForOne ? t0 : t1).approve(address(swapRouter), amtIn);
        swapRouter.swap(k, zeroForOne, amtIn);
        vm.stopPrank();
    }
}
