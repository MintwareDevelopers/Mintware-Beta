// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback}       from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}          from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20}           from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626}         from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712}          from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA}           from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {MWGuardianPausable} from "../lib/MWGuardianPausable.sol";
import {VaultSurface, LockTier, VaultConfig} from "./VaultTypes.sol";

interface IFeeVaultNotifier {
    function notifyFeeReceipt(uint256 amount, string calldata source) external;
}

/// @title  MintwareBaseVault4626
/// @notice Abstract ERC-4626 base for the Phase-3 two-surface vault system.
///         Owns the shared machinery: principal-denominated shares, lock tiers,
///         async lock withdrawal + penalties, FeeVault wiring, and the Uniswap V4
///         unlock/settlement plumbing. Surfaces (DeFi / RWA) override the liquidity
///         hooks. See docs/developers/phase3-track0-foundation-design.md (D5–D9).
///
/// @dev    Share semantics (D5): a share is a claim on USDC *principal*.
///         totalAssets() returns tracked principal, NOT live LP NAV — yield flows
///         through the FeeVault epoch system, not share price.
///
///         Redemption (D6): async only. Standard withdraw()/redeem() revert and
///         maxWithdraw/maxRedeem == 0; use requestRedeem() → notice → executeRedeem().
abstract contract MintwareBaseVault4626 is
    ERC4626,
    MWGuardianPausable,
    ReentrancyGuard,
    IUnlockCallback,
    EIP712
{
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct LockInfo {
        uint256  depositedAt;
        uint256  lockedUntil;
        LockTier tier;
        bool     initialized;
    }

    struct WithdrawalRequest {
        uint256 shares;        // shares queued for redemption
        uint256 requestedAt;
        uint256 noticeExpiry;
        bool    executed;
    }

    /// @dev Dispatched inside unlockCallback.
    enum Action { Deploy, Remove, Rebalance, Collect }

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public constant NOTICE_PERIOD   = 7 days;
    uint256 public constant MIN_HOLD_PERIOD = 24 hours;
    uint256 public constant LOCK_COMMITTED  = 30 days;
    uint256 public constant LOCK_ALIGNED    = 90 days;
    uint256 public constant LOCK_CORE       = 180 days;

    uint256 public constant PENALTY_TIER_1_BPS = 200; // <20% elapsed → 2.0%
    uint256 public constant PENALTY_TIER_2_BPS = 100; // 20–50%      → 1.0%
    uint256 public constant PENALTY_TIER_3_BPS = 50;  // 50–80%      → 0.5%
    uint256 public constant BPS                = 10_000;

    bytes32 public constant RANGE_TYPEHASH = keccak256(
        "RangeProposal(bytes32 vaultId,int24 tickLower,int24 tickUpper,uint256 validUntil,uint256 nonce)"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Immutables / config
    // ─────────────────────────────────────────────────────────────────────────

    IPoolManager public immutable poolManager;
    /// @dev Not immutable: factory-deployed vaults construct with feeVault == address(0)
    ///      and wire it once via setFeeVault() (the FeeVault is deployed in the same tx,
    ///      so its address isn't knowable when the CREATE2 initcode is built).
    address      public feeVault;
    address      public immutable treasury;
    VaultSurface public immutable surface;
    address      public immutable provider;
    uint256      public immutable minDeposit;
    uint256      public immutable entryFeeBps;
    uint256      public immutable exitFeeBps;

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    mapping(address => LockInfo)          public locks;
    mapping(address => WithdrawalRequest) public withdrawalRequests;

    /// @notice Tracked USDC principal — backs totalAssets() (D5).
    uint256 public totalPrincipal;

    /// @notice V4 pool state.
    PoolKey public poolKey;
    bool    public poolInitialized;
    int24   public tickLower = -887220;
    int24   public tickUpper =  887220;
    uint128 public totalLiquidity;

    /// @notice Oracle signer for signed rebalance proposals.
    address public oracleSigner;
    mapping(bytes32 => mapping(uint256 => bool)) public usedNonces;

    /// @dev Lock tier for the in-flight deposit; consumed by _deposit().
    LockTier private _pendingTier;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event LockRecorded(address indexed owner, LockTier tier, uint256 lockedUntil);
    event WithdrawalRequested(address indexed owner, uint256 shares, uint256 noticeExpiry);
    event WithdrawalExecuted(address indexed owner, uint256 assetsOut, uint256 penalty);
    event PoolInitialized(bytes32 indexed poolId, uint160 sqrtPriceX96);
    event OracleSignerSet(address indexed signer);
    event FeeVaultSet(address indexed feeVault);
    event Rebalanced(int24 tickLower, int24 tickUpper, uint128 liquidity);
    event RebalancedWithProposal(bytes32 indexed vaultId, int24 tickLower, int24 tickUpper, uint256 nonce, address submitter);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error BelowMinDeposit();
    error SynchronousRedemptionDisabled();
    error MinHoldNotMet();
    error InsufficientShares();
    error NoWithdrawalRequest();
    error NoticeNotExpired();
    error WithdrawalAlreadyExecuted();
    error LockTierChangeNotAllowed();
    error PoolNotInitialized();
    error PoolAlreadyInitialized();
    error OnlyPoolManager();
    error OracleSignerNotSet();
    error ProposalExpired();
    error NonceAlreadyUsed();
    error InvalidOracleSignature();
    error FeeVaultAlreadySet();
    error ZeroFeeVault();

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(VaultConfig memory cfg, address _poolManager, address _feeVault)
        ERC20(cfg.name, cfg.symbol)
        ERC4626(IERC20(cfg.underlyingToken))
        MWGuardianPausable(msg.sender)
        EIP712("MintwareVault", "1")
    {
        poolManager = IPoolManager(_poolManager);
        feeVault    = _feeVault;
        treasury    = cfg.treasury;
        surface     = cfg.surface;
        provider    = cfg.provider;
        minDeposit  = cfg.minDeposit;
        entryFeeBps = cfg.entryFeeBps;
        exitFeeBps  = cfg.exitFeeBps;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ERC-4626 accounting — principal-denominated (D5)
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc ERC4626
    function totalAssets() public view override returns (uint256) {
        return totalPrincipal;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Deposit — with lock tier
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Standard 4626 deposit; defaults to the Flex (no-lock) tier.
    ///         `assets` is the gross input; a `entryFeeBps` cut goes to treasury and
    ///         shares are minted for the net principal.
    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        _pendingTier = LockTier.Flex;
        return _enterVault(assets, receiver);
    }

    /// @notice Deposit with an explicit lock tier (higher tier → higher FeeVault multiplier).
    function depositWithLock(uint256 assets, address receiver, LockTier tier)
        public
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        _pendingTier = tier;
        return _enterVault(assets, receiver);
    }

    /// @notice Standard 4626 mint. `shares` are minted for a net principal; the entry
    ///         fee is charged on top, so the caller pays `net + fee`.
    function mint(uint256 shares, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 grossAssets)
    {
        _pendingTier = LockTier.Flex;
        uint256 net = previewMint(shares);
        if (net < minDeposit) revert BelowMinDeposit();
        uint256 fee = entryFeeBps == 0 ? 0 : (net * entryFeeBps) / (BPS - entryFeeBps);
        grossAssets = net + fee;
        _pullAndEnter(receiver, grossAssets, fee, net, shares);
    }

    /// @dev Deposit path: `assets` gross → entry fee to treasury → shares for net.
    function _enterVault(uint256 assets, address receiver) private returns (uint256 shares) {
        if (assets < minDeposit) revert BelowMinDeposit();
        uint256 fee = (assets * entryFeeBps) / BPS;
        uint256 net = assets - fee;
        shares = previewDeposit(net);
        _pullAndEnter(receiver, assets, fee, net, shares);
    }

    /// @dev Pull gross assets, remit entry fee to treasury, mint shares for net,
    ///      record lock, and deploy the net principal as liquidity.
    function _pullAndEnter(
        address receiver,
        uint256 grossAssets,
        uint256 fee,
        uint256 net,
        uint256 shares
    ) private {
        IERC20(asset()).safeTransferFrom(_msgSender(), address(this), grossAssets);
        if (fee > 0) IERC20(asset()).safeTransfer(treasury, fee);

        _mint(receiver, shares);
        totalPrincipal += net;
        _recordLock(receiver, _pendingTier);
        _pendingTier = LockTier.Flex;

        if (poolInitialized) {
            poolManager.unlock(abi.encode(Action.Deploy, abi.encode(net)));
        }
        _afterEnter(receiver, net, shares);
        emit Deposit(_msgSender(), receiver, net, shares);
    }

    /// @dev Hook after a deposit mints shares. RWA vaults mint vRWA 1:1 here. Default no-op.
    function _afterEnter(address receiver, uint256 netAssets, uint256 shares) internal virtual {}

    function _recordLock(address owner, LockTier tier) internal {
        LockInfo storage info = locks[owner];
        uint256 lockedUntil = block.timestamp + _lockDuration(tier);

        if (info.initialized && balanceOf(owner) > 0) {
            if (info.tier != tier) revert LockTierChangeNotAllowed();
            if (info.lockedUntil > lockedUntil) lockedUntil = info.lockedUntil;
            info.lockedUntil = lockedUntil;
            info.depositedAt = block.timestamp;
        } else {
            info.tier        = tier;
            info.depositedAt = block.timestamp;
            info.lockedUntil = lockedUntil;
            info.initialized = true;
        }
        emit LockRecorded(owner, tier, lockedUntil);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Redemption — async only (D6)
    // ─────────────────────────────────────────────────────────────────────────

    function maxWithdraw(address) public pure override returns (uint256) { return 0; }
    function maxRedeem(address) public pure override returns (uint256) { return 0; }

    function withdraw(uint256, address, address) public pure override returns (uint256) {
        revert SynchronousRedemptionDisabled();
    }

    function redeem(uint256, address, address) public pure override returns (uint256) {
        revert SynchronousRedemptionDisabled();
    }

    /// @notice Step 1: queue a share redemption — starts the notice period.
    function requestRedeem(uint256 shares) public virtual {
        if (block.timestamp < locks[msg.sender].depositedAt + MIN_HOLD_PERIOD) revert MinHoldNotMet();
        if (shares == 0 || shares > balanceOf(msg.sender)) revert InsufficientShares();

        uint256 expiry = block.timestamp + _noticePeriod();
        withdrawalRequests[msg.sender] = WithdrawalRequest({
            shares:       shares,
            requestedAt:  block.timestamp,
            noticeExpiry: expiry,
            executed:     false
        });
        emit WithdrawalRequested(msg.sender, shares, expiry);
    }

    /// @notice Step 2: execute the queued redemption after the notice period.
    /// @dev    Gated by `whenNotPaused`: an emergency pause freezes the money-out path
    ///         to stop an active drain. `requestRedeem` stays open so the notice clock
    ///         keeps running for honest users while an incident is triaged.
    function executeRedeem() external virtual nonReentrant whenNotPaused returns (uint256) {
        return _executeRedeemFor(msg.sender);
    }

    /// @dev Settle `owner`'s queued redemption. Callable by the holder (DeFi executeRedeem)
    ///      or by the issuer after KYC (RWA confirmSettlement). Callers add nonReentrant.
    function _executeRedeemFor(address owner) internal returns (uint256 assetsOut) {
        WithdrawalRequest storage req = withdrawalRequests[owner];
        if (req.shares == 0)                    revert NoWithdrawalRequest();
        if (req.executed)                       revert WithdrawalAlreadyExecuted();
        if (block.timestamp < req.noticeExpiry) revert NoticeNotExpired();

        uint256 shares = req.shares;
        uint256 assets = convertToAssets(shares);

        // Proportional liquidity to unwind (pre-state-change principal).
        uint128 liqToRemove = 0;
        if (poolInitialized && totalLiquidity > 0 && totalPrincipal > 0) {
            liqToRemove = uint128(uint256(totalLiquidity) * assets / totalPrincipal);
        }

        uint256 penalty = _calculatePenalty(owner, assets);
        uint256 exitFee = (assets * exitFeeBps) / BPS;

        // Effects
        req.executed    = true;
        totalPrincipal -= assets;
        _burn(owner, shares);

        // Interactions — unwind liquidity back to this vault
        if (liqToRemove > 0) {
            poolManager.unlock(abi.encode(Action.Remove, abi.encode(liqToRemove)));
        }

        // Route penalty to FeeVault (redistributed to remaining LPs)
        if (penalty > 0) {
            IERC20(asset()).safeTransfer(feeVault, penalty);
            IFeeVaultNotifier(feeVault).notifyFeeReceipt(penalty, "penalty");
        }

        // Route exit fee to treasury
        if (exitFee > 0) {
            IERC20(asset()).safeTransfer(treasury, exitFee);
        }

        assetsOut = assets - penalty - exitFee;

        // V4 rounding can leave payout 1 wei over balance — cap it.
        uint256 available = IERC20(asset()).balanceOf(address(this));
        if (assetsOut > available) assetsOut = available;

        IERC20(asset()).safeTransfer(owner, assetsOut);
        emit WithdrawalExecuted(owner, assetsOut, penalty);
    }

    /// @dev Notice period — overridable so RWA can use its 30-day settlement window.
    function _noticePeriod() internal view virtual returns (uint256) {
        return NOTICE_PERIOD;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Rebalancing
    // ─────────────────────────────────────────────────────────────────────────

    function setOracleSigner(address signer) external onlyOwner {
        oracleSigner = signer;
        emit OracleSignerSet(signer);
    }

    /// @notice One-time wiring of the FeeVault for factory-deployed vaults.
    function setFeeVault(address _feeVault) external onlyOwner {
        if (feeVault != address(0)) revert FeeVaultAlreadySet();
        if (_feeVault == address(0)) revert ZeroFeeVault();
        feeVault = _feeVault;
        emit FeeVaultSet(_feeVault);
    }

    /// @notice Owner-initiated rebalance to a new tick range.
    function rebalance(int24 newTickLower, int24 newTickUpper) external onlyOwner nonReentrant whenNotPaused {
        if (!poolInitialized) revert PoolNotInitialized();
        poolManager.unlock(abi.encode(Action.Rebalance, abi.encode(newTickLower, newTickUpper)));
        emit Rebalanced(newTickLower, newTickUpper, totalLiquidity);
    }

    /// @notice Permissionless rebalance via an oracle-signed RangeProposal.
    function rebalanceWithProposal(
        bytes32 vaultId,
        int24   newTickLower,
        int24   newTickUpper,
        uint256 validUntil,
        uint256 nonce,
        bytes calldata oracleSignature
    ) external nonReentrant whenNotPaused {
        if (!poolInitialized)             revert PoolNotInitialized();
        if (oracleSigner == address(0))   revert OracleSignerNotSet();
        if (block.timestamp > validUntil) revert ProposalExpired();
        if (usedNonces[vaultId][nonce])   revert NonceAlreadyUsed();

        bytes32 structHash = keccak256(
            abi.encode(RANGE_TYPEHASH, vaultId, newTickLower, newTickUpper, validUntil, nonce)
        );
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), oracleSignature);
        if (signer != oracleSigner) revert InvalidOracleSignature();

        usedNonces[vaultId][nonce] = true;
        poolManager.unlock(abi.encode(Action.Rebalance, abi.encode(newTickLower, newTickUpper)));
        emit RebalancedWithProposal(vaultId, newTickLower, newTickUpper, nonce, msg.sender);
        emit Rebalanced(newTickLower, newTickUpper, totalLiquidity);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IUnlockCallback — dispatch to surface-specific liquidity hooks
    // ─────────────────────────────────────────────────────────────────────────

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (Action action, bytes memory params) = abi.decode(data, (Action, bytes));

        if (action == Action.Deploy) {
            uint256 assets = abi.decode(params, (uint256));
            return _deployLiquidity(assets);
        }
        if (action == Action.Remove) {
            uint128 liquidity = abi.decode(params, (uint128));
            return _removeLiquidity(liquidity);
        }
        if (action == Action.Collect) {
            return _collectFees();
        }
        (int24 lo, int24 hi) = abi.decode(params, (int24, int24));
        return _rebalanceLiquidity(lo, hi);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Surface hooks (D7) — implemented by DeFi / RWA subclasses
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Deploy `assets` of USDC into the pool. Called inside the V4 unlock.
    function _deployLiquidity(uint256 assets) internal virtual returns (bytes memory);

    /// @dev Remove `liquidity` from the pool, returning tokens to this vault.
    function _removeLiquidity(uint128 liquidity) internal virtual returns (bytes memory);

    /// @dev Rebalance the position to a new tick range. Called inside the V4 unlock.
    function _rebalanceLiquidity(int24 newTickLower, int24 newTickUpper)
        internal
        virtual
        returns (bytes memory);

    /// @dev Realize accrued swap fees on the position (liquidityDelta 0). Called inside
    ///      the V4 unlock. Returns abi.encode(usdcFees, projFees, projToken). Default no-op.
    function _collectFees() internal virtual returns (bytes memory) {
        return abi.encode(uint256(0), uint256(0), address(0));
    }

    /// @dev Dynamic swap fee for this vault's pool (bps). Default 0 = static.
    function _calculateDynamicFee() internal view virtual returns (uint24) {
        return 0;
    }

    /// @dev Idle-capital rebalance hook. Default no-op (Track A implements for DeFi).
    function _rebalanceIdleCapital() internal virtual {}

    // ─────────────────────────────────────────────────────────────────────────
    // Internal — V4 settlement helpers (shared plumbing)
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Settle a modifyLiquidity delta: negative = we owe, positive = pool owes us.
    function _settleDelta(BalanceDelta delta) internal {
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0)      _pay(poolKey.currency0, uint256(uint128(-d0)));
        else if (d0 > 0) poolManager.take(poolKey.currency0, address(this), uint256(uint128(d0)));
        if (d1 < 0)      _pay(poolKey.currency1, uint256(uint128(-d1)));
        else if (d1 > 0) poolManager.take(poolKey.currency1, address(this), uint256(uint128(d1)));
    }

    /// @dev sync → transfer → settle (ERC20 pull-then-settle).
    function _pay(Currency currency, uint256 amount) internal {
        poolManager.sync(currency);
        SafeERC20.safeTransfer(IERC20(Currency.unwrap(currency)), address(poolManager), amount);
        poolManager.settle();
    }

    /// @dev Initialize this vault's V4 pool (called once by a surface).
    function _initializePool(PoolKey memory key, uint160 sqrtPriceX96) internal {
        if (poolInitialized) revert PoolAlreadyInitialized();
        poolKey         = key;
        poolInitialized = true;
        poolManager.initialize(key, sqrtPriceX96);
        emit PoolInitialized(PoolId.unwrap(key.toId()), sqrtPriceX96);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal — lock / penalty math
    // ─────────────────────────────────────────────────────────────────────────

    function _calculatePenalty(address owner, uint256 assets) internal view returns (uint256) {
        LockInfo storage info = locks[owner];
        if (info.tier == LockTier.Flex)          return 0;
        if (block.timestamp >= info.lockedUntil) return 0;

        uint256 lockDuration = _lockDuration(info.tier);
        uint256 elapsed      = block.timestamp - info.depositedAt;
        uint256 pct          = lockDuration == 0 ? 100 : (elapsed * 100) / lockDuration;

        uint256 penaltyBps;
        if      (pct < 20) penaltyBps = PENALTY_TIER_1_BPS;
        else if (pct < 50) penaltyBps = PENALTY_TIER_2_BPS;
        else if (pct < 80) penaltyBps = PENALTY_TIER_3_BPS;
        else               penaltyBps = 0;

        return (assets * penaltyBps) / BPS;
    }

    function _lockDuration(LockTier tier) internal pure returns (uint256) {
        if (tier == LockTier.Committed) return LOCK_COMMITTED;
        if (tier == LockTier.Aligned)   return LOCK_ALIGNED;
        if (tier == LockTier.Core)      return LOCK_CORE;
        return 0; // Flex
    }
}
