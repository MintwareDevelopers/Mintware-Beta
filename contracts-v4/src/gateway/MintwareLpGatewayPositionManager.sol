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
    // Hard ceiling on the fraction of depositor PRINCIPAL (cost basis, not marked value) that may sit in the LP
    // (re-audit A-3; red-team RT-9a). The off-chain "capped deploy fraction" was per-run and converged to
    // ~100%; a cap on MARKED value re-opened after every drawdown (a dumping paired token let the honest
    // top-up rule cycle 2/3 of principal into the pool). Cost basis never falls with price, so "at most half
    // of what depositors put in is ever LP-exposed" is an on-chain invariant a compromised owner key cannot
    // override. Constant (not owner-settable) by design.
    uint16 public constant MAX_DEPLOY_BPS = 5000;

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
    /// @notice Quote principal currently in the LP at COST (what `deploy` pulled from staging, reduced pro-rata
    ///         as shares exit). Never moves with price — the base of the MAX_DEPLOY_BPS cap (RT-9a).
    uint256 public deployedPrincipal;
    /// @notice Minimum delay between proposing a new harvest recipient and it taking effect (F-02 rec. 3).
    uint256 public constant HARVEST_RECIPIENT_DELAY = 48 hours;

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

    // Owner circuit-breaker (item 13). Blocks NEW deposits only — withdraw is ALWAYS allowed, so a pause
    // can never trap depositor funds. Set by the operator (or the keeper on a sustained out-of-range alert).
    bool public paused;

    // ── storage appended AFTER `paused` (audit closeout 2026-09-08) so the slots above — in particular
    //    `_refSqrtPrice` at slot 7, which test/audit/RedTeamOnchainFork probes via vm.load — do not shift. ──

    // Harvest fee recipient (F-02 rec. 3 / consolidated §4). Was `immutable` — which meant a USDG issuer freeze of
    // the operator hot wallet (F-02b) had NO on-chain recovery. It is now rotatable, but ONLY through a 48h
    // timelock: `proposeHarvestRecipient` → wait `HARVEST_RECIPIENT_DELAY` → `acceptHarvestRecipient`. Every
    // sweep in that window still pays the CURRENT recipient, so a compromised owner key cannot redirect an
    // in-flight fee stream instantly — the operator has 48h to see the `HarvestRecipientProposed` event and
    // cancel / rotate the key. (Packs with `paused` in the same slot.)
    address public harvestRecipient;
    address public pendingHarvestRecipient;
    uint64 public harvestRecipientEta; // earliest timestamp `acceptHarvestRecipient` succeeds (0 = no rotation)

    /// @notice The idle (staged) quote balance from the LAST SUCCESSFUL read of `staging.stagedAssets()` (C-10 /
    ///         RT-5f). Refreshed by every state-changing path that reads the reserve. Used ONLY when the yield
    ///         source stops answering, to size the idle entitlement a withdrawer is re-credited for — see `_withdraw`.
    uint256 public lastKnownIdle;

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
    error DepositsPaused();
    error DeployCapExceeded(); // A-3: total deployed would exceed MAX_DEPLOY_BPS of NAV
    error DeployPriceOutOfBand(); // A-3: spot too far from the clamped-follower reference (sandwich guard)
    error HookedPoolUnsupported(); // A-6: the no-callback / conservative-mark model assumes a hookless pool
    error BadTicks(); // A-8: tickLower >= tickUpper or not aligned to tickSpacing
    error SlippageExceeded(); // depositWithMin / withdrawWithMin bound not met (RT-1a / F-01)
    error NotSelf(); // lpLegExit is an internal-only self-call surface
    error SourceUnavailable(); // C-10: the yield source can't be read — entry can't be priced / nothing to deliver
    error RotationNotReady(); // harvest-recipient rotation: 48h delay not elapsed
    error NoPendingRotation(); // harvest-recipient rotation: nothing proposed

    event Deposited(address indexed user, uint256 quoteIn, uint256 sharesMinted);
    event Withdrawn(address indexed user, uint256 sharesBurned, uint256 quoteOut, uint256 pairedOut);
    event Deployed(uint256 indexed tokenId, uint256 quoteUsed, uint256 pairedUsed, uint128 liquidity);
    event Harvested(uint256 quoteFees, uint256 pairedFees, address indexed recipient);
    event PriceAnchored(uint160 sqrtPriceX96, uint256 blockNumber);
    event PausedSet(bool paused);
    event Compounded(uint256 quoteAmount);
    /// @dev The LP leg of a withdrawal could not execute (paired token paused/blacklisted, recipient frozen, …).
    ///      The withdrawer received the idle leg and was re-credited shares for the LP leg (F-02 / RT-6).
    event LpLegUnavailable(address indexed user, uint128 liquidityRequested);
    /// @dev The yield source could not be read during a withdrawal (C-10). Only the LP leg was delivered; the idle
    ///      entitlement (sized off `lastKnownIdle`) was re-credited as shares.
    event IdleLegUnavailable(address indexed user, uint256 idleEntitledLastKnown);
    event HarvestRecipientProposed(address indexed current, address indexed proposed, uint256 eta);
    event HarvestRecipientRotated(address indexed previous, address indexed current);
    event HarvestRecipientRotationCancelled(address indexed proposed);

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
        // Re-audit A-6/A-8 invariants. Hookless only: a hook that reverts in before/afterRemoveLiquidity or
        // returns an afterAddLiquidity delta would brick every LP withdraw / deploy, and the reentrancy and
        // conservative-mark reasoning both assume no callbacks. Native-ETH pools (paired == address(0)) are
        // unsupported (safeTransferFrom/balanceOf on address(0) revert). Ticks must be ordered + aligned or
        // the first deploy reverts TickMisaligned with capital already staged.
        if (address(poolKey_.hooks) != address(0)) revert HookedPoolUnsupported();
        if ((q0 ? c1 : c0) == address(0)) revert ZeroAddress();
        if (
            tickLower_ >= tickUpper_ || tickLower_ % poolKey_.tickSpacing != 0
                || tickUpper_ % poolKey_.tickSpacing != 0
        ) revert BadTicks();

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

    // ── owner: timelocked harvest-recipient rotation (F-02 rec. 3) ───────────────────────────

    /// @notice Propose a new harvest recipient. Takes effect only via `acceptHarvestRecipient` after
    ///         `HARVEST_RECIPIENT_DELAY` (48h). Until then every sweep keeps paying the current recipient — an
    ///         in-flight fee stream can never be redirected instantly. Re-proposing overwrites + restarts the clock.
    function proposeHarvestRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        uint64 eta = uint64(block.timestamp + HARVEST_RECIPIENT_DELAY);
        pendingHarvestRecipient = recipient;
        harvestRecipientEta = eta;
        emit HarvestRecipientProposed(harvestRecipient, recipient, eta);
    }

    /// @notice Finalise a proposed rotation once the delay has elapsed. Owner-only (the same seat that proposed).
    function acceptHarvestRecipient() external onlyOwner {
        address next = pendingHarvestRecipient;
        if (next == address(0)) revert NoPendingRotation();
        if (block.timestamp < harvestRecipientEta) revert RotationNotReady();
        address prev = harvestRecipient;
        harvestRecipient = next;
        delete pendingHarvestRecipient;
        delete harvestRecipientEta;
        emit HarvestRecipientRotated(prev, next);
    }

    /// @notice Abort a pending rotation — the operator's reaction to a proposal they did not make.
    function cancelHarvestRecipientRotation() external onlyOwner {
        address pending = pendingHarvestRecipient;
        if (pending == address(0)) revert NoPendingRotation();
        delete pendingHarvestRecipient;
        delete harvestRecipientEta;
        emit HarvestRecipientRotationCancelled(pending);
    }

    // ── C-10: tolerant staged read ────────────────────────────────────────────────────────────

    /// @dev Read the idle reserve WITHOUT letting a misbehaving yield source (a 4626 whose `previewRedeem` /
    ///      `totalAssets` reverts — RT-5f) brick the caller. Returns `(false, 0)` on failure; callers decide:
    ///      deposits REVERT (`SourceUnavailable` — an entry that can't be priced must not mint), withdrawals go
    ///      LP-leg-only and re-credit the idle leg off `lastKnownIdle`, views fall back to `lastKnownIdle`.
    function _idle() internal view returns (bool ok, uint256 idle) {
        try staging.stagedAssets() returns (uint256 v) {
            return (true, v);
        } catch {
            return (false, 0);
        }
    }

    /// @dev Strict read for paths that must not proceed blind (deposit, and the post-stage refresh). Also
    ///      refreshes `lastKnownIdle`, so every successful state-changing read keeps the fallback current.
    function _syncIdle() internal returns (uint256 idle) {
        bool ok;
        (ok, idle) = _idle();
        if (!ok) revert SourceUnavailable();
        lastKnownIdle = idle;
    }

    /// @notice Whether the yield source currently answers a NAV read. Off-chain surfaces should show
    ///         `totalNav` as STALE (it falls back to `lastKnownIdle`) while this is false.
    function sourceReadable() external view returns (bool ok) {
        (ok,) = _idle();
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
        return _deposit(quoteAmount, 0);
    }

    /// @notice `deposit` with a caller-set floor on the shares minted — bounds a same-block or held pump of the
    ///         paired token that would otherwise price the entry at an inflated LP mark (RT-1a / F-01c).
    function depositWithMin(uint256 quoteAmount, uint256 minSharesOut) external nonReentrant returns (uint256) {
        return _deposit(quoteAmount, minSharesOut);
    }

    function _deposit(uint256 quoteAmount, uint256 minSharesOut) internal returns (uint256 sharesMinted) {
        if (paused) revert DepositsPaused(); // circuit-breaker: no new capital while paused (withdraw stays open)
        if (quoteAmount == 0) revert ZeroAmount();
        if (_lastActionBlock[msg.sender] == block.number) revert SameBlockAction();
        _lastActionBlock[msg.sender] = block.number;
        // Conservative entry NAV (LP leg marked at max(spot, ref)) so a deflated spot can't cheapen entry
        // and dilute existing holders (finding H-03). No revert on PRICE — the conservative mark is the defense.
        // C-10: the idle leg IS strict here — an unreadable yield source means the entry can't be priced, and
        // minting blind would let a depositor buy in at a stale/zero idle mark. `_syncIdle` reverts SourceUnavailable.
        uint256 navBefore = _navDepositStrict();
        sharesMinted = SeniorSharesMath.toShares(quoteAmount, totalShares, navBefore, VIRTUAL, Math.Rounding.Floor);
        if (sharesMinted == 0) revert ZeroShares();
        if (sharesMinted < minSharesOut) revert SlippageExceeded();

        quoteAsset.safeTransferFrom(msg.sender, address(this), quoteAmount);
        quoteAsset.forceApprove(address(staging), quoteAmount);
        staging.stage(quoteAmount);
        _syncIdle(); // refresh the C-10 fallback with the post-stage reserve

        sharesOf[msg.sender] += sharesMinted;
        totalShares += sharesMinted;
        _anchorFollow(); // advance the clamped-follower reference (no-op until deployed)
        emit Deposited(msg.sender, quoteAmount, sharesMinted);
    }

    /// @notice Redeem shares for the pro-rata underlying: your fraction of the idle reserve (quote) and,
    ///         if any is deployed, your fraction of the LP position (both legs). The LP portion is
    ///         subject to the current pool price and impermanent loss — there is no par guarantee.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 quoteOut, uint256 pairedOut) {
        return _withdraw(shares, 0, 0);
    }

    /// @notice `withdraw` with caller-set floors on both legs — bounds any residual sandwich the pro-rata payout
    ///         cannot (the composition of the LP slice moves with spot even though its share does not).
    function withdrawWithMin(uint256 shares, uint256 minQuoteOut, uint256 minPairedOut)
        external
        nonReentrant
        returns (uint256 quoteOut, uint256 pairedOut)
    {
        return _withdraw(shares, minQuoteOut, minPairedOut);
    }

    /// @dev PURE PRO-RATA exit (Hacken F-01 / red-team RT-5). Sourcing is by SHARE FRACTION on both legs — `f` of
    ///      the idle reserve and `f` of the position's liquidity — so the payout is price-neutral by construction:
    ///      no mark is read to size it, a pumped or dumped spot changes only the composition of the LP slice,
    ///      never its size. This retires the withdraw-side `min(spot, ref)` mark, which under pro-rata sourcing
    ///      protected nobody and silently under-paid honest withdrawers whenever spot ran ahead of the follower
    ///      (the forgone slice went to remaining holders — or, for a sole holder, was stranded forever).
    ///      Spot is read ONCE, before any external call, and only ever used as a WEIGHT (RT-2: a paired token
    ///      with transfer hooks could otherwise move spot inside the exit and inflate the re-credit).
    ///      Each leg is BEST-EFFORT and independently re-credited (A-1): an illiquid adapter re-credits the
    ///      unserved idle; a failing LP leg (paused / blacklisting paired token, frozen fee recipient — F-02 /
    ///      RT-6) re-credits the LP slice while the idle leg still pays. Withdrawals never brick (M-01).
    function _withdraw(uint256 shares, uint256 minQuoteOut, uint256 minPairedOut)
        internal
        returns (uint256 quoteOut, uint256 pairedOut)
    {
        uint256 bal = sharesOf[msg.sender];
        if (shares == 0) revert ZeroAmount();
        if (shares > bal) revert InsufficientShares();
        if (_lastActionBlock[msg.sender] == block.number) revert SameBlockAction();
        _lastActionBlock[msg.sender] = block.number;

        uint256 ts = totalShares;
        bool lastHolder = shares == ts; // the final exit also clears the virtual-offset dust (A-2 clean state)
        // C-10 / RT-5f: the staged read is TOLERANT. If the yield source answers, use (and remember) the live
        // value. If it doesn't, size the idle ENTITLEMENT off `lastKnownIdle` — the last value every successful
        // state-changing path refreshed — but never call `unstage` (it would revert through the same source), so
        // the idle leg is "delivered 0 of a claim we sized last time" and the re-credit below hands those shares
        // back. The LP leg still pays. Nothing bricks; the only thing a withdrawer can lose is the yield that
        // accrued in the reserve since the last successful read (they burn marginally more shares per unit
        // delivered than a live read would) — and they can simply wait for the source to recover instead.
        (bool idleOk, uint256 idle) = _idle();
        if (idleOk) lastKnownIdle = idle;
        else idle = lastKnownIdle;
        uint160 spot;
        uint128 liq;
        uint256 lpSpotVal;
        if (tokenId != 0) {
            spot = _spot(); // cached ONCE — the only price read in the exit, used purely as a weight
            liq = positionManager.getPositionLiquidity(tokenId);
            lpSpotVal = _deployedQuoteValueAt(spot);
        }

        // Entitlements: the share fraction of each leg (offset-consistent — the virtual shares keep their slice).
        uint256 fromIdle = lastHolder ? idle : SeniorSharesMath.toAssets(shares, idle, ts, VIRTUAL, Math.Rounding.Floor);
        uint256 lpEntitled = lastHolder ? lpSpotVal : SeniorSharesMath.toAssets(shares, lpSpotVal, ts, VIRTUAL, Math.Rounding.Floor);
        uint128 liqToRemove = lastHolder
            ? liq
            : uint128(SeniorSharesMath.toAssets(shares, liq, ts, VIRTUAL, Math.Rounding.Floor));
        // Source down AND no LP leg to deliver → there is nothing this exit can pay; refuse rather than burn
        // shares against a zero claim (the re-credit needs `claim > 0`). State untouched; retry when readable.
        if (!idleOk && liqToRemove == 0) revert SourceUnavailable();

        // Effects before interactions.
        sharesOf[msg.sender] = bal - shares;
        totalShares = ts - shares;

        // Idle leg — best-effort (adapter may be illiquid/paused); shortfall re-credited below. Skipped entirely
        // when the source is unreadable (C-10) — `unstage` would revert through it.
        uint256 idleGot;
        if (fromIdle > 0 && idleOk) {
            idleGot = staging.unstage(fromIdle);
            if (idleGot > 0) {
                quoteAsset.safeTransfer(msg.sender, idleGot);
                quoteOut = idleGot;
                (bool ok2, uint256 idleAfter) = _idle(); // reserve shrank — keep the C-10 fallback current
                if (ok2) lastKnownIdle = idleAfter;
            }
        }
        if (!idleOk) emit IdleLegUnavailable(msg.sender, fromIdle);

        // LP leg — best-effort via a self-call so a third-party token failure can't take the idle leg down with
        // it. Fees are swept to the recipient FIRST inside the leg (H-02) so the decrease returns principal only.
        uint256 lpDelivered;
        if (liqToRemove > 0) {
            try this.lpLegExit(liqToRemove, msg.sender, block.timestamp) returns (uint256 gotQuote, uint256 gotPaired) {
                quoteOut += gotQuote;
                pairedOut += gotPaired;
                lpDelivered = gotQuote + _pairedToQuote(gotPaired, spot);
                // Cost basis leaves with the slice (RT-9a): the withdrawer's fraction of deployed principal.
                uint256 dp = deployedPrincipal;
                deployedPrincipal = lastHolder ? 0 : dp - SeniorSharesMath.toAssets(shares, dp, ts, VIRTUAL, Math.Rounding.Floor);
            } catch {
                emit LpLegUnavailable(msg.sender, liqToRemove);
            }
        }

        // Re-credit (A-1): shares for whatever fraction of the entitlement could not be delivered now. The
        // withdrawer keeps that claim; nothing is stranded, nothing bricks.
        uint256 sharesBurned = shares;
        {
            uint256 claim = fromIdle + lpEntitled;
            uint256 delivered = idleGot + lpDelivered;
            if (claim > 0 && delivered < claim) {
                uint256 reCredit = FullMath.mulDiv(shares, claim - delivered, claim);
                if (reCredit > 0) {
                    sharesOf[msg.sender] += reCredit;
                    totalShares += reCredit;
                    sharesBurned = shares - reCredit;
                }
            }
        }
        if (quoteOut < minQuoteOut || pairedOut < minPairedOut) revert SlippageExceeded();

        _anchorFollow(); // advance the clamped-follower reference
        emit Withdrawn(msg.sender, sharesBurned, quoteOut, pairedOut);
    }

    /// @dev The LP leg of an exit, isolated behind a self-call so `_withdraw` can `try` it. Sweeps fees to the
    ///      recipient, then decreases `liquidity` and delivers both legs to `to`. Self-only.
    function lpLegExit(uint128 liquidity, address to, uint256 deadline)
        external
        returns (uint256 gotQuote, uint256 gotPaired)
    {
        if (msg.sender != address(this)) revert NotSelf();
        _sweepFees(deadline); // H-02: fees route to harvestRecipient, never the withdrawer
        return _decreaseAndTake(liquidity, to, deadline);
    }

    /// @notice Permissionless follower liveness: advance the clamped reference one bounded step toward spot.
    ///         Adds no attack surface — anyone could already do this with a dust deposit — and keeps entry marks
    ///         and the deploy band from going stale on a quiet day (F-01c / F-04).
    function poke() external {
        _anchorFollow();
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

        // Re-audit A-3 / RT-9a (size): cap the fraction of depositor PRINCIPAL in the LP — at COST, not marked
        // value — at MAX_DEPLOY_BPS. Checked on the requested quote (conservative — the best-effort unstage can
        // only return less). A marked-value cap re-opened after every drawdown, letting a dumping paired token
        // plus the honest top-up rule cycle 2/3 of principal into the pool; cost basis never falls with price.
        {
            // Strict read (C-10): a deploy against an unreadable source can't size the cap → SourceUnavailable.
            uint256 principal = _syncIdle() + deployedPrincipal;
            if (deployedPrincipal + quoteToDeploy > (principal * MAX_DEPLOY_BPS) / 10_000) revert DeployCapExceeded();
        }

        // Sweep the existing position's accrued fees to the buffer BEFORE increasing, so the INCREASE never
        // folds trading fees into the re-stage / paired-return below (finding H-02). No-op on first deploy.
        _sweepFees(deadline);

        uint256 quoteGot = quoteToDeploy == 0 ? 0 : staging.unstage(quoteToDeploy);
        if (pairedAmount > 0) pairedAsset.safeTransferFrom(msg.sender, address(this), pairedAmount);

        (uint256 amount0, uint256 amount1) =
            quoteIsCurrency0 ? (quoteGot, pairedAmount) : (pairedAmount, quoteGot);

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(_poolKey.toId());
        // Re-audit A-3 (price): mint only while spot is within the follower band of the clamped reference, so
        // a sandwiched deploy can't mint at a manipulated composition. No reference exists before the first
        // deploy (the first deploy sets the anchor) — there the caller's `minLiquidity` is the guard, which
        // the cron now computes for real rather than passing 0.
        {
            uint160 ref = _refSqrtPrice;
            if (ref != 0) {
                uint160 band = uint160((uint256(ref) * maxDeviationBps) / 10_000);
                uint160 diff = sqrtPriceX96 > ref ? sqrtPriceX96 - ref : ref - sqrtPriceX96;
                if (diff > band) revert DeployPriceOutOfBand();
            }
        }
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
        deployedPrincipal += quoteUsed; // cost basis (RT-9a)
        if (quoteLeft > 0) {
            quoteAsset.forceApprove(address(staging), quoteLeft);
            staging.stage(quoteLeft);
        }
        if (pairedLeft > 0) pairedAsset.safeTransfer(msg.sender, pairedLeft);
        _syncIdle(); // the reserve just shrank by `quoteUsed` — keep the C-10 fallback current

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
        // Re-audit A-2: a zero-delta update against an EMPTIED position reverts CannotUpdateEmptyPosition in
        // v4-core, and DECREASE never burns the NFT — so after a full LP drain this would brick deploy,
        // harvest, and every adapter-short withdraw forever. A full decrease already collected all fees, so
        // there is nothing to sweep: return instead of calling into the pool.
        if (positionManager.getPositionLiquidity(tokenId) == 0) return (0, 0);
        (quoteFees, pairedFees) = _decreaseAndTake(0, address(this), deadline);
        if (quoteFees > 0) quoteAsset.safeTransfer(harvestRecipient, quoteFees);
        if (pairedFees > 0) pairedAsset.safeTransfer(harvestRecipient, pairedFees);
        if (quoteFees != 0 || pairedFees != 0) emit Harvested(quoteFees, pairedFees, harvestRecipient);
    }

    // ── owner: circuit-breaker + compound ─────────────────────────────────────────────────────

    /// @notice Owner circuit-breaker (item 13): pause/unpause NEW deposits. Withdraw is NEVER gated, so a
    ///         pause can't trap funds — it only stops fresh capital entering a degrading/out-of-range pool.
    ///         Flipped by the operator, or by the keeper on a sustained out-of-range alert.
    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    /// @notice Owner-gated compound (item 14 restake destination): stage `amount` quote back into the yield
    ///         reserve, lifting NAV pro-rata for ALL shareholders with NO share mint and NO paired leg —
    ///         pure accretion. The caller (harvest recipient / oracle seat) supplies the net harvested fees.
    function compoundQuote(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        quoteAsset.safeTransferFrom(msg.sender, address(this), amount);
        quoteAsset.forceApprove(address(staging), amount);
        staging.stage(amount);
        _syncIdle(); // keep the C-10 fallback current
        emit Compounded(amount);
    }

    // ── NAV (quote-asset terms) ──────────────────────────────────────────────────────────────

    /// @notice Spot NAV (quote terms) — for display + as the follower's input. Deposit/withdraw price off
    ///         the direction-conservative marks (max/min of spot vs the follower), not this.
    ///         C-10: never reverts on an unreadable yield source — the idle leg falls back to `lastKnownIdle`
    ///         (check `sourceReadable()`; treat the figure as STALE while it is false).
    function totalNav() public view returns (uint256) {
        (bool ok, uint256 idle) = _idle();
        if (!ok) idle = lastKnownIdle;
        if (tokenId == 0) return idle; // no spot read until deployed
        return idle + _deployedQuoteValueAt(_spot());
    }

    /// @dev NAV that MINTS deposit shares: LP leg at max(spot, ref) so a deflated spot can't cheapen entry.
    ///      STRICT on the idle leg (C-10): reverts `SourceUnavailable` rather than mint against a stale reserve.
    ///      Not a view — refreshes `lastKnownIdle` as a side effect of the successful read.
    function _navDepositStrict() internal returns (uint256) {
        uint256 idle = _syncIdle();
        if (tokenId == 0) return idle; // idle-only until deployed — no spot read
        uint160 spot = _spot();
        return idle + Math.max(_deployedQuoteValueAt(spot), _deployedQuoteValueAt(_refOrSpot(spot)));
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
