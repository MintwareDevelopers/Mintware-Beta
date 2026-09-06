// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {SeniorSharesMath} from "../lib/SeniorSharesMath.sol";
import {MintwareLpGatewayStaging} from "./MintwareLpGatewayStaging.sol";

/// @dev The one Permit2 call the official V4 PositionManager needs from us: it pulls settled tokens
///      via Permit2 on SETTLE_PAIR, so we pre-authorize it. Declared locally to avoid a permit2 remap.
interface IPermit2Minimal {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @title  MintwareLpGatewayPositionManager
/// @notice Phase-1 LP gateway: one aggregate Uniswap V4 position per pool, wrapping the OFFICIAL V4
///         PositionManager periphery. Depositors get entry-NAV shares (mark-to-market at deposit; no
///         fee-growth checkpoint accounting). Idle quote-asset earns in the staging reserve (Morpho)
///         until the owner deploys it into the pool's existing range. Harvest collects fees via a
///         zero-liquidity-delta call — principal is never touched — for the yield-first spend buffer.
/// @dev    Deliberately thin: all position math is Uniswap's audited periphery (PositionManager +
///         LiquidityAmounts) and pool state is read via StateLibrary. NAV values the deployed leg at
///         the current pool (spot) price — an LP position is IL-exposed by construction, so this is
///         the honest mark; NO par or guaranteed-value claim is made or implied anywhere.
///         Separate product surface: touches none of the vault / JIT / YPN-treasury contracts.
contract MintwareLpGatewayPositionManager is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint256 private constant VIRTUAL = 1e6;
    uint256 private constant Q96 = 0x1000000000000000000000000;

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    IPermit2Minimal public immutable permit2;
    MintwareLpGatewayStaging public immutable staging;

    IERC20 public immutable quoteAsset;
    IERC20 public immutable pairedAsset;
    bool public immutable quoteIsCurrency0;

    PoolKey internal _poolKey;
    int24 public immutable tickLower;
    int24 public immutable tickUpper;

    uint256 public tokenId; // 0 until the first deploy mints the aggregate position
    address public harvestRecipient;

    mapping(address => uint256) public sharesOf;
    uint256 public totalShares;

    error ZeroAmount();
    error ZeroShares();
    error ZeroAddress();
    error QuoteNotInPool();
    error InsufficientShares();
    error NotDeployed();

    event Deposited(address indexed user, uint256 quoteIn, uint256 sharesMinted);
    event Withdrawn(address indexed user, uint256 sharesBurned, uint256 quoteOut, uint256 pairedOut);
    event Deployed(uint256 indexed tokenId, uint256 quoteUsed, uint256 pairedUsed, uint128 liquidity);
    event Harvested(uint256 quoteFees, uint256 pairedFees, address indexed recipient);
    event HarvestRecipientSet(address indexed recipient);

    constructor(
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        IPermit2Minimal permit2_,
        PoolKey memory poolKey_,
        IERC20 quoteAsset_,
        int24 tickLower_,
        int24 tickUpper_,
        MintwareLpGatewayStaging staging_,
        address owner_,
        address harvestRecipient_
    ) Ownable(owner_) {
        if (
            address(poolManager_) == address(0) || address(positionManager_) == address(0)
                || address(permit2_) == address(0) || address(staging_) == address(0)
                || address(quoteAsset_) == address(0) || harvestRecipient_ == address(0)
        ) revert ZeroAddress();

        address c0 = Currency.unwrap(poolKey_.currency0);
        address c1 = Currency.unwrap(poolKey_.currency1);
        bool q0 = c0 == address(quoteAsset_);
        if (!q0 && c1 != address(quoteAsset_)) revert QuoteNotInPool();

        poolManager = poolManager_;
        positionManager = positionManager_;
        permit2 = permit2_;
        staging = staging_;
        quoteAsset = quoteAsset_;
        quoteIsCurrency0 = q0;
        pairedAsset = IERC20(q0 ? c1 : c0);
        _poolKey = poolKey_;
        tickLower = tickLower_;
        tickUpper = tickUpper_;
        harvestRecipient = harvestRecipient_;
    }

