// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}         from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary}        from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {SwapParams}          from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20}              from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HookMiner}               from "../src/lib/HookMiner.sol";
import {MWHookCoordinator}       from "../src/hooks/MWHookCoordinator.sol";
import {MWAmAuction, IAmAmmRentSink} from "../src/hooks/MWAmAuction.sol";
import {AmParams}                from "../src/hooks/MWAmAuctionLib.sol";
import {MintwareDeFiPairVault}   from "../src/vaults/MintwareDeFiPairVault.sol";
import {PoolProfile, LockTier}   from "../src/vaults/VaultTypes.sol";

import {MockERC20}      from "./mocks/MockERC20.sol";
import {TestSwapRouter} from "./helpers/TestSwapRouter.sol";

contract SurgeSinkStub is IAmAmmRentSink {
    function fundRent(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }
}

/// @notice Inc-1c: closes the unmanaged-block LVR/MEV leak. When the am-AMM auction has NO manager,
///         the hook must price a swap by its deviation from the truncated oracle (same surge the
///         non-auction path uses) and return max(auction default, surge) as the LP fee — instead of
///         leaking the calm-market default to an arbitrageur. These tests exercise the fee bounds and
///         prove the MANAGED skim path is unchanged. Migrated onto the go-forward
///         `MintwareDeFiPairVault` (the surge/rate-limit/clamp logic is coordinator-internal; the
///         vault only supplies resting liquidity). Phase 0.
contract MWHookCoordinatorAmAmmSurgeTest is Test {
    using PoolIdLibrary for PoolKey;

    address internal deployer = address(this); // owner + provider
    address internal alice    = makeAddr("alice");
    address internal mgr      = makeAddr("mgr");
    address internal treasury = makeAddr("treasury");

    PoolManager       internal pm;
    TestSwapRouter    internal swapRouter;
    MWHookCoordinator internal coord;
    MWAmAuction       internal auction;
    SurgeSinkStub     internal sink;
    MintwareDeFiPairVault internal vault;

    MockERC20 internal usdc;
    MockERC20 internal proj;

    PoolKey internal poolKey;
    PoolId  internal poolId;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336;

    // Auction default fee (the "calm-market" fee that used to leak in the unmanaged block).
    uint24 internal constant AUCTION_DEFAULT = 3000; // 0.30%
    uint24 internal constant MGR_FEE_PIPS    = 10_000; // 1%

    function setUp() public {
        pm         = new PoolManager(deployer);
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        sink       = new SurgeSinkStub();

        usdc = new MockERC20("USD Coin", "USDC", 18);
        proj = new MockERC20("Project", "PROJ", 18);

        bytes memory args = abi.encode(IPoolManager(address(pm)), address(0), deployer);
        (address expected, bytes32 salt) =
            HookMiner.find(deployer, uint160(0xAC8), type(MWHookCoordinator).creationCode, args);
        coord = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), address(0), deployer);
        require(address(coord) == expected, "coord addr");

        (Currency c0, Currency c1) = address(usdc) < address(proj)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(proj)))
            : (Currency.wrap(address(proj)), Currency.wrap(address(usdc)));
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: IHooks(address(coord))});
        poolId  = poolKey.toId();

        vault = new MintwareDeFiPairVault(address(pm), poolKey, PoolProfile.EMERGING, treasury, deployer, deployer);
        coord.setVault(address(vault));
        vault.setHook(address(coord));
        vault.initializePool(INIT_SQRT_PRICE);

        // Balanced dual-sided liquidity so a large one-sided swap can drive the tick.
        usdc.mint(alice, 20_000_000e18);
        proj.mint(alice, 20_000_000e18);
        usdc.mint(mgr, 100_000e18);
        vm.startPrank(alice);
        IERC20(Currency.unwrap(c0)).approve(address(vault), type(uint256).max);
        IERC20(Currency.unwrap(c1)).approve(address(vault), type(uint256).max);
        vault.deposit(2_000_000e18, 2_000_000e18, 0, LockTier.Flex);
        vm.stopPrank();

        // Wire auction + enroll the pool (default fee = AUCTION_DEFAULT).
        auction = new MWAmAuction(deployer);
        auction.setCoordinator(address(coord));
        coord.setAuction(address(auction));
        coord.setAmAmmEnabled(poolId, true);
        auction.configurePool(poolId, address(sink), AmParams({
            enabled: true, bidToken: address(usdc), feeMaxPips: 30_000, defaultFeePips: AUCTION_DEFAULT,
            minRent: 100, K: 10, minBidMultBps: 11_000
        }));

        vm.roll(1000);
    }

    // configurePool(id, base, max, slopePerTick, maxFeeStepPerBlock, dynFee, guard, maxTickMove, maxDev, catchup)
    function _cfg(
        uint24 base, uint24 max, uint256 slope, uint24 step, bool dynFee, bool guard,
        int24 maxTickMove, int24 maxDev, uint32 catchup
    ) internal {
        coord.configurePool(poolId, base, max, slope, step, dynFee, guard, maxTickMove, maxDev, catchup);
    }

    /// @dev Read the LP fee the hook WOULD apply right now (unmanaged path), by calling beforeSwap as
    ///      the pool manager. Safe outside an unlock: the unmanaged branch takes no delta.
    function _readLpFee() internal returns (uint24) {
        SwapParams memory sp = SwapParams({zeroForOne: true, amountSpecified: -int256(1), sqrtPriceLimitX96: 0});
        vm.prank(address(pm));
        (, , uint24 raw) = coord.beforeSwap(alice, poolKey, sp, "");
        assertTrue(raw & LPFeeLibrary.OVERRIDE_FEE_FLAG != 0, "override flag must be set");
        return raw & LPFeeLibrary.REMOVE_OVERRIDE_MASK;
    }

    function _swapExactIn(bool zeroForOne, uint256 amountIn) internal {
        vm.startPrank(alice);
        (zeroForOne ? IERC20(Currency.unwrap(poolKey.currency0)) : IERC20(Currency.unwrap(poolKey.currency1)))
            .approve(address(swapRouter), amountIn);
        swapRouter.swap(poolKey, zeroForOne, amountIn);
        vm.stopPrank();
    }

    /// @dev Determine which direction sells USDC so spot moves hard against the paired token.
    function _sellUsdc() internal view returns (bool zeroForOne) {
        return Currency.unwrap(poolKey.currency0) == address(usdc);
    }

    /// @dev Seed the oracle, then push spot far while the oracle truncates (maxTickMove=1) → large
    ///      standing deviation between currentTick and the oracle reference.
    function _buildLargeDeviation() internal {
        _swapExactIn(_sellUsdc(), 200e18);     // seed oracle at post-swap tick
        vm.roll(block.number + 1);
        _swapExactIn(_sellUsdc(), 2_000_000e18); // push spot far; oracle only advances +1 tick
        vm.roll(block.number + 1);
    }

    function _seatManager() internal {
        vm.startPrank(mgr);
        usdc.approve(address(auction), 1000);
        auction.bid(poolId, MGR_FEE_PIPS, 100, 1000); // rent 100, deposit 1000 = rent*K
        vm.stopPrank();
        vm.roll(block.number + 10); // past K → next poke promotes mgr
    }

    // ── (a) unmanaged + zero deviation → LP fee == auction default (no regression) ──

    function test_unmanaged_zeroDeviation_returns_auction_default() public {
        // base < auction default; with dev 0 the surge (== base) is below default, so max() keeps
        // the auction default — proving no regression AND that max(default, surge) is the rule.
        _cfg(1000, 500_000, 50, 0, true, false, 1, 6000, 1);
        assertEq(_readLpFee(), AUCTION_DEFAULT, "zero deviation must return the auction default");
    }

    // ── (b) unmanaged + large deviation → LP fee surges ABOVE the default ──

    function test_unmanaged_largeDeviation_surges_above_default() public {
        _cfg(AUCTION_DEFAULT, 500_000, 50, 0, true, false, 1, 6000, 1); // guard off; unlimited step
        _buildLargeDeviation();
        uint24 fee = _readLpFee();
        assertGt(fee, AUCTION_DEFAULT, "LVR must be recaptured: fee surges above the calm default");
        assertLt(fee, LPFeeLibrary.MAX_LP_FEE, "fee must stay below 100% (never brick swaps)");
        assertLe(fee, uint24(500_000), "fee must not exceed configured maxFeePips");
    }

    // ── (c) returned fee always < 1e6 and <= maxFeePips (explicit clamp) ──

    function test_unmanaged_surge_clamped_to_maxFeePips() public {
        // Steep slope + huge deviation would blow past the cap; volatilityFee must clamp to maxFeePips.
        _cfg(AUCTION_DEFAULT, 8000, 1_000_000, 0, true, false, 1, 60000, 1);
        _buildLargeDeviation();
        uint24 fee = _readLpFee();
        assertEq(fee, uint24(8000), "surge clamped exactly to maxFeePips");
        assertLt(fee, LPFeeLibrary.MAX_LP_FEE, "below 100%");
    }

    // ── (c') maxFeePips == 0 fallback must NOT reach 100% — clamp to FALLBACK_MAX_FEE_PIPS ──

    function test_unmanaged_maxFeePipsZero_clamps_to_fallback_not_100pct() public {
        // maxFeePips == 0 (misconfig) + steep slope + huge deviation. Without the fallback clamp
        // volatilityFee would return 1e6 and brick swaps; the hook must cap at FALLBACK (10%).
        _cfg(AUCTION_DEFAULT, 0, 1_000_000, 0, true, false, 1, 60000, 1);
        _buildLargeDeviation();
        uint24 fee = _readLpFee();
        assertEq(fee, uint24(100_000), "maxFeePips==0 fallback clamps to FALLBACK_MAX_FEE_PIPS (10%)");
        assertLt(fee, LPFeeLibrary.MAX_LP_FEE, "must never reach 100%");

        // And the pool is NOT bricked — a real unmanaged swap still settles at the clamped fee.
        // (Swap the opposite way: the build pushed spot to the range edge, so re-selling the same
        //  side would just hit the price limit — direction here is about the harness, not the fee.)
        _swapExactIn(!_sellUsdc(), 100e18);
    }

    // ── (d) rate-limit still clamps a single-block jump ──

    function test_unmanaged_rateLimit_clamps_single_block_jump() public {
        uint24 step = 1000;
        _cfg(AUCTION_DEFAULT, 900_000, 1_000_000, step, true, false, 1, 8_000_000, 1);
        _buildLargeDeviation(); // large standing deviation; uncapped target pins to the 900_000 cap

        // Anchor the two measurement reads to the build's own lastFeeBlock (read from the contract,
        // not the memoized block.number opcode) and roll to ABSOLUTE blocks. No more real swaps →
        // spot + oracle frozen, deviation constant, uncapped target ~= 900_000. Each read is exactly
        // one block after the previous, so the fee may rise by at most `step` per read.
        uint256 base = uint256(coord.lastFeeBlock(poolId));
        uint24  lastAfterBuild = coord.lastFee(poolId); // ~= AUCTION_DEFAULT

        vm.roll(base + 1);
        uint24 f1 = _readLpFee();
        vm.roll(base + 2);
        uint24 f2 = _readLpFee();

        assertEq(f2 - f1, step, "single-block fee move clamped to maxFeeStepPerBlock");
        assertGt(f1, lastAfterBuild, "fee is ramping up toward the surge target");
        // Clamp bites: with an unlimited step the fee would already be the ~900k target; rate-limited
        // it is still tiny two blocks in.
        assertLt(f2, uint24(50_000), "rate-limit prevents an instant jump to the large target");
    }

    // ── (e) MANAGED swap fee path unchanged: manager still skims, LP fee still 0 ──

    function test_managed_fee_path_unchanged_manager_skims_lp_zero() public {
        // Dynamic fee ON to prove the unmanaged surge does NOT leak into the managed branch.
        _cfg(AUCTION_DEFAULT, 500_000, 50, 0, true, false, 1, 6000, 1);
        _seatManager();

        address spec = Currency.unwrap(poolKey.currency0); // exact-in zeroForOne → specified = c0
        bool zeroForOne = true;
        uint256 amountIn = 10_000e18;
        uint256 expectFee = (amountIn * MGR_FEE_PIPS) / 1_000_000; // 1%

        uint256 auctBefore = IERC20(spec).balanceOf(address(auction));
        _swapExactIn(zeroForOne, amountIn); // must settle (net-zero delta)
        assertEq(IERC20(spec).balanceOf(address(auction)) - auctBefore, expectFee, "manager skims full fee");
        assertEq(auction.owed(mgr, spec), expectFee, "manager credited in ledger");

        // LP fee was 0 on the managed swap → the vault position collected no trading fees.
        (uint256 f0, uint256 f1) = vault.collectFees();
        assertEq(f0, 0, "no LP fee accrued on managed swap (token0)");
        assertEq(f1, 0, "no LP fee accrued on managed swap (token1)");
    }

    // ── (f) dynamicFeeEnabled == false → unmanaged returns the flat default (backward compatible) ──

    function test_unmanaged_dynamicFeeDisabled_returns_flat_default() public {
        // Guard ON (very wide band so it never trips) so the oracle tracks and a deviation exists;
        // dynamic fee OFF → the unmanaged branch must ignore the deviation and return the flat default.
        _cfg(AUCTION_DEFAULT, 500_000, 50, 0, false, true, 1, 8_000_000, 1);
        _buildLargeDeviation();
        assertEq(_readLpFee(), AUCTION_DEFAULT, "dynFee off: flat auction default regardless of deviation");
    }
}
