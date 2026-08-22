// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}           from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}          from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary}          from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest}            from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {HookMiner}               from "../../src/lib/HookMiner.sol";
import {MintwareTreasuryJitHook} from "../../src/payments/MintwareTreasuryJitHook.sol";

import {MockERC20} from "../mocks/MockERC20.sol";

/// @dev Minimal `IJitVault` stand-in that lends/returns USDC exactly like the real vault's `_lendJit` /
///      `settleJitReturn` seam (one outstanding slice, par-tracked `jitBorrowed`), but WITHOUT the real
///      `MintwareTreasuryVault`'s junior/team-token machinery. This isolates the HOOK's counter leg so it can
///      be exercised against a NATIVE-ETH pool — which the real vault cannot back (its junior/team reserve is
///      an ERC-20 and `commitTeam` does `teamToken.safeTransferFrom(...)`, impossible for `address(0)` ETH).
contract MockJitVault {
    using SafeERC20 for IERC20;

    IERC20  public immutable usdc;
    address public hook;
    uint256 public jitBorrowed;
    bool    public counterEnabled;

    constructor(address usdc_) { usdc = IERC20(usdc_); }

    function setHook(address h) external { hook = h; }
    function setCounterEnabled(bool on) external { counterEnabled = on; }
    function jitCounterEnabled() external view returns (bool) { return counterEnabled; }

    function borrowIdleForJit(uint256 want) external returns (uint256) { return _lend(want); }
    function borrowIdleForJitCounter(uint256 want) external returns (uint256) {
        if (!counterEnabled) return 0;
        return _lend(want);
    }

    function _lend(uint256 want) internal returns (uint256 lent) {
        if (msg.sender != hook) return 0;
        if (jitBorrowed != 0) return 0; // one outstanding slice (mirrors AUDIT H2)
        uint256 bal = usdc.balanceOf(address(this));
        lent = want < bal ? want : bal;
        if (lent == 0) return 0;
        jitBorrowed += lent;
        usdc.safeTransfer(hook, lent);
    }

    /// @dev The hook transfers the returned USDC to this contract BEFORE calling `settleJitReturn` (matches
    ///      `sweepJit`/`_returnAllUsdcToVault`), so we only clear the outstanding marker here.
    function settleJitReturn(uint256) external { jitBorrowed = 0; }
}

