// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback}       from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}          from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts}      from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {MintwarePairVault} from "./MintwarePairVault.sol";
import {PoolProfile}        from "./VaultTypes.sol";

/// @dev Minimal view of MintwareWeightedDistributor used for oracle-weighted fee routing.
interface IMWWeightedDistributor {
    function registerVault(bytes32 vaultId, address token0, address token1) external;
    function fundFees(bytes32 vaultId, uint256 amount0, uint256 amount1) external;
}

interface IFeeVaultNotifier {
    function notifyFeeReceipt(uint256 amount, string calldata source) external;
}

/// @title  MintwareMatchedLiquidityVault
/// @notice Team-locked, community-matched liquidity for MEME / EMERGING launches.
///
///         A dual-sided pair vault (`projectToken` / generic `quoteToken` — USDC, WETH,
///         USDI, …). At launch a team commits `T` of its own token; the community matches
///         it with quote-asset deposits up to a value cap. If a minimum threshold is met
///         within the funding window, the vault activates: the matched liquidity is
///         deployed as a single V4 position, split 50/50 by liquidity between a LOCKED
///         team half and a FREE community half.
///
///         Trust claim (stated precisely): the team's matched liquidity is *locked and
///         cannot be unilaterally withdrawn* until `lockExpiry` — a restriction on
///         withdrawal, not a transfer of ownership. There is deliberately NO team-initiated
///         early-unlock path anywhere in this contract; the only pre-expiry state change is
///         the Stage-1.4 guardian pause, which can *freeze* but never *release* team funds.
///
/// @dev    Purpose-built (does not extend the single-sided DeFiVault). Inherits the
///         Stage-1.4 kill-switch (MWGuardianPausable). Gated to MEME / EMERGING at
///         construction. On-chain fee redirection: during the lock, swap fees (net of the
///         Mintware protocol cut) accrue per *community* liquidity unit only — the team's
///         units are excluded from the denominator, so the team earns 0% and the community
///         absorbs the forgone share exactly, no off-chain merkle, no rounding drift.
contract MintwareMatchedLiquidityVault is MintwarePairVault, IUnlockCallback {
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    enum Phase  { Funding, Active, Aborted }
    enum Action { DeployMatched, RemoveCommunity, RemoveTeam, Collect }

    struct WithdrawalRequest {
        uint256 shares;
        uint256 noticeExpiry;
        bool    executed;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public constant BPS               = 10_000;
    uint256 public constant MIN_LOCK_DURATION = 90 days;   // selectable cliff, 3 months and up
    uint256 public constant MAX_LOCK_DURATION = 730 days;
    uint256 public constant NOTICE_PERIOD     = 7 days;     // community async-redeem notice
    uint256 public constant ACC_PRECISION     = 1e18;       // fee-accumulator scaling
    uint256 public constant MINTWARE_FEE_BPS  = 2_500;      // protocol cut of swap fees
    /// @dev Minimum distinct community depositors required to activate. This is a BASIC
    ///      self-dealing floor, NOT sybil resistance: the team is barred from depositing
    ///      (`depositCommunity` reverts for `team`), but a determined actor can still split funds
    ///      across ≥3 wallets to clear this floor. Real sybil resistance lives OFF-CHAIN in the
    ///      Attribution reputation layer that gates who is surfaced/allowed to participate; this
    ///      constant only stops the most trivial single-wallet self-match. Documented limitation.
    uint256 public constant MIN_COMMUNITY_DEPOSITORS = 3;

    // ─────────────────────────────────────────────────────────────────────────
    // Immutables
    // ─────────────────────────────────────────────────────────────────────────

    IERC20       public immutable projectToken; // team-locked side
    IERC20       public immutable quoteToken;   // community side (USDC / WETH / USDI / …)
    bool         public immutable projIsToken0;
    address      public immutable team;         // provider / launch team
    address      public immutable feeVault;     // epoch sink for the Mintware cut (optional)
    PoolProfile  public immutable profile;      // MEME or EMERGING only

    // ─────────────────────────────────────────────────────────────────────────
    // Launch config (set once at commitTeam)
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public teamTokenCommitment;     // T
    uint256 public targetMatchQuote;        // community deposit cap (quote units)
    uint256 public fundingWindowEnd;
    uint256 public activationThresholdBps;  // vs targetMatchQuote
    uint256 public lockDuration;
    uint256 public lockExpiry;              // set at activation
    uint160 public launchSqrtPriceX96;

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    Phase   public phase;

    uint256 public communityDeposited;      // total quote escrowed during funding
    uint256 public communityDepositorCount;
    mapping(address => uint256) public communityContribution; // quote escrowed (pre-activation)

    // Post-activation liquidity split (units of V4 liquidity).
    uint128 public totalLiquidity;
    uint128 public teamLiquidity;           // locked half
    uint128 public totalCommunityShares;    // free half (== community liquidity units)
    mapping(address => uint256) public communityShares;

    bool public teamWithdrawn;
    bool public teamFeesRedirected;         // true while locked (team excluded from fee denom)

    // Fee accumulators (per liquidity unit, ACC_PRECISION-scaled) — one per asset.
    uint256 public accProjPerShare;
    uint256 public accQuotePerShare;
    mapping(address => uint256) public projDebt;
    mapping(address => uint256) public quoteDebt;
    // Team's own fee position (accrues only AFTER lock expiry).
    uint256 public teamProjDebt;
    uint256 public teamQuoteDebt;

    // Oracle-weighted reward routing (audit migration slice 4). When set, the community
    // LP fee pot routes to MintwareWeightedDistributor (reputation + referral weighting
    // off-chain) instead of the pro-rata per-share accumulator above. Team redirection and
    // the denom==0 protocol-takes-it rule are preserved.
    address public weightedDistributor;
    bytes32 public distributorVaultId;

    /// @notice The canonical MWHookCoordinator this vault's launches must use. Once set, commitTeam
    ///         requires poolKey.hooks == expectedHook — so a launch can't land in an UNPROTECTED
    ///         pool (no vault-only-LP gate / oracle guard). Owner-set at deploy, before any commit.
    address public expectedHook;

    /// @notice Community quote that didn't fit the range at activation (the strand), claimable
    ///         pro-rata to each depositor's contribution (basis frozen at activation).
    uint256 public undeployedQuote;
    uint256 public undeployedQuoteBasis;
    mapping(address => bool) public undeployedClaimed;

    mapping(address => WithdrawalRequest) public withdrawals;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event TeamCommitted(uint256 teamTokens, uint256 targetMatchQuote, uint256 fundingWindowEnd, uint256 lockDuration);
    event CommunityDeposited(address indexed lp, uint256 quoteAmount, uint256 totalDeposited);
    event CommunityFundingWithdrawn(address indexed lp, uint256 quoteAmount);
    event Activated(uint256 matchedQuote, uint256 matchedTokens, uint256 refundedTokens, uint128 liquidity, uint256 lockExpiry);
    event Aborted(uint256 refundedTeamTokens);
    event CommunityRedeemRequested(address indexed lp, uint256 shares, uint256 noticeExpiry);
    event CommunityRedeemed(address indexed lp, uint256 shares, uint256 projOut, uint256 quoteOut);
    event TeamWithdrawn(uint256 projOut, uint256 quoteOut);
    event FeesCollected(uint256 projFees, uint256 quoteFees, uint256 mintwareCut, uint256 denom);
    event WeightedDistributorSet(address indexed distributor, bytes32 indexed vaultId);
    event ExpectedHookSet(address indexed hook);
    event UndeployedQuoteClaimed(address indexed account, uint256 amount);
    event FeesRoutedToDistributor(bytes32 indexed vaultId, uint256 lpProj, uint256 lpQuote);
    event FeesClaimed(address indexed account, uint256 projOut, uint256 quoteOut);
    event LockExpired();

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error NotTeam();
    error WrongPhase();
    error BadProfile();
    error BadLockDuration();
    error BadConfig();
    error PoolPreInitialized();
    error BadPoolHook();
    error HookAlreadySet();
    error AlreadyClaimedUndeployed();
    error AlreadyCommitted();
    error FundingClosed();
    error FundingStillOpen();
    error CapExceeded();
    error TeamCannotMatch();
    error ZeroAmount();
    error ThresholdNotMet();
    error ThresholdWasMet();
    error InsufficientShares();
    error NoRequest();
    error NoticeNotExpired();
    error AlreadyExecuted();
    error StillLocked();
    error NothingToWithdraw();
    error ZeroDistributor();
    error WeightedDistributorAlreadySet();

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(
        address _poolManager,
        address _projectToken,
        address _quoteToken,
        address _team,
        address _treasury,
        address _feeVault,
        PoolProfile _profile,
        address _initialOwner
    ) MintwarePairVault(_poolManager, _treasury, _initialOwner) {
        if (_profile != PoolProfile.MEME && _profile != PoolProfile.EMERGING) revert BadProfile();
        if (_projectToken == address(0) || _quoteToken == address(0) || _projectToken == _quoteToken) revert BadConfig();
        if (_team == address(0) || _treasury == address(0)) revert BadConfig();

        projectToken = IERC20(_projectToken);
        quoteToken   = IERC20(_quoteToken);
        projIsToken0 = _projectToken < _quoteToken;
        team         = _team;
        feeVault     = _feeVault;
        profile      = _profile;
    }

    modifier onlyTeam() {
        if (msg.sender != team) revert NotTeam();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1 — Funding
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Team commits `teamTokens` of the project token and opens the funding window.
    /// @param  poolKey_        the V4 PoolKey for projectToken/quoteToken (hook + fee tier).
    /// @param  launchSqrt      launch price (must sit inside the profile range).
    /// @param  targetQuote     community deposit cap (quote units) — the 1:1 value match target.
    /// @param  fundingWindow   funding duration (e.g. 7 days).
    /// @param  thresholdBps    min community fill vs `targetQuote` to activate (e.g. 5000 = 50%).
    /// @param  lockDur         team lock duration (>= MIN_LOCK_DURATION, hard cliff).
    function commitTeam(
        PoolKey calldata poolKey_,
        uint160 launchSqrt,
        uint256 teamTokens,
        uint256 targetQuote,
        uint256 fundingWindow,
        uint256 thresholdBps,
        uint256 lockDur
    ) external onlyTeam nonReentrant whenNotPaused {
        if (phase != Phase.Funding || fundingWindowEnd != 0) revert AlreadyCommitted();
        if (teamTokens == 0 || targetQuote == 0 || fundingWindow == 0) revert BadConfig();
        if (thresholdBps == 0 || thresholdBps > BPS) revert BadConfig();
        if (lockDur < MIN_LOCK_DURATION || lockDur > MAX_LOCK_DURATION) revert BadLockDuration();
        _validatePoolKey(poolKey_);

        // Range: symmetric profile half-width around the launch tick, aligned to spacing.
        int24 spacing = poolKey_.tickSpacing;
        int24 launchTick = TickMath.getTickAtSqrtPrice(launchSqrt);
        int24 hw = _profileHalfWidth();
        int24 lower = _alignTick(launchTick - hw, spacing);
        int24 upper = _alignTick(launchTick + hw, spacing);
        if (upper <= lower) revert BadConfig();

        poolKey            = poolKey_;
        launchSqrtPriceX96 = launchSqrt;
        tickLower          = lower;
        tickUpper          = upper;
        targetMatchQuote      = targetQuote;
        activationThresholdBps = thresholdBps;
        lockDuration          = lockDur;
        fundingWindowEnd      = block.timestamp + fundingWindow;

        // Initialize the V4 pool NOW — atomic with committing the key — so no griefer can front-run
        // a hostile pre-init between commit and activate (audit HIGH: pre-init permanently bricks
        // activate() and freezes team funds). V4 init is permissionless, so tolerate an existing
        // pool ONLY if it sits at our launch price; a hostile pre-init reverts here, before any
        // escrow, so the team simply retries (no funds staked).
        (uint160 liveSqrt,,,) = StateLibrary.getSlot0(poolManager, PoolIdLibrary.toId(poolKey_));
        if (liveSqrt == 0) {
            _initializePool(launchSqrt);
        } else if (liveSqrt == launchSqrt) {
            poolInitialized = true;
        } else {
            revert PoolPreInitialized();
        }

        // Balance-diff intake — credit what ACTUALLY arrived. This vault is MEME/EMERGING-gated
        // and those tokens commonly carry a transfer tax; nominal accounting would over-book the
        // commitment and revert activate() on settlement (audit: FoT intake, confirmed 4x).
        uint256 balBefore = projectToken.balanceOf(address(this));
        projectToken.safeTransferFrom(msg.sender, address(this), teamTokens);
        teamTokenCommitment = projectToken.balanceOf(address(this)) - balBefore;
        emit TeamCommitted(teamTokenCommitment, targetQuote, fundingWindowEnd, lockDur);
    }

    /// @notice Community matches with quote-asset deposits, first-come up to the cap.
    /// @dev    Deferred: funds are escrowed, NOT deployed, until activation — so an abort
    ///         is a clean refund with no partial pool state.
    function depositCommunity(uint256 quoteAmount) external nonReentrant whenNotPaused {
        if (phase != Phase.Funding || fundingWindowEnd == 0) revert WrongPhase();
        if (block.timestamp >= fundingWindowEnd) revert FundingClosed();
        if (quoteAmount == 0) revert ZeroAmount();
        if (msg.sender == team) revert TeamCannotMatch(); // self-dealing guard
        if (communityDeposited + quoteAmount > targetMatchQuote) revert CapExceeded(); // nominal upper bound (safe)

        // Balance-diff intake (fee-on-transfer safe): credit what actually arrived.
        uint256 balBefore = quoteToken.balanceOf(address(this));
        quoteToken.safeTransferFrom(msg.sender, address(this), quoteAmount);
        uint256 received = quoteToken.balanceOf(address(this)) - balBefore;
        if (received == 0) revert ZeroAmount();

        if (communityContribution[msg.sender] == 0) communityDepositorCount += 1;
        communityContribution[msg.sender] += received;
        communityDeposited += received;
        emit CommunityDeposited(msg.sender, received, communityDeposited);
    }

    /// @notice Community can pull their escrowed deposit back during funding, or reclaim it
    ///         after an abort. NEVER callable once Active — at that point their capital is
    ///         deployed liquidity, redeemable only via requestCommunityRedeem (this path would
    ///         otherwise double-withdraw).
    function withdrawCommunityFunding(uint256 quoteAmount) external nonReentrant {
        if (phase == Phase.Active) revert WrongPhase();
        uint256 contributed = communityContribution[msg.sender];
        if (quoteAmount == 0 || quoteAmount > contributed) revert ZeroAmount();

        communityContribution[msg.sender] = contributed - quoteAmount;
        communityDeposited -= quoteAmount;
        if (communityContribution[msg.sender] == 0 && communityDepositorCount > 0) {
            communityDepositorCount -= 1;
        }

        quoteToken.safeTransfer(msg.sender, quoteAmount);
        emit CommunityFundingWithdrawn(msg.sender, quoteAmount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2 — Activation / Abort
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Activate the vault once the funding window closes and the threshold is met.
    ///         Permissionless (anyone can trigger the settlement).
    function activate() external nonReentrant whenNotPaused {
        if (phase != Phase.Funding || fundingWindowEnd == 0) revert WrongPhase();
        // Allow early activation only when the cap is fully filled; otherwise wait for window.
        if (block.timestamp < fundingWindowEnd && communityDeposited < targetMatchQuote) revert FundingStillOpen();

        uint256 matched = communityDeposited;
        if (matched < (targetMatchQuote * activationThresholdBps) / BPS) revert ThresholdNotMet();
        if (communityDepositorCount < MIN_COMMUNITY_DEPOSITORS) revert ThresholdNotMet();

        // Scale the team side down to the matched fraction; refund the unmatched remainder.
        uint256 matchedTokens = (teamTokenCommitment * matched) / targetMatchQuote;
        uint256 refund        = teamTokenCommitment - matchedTokens;

        phase       = Phase.Active;
        lockExpiry  = block.timestamp + lockDuration;
        teamFeesRedirected = true;

        if (refund > 0) projectToken.safeTransfer(team, refund);

        // Deploy the matched liquidity as one position; split 50/50 team(locked)/community(free).
        bytes memory res = poolManager.unlock(
            abi.encode(Action.DeployMatched, abi.encode(matchedTokens, matched))
        );
        (uint128 liquidity, uint256 usedProj, uint256 usedQuote) = abi.decode(res, (uint128, uint256, uint256));

        teamLiquidity        = liquidity / 2;
        totalCommunityShares = liquidity - teamLiquidity; // remainder to community (favor community)
        totalCommunityShares0 = totalCommunityShares;      // frozen basis for pro-rata derivation
        totalLiquidity       = liquidity;

        // Refund the undeployed remainder: the team's project side directly (single recipient), and
        // the community's quote side pro-rata to each depositor's contribution via claimUndeployedQuote.
        if (matchedTokens > usedProj) projectToken.safeTransfer(team, matchedTokens - usedProj);
        if (matched > usedQuote) {
            undeployedQuote      = matched - usedQuote;
            undeployedQuoteBasis = matched; // == communityDeposited at activation, frozen
        }

        // Community shares are pro-rata to quote contribution, derived lazily from `communityContribution`
        // on first interaction (keeps activation O(1)). The fee accumulators are 0 here, so every
        // community LP's fee baseline is 0 — they all earn from the first `collectFees` after activation.
        emit Activated(matched, matchedTokens, refund, liquidity, lockExpiry);
    }

    /// @notice Abort after the window if the threshold was not met — full refund, no lock.
    ///         Community principals are pull-refunded individually via `withdrawCommunityFunding`.
    function abort() external nonReentrant {
        if (phase != Phase.Funding || fundingWindowEnd == 0) revert WrongPhase();
        if (block.timestamp < fundingWindowEnd) revert FundingStillOpen();
        if (
            communityDeposited >= (targetMatchQuote * activationThresholdBps) / BPS &&
            communityDepositorCount >= MIN_COMMUNITY_DEPOSITORS
        ) revert ThresholdWasMet();

        phase = Phase.Aborted;
        uint256 teamRefund = teamTokenCommitment;
        teamTokenCommitment = 0;
        if (teamRefund > 0) projectToken.safeTransfer(team, teamRefund);
        emit Aborted(teamRefund);
        // Community pulls its escrow back via withdrawCommunityFunding (phase still allows it).
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3 — Community redeem (async, never locked) + fee claims
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Each community LP's share of the free (community) liquidity half, pro-rata to
    ///         their quote contribution. Derived (not stored per-LP at activation) so activation
    ///         stays O(1).
    /// @dev    Rounding is SOLVENCY-SAFE by design: each LP's allocation floors
    ///         (`totalCommunityShares0 * contribution / communityDeposited`), so the sum of all
    ///         derived shares is ≤ `totalCommunityShares0`. The unassigned remainder (a few
    ///         liquidity units of floor-dust) is never over-distributed — it simply stays as
    ///         un-redeemable community liquidity in the pool, so the vault can always cover every
    ///         claim and the last redeemer is never short. It is NOT stranded value owed to anyone.
    function communityShareOf(address lp) public view returns (uint256) {
        if (phase != Phase.Active || communityDeposited == 0) return communityShares[lp];
        // If they have already partially redeemed, `communityShares[lp]` holds the live balance;
        // otherwise derive the initial allocation from contribution.
        if (_initialized[lp]) return communityShares[lp];
        return (uint256(totalCommunityShares0) * communityContribution[lp]) / communityDeposited;
    }

    // Bookkeeping so derived shares can be "materialized" on first interaction.
    uint128 private totalCommunityShares0; // community liquidity minted at activation (const post-activation)
    mapping(address => bool) private _initialized;

    function _materialize(address lp) internal {
        if (!_initialized[lp] && phase == Phase.Active) {
            uint256 s = communityDeposited == 0
                ? 0
                : (uint256(totalCommunityShares0) * communityContribution[lp]) / communityDeposited;
            communityShares[lp] = s;
            _initialized[lp] = true;
            // Fee debt baseline stays 0: every community LP has held its share since activation
            // (accumulator == 0 then), so it is entitled to all fees distributed since. Materializing
            // late must NOT forfeit that — hence no debt is set here.
        }
    }

    /// @notice Step 1: queue a redemption of `shares` community liquidity units.
    function requestCommunityRedeem(uint256 shares) external nonReentrant {
        if (phase != Phase.Active) revert WrongPhase();
        _materialize(msg.sender);
        if (shares == 0 || shares > communityShares[msg.sender]) revert InsufficientShares();
        uint256 expiry = block.timestamp + NOTICE_PERIOD;
        withdrawals[msg.sender] = WithdrawalRequest({shares: shares, noticeExpiry: expiry, executed: false});
        emit CommunityRedeemRequested(msg.sender, shares, expiry);
    }

    /// @notice Step 2: execute after the notice period — removes proportional liquidity and
    ///         returns both tokens plus accrued fees. Community is NEVER locked.
    function executeCommunityRedeem() external nonReentrant whenNotPaused returns (uint256 projOut, uint256 quoteOut) {
        WithdrawalRequest storage req = withdrawals[msg.sender];
        if (req.shares == 0) revert NoRequest();
        if (req.executed) revert AlreadyExecuted();
        if (block.timestamp < req.noticeExpiry) revert NoticeNotExpired();

        _materialize(msg.sender);
        _expireLock();
        uint256 shares = req.shares;
        if (shares > communityShares[msg.sender]) shares = communityShares[msg.sender];
        req.executed = true;

        // Realize + distribute all pending fees FIRST — this brings the accumulator current and
        // leaves the position fee-free, so the removal below returns pure principal. Then settle
        // this LP's fee share on their pre-burn balance.
        _realizeFees();
        _claimFees(msg.sender);

        // Effects
        communityShares[msg.sender] -= shares;
        totalCommunityShares        -= uint128(shares);
        totalLiquidity              -= uint128(shares);

        // Interactions — remove `shares` liquidity units, return proceeds to the LP.
        bytes memory res = poolManager.unlock(abi.encode(Action.RemoveCommunity, abi.encode(uint128(shares), msg.sender)));
        (projOut, quoteOut) = abi.decode(res, (uint256, uint256));

        // Reset debt to current acc for the remaining balance.
        projDebt[msg.sender]  = (communityShares[msg.sender] * accProjPerShare)  / ACC_PRECISION;
        quoteDebt[msg.sender] = (communityShares[msg.sender] * accQuotePerShare) / ACC_PRECISION;

        emit CommunityRedeemed(msg.sender, shares, projOut, quoteOut);
    }

    /// @notice Claim accrued swap-fee share (both assets) without redeeming principal.
    function claimCommunityFees() external nonReentrant {
        if (phase != Phase.Active) revert WrongPhase();
        _materialize(msg.sender);
        _claimFees(msg.sender);
    }

    function _claimFees(address lp) internal {
        uint256 s = communityShares[lp];
        uint256 projAccrued  = (s * accProjPerShare)  / ACC_PRECISION - projDebt[lp];
        uint256 quoteAccrued = (s * accQuotePerShare) / ACC_PRECISION - quoteDebt[lp];
        projDebt[lp]  = (s * accProjPerShare)  / ACC_PRECISION;
        quoteDebt[lp] = (s * accQuotePerShare) / ACC_PRECISION;
        if (projAccrued > 0)  projectToken.safeTransfer(lp, projAccrued);
        if (quoteAccrued > 0) quoteToken.safeTransfer(lp, quoteAccrued);
        if (projAccrued > 0 || quoteAccrued > 0) emit FeesClaimed(lp, projAccrued, quoteAccrued);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4 — Team withdrawal (hard cliff, no bypass)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Withdraw the team's locked liquidity — ONLY at/after `lockExpiry`. Hard cliff.
    /// @dev    This is the single team-fund-moving path in the contract, and it is
    ///         unconditionally gated on `block.timestamp >= lockExpiry`. No owner override,
    ///         no governance path, no emergency release — the guardian pause can freeze this
    ///         call but can never satisfy the cliff. That absence IS the trust guarantee.
    function teamWithdraw() external onlyTeam nonReentrant whenNotPaused returns (uint256 projOut, uint256 quoteOut) {
        if (phase != Phase.Active) revert WrongPhase();
        if (block.timestamp < lockExpiry) revert StillLocked();
        if (teamWithdrawn || teamLiquidity == 0) revert NothingToWithdraw();

        _expireLock();

        // Realize + distribute pending fees first (fee-free position for a clean principal removal),
        // then settle the team's post-lock fee share (accrues only after lockExpiry).
        _realizeFees();
        _claimTeamFees();

        uint128 liq = teamLiquidity;
        teamWithdrawn  = true;
        teamLiquidity  = 0;
        totalLiquidity -= liq;

        bytes memory res = poolManager.unlock(abi.encode(Action.RemoveTeam, abi.encode(liq, team)));
        (projOut, quoteOut) = abi.decode(res, (uint256, uint256));
        emit TeamWithdrawn(projOut, quoteOut);
    }

    /// @notice Team claims post-lock swap fees (only accrue after lockExpiry).
    function claimTeamFees() external onlyTeam nonReentrant {
        if (phase != Phase.Active) revert WrongPhase();
        _expireLock();
        _claimTeamFees();
    }

    function _claimTeamFees() internal {
        if (teamFeesRedirected || teamLiquidity == 0) return; // still locked → team earns 0
        uint256 s = teamLiquidity;
        uint256 projAccrued  = (s * accProjPerShare)  / ACC_PRECISION - teamProjDebt;
        uint256 quoteAccrued = (s * accQuotePerShare) / ACC_PRECISION - teamQuoteDebt;
        teamProjDebt  = (s * accProjPerShare)  / ACC_PRECISION;
        teamQuoteDebt = (s * accQuotePerShare) / ACC_PRECISION;
        if (projAccrued > 0)  projectToken.safeTransfer(team, projAccrued);
        if (quoteAccrued > 0) quoteToken.safeTransfer(team, quoteAccrued);
        if (projAccrued > 0 || quoteAccrued > 0) emit FeesClaimed(team, projAccrued, quoteAccrued);
    }

    /// @dev Flip the team back into the fee denominator once the lock has expired, resetting
    ///      its debt to the current accumulator so it cannot back-claim lock-period fees.
    function _expireLock() internal {
        if (teamFeesRedirected && block.timestamp >= lockExpiry) {
            teamFeesRedirected = false;
            teamProjDebt  = (uint256(teamLiquidity) * accProjPerShare)  / ACC_PRECISION;
            teamQuoteDebt = (uint256(teamLiquidity) * accQuotePerShare) / ACC_PRECISION;
            emit LockExpired();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fee collection — realize V4 swap fees + on-chain redirection
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Realize accrued swap fees on the vault position and distribute:
    ///           - MINTWARE_FEE_BPS to the Mintware protocol (treasury / FeeVault),
    ///           - the remainder across the fee denominator: community-only while locked
    ///             (team earns 0%, community absorbs the forgone share), community+team after.
    ///         Permissionless (keeper-callable).
    function collectFees() external nonReentrant whenNotPaused returns (uint256 projFees, uint256 quoteFees) {
        if (phase != Phase.Active) revert WrongPhase();
        _expireLock();
        return _realizeFees();
    }

    /// @dev Realize + distribute accrued position fees. Called by collectFees() and, crucially,
    ///      immediately before every liquidity removal so the removal delta is pure principal
    ///      (V4 auto-realizes a position's fees on any modifyLiquidity call).
    function _realizeFees() internal returns (uint256 projFees, uint256 quoteFees) {
        bytes memory res = poolManager.unlock(abi.encode(Action.Collect, bytes("")));
        (projFees, quoteFees) = abi.decode(res, (uint256, uint256));
        if (projFees == 0 && quoteFees == 0) return (0, 0);

        uint256 mintProj  = (projFees  * MINTWARE_FEE_BPS) / BPS;
        uint256 mintQuote = (quoteFees * MINTWARE_FEE_BPS) / BPS;
        uint256 lpProj    = projFees  - mintProj;
        uint256 lpQuote   = quoteFees - mintQuote;

        // Mintware cut → treasury (both assets). Quote also mirrors into FeeVault epoch if wired.
        if (mintProj > 0)  projectToken.safeTransfer(treasury, mintProj);
        if (mintQuote > 0) {
            if (feeVault != address(0)) {
                quoteToken.safeTransfer(feeVault, mintQuote);
                IFeeVaultNotifier(feeVault).notifyFeeReceipt(mintQuote, "matched_trading_fee");
            } else {
                quoteToken.safeTransfer(treasury, mintQuote);
            }
        }

        // Denominator: while locked, community only (team excluded → earns 0%).
        uint256 denom = teamFeesRedirected ? totalCommunityShares : (totalCommunityShares + teamLiquidity);
        if (denom == 0) {
            // No eligible liquidity to reward (e.g. all community exited mid-lock) → protocol takes it.
            if (lpProj > 0)  projectToken.safeTransfer(treasury, lpProj);
            if (lpQuote > 0) quoteToken.safeTransfer(treasury, lpQuote);
        } else if (weightedDistributor != address(0)) {
            // Canonical: route the community LP fee pot to the oracle-weighted distributor.
            // Off-chain weighting excludes the team while locked (mirrors the denom rule).
            if (lpProj > 0 || lpQuote > 0) {
                // JIT exact-amount approvals (audit LOW: no standing max allowance to the distributor).
                if (lpProj  > 0) projectToken.forceApprove(weightedDistributor, lpProj);
                if (lpQuote > 0) quoteToken.forceApprove(weightedDistributor, lpQuote);
                IMWWeightedDistributor(weightedDistributor).fundFees(distributorVaultId, lpProj, lpQuote);
                if (lpProj  > 0) projectToken.forceApprove(weightedDistributor, 0);
                if (lpQuote > 0) quoteToken.forceApprove(weightedDistributor, 0);
                emit FeesRoutedToDistributor(distributorVaultId, lpProj, lpQuote);
            }
        } else {
            accProjPerShare  += (lpProj  * ACC_PRECISION) / denom;
            accQuotePerShare += (lpQuote * ACC_PRECISION) / denom;
        }
        emit FeesCollected(projFees, quoteFees, mintProj + mintQuote, denom);
    }

    /// @notice One-time wiring of the reputation + referral weighted distributor. Once set,
    ///         realized community LP fees route there instead of the pro-rata accumulator.
    ///         Registers the (project, quote) pair and grants the pull allowance for fundFees().
    function setWeightedDistributor(address dist, bytes32 vaultId) external onlyOwner {
        if (dist == address(0))                revert ZeroDistributor();
        if (weightedDistributor != address(0)) revert WeightedDistributorAlreadySet();
        weightedDistributor = dist;
        distributorVaultId  = vaultId;
        IMWWeightedDistributor(dist).registerVault(vaultId, address(projectToken), address(quoteToken));
        // No standing max approval (audit LOW): fundFees gets a JIT exact-amount approval instead.
        emit WeightedDistributorSet(dist, vaultId);
    }

    /// @notice One-time wiring of the canonical MWHookCoordinator. Must be set (to a coordinator
    ///         whose `vault` is this contract) before any commitTeam so launches use the protected
    ///         pool. See DeployMatchedVault.s.sol.
    function setExpectedHook(address hook) external onlyOwner {
        if (hook == address(0))          revert BadPoolHook();
        if (expectedHook != address(0))  revert HookAlreadySet();
        expectedHook = hook;
        emit ExpectedHookSet(hook);
    }

    /// @notice Claim your pro-rata share of the community quote that didn't fit the range at
    ///         activation (refunded by contribution, once). No-op-safe; not gated by pause so
    ///         community can always recover.
    function claimUndeployedQuote() external nonReentrant {
        if (undeployedClaimed[msg.sender]) revert AlreadyClaimedUndeployed();
        uint256 contrib = communityContribution[msg.sender];
        if (contrib == 0 || undeployedQuote == 0) revert ZeroAmount();
        undeployedClaimed[msg.sender] = true;
        uint256 amt = (undeployedQuote * contrib) / undeployedQuoteBasis;
        if (amt > 0) quoteToken.safeTransfer(msg.sender, amt);
        emit UndeployedQuoteClaimed(msg.sender, amt);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IUnlockCallback — V4 liquidity operations
    // ─────────────────────────────────────────────────────────────────────────

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        _onlyPoolManager();
        (Action action, bytes memory params) = abi.decode(data, (Action, bytes));

        if (action == Action.DeployMatched) {
            (uint256 projAmt, uint256 quoteAmt) = abi.decode(params, (uint256, uint256));
            return _deployMatched(projAmt, quoteAmt);
        }
        if (action == Action.RemoveCommunity) {
            (uint128 liq, address to) = abi.decode(params, (uint128, address));
            return _removeLiquidityTo(liq, to);
        }
        if (action == Action.RemoveTeam) {
            (uint128 liq, address to) = abi.decode(params, (uint128, address));
            return _removeLiquidityTo(liq, to);
        }
        return _collect();
    }

    function _deployMatched(uint256 projAmt, uint256 quoteAmt) internal returns (bytes memory) {
        // The pool is initialized atomically in commitTeam (front-run-proof), so it is always
        // initialized by the time activation deploys liquidity here.
        (uint256 amt0, uint256 amt1) = projIsToken0 ? (projAmt, quoteAmt) : (quoteAmt, projAmt);

        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            launchSqrtPriceX96, sqrtLower, sqrtUpper, amt0, amt1
        );

        uint256 b0 = IERC20(Currency.unwrap(poolKey.currency0)).balanceOf(address(this));
        uint256 b1 = IERC20(Currency.unwrap(poolKey.currency1)).balanceOf(address(this));
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)}),
            ""
        );
        _settleDelta(delta);
        // Measure what was ACTUALLY consumed — the range binds on min(L0,L1), so one side is only
        // partially deployed and its remainder must be refunded (audit: imbalanced-deploy strand).
        uint256 used0 = b0 - IERC20(Currency.unwrap(poolKey.currency0)).balanceOf(address(this));
        uint256 used1 = b1 - IERC20(Currency.unwrap(poolKey.currency1)).balanceOf(address(this));
        (uint256 usedProj, uint256 usedQuote) = projIsToken0 ? (used0, used1) : (used1, used0);
        return abi.encode(liquidity, usedProj, usedQuote);
    }

    function _removeLiquidityTo(uint128 liquidity, address to) internal returns (bytes memory) {
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: -int256(uint256(liquidity)), salt: bytes32(0)}),
            ""
        );
        // Take the freed tokens to `to` directly.
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        uint256 out0 = d0 > 0 ? uint256(uint128(d0)) : 0;
        uint256 out1 = d1 > 0 ? uint256(uint128(d1)) : 0;
        if (out0 > 0) poolManager.take(poolKey.currency0, to, out0);
        if (out1 > 0) poolManager.take(poolKey.currency1, to, out1);
        (uint256 projOut, uint256 quoteOut) = projIsToken0 ? (out0, out1) : (out1, out0);
        return abi.encode(projOut, quoteOut);
    }

    function _collect() internal returns (bytes memory) {
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: 0, salt: bytes32(0)}),
            ""
        );
        _settleDelta(delta);
        uint256 amt0 = delta.amount0() > 0 ? uint256(uint128(delta.amount0())) : 0;
        uint256 amt1 = delta.amount1() > 0 ? uint256(uint128(delta.amount1())) : 0;
        (uint256 projFees, uint256 quoteFees) = projIsToken0 ? (amt0, amt1) : (amt1, amt0);
        return abi.encode(projFees, quoteFees);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // V4 settlement helpers
    // ─────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _validatePoolKey(PoolKey calldata key) internal view {
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool ok = projIsToken0
            ? (c0 == address(projectToken) && c1 == address(quoteToken))
            : (c1 == address(projectToken) && c0 == address(quoteToken));
        if (!ok) revert BadConfig();
        // Bind to the canonical hook once wired — an arbitrary/zero hook would leave the launch
        // pool without the vault-only-LP gate + oracle guard (audit HIGH: unprotected pool).
        if (expectedHook != address(0) && address(key.hooks) != expectedHook) revert BadPoolHook();
    }

    function _profileHalfWidth() internal view returns (int24) {
        // MEME / EMERGING only (BLUE_CHIP barred at construction).
        return profile == PoolProfile.EMERGING ? int24(1200) : int24(2400);
    }

    function _alignTick(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 rounded = (tick / spacing) * spacing;
        if (tick < 0 && rounded != tick) rounded -= spacing;
        return rounded;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function isLocked() external view returns (bool) {
        return phase == Phase.Active && block.timestamp < lockExpiry;
    }

    function pendingCommunityFees(address lp) external view returns (uint256 projPending, uint256 quotePending) {
        uint256 s = _initialized[lp] || phase != Phase.Active
            ? communityShares[lp]
            : (communityDeposited == 0 ? 0 : (uint256(totalCommunityShares0) * communityContribution[lp]) / communityDeposited);
        projPending  = (s * accProjPerShare)  / ACC_PRECISION - projDebt[lp];
        quotePending = (s * accQuotePerShare) / ACC_PRECISION - quoteDebt[lp];
    }
}
