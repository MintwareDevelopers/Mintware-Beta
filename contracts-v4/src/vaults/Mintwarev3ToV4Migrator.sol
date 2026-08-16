// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}     from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback}  from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}          from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}         from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}     from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams}       from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IHooks}           from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath}         from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {LockTier} from "./VaultTypes.sol";

/// @dev Minimal view of a Uniswap-v3 NonfungiblePositionManager the migrator drives (decrease → collect,
///      per caveat 2 of the spec — decrease BEFORE collect). `safeTransferFrom` is the ERC-721 custody pull.
interface INonfungiblePositionManagerLike {
    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }
    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1);

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }
    function collect(CollectParams calldata params) external returns (uint256 amount0, uint256 amount1);

    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

/// @dev The pair-vault deposit seam the migrator mints through (added alongside this router). `depositFor`
///      credits the shares/lock/dust to `recipient` while THIS router pays the tokens.
interface IPairVaultDepositFor {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function depositFor(
        address recipient,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 minShares,
        LockTier tier
    ) external returns (uint256 sharesMinted);
}

/// @title  Mintwarev3ToV4Migrator
/// @notice One-tx migration of a dormant Uniswap-v3 LP position into a Mintware v4 ULV pair vault: pull the
///         v3 NFT, unwind it (decrease → collect), rebalance the (usually single-sided) proceeds toward the
///         vault's ratio with a MIN-OUT-BOUNDED swap, then `depositFor` the ULV shares straight to the user.
///         Fixes every issue flagged in `docs/developers/v3-to-v4-migration-spec.md`:
///           (1) CUSTODY — pulls the NFT via `safeTransferFrom` (needs the user's approval), never assumes it;
///           (2) ORDERING — `decreaseLiquidity` BEFORE `collect` (the brief had them reversed);
///           (3) SLIPPAGE — `amount{0,1}MinUnwind` on the unwind AND `minSwapOut` on the rebalance swap;
///           (4) REBALANCE — the swap sizing is computed OFF-CHAIN (the caller knows the vault's target
///               ratio + a fair price) and passed in; the router only ENFORCES the min-out, exactly like the
///               ETH-settlement swap takes the relayer's `minUsdcOut`. Keeps range math off-chain (fragile
///               on-chain) and the guard on-chain (where it must be);
///           (5) DUST — anything the vault doesn't consume is swept back to the user;
///           (6) no unsubstantiated gas claim — the v3 unwind is a normal multicall, only the rebalance leg
///               runs inside v4's `unlock`;
///           (7) mints via the new additive `depositFor` (shares are a non-transferable internal mapping, so
///               crediting the recipient at mint is the only way to hand them over).
///
/// @dev    The rebalance swaps on a CONFIGURED v4 pool for the pair (immutable `key`) — the min-out bound is
///         the slippage/MEV guard (a sandwich that moves spot just makes the swap revert on `minSwapOut`,
///         never settle at a bad price). Off-by-default safety: a zero `swapAmountIn` skips the swap entirely
///         (already-balanced or the caller chose not to rebalance).
contract Mintwarev3ToV4Migrator is IUnlockCallback, IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    INonfungiblePositionManagerLike public immutable npm;
    IPoolManager                    public immutable poolManager;
    IPairVaultDepositFor            public immutable vault;
    IERC20                          public immutable token0; // == vault.token0()
    IERC20                          public immutable token1; // == vault.token1()

    // Rebalance swap pool (the pair's v4 pool — may be the vault's own or a deeper external one).
    Currency private immutable _c0;
    Currency private immutable _c1;
    uint24   private immutable _fee;
    int24    private immutable _tickSpacing;
    IHooks   private immutable _hooks;
    bool     public  immutable token0IsCurrency0; // ordering of vault.token0 in the swap pool

    /// @dev Transient rebalance-swap intent, set → unlock → cleared inside `migrate`.
    struct SwapReq { bool active; bool sellToken0; uint256 amountIn; uint256 minOut; uint256 out; }
    SwapReq private _swap;

    struct MigrateParams {
        uint256 tokenId;          // the v3 LP NFT (must be approved to this router)
        address recipient;        // who receives the ULV shares + dust (the user)
        // unwind slippage floors (straight LP removal — no swap):
        uint256 amount0MinUnwind;
        uint256 amount1MinUnwind;
        // rebalance swap (sized off-chain to the vault's target ratio; 0 amountIn = skip):
        bool    sellToken0;       // true → swap token0 → token1; false → token1 → token0
        uint256 swapAmountIn;
        uint256 minSwapOut;       // slippage floor on the rebalance output
        // deposit:
        uint256 minShares;        // slippage floor on ULV shares minted
        LockTier tier;
        uint256 deadline;         // for the v3 decrease/collect
    }

    event Migrated(
        uint256 indexed tokenId,
        address indexed recipient,
        uint256 collected0,
        uint256 collected1,
        uint256 swapOut,
        uint256 sharesMinted
    );

    error ZeroAddress();
    error PoolMismatch();
    error NoLiquidity();
    error TokenMismatch();
    error OnlyPoolManager();
    error SlippageExceeded(uint256 out, uint256 minOut);

    constructor(
        INonfungiblePositionManagerLike npm_,
        IPoolManager poolManager_,
        IPairVaultDepositFor vault_,
        PoolKey memory swapKey
    ) {
        if (address(npm_) == address(0) || address(poolManager_) == address(0) || address(vault_) == address(0)) {
            revert ZeroAddress();
        }
        address t0 = vault_.token0();
        address t1 = vault_.token1();
        // The swap pool must be exactly the vault's {token0, token1} pair (either ordering).
        address c0 = Currency.unwrap(swapKey.currency0);
        address c1 = Currency.unwrap(swapKey.currency1);
        bool ok = (c0 == t0 && c1 == t1) || (c0 == t1 && c1 == t0);
        if (!ok) revert PoolMismatch();

        npm         = npm_;
        poolManager = poolManager_;
        vault       = vault_;
        token0      = IERC20(t0);
        token1      = IERC20(t1);

        _c0          = swapKey.currency0;
        _c1          = swapKey.currency1;
        _fee         = swapKey.fee;
        _tickSpacing = swapKey.tickSpacing;
        _hooks       = swapKey.hooks;
        token0IsCurrency0 = (c0 == t0);
    }

    /// @notice Accept ERC-721 custody. We only ever pull the specific NFT inside `migrate`, so this simply
    ///         returns the magic value; migration is NOT auto-triggered from here (that path needs params).
    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Migrate `p.tokenId` (approved to this router) into the ULV, minting shares to `p.recipient`.
    function migrate(MigrateParams calldata p)
        external
        nonReentrant
        returns (uint256 sharesMinted, uint256 swapOut)
    {
        if (p.recipient == address(0)) revert ZeroAddress();

        // (1) CUSTODY: pull the NFT (requires the user approved this router on the NPM).
        npm.safeTransferFrom(msg.sender, address(this), p.tokenId);

        // Read the position; it must be the vault's exact pair, with live liquidity.
        (, , address pt0, address pt1, , , , uint128 liquidity, , , , ) = npm.positions(p.tokenId);
        if (pt0 != address(token0) || pt1 != address(token1)) revert TokenMismatch();
        if (liquidity == 0) revert NoLiquidity();

        // (2) ORDERING: decrease ALL liquidity FIRST, then collect principal + fees to this router.
        npm.decreaseLiquidity(
            INonfungiblePositionManagerLike.DecreaseLiquidityParams({
                tokenId: p.tokenId,
                liquidity: liquidity,
                amount0Min: p.amount0MinUnwind, // (3) unwind slippage floor
                amount1Min: p.amount1MinUnwind,
                deadline: p.deadline
            })
        );
        (uint256 collected0, uint256 collected1) = npm.collect(
            INonfungiblePositionManagerLike.CollectParams({
                tokenId: p.tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        // (4) REBALANCE: off-chain-sized, min-out-bounded swap toward the vault's ratio (skip if 0).
        swapOut = 0;
        if (p.swapAmountIn > 0) {
            swapOut = _rebalance(p.sellToken0, p.swapAmountIn, p.minSwapOut);
        }

        // (7) MINT: deposit everything the router now holds; the vault pulls both sides and mints shares +
        //     returns dust to the recipient.
        uint256 bal0 = token0.balanceOf(address(this));
        uint256 bal1 = token1.balanceOf(address(this));
        token0.forceApprove(address(vault), bal0);
        token1.forceApprove(address(vault), bal1);
        sharesMinted = vault.depositFor(p.recipient, bal0, bal1, p.minShares, p.tier);

        // clear any dangling allowance (defense-in-depth) — the vault pulls exactly `bal`, but be safe.
        token0.forceApprove(address(vault), 0);
        token1.forceApprove(address(vault), 0);

        // (5) DUST: sweep anything the vault didn't consume back to the user (belt-and-suspenders — the
        //     vault already returns its own dust to `recipient`, this catches any router residue).
        _sweep(token0, p.recipient);
        _sweep(token1, p.recipient);

        // Return the now-emptied NFT to the user.
        npm.safeTransferFrom(address(this), p.recipient, p.tokenId);

        emit Migrated(p.tokenId, p.recipient, collected0, collected1, swapOut, sharesMinted);
    }

    // ── rebalance swap (v4 unlock) ─────────────────────────────────────────────────

    function _rebalance(bool sellToken0, uint256 amountIn, uint256 minOut) private returns (uint256 out) {
        _swap = SwapReq({active: true, sellToken0: sellToken0, amountIn: amountIn, minOut: minOut, out: 0});
        poolManager.unlock("");
        out = _swap.out;
        _swap = SwapReq({active: false, sellToken0: false, amountIn: 0, minOut: 0, out: 0});
        if (out < minOut) revert SlippageExceeded(out, minOut); // (3) hard min-out guard
    }

    function unlockCallback(bytes calldata) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        SwapReq memory s = _swap;
        if (!s.active) return "";

        // Selling token0 → zeroForOne iff token0 is currency0 in the swap pool.
        bool zeroForOne = s.sellToken0 == token0IsCurrency0;
        BalanceDelta delta = poolManager.swap(
            _key(),
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(s.amountIn), // exact input
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        // Settle: pay the input side, take the output side; record the output amount.
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0) _pay(_c0, uint256(uint128(-d0)));
        else if (d0 > 0) poolManager.take(_c0, address(this), uint256(uint128(d0)));
        if (d1 < 0) _pay(_c1, uint256(uint128(-d1)));
        else if (d1 > 0) poolManager.take(_c1, address(this), uint256(uint128(d1)));

        // Output currency = the non-sold side.
        uint256 outAmt = zeroForOne
            ? (d1 > 0 ? uint256(uint128(d1)) : 0)
            : (d0 > 0 ? uint256(uint128(d0)) : 0);
        _swap.out = outAmt;
        return "";
    }

    function _pay(Currency currency, uint256 amount) private {
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    function _sweep(IERC20 token, address to) private {
        uint256 bal = token.balanceOf(address(this));
        if (bal > 0) token.safeTransfer(to, bal);
    }

    function _key() private view returns (PoolKey memory) {
        return PoolKey({currency0: _c0, currency1: _c1, fee: _fee, tickSpacing: _tickSpacing, hooks: _hooks});
    }
}
