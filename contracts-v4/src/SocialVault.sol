// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback}     from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary}       from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}        from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary}        from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath}            from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts}    from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IERC20}              from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}           from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}             from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard}     from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712}              from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA}               from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title  SocialVault
/// @notice Manages community USDC deposits + team PROJECT token seeds.
///         Pairs them in a Uniswap V4 pool via MWSocialHook.
///
/// @dev    Three-role model:
///           - Teams    → seed PROJECT tokens, gain pool health score (no fee share)
///           - Community → deposit USDC, earn fees weighted by Attribution + lock tier
///           - Referrers → tracked off-chain, earn via FeeVault epoch distribution
///
///         Lock tiers:
///           Flex      (0d)   1.0× fee multiplier
///           Committed (30d)  1.15×
///           Aligned   (90d)  1.30×
///           Core     (180d)  1.50×
///
///         Early exit penalties (applied when lock not expired):
///           < 20% of lock elapsed → 2.0%
///           20–50%               → 1.0%
///           50–80%               → 0.5%
///           > 80%                → 0.0%
///         Penalties route to FeeVault (redistributed to remaining LPs).
///
///         Withdrawal flow:
///           1. requestWithdrawal() — 7-day notice period
///           2. executeWithdrawal() — callable after noticeExpiry
///
///         V4 integration:
///           SocialVault implements IUnlockCallback. All pool interactions
///           (addLiquidity, removeLiquidity, rebalance) go through the
///           poolManager.unlock() → unlockCallback() → modifyLiquidity pattern.
///           Only SocialVault can LP (enforced by MWSocialHook.beforeAddLiquidity).
contract SocialVault is Ownable, ReentrancyGuard, IUnlockCallback, EIP712 {
    using SafeERC20    for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    enum LockTier {
        Flex,       // 0 days
        Committed,  // 30 days
        Aligned,    // 90 days
        Core        // 180 days
    }

    struct LPPosition {
        uint256 usdcDeposited;   // USDC deposited (principal)
        uint256 depositedAt;     // block.timestamp at deposit
        uint256 lockedUntil;     // block.timestamp + lockDuration
        LockTier tier;
        bool    compoundEnabled; // auto-compound fee earnings
    }

    struct WithdrawalRequest {
        uint256 amount;         // USDC to withdraw
        uint256 requestedAt;
        uint256 noticeExpiry;   // requestedAt + NOTICE_PERIOD
        bool    executed;
    }

    struct TeamSeed {
        address projectToken;
        uint256 amount;
        uint256 seededAt;
    }

    /// @dev Action enum used to dispatch inside unlockCallback
    enum Action { AddLiquidity, RemoveLiquidity, Rebalance }

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public constant NOTICE_PERIOD         = 7 days;
    uint256 public constant MIN_HOLD_PERIOD       = 24 hours;
    uint256 public constant LOCK_COMMITTED        = 30 days;
    uint256 public constant LOCK_ALIGNED          = 90 days;
    uint256 public constant LOCK_CORE             = 180 days;

    /// @dev Early exit penalty in bps (10_000 = 100%)
    uint256 public constant PENALTY_TIER_1_BPS    = 200;  // 2.0%
    uint256 public constant PENALTY_TIER_2_BPS    = 100;  // 1.0%
    uint256 public constant PENALTY_TIER_3_BPS    = 50;   //  0.5%

    uint256 public constant BPS                   = 10_000;

    /// @dev EIP-712 type hash for RangeProposal — must match T4.2 rangeProposer.ts
    bytes32 public constant RANGE_TYPEHASH = keccak256(
        "RangeProposal(bytes32 vaultId,int24 tickLower,int24 tickUpper,uint256 validUntil,uint256 nonce)"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Immutables
    // ─────────────────────────────────────────────────────────────────────────

    IERC20         public immutable usdc;
    IPoolManager   public immutable poolManager;
    address        public immutable feeVault;
    // NOTE: hook address not stored here — it lives in the PoolKey passed to seedTeamTokens.
    // MWSocialHook.beforeAddLiquidity enforces that only SocialVault can call modifyLiquidity.

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice LP positions per wallet
    mapping(address => LPPosition) public positions;

    /// @notice Pending withdrawal requests per wallet
    mapping(address => WithdrawalRequest) public withdrawalRequests;

    /// @notice Team seeds per vaultId (one seed per team)
    mapping(bytes32 => TeamSeed) public teamSeeds;

    /// @notice Oracle address that signs RangeProposal EIP-712 messages
    address public oracleSigner;

    /// @notice Tracks used nonces per vaultId to prevent replay attacks
    mapping(bytes32 => mapping(uint256 => bool)) public usedNonces;

    /// @notice Total USDC currently deposited in vault (principal only)
    uint256 public totalDeposits;

    /// @notice Pool key for this vault's V4 pool
    PoolKey public poolKey;

    /// @notice Whether the V4 pool has been initialized
    bool public poolInitialized;

    /// @notice Current LP position tick range (defaults: full range)
    int24 public tickLower = -887220;
    int24 public tickUpper =  887220;

    /// @notice Total liquidity currently held in the V4 position
    uint128 public totalLiquidity;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event Deposited(address indexed lp, uint256 amount, LockTier tier);
    event WithdrawalRequested(address indexed lp, uint256 amount, uint256 noticeExpiry);
    event WithdrawalExecuted(address indexed lp, uint256 amount, uint256 penalty);
    event Compounded(address indexed lp, uint256 feeAmount);
    event TeamSeeded(bytes32 indexed vaultId, address token, uint256 amount);
    event PoolInitialized(bytes32 indexed poolId, uint160 sqrtPriceX96);
    event OracleSignerSet(address indexed newSigner);
    event Rebalanced(int24 newTickLower, int24 newTickUpper, uint128 newLiquidity);
    event RebalancedWithProposal(bytes32 indexed vaultId, int24 newTickLower, int24 newTickUpper, uint256 nonce, address submitter);
    event LiquidityAdded(uint128 liquidity, uint256 usdcAmount);
    event LiquidityRemoved(uint128 liquidity);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error MinHoldNotMet();
    error LockNotExpired();
    error NoWithdrawalRequest();
    error NoticeNotExpired();
    error WithdrawalAlreadyExecuted();
    error PoolNotInitialized();
    error PoolAlreadyInitialized();
    error InsufficientDeposit();
    error OnlyFeeVault();
    error OnlyPoolManager();
    error OracleSignerNotSet();
    error ProposalExpired();
    error NonceAlreadyUsed();
    error InvalidOracleSignature();

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(
        address _usdc,
        address _poolManager,
        address _feeVault
    ) Ownable(msg.sender) EIP712("MWSocialVault", "1") {
        usdc        = IERC20(_usdc);
        poolManager = IPoolManager(_poolManager);
        feeVault    = _feeVault;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Community LP — deposit
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Deposit USDC into the vault with a chosen lock tier
    function deposit(uint256 amount, LockTier tier) external nonReentrant {
        if (amount == 0) revert InsufficientDeposit();

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        uint256 lockDuration = _lockDuration(tier);

        positions[msg.sender] = LPPosition({
            usdcDeposited:   positions[msg.sender].usdcDeposited + amount,
            depositedAt:     block.timestamp,
            lockedUntil:     block.timestamp + lockDuration,
            tier:            tier,
            compoundEnabled: false
        });

        totalDeposits += amount;

        // Add to V4 pool if initialized
        if (poolInitialized) {
            _addLiquidity(amount);
        }

        emit Deposited(msg.sender, amount, tier);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Community LP — withdrawal (2-step)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Step 1: request withdrawal — starts 7-day notice period
    function requestWithdrawal(uint256 amount) external {
        LPPosition storage pos = positions[msg.sender];
        if (block.timestamp < pos.depositedAt + MIN_HOLD_PERIOD) revert MinHoldNotMet();
        if (amount > pos.usdcDeposited) revert InsufficientDeposit();

        uint256 expiry = block.timestamp + NOTICE_PERIOD;
        withdrawalRequests[msg.sender] = WithdrawalRequest({
            amount:       amount,
            requestedAt:  block.timestamp,
            noticeExpiry: expiry,
            executed:     false
        });

        emit WithdrawalRequested(msg.sender, amount, expiry);
    }

    /// @notice Step 2: execute withdrawal after notice period
    function executeWithdrawal() external nonReentrant {
        WithdrawalRequest storage req = withdrawalRequests[msg.sender];
        if (req.amount == 0)                        revert NoWithdrawalRequest();
        if (req.executed)                           revert WithdrawalAlreadyExecuted();
        if (block.timestamp < req.noticeExpiry)     revert NoticeNotExpired();

        LPPosition storage pos = positions[msg.sender];

        // Compute penalty and proportional liquidity BEFORE state updates
        uint256 penalty = _calculatePenalty(pos, req.amount);
        uint256 payout  = req.amount - penalty;

        // Compute proportional liquidity to remove (must use pre-decrement totalDeposits)
        uint128 liqToRemove = 0;
        if (poolInitialized && totalLiquidity > 0 && totalDeposits > 0) {
            liqToRemove = uint128(
                uint256(totalLiquidity) * req.amount / totalDeposits
            );
        }

        // Update state
        req.executed       = true;
        pos.usdcDeposited -= req.amount;
        totalDeposits     -= req.amount;

        // Remove proportional liquidity (returns USDC to this contract)
        if (liqToRemove > 0) {
            _removeLiquidity(liqToRemove);
        }

        // Route penalty to FeeVault
        if (penalty > 0) {
            usdc.safeTransfer(feeVault, penalty);
        }

        // V4 fixed-point rounding may return 1 wei less than deposited when removing
        // liquidity. Cap payout at available balance to prevent a 1-wei revert.
        uint256 available = usdc.balanceOf(address(this));
        if (payout > available) payout = available;

        usdc.safeTransfer(msg.sender, payout);

        emit WithdrawalExecuted(msg.sender, payout, penalty);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Auto-compound — called by FeeVault at epoch close
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice FeeVault calls this to compound an LP's fee earnings back into position
    function compound(address lp, uint256 feeAmount) external nonReentrant {
        if (msg.sender != feeVault) revert OnlyFeeVault();

        usdc.safeTransferFrom(feeVault, address(this), feeAmount);

        LPPosition storage pos = positions[lp];
        pos.usdcDeposited += feeAmount;
        totalDeposits     += feeAmount;

        if (poolInitialized) {
            _addLiquidity(feeAmount);
        }

        emit Compounded(lp, feeAmount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Team seeding
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Team seeds PROJECT tokens and initialises the V4 pool
    /// @param vaultId       Off-chain vault identifier (keccak of team address + project token)
    /// @param projectToken  The PROJECT ERC-20 token address
    /// @param amount        Amount of PROJECT tokens to seed
    /// @param key           V4 PoolKey (currency0, currency1, fee, tickSpacing, hooks)
    /// @param sqrtPriceX96  Initial pool price as Q64.96 sqrt price
    function seedTeamTokens(
        bytes32 vaultId,
        address projectToken,
        uint256 amount,
        PoolKey calldata key,
        uint160 sqrtPriceX96
    ) external nonReentrant {
        IERC20(projectToken).safeTransferFrom(msg.sender, address(this), amount);

        teamSeeds[vaultId] = TeamSeed({
            projectToken: projectToken,
            amount:       amount,
            seededAt:     block.timestamp
        });

        // Initialize V4 pool on first team seed
        if (!poolInitialized) {
            _initializePool(key, sqrtPriceX96);
        }

        emit TeamSeeded(vaultId, projectToken, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Rebalancing — called by owner (AI oracle or epoch boundary)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Rebalance all liquidity to a new tick range atomically
    /// @dev    Removes all liquidity from the current range, updates tick range,
    ///         then re-adds all USDC at the new range — all in one unlock callback.
    function rebalance(
        int24 newTickLower,
        int24 newTickUpper
    ) external onlyOwner nonReentrant {
        if (!poolInitialized) revert PoolNotInitialized();

        poolManager.unlock(
            abi.encode(Action.Rebalance, abi.encode(newTickLower, newTickUpper))
        );

        emit Rebalanced(newTickLower, newTickUpper, totalLiquidity);
    }

    /// @notice Update the oracle signer address (onlyOwner)
    function setOracleSigner(address signer) external onlyOwner {
        oracleSigner = signer;
        emit OracleSignerSet(signer);
    }

    /// @notice Permissionless rebalance using a signed RangeProposal from the oracle.
    ///         Anyone can submit a valid signed proposal — no owner required.
    ///         Validates EIP-712 signature, expiry, and per-vault nonce uniqueness.
    /// @param vaultId         keccak256(toBytes(dbUUID)) — must match the signed message
    /// @param newTickLower    Proposed tick lower bound
    /// @param newTickUpper    Proposed tick upper bound
    /// @param validUntil      Unix timestamp after which the proposal is expired
    /// @param nonce           Monotonically increasing per-vault nonce (anti-replay)
    /// @param oracleSignature EIP-712 signature from the oracle signer
    function rebalanceWithProposal(
        bytes32 vaultId,
        int24   newTickLower,
        int24   newTickUpper,
        uint256 validUntil,
        uint256 nonce,
        bytes calldata oracleSignature
    ) external nonReentrant {
        if (!poolInitialized)               revert PoolNotInitialized();
        if (oracleSigner == address(0))     revert OracleSignerNotSet();
        if (block.timestamp > validUntil)   revert ProposalExpired();
        if (usedNonces[vaultId][nonce])     revert NonceAlreadyUsed();

        // Reconstruct EIP-712 struct hash
        bytes32 structHash = keccak256(abi.encode(
            RANGE_TYPEHASH,
            vaultId,
            newTickLower,
            newTickUpper,
            validUntil,
            nonce
        ));

        // Verify oracle signature
        bytes32 digest  = _hashTypedDataV4(structHash);
        address signer  = ECDSA.recover(digest, oracleSignature);
        if (signer != oracleSigner) revert InvalidOracleSignature();

        // Mark nonce used before external calls (CEI)
        usedNonces[vaultId][nonce] = true;

        // Execute the rebalance
        poolManager.unlock(
            abi.encode(Action.Rebalance, abi.encode(newTickLower, newTickUpper))
        );

        emit RebalancedWithProposal(vaultId, newTickLower, newTickUpper, nonce, msg.sender);
        emit Rebalanced(newTickLower, newTickUpper, totalLiquidity);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IUnlockCallback — V4 re-entrancy gate
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Called by PoolManager during poolManager.unlock().
    ///         Decodes the action and dispatches to the appropriate handler.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();

        (Action action, bytes memory params) = abi.decode(data, (Action, bytes));

        if (action == Action.AddLiquidity) {
            uint256 usdcAmount = abi.decode(params, (uint256));
            return _handleAddLiquidity(usdcAmount);
        }
        if (action == Action.RemoveLiquidity) {
            uint128 liquidityAmount = abi.decode(params, (uint128));
            return _handleRemoveLiquidity(liquidityAmount);
        }
        // Action.Rebalance
        (int24 newTickLower, int24 newTickUpper) = abi.decode(params, (int24, int24));
        return _handleRebalance(newTickLower, newTickUpper);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal — V4 unlock handlers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Add USDC as single-sided liquidity at the current tick range.
    ///      Computes liquidity from usdcAmount using LiquidityAmounts,
    ///      calls modifyLiquidity, then settles the owed tokens.
    function _handleAddLiquidity(uint256 usdcAmount) internal returns (bytes memory) {
        // getLiquidityForAmount0/1 only needs tick-boundary prices (not current sqrtPrice)
        uint160 sqrtPriceLower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtPriceUpper = TickMath.getSqrtPriceAtTick(tickUpper);

        bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == address(usdc);

        uint128 liquidity;
        if (usdcIsToken0) {
            liquidity = LiquidityAmounts.getLiquidityForAmount0(
                sqrtPriceLower, sqrtPriceUpper, usdcAmount
            );
        } else {
            liquidity = LiquidityAmounts.getLiquidityForAmount1(
                sqrtPriceLower, sqrtPriceUpper, usdcAmount
            );
        }

        if (liquidity == 0) return "";

        (BalanceDelta callerDelta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower:      tickLower,
                tickUpper:      tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt:           bytes32(0)
            }),
            ""
        );

        // Settle tokens we owe (negative delta = we owe that currency)
        // Take any excess (positive delta = pool owes us)
        _settleDelta(callerDelta);

        totalLiquidity += liquidity;
        emit LiquidityAdded(liquidity, usdcAmount);
        return abi.encode(liquidity);
    }

    /// @dev Remove exact liquidity from the current tick range.
    ///      Takes the returned tokens back to this contract.
    function _handleRemoveLiquidity(uint128 liquidityAmount) internal returns (bytes memory) {
        (BalanceDelta callerDelta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower:      tickLower,
                tickUpper:      tickUpper,
                liquidityDelta: -int256(uint256(liquidityAmount)),
                salt:           bytes32(0)
            }),
            ""
        );

        // Take tokens we're owed back to this contract
        _settleDelta(callerDelta);

        totalLiquidity -= liquidityAmount;
        emit LiquidityRemoved(liquidityAmount);
        return "";
    }

    /// @dev Rebalance: atomically remove all liquidity and re-add at new tick range.
    function _handleRebalance(
        int24 newTickLower,
        int24 newTickUpper
    ) internal returns (bytes memory) {
        // Step 1: Remove all existing liquidity
        if (totalLiquidity > 0) {
            (BalanceDelta removeDelta,) = poolManager.modifyLiquidity(
                poolKey,
                ModifyLiquidityParams({
                    tickLower:      tickLower,
                    tickUpper:      tickUpper,
                    liquidityDelta: -int256(uint256(totalLiquidity)),
                    salt:           bytes32(0)
                }),
                ""
            );
            _settleDelta(removeDelta);
            totalLiquidity = 0;
        }

        // Step 2: Update tick range
        tickLower = newTickLower;
        tickUpper = newTickUpper;

        // Step 3: Re-add all USDC at new range
        if (totalDeposits > 0) {
            uint160 sqrtPriceLower = TickMath.getSqrtPriceAtTick(newTickLower);
            uint160 sqrtPriceUpper = TickMath.getSqrtPriceAtTick(newTickUpper);

            bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == address(usdc);

            uint128 newLiquidity;
            if (usdcIsToken0) {
                newLiquidity = LiquidityAmounts.getLiquidityForAmount0(
                    sqrtPriceLower, sqrtPriceUpper, totalDeposits
                );
            } else {
                newLiquidity = LiquidityAmounts.getLiquidityForAmount1(
                    sqrtPriceLower, sqrtPriceUpper, totalDeposits
                );
            }

            if (newLiquidity > 0) {
                (BalanceDelta addDelta,) = poolManager.modifyLiquidity(
                    poolKey,
                    ModifyLiquidityParams({
                        tickLower:      newTickLower,
                        tickUpper:      newTickUpper,
                        liquidityDelta: int256(uint256(newLiquidity)),
                        salt:           bytes32(0)
                    }),
                    ""
                );
                _settleDelta(addDelta);
                totalLiquidity = newLiquidity;
            }
        }

        return "";
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal — V4 token settlement helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Settle a BalanceDelta from modifyLiquidity:
    ///      negative = we owe that currency → sync + transfer + settle
    ///      positive = pool owes us → take
    function _settleDelta(BalanceDelta delta) internal {
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();

        // currency0
        if (d0 < 0) {
            _pay(poolKey.currency0, uint256(uint128(-d0)));
        } else if (d0 > 0) {
            poolManager.take(poolKey.currency0, address(this), uint256(uint128(d0)));
        }

        // currency1
        if (d1 < 0) {
            _pay(poolKey.currency1, uint256(uint128(-d1)));
        } else if (d1 > 0) {
            poolManager.take(poolKey.currency1, address(this), uint256(uint128(d1)));
        }
    }

    /// @dev Transfer tokens into PoolManager and settle.
    ///      Pattern: sync → transfer → settle (ERC20 pull-then-settle).
    function _pay(Currency currency, uint256 amount) internal {
        poolManager.sync(currency);
        // Use SafeERC20 to handle non-standard ERC20 return values
        SafeERC20.safeTransfer(IERC20(Currency.unwrap(currency)), address(poolManager), amount);
        poolManager.settle();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal — pool initialization
    // ─────────────────────────────────────────────────────────────────────────

    function _initializePool(PoolKey calldata key, uint160 sqrtPriceX96) internal {
        if (poolInitialized) revert PoolAlreadyInitialized();
        poolKey         = key;
        poolInitialized = true;
        // initialize() is directly callable (does NOT require unlock)
        poolManager.initialize(key, sqrtPriceX96);
        emit PoolInitialized(keccak256(abi.encode(key)), sqrtPriceX96);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal — dispatch wrappers (call unlock → trigger callback)
    // ─────────────────────────────────────────────────────────────────────────

    function _addLiquidity(uint256 usdcAmount) internal {
        poolManager.unlock(
            abi.encode(Action.AddLiquidity, abi.encode(usdcAmount))
        );
    }

    function _removeLiquidity(uint128 liquidityAmount) internal {
        poolManager.unlock(
            abi.encode(Action.RemoveLiquidity, abi.encode(liquidityAmount))
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal — penalty + lock math
    // ─────────────────────────────────────────────────────────────────────────

    function _calculatePenalty(
        LPPosition storage pos,
        uint256 amount
    ) internal view returns (uint256) {
        if (pos.tier == LockTier.Flex) return 0;
        if (block.timestamp >= pos.lockedUntil) return 0;

        uint256 lockDuration = _lockDuration(pos.tier);
        uint256 elapsed      = block.timestamp - pos.depositedAt;
        uint256 pct          = (elapsed * 100) / lockDuration; // 0–100

        uint256 penaltyBps;
        if      (pct < 20)  penaltyBps = PENALTY_TIER_1_BPS;
        else if (pct < 50)  penaltyBps = PENALTY_TIER_2_BPS;
        else if (pct < 80)  penaltyBps = PENALTY_TIER_3_BPS;
        else                penaltyBps = 0;

        return (amount * penaltyBps) / BPS;
    }

    function _lockDuration(LockTier tier) internal pure returns (uint256) {
        if (tier == LockTier.Committed) return LOCK_COMMITTED;
        if (tier == LockTier.Aligned)   return LOCK_ALIGNED;
        if (tier == LockTier.Core)      return LOCK_CORE;
        return 0; // Flex
    }
}