    function poolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    function setHarvestRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        harvestRecipient = recipient;
        emit HarvestRecipientSet(recipient);
    }

    // ── depositor entry ──────────────────────────────────────────────────────────────────────

    /// @notice Deposit quote-asset; it stages into the yield reserve (earns immediately) and mints
    ///         entry-NAV shares in the aggregate gateway position. Not a deposit/savings product.
    function deposit(uint256 quoteAmount) external nonReentrant returns (uint256 sharesMinted) {
        if (quoteAmount == 0) revert ZeroAmount();
        // Price at the NAV BEFORE this deposit lands, so the depositor buys in at the live mark.
        uint256 navBefore = totalNav();
        sharesMinted = SeniorSharesMath.toShares(quoteAmount, totalShares, navBefore, VIRTUAL, Math.Rounding.Floor);
        if (sharesMinted == 0) revert ZeroShares();

        quoteAsset.safeTransferFrom(msg.sender, address(this), quoteAmount);
        quoteAsset.forceApprove(address(staging), quoteAmount);
        staging.stage(quoteAmount);

        sharesOf[msg.sender] += sharesMinted;
        totalShares += sharesMinted;
        emit Deposited(msg.sender, quoteAmount, sharesMinted);
    }

    /// @notice Redeem shares for the pro-rata underlying: your fraction of the idle reserve (quote) and,
    ///         if any is deployed, your fraction of the LP position (both legs). The LP portion is
    ///         subject to the current pool price and impermanent loss — there is no par guarantee.
    function withdraw(uint256 shares)
        external
        nonReentrant
        returns (uint256 quoteOut, uint256 pairedOut)
    {
        uint256 bal = sharesOf[msg.sender];
        if (shares == 0) revert ZeroAmount();
        if (shares > bal) revert InsufficientShares();

        uint256 ts = totalShares;
        // Offset-consistent claim value (quote terms) — MUST match the deposit formula, or a
        // donation-inflated raw pro-rata claim would over-withdraw. The virtual offset stays locked.
        uint256 claimValue = SeniorSharesMath.toAssets(shares, totalNav(), ts, VIRTUAL, Math.Rounding.Floor);

        // Effects before interactions.
        sharesOf[msg.sender] = bal - shares;
        totalShares = ts - shares;

        // Idle reserve first (pure quote).
        uint256 fromIdle = Math.min(claimValue, staging.stagedAssets());
        if (fromIdle > 0) {
            uint256 got = staging.unstage(fromIdle); // best-effort; returns actual to this contract
            if (got > 0) {
                quoteAsset.safeTransfer(msg.sender, got);
                quoteOut = got;
            }
        }

        // Remainder from the deployed LP: remove the liquidity worth `remaining` in quote value; the
        // depositor receives BOTH legs (IL-exposed, no par claim).
        uint256 remaining = claimValue > quoteOut ? claimValue - quoteOut : 0;
        if (remaining > 0 && tokenId != 0) {
            uint256 deployed = _deployedQuoteValue();
            if (deployed > 0) {
                uint128 liq = positionManager.getPositionLiquidity(tokenId);
                uint256 want = FullMath.mulDiv(liq, remaining, deployed);
                uint128 liqToRemove = want >= liq ? liq : uint128(want);
                if (liqToRemove > 0) {
                    (uint256 gotQuote, uint256 gotPaired) =
                        _decreaseAndTake(liqToRemove, msg.sender, block.timestamp);
                    quoteOut += gotQuote;
                    pairedOut += gotPaired;
                }
            }
        }

        emit Withdrawn(msg.sender, shares, quoteOut, pairedOut);
    }

    // ── owner: deploy staged capital into the pool ───────────────────────────────────────────

    /// @notice Owner-gated: pull `quoteToDeploy` from the staging reserve, take `pairedAmount` of the
    ///         paired leg from the caller (the pair/deploy cron zaps it via the MW router off-chain),
    ///         and add both to the aggregate V4 position. Mirrors the staged router's owner-only pair().
    function deploy(uint256 quoteToDeploy, uint256 pairedAmount, uint256 deadline)
        external
        onlyOwner
        nonReentrant
    {
        if (quoteToDeploy == 0 && pairedAmount == 0) revert ZeroAmount();

        uint256 quoteGot = quoteToDeploy == 0 ? 0 : staging.unstage(quoteToDeploy);
        if (pairedAmount > 0) pairedAsset.safeTransferFrom(msg.sender, address(this), pairedAmount);

        (uint256 amount0, uint256 amount1) =
            quoteIsCurrency0 ? (quoteGot, pairedAmount) : (pairedAmount, quoteGot);

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(_poolKey.toId());
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(tickUpper);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(sqrtPriceX96, sqrtA, sqrtB, amount0, amount1);
        if (liquidity == 0) revert ZeroShares();

        _permit(quoteAsset, quoteGot);
        _permit(pairedAsset, pairedAmount);

        uint256 quoteBefore = quoteAsset.balanceOf(address(this));
        uint256 pairedBefore = pairedAsset.balanceOf(address(this));

        if (tokenId == 0) {
            uint256 newId = positionManager.nextTokenId();
            _modify(_mintCalls(liquidity, uint128(amount0), uint128(amount1)), deadline);
            tokenId = newId;
        } else {
            _modify(_increaseCalls(liquidity, uint128(amount0), uint128(amount1)), deadline);
        }

        // Re-stage any unused quote; return any unused paired to the caller.
        uint256 quoteLeft = quoteAsset.balanceOf(address(this));
        uint256 pairedLeft = pairedAsset.balanceOf(address(this));
        uint256 quoteUsed = quoteBefore > quoteLeft ? quoteBefore - quoteLeft : 0;
        uint256 pairedUsed = pairedBefore > pairedLeft ? pairedBefore - pairedLeft : 0;
        if (quoteLeft > 0) {
            quoteAsset.forceApprove(address(staging), quoteLeft);
            staging.stage(quoteLeft);
        }
        if (pairedLeft > 0) pairedAsset.safeTransfer(msg.sender, pairedLeft);

        emit Deployed(tokenId, quoteUsed, pairedUsed, liquidity);
    }

    // ── owner: harvest fees (zero-liquidity-delta) → yield-first buffer ───────────────────────

    /// @notice Owner-gated: collect accrued fees WITHOUT touching principal (DECREASE_LIQUIDITY of 0)
    ///         and send them to the harvest recipient. The harvest cron then converts the paired leg
    ///         via the MW router and credits the spend buffer pro-rata. Principal shares are unaffected.
    function harvest(uint256 deadline) external onlyOwner nonReentrant returns (uint256 quoteFees, uint256 pairedFees) {
        if (tokenId == 0) revert NotDeployed();
        (quoteFees, pairedFees) = _decreaseAndTake(0, address(this), deadline);
        if (quoteFees > 0) quoteAsset.safeTransfer(harvestRecipient, quoteFees);
        if (pairedFees > 0) pairedAsset.safeTransfer(harvestRecipient, pairedFees);
        emit Harvested(quoteFees, pairedFees, harvestRecipient);
    }

    // ── NAV (quote-asset terms) ──────────────────────────────────────────────────────────────

    function totalNav() public view returns (uint256) {
        return staging.stagedAssets() + _deployedQuoteValue();
    }

    function _deployedQuoteValue() internal view returns (uint256) {
        if (tokenId == 0) return 0;
        uint128 liq = positionManager.getPositionLiquidity(tokenId);
        if (liq == 0) return 0;
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(_poolKey.toId());
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(tickUpper);
        (uint256 amt0, uint256 amt1) = _amountsForLiquidity(sqrtPriceX96, sqrtA, sqrtB, liq);
        (uint256 quoteLeg, uint256 pairedLeg) = quoteIsCurrency0 ? (amt0, amt1) : (amt1, amt0);
        return quoteLeg + _pairedToQuote(pairedLeg, sqrtPriceX96);
    }

    // Composed from v4-core SqrtPriceMath (getAmountsForLiquidity isn't in this periphery build). Rounds
    // down — NAV never overstates the position. Standard in-range / out-of-range branch selection.
    function _amountsForLiquidity(uint160 sqrtP, uint160 sqrtA, uint160 sqrtB, uint128 liq)
        internal
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        if (sqrtA > sqrtB) (sqrtA, sqrtB) = (sqrtB, sqrtA);
        if (sqrtP <= sqrtA) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtA, sqrtB, liq, false);
        } else if (sqrtP < sqrtB) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtP, sqrtB, liq, false);
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtP, liq, false);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtB, liq, false);
        }
    }

    // Value a paired-leg amount in quote terms at spot. token1/token0 price = (sqrtP/2^96)^2.
    function _pairedToQuote(uint256 pairedAmount, uint160 sqrtPriceX96) internal view returns (uint256) {
        if (pairedAmount == 0) return 0;
        if (quoteIsCurrency0) {
            // paired = currency1 → value in currency0: amount * (2^96/sqrtP)^2
            uint256 inter = FullMath.mulDiv(pairedAmount, Q96, sqrtPriceX96);
            return FullMath.mulDiv(inter, Q96, sqrtPriceX96);
        } else {
            // paired = currency0 → value in currency1: amount * (sqrtP/2^96)^2
            uint256 inter = FullMath.mulDiv(pairedAmount, sqrtPriceX96, Q96);
            return FullMath.mulDiv(inter, sqrtPriceX96, Q96);
        }
    }

    // ── internal V4 periphery encoding ───────────────────────────────────────────────────────

    function _permit(IERC20 token, uint256 amount) internal {
        if (amount == 0) return;
        token.forceApprove(address(permit2), amount);
        permit2.approve(address(token), address(positionManager), uint160(amount), uint48(block.timestamp + 1800));
    }

    function _modify(bytes memory unlockData, uint256 deadline) internal {
        positionManager.modifyLiquidities(unlockData, deadline);
    }

    function _mintCalls(uint128 liquidity, uint128 amount0Max, uint128 amount1Max)
        internal
        view
        returns (bytes memory)
    {
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            _poolKey, tickLower, tickUpper, uint256(liquidity), amount0Max, amount1Max, address(this), bytes("")
        );
        params[1] = abi.encode(_poolKey.currency0, _poolKey.currency1);
        return abi.encode(actions, params);
    }

    function _increaseCalls(uint128 liquidity, uint128 amount0Max, uint128 amount1Max)
        internal
        view
        returns (bytes memory)
    {
        bytes memory actions = abi.encodePacked(uint8(Actions.INCREASE_LIQUIDITY), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(liquidity), amount0Max, amount1Max, bytes(""));
        params[1] = abi.encode(_poolKey.currency0, _poolKey.currency1);
        return abi.encode(actions, params);
    }

    // DECREASE_LIQUIDITY (liquidity may be 0 → fee-only collect) + TAKE_PAIR. Always takes to self so
    // the collected amounts are measurable, then forwards to `recipient` when it isn't this contract.
    function _decreaseAndTake(uint128 liquidity, address recipient, uint256 deadline)
        internal
        returns (uint256 gotQuote, uint256 gotPaired)
    {
        uint256 qb = quoteAsset.balanceOf(address(this));
        uint256 pb = pairedAsset.balanceOf(address(this));

        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(liquidity), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(_poolKey.currency0, _poolKey.currency1, address(this));
        positionManager.modifyLiquidities(abi.encode(actions, params), deadline);

        gotQuote = quoteAsset.balanceOf(address(this)) - qb;
        gotPaired = pairedAsset.balanceOf(address(this)) - pb;
        if (recipient != address(this)) {
            if (gotQuote > 0) quoteAsset.safeTransfer(recipient, gotQuote);
            if (gotPaired > 0) pairedAsset.safeTransfer(recipient, gotPaired);
        }
    }
}
