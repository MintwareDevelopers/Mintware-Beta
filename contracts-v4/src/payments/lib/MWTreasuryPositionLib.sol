// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary}         from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}          from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SqrtPriceMath}         from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {FullMath}              from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {LiquidityAmounts}      from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title  MWTreasuryPositionLib
/// @notice STATELESS, delegatecall-linked library holding the V4 unlock handlers + valuation of
///         `MintwareTreasuryVault` — the heavy Uniswap-V4 code (deploy / recover / collect + the
///         `min(spot,oracle)` MTM valuation + the oracle-bounded seniority swap), lifted verbatim from
///         the retired `MintwareV4LiquidityModule` so the vault stays under the EIP-170 24,576-byte
///         runtime limit. Modeled on `MWPositionLib` (the pair-vault's position library).
///
/// @dev    Owns NO storage. Its `external` functions are DELEGATECALLED by the vault (that is what gives
///         EIP-170 relief — an `internal` library would inline back into the vault). Under delegatecall
///         `address(this)` / storage / `token.balanceOf(address(this))` resolve AS the vault, so the
///         handlers behave byte-for-byte like the pre-merge inline module code — with ONE deliberate
///         change forced by the merge:
///
///         **BALANCE-DIFF, never naked `balanceOf`.** The retired module was a SEPARATE contract that
///         held only the position leg between ops, so it could read `teamToken.balanceOf(address(this))`
///         to mean "the recovered team leg". The vault, by contrast, ALSO custodies the entire junior
///         reserve (`juniorTokens`) and the senior/junior USDC buffers. So `recover`/`collect` measure
///         the removed/collected leg by BALANCE DIFF (before vs after the modifyLiquidity), and the
///         seniority swap sells EXACTLY that diff — never the vault's resting reserve. `deploy` likewise
///         reports `used` via balance diff. This keeps the vault's `juniorTokens == team balance` and
///         free-buffer accounting exact.
///
/// @dev    The `Ctx` carries the vault's pool identity + live range + live `positionLiquidity` (the
///         library cannot read the vault's storage under delegatecall). Seniority is enforced here
///         exactly as before: `recover` sells the recovered team leg to USDC so the senior is made whole
///         first; `recoverableUSDC` marks the whole position at `min(spot, oracle)` — the ONLY place a
///         price enters the system and the correct RHS of the vault's `deployedFromSenior <=
///         recoverableUSDC() + juniorUsdcBuffer` solvency invariant. The oracle tick is READ BY THE
///         VAULT (from its JIT hook) and passed in, so a flash spot pump cannot inflate the mark.
library MWTreasuryPositionLib {
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    uint256 private constant Q96 = 0x1000000000000000000000000; // 2**96

    /// @notice Band, in ticks, the unwind swap may move price past the truncated oracle before it stops
    ///         (~5%). Verbatim from the retired module's `SWAP_BAND_TICKS`.
    int24 private constant SWAP_BAND_TICKS = 500;

    /// @dev Vault immutables + live range/liquidity the library needs but cannot read under delegatecall.
    struct Ctx {
        IPoolManager pm;
        PoolKey      key;
        IERC20       usdc;
        IERC20       teamToken;
        bool         usdcIsCurrency0;
        int24        tickLower;
        int24        tickUpper;
        uint128      positionLiquidity;
    }

    // ── unlock handlers (delegatecalled from the vault's unlockCallback) ────────────

    /// @notice Add the maximal balanced liquidity for (usdcAmount, maxTeamToken) at the full range; salt
    ///         0. Returns abi.encode(usdcUsed, teamUsed, liquidityAdded), used* via balance diff so the
    ///         vault updates `deployedFromSenior`/`juniorTokens`/`positionLiquidity` exactly. Mirrors the
    ///         module's `_deploy` (leftover stays as the vault's free buffer — senior-deployed is always
    ///         junior-covered by construction).
    function deploy(Ctx memory c, uint256 usdcAmount, uint256 maxTeamToken) external returns (bytes memory) {
        (uint160 sqrtP,,,) = c.pm.getSlot0(c.key.toId());
        uint160 sL = TickMath.getSqrtPriceAtTick(c.tickLower);
        uint160 sU = TickMath.getSqrtPriceAtTick(c.tickUpper);

        (uint256 a0, uint256 a1) =
            c.usdcIsCurrency0 ? (usdcAmount, maxTeamToken) : (maxTeamToken, usdcAmount);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(sqrtP, sL, sU, a0, a1);
        if (liq == 0) return abi.encode(uint256(0), uint256(0), uint128(0));

        uint256 usdcBefore = c.usdc.balanceOf(address(this));
        uint256 teamBefore = c.teamToken.balanceOf(address(this));

        (BalanceDelta delta,) = c.pm.modifyLiquidity(
            c.key,
            ModifyLiquidityParams({tickLower: c.tickLower, tickUpper: c.tickUpper, liquidityDelta: int256(uint256(liq)), salt: bytes32(0)}),
            ""
        );
        _settleDelta(c, delta);

        uint256 usdcUsed = usdcBefore - c.usdc.balanceOf(address(this));
        uint256 teamUsed = teamBefore - c.teamToken.balanceOf(address(this));
        return abi.encode(usdcUsed, teamUsed, liq);
    }

    /// @notice Remove the value fraction of the position for ~`usdcWanted`, then SELL the recovered team
    ///         leg to USDC (seniority: junior spent first). Returns abi.encode(usdcReturned, teamReturned,
    ///         liquidityRemoved) all via balance diff. Mirrors the module's `_recover`.
    function recover(Ctx memory c, uint256 usdcWanted, int24 oTick, bool oReady)
        external
        returns (bytes memory)
    {
        uint128 liq = c.positionLiquidity;
        uint256 rec = _recoverable(c, oTick, oReady);
        if (rec == 0 || liq == 0 || usdcWanted == 0) return abi.encode(uint256(0), uint256(0), uint128(0));

        // `lrem = liq × give / rec` burns the liquidity slice whose MARKED value is `give`. The redemption
        // waterfall exploits this to realize a redeemer's exact PRO-RATA liquidity slice: it passes
        // `usdcWanted = f × recoverableUSDC()` (f × the mark) ⇒ `lrem = f × liq` ⇒ the redeemer unwinds
        // their own share and receives its ACTUAL proceeds (usd leg + oracle-bounded team sale), so the
        // mark-vs-liquidation gap is shared, not dumped on the tail (AUDIT R6-2; see `_pullUSDC`).
        uint256 give = usdcWanted < rec ? usdcWanted : rec;
        uint128 lrem = uint128(FullMath.mulDiv(liq, give, rec));
        if (lrem == 0) return abi.encode(uint256(0), uint256(0), uint128(0));
        if (lrem > liq) lrem = liq;

        uint256 usdcBefore = c.usdc.balanceOf(address(this));
        uint256 teamBefore = c.teamToken.balanceOf(address(this));

        (BalanceDelta delta,) = c.pm.modifyLiquidity(
            c.key,
            ModifyLiquidityParams({tickLower: c.tickLower, tickUpper: c.tickUpper, liquidityDelta: -int256(uint256(lrem)), salt: bytes32(0)}),
            ""
        );
        _settleDelta(c, delta); // vault now holds the removed USDC + team legs

        // Seniority: sell ONLY the recovered team leg (balance diff — never the resting junior reserve).
        uint256 teamRecovered = c.teamToken.balanceOf(address(this)) - teamBefore;
        if (teamRecovered > 0) _swapTeamToUsdc(c, teamRecovered, oTick, oReady);

        uint256 usdcReturned = c.usdc.balanceOf(address(this)) - usdcBefore;
        uint256 teamReturned = c.teamToken.balanceOf(address(this)) - teamBefore; // dust after the swap (~0)
        return abi.encode(usdcReturned, teamReturned, lrem);
    }

    /// @notice Collect accrued both-token fees (liquidityDelta 0, salt 0) and swap the team-side fees to
    ///         USDC so the vault receives a single USDC number. Returns abi.encode(usdcFees) via balance
    ///         diff. Mirrors the module's `_collect`.
    function collect(Ctx memory c, int24 oTick, bool oReady) external returns (bytes memory) {
        uint256 usdcBefore = c.usdc.balanceOf(address(this));
        uint256 teamBefore = c.teamToken.balanceOf(address(this));

        (BalanceDelta delta,) = c.pm.modifyLiquidity(
            c.key,
            ModifyLiquidityParams({tickLower: c.tickLower, tickUpper: c.tickUpper, liquidityDelta: int256(0), salt: bytes32(0)}),
            ""
        );
        _settleDelta(c, delta);

        uint256 teamFees = c.teamToken.balanceOf(address(this)) - teamBefore;
        if (teamFees > 0) _swapTeamToUsdc(c, teamFees, oTick, oReady);

        uint256 usdcFees = c.usdc.balanceOf(address(this)) - usdcBefore;
        return abi.encode(usdcFees);
    }

    // ── valuation (view; delegatecalled from the vault's recoverableUSDC view) ───────

    /// @notice MTM value of the whole position in USDC at `min(spot, oracle)` — the solvency invariant's
    ///         RHS. A flash pump of spot is ignored (the truncated oracle lags, so `min` picks the lower
    ///         oracle value); a genuine drop is respected (spot is lower). Falls back to spot when the
    ///         vault's JIT hook exposes no ready oracle. Mirrors the module's `recoverableUSDC`.
    function recoverableUSDC(Ctx memory c, int24 oTick, bool oReady) external view returns (uint256) {
        return _recoverable(c, oTick, oReady);
    }

    /// @notice AUDIT R6-2 — CONSERVATIVE senior-realizable FLOOR of the position in USDC: the position's
    ///         USDC LEG ONLY, valued at whichever of {spot, oracle} yields the SMALLER USDC leg. The team
    ///         leg is EXCLUDED. Why: `recoverableUSDC` (above) marks the WHOLE position (USDC leg + team
    ///         leg at min(spot,oracle) MID price). But physically realizing the team leg means SELLING it
    ///         through the pool (`_swapTeamToUsdc`, oracle-band-clamped), whose proceeds depend on live
    ///         external liquidity and collapse toward ZERO in a thin/impaired pool. Marking it at mid
    ///         therefore OVERSTATES what the senior can realize — so an early redeemer exits at the mid
    ///         mark from liquid buffers while the LAST redeemer, forced to liquidate the LP, eats the whole
    ///         mark-vs-liquidation gap (the R6 first-redeemer run, LP-liquidation dimension). The USDC leg,
    ///         by contrast, is handed to the vault directly on `modifyLiquidity(-liq)` with NO sale, so it
    ///         is realizable independent of pool depth. Any team the unwind DOES sell is upside that stays
    ///         in the vault. Manipulation-resistant: the floor is `min(usdcLeg at spot, usdcLeg at oracle)` (a
    ///         spot pump can only LOWER it, never inflate it above the oracle-anchored value). Redemptions
    ///         price against `min(par, seniorRealizableAssets)`, and `seniorRealizableAssets` uses THIS for
    ///         the deployed LP leg — see `MintwareTreasuryVault.seniorRealizableAssets`/`_pullUSDC`.
    function recoverableFloorUSDC(Ctx memory c, int24 oTick, bool oReady) external view returns (uint256) {
        if (c.positionLiquidity == 0) return 0;
        (uint160 spotSqrt,,,) = c.pm.getSlot0(c.key.toId());
        // Pick the price that MINIMIZES the USDC leg (conservative). USDC leg = amt0 (usdc=currency0),
        // which DECREASES in price ⇒ use the HIGHER price; or amt1 (usdc=currency1), which INCREASES in
        // price ⇒ use the LOWER price. When the oracle is ready it bounds the manipulable spot in the
        // inflating direction; when not ready this floor is used only for display (redeem/settle revert
        // upstream via `recoverableUSDC`'s OracleNotReady gate), so spot alone is acceptable here.
        uint160 valSqrt = spotSqrt;
        if (oReady) {
            uint160 oSqrt = TickMath.getSqrtPriceAtTick(oTick);
            if (c.usdcIsCurrency0 ? (oSqrt > valSqrt) : (oSqrt < valSqrt)) valSqrt = oSqrt;
        }
        return _usdcLegAt(c, valSqrt);
    }

    // ── internals ────────────────────────────────────────────────────────────────

    function _recoverable(Ctx memory c, int24 oTick, bool oReady) private view returns (uint256) {
        if (c.positionLiquidity == 0) return 0;
        (uint160 spotSqrt,,,) = c.pm.getSlot0(c.key.toId());
        uint256 vSpot = _valueAt(c, spotSqrt);
        // AUDIT (oracle-tail spot-manip, High): the pure-spot fallback below is a manipulable mark and MUST
        // NOT price the SENIOR REDEEM NAV. That is enforced UPSTREAM at the vault: `deployToLP` refuses to
        // create a live position without a ready oracle (structural gate) AND `MintwareTreasuryVault.
        // recoverableUSDC()` reverts `OracleNotReady()` when `positionLiquidity>0 && !oReady`, so this branch
        // is unreachable via the redeem/settle valuation path. It survives only for the owner-driven
        // RECOVER/COLLECT unlock ops (unwinding a live position when the oracle is transiently down), where
        // executing the unwind at spot is the intended fail-safe (a redemption must never be permanently
        // bricked); the seniority swap itself is still oracle-bounded whenever `oReady`.
        if (!oReady) return vSpot;
        uint256 vOracle = _valueAt(c, TickMath.getSqrtPriceAtTick(oTick));
        return vSpot < vOracle ? vSpot : vOracle;
    }

    /// @dev The position's USDC-side leg (raw USDC amount, rounded DOWN) at `sqrtP` — the part a burn hands
    ///      over with NO sale. Mirrors `_valueAt`'s leg split but returns ONLY the USDC side, un-priced.
    function _usdcLegAt(Ctx memory c, uint160 sqrtP) private pure returns (uint256) {
        uint160 sL = TickMath.getSqrtPriceAtTick(c.tickLower);
        uint160 sU = TickMath.getSqrtPriceAtTick(c.tickUpper);
        uint256 amt0;
        uint256 amt1;
        if (sqrtP <= sL) {
            amt0 = SqrtPriceMath.getAmount0Delta(sL, sU, c.positionLiquidity, false);
        } else if (sqrtP < sU) {
            amt0 = SqrtPriceMath.getAmount0Delta(sqrtP, sU, c.positionLiquidity, false);
            amt1 = SqrtPriceMath.getAmount1Delta(sL, sqrtP, c.positionLiquidity, false);
        } else {
            amt1 = SqrtPriceMath.getAmount1Delta(sL, sU, c.positionLiquidity, false);
        }
        return c.usdcIsCurrency0 ? amt0 : amt1;
    }

    /// @dev Value the whole position in USDC at an arbitrary `sqrtP` (USDC leg at par + team leg priced).
    function _valueAt(Ctx memory c, uint160 sqrtP) private pure returns (uint256) {
        uint160 sL = TickMath.getSqrtPriceAtTick(c.tickLower);
        uint160 sU = TickMath.getSqrtPriceAtTick(c.tickUpper);

        uint256 amt0;
        uint256 amt1;
        if (sqrtP <= sL) {
            amt0 = SqrtPriceMath.getAmount0Delta(sL, sU, c.positionLiquidity, false);
        } else if (sqrtP < sU) {
            amt0 = SqrtPriceMath.getAmount0Delta(sqrtP, sU, c.positionLiquidity, false);
            amt1 = SqrtPriceMath.getAmount1Delta(sL, sqrtP, c.positionLiquidity, false);
        } else {
            amt1 = SqrtPriceMath.getAmount1Delta(sL, sU, c.positionLiquidity, false);
        }

        (uint256 usdcAmt, uint256 teamAmt) = c.usdcIsCurrency0 ? (amt0, amt1) : (amt1, amt0);
        return usdcAmt + _valueTeamInUsdc(c, teamAmt, sqrtP);
    }

    /// @dev Value `teamAmt` raw team tokens in USDC at `sqrtP`, staged through `Q96` twice so `sqrtP^2`
    ///      never overflows. Mirrors the module's `_valueTeamInUsdc`.
    function _valueTeamInUsdc(Ctx memory c, uint256 teamAmt, uint160 sqrtP) private pure returns (uint256) {
        if (teamAmt == 0) return 0;
        if (c.usdcIsCurrency0) {
            // teamAmt (currency1) / price, price = (sqrtP/Q96)^2  →  teamAmt * Q96/sqrtP * Q96/sqrtP
            uint256 half = FullMath.mulDiv(teamAmt, Q96, sqrtP);
            return FullMath.mulDiv(half, Q96, sqrtP);
        } else {
            // teamAmt (currency0) * price  →  teamAmt * sqrtP/Q96 * sqrtP/Q96
            uint256 half = FullMath.mulDiv(teamAmt, sqrtP, Q96);
            return FullMath.mulDiv(half, sqrtP, Q96);
        }
    }

    /// @dev Swap `amountIn` team → USDC (exact-input), oracle-bounded so a sandwich that moved spot can't
    ///      force the unwind to realize at the manipulated price; clamped to the executable side of spot
    ///      so it can NEVER revert (a redemption must not brick). Mirrors the module's `_swapTeamToUsdc`.
    function _swapTeamToUsdc(Ctx memory c, uint256 amountIn, int24 oTick, bool oReady) private {
        bool zeroForOne = !c.usdcIsCurrency0; // selling team; team is currency0 iff usdc is currency1
        (uint160 cur,,,) = c.pm.getSlot0(c.key.toId());
        BalanceDelta delta = c.pm.swap(
            c.key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn), // negative = exact input
                sqrtPriceLimitX96: _swapLimit(zeroForOne, cur, oTick, oReady)
            }),
            ""
        );
        _settleDelta(c, delta);
    }

    /// @dev The oracle-bounded price limit for an unwind swap, clamped to the executable side of `cur`.
    function _swapLimit(bool zeroForOne, uint160 cur, int24 oTick, bool oReady) private pure returns (uint160) {
        if (!oReady) return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        if (zeroForOne) {
            // price decreases; floor at oracle−band, but strictly below cur (else V4 reverts).
            uint160 band = _sqrtAtClamped(int256(oTick) - SWAP_BAND_TICKS);
            if (band >= cur) return cur > TickMath.MIN_SQRT_PRICE + 1 ? cur - 1 : cur;
            return band;
        } else {
            // price increases; cap at oracle+band, but strictly above cur.
            uint160 band = _sqrtAtClamped(int256(oTick) + SWAP_BAND_TICKS);
            if (band <= cur) return cur < TickMath.MAX_SQRT_PRICE - 1 ? cur + 1 : cur;
            return band;
        }
    }

    /// @dev getSqrtPriceAtTick with the tick + result clamped to the usable range.
    function _sqrtAtClamped(int256 tick) private pure returns (uint160) {
        if (tick < TickMath.MIN_TICK) return TickMath.MIN_SQRT_PRICE + 1;
        if (tick > TickMath.MAX_TICK) return TickMath.MAX_SQRT_PRICE - 1;
        uint160 s = TickMath.getSqrtPriceAtTick(int24(tick));
        if (s < TickMath.MIN_SQRT_PRICE + 1) return TickMath.MIN_SQRT_PRICE + 1;
        if (s > TickMath.MAX_SQRT_PRICE - 1) return TickMath.MAX_SQRT_PRICE - 1;
        return s;
    }

    // ── settlement (copies of MintwarePairVault._settleDelta / _pay; the library cannot call the
    //    vault's internal ones under delegatecall) ─────────────────────────────────────────────────

    function _settleDelta(Ctx memory c, BalanceDelta delta) private {
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0)      _pay(c, c.key.currency0, uint256(uint128(-d0)));
        else if (d0 > 0) c.pm.take(c.key.currency0, address(this), uint256(uint128(d0)));
        if (d1 < 0)      _pay(c, c.key.currency1, uint256(uint128(-d1)));
        else if (d1 > 0) c.pm.take(c.key.currency1, address(this), uint256(uint128(d1)));
    }

    function _pay(Ctx memory c, Currency currency, uint256 amount) private {
        c.pm.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(c.pm), amount);
        c.pm.settle();
    }
}
