// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks}   from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}  from "@uniswap/v4-core/src/types/PoolKey.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {MWFeeHook}     from "../../src/hooks/MWFeeHook.sol";
import {MWFeeHookBase} from "./MWFeeHookBase.t.sol";

/// @notice Adversarial red-team for the routable fee hook. Two attack theses:
///           (A) steer the truncated in-pool oracle WITHIN a block to buy an artificially LOW fee on
///               a toxic (high-deviation) swap;
///           (B) trip / avoid the deviation circuit breaker for advantage (grief a victim's heal, or
///               brick the pool for profit).
///         VERDICT (both): the truncated oracle neutralizes them — the oracle is frozen intra-block
///         and advances at most `maxTickMovePerBlock` per block, and the breaker only blocks the
///         gap-WIDENING direction (never the heal). Each test is a concrete PoC that FAILS to profit.
contract MWFeeHookManipTest is MWFeeHookBase {
    /// @notice Deploy a fresh guard-enabled, LVR-on pool with a chosen breaker band + oracle budget.
    function _freshPool(int24 maxMove, int24 maxDev, uint32 catchup)
        internal returns (MWFeeHook h, PoolKey memory k)
    {
        h = _deployHook(BASE_FEE, MAX_FEE, /*slope*/ 30, 0, /*feeStep*/ 0, /*lvrSlope*/ 3000, 0, true, maxMove, maxDev, catchup);
        k = PoolKey({
            currency0: poolKey.currency0, currency1: poolKey.currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: IHooks(address(h))
        });
        pm.initialize(k, INIT_SQRT_PRICE);
        vm.startPrank(lp);
        lpRouter.modifyLiquidity(
            k,
            ModifyLiquidityParams({tickLower: -12000, tickUpper: 12000, liquidityDelta: int256(50_000_000e18), salt: bytes32(0)}),
            ""
        );
        vm.stopPrank();
    }

    function _swapK(PoolKey memory k, bool zeroForOne, uint256 amtIn) internal {
        vm.startPrank(trader, trader);
        (zeroForOne ? t0 : t1).approve(address(swapRouter), amtIn);
        swapRouter.swap(k, zeroForOne, amtIn);
        vm.stopPrank();
    }

    function _tickK(PoolKey memory k) internal view returns (int24 t) {
        t = _tickOf(k.toId());
    }

    // ── Attack A: intra-block oracle steering to buy a cheap fee ──────────────

    /// @notice PoC: an attacker who has pushed spot far from the oracle CANNOT, within the same block,
    ///         drag the oracle back to spot to collapse the deviation (and thus the fee). The oracle is
    ///         frozen for the block after its single per-block advance, so every same-block swap is
    ///         priced off the SAME lagging reference. The toxic swap keeps paying the elevated fee.
    function test_intrablock_steering_cannot_lower_fee() public {
        (MWFeeHook h, PoolKey memory k) = _freshPool(60, 0 /*breaker off*/, 10);

        // Block N: seed oracle near spot (tick ~0).
        _swapK(k, true, 5_000e18);
        (int24 seed,) = h.oracleTick(k.toId());

        // Block N+1: push spot far below the oracle. Its afterSwap advances the oracle at most 60 ticks.
        vm.roll(block.number + 1);
        _swapK(k, true, 1_500_000e18);
        (int24 oAfterPush,) = h.oracleTick(k.toId());
        int24 spot = _tickK(k);
        int24 movedBy = seed >= oAfterPush ? seed - oAfterPush : oAfterPush - seed;
        assertLe(uint256(uint24(movedBy)), uint256(uint24(int24(60))), "oracle advanced at most maxTickMovePerBlock");

        int24 devNow = spot >= oAfterPush ? spot - oAfterPush : oAfterPush - spot;
        // The spot move outran the oracle's 60-tick per-block catch-up ⇒ a large standing deviation the
        // attacker would need to erase to buy a cheap fee.
        assertGt(uint256(uint24(devNow)), 60, "large standing deviation the attacker wants to erase");

        // Attacker's attempt: hammer many same-block swaps hoping to reset the oracle to spot before the
        // toxic trade. Record the oracle + the applied fee before and after the hammering — both frozen.
        uint24 feeBefore = h.lastFee(k.toId());
        (int24 oBeforeHammer,) = h.oracleTick(k.toId());
        for (uint256 i = 0; i < 8; i++) {
            _swapK(k, i % 2 == 0, 1_000e18); // alternate directions, all in the SAME block
        }
        (int24 oAfterHammer,) = h.oracleTick(k.toId());
        assertEq(oAfterHammer, oBeforeHammer, "oracle FROZEN intra-block: steering had no effect");

        // The toxic swap (arb direction) still prices off the lagging oracle ⇒ elevated fee, not base.
        _swapK(k, false, 1_000e18);
        uint24 toxicFee = h.lastFee(k.toId());
        assertGt(toxicFee, BASE_FEE + 100, "toxic swap still pays the elevated deviation fee");
        emit log_named_uint("fee before hammering", feeBefore);
        emit log_named_uint("toxic swap fee (arb) ", toxicFee);
    }

    /// @notice Cross-block, the oracle catches up only `maxTickMovePerBlock` per block, so erasing a
    ///         large deviation to reach the base fee takes MANY blocks — during which the price is
    ///         exposed to reversion. This bounds how cheaply an attacker can ever normalize the fee.
    function test_oracle_catchup_is_rate_bounded_across_blocks() public {
        (MWFeeHook h, PoolKey memory k) = _freshPool(60, 0, 1); // catchup 1 ⇒ at most 60 ticks/block

        _swapK(k, true, 5_000e18);
        vm.roll(block.number + 1);
        _swapK(k, true, 300_000e18); // large deviation established
        int24 spot = _tickK(k);
        (int24 o0,) = h.oracleTick(k.toId());
        uint256 dev0 = uint256(uint24(spot >= o0 ? spot - o0 : o0 - spot));

        // Advance one block and let the oracle catch up via a tiny swap: it moves <= 60 ticks.
        vm.roll(block.number + 1);
        _swapK(k, true, 1e18);
        (int24 o1,) = h.oracleTick(k.toId());
        uint256 step = uint256(uint24(o1 >= o0 ? o1 - o0 : o0 - o1));
        assertLe(step, 60, "oracle catches up at most maxTickMovePerBlock per block");
        assertGt(dev0, step, "a large deviation cannot be erased in one block");
    }

    // ── Attack B: trip / avoid the circuit breaker for advantage ──────────────

    /// @notice The breaker blocks only the gap-WIDENING direction at extreme deviation. An attacker
    ///         trying to shove spot past the band to grief the pool has their OWN widening swap revert —
    ///         they cannot even create the bricked state.
    function test_breaker_blocks_attackers_own_widening_push() public {
        (, PoolKey memory k) = _freshPool(1 /*tiny move*/, 20 /*tight band*/, 1);

        _swapK(k, true, 1_000e18);   // seed
        vm.roll(block.number + 1);
        _swapK(k, true, 500_000e18); // pushes spot past the band; oracle truncates
        vm.roll(block.number + 1);

        // A further WIDENING swap (same direction, spot already below oracle ⇒ zeroForOne widens) reverts.
        vm.startPrank(trader, trader);
        t0.approve(address(swapRouter), 1_000e18);
        vm.expectRevert(); // PriceDeviationTooHigh, wrapped by PoolManager
        swapRouter.swap(k, true, 1_000e18);
        vm.stopPrank();
    }

    /// @notice The heal (gap-CLOSING / arb) direction is ALWAYS allowed even past the band — so the
    ///         breaker can never be weaponized to block the swap that restores price. The attacker
    ///         cannot grief a victim's arbitrage/heal.
    function test_breaker_never_blocks_the_heal() public {
        (, PoolKey memory k) = _freshPool(1, 20, 1);

        _swapK(k, true, 1_000e18);
        vm.roll(block.number + 1);
        _swapK(k, true, 500_000e18); // spot far below oracle, past the band
        vm.roll(block.number + 1);

        // Gap-closing = buy up = !zeroForOne. Must succeed despite the extreme deviation (no revert).
        _swapK(k, false, 1_000e18);
        assertTrue(true, "heal swap allowed past the band");
    }
}
