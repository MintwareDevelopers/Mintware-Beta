// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PoolId}          from "@uniswap/v4-core/src/types/PoolId.sol";

import {MWAmAuctionLib, Bid, AmParams} from "./MWAmAuctionLib.sol";

/// @dev The pool's sole LP (the pair vault) receives rent through this entrypoint.
interface IAmAmmRentSink {
    function fundRent(address token, uint256 amount) external;
}

/// @title  MWAmAuction
/// @notice Stateful am-AMM auction: holds bid deposits + captured manager fees and
///         runs the Harberger-lease state machine. All correctness math lives in the
///         pure MWAmAuctionLib; this layer adds custody, access control, and the
///         pull-payment ledger. The MWHookCoordinator is the ONLY caller of the
///         state-machine driver (`poke`) and the fee recorder.
///
/// @dev    Custody model:
///           - `deposit` (bidToken) is escrowed here per bid.
///           - RENT is charged each `poke` and PUSHED to the pool's LP (rent sink).
///           - Displaced/evicted-with-remainder deposits + captured manager fees are
///             credited to a PULL ledger (`owed`) and withdrawn via `claim()`.
///           - A caller withdrawing their OWN standing deposit gets it back directly
///             (CEI + nonReentrant); third-party refunds always go through the ledger.
contract MWAmAuction is Ownable, ReentrancyGuard {
    using SafeERC20     for IERC20;
    using MWAmAuctionLib for Bid;

    // ── State ────────────────────────────────────────────────────────────────

    /// @notice The hook that drives the auction. Set once, post-deploy (chicken-egg).
    address public coordinator;

    mapping(PoolId => AmParams) public amParams;
    mapping(PoolId => address)  public rentSink;      // LP recipient of rent (the pair vault)
    mapping(PoolId => Bid)      public topBid;         // active manager
    mapping(PoolId => Bid)      public nextBid;        // challenger
    mapping(PoolId => uint256)  public lastCharged;    // block.number of last rent charge

    /// @notice Pull-payment ledger: owed[account][token]. Funds a caller can `claim`.
    mapping(address => mapping(address => uint256)) public owed;

    // ── Events ───────────────────────────────────────────────────────────────

    event CoordinatorSet(address indexed coordinator);
    event PoolConfigured(PoolId indexed id, address rentSink, address bidToken, uint24 feeMaxPips, uint32 K);
    event PoolEnabledSet(PoolId indexed id, bool enabled);
    event BidPlaced(PoolId indexed id, address indexed manager, uint128 rent, uint128 deposit, uint24 feePips);
    event BidDeposited(PoolId indexed id, address indexed manager, uint128 amount);
    event BidWithdrawn(PoolId indexed id, address indexed manager, uint128 amount);
    event Promoted(PoolId indexed id, address indexed manager, uint128 rent, uint24 feePips);
    event Evicted(PoolId indexed id, address indexed manager);
    event RentCharged(PoolId indexed id, address indexed manager, uint256 amount);
    event ManagerFeeRecorded(PoolId indexed id, address indexed manager, address token, uint256 amount);
    event Claimed(address indexed account, address indexed token, uint256 amount);

    // ── Errors ───────────────────────────────────────────────────────────────

    error OnlyCoordinator();
    error CoordinatorAlreadySet();
    error NotEnabled();
    error InvalidBid();
    error NotYourBid();
    error ReserveBreach();
    error NothingToClaim();
    error ZeroAddress();
    error NoManager();
    error BidTokenLocked();
    error AlreadyManaging();

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier onlyCoordinator() {
        if (msg.sender != coordinator) revert OnlyCoordinator();
        _;
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    /// @notice Wire the coordinator once (it needs this contract's address at deploy).
    function setCoordinator(address _coordinator) external onlyOwner {
        if (coordinator != address(0)) revert CoordinatorAlreadySet();
        if (_coordinator == address(0)) revert ZeroAddress();
        coordinator = _coordinator;
        emit CoordinatorSet(_coordinator);
    }

    /// @notice Configure a pool's auction. Owner is responsible for the BLUE_CHIP gate.
    function configurePool(PoolId id, address _rentSink, AmParams calldata p) external onlyOwner {
        if (_rentSink == address(0) || p.bidToken == address(0)) revert ZeroAddress();
        // minBidMultBps must be strictly > 1.0x (10_000) — 1.0x allows 1-wei slot churn.
        if (p.K == 0 || p.minRent == 0 || p.minBidMultBps <= 10_000) revert InvalidBid();
        if (p.defaultFeePips > p.feeMaxPips) revert InvalidBid();
        // bidToken is locked once set: changing it while deposits are escrowed in the old
        // token would pay out / charge rent in the wrong asset and break custody accounting.
        address existing = amParams[id].bidToken;
        if (existing != address(0) && existing != p.bidToken) revert BidTokenLocked();
        amParams[id] = p;
        rentSink[id] = _rentSink;
        emit PoolConfigured(id, _rentSink, p.bidToken, p.feeMaxPips, p.K);
    }

    /// @notice Enable/disable the auction for an already-configured pool.
    function setEnabled(PoolId id, bool enabled) external onlyOwner {
        amParams[id].enabled = enabled;
        emit PoolEnabledSet(id, enabled);
    }

    // ── Bidding (public) ───────────────────────────────────────────────────────

    /// @notice Place (or replace) the challenger bid for a pool. Escrows `deposit` in
    ///         bidToken and refunds any displaced challenger via the pull ledger.
    function bid(PoolId id, uint24 feePips, uint128 rent, uint128 deposit) external nonReentrant {
        AmParams memory p = amParams[id];
        if (!p.enabled) revert NotEnabled();
        _poke(id); // keep state fresh before reading the standing challenger

        // A manager can't also squat the challenger slot: one address holding both slots
        // would be unable to manage each escrow independently via _ownedBid.
        if (msg.sender == topBid[id].manager) revert AlreadyManaging();

        Bid memory standing = nextBid[id];
        if (!MWAmAuctionLib.validBid(rent, deposit, feePips, topBid[id], standing, p)) revert InvalidBid();

        // Escrow the new deposit first.
        IERC20(p.bidToken).safeTransferFrom(msg.sender, address(this), deposit);

        // Refund the displaced challenger (pull ledger — they aren't the caller).
        if (standing.manager != address(0) && standing.deposit > 0) {
            owed[standing.manager][p.bidToken] += standing.deposit;
        }

        nextBid[id] = Bid({
            manager: msg.sender,
            epoch:   uint40(block.number),
            feePips: feePips,
            rent:    rent,
            deposit: deposit
        });
        emit BidPlaced(id, msg.sender, rent, deposit, feePips);
    }

    /// @notice Top up your bid's deposit (top bid or challenger). Keeps the exact-multiple invariant.
    function depositIntoBid(PoolId id, uint128 amount) external nonReentrant {
        AmParams memory p = amParams[id];
        _poke(id);
        (Bid storage b, ) = _ownedBid(id);
        if (amount == 0 || amount % b.rent != 0) revert InvalidBid();
        IERC20(p.bidToken).safeTransferFrom(msg.sender, address(this), amount);
        b.deposit += amount;
        emit BidDeposited(id, msg.sender, amount);
    }

    /// @notice Withdraw from your bid. The TOP bid must keep the K-block continuity
    ///         reserve; a challenger may withdraw down to zero (a cancel).
    function withdrawFromBid(PoolId id, uint128 amount) external nonReentrant {
        AmParams memory p = amParams[id];
        _poke(id);
        (Bid storage b, bool isTop) = _ownedBid(id);

        // Both slots must keep the continuity reserve (or fully exit). A challenger is NOT
        // exempt: if it could sit below reserve it would be promoted under-collateralized,
        // defeating the K-block guarantee. canWithdraw = (remaining == 0) OR meetsReserve.
        if (!MWAmAuctionLib.canWithdraw(b.deposit, b.rent, amount, p.K)) revert ReserveBreach();

        // Effects
        b.deposit -= amount;
        if (b.deposit == 0) {
            // Fully exited — clear the slot.
            if (isTop) { delete topBid[id]; } else { delete nextBid[id]; }
        }
        // Interaction — direct return of the caller's OWN escrow (CEI + nonReentrant).
        IERC20(p.bidToken).safeTransfer(msg.sender, amount);
        emit BidWithdrawn(id, msg.sender, amount);
    }

    /// @notice Withdraw everything credited to you in `token` (refunds + manager fees).
    function claim(address token) external nonReentrant {
        uint256 amt = owed[msg.sender][token];
        if (amt == 0) revert NothingToClaim();
        owed[msg.sender][token] = 0;
        IERC20(token).safeTransfer(msg.sender, amt);
        emit Claimed(msg.sender, token, amt);
    }

    // ── Coordinator-driven state machine ───────────────────────────────────────

    /// @notice Advance the auction for a block: charge rent → push to LP → evict on
    ///         depletion → promote the challenger after its notice. Returns the manager
    ///         and effective fee the hook should apply this swap.
    function poke(PoolId id) external onlyCoordinator nonReentrant returns (address manager, uint24 fee) {
        return _poke(id);
    }

    /// @notice Credit a skimmed swap fee to the CURRENT manager. The coordinator must
    ///         have transferred `amount` of `token` to this contract first (push model,
    ///         mirrors FeeVault.notifyFeeReceipt). Reverts if there is no manager — the
    ///         hook must only skim+record for a managed pool, so a mistaken call can
    ///         never strand pushed tokens with nobody to credit.
    function recordManagerFee(PoolId id, address token, uint256 amount) external onlyCoordinator {
        address mgr = topBid[id].manager;
        if (mgr == address(0)) revert NoManager();
        if (amount == 0) return;
        owed[mgr][token] += amount;
        emit ManagerFeeRecorded(id, mgr, token, amount);
    }

    // ── Internal state machine ─────────────────────────────────────────────────

    function _poke(PoolId id) internal returns (address, uint24) {
        AmParams memory p = amParams[id];
        if (!p.enabled) return (address(0), 0);

        uint256 last = lastCharged[id];
        if (last == 0) last = block.number; // first touch: start the clock, no back-charge

        Bid memory top = topBid[id];

        // 1. Charge rent for elapsed blocks and push it to the LP. Effects (deposit debit +
        //    lastCharged) are committed BEFORE the external _fundRent call (CEI): even without
        //    the reentrancy guard, a re-entering sink would see fully-updated state.
        (uint256 rentDue, bool depleted) = MWAmAuctionLib.rentOwed(top, block.number, last);
        lastCharged[id] = block.number;
        if (rentDue > 0) {
            top.deposit = uint128(uint256(top.deposit) - rentDue);
            topBid[id].deposit = top.deposit;
            _fundRent(id, p.bidToken, rentDue);
            emit RentCharged(id, top.manager, rentDue);
        }

        // 2. Evict a depleted manager.
        if (depleted) {
            emit Evicted(id, top.manager);
            delete topBid[id];
            top = topBid[id];
        }

        // 3. Promote the challenger if its notice has elapsed and it out-bids.
        Bid memory next = nextBid[id];
        if (MWAmAuctionLib.shouldPromote(top, next, block.number, p)) {
            // Refund the outgoing manager's remaining escrow (pull ledger).
            if (top.manager != address(0) && top.deposit > 0) {
                owed[top.manager][p.bidToken] += top.deposit;
            }
            next.epoch = uint40(block.number); // reset the clock at promotion
            topBid[id] = next;
            delete nextBid[id];
            top = next;
            emit Promoted(id, next.manager, next.rent, next.feePips);
        }

        return (top.manager, MWAmAuctionLib.effectiveFee(top, p));
    }

    function _fundRent(PoolId id, address token, uint256 amount) internal {
        address sink = rentSink[id];
        IERC20(token).forceApprove(sink, amount);
        IAmAmmRentSink(sink).fundRent(token, amount);
        IERC20(token).forceApprove(sink, 0); // clear any residual allowance a partial-pull sink left
    }

    /// @dev Resolve which of the caller's bids to act on (top preferred), or revert.
    function _ownedBid(PoolId id) internal view returns (Bid storage b, bool isTop) {
        if (topBid[id].manager == msg.sender)  return (topBid[id], true);
        if (nextBid[id].manager == msg.sender) return (nextBid[id], false);
        revert NotYourBid();
    }

    // ── Views ──────────────────────────────────────────────────────────────────

    /// @notice The manager + fee that WOULD apply right now (view; does not charge rent).
    function currentManagerAndFee(PoolId id) external view returns (address, uint24) {
        AmParams memory p = amParams[id];
        if (!p.enabled) return (address(0), 0);
        return (topBid[id].manager, MWAmAuctionLib.effectiveFee(topBid[id], p));
    }
}