/// @notice GAP #1 — native-ETH counter leg. Stands the hook up against a REAL Uniswap-V4 pool whose non-USDC
///         side is NATIVE ETH (`Currency.wrap(address(0))`), backed by the mock vault above, and exercises the
///         Phase-2 counter round (trader BUYS native ETH → `_openCounter`→swap→`_closeCounter`) + the keeper
///         sweep. Determines empirically whether the leg fires, reconciles, and strands no ETH — or whether the
///         native path is unsupported by the current sweep code.
contract MintwareTreasuryJitCounterNativeEthTest is Test {
    using SafeERC20 for IERC20;

    PoolManager             internal pm;
    PoolSwapTest            internal swapRouter;
    PoolModifyLiquidityTest internal lpRouter;
    MockERC20               internal usdc;
    MockJitVault            internal vault;
    MintwareTreasuryJitHook internal hook;
    PoolKey                 internal key;
    bool                    internal usdcIsC0;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant ONE = 1e6;

    address internal trader = makeAddr("trader");

    function setUp() public {
        pm         = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(IPoolManager(address(pm)));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));

        usdc = new MockERC20("USD Coin", "USDC", 6);
        // Native ETH is currency0 (address(0) sorts first); USDC is currency1.
        Currency ethC  = Currency.wrap(address(0));
        Currency usdcC = Currency.wrap(address(usdc));
        usdcIsC0 = false;

        vault = new MockJitVault(address(usdc));

        PoolKey memory ctorKey = PoolKey({
            currency0: ethC, currency1: usdcC, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: SPACING, hooks: IHooks(address(0))
        });
        bytes memory hookArgs = abi.encode(address(pm), ctorKey, address(usdc), address(vault), address(this));
        (address hookAddr, bytes32 salt) =
            HookMiner.find(address(this), uint160(0x20C8), type(MintwareTreasuryJitHook).creationCode, hookArgs);
        hook = new MintwareTreasuryJitHook{salt: salt}(address(pm), ctorKey, address(usdc), address(vault), address(this));
        require(address(hook) == hookAddr, "hook addr");
        vault.setHook(address(hook));
        vault.setCounterEnabled(true);

        key = PoolKey({
            currency0: ethC, currency1: usdcC, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: SPACING, hooks: IHooks(hookAddr)
        });
        pm.initialize(key, INIT_SQRT_PRICE); // beforeInitialize gates on owner() == address(this)

        // Fund the mock vault with senior USDC to lend to the counter leg.
        usdc.mint(address(vault), 10_000_000 * ONE);

        // Deep baseline liquidity: native ETH + USDC, full range. lpRouter is payable and refunds excess ETH.
        vm.deal(address(this), 100 ether);
        usdc.mint(address(this), 100_000_000 * ONE);
        usdc.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity{value: 100 ether}(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 20_000_000 * int256(uint256(ONE)), salt: bytes32(0)}),
            ""
        );
    }

    /// @dev trader BUYS native ETH = sells USDC. usdc is currency1 → oneForZero (zeroForOne = false).
    function _buyEth(uint256 amtIn) internal {
        usdc.mint(trader, amtIn);
        vm.startPrank(trader);
        usdc.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(
            key,
            SwapParams({zeroForOne: false, amountSpecified: -int256(amtIn), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
    }

    /// GAP #1 (partial) — a counter round whose swap is too small to reach the JIT ETH range (which sits
    /// `spacing` ticks ABOVE spot) never traverses it, so `_closeCounter` defers NO USDC claim
    /// (`usdcClaim == 0`). `sweepJit` then takes its short-circuit path (no `poolManager.unlock`), so the
    /// round DOES reconcile and strands no ETH. This proves the flash open/close + native settlement
    /// scaffolding function on a native-ETH pool — but ONLY in the degenerate case where the JIT range did
    /// no work. The moment the range is actually used (next test), the sweep reverts.
    function test_native_counterRound_untouchedRange_reconciles() public {
        _buyEth(2_000 * ONE); // tiny vs 20M liquidity → price barely moves, JIT range untouched
        assertGt(vault.jitBorrowed(), 0, "counter leg did not fire on the native-ETH pool");
        assertEq(hook.usdcClaim(), 0, "unexpected deferred USDC claim (range was traversed)");
        assertEq(address(hook).balance, 0, "native ETH stranded in the hook after the round");

        hook.sweepJit();
        assertEq(vault.jitBorrowed(), 0, "borrow not reconciled after sweep");
        assertEq(address(hook).balance, 0, "native ETH stranded after sweep");
        assertEq(usdc.balanceOf(address(hook)), 0, "USDC left in the hook after sweep");
    }

    /// GAP #1 (the finding) — NATIVE ETH IS NOT SUPPORTED once the counter round does real work. A swap large
    /// enough to CROSS the JIT ETH range makes `_closeCounter` defer the trader's USDC as an ERC-6909 claim
    /// (`usdcClaim > 0`, the normal, useful case). `sweepJit` then enters `poolManager.unlock` →
    /// `unlockCallback`, whose step-3 line `teamToken.balanceOf(address(this))` is an ERC-20 call to
    /// `teamToken == IERC20(address(0))` (native ETH). That call reverts on the compiler's `extcodesize`
    /// guard (empty revert data), so the sweep reverts, the borrow NEVER reconciles, and the borrowed USDC is
    /// STRANDED in the hook. The trader's swap itself succeeds (the ETH flash debt is zeroed synchronously in
    /// `_closeCounter`), but the value cannot be returned to the vault.
    ///
    /// This is a REGRESSION MARKER for a known limitation, not a passing happy-path: the hook carries native
    /// `_pay`/`receive()` scaffolding, but `unlockCallback` + `_close` still read `teamToken.balanceOf(...)`,
    /// which is not native-ETH-safe. (Separately, the real `MintwareTreasuryVault` cannot even back a
    /// native-ETH pool — its junior/team reserve is ERC-20 and `commitTeam` does `safeTransferFrom`.)
    /// If someone makes native ETH work end-to-end, THIS TEST SHOULD FAIL — update it then.
    function test_native_counterRound_deferredClaim_sweepReverts_unsupported() public {
        _buyEth(500_000 * ONE); // large vs 20M liquidity → crosses the JIT ETH range → defers a USDC claim
        assertGt(vault.jitBorrowed(), 0, "counter leg did not fire");
        assertGt(hook.usdcClaim(), 0, "expected a deferred USDC claim once the JIT range is traversed");
        assertEq(address(hook).balance, 0, "no native ETH should be stranded pre-sweep");

        // The sweep hits `teamToken.balanceOf(address(0))` and reverts (empty data) → native ETH unsupported.
        vm.expectRevert();
        hook.sweepJit();

        // The borrow is left OUTSTANDING and the USDC STRANDED — the documented failure mode.
        assertGt(vault.jitBorrowed(), 0, "borrow unexpectedly reconciled (native sweep now works?)");
        assertGt(usdc.balanceOf(address(hook)), 0, "borrowed USDC not stranded as documented");
        assertEq(address(hook).balance, 0, "native ETH stranded outright (worse than documented)");
    }

    receive() external payable {}
}
