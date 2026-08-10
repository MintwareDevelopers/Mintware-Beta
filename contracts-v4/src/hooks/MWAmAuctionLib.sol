// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// =============================================================================
// MWAmAuctionLib — pure state-machine math for the am-AMM (auction-managed AMM).
//
// This is the auditable CORE of the auction: rent accrual, the Harberger-lease
// out-bid/promotion rules, the continuity reserve, and bid validity — all as pure
// functions over the Bid/AmParams structs. NO token custody, NO storage, NO
// reentrancy surface lives here; MWAmAuction.sol (stateful) composes these.
//
// Mechanism (am-AMM, arXiv:2403.03367; BidDog reference semantics):
//   - The right to MANAGE a pool (set its fee, receive its swap fees) is sold via
//     a continuous auction. The manager pays RENT per block; rent compensates LPs.
//   - Two slots per pool: topBid (active manager) + nextBid (challenger). A new
//     bid must beat the standing bid by MIN_BID_MULTIPLIER (default 1.1x).
//   - K-block notice: a challenger cannot become manager for K blocks, so LPs can
//     react to a new rent/manager before it takes effect.
//   - A bid's deposit must fully fund K blocks of rent (deposit >= rent*K) and be
//     an exact multiple of rent; a manager whose deposit depletes is evicted.
// =============================================================================

/// @dev One auction slot. `epoch` is the BLOCK NUMBER the bid was placed (nextBid)
///      or last promoted (topBid) — it drives the K-block notice, not a timestamp.
struct Bid {
    address manager;   // slot holder (address(0) == empty slot)
    uint40  epoch;     // block number placed / promoted
    uint24  feePips;   // manager-chosen swap fee; must be <= AmParams.feeMaxPips
    uint128 rent;      // rent per block, denominated in AmParams.bidToken
    uint128 deposit;   // prepaid rent balance; invariant: deposit % rent == 0
}

/// @dev Per-pool auction configuration (owner-set; gated to BLUE_CHIP pools).
struct AmParams {
    bool    enabled;          // per-pool on/off
    address bidToken;         // rent + refund currency (a pool token)
    uint24  feeMaxPips;       // f_max — hard cap on the manager-chosen fee
    uint24  defaultFeePips;   // fee applied when there is NO manager
    uint128 minRent;          // rent floor
    uint32  K;                // notice / continuity window, in blocks
    uint16  minBidMultBps;    // MIN_BID_MULTIPLIER in bps (11_000 == 1.1x)
}

library MWAmAuctionLib {
    uint256 internal constant BPS = 10_000;

    /// @notice Rent owed for the blocks elapsed since `lastCharged`, capped at the
    ///         bid's deposit so it can never underflow. `depleted` signals the
    ///         manager has run out of prepaid rent and must be evicted this poke.
    function rentOwed(Bid memory b, uint256 currentBlock, uint256 lastCharged)
        internal pure returns (uint256 owed, bool depleted)
    {
        if (b.manager == address(0) || b.rent == 0 || currentBlock <= lastCharged) {
            return (0, false);
        }
        uint256 elapsed = currentBlock - lastCharged;
        owed = elapsed * uint256(b.rent);
        if (owed >= uint256(b.deposit)) {
            owed = uint256(b.deposit);
            depleted = true;
        }
    }

    /// @notice True iff `challengerRent` beats `incumbentRent` by the min increment.
    ///         An empty incumbent (rent 0) is always beaten by any positive rent.
    function outbids(uint128 challengerRent, uint128 incumbentRent, uint16 minBidMultBps)
        internal pure returns (bool)
    {
        if (challengerRent == 0) return false;
        // challengerRent > incumbentRent * minBidMultBps / BPS, kept as cross-multiply
        return uint256(challengerRent) * BPS > uint256(incumbentRent) * uint256(minBidMultBps);
    }

    /// @notice A deposit satisfies the continuity reserve: it prepays at least K
    ///         blocks of rent AND is an exact multiple of rent (no dust remainder).
    function meetsReserve(uint128 deposit, uint128 rent, uint32 K)
        internal pure returns (bool)
    {
        if (rent == 0) return false;
        if (deposit % rent != 0) return false;
        return uint256(deposit) >= uint256(rent) * uint256(K);
    }

    /// @notice Whether the K-block notice has elapsed for a bid placed at `epoch`.
    function noticeElapsed(uint40 epoch, uint256 currentBlock, uint32 K)
        internal pure returns (bool)
    {
        return currentBlock >= uint256(epoch) + uint256(K);
    }

    /// @notice Full promotion predicate: nextBid replaces topBid iff it is a real
    ///         bid, its K-block notice has elapsed, and it out-bids the incumbent.
    function shouldPromote(Bid memory top, Bid memory next, uint256 currentBlock, AmParams memory p)
        internal pure returns (bool)
    {
        if (next.manager == address(0) || next.rent == 0) return false;
        if (!noticeElapsed(next.epoch, currentBlock, p.K)) return false;
        return outbids(next.rent, top.rent, p.minBidMultBps);
    }

    /// @notice Validate the ECONOMIC terms of a new challenger bid (custody is the
    ///         caller's job). Must be enabled, above the rent floor, within the fee cap,
    ///         satisfy the reserve, be PROMOTABLE against the manager, and beat any
    ///         standing challenger.
    /// @dev    Promotable-only occupancy (audit F-B): a challenger must beat the current
    ///         MANAGER by the multiplier — not merely a standing challenger. This removes
    ///         the sub-promotion "squat" position and the mult^2 entry barrier: any slot
    ///         occupant is, by construction, someone who will be force-promoted within K
    ///         blocks and pay >= mult x the manager's rent to the LP.
    function validBid(
        uint128 rent,
        uint128 deposit,
        uint24  feePips,
        Bid memory top,
        Bid memory standingNext,
        AmParams memory p
    ) internal pure returns (bool) {
        if (!p.enabled) return false;
        if (rent < p.minRent) return false;
        if (feePips > p.feeMaxPips) return false;
        if (!meetsReserve(deposit, rent, p.K)) return false;
        if (top.manager != address(0) && !outbids(rent, top.rent, p.minBidMultBps)) return false;
        if (standingNext.manager != address(0) && !outbids(rent, standingNext.rent, p.minBidMultBps)) {
            return false;
        }
        return true;
    }

    /// @notice Whether `amount` can be withdrawn from a bid. There is NO free exit: the
    ///         remaining deposit must still satisfy the continuity reserve (>= rent*K, exact
    ///         multiple). Escrow can only leave a slot by being out-bid (refund) or promoted.
    /// @dev    Audit F-B / BidDog parity: allowing a withdrawal to zero is exactly the
    ///         free place<->cancel<->re-bid churn that makes challenger-slot squatting free.
    ///         Committed capital + forced promotion is the anti-squat mechanism.
    function canWithdraw(uint128 deposit, uint128 rent, uint128 amount, uint32 K)
        internal pure returns (bool)
    {
        if (amount > deposit) return false;
        return meetsReserve(deposit - amount, rent, K);
    }

    /// @notice The effective fee for the current block: the manager's chosen fee if
    ///         a manager holds the slot, else the pool's configured default. Always
    ///         clamped to the cap as defense-in-depth (bids validate it too).
    function effectiveFee(Bid memory top, AmParams memory p) internal pure returns (uint24) {
        uint24 fee = top.manager == address(0) ? p.defaultFeePips : top.feePips;
        return fee > p.feeMaxPips ? p.feeMaxPips : fee;
    }
}
