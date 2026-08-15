// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks}                 from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager}           from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback}        from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}                from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary}  from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}               from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}           from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams}       from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Hooks}                  from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath}               from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}           from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts}       from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}   from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev The minimal vault surface the hook drives — the borrow-seam (increment 1).
interface IJitVault {
    function borrowIdleForJit(uint256 want) external returns (uint256 lent);
    function settleJitReturn(uint256 usdcReturned) external;
}

/// @title  MintwareTreasuryJitHook
/// @notice The real Uniswap-V4 JIT hook for the treasury-anchored ULV (#5, option C). On a swap that
///         BUYS USDC (team→USDC), it borrows a bounded slice of senior idle USDC from the vault
///         (`borrowIdleForJit`) and opens a tight single-sided USDC position for that ONE swap, capturing
///         the extra fee; then closes it and, once the swap has settled, converts the proceeds back to
///         USDC and returns them (`settleJitReturn`). Price-free (no oracle); the vault caps the slice and
///         the junior backstops the close cost.
///
/// @dev    THE afterSwap GOTCHA. The swapper settles their team token AFTER `afterSwap`, so during the
///         callback the PoolManager doesn't hold it yet — the hook can't `take()` what the closed position
///         owes it. So `afterSwap` MINTS ERC-6909 claims for the owed amounts and returns; a later keeper
///         `sweepJit()` (post-settlement) redeems the claims, swaps team→USDC, and settles with the vault.
///         Between the two phases the vault's `jitBorrowed` stays outstanding at par (senior NAV held).
///
/// @dev    Single pool / single vault. Only `beforeSwap` + `afterSwap` are permissioned (address flags
///         0xC0); the module's full-range liquidity (salt 0) and the JIT position (JIT_SALT) coexist in
///         the pool without any liquidity-callback. V4 auto-skips these callbacks for the hook's OWN swap
///         (`msg.sender == self`), so the sweep's team→USDC swap needs no reentrancy guard.
contract MintwareTreasuryJitHook is IHooks, IUnlockCallback, Ownable {
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    IPoolManager public immutable poolManager;
    IJitVault    public immutable vault;
    IERC20       public immutable usdc;
    IERC20       public immutable teamToken;

    Currency private immutable _c0;
    Currency private immutable _c1;
    uint24   private immutable _fee;
    int24    private immutable _tickSpacing;
    bool     public  immutable usdcIsCurrency0;

    /// @notice AUDIT (Cork class): the ONE pool this hook serves. `beforeSwap`/`afterSwap` are gated to
    ///         it — anyone can initialize a *different* pool that names this hook and swap on it, which
    ///         would otherwise drive `_open`/`borrowIdleForJit` against an attacker-chosen PoolKey and
    ///         deploy senior USDC into an attacker pool. Mismatched keys no-op (never revert the swap).
    PoolId public immutable canonicalPoolId;

    bytes32 private constant JIT_SALT = bytes32(uint256(0x314));

    /// @notice Minimum |amountSpecified| for JIT to fire (size gate; skip dust swaps).
    uint256 public jitThreshold;
    /// @notice JIT range width, in tickSpacings, to one side of the live tick.
    int24 public jitWidthSpacings = 3;
    /// @notice Swaps initiated by this address never fire JIT — set to the LP module, whose own
    ///         recover/collect swaps must NOT recursively borrow + open a JIT position.
    address public jitSkipSender;

    // ── per-swap open state (0 between swaps) ──────────────────────────────────
    uint128 private jitLiquidity;
    int24   private jitLower;
    int24   private jitUpper;

    // ── proceeds accumulated across swaps, awaiting the keeper sweep ────────────
    /// @notice ERC-6909 claims minted in afterSwap for the closed position's owed tokens.
    uint256 public usdcClaim;
    uint256 public teamClaim;

    event JitOpened(uint256 lent, uint128 liquidity);
    event JitClosed(uint256 usdcClaimed, uint256 teamClaimed);
    event JitSwept(uint256 usdcReturned);
    event JitThresholdSet(uint256 threshold);
    event JitWidthSet(int24 spacings);

    error OnlyPoolManager();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    constructor(address poolManager_, PoolKey memory key, address usdc_, address vault_, address owner_)
        Ownable(owner_)
    {
        poolManager = IPoolManager(poolManager_);
        vault       = IJitVault(vault_);
        _c0 = key.currency0;
        _c1 = key.currency1;
        _fee = key.fee;
        _tickSpacing = key.tickSpacing;
        // The canonical pool always names THIS hook (hooks = address(this)); compute its id from that,
        // not from the passed key.hooks (which is unset/placeholder pre-CREATE2 deploy).
        canonicalPoolId = PoolKey({
            currency0: key.currency0,
            currency1: key.currency1,
            fee: key.fee,
            tickSpacing: key.tickSpacing,
            hooks: IHooks(address(this))
        }).toId();

        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool isC0 = (usdc_ == c0);
        require(isC0 || usdc_ == c1, "usdc not in pool");
        usdcIsCurrency0 = isC0;
        usdc      = IERC20(usdc_);
        teamToken = IERC20(isC0 ? c1 : c0);

        // Address must carry exactly the beforeSwap|afterSwap permission bits (mined CREATE2).
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: false, afterInitialize: false,
                beforeAddLiquidity: false, afterAddLiquidity: false,
                beforeRemoveLiquidity: false, afterRemoveLiquidity: false,
                beforeSwap: true, afterSwap: true,
                beforeDonate: false, afterDonate: false,
                beforeSwapReturnDelta: false, afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false, afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    // ── admin ──────────────────────────────────────────────────────────────────
    function setJitThreshold(uint256 t) external onlyOwner { jitThreshold = t; emit JitThresholdSet(t); }
    function setJitWidth(int24 s) external onlyOwner { require(s > 0, "width"); jitWidthSpacings = s; emit JitWidthSet(s); }
    /// @notice Exempt an initiator (the LP module) from firing JIT on its own swaps.
    function setJitSkipSender(address s) external onlyOwner { jitSkipSender = s; }

    // ── IHooks: the two active callbacks ────────────────────────────────────────

    /// @notice On a team→USDC swap (output = USDC), borrow a bounded slice + open a tight single-sided
    ///         USDC position. Never reverts the swap path (a revert would brick the pool).
    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24)
    {
        // AUDIT (Cork class): only ever act on the canonical pool. A swap on any other pool that names
        // this hook no-ops (never reverts — a revert would brick that pool for its users).
        if (PoolId.unwrap(key.toId()) != PoolId.unwrap(canonicalPoolId)) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        bool usdcIsOutput = params.zeroForOne ? !usdcIsCurrency0 : usdcIsCurrency0;
        uint256 mag = params.amountSpecified < 0
            ? uint256(-params.amountSpecified)
            : uint256(params.amountSpecified);

        if (usdcIsOutput && mag >= jitThreshold && sender != jitSkipSender) {
            _open(key, params.zeroForOne, mag);
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @notice Close the JIT position and MINT ERC-6909 claims for the owed tokens (can't take physical
    ///         here — see the afterSwap-gotcha NatSpec). The keeper `sweepJit()` converts + settles.
    function afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        external override onlyPoolManager returns (bytes4, int128)
    {
        // AUDIT (Cork class): mirror the beforeSwap guard — never touch a non-canonical pool.
        if (PoolId.unwrap(key.toId()) != PoolId.unwrap(canonicalPoolId)) {
            return (IHooks.afterSwap.selector, int128(0));
        }
        if (jitLiquidity > 0) _close(key);
        return (IHooks.afterSwap.selector, int128(0));
    }

    // ── keeper: convert claims → USDC and settle with the vault ─────────────────

    /// @notice Redeem the accumulated ERC-6909 claims (post-swap, so the physical tokens now exist),
    ///         swap the team side to USDC, and return the total to the vault. Permissionless — anyone can
    ///         crank it; it only ever moves value from the pool back to the senior.
    function sweepJit() external returns (uint256 usdcReturned) {
        if (usdcClaim == 0 && teamClaim == 0) return 0;
        poolManager.unlock(""); // redeem + swap inside the unlock (see unlockCallback)
        usdcReturned = usdc.balanceOf(address(this));
        if (usdcReturned > 0) {
            usdc.safeTransfer(address(vault), usdcReturned);
            vault.settleJitReturn(usdcReturned);
        }
        emit JitSwept(usdcReturned);
    }

    function unlockCallback(bytes calldata) external override onlyPoolManager returns (bytes memory) {
        // 1. Redeem the USDC-side claims to physical.
        uint256 uc = usdcClaim;
        if (uc > 0) {
            uint256 avail = usdc.balanceOf(address(poolManager));
            uint256 r = uc < avail ? uc : avail;
            if (r > 0) {
                poolManager.burn(address(this), _usdcCurrency().toId(), r);
                poolManager.take(_usdcCurrency(), address(this), r);
                usdcClaim = uc - r;
            }
        }
        // 2. Redeem the team-side claims to physical.
        uint256 tc = teamClaim;
        if (tc > 0) {
            uint256 availT = teamToken.balanceOf(address(poolManager));
            uint256 rt = tc < availT ? tc : availT;
            if (rt > 0) {
                poolManager.burn(address(this), _teamCurrency().toId(), rt);
                poolManager.take(_teamCurrency(), address(this), rt);
                teamClaim = tc - rt;
            }
        }
        // 3. Swap all physical team → USDC (V4 auto-skips this hook's callbacks on its own swap).
        uint256 teamBal = teamToken.balanceOf(address(this));
        if (teamBal > 0) _swapTeamToUsdc(teamBal);
        return "";
    }

    // ── internals ────────────────────────────────────────────────────────────────

    function _open(PoolKey calldata key, bool zeroForOne, uint256 mag) private {
        uint256 lent = vault.borrowIdleForJit(mag);
        if (lent == 0) return;

        (uint160 sqrtP, int24 tick,,) = poolManager.getSlot0(key.toId());
        int24 spacing = _tickSpacing;
        int24 width = spacing * jitWidthSpacings;
        int24 lo;
        int24 hi;
        if (zeroForOne) {
            // output = currency1 (USDC); tight range just BELOW the tick, single-sided currency1.
            hi = _alignTick(tick, spacing);
            lo = hi - width;
        } else {
            // output = currency0 (USDC); tight range just ABOVE the tick, single-sided currency0.
            lo = _alignTick(tick, spacing) + spacing;
            hi = lo + width;
        }
        // AUDIT M6: clamp to usable ticks. Near a tick extreme, lo/hi can fall outside [MIN,MAX] and
        // TickMath.getSqrtPriceAtTick would revert INSIDE beforeSwap — bricking the pool. If the range
        // is unusable, no-op the JIT (return the borrow) rather than let the swap revert.
        if (lo < TickMath.minUsableTick(spacing) || hi > TickMath.maxUsableTick(spacing) || lo >= hi) {
            usdc.safeTransfer(address(vault), lent);
            vault.settleJitReturn(lent);
            return;
        }
        uint128 L = zeroForOne
            ? LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), lent)
            : LiquidityAmounts.getLiquidityForAmount0(TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), lent);
        if (L == 0) {
            // couldn't form a position — return the USDC to the vault (settles the borrow immediately).
            usdc.safeTransfer(address(vault), lent);
            vault.settleJitReturn(lent);
            return;
        }

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: int256(uint256(L)), salt: JIT_SALT}),
            ""
        );
        _settleDelta(key, delta);

        jitLiquidity = L;
        jitLower = lo;
        jitUpper = hi;
        emit JitOpened(lent, L);
        (sqrtP); // silence unused
    }

    function _close(PoolKey calldata key) private {
        uint128 L = jitLiquidity;
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: jitLower, tickUpper: jitUpper, liquidityDelta: -int256(uint256(L)), salt: JIT_SALT}),
            ""
        );
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        // Removal yields a non-negative delta per side; defensively pay any negative side.
        if (d0 < 0) _pay(key.currency0, uint256(uint128(-d0)));
        if (d1 < 0) _pay(key.currency1, uint256(uint128(-d1)));
        // MINT claims for the owed sides (physical isn't available until the swapper settles post-callback).
        uint256 owed0 = d0 > 0 ? uint256(uint128(d0)) : 0;
        uint256 owed1 = d1 > 0 ? uint256(uint128(d1)) : 0;
        if (owed0 > 0) poolManager.mint(address(this), key.currency0.toId(), owed0);
        if (owed1 > 0) poolManager.mint(address(this), key.currency1.toId(), owed1);

        (uint256 usdcOwed, uint256 teamOwed) = usdcIsCurrency0 ? (owed0, owed1) : (owed1, owed0);
        usdcClaim += usdcOwed;
        teamClaim += teamOwed;

        jitLiquidity = 0;
        emit JitClosed(usdcOwed, teamOwed);
    }

    function _swapTeamToUsdc(uint256 amountIn) private {
        bool zeroForOne = !usdcIsCurrency0; // selling team; team is currency0 iff usdc is currency1
        BalanceDelta delta = poolManager.swap(
            _key(),
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn), // exact input
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        _settleDelta(_key(), delta);
    }

    function _settleDelta(PoolKey memory key, BalanceDelta delta) private {
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0)      _pay(key.currency0, uint256(uint128(-d0)));
        else if (d0 > 0) poolManager.take(key.currency0, address(this), uint256(uint128(d0)));
        if (d1 < 0)      _pay(key.currency1, uint256(uint128(-d1)));
        else if (d1 > 0) poolManager.take(key.currency1, address(this), uint256(uint128(d1)));
    }

    function _pay(Currency currency, uint256 amount) private {
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    function _usdcCurrency() private view returns (Currency) { return usdcIsCurrency0 ? _c0 : _c1; }
    function _teamCurrency() private view returns (Currency) { return usdcIsCurrency0 ? _c1 : _c0; }

    function _key() private view returns (PoolKey memory) {
        return PoolKey({currency0: _c0, currency1: _c1, fee: _fee, tickSpacing: _tickSpacing, hooks: IHooks(address(this))});
    }

    function _alignTick(int24 tick, int24 spacing) private pure returns (int24) {
        int24 rounded = (tick / spacing) * spacing;
        if (tick < 0 && rounded != tick) rounded -= spacing;
        return rounded;
    }

    // ── IHooks: un-permissioned no-ops (never called — address lacks the bits) ──────

    function beforeInitialize(address, PoolKey calldata, uint160) external pure override returns (bytes4) {
        revert HookNotImplemented();
    }
    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure override returns (bytes4) {
        revert HookNotImplemented();
    }
    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external pure override returns (bytes4) { revert HookNotImplemented(); }
    function afterAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external pure override returns (bytes4, BalanceDelta) { revert HookNotImplemented(); }
    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external pure override returns (bytes4) { revert HookNotImplemented(); }
    function afterRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external pure override returns (bytes4, BalanceDelta) { revert HookNotImplemented(); }
    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external pure override returns (bytes4) { revert HookNotImplemented(); }
    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external pure override returns (bytes4) { revert HookNotImplemented(); }

    error HookNotImplemented();
}
