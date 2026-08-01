// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback}     from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}        from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams}          from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}            from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20}              from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}           from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}             from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard}     from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  MWRouter — Mintware internal swap router (Uniswap V4)
/// @notice Executes an exact-input single-pool swap against a Mintware V4 pool and
///         skims the protocol router fee to the treasury. This is the on-chain half
///         of the MW meta-router: the off-chain engine (`lib/web2/router`) decides
///         WHEN to route here (only when a Mintware pool beats LI.FI, best-execution);
///         this contract is HOW that internal swap settles.
///
/// @dev    Design: docs/developers/phase3-router-design.md §7.4, §8.
///
///         Value streams on one internal swap (both preserved here):
///           1. Router fee — this contract skims `routerFeeBps` of the swap OUTPUT
///              to `treasury` (protocol revenue; the internal-path equivalent of the
///              0.5% LI.FI referrer fee). Separate from the FeeVault buckets.
///           2. Hook capture — the swap routes through MWSocialHook, whose afterSwap
///              already takes MEV/positive-slippage to the FeeVault and returns a
///              positive hookDelta. So the output delta THIS router receives is
///              ALREADY net of the hook's capture; the router fee stacks on top.
///
///         Follows the V4 unlock → swap → settle pattern of TestSwapRouter, hardened
///         for production: exact-input floor (`amountOutMinimum`) enforced NET of both
///         the hook capture and the router fee, deadline, distinct recipient, and an
///         attribution `tag` for the rewards pipeline.
///
///         Native ETH is intentionally unsupported in v1 — Mintware pools are ERC20/
///         ERC20 (project token + USDC). A native path would need msg.value plumbing
///         and its own tests; it is a documented follow-up, not a silent gap.
contract MWRouter is IUnlockCallback, Ownable, ReentrancyGuard {
    using SafeERC20        for IERC20;
    using PoolIdLibrary    for PoolKey;

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public constant BPS = 10_000;

    /// @notice Hard cap on the router fee (1%). Enforced on set AND in the constructor,
    ///         mirroring the off-chain ROUTER_FEE_BPS_CAP. The fee can never exceed this.
    uint16 public constant ROUTER_FEE_BPS_CAP = 100;

    // ─────────────────────────────────────────────────────────────────────────
    // Immutable / state
    // ─────────────────────────────────────────────────────────────────────────

    IPoolManager public immutable poolManager;

    /// @notice Receives the router fee (protocol revenue). Also the on-chain proof of
    ///         fee payment the rewards verifier keys on (design §7.2).
    address public immutable treasury;

    /// @notice Router fee in bps of output. Owner-settable, capped at ROUTER_FEE_BPS_CAP.
    uint16 public routerFeeBps;

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct ExactInputSingleParams {
        PoolKey key;               // pool to route against (includes the MW hook)
        bool    zeroForOne;        // true = sell currency0 → buy currency1
        uint256 amountIn;          // exact input (pre-approved to this router by msg.sender)
        uint256 amountOutMinimum;  // floor on the user's NET output (after hook capture + router fee)
        address recipient;         // receives the net output
        uint256 deadline;          // unix seconds; tx reverts after this
        bytes   tag;               // attribution: abi.encode(campaignId, referrer, ...)
    }

    struct SwapCallbackData {
        PoolKey    key;
        SwapParams params;
        address    payer;
        address    recipient;
        uint256    amountOutMinimum;
        bool       zeroForOne;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Events / errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Emitted on every internal swap. Indexers + the rewards pipeline read
    ///         `tag` for campaign/referrer attribution; `fee` is the treasury cut.
    event MintwareRouterSwap(
        PoolId  indexed poolId,
        address indexed payer,
        address indexed recipient,
        address inputToken,
        address outputToken,
        uint256 amountIn,
        uint256 grossOut,   // output after hook capture, before router fee
        uint256 userOut,    // delivered to recipient (grossOut - fee)
        uint256 fee,        // router fee to treasury
        bytes   tag
    );
    event RouterFeeUpdated(uint16 bps);

    error OnlyPoolManager();
    error InvalidAddress();
    error FeeTooHigh();
    error Expired();
    error InvalidRecipient();
    error ZeroAmount();
    error NativeNotSupported();
    error NoOutput();
    error InsufficientOutput(uint256 got, uint256 minimum);

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(
        IPoolManager _poolManager,
        address _treasury,
        uint16 _routerFeeBps,
        address _owner
    ) Ownable(_owner) {
        if (_treasury == address(0)) revert InvalidAddress();
        if (_routerFeeBps > ROUTER_FEE_BPS_CAP) revert FeeTooHigh();
        poolManager  = _poolManager;
        treasury     = _treasury;
        routerFeeBps = _routerFeeBps;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Set the router fee (bps of output). Capped at ROUTER_FEE_BPS_CAP so it
    ///         can never be silently cranked. Governance-set; may differ per surface deploy.
    function setRouterFeeBps(uint16 bps) external onlyOwner {
        if (bps > ROUTER_FEE_BPS_CAP) revert FeeTooHigh();
        routerFeeBps = bps;
        emit RouterFeeUpdated(bps);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // External — swap
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Swap an exact input amount against a single Mintware V4 pool.
    /// @return amountOut Net output delivered to `recipient` (after hook capture + router fee).
    function swapExactInputSingle(ExactInputSingleParams calldata p)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (block.timestamp > p.deadline) revert Expired();
        if (p.recipient == address(0))    revert InvalidRecipient();
        if (p.amountIn == 0)              revert ZeroAmount();

        Currency inputCurrency  = p.zeroForOne ? p.key.currency0 : p.key.currency1;
        Currency outputCurrency = p.zeroForOne ? p.key.currency1 : p.key.currency0;

        // v1: ERC20/ERC20 only — reject native on either side (see contract docs).
        if (Currency.unwrap(inputCurrency) == address(0) || Currency.unwrap(outputCurrency) == address(0)) {
            revert NativeNotSupported();
        }

        // Pull exact input from the caller. For an exact-input swap the pool consumes
        // exactly `amountIn`, so nothing is left over to refund.
        IERC20(Currency.unwrap(inputCurrency)).safeTransferFrom(msg.sender, address(this), p.amountIn);

        SwapParams memory params = SwapParams({
            zeroForOne:        p.zeroForOne,
            amountSpecified:   -int256(p.amountIn),   // negative = exact input in V4
            sqrtPriceLimitX96: p.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });

        bytes memory result = poolManager.unlock(
            abi.encode(SwapCallbackData({
                key:              p.key,
                params:           params,
                payer:            msg.sender,
                recipient:        p.recipient,
                amountOutMinimum: p.amountOutMinimum,
                zeroForOne:       p.zeroForOne
            }))
        );

        (uint256 userOut, uint256 fee, uint256 grossOut) = abi.decode(result, (uint256, uint256, uint256));
        amountOut = userOut;

        emit MintwareRouterSwap(
            p.key.toId(),
            msg.sender,
            p.recipient,
            Currency.unwrap(inputCurrency),
            Currency.unwrap(outputCurrency),
            p.amountIn,
            grossOut,
            userOut,
            fee,
            p.tag
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IUnlockCallback — runs inside the PoolManager lock
    // ─────────────────────────────────────────────────────────────────────────

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();

        SwapCallbackData memory d = abi.decode(data, (SwapCallbackData));

        BalanceDelta delta = poolManager.swap(d.key, d.params, "");
        int128 amt0 = delta.amount0();
        int128 amt1 = delta.amount1();

        // Pay whichever side we owe (negative delta = we owe the PoolManager).
        if (amt0 < 0) _pay(d.key.currency0, uint256(uint128(-amt0)));
        if (amt1 < 0) _pay(d.key.currency1, uint256(uint128(-amt1)));

        // Output is the unspecified side (positive delta). It is ALREADY net of the
        // hook's afterSwap capture — the hook took its slice and returned a positive
        // hookDelta reducing what the PoolManager credits us here.
        Currency outputCurrency = d.zeroForOne ? d.key.currency1 : d.key.currency0;
        int128   outDelta       = d.zeroForOne ? amt1 : amt0;
        if (outDelta <= 0) revert NoOutput();
        uint256 grossOut = uint256(uint128(outDelta));

        // Router fee, skimmed from the output. Integer floor → dust favors the user.
        uint256 fee     = (grossOut * routerFeeBps) / BPS;
        uint256 userOut = grossOut - fee;

        // Best-execution floor: enforced NET of hook capture AND router fee. Reverting
        // here unwinds the whole swap (nothing settled), so a moved price fails safely.
        if (userOut < d.amountOutMinimum) revert InsufficientOutput(userOut, d.amountOutMinimum);

        // Settle output directly from the PoolManager — the router never holds the
        // output, so no funds can be stranded here.
        if (fee > 0) poolManager.take(outputCurrency, treasury, fee);
        poolManager.take(outputCurrency, d.recipient, userOut);

        return abi.encode(userOut, fee, grossOut);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Pay a currency we owe to the PoolManager via the sync → transfer → settle flow.
    ///      The router already holds the input pulled from the payer.
    function _pay(Currency currency, uint256 amount) internal {
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }
}
