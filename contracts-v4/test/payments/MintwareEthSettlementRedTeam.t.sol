// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}           from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {MintwareEthSettlement, IOracleTickSource} from "../../src/payments/MintwareEthSettlement.sol";
import {MockERC20}      from "../mocks/MockERC20.sol";
import {TestSwapRouter} from "../helpers/TestSwapRouter.sol";

/// Settable stand-in for the pool hook's truncated-oracle view.
contract MockOracleSource is IOracleTickSource {
    int24  public tick;
    bool   public ready;
    function set(int24 t, bool r) external { tick = t; ready = r; }
    function oracleTick() external view returns (int24, bool) { return (tick, ready); }
}

/// @title  MintwareEthSettlement - adversarial economic red-team (settlement/float sweep)
/// @notice Attacks NOT covered by the functional suite: (1) is the treasury's realized WETH-spend actually
///         bounded by the oracle band under a moderate sandwich? (2) does the DEFAULT config (all R2-M2 caps
///         OFF) let a rogue/compromised relayer convert ALL WETH backing + drain junior across repeated calls,
///         and where does that value land? Each test states CONFIRMED / REFUTED with the exact guard.
///
/// @dev Real V4 pool, 18-dp tokens, 1:1 init (tick 0). Mirrors MintwareEthSettlement.t.sol's harness.
contract MintwareEthSettlementRedTeam is Test {
    PoolManager             internal pm;
    PoolModifyLiquidityTest internal lpRouter;
    TestSwapRouter          internal swapRouter;
    MockOracleSource        internal oracle;
    MintwareEthSettlement   internal settle;

    MockERC20 internal usdc;
    MockERC20 internal weth;
    PoolKey   internal key;
    bool      internal wethIs0;

    address internal owner    = makeAddr("owner");
    address internal relayer  = makeAddr("relayer");
    address internal rail     = makeAddr("cardRail");
    address internal team     = makeAddr("team");
    address internal lp       = makeAddr("lp");
    address internal attacker = makeAddr("attacker");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;

    function setUp() public {
        pm         = new PoolManager(address(this));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        oracle     = new MockOracleSource();

        usdc = new MockERC20("USD Coin", "USDC", 18);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        (Currency c0, Currency c1) = address(usdc) < address(weth)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(weth)))
            : (Currency.wrap(address(weth)), Currency.wrap(address(usdc)));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        pm.initialize(key, INIT_SQRT_PRICE);
        wethIs0 = address(weth) < address(usdc);

        settle = new MintwareEthSettlement(
            IPoolManager(address(pm)), key, address(usdc), address(weth), owner, relayer
        );
        vm.prank(owner); settle.setOracleSource(address(oracle));
        vm.prank(owner); settle.setSettlementRail(rail);
        oracle.set(0, true);

        // Deep 1:1 baseline liquidity.
        usdc.mint(address(this), 50_000_000e18);
        weth.mint(address(this), 50_000_000e18);
        usdc.approve(address(lpRouter), type(uint256).max);
        weth.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 20_000_000e18, salt: bytes32(0)}),
            ""
        );
    }

    function _fundBacking(uint256 amount) internal {
        weth.mint(lp, amount);
        vm.startPrank(lp);
        weth.approve(address(settle), type(uint256).max);
        settle.fundWethBacking(amount);
        vm.stopPrank();
    }

    function _fundJunior(uint256 amount) internal {
        usdc.mint(team, amount);
        vm.startPrank(team);
        usdc.approve(address(settle), type(uint256).max);
        settle.fundJuniorBuffer(amount);
        vm.stopPrank();
    }

    /// Arm the aggregate windowed settlement cap (effectively unlimited) so `batchSettleEth` is enabled.
    /// FIX (R5-M settle): settlement fails closed until this is set - mirrors the `RailNotSet` pin.
    function _armWindowCap() internal {
        vm.prank(owner);
        settle.setSettlementWindowCap(type(uint128).max, 3650 days);
    }

    /// Attacker sells `amt` WETH to push spot DOWN by a chosen magnitude.
    function _pushSpotDown(uint256 amt) internal {
        weth.mint(attacker, amt);
        vm.startPrank(attacker);
        weth.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, wethIs0, amt);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // THESIS 1/2 - oracle-manipulation / sandwich → bad settlement RATE.
    // Claim under attack: an attacker who moves spot before settlement can force the
    // treasury to over-spend WETH for the owed USDC without limit.
    // RESULT: REFUTED. `_swapLimit` clamps the exact-output swap to `oracle - bandTicks`
    // (src/payments/MintwareEthSettlement.sol:580-592); the WETH the treasury can be made
    // to spend for `totalUsdc` is bounded by the band-floor price. Below the band the swap
    // simply strands and junior covers / it reverts. We MEASURE the bound here.
    // ─────────────────────────────────────────────────────────────────────────────
    function test_Sandwich_TreasuryWethSpendBoundedByBand() public {
        _fundBacking(1_000e18);
        _fundJunior(1_000e18);
        _armWindowCap(); // FIX: settlement now fails closed until the aggregate cap is armed

        // Attacker front-runs with a MODERATE push (settlement still fully fills from the swap, but at a
        // worse in-band price). bandTicks = 500 (~4.88% at 1.0001^-500).
        _pushSpotDown(400_000e18);

        uint256 totalUsdc = 100e18;
        uint256 backingBefore = settle.wethBacking();

        vm.prank(relayer);
        (uint256 usdcFromSwap, uint256 wethSpent,) = settle.batchSettleEth(totalUsdc, 0, rail);

        // Senior/rail price-free invariant holds regardless of manipulation.
        assertEq(usdc.balanceOf(rail), totalUsdc, "rail paid exactly totalUsdc");

        // The KEY red-team number: even with the attacker having moved spot, the WETH the treasury spends to
        // realize `usdcFromSwap` USDC is capped by the band-floor rate. Band floor price = 1.0001^(-500) of
        // oracle spot => worst-case WETH per USDC = 1 / 0.95123 ~ 1.05127. So wethSpent must not exceed
        // usdcFromSwap * 1.0513 (plus the 0.30% pool fee) - i.e. the treasury CANNOT be griefed into
        // unbounded over-spend. We assert a generous 6% ceiling that the band enforces.
        uint256 bandCeiling = usdcFromSwap * 106 / 100;
        assertLe(wethSpent, bandCeiling, "band caps treasury WETH over-spend (no unbounded bleed)");
        assertEq(settle.wethBacking(), backingBefore - wethSpent, "backing conserved (exactly wethSpent)");

        emit log_named_decimal_uint("usdcFromSwap", usdcFromSwap, 18);
        emit log_named_decimal_uint("wethSpent   ", wethSpent, 18);
    }

    /// Push spot BELOW the band → the swap strands, and a `minUsdcOut` catastrophe floor reverts the whole
    /// settlement BEFORE any junior draw. A sandwicher gets no victim-fill to profit from.
    function test_Sandwich_BeyondBand_RevertsNoFill() public {
        _fundBacking(1_000e18);
        _fundJunior(1_000e18);
        _armWindowCap(); // FIX: arm the aggregate cap so the revert we assert is the band floor, not fail-closed

        _pushSpotDown(6_000_000e18); // shove far past the band

        uint256 juniorBefore = settle.juniorUsdcBuffer();
        uint256 attackerUsdcBefore = usdc.balanceOf(attacker);

        // Relayer requires a realistic minUsdcOut (edge γ). The stranded swap can't clear it → revert.
        vm.prank(relayer);
        vm.expectRevert(); // SettlementSlippageExceeded(produced, minUsdcOut)
        settle.batchSettleEth(100e18, 95e18, rail);

        assertEq(settle.juniorUsdcBuffer(), juniorBefore, "junior untouched");
        // Attacker back-run would only reverse its own front-run minus fees: no victim fill occurred.
        assertLe(usdc.balanceOf(attacker), attackerUsdcBefore, "no extraction: settlement never filled");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // THESIS 3/4 - rogue/compromised relayer: value leak + trust bound.
    // Claim under attack: a rogue relayer can steal settlement backing to an address it controls.
    // RESULT: REFUTED for redirect (H4 pinned rail) - the relayer can NEVER pay anywhere but the
    // pinned `settlementRail`. CONFIRMED-as-DESIGNED trust bound: with the R2-M2 caps at DEFAULT
    // (all OFF), a rogue relayer CAN fabricate charges and convert all WETH backing + drain junior
    // to the PINNED rail with no on-chain proof a real charge exists. That value lands at the trusted
    // rail (not the attacker); the mitigation is to SET the per-call + windowed caps.
    // ─────────────────────────────────────────────────────────────────────────────
    function test_RogueRelayer_CannotRedirect_H4PinnedRail() public {
        _fundBacking(1_000e18);
        _fundJunior(500e18);

        // Relayer tries to pay itself / an arbitrary address → RailMismatch.
        vm.startPrank(relayer);
        vm.expectRevert(MintwareEthSettlement.RailMismatch.selector);
        settle.batchSettleEth(100e18, 0, attacker);
        vm.expectRevert(MintwareEthSettlement.RailMismatch.selector);
        settle.batchSettleEth(100e18, 0, relayer);
        vm.stopPrank();

        assertEq(usdc.balanceOf(attacker), 0, "attacker got nothing");
        assertEq(usdc.balanceOf(relayer), 0, "relayer got nothing");
    }

    /// FIX (R5-M settle): DEFAULT CONFIG (windowed cap OFF) now FAILS CLOSED. Before the fix a rogue relayer
    /// with a loose `minUsdcOut` converted the ENTIRE WETH backing to USDC + drained junior across repeated
    /// fabricated calls (bounded only by the pinned rail). `batchSettleEth` now reverts
    /// `SettlementWindowCapNotSet` until the aggregate cap is armed - the pin stops THEFT, the fail-closed
    /// aggregate cap stops unbounded CONVERSION by default.
    function test_RogueRelayer_DefaultCapsOff_ConvertsAllBackingToRail() public {
        _fundBacking(1_000e18);
        _fundJunior(500e18);
        assertEq(settle.maxSettlePerCall(), 0, "per-call cap OFF by default");
        assertEq(settle.maxSettlePerWindow(), 0, "windowed cap OFF by default");
        assertEq(settle.minSettleOutBps(), 0, "min-out floor OFF by default");

        // No real charge exists. Rogue relayer fabricates a large settlement, minUsdcOut = 0.
        // BLOCKED: settlement fails closed until the operator arms the aggregate window cap.
        vm.prank(relayer);
        vm.expectRevert(MintwareEthSettlement.SettlementWindowCapNotSet.selector);
        settle.batchSettleEth(900e18, 0, rail);

        // Nothing moved: no USDC to the rail, backing intact, junior intact.
        assertEq(usdc.balanceOf(rail), 0, "fabricated settlement reverted - rail unpaid");
        assertEq(settle.wethBacking(), 1_000e18, "backing NOT converted");
        assertEq(settle.juniorUsdcBuffer(), 500e18, "junior NOT drained");
    }

    /// FIX (R5-M settle): a PER-CALL cap alone is NOT sufficient - settlement still fails closed until the
    /// WINDOWED cap is armed. Before the fix, a rogue relayer looped sub-cap calls to convert everything with
    /// only a per-call cap set; now even the first sub-cap call reverts `SettlementWindowCapNotSet`.
    function test_RogueRelayer_PerCallCapAlone_DoesNotBoundAggregate() public {
        _fundBacking(1_000e18);

        // Owner sets a per-call cap only (rail already pinned in setUp → tightening-from-off is instant).
        // Windowed cap left OFF.
        vm.prank(owner);
        settle.setMaxSettlePerCall(50e18);

        // A sub-cap settlement still fails closed - the per-call cap does not satisfy the aggregate gate.
        vm.prank(relayer);
        vm.expectRevert(MintwareEthSettlement.SettlementWindowCapNotSet.selector);
        settle.batchSettleEth(50e18, 0, rail);

        assertEq(usdc.balanceOf(rail), 0, "nothing settled - per-call cap alone does not arm settlement");
    }

    /// Positive control: once the WINDOWED cap is armed, aggregate extraction is bounded within the window.
    function test_WindowedCap_BoundsAggregateExtraction() public {
        _fundBacking(1_000e18);

        // Arm a windowed cap of 100 USDC / 1 day (enabling-from-off = tightening → instant even post-rail).
        vm.prank(owner);
        settle.setSettlementWindowCap(100e18, 1 days);

        vm.startPrank(relayer);
        settle.batchSettleEth(60e18, 0, rail);
        settle.batchSettleEth(40e18, 0, rail); // cumulative == 100, at the cap
        vm.expectRevert(MintwareEthSettlement.SettlementWindowCapExceeded.selector);
        settle.batchSettleEth(1e18, 0, rail);  // 101 > cap → blocked; guardian has reaction time
        vm.stopPrank();

        assertEq(usdc.balanceOf(rail), 100e18, "windowed cap bounds aggregate within the window");
    }
}
