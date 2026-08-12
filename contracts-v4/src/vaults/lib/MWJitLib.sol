// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}          from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts}      from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IYieldAdapter} from "../IYieldAdapter.sol";

/// @title  MWJitLib
/// @notice STATELESS, delegatecall-linked library holding the size-gated true-JIT subsystem of
///         MintwareDeFiPairVault, extracted verbatim to keep the vault under the EIP-170 24,576-byte
///         runtime limit. The `external` functions here are DELEGATECALL'd from the vault, so
///         `address(this)`, `msg.sender` at the PoolManager, and every `token.balanceOf(address(this))`
///         all resolve AS the vault — identical to the code running inline.
///
/// @dev    The library owns NO storage. All JIT-mutable vault state travels in a `JitState` memory
///         struct (in → out); the vault loads it before the call and writes EVERY field back after.
///         Vault immutables the library cannot read (poolManager, poolKey, tokens, adapters) travel in
///         a `Ctx` memory struct. This preserves the invariant that all state mutation is auditable in
///         the vault, behind its `nonReentrant`/`onlyHook`/`notDuringJit` guards. Behavior is byte-for-
///         byte identical to the pre-extraction inline JIT code: same math, same rounding toward the
///         vault, same ERC-6909 take-or-mint-claim shortfall path, same `return 0` no-op fallbacks,
///         same single-sided range, same dedicated JIT salt.
library MWJitLib {
    using SafeERC20       for IERC20;
    using PoolIdLibrary   for PoolKey;
    using StateLibrary    for IPoolManager;
    using CurrencyLibrary for Currency;

    /// @dev Vault immutables the library needs but cannot read from storage under delegatecall.
    struct Ctx {
        IPoolManager  pm;
        PoolKey       key;
        IERC20        t0;
        IERC20        t1;
        IYieldAdapter a0;
        IYieldAdapter a1;
    }

    /// @dev The COMPLETE set of JIT-mutable vault storage. Loaded before the call, written back after.
    ///      A missed field on either side would be silent state corruption — the vault's `_loadJit`/
    ///      `_storeJit` MUST cover all eight.
    struct JitState {
        uint128 jitLiquidity;
        bool    jitActive;
        int24   jitTickLower;
        int24   jitTickUpper;
        uint256 jitClaim0;
        uint256 jitClaim1;
        uint256 idle0;
        uint256 idle1;
    }

    /// @notice Open a tight SINGLE-SIDED JIT position funded from the OUTPUT-side Aave adapter. Mirrors
    ///         the old `jitOpen` body EXACTLY, minus the guards + per-block cap accounting kept in the
    ///         vault. Sizing is `outputBudget ∩ adapter headroom ∩ settled idle basis ∩ cap` — NO price
    ///         or oracle is read. `cap` is the vault's `_jitCap(type(uint256).max)` (per-swap ∩ remaining
    ///         per-block budget), so `min(want, cap)` reproduces the original `_jitCap(want)` clamp.
    /// @return s2  updated JIT state (idle decremented, range + liquidity + active set on success).
    /// @return L   JIT liquidity actually opened (0 ⇒ hook falls back to resting liquidity).
    /// @return got principal actually withdrawn from Aave (>0 whenever a withdraw happened, so the vault
    ///             records it against the per-block cap even on the L==0 undo path).
    function open(
        Ctx memory c,
        JitState memory s,
        bool zeroForOne,
        uint256 outputBudget,
        int24 spacing,
        int24 widthSpacings,
        bytes32 jitSalt,
        uint256 cap
    ) external returns (JitState memory s2, uint128 L, uint256 got) {
        // (1) Output-side adapter only — never touch the input adapter in open.
        IYieldAdapter adapter = zeroForOne ? c.a1 : c.a0;
        if (address(adapter) == address(0)) return (s, 0, 0);

        // (2) Size the pull: budget ∩ adapter live headroom ∩ settled idle basis ∩ per-swap/-block caps.
        uint256 basis = zeroForOne ? s.idle1 : s.idle0;
        uint256 want = outputBudget;
        uint256 maxW = adapter.maxWithdrawable();
        if (maxW  < want) want = maxW;
        if (basis < want) want = basis;
        if (cap   < want) want = cap; // == _jitCap(want) with cap = _jitCap(type(uint256).max)
        if (want == 0) return (s, 0, 0);

        // (3) Best-effort withdraw (got <= want). Settle the idle counter IMMEDIATELY.
        got = adapter.withdraw(want);
        if (got == 0) return (s, 0, 0);
        if (zeroForOne) s.idle1 -= got; else s.idle0 -= got;

        // (4) Tight single-sided range aligned to tickSpacing, strictly to one side of the live tick.
        (, int24 tick,,) = c.pm.getSlot0(c.key.toId());
        int24 width = spacing * widthSpacings;
        int24 lo;
        int24 hi;
        if (zeroForOne) {
            hi = _alignTick(tick, spacing);
            lo = hi - width;
        } else {
            lo = _alignTick(tick, spacing) + spacing;
            hi = lo + width;
        }
        uint160 sLo = TickMath.getSqrtPriceAtTick(lo);
        uint160 sHi = TickMath.getSqrtPriceAtTick(hi);

        // (5) Liquidity from the single-sided principal. If it rounds to zero, undo the withdraw.
        L = zeroForOne
            ? LiquidityAmounts.getLiquidityForAmount1(sLo, sHi, got)
            : LiquidityAmounts.getLiquidityForAmount0(sLo, sHi, got);
        if (L == 0) {
            _reIdle(c, s, zeroForOne, got);
            return (s, 0, got);
        }

        // (6) Add JIT liquidity at the DEDICATED salt (a separate pool position from `salt = 0`).
        (BalanceDelta delta,) = c.pm.modifyLiquidity(
            c.key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: int256(uint256(L)), salt: jitSalt}),
            ""
        );
        _settleDelta(c, delta);

        s.jitTickLower = lo;
        s.jitTickUpper = hi;
        s.jitLiquidity = L;
        s.jitActive    = true;
        return (s, L, got);
    }

    /// @notice Close the JIT position: remove it, take both sides back (physical up to reserves, else
    ///         mint ERC-6909 claims for the shortfall), re-idle taken proceeds, clear JIT state. Mirrors
    ///         the old `jitClose` body EXACTLY, minus the `jitActive` guard kept in the vault.
    function close(Ctx memory c, JitState memory s, bytes32 jitSalt)
        external
        returns (JitState memory s2, uint256 taken0, uint256 taken1, uint256 claimed0, uint256 claimed1)
    {
        uint128 L  = s.jitLiquidity;
        int24   lo = s.jitTickLower;
        int24   hi = s.jitTickUpper;

        (BalanceDelta delta,) = c.pm.modifyLiquidity(
            c.key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: -int256(uint256(L)), salt: jitSalt}),
            ""
        );

        // Removal yields a non-negative delta per side. Defensively pay any negative side.
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0) _pay(c, c.key.currency0, uint256(uint128(-d0)));
        if (d1 < 0) _pay(c, c.key.currency1, uint256(uint128(-d1)));

        (taken0, claimed0) = d0 > 0 ? _takeOrClaim(c, s, false, uint256(uint128(d0))) : (0, 0);
        (taken1, claimed1) = d1 > 0 ? _takeOrClaim(c, s, true,  uint256(uint128(d1))) : (0, 0);

        // Re-idle only the PHYSICALLY-taken proceeds. Counters clear LAST.
        _reIdle(c, s, false, taken0);
        _reIdle(c, s, true,  taken1);

        s.jitLiquidity = 0;
        s.jitActive    = false;
        return (s, taken0, taken1, claimed0, claimed1);
    }

    /// @notice Redeem outstanding JIT ERC-6909 claims to physical tokens and re-supply them to Aave.
    ///         Mirrors the old `_sweepClaims`/`_redeemClaim` bodies EXACTLY. Runs INSIDE the vault's
    ///         PoolManager unlock (called from the vault's `_sweepClaims` dispatch target).
    function sweep(Ctx memory c, JitState memory s)
        external
        returns (JitState memory s2, uint256 r0, uint256 r1)
    {
        r0 = _redeemClaim(c, s, false);
        r1 = _redeemClaim(c, s, true);
        return (s, r0, r1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers — inlined into this library's deployed code (never the vault's)
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Settle one side of the JIT removal's positive delta: `take` physical up to the manager's
    ///      current reserves, `mint` an ERC-6909 claim for the remainder. Returns (physicalTaken,
    ///      claimMinted); bumps `s.jitClaimN` by the claimed amount.
    function _takeOrClaim(Ctx memory c, JitState memory s, bool side1, uint256 owed)
        private
        returns (uint256 taken, uint256 claimed)
    {
        Currency cur   = side1 ? c.key.currency1 : c.key.currency0;
        IERC20   token = side1 ? c.t1 : c.t0;
        uint256  avail = token.balanceOf(address(c.pm));
        taken = owed < avail ? owed : avail;
        if (taken > 0) c.pm.take(cur, address(this), taken);
        claimed = owed - taken;
        if (claimed > 0) {
            c.pm.mint(address(this), cur.toId(), claimed);
            if (side1) s.jitClaim1 += claimed; else s.jitClaim0 += claimed;
        }
    }

    /// @dev Burn up to `s.jitClaimN` ERC-6909 claims (capped at the manager's reserves), take the
    ///      physical underlying, and supply it to Aave (`s.idleN += supplied`). Best-effort on Aave.
    function _redeemClaim(Ctx memory c, JitState memory s, bool side1) private returns (uint256 redeemed) {
        uint256 claim = side1 ? s.jitClaim1 : s.jitClaim0;
        if (claim == 0) return 0;
        Currency      cur     = side1 ? c.key.currency1 : c.key.currency0;
        IERC20        token   = side1 ? c.t1 : c.t0;
        IYieldAdapter adapter = side1 ? c.a1 : c.a0;

        uint256 avail = token.balanceOf(address(c.pm));
        redeemed = claim < avail ? claim : avail;
        if (redeemed == 0) return 0;

        c.pm.burn(address(this), cur.toId(), redeemed); // +redeemed delta to the vault
        c.pm.take(cur, address(this), redeemed);        // physical to the vault; delta → 0
        if (side1) s.jitClaim1 -= redeemed; else s.jitClaim0 -= redeemed;

        if (address(adapter) != address(0) && adapter.maxSuppliable() > 0) {
            token.forceApprove(address(adapter), redeemed);
            try adapter.deposit(redeemed) {
                if (side1) s.idle1 += redeemed; else s.idle0 += redeemed;
            } catch {
                token.forceApprove(address(adapter), 0); // leave physical in the vault (extra backing)
            }
        }
        // else: reserve unavailable — physical stays in the vault balance (still full backing).
    }

    /// @dev Re-supply `amt` of the given side back to its adapter as settled principal, incrementing
    ///      `s.idleN` by EXACTLY what the adapter accepts. Unset adapter / full reserve / revert → leave
    ///      tokens in the vault (unattributed extra backing), counter NOT bumped.
    function _reIdle(Ctx memory c, JitState memory s, bool side1, uint256 amt) private {
        if (amt == 0) return;
        IYieldAdapter adapter = side1 ? c.a1 : c.a0;
        IERC20        token   = side1 ? c.t1 : c.t0;
        if (address(adapter) == address(0)) return;   // leave in vault balance
        if (adapter.maxSuppliable() == 0) return;      // reserve full/paused/frozen — leave in vault
        token.forceApprove(address(adapter), amt);
        try adapter.deposit(amt) {
            if (side1) s.idle1 += amt; else s.idle0 += amt;
        } catch {
            token.forceApprove(address(adapter), 0);   // reset dangling approval; leave in vault
        }
    }

    /// @dev Settle a modifyLiquidity delta: negative = we owe the pool, positive = pool owes us.
    ///      Private copy of MintwarePairVault._settleDelta (the library cannot call the vault's internal).
    function _settleDelta(Ctx memory c, BalanceDelta delta) private {
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0)      _pay(c, c.key.currency0, uint256(uint128(-d0)));
        else if (d0 > 0) c.pm.take(c.key.currency0, address(this), uint256(uint128(d0)));
        if (d1 < 0)      _pay(c, c.key.currency1, uint256(uint128(-d1)));
        else if (d1 > 0) c.pm.take(c.key.currency1, address(this), uint256(uint128(d1)));
    }

    /// @dev sync → transfer → settle (ERC-20 pull-then-settle). Private copy of MintwarePairVault._pay.
    function _pay(Ctx memory c, Currency currency, uint256 amount) private {
        c.pm.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(c.pm), amount);
        c.pm.settle();
    }

    /// @dev Align a tick DOWN to the nearest multiple of `spacing` (floor toward -∞). Pure copy of
    ///      MintwareDeFiPairVault._alignTick — the vault keeps its own copy for profile ranges.
    function _alignTick(int24 tick, int24 spacing) private pure returns (int24) {
        int24 rounded = (tick / spacing) * spacing;
        if (tick < 0 && rounded != tick) rounded -= spacing;
        return rounded;
    }
}
