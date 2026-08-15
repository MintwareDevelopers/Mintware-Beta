// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback}       from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
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
import {Ownable}   from "@openzeppelin/contracts/access/Ownable.sol";

import {ILiquidityModule} from "./ILiquidityModule.sol";

/// @dev The JIT hook's truncated-oracle reference (AUDIT #7/#3). Optional: if the pool's hook doesn't
///      implement it (or none is set), valuation falls back to spot.
interface IJitOracle {
    function oracleTick() external view returns (int24 tick, bool ready);
}

/// @title  MintwareV4LiquidityModule
/// @notice The REAL Uniswap-V4 implementation of `ILiquidityModule` — the LP seam behind
///         `MintwareTreasuryVault`. Drop-in for `MockLiquidityModule`: same four calls, same seniority
///         contract, **zero vault change**. The vault deploys senior USDC + junior team token as one
///         full-range V4 position held by THIS contract, and recovers USDC through it to serve senior
///         redemptions.
///
/// @dev    SENIORITY IS ENFORCED HERE, on a real pool:
///           • `recover` removes the value fraction of the position, then **swaps the recovered team
///             leg to USDC through the same pool** — i.e. the junior (team token) is *spent* to make the
///             senior (USDC) whole first. Returns USDC to the vault; team is not handed back (it was
///             sold), matching "junior spent first".
///           • `recoverableUSDC` marks the whole position to USDC at the CURRENT pool price (USDC leg +
///             team leg valued via the pool's `sqrtPriceX96`). This is the ONLY place a price enters the
///             system — exactly as the mock, so it is the correct RHS of the vault's solvency invariant
///             `deployedFromSenior <= recoverableUSDC()`.
///           • `collectFees` collects both-token fees and swaps the team leg to USDC so the vault only
///             ever receives USDC (the senior's yield unit).
///
/// @dev    ONLY the vault calls deploy/recover/collectFees (`onlyVault`); ONLY the PoolManager calls
///         `unlockCallback`. Every pool interaction runs inside a single `poolManager.unlock`, dispatched
///         by an op tag. The module holds no token balances between ops — it sweeps USDC/team to the
///         vault at the end of every op, so `used`/`returned`/`fees` are exact by construction.
///
/// @dev    Decimal-agnostic: all math is on RAW token amounts + the pool `sqrtPriceX96`. USDC's decimals
///         (6dp in production) vs the team token's (18dp) are encoded once in the pool's initialization
///         price by whoever creates the pool; this contract reads that price and never assumes decimals.
///         Full-range position (min/max usable tick for the pool's tickSpacing) — a passive, always-in-
///         range two-sided position; the JIT/surge hook that tightens ranges per-swap is a later layer
///         and composes in FRONT of this seam, not inside it.
contract MintwareV4LiquidityModule is ILiquidityModule, IUnlockCallback, Ownable {
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    uint256 private constant Q96 = 0x1000000000000000000000000; // 2**96

    IPoolManager public immutable poolManager;
    IERC20       public immutable usdc;      // senior settlement asset
    IERC20       public immutable teamToken; // junior reserve asset
    address      public immutable vault;

    // Pool key stored as immutables (structs can't be immutable) and rebuilt in `_key()`.
    Currency private immutable _c0;
    Currency private immutable _c1;
    uint24   private immutable _fee;
    int24    private immutable _tickSpacing;
    IHooks   private immutable _hooks;

    bool  public immutable usdcIsCurrency0; // token ordering (currency0 < currency1 by address)
    int24 public immutable tickLower;       // full-range lower (min usable tick)
    int24 public immutable tickUpper;       // full-range upper (max usable tick)

    /// @notice The module's live full-range liquidity (V4 `L` units). The vault reads value via
    ///         `recoverableUSDC`, not this raw number.
    uint128 public positionLiquidity;

    enum Op { DEPLOY, RECOVER, COLLECT }

    event Deployed(uint256 usdcUsed, uint256 teamUsed, uint128 liquidityAdded);
    event Recovered(uint256 usdcWanted, uint256 usdcReturned, uint128 liquidityRemoved);
    event FeesCollected(uint256 usdcFees);

    error OnlyVault();
    error OnlyPoolManager();
    error UsdcNotInPool();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    /// @param poolManager_ the V4 singleton.
    /// @param key          the USDC/teamToken pool this module LPs into (must already be initialized).
    /// @param usdc_        the senior asset; MUST be one of the pool's two currencies. The other
    ///                     currency is taken as the team/junior token.
    /// @param vault_       the sole caller of deploy/recover/collectFees.
    /// @param owner_       admin (reserved for future range governance; no privileged fund path today).
    constructor(address poolManager_, PoolKey memory key, address usdc_, address vault_, address owner_)
        Ownable(owner_)
    {
        poolManager = IPoolManager(poolManager_);
        vault       = vault_;

        _c0 = key.currency0;
        _c1 = key.currency1;
        _fee = key.fee;
        _tickSpacing = key.tickSpacing;
        _hooks = key.hooks;

        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool isC0 = (usdc_ == c0);
        if (!isC0 && usdc_ != c1) revert UsdcNotInPool();
        usdcIsCurrency0 = isC0;
        usdc      = IERC20(usdc_);
        teamToken = IERC20(isC0 ? c1 : c0);

        // Full-range: the widest tick multiples of the pool's spacing.
        int24 spacing = key.tickSpacing;
        tickLower = (TickMath.MIN_TICK / spacing) * spacing;
        tickUpper = (TickMath.MAX_TICK / spacing) * spacing;
    }

    // ── ILiquidityModule (vault-only) ─────────────────────────────────────────────

    /// @inheritdoc ILiquidityModule
    function deploy(uint256 usdcAmount, uint256 maxTeamToken)
        external onlyVault returns (uint256 usdcUsed, uint256 teamTokenUsed)
    {
        bytes memory out = poolManager.unlock(abi.encode(Op.DEPLOY, usdcAmount, maxTeamToken));
        (usdcUsed, teamTokenUsed) = abi.decode(out, (uint256, uint256));
    }

    /// @inheritdoc ILiquidityModule
    function recover(uint256 usdcWanted)
        external onlyVault returns (uint256 usdcReturned, uint256 teamTokenReturned)
    {
        bytes memory out = poolManager.unlock(abi.encode(Op.RECOVER, usdcWanted, uint256(0)));
        (usdcReturned, teamTokenReturned) = abi.decode(out, (uint256, uint256));
    }

    /// @inheritdoc ILiquidityModule
    function collectFees() external onlyVault returns (uint256 usdcFees) {
        bytes memory out = poolManager.unlock(abi.encode(Op.COLLECT, uint256(0), uint256(0)));
        usdcFees = abi.decode(out, (uint256));
    }

    /// @inheritdoc ILiquidityModule
    /// @dev MTM value of the whole position in USDC — the invariant's RHS. AUDIT (#7): this is the ONLY
    ///      price that enters solvency, so it must be un-gameable. We value at `min(spot, oracle)`: a
    ///      flash pump of spot is ignored (the truncated oracle lags, so `min` picks the lower oracle
    ///      value), while a genuine drop is respected (spot is lower). Using the oracle ALONE would be
    ///      wrong-signed — a lagged oracle during a real drop would over-report recoverable and mask an
    ///      under-covered senior; the `min` keeps it conservative in both directions. Falls back to spot
    ///      if the hook exposes no oracle (or it hasn't seen its first swap).
    function recoverableUSDC() public view returns (uint256) {
        if (positionLiquidity == 0) return 0;
        (uint160 spotSqrt,,,) = poolManager.getSlot0(_key().toId());
        uint256 vSpot = _valueAt(spotSqrt);

        (int24 oTick, bool ready) = _oracleTick();
        if (!ready) return vSpot;
        uint256 vOracle = _valueAt(TickMath.getSqrtPriceAtTick(oTick));
        return vSpot < vOracle ? vSpot : vOracle;
    }

    /// @dev Value the whole position in USDC at an arbitrary `sqrtP` (USDC leg at par + team leg priced).
    function _valueAt(uint160 sqrtP) private view returns (uint256) {
        uint160 sL = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sU = TickMath.getSqrtPriceAtTick(tickUpper);

        uint256 amt0;
        uint256 amt1;
        if (sqrtP <= sL) {
            amt0 = SqrtPriceMath.getAmount0Delta(sL, sU, positionLiquidity, false);
        } else if (sqrtP < sU) {
            amt0 = SqrtPriceMath.getAmount0Delta(sqrtP, sU, positionLiquidity, false);
            amt1 = SqrtPriceMath.getAmount1Delta(sL, sqrtP, positionLiquidity, false);
        } else {
            amt1 = SqrtPriceMath.getAmount1Delta(sL, sU, positionLiquidity, false);
        }

        (uint256 usdcAmt, uint256 teamAmt) = usdcIsCurrency0 ? (amt0, amt1) : (amt1, amt0);
        return usdcAmt + _valueTeamInUsdc(teamAmt, sqrtP);
    }

    /// @dev Read the hook's truncated-oracle tick; not-ready (→ spot fallback) if the pool has no
    ///      oracle-exposing hook. try/catch so a plain/mock hook never bricks valuation.
    function _oracleTick() private view returns (int24 tick, bool ready) {
        address hook = address(_hooks);
        if (hook == address(0)) return (0, false);
        try IJitOracle(hook).oracleTick() returns (int24 t, bool r) {
            return (t, r);
        } catch {
            return (0, false);
        }
    }

    // ── unlock dispatch (PoolManager-only) ─────────────────────────────────────────

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (Op op, uint256 a, uint256 b) = abi.decode(raw, (Op, uint256, uint256));
        if (op == Op.DEPLOY) return _deploy(a, b);
        if (op == Op.RECOVER) return _recover(a);
        return _collect();
    }

    // ── op bodies (inside unlock) ───────────────────────────────────────────────────

    function _deploy(uint256 usdcAmount, uint256 maxTeamToken) private returns (bytes memory) {
        PoolKey memory key = _key();
        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
        uint160 sL = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sU = TickMath.getSqrtPriceAtTick(tickUpper);

        (uint256 a0, uint256 a1) =
            usdcIsCurrency0 ? (usdcAmount, maxTeamToken) : (maxTeamToken, usdcAmount);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(sqrtP, sL, sU, a0, a1);
        if (liq == 0) return abi.encode(uint256(0), uint256(0));

        // Pull the full approved budget from the vault, add liquidity, then refund the unused portion —
        // so `used` is exact regardless of the pool's internal rounding.
        if (usdcAmount > 0) usdc.safeTransferFrom(vault, address(this), usdcAmount);
        if (maxTeamToken > 0) teamToken.safeTransferFrom(vault, address(this), maxTeamToken);

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(uint256(liq)), salt: bytes32(0)}),
            ""
        );
        _settleDelta(key, delta);
        positionLiquidity += liq;

        uint256 leftUsdc = usdc.balanceOf(address(this));
        uint256 leftTeam = teamToken.balanceOf(address(this));
        if (leftUsdc > 0) usdc.safeTransfer(vault, leftUsdc);
        if (leftTeam > 0) teamToken.safeTransfer(vault, leftTeam);

        uint256 usdcUsed = usdcAmount - leftUsdc;
        uint256 teamUsed = maxTeamToken - leftTeam;
        emit Deployed(usdcUsed, teamUsed, liq);
        return abi.encode(usdcUsed, teamUsed);
    }

    function _recover(uint256 usdcWanted) private returns (bytes memory) {
        uint128 liq = positionLiquidity;
        uint256 rec = recoverableUSDC();
        if (rec == 0 || liq == 0 || usdcWanted == 0) return abi.encode(uint256(0), uint256(0));

        uint256 give = usdcWanted < rec ? usdcWanted : rec;
        uint128 lrem = uint128(FullMath.mulDiv(liq, give, rec));
        if (lrem == 0) return abi.encode(uint256(0), uint256(0));
        if (lrem > liq) lrem = liq;

        PoolKey memory key = _key();
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: -int256(uint256(lrem)), salt: bytes32(0)}),
            ""
        );
        _settleDelta(key, delta); // module now holds the removed USDC + team legs
        positionLiquidity = liq - lrem;

        // Seniority: sell the recovered team leg to USDC so the senior is made whole in USDC.
        uint256 teamBal = teamToken.balanceOf(address(this));
        if (teamBal > 0) _swapTeamToUsdc(key, teamBal);

        uint256 usdcReturned = usdc.balanceOf(address(this));
        uint256 teamReturned = teamToken.balanceOf(address(this)); // dust after the swap (~0)
        if (usdcReturned > 0) usdc.safeTransfer(vault, usdcReturned);
        if (teamReturned > 0) teamToken.safeTransfer(vault, teamReturned);

        emit Recovered(usdcWanted, usdcReturned, lrem);
        return abi.encode(usdcReturned, teamReturned);
    }

    function _collect() private returns (bytes memory) {
        PoolKey memory key = _key();
        // liquidityDelta 0 collects accrued fees for the position (salt 0).
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(0), salt: bytes32(0)}),
            ""
        );
        _settleDelta(key, delta);

        // Swap the team-side fees to USDC so the vault receives a single USDC number.
        uint256 teamBal = teamToken.balanceOf(address(this));
        if (teamBal > 0) _swapTeamToUsdc(key, teamBal);

        uint256 usdcFees = usdc.balanceOf(address(this));
        if (usdcFees > 0) usdc.safeTransfer(vault, usdcFees);
        uint256 teamDust = teamToken.balanceOf(address(this));
        if (teamDust > 0) teamToken.safeTransfer(vault, teamDust);

        emit FeesCollected(usdcFees);
        return abi.encode(usdcFees);
    }

    // ── internals ───────────────────────────────────────────────────────────────────

    /// @notice Band, in ticks, the unwind swap may move price past the truncated oracle before it stops
    ///         (AUDIT #3). ~5% — enough for a normal junior realization, tight enough that a sandwich
    ///         that pushed spot far past the oracle only converts to the band, not to the manipulated
    ///         price. Beyond the band the swap under-converts and the leftover team returns to the junior.
    int24 private constant SWAP_BAND_TICKS = 500;

    /// @dev Swap `amountIn` team token → USDC (exact-input), settling the delta. AUDIT (#3): the price
    ///      limit is the truncated-oracle price ± the band, NOT the full range — so a sandwich that moved
    ///      spot can't force the unwind to realize at the manipulated price. Clamped to the executable
    ///      side of the current spot so it can NEVER revert (a redemption must not brick): if spot is
    ///      already past the band, the swap converts ~nothing and the team leg flows back to the junior.
    function _swapTeamToUsdc(PoolKey memory key, uint256 amountIn) private {
        bool zeroForOne = !usdcIsCurrency0; // selling team; team is currency0 iff usdc is currency1
        (uint160 cur,,,) = poolManager.getSlot0(key.toId());
        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn), // negative = exact input
                sqrtPriceLimitX96: _swapLimit(zeroForOne, cur)
            }),
            ""
        );
        _settleDelta(key, delta);
    }

    /// @dev The oracle-bounded price limit for an unwind swap, clamped to the executable side of `cur`.
    function _swapLimit(bool zeroForOne, uint160 cur) private view returns (uint160) {
        (int24 oTick, bool ready) = _oracleTick();
        if (!ready) return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
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

    /// @dev Value `teamAmt` raw team tokens in USDC at the pool price `sqrtP`, staged through `Q96` twice
    ///      so `sqrtP^2` never overflows. USDC-as-currency0 → team is currency1 (divide by price); USDC-
    ///      as-currency1 → team is currency0 (multiply by price).
    function _valueTeamInUsdc(uint256 teamAmt, uint160 sqrtP) private view returns (uint256) {
        if (teamAmt == 0) return 0;
        if (usdcIsCurrency0) {
            // teamAmt (currency1) / price, price = (sqrtP/Q96)^2  →  teamAmt * Q96/sqrtP * Q96/sqrtP
            uint256 half = FullMath.mulDiv(teamAmt, Q96, sqrtP);
            return FullMath.mulDiv(half, Q96, sqrtP);
        } else {
            // teamAmt (currency0) * price  →  teamAmt * sqrtP/Q96 * sqrtP/Q96
            uint256 half = FullMath.mulDiv(teamAmt, sqrtP, Q96);
            return FullMath.mulDiv(half, sqrtP, Q96);
        }
    }

    /// @dev Settle a pool delta: pay what we owe (negative), take what we're owed (positive).
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

    function _key() private view returns (PoolKey memory) {
        return PoolKey({currency0: _c0, currency1: _c1, fee: _fee, tickSpacing: _tickSpacing, hooks: _hooks});
    }
}
