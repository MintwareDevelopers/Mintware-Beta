// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {MockERC4626} from "../mocks/MockERC4626.sol";

contract EconToken is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/// @title  EconBase -- shared rig for the round-3 economic simulations (audit scope s8 Q1-Q5, invariant 15)
/// @notice Same shape as MintwareLpGatewayAuditRound2Fork: real Uniswap V4 PoolManager / PositionManager on
///         Robinhood testnet, 18dp mock tokens, pool initialised at price 1.0, external third-party depth
///         in the gateway's +-22980 range via PoolModifyLiquidityTest. Every swap here is a LIMIT swap
///         (`_swapToPairedPrice`): the price is pushed to an exact target so simulations line up with the
///         closed forms in scripts/audit3/econ_models.py. Self-skips without LP_FORK_RPC_URL.
abstract contract EconBase is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address constant RH_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant RH_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint160 constant SQRT_1 = 79228162514264337593543950336;
    uint256 constant Q96 = 0x1000000000000000000000000;
    int24 constant TL = -22980;
    int24 constant TU = 22980;
    uint16 constant BAND = 500;
    uint256 constant ONE = 1e18;

    // sqrt factors (1e18-scaled) of the paired-price moves used in the simulations
    uint256 constant SQ_DOWN_1STEP = 951_000_000_000_000_000; // sqrt(1/1.1080) : one follower step down (4.9%)
    uint256 constant SQ_UP_2STEP = 1_100_000_000_000_000_000; // ~1.05*1.0476 : two follower steps up (strictly inside 2 bands)
    uint256 constant SQ_HALF = 707_106_781_186_547_524; // sqrt(0.5)   : price /2
    uint256 constant SQ_QUARTER = 500_000_000_000_000_000; // sqrt(0.25)  : price /4
    uint256 constant SQ_DOUBLE = 1_414_213_562_373_095_049; // sqrt(2)
    uint256 constant SQ_0_3 = 547_722_557_505_166_113; // sqrt(0.3)   : principal-floor price
    uint256 constant SQ_PA = 316_845_000_000_000_000; // sqrt(Pa) at tick -22980 (approx; edge tests use TickMath)

    bool internal live;
    uint256 internal blk;
    IPoolManager internal poolManager;
    IPositionManager internal posm;
    PoolSwapTest internal swapper;
    PoolModifyLiquidityTest internal lpRouter;

    EconToken internal quote;
    EconToken internal paired;
    PoolKey internal key;
    bool internal q0;
    MockERC4626 internal src;
    MintwareERC4626YieldAdapter internal adapter;
    MintwareLpGatewayStaging internal staging;
    MintwareLpGatewayPositionManager internal pm;

    address internal RECIP = address(0xFEE5);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal mallory = address(0x3A110);
    address internal whale = address(0x3A1E);
    address internal arber = address(0xA5B);

    function setUp() public virtual {
        string memory rpc = vm.envOr("LP_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;
        blk = block.number;
        poolManager = IPoolManager(RH_POOL_MANAGER);
        posm = IPositionManager(RH_POSITION_MANAGER);
        swapper = new PoolSwapTest(poolManager);
        lpRouter = new PoolModifyLiquidityTest(poolManager);
        _buildRig();
    }

    function _buildRig() internal {
        quote = new EconToken("Quote", "Q");
        paired = new EconToken("Paired", "P");
        (address c0, address c1) = address(quote) < address(paired) ? (address(quote), address(paired)) : (address(paired), address(quote));
        q0 = c0 == address(quote);
        key = PoolKey({currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
        poolManager.initialize(key, SQRT_1);

        src = new MockERC4626(IERC20(address(quote)));
        adapter = new MintwareERC4626YieldAdapter(address(quote), address(src), address(0), address(this));
        staging = new MintwareLpGatewayStaging(IERC20(address(quote)), adapter);
        adapter.setVault(address(staging));
        pm = new MintwareLpGatewayPositionManager(
            poolManager, posm, IPermit2Minimal(PERMIT2), key, IERC20(address(quote)), TL, TU, staging, address(this), RECIP, BAND
        );
        staging.setController(address(pm));

        _fund(address(this), 100_000_000e18, 100_000_000e18);
        address[5] memory us = [alice, bob, mallory, whale, arber];
        for (uint256 i = 0; i < 5; i++) _fund(us[i], 100_000_000e18, 100_000_000e18);
    }

    function _fund(address who, uint256 q, uint256 p) internal {
        quote.mint(who, q);
        paired.mint(who, p);
        vm.startPrank(who);
        quote.approve(address(pm), type(uint256).max);
        paired.approve(address(pm), type(uint256).max);
        quote.approve(address(swapper), type(uint256).max);
        paired.approve(address(swapper), type(uint256).max);
        quote.approve(address(lpRouter), type(uint256).max);
        paired.approve(address(lpRouter), type(uint256).max);
        vm.stopPrank();
    }

    /// Third-party in-range depth. At price 1.0 the virtual quote reserve of L in this range is ~L
    /// (policy s7: R = L*sqrtP), so `liq` IS the external R in quote units.
    function _addExternalLiquidity(uint256 liq) internal {
        lpRouter.modifyLiquidity(key, ModifyLiquidityParams({tickLower: TL, tickUpper: TU, liquidityDelta: int256(liq), salt: 0}), "");
    }

    function _roll(uint256 n) internal {
        blk += n;
        vm.roll(blk);
    }

    // -- pool reads --------------------------------------------------------------------------

    function _spot() internal view returns (uint160 s) {
        (s,,,) = poolManager.getSlot0(key.toId());
    }

    /// _refSqrtPrice is internal; slot 7 (forge inspect storage-layout; also probed by the red-team suite).
    function _ref() internal view returns (uint160) {
        return uint160(uint256(vm.load(address(pm), bytes32(uint256(7)))));
    }

    function _devBps() internal view returns (uint256) {
        uint160 s = _spot();
        uint160 r = _ref();
        if (r == 0) return 0;
        uint256 d = s > r ? s - r : r - s;
        return (d * 10_000) / r;
    }

    function _gwLiq() internal view returns (uint128) {
        return pm.tokenId() == 0 ? 0 : posm.getPositionLiquidity(pm.tokenId());
    }

    function _poolLiq() internal view returns (uint128) {
        return poolManager.getLiquidity(key.toId());
    }

    /// paired -> quote at sqrtP (mirrors the PM's _pairedToQuote).
    function _p2q(uint256 amt, uint160 s) internal view returns (uint256) {
        if (amt == 0) return 0;
        if (q0) return FullMath.mulDiv(FullMath.mulDiv(amt, Q96, s), Q96, s);
        return FullMath.mulDiv(FullMath.mulDiv(amt, s, Q96), s, Q96);
    }

    function _wealth(address who, uint160 s) internal view returns (uint256) {
        return quote.balanceOf(who) + _p2q(paired.balanceOf(who), s);
    }

    /// sqrtPriceX96 at which the PAIRED price (in quote) equals `sqFactor^2` times the initial 1.0.
    function _sqrtForPairedSqrt(uint256 sqFactor) internal view returns (uint160) {
        // quote = currency0  -> paired price = 1/P -> sqrtP = SQRT_1 / f ; quote = currency1 -> sqrtP = SQRT_1 * f
        return q0 ? uint160(FullMath.mulDiv(SQRT_1, ONE, sqFactor)) : uint160(FullMath.mulDiv(SQRT_1, sqFactor, ONE));
    }

    /// The sqrtPrice one tick-spacing BEYOND the edge where the gateway position is 100% quote.
    function _beyondAllQuoteEdge() internal view returns (uint160) {
        return q0 ? TickMath.getSqrtPriceAtTick(TL - 60) : TickMath.getSqrtPriceAtTick(TU + 60);
    }

    // -- swaps -------------------------------------------------------------------------------

    /// Limit swap: push the pool to exactly `targetSqrt`, selling quote (buy paired) or paired, as `who`.
    /// Returns (amountIn consumed, amountOut received). Reverts if the direction cannot reach the target.
    function _swapToSqrt(address who, bool sellQuote, uint160 targetSqrt) internal returns (uint256 amtIn, uint256 amtOut) {
        bool zeroForOne = sellQuote ? q0 : !q0;
        uint160 cur = _spot();
        if (zeroForOne) require(targetSqrt < cur, "target must be below spot for zeroForOne");
        else require(targetSqrt > cur, "target must be above spot for oneForZero");
        IERC20 tIn = sellQuote ? IERC20(address(quote)) : IERC20(address(paired));
        IERC20 tOut = sellQuote ? IERC20(address(paired)) : IERC20(address(quote));
        uint256 inB = tIn.balanceOf(who);
        uint256 outB = tOut.balanceOf(who);
        vm.prank(who);
        swapper.swap(
            key,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(uint256(1e40)), sqrtPriceLimitX96: targetSqrt}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        amtIn = inB - tIn.balanceOf(who);
        amtOut = tOut.balanceOf(who) - outB;
    }

    /// Exact-input swap (no limit).
    function _swapExactIn(address who, bool sellQuote, uint256 amountIn) internal returns (uint256 amtOut) {
        bool zeroForOne = sellQuote ? q0 : !q0;
        IERC20 tOut = sellQuote ? IERC20(address(paired)) : IERC20(address(quote));
        uint256 outB = tOut.balanceOf(who);
        vm.prank(who);
        swapper.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        amtOut = tOut.balanceOf(who) - outB;
    }

    /// Third party restores the pool to exactly SQRT_1 (fair) so NAV is marked honestly.
    function _arbToFair() internal {
        uint160 s = _spot();
        if (s == SQRT_1) return;
        // if sqrtP is above SQRT_1 we must sell token0 (zeroForOne); token0 is quote iff q0
        bool zeroForOne = s > SQRT_1;
        bool sellQuote = zeroForOne == q0;
        _swapToSqrt(arber, sellQuote, SQRT_1);
    }

    /// Walk the follower with permissionless pokes, one block at a time. Returns blocks used.
    function _walkFollower(uint256 maxBlocks, uint256 toleranceBps) internal returns (uint256 used) {
        while (_devBps() > toleranceBps && used < maxBlocks) {
            _roll(1);
            pm.poke();
            used++;
        }
    }

    function _logQ(string memory label, uint256 v) internal pure {
        console2.log(label, v / 1e18);
    }

    function _logI(string memory label, int256 v) internal pure {
        console2.log(label, v / 1e18);
    }

    function _pct(uint256 num, uint256 den) internal pure returns (uint256) {
        return den == 0 ? 0 : (num * 10_000) / den; // bps
    }
}
