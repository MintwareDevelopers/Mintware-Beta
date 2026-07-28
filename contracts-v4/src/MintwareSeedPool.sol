// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice The target a finalized/growing seed hands its balanced liquidity to.
///         The seed pool transfers the tokens to the target FIRST, then calls the
///         hook — so the target initializes / adds liquidity from its own balance.
///         Decouples the seed pool from Uniswap V4 mechanics (and keeps it testable).
interface ISeedTarget {
    /// @notice Called once, when the raise crosses its deploy threshold.
    function receiveSeed(
        bytes32 poolInit,
        address projectToken,
        uint256 tokenAmount,
        address quoteToken,
        uint256 quoteAmount,
        uint160 sqrtPriceX96
    ) external;

    /// @notice Called for each proportional growth top-up after the pool is live.
    function receiveGrowth(bytes32 poolInit, uint256 tokenAmount, uint256 quoteAmount) external;
}

/// @title  MintwareSeedPool
/// @notice Fair-launch bootstrap escrow for vault seeding. The team escrows the full
///         project-token reserve (and optionally some quote); the public co-seeds the
///         quote side. When the raise crosses a deploy threshold the pool goes live,
///         seeding the target vault with the *balanced* amount available. Further quote
///         grows the position **proportionally** — each unit of quote is matched from
///         the reserve at the fixed reserve:quoteTarget ratio, so price doesn't move and
///         the reserve is consumed exactly when the quote target is filled.
///
///         If the deadline passes below threshold, contributors reclaim their quote and
///         the team reclaims its reserve + pre-funded quote — no funds are trapped.
///
/// @dev    Permissionless per-seed: whoever opens a seed is its `team`/beneficiary; there
///         is no global owner. One contract holds many seeds keyed by `seedId`.
///         Design: docs/developers/phase3-rwa-create-seed-design.md §2.
contract MintwareSeedPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;

    enum Phase { None, Seeding, Live, Grown, Refunding }

    struct Seed {
        address team;            // opener + beneficiary of the reserve
        address projectToken;    // token side the team escrows
        address quoteToken;      // quote side the public co-seeds
        address target;          // ISeedTarget that receives balanced liquidity
        uint256 tokenReserve;    // full project-token side, escrowed up front
        uint256 teamQuote;       // quote the team pre-funded (part of quoteRaised)
        uint256 quoteTarget;     // teamQuote + publicQuoteTarget (full quote side)
        uint256 quoteRaised;     // quote currently escrowed (team + public)
        uint256 threshold;       // quoteTarget * deployThresholdBps / BPS
        uint256 deployedToken;   // project token pushed to target so far
        uint256 deployedQuote;   // quote pushed to target so far
        uint64  raiseDeadline;   // unix ts; refund path unlocks after this
        uint160 sqrtPriceX96;    // pool init price, passed through to the target
        bytes32 poolInit;        // opaque pool/vault ref passed through to the target
        Phase   phase;
        bool    teamReclaimed;   // refund path: team already pulled its funds
    }

    struct OpenParams {
        address projectToken;
        address quoteToken;
        address target;
        uint256 tokenReserve;
        uint256 teamQuote;
        uint256 publicQuoteTarget;
        uint16  deployThresholdBps;
        uint64  raiseDeadline;
        uint160 sqrtPriceX96;
        bytes32 poolInit;
    }

    mapping(bytes32 => Seed) public seeds;
    // public quote contributed per seed per wallet (excludes the team's pre-fund)
    mapping(bytes32 => mapping(address => uint256)) public contributions;
    mapping(bytes32 => mapping(address => bool))    public refundClaimed;

    event SeedOpened(bytes32 indexed seedId, address indexed team, address projectToken, address quoteToken, uint256 tokenReserve, uint256 quoteTarget, uint256 threshold, uint64 deadline);
    event Contributed(bytes32 indexed seedId, address indexed contributor, uint256 amount, uint256 quoteRaised);
    event Finalized(bytes32 indexed seedId, uint256 tokenDeployed, uint256 quoteDeployed);
    event Grown(bytes32 indexed seedId, uint256 tokenDeployed, uint256 quoteDeployed, bool fullyGrown);
    event SeedClosed(bytes32 indexed seedId, uint256 reserveReturned);
    event Refunding(bytes32 indexed seedId);
    event RefundClaimed(bytes32 indexed seedId, address indexed contributor, uint256 amount);
    event TeamReclaimed(bytes32 indexed seedId, uint256 reserve, uint256 quote);

    error SeedExists();
    error BadConfig();
    error WrongPhase();
    error BelowThreshold();
    error NotExpired();
    error ThresholdMet();
    error NothingToDo();
    error NotTeam();
    error AlreadyClaimed();
    error Full();

    // ─── Open ─────────────────────────────────────────────────────────────────
    function openSeed(bytes32 seedId, OpenParams calldata p) external nonReentrant {
        if (seeds[seedId].phase != Phase.None) revert SeedExists();
        if (
            p.projectToken == address(0) || p.quoteToken == address(0) || p.target == address(0) ||
            p.projectToken == p.quoteToken ||
            p.tokenReserve == 0 || p.publicQuoteTarget == 0 ||
            p.deployThresholdBps == 0 || p.deployThresholdBps > BPS ||
            p.raiseDeadline <= block.timestamp
        ) revert BadConfig();

        uint256 quoteTarget = p.teamQuote + p.publicQuoteTarget;

        seeds[seedId] = Seed({
            team:          msg.sender,
            projectToken:  p.projectToken,
            quoteToken:    p.quoteToken,
            target:        p.target,
            tokenReserve:  p.tokenReserve,
            teamQuote:     p.teamQuote,
            quoteTarget:   quoteTarget,
            quoteRaised:   p.teamQuote,
            threshold:     (quoteTarget * p.deployThresholdBps) / BPS,
            deployedToken: 0,
            deployedQuote: 0,
            raiseDeadline: p.raiseDeadline,
            sqrtPriceX96:  p.sqrtPriceX96,
            poolInit:      p.poolInit,
            phase:         Phase.Seeding,
            teamReclaimed: false
        });

        // Escrow the team's full token reserve (+ any pre-funded quote).
        IERC20(p.projectToken).safeTransferFrom(msg.sender, address(this), p.tokenReserve);
        if (p.teamQuote > 0) IERC20(p.quoteToken).safeTransferFrom(msg.sender, address(this), p.teamQuote);

        emit SeedOpened(seedId, msg.sender, p.projectToken, p.quoteToken, p.tokenReserve, quoteTarget, seeds[seedId].threshold, p.raiseDeadline);
    }

    // ─── Public co-seeding ──────────────────────────────────────────────────────
    /// @notice Contribute quote. Works while Seeding (toward threshold) and while Live
    ///         (toward proportional growth). Clamps at the quote target — never over-fills.
    function contributeQuote(bytes32 seedId, uint256 amount) external nonReentrant {
        Seed storage s = seeds[seedId];
        if (s.phase != Phase.Seeding && s.phase != Phase.Live) revert WrongPhase();

        uint256 remaining = s.quoteTarget - s.quoteRaised;
        if (remaining == 0) revert Full();
        uint256 take = amount > remaining ? remaining : amount;
        if (take == 0) revert NothingToDo();

        s.quoteRaised += take;
        contributions[seedId][msg.sender] += take;

        IERC20(s.quoteToken).safeTransferFrom(msg.sender, address(this), take);
        emit Contributed(seedId, msg.sender, take, s.quoteRaised);
    }

    // ─── Go live ────────────────────────────────────────────────────────────────
    /// @notice Once the raise crosses its threshold, deploy the raised quote matched by
    ///         proportional reserve into the target. Permissionless (anyone can trigger).
    function finalizeSeed(bytes32 seedId) external nonReentrant {
        Seed storage s = seeds[seedId];
        if (s.phase != Phase.Seeding) revert WrongPhase();
        if (s.quoteRaised < s.threshold) revert BelowThreshold();

        uint256 quoteToDeploy = s.quoteRaised - s.deployedQuote;
        uint256 tokenToDeploy = _matchToken(s, quoteToDeploy);

        s.deployedQuote += quoteToDeploy;
        s.deployedToken += tokenToDeploy;
        s.phase = Phase.Live;

        _push(s, tokenToDeploy, quoteToDeploy, true);
        emit Finalized(seedId, tokenToDeploy, quoteToDeploy);
    }

    // ─── Proportional growth ─────────────────────────────────────────────────────
    /// @notice Deploy quote raised since the last deployment, matched proportionally from
    ///         the reserve. When the reserve is fully consumed the seed is Grown.
    function growLiquidity(bytes32 seedId) external nonReentrant {
        Seed storage s = seeds[seedId];
        if (s.phase != Phase.Live) revert WrongPhase();

        uint256 quoteToDeploy = s.quoteRaised - s.deployedQuote;
        if (quoteToDeploy == 0) revert NothingToDo();
        uint256 tokenToDeploy = _matchToken(s, quoteToDeploy);

        s.deployedQuote += quoteToDeploy;
        s.deployedToken += tokenToDeploy;
        bool fully = s.deployedToken >= s.tokenReserve;
        if (fully) s.phase = Phase.Grown;

        _push(s, tokenToDeploy, quoteToDeploy, false);
        emit Grown(seedId, tokenToDeploy, quoteToDeploy, fully);
    }

    // ─── Team close (Live → Grown, return undeployed reserve) ────────────────────
    /// @notice The team can close a live seed: any pending quote is deployed first, then
    ///         the undeployed remainder of the reserve is returned to the team.
    function closeSeed(bytes32 seedId) external nonReentrant {
        Seed storage s = seeds[seedId];
        if (s.phase != Phase.Live) revert WrongPhase();
        if (msg.sender != s.team) revert NotTeam();

        // Deploy any pending quote so no contributor's funds sit idle.
        uint256 quoteToDeploy = s.quoteRaised - s.deployedQuote;
        if (quoteToDeploy > 0) {
            uint256 tokenToDeploy = _matchToken(s, quoteToDeploy);
            s.deployedQuote += quoteToDeploy;
            s.deployedToken += tokenToDeploy;
            _push(s, tokenToDeploy, quoteToDeploy, false);
            emit Grown(seedId, tokenToDeploy, quoteToDeploy, false);
        }

        s.phase = Phase.Grown;
        uint256 leftover = s.tokenReserve - s.deployedToken;
        if (leftover > 0) IERC20(s.projectToken).safeTransfer(s.team, leftover);
        emit SeedClosed(seedId, leftover);
    }

    // ─── Refund path (deadline missed below threshold) ───────────────────────────
    function markRefunding(bytes32 seedId) external {
        Seed storage s = seeds[seedId];
        if (s.phase != Phase.Seeding) revert WrongPhase();
        if (block.timestamp <= s.raiseDeadline) revert NotExpired();
        if (s.quoteRaised >= s.threshold) revert ThresholdMet();
        s.phase = Phase.Refunding;
        emit Refunding(seedId);
    }

    /// @notice Public contributors reclaim their quote after a failed raise.
    function claimRefund(bytes32 seedId) external nonReentrant {
        Seed storage s = seeds[seedId];
        if (s.phase != Phase.Refunding) revert WrongPhase();
        if (refundClaimed[seedId][msg.sender]) revert AlreadyClaimed();
        uint256 amt = contributions[seedId][msg.sender];
        if (amt == 0) revert NothingToDo();

        refundClaimed[seedId][msg.sender] = true;
        IERC20(s.quoteToken).safeTransfer(msg.sender, amt);
        emit RefundClaimed(seedId, msg.sender, amt);
    }

    /// @notice The team reclaims its reserve + pre-funded quote after a failed raise.
    function teamReclaim(bytes32 seedId) external nonReentrant {
        Seed storage s = seeds[seedId];
        if (s.phase != Phase.Refunding) revert WrongPhase();
        if (msg.sender != s.team) revert NotTeam();
        if (s.teamReclaimed) revert AlreadyClaimed();

        s.teamReclaimed = true;
        uint256 reserve = s.tokenReserve;
        uint256 quote   = s.teamQuote;
        if (reserve > 0) IERC20(s.projectToken).safeTransfer(s.team, reserve);
        if (quote > 0)   IERC20(s.quoteToken).safeTransfer(s.team, quote);
        emit TeamReclaimed(seedId, reserve, quote);
    }

    // ─── Internal ────────────────────────────────────────────────────────────────
    /// @dev Proportional match: token = quote * tokenReserve / quoteTarget, capped at the
    ///      undeployed reserve. At a full raise (quoteRaised == quoteTarget) the sum of
    ///      matched token equals tokenReserve exactly — proportional by construction.
    function _matchToken(Seed storage s, uint256 quoteAmt) internal view returns (uint256) {
        uint256 t = (quoteAmt * s.tokenReserve) / s.quoteTarget;
        uint256 remaining = s.tokenReserve - s.deployedToken;
        return t > remaining ? remaining : t;
    }

    /// @dev Push tokens to the target, then invoke its hook (target acts on its balance).
    function _push(Seed storage s, uint256 tokenAmt, uint256 quoteAmt, bool init) internal {
        if (tokenAmt > 0) IERC20(s.projectToken).safeTransfer(s.target, tokenAmt);
        if (quoteAmt > 0) IERC20(s.quoteToken).safeTransfer(s.target, quoteAmt);
        if (init) {
            ISeedTarget(s.target).receiveSeed(s.poolInit, s.projectToken, tokenAmt, s.quoteToken, quoteAmt, s.sqrtPriceX96);
        } else {
            ISeedTarget(s.target).receiveGrowth(s.poolInit, tokenAmt, quoteAmt);
        }
    }

    // ─── Views ───────────────────────────────────────────────────────────────────
    /// @notice Raise progress in bps of the quote target (10_000 = target filled).
    function fillBps(bytes32 seedId) external view returns (uint256) {
        Seed storage s = seeds[seedId];
        if (s.quoteTarget == 0) return 0;
        return (s.quoteRaised * BPS) / s.quoteTarget;
    }

    function thresholdMet(bytes32 seedId) external view returns (bool) {
        Seed storage s = seeds[seedId];
        return s.quoteRaised >= s.threshold && s.threshold > 0;
    }

    function pendingQuote(bytes32 seedId) external view returns (uint256) {
        Seed storage s = seeds[seedId];
        return s.quoteRaised - s.deployedQuote;
    }

    /// @notice Compact state read for UIs/tests (avoids the 16-field struct getter).
    function getState(bytes32 seedId)
        external
        view
        returns (Phase phase, uint256 quoteRaised, uint256 quoteTarget, uint256 deployedToken, uint256 deployedQuote)
    {
        Seed storage s = seeds[seedId];
        return (s.phase, s.quoteRaised, s.quoteTarget, s.deployedToken, s.deployedQuote);
    }
}
