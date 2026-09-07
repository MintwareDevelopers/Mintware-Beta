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
    // Fee recipient is fixed at construction — the owner can never redirect the harvested fee stream to
    // a fresh address after the fact (removes the owner-fee-redirect finding). Set via the factory.
    address public immutable harvestRecipient;

    // Manipulation-resistant valuation for the spot-priced LP leg (findings C1 / H-03). Hookless pools have
    // no on-chain TWAP, so we keep a CLAMPED-FOLLOWER reference sqrtPrice (`_refSqrtPrice`) that tracks spot
    // by at most `maxDeviationBps` per block (`_anchorFollow`). NAV is then marked CONSERVATIVELY per
    // direction: a withdrawal values the LP leg at min(spot, ref), a deposit at max(spot, ref) — so a
    // single-block price pump can neither inflate a withdrawal claim nor cheapen a deposit. Neither path
    // reverts on price, so withdrawals never brick (finding M-01); the follower + conservative mark do the
    // work, and there is no owner `pokePrice` that could re-anchor to a manipulated price (finding M-02).
    // Residual: a patient CROSS-block manipulator on a THIN pool can still walk the follower (bounded by the
    // per-block step) — deep-pool curation + a capped deploy fraction are the economic backstop, audit-gated.
    uint16 public immutable maxDeviationBps;
    uint160 internal _refSqrtPrice;
    uint64 internal _refBlock;
    mapping(address => uint256) internal _lastActionBlock; // no deposit+withdraw in one block per user

    mapping(address => uint256) public sharesOf;
    uint256 public totalShares;

    error ZeroAmount();
    error ZeroShares();
    error ZeroAddress();
    error QuoteNotInPool();
    error InsufficientShares();
    error NotDeployed();
    error SameBlockAction();
    error BadDeviationBand();
    error MinLiquidityNotMet();
    error RenounceDisabled();

    event Deposited(address indexed user, uint256 quoteIn, uint256 sharesMinted);
    event Withdrawn(address indexed user, uint256 sharesBurned, uint256 quoteOut, uint256 pairedOut);
    event Deployed(uint256 indexed tokenId, uint256 quoteUsed, uint256 pairedUsed, uint128 liquidity);
    event Harvested(uint256 quoteFees, uint256 pairedFees, address indexed recipient);
    event PriceAnchored(uint160 sqrtPriceX96, uint256 blockNumber);

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
        address harvestRecipient_,
        uint16 maxDeviationBps_
    ) Ownable(owner_) {
        if (
            address(poolManager_) == address(0) || address(positionManager_) == address(0)
                || address(permit2_) == address(0) || address(staging_) == address(0)
                || address(quoteAsset_) == address(0) || harvestRecipient_ == address(0)
        ) revert ZeroAddress();
        // Band on the spot-vs-anchor sqrtPrice deviation: must be a real, non-trivial guard (>0) and
        // not so wide it never fires (<=50%). 2000 bps (20% sqrtPrice ≈ 44% price move between anchors)
        // is the sane meme-pool default the factory passes.
        if (maxDeviationBps_ == 0 || maxDeviationBps_ > 5000) revert BadDeviationBand();

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
        maxDeviationBps = maxDeviationBps_;
    }

    function poolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    /// @notice Disabled — renouncing ownership would strip the deploy/harvest operator and leave the
    ///         deployed position unmanageable. Ownership moves via the two-step transfer instead. (M-01/L-06)
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /// @dev Clamped-follower reference. Moves `_refSqrtPrice` toward current spot by at most
    ///      `maxDeviationBps` per block, so it tracks a legitimate trend over a few blocks while a
    ///      single-block flash pump can only nudge it one step (never onto the manipulated price). Called
    ///      after every deposit / withdraw / deploy / harvest. Never reverts — availability first (M-01).
    ///      No-op until the first deploy (idle-only NAV is Morpho, offset-defended).
    function _anchorFollow() internal {
        if (tokenId == 0) return;
        uint160 spot = _spot();
        uint160 ref = _refSqrtPrice;
        if (ref == 0) {
            _refSqrtPrice = spot;
            _refBlock = uint64(block.number);
            emit PriceAnchored(spot, block.number);
            return;
        }
        if (block.number <= _refBlock) return; // at most one follow-step per block
        uint160 maxStep = uint160((uint256(ref) * maxDeviationBps) / 10_000);
        uint160 next;
        if (spot > ref) {
            next = (spot - ref) > maxStep ? ref + maxStep : spot;
        } else {
            next = (ref - spot) > maxStep ? ref - maxStep : spot;
        }
        _refSqrtPrice = next;
        _refBlock = uint64(block.number);
        emit PriceAnchored(next, block.number);
    }

    /// @dev The reference sqrtPrice for a conservative mark — the follower if set, else current spot.
    function _refOrSpot(uint160 spot) internal view returns (uint160) {
        uint160 ref = _refSqrtPrice;
        return ref == 0 ? spot : ref;
    }

    function _spot() internal view returns (uint160 s) {
        (s,,,) = poolManager.getSlot0(_poolKey.toId());
    }

    // ── depositor entry ──────────────────────────────────────────────────────────────────────

    /// @notice Deposit quote-asset; it stages into the yield reserve (earns immediately) and mints
    ///         entry-NAV shares in the aggregate gateway position. Not a deposit/savings product.
    function deposit(uint256 quoteAmount) external nonReentrant returns (uint256 sharesMinted) {
        if (quoteAmount == 0) revert ZeroAmount();
        if (_lastActionBlock[msg.sender] == block.number) revert SameBlockAction();
        _lastActionBlock[msg.sender] = block.number;
        // Conservative entry NAV (LP leg marked at max(spot, ref)) so a deflated spot can't cheapen entry
        // and dilute existing holders (finding H-03). No revert — the conservative mark is the defense.
        uint256 navBefore = _navDeposit();
        sharesMinted = SeniorSharesMath.toShares(quoteAmount, totalShares, navBefore, VIRTUAL, Math.Rounding.Floor);
        if (sharesMinted == 0) revert ZeroShares();

        quoteAsset.safeTransferFrom(msg.sender, address(this), quoteAmount);
        quoteAsset.forceApprove(address(staging), quoteAmount);
        staging.stage(quoteAmount);

        sharesOf[msg.sender] += sharesMinted;
        totalShares += sharesMinted;
        _anchorFollow(); // advance the clamped-follower reference (no-op until deployed)
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
        if (_lastActionBlock[msg.sender] == block.number) revert SameBlockAction();
        _lastActionBlock[msg.sender] = block.number;

        uint256 ts = totalShares;
        uint256 idle = staging.stagedAssets();
        // CONSERVATIVE claim: LP leg marked at min(spot, ref) so a pumped spot can't inflate the claim
        // (finding H-03). Offset-consistent with deposit (a donation can't over-withdraw). No revert on
        // price — withdrawals stay available (finding M-01). No spot read until the pool is deployed.
        uint256 deployedSpotVal;
        uint256 navW = idle;
        if (tokenId != 0) {
            uint160 spot = _spot();
            deployedSpotVal = _deployedQuoteValueAt(spot);
            navW = idle + Math.min(deployedSpotVal, _deployedQuoteValueAt(_refOrSpot(spot)));
        }
        uint256 claimValue = SeniorSharesMath.toAssets(shares, navW, ts, VIRTUAL, Math.Rounding.Floor);

        // Effects before interactions.
        sharesOf[msg.sender] = bal - shares;
        totalShares = ts - shares;

        // PRO-RATA sourcing (finding M-06): the withdrawer's proportional slice of the idle reserve, not
        // idle-first (which is a first-mover / bank-run advantage); the rest comes from the LP.
        uint256 fromIdle = navW == 0 ? 0 : FullMath.mulDiv(claimValue, idle, navW);
        if (fromIdle > idle) fromIdle = idle;
        if (fromIdle > 0) {
            uint256 got = staging.unstage(fromIdle); // best-effort; returns actual to this contract
            if (got > 0) {
                quoteAsset.safeTransfer(msg.sender, got);
                quoteOut = got;
            }
        }

        // Remainder (LP target + any idle shortfall) from the deployed position. Sweep the position's fees
        // to the buffer FIRST so this decrease returns PRINCIPAL ONLY (finding H-02); size the removal by
        // the SPOT deployed value so the physical payout equals the conservative `remaining` (no over-pay).
        uint256 remaining = claimValue > quoteOut ? claimValue - quoteOut : 0;
        if (remaining > 0 && tokenId != 0) {
            _sweepFees(block.timestamp); // H-02: fees route to harvestRecipient, never the withdrawer
            if (deployedSpotVal > 0) {
                uint128 liq = positionManager.getPositionLiquidity(tokenId);
                uint256 want = FullMath.mulDiv(liq, remaining, deployedSpotVal);
                uint128 liqToRemove = want >= liq ? liq : uint128(want);
                if (liqToRemove > 0) {
                    (uint256 gotQuote, uint256 gotPaired) =
                        _decreaseAndTake(liqToRemove, msg.sender, block.timestamp);
                    quoteOut += gotQuote;
                    pairedOut += gotPaired;
                }
            }
        }

        _anchorFollow(); // advance the clamped-follower reference
        emit Withdrawn(msg.sender, shares, quoteOut, pairedOut);
    }

    // ── owner: deploy staged capital into the pool ───────────────────────────────────────────

    /// @notice Owner-gated: pull `quoteToDeploy` from the staging reserve, take `pairedAmount` of the
    ///         paired leg from the caller (the pair/deploy cron zaps it via the MW router off-chain),
    ///         and add both to the aggregate V4 position. Mirrors the staged router's owner-only pair().
    function deploy(uint256 quoteToDeploy, uint256 pairedAmount, uint128 minLiquidity, uint256 deadline)
        external
        onlyOwner
        nonReentrant
    {
        if (quoteToDeploy == 0 && pairedAmount == 0) revert ZeroAmount();

        // Sweep the existing position's accrued fees to the buffer BEFORE increasing, so the INCREASE never
        // folds trading fees into the re-stage / paired-return below (finding H-02). No-op on first deploy.
        _sweepFees(deadline);

        uint256 quoteGot = quoteToDeploy == 0 ? 0 : staging.unstage(quoteToDeploy);
        if (pairedAmount > 0) pairedAsset.safeTransferFrom(msg.sender, address(this), pairedAmount);

        (uint256 amount0, uint256 amount1) =
            quoteIsCurrency0 ? (quoteGot, pairedAmount) : (pairedAmount, quoteGot);

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(_poolKey.toId());
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(tickUpper);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(sqrtPriceX96, sqrtA, sqrtB, amount0, amount1);
        if (liquidity == 0) revert ZeroShares();
        if (liquidity < minLiquidity) revert MinLiquidityNotMet(); // caller's slippage floor (finding M-03)

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

        // Revoke any residual Permit2 allowance the mint rounding left dangling (finding L-04).
        _revokePermit(quoteAsset);
        _revokePermit(pairedAsset);

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

        _anchorFollow(); // advance the clamped-follower reference at this owner-set price
        emit Deployed(tokenId, quoteUsed, pairedUsed, liquidity);
    }

    // ── owner: harvest fees (zero-liquidity-delta) → yield-first buffer ───────────────────────

    /// @notice Owner-gated: collect accrued fees WITHOUT touching principal (DECREASE_LIQUIDITY of 0)
    ///         and send them to the harvest recipient. The harvest cron then converts the paired leg
    ///         via the MW router and credits the spend buffer pro-rata. Principal shares are unaffected.
    function harvest(uint256 deadline) external onlyOwner nonReentrant returns (uint256 quoteFees, uint256 pairedFees) {
        if (tokenId == 0) revert NotDeployed();
        (quoteFees, pairedFees) = _sweepFees(deadline);
        _anchorFollow();
    }

    /// @dev Collect ALL accrued position fees (zero-liquidity delta) to `harvestRecipient`. The shared
    ///      fee-collection primitive: used by harvest AND called before any principal decrease (withdraw)
    ///      or increase (deploy) so those paths never hand the position's fees to a depositor (finding H-02).
    function _sweepFees(uint256 deadline) internal returns (uint256 quoteFees, uint256 pairedFees) {
        if (tokenId == 0) return (0, 0);
        (quoteFees, pairedFees) = _decreaseAndTake(0, address(this), deadline);
        if (quoteFees > 0) quoteAsset.safeTransfer(harvestRecipient, quoteFees);
        if (pairedFees > 0) pairedAsset.safeTransfer(harvestRecipient, pairedFees);
        if (quoteFees != 0 || pairedFees != 0) emit Harvested(quoteFees, pairedFees, harvestRecipient);
    }

    // ── NAV (quote-asset terms) ──────────────────────────────────────────────────────────────

    /// @notice Spot NAV (quote terms) — for display + as the follower's input. Deposit/withdraw price off
    ///         the direction-conservative marks (max/min of spot vs the follower), not this.
    function totalNav() public view returns (uint256) {
        if (tokenId == 0) return staging.stagedAssets(); // no spot read until deployed
        return staging.stagedAssets() + _deployedQuoteValueAt(_spot());
    }

    /// @dev NAV that MINTS deposit shares: LP leg at max(spot, ref) so a deflated spot can't cheapen entry.
    function _navDeposit() internal view returns (uint256) {
        if (tokenId == 0) return staging.stagedAssets(); // idle-only until deployed — no spot read
        uint160 spot = _spot();
        return staging.stagedAssets() + Math.max(_deployedQuoteValueAt(spot), _deployedQuoteValueAt(_refOrSpot(spot)));
    }

    /// @dev Deployed-leg quote value with BOTH the composition and the paired-leg valuation taken at
    ///      `price` — so a conservative reference price yields a conservative value. Rounds down.
    function _deployedQuoteValueAt(uint160 price) internal view returns (uint256) {
        if (tokenId == 0) return 0;
        uint128 liq = positionManager.getPositionLiquidity(tokenId);
        if (liq == 0) return 0;
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(tickUpper);
        (uint256 amt0, uint256 amt1) = _amountsForLiquidity(price, sqrtA, sqrtB, liq);
        (uint256 quoteLeg, uint256 pairedLeg) = quoteIsCurrency0 ? (amt0, amt1) : (amt1, amt0);
        return quoteLeg + _pairedToQuote(pairedLeg, price);
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

    /// @dev Zero the Permit2 allowance the PositionManager holds for `token` (finding L-04) — the mint
    ///      rounding leaves a small residual approval otherwise.
    function _revokePermit(IERC20 token) internal {
        permit2.approve(address(token), address(positionManager), 0, 0);
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
