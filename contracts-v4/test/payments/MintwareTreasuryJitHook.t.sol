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
import {LPFeeLibrary}          from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SwapParams}            from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta}       from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {HookMiner}                 from "../../src/lib/HookMiner.sol";
import {MintwareTreasuryVault}     from "../../src/payments/MintwareTreasuryVault.sol";
import {MintwareTreasuryJitHook}   from "../../src/payments/MintwareTreasuryJitHook.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @notice Increment 2 of #5: the REAL V4 JIT hook against a genuine in-test PoolManager. A trader's
///         team->USDC swap fires the hook (borrow a bounded slice -> open a tight single-sided USDC
///         position -> close -> mint ERC-6909 claims for the afterSwap gotcha); then a keeper `sweepJit()`
///         redeems the claims, swaps team->USDC, and settles with the vault — leaving `jitBorrowed` at 0
///         and the senior whole. Both tokens 6dp at a 1:1 pool.
contract MintwareTreasuryJitHookTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for PoolManager;

    PoolManager             internal pm;
    TestSwapRouter          internal swapRouter;
    PoolModifyLiquidityTest internal lpRouter;

    MockERC20                internal usdc; // 6dp
    MockERC20                internal team; // 6dp
    MockYieldAdapter         internal adapter;
    MintwareTreasuryVault    internal vault;
    MintwareTreasuryJitHook  internal hook;
    PoolKey                  internal key;

    address internal teamAddr = makeAddr("team");
    address internal user     = makeAddr("user");
    address internal trader   = makeAddr("trader");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant ONE = 1e6;

    function setUp() public {
        pm         = new PoolManager(address(this));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));

        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Team Token", "TEAM", 6);
        adapter = new MockYieldAdapter(address(usdc));

        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));

        // This suite exercises only the JIT borrow-seam (Aave) + hook sweep — the vault never LPs, so
        // its poolKey needs no hook. Construct it against the hookless key (the vault holds the position
        // itself post-convergence, but here it's dormant).
        PoolKey memory ctorKey = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(address(0))});
        vault = new MintwareTreasuryVault(address(pm), ctorKey, address(usdc), address(adapter), address(this), teamAddr); // owner=this

        // Mine the hook address (beforeSwap|afterSwap = 0xC0). The ctor ignores key.hooks, so a
        // placeholder-hooks key is fine for the initcode; the pool + hook agree on the real address.
        bytes memory args = abi.encode(address(pm), ctorKey, address(usdc), address(vault), address(this));
        (address hookAddr, bytes32 salt) =
            HookMiner.find(address(this), uint160(0x20C0), type(MintwareTreasuryJitHook).creationCode, args);
        hook = new MintwareTreasuryJitHook{salt: salt}(address(pm), ctorKey, address(usdc), address(vault), address(this));
        require(address(hook) == hookAddr, "hook addr");

        key = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(hookAddr)});
        pm.initialize(key, INIT_SQRT_PRICE);

        // Team commit + community deposit ($10k senior -> Aave idle backs the JIT borrow).
        team.mint(teamAddr, 1_000_000 * ONE);
        usdc.mint(teamAddr, 5_000 * ONE);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(1_000_000 * ONE, 5_000 * ONE, 365 days); // $5k junior buffer backstop
        vm.stopPrank();
        usdc.mint(user, 10_000 * ONE);
        vm.startPrank(user);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(10_000 * ONE, 0, user);
        vm.stopPrank();

        vault.setJitHook(address(hook)); // owner=this

        // Deep baseline liquidity on the pool.
        usdc.mint(address(this), 50_000_000 * ONE);
        team.mint(address(this), 50_000_000 * ONE);
        usdc.approve(address(lpRouter), type(uint256).max);
        team.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 5_000_000 * int256(uint256(ONE)), salt: bytes32(0)}),
            ""
        );
    }

    /// team->USDC = the direction that SELLS the team token (output USDC).
    function _sellTeamZeroForOne() internal view returns (bool) {
        return address(team) < address(usdc); // team is currency0 -> zeroForOne sells it
    }

    function test_traderSwap_firesJit_thenSweepMakesSeniorWhole() public {
        uint256 navBefore = vault.totalSeniorAssets();

        // A trader sells team for USDC — large enough to matter.
        team.mint(trader, 1_000_000 * ONE);
        vm.startPrank(trader);
        team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, _sellTeamZeroForOne(), 2_000 * ONE);
        vm.stopPrank();

        // JIT fired: it borrowed (outstanding until the sweep) and closed into ERC-6909 claims.
        assertGt(vault.jitBorrowed(), 0, "JIT did not borrow / stayed unsettled");
        assertGt(hook.usdcClaim() + hook.teamClaim(), 0, "no claims minted on close");
        // NAV is preserved through the open (jitBorrowed counted at par).
        assertApproxEqAbs(vault.totalSeniorAssets(), navBefore, 2, "senior NAV moved while JIT open");

        // Keeper sweeps: redeem claims -> team -> USDC -> settle. Senior made whole, borrow cleared.
        uint256 returned = hook.sweepJit();
        assertGt(returned, 0, "sweep returned no USDC");
        assertEq(vault.jitBorrowed(), 0, "jitBorrowed not cleared after sweep");
        assertEq(hook.usdcClaim(), 0, "usdc claims not cleared");
        assertEq(hook.teamClaim(), 0, "team claims not cleared");
        // Senior is whole (the junior buffer backstops any close cost); a captured fee only lifts it.
        assertGe(vault.totalSeniorAssets() + 5 * ONE, navBefore, "senior lost more than a bounded amount");
    }

    function test_usdcToTeamSwap_doesNotFireJit() public {
        // Buying team (output = team) can't be JIT-funded (no team adapter) — no borrow.
        usdc.mint(trader, 100_000 * ONE);
        vm.startPrank(trader);
        usdc.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, !_sellTeamZeroForOne(), 2_000 * ONE);
        vm.stopPrank();
        assertEq(vault.jitBorrowed(), 0, "JIT fired on a USDC->team swap");
        assertEq(hook.usdcClaim() + hook.teamClaim(), 0, "claims minted on a non-JIT direction");
    }

    function test_sweep_noop_when_nothing_pending() public {
        assertEq(hook.sweepJit(), 0, "sweep returned value with nothing pending");
    }

    // ── dynamic-fee lever (YPN MEV engine, Phase 1 increment 1) ─────────────────────────────────

    /// buy team (usdc->team): USDC is the INPUT, team the OUTPUT -> never fires JIT (no team adapter),
    /// so it's a clean way to move price / probe the fee override without JIT side effects.
    function _buyTeamZeroForOne() internal view returns (bool) {
        return address(usdc) < address(team); // usdc = currency0 -> zeroForOne sells usdc (buys team)
    }

    function _buyTeam(address who, uint256 amtIn) internal {
        usdc.mint(who, amtIn);
        vm.startPrank(who);
        usdc.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, _buyTeamZeroForOne(), amtIn);
        vm.stopPrank();
    }

    /// @dev Read the LP-fee override the hook returns for a small (non-JIT) probe swap on the canonical
    ///      pool, by calling `beforeSwap` directly as the PoolManager. buy-team direction ⇒ no `_open`.
    function _probeFee() internal returns (uint24) {
        SwapParams memory sp = SwapParams({
            zeroForOne: _buyTeamZeroForOne(),
            amountSpecified: -int256(1 * ONE),
            sqrtPriceLimitX96: 0
        });
        vm.prank(address(pm));
        (, , uint24 fee) = hook.beforeSwap(address(this), key, sp, "");
        return fee;
    }

    function test_dynamicFee_baseAtRest_risesWithDeviation_clampedAtMax() public {
        hook.setBaseFeePips(3000);
        hook.setMaxFeePips(50_000);
        hook.setSlopePipsPerTick(10_000); // ~5 ticks of deviation already clamps to the ceiling

        // At rest (oracle not yet ready) the override is the floor.
        uint24 f0 = _probeFee();
        assertTrue(LPFeeLibrary.isOverride(f0), "override flag missing at rest");
        assertEq(LPFeeLibrary.removeOverrideFlag(f0), 3000, "at-rest fee != base floor");

        // Warm the oracle in one block, then advance to a fresh block.
        _buyTeam(trader, 1_000 * ONE); // real swap -> afterSwap initializes the oracle
        vm.roll(block.number + 1);

        // A large print pushes spot far from the (clamped, lagging) oracle -> big deviation.
        _buyTeam(trader, 3_000_000 * ONE);

        (int24 oTick, bool ready) = hook.oracleTick();
        assertTrue(ready, "oracle not ready after warmup");
        (, int24 spot,,) = pm.getSlot0(key.toId());
        uint256 dev = uint256(uint24(spot >= oTick ? spot - oTick : oTick - spot));
        assertGt(dev, 5, "deviation too small to exercise the clamp (vacuous)");

        // The override rose with deviation and sits clamped at the ceiling.
        uint24 f1 = _probeFee();
        assertTrue(LPFeeLibrary.isOverride(f1), "override flag missing when deviated");
        assertGt(LPFeeLibrary.removeOverrideFlag(f1), 3000, "fee did not rise with deviation");
        assertEq(LPFeeLibrary.removeOverrideFlag(f1), 50_000, "fee not clamped at maxFeePips");
    }

    /// The Bunni-class bar: a swap must fill even when the deviation-scaled fee is pinned at its ceiling.
    function test_swapAtMaxDeviation_stillSettles() public {
        hook.setBaseFeePips(3000);
        hook.setMaxFeePips(50_000);
        hook.setSlopePipsPerTick(10_000);

        _buyTeam(trader, 1_000 * ONE);
        vm.roll(block.number + 1);
        _buyTeam(trader, 3_000_000 * ONE); // drive spot far from oracle -> fee clamped at 5%

        assertEq(LPFeeLibrary.removeOverrideFlag(_probeFee()), 50_000, "precondition: fee at ceiling");

        // A further swap while the fee sits at the 5% ceiling must still settle (no revert / no brick).
        uint256 teamBefore = team.balanceOf(trader);
        _buyTeam(trader, 10_000 * ONE);
        assertGt(team.balanceOf(trader), teamBefore, "swap at max-deviation fee failed to settle");
    }

    /// Setter guards: fee params are owner-gated and bounded (base <= max <= MAX_LP_FEE).
    function test_feeSetters_boundedAndOwnerGated() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        hook.setBaseFeePips(1000);

        vm.expectRevert(MintwareTreasuryJitHook.FeeParam.selector);
        hook.setMaxFeePips(2999); // below the 3000 floor

        vm.expectRevert(MintwareTreasuryJitHook.FeeParam.selector);
        hook.setBaseFeePips(60_000); // above the 50_000 ceiling

        vm.expectRevert(MintwareTreasuryJitHook.FeeParam.selector);
        hook.setMaxFeePips(1_000_001); // above MAX_LP_FEE
    }

    // ── surge floor (YPN MEV engine, Phase 1 increment 2) ───────────────────────────────────────

    /// @dev Sell team for USDC (output = USDC) — the direction that fires JIT `_open`.
    function _sellTeam(address who, uint256 amtIn) internal {
        team.mint(who, amtIn);
        vm.startPrank(who);
        team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, _sellTeamZeroForOne(), amtIn);
        vm.stopPrank();
    }

    /// OFF by default: arming has no effect on the fee while `surgeHalfLifeSecs == 0` (ships dark).
    function test_surge_disabledByDefault() public {
        assertEq(hook.surgeHalfLifeSecs(), 0, "surge should be off by default");
        hook.armSurge(); // owner arms, but disabled -> ignored
        assertEq(LPFeeLibrary.removeOverrideFlag(_probeFee()), hook.baseFeePips(), "disabled surge changed the fee");
    }

    /// Enabled + armed: the fee floors at `maxSurgeFeePips`, halves after one half-life, decays to base.
    function test_surge_flooredThenDecays() public {
        hook.setBaseFeePips(3000);
        hook.setSurgeParams(40_000, 100); // 4% surge, 100s half-life
        hook.armSurge();

        // t0: full surge floor (base 3000 is well below -> surge wins).
        assertEq(LPFeeLibrary.removeOverrideFlag(_probeFee()), 40_000, "surge not at full floor when armed");

        // One half-life -> exactly half (integer halving, frac 0).
        vm.warp(block.timestamp + 100);
        assertEq(LPFeeLibrary.removeOverrideFlag(_probeFee()), 20_000, "surge did not halve after one half-life");

        // Fully decayed (>= 24 half-lives) -> back to the base floor.
        vm.warp(block.timestamp + 100 * 24);
        assertEq(LPFeeLibrary.removeOverrideFlag(_probeFee()), 3000, "surge did not decay back to base");
    }

    /// The surge is a FLOOR: `max(base, surge)` — a higher base wins, a higher surge wins.
    function test_surge_isFloorMaxWithBase() public {
        hook.setBaseFeePips(30_000); // base above the surge ceiling below
        hook.setSurgeParams(20_000, 100);
        hook.armSurge();
        assertEq(LPFeeLibrary.removeOverrideFlag(_probeFee()), 30_000, "higher base should win over lower surge");

        hook.setSurgeParams(45_000, 100); // now surge above base
        hook.armSurge();
        assertEq(LPFeeLibrary.removeOverrideFlag(_probeFee()), 45_000, "higher surge should floor above base");
    }

    /// Arming is gated to the vault (NAV-move signal) and the owner (ops); nobody else.
    function test_surge_armGating() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(MintwareTreasuryJitHook.NotArmer.selector);
        hook.armSurge();

        // vault may arm (its NAV-move / reposition seam)
        vm.prank(address(vault));
        hook.armSurge();

        // owner may arm
        hook.armSurge();
    }

    /// Params are owner-gated and bounded so the fee path can neither exceed MAX_LP_FEE nor overflow.
    function test_surgeParams_boundedAndOwnerGated() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        hook.setSurgeParams(40_000, 100);

        vm.expectRevert(MintwareTreasuryJitHook.FeeParam.selector);
        hook.setSurgeParams(1_000_001, 100); // maxPips above MAX_LP_FEE

        vm.expectRevert(MintwareTreasuryJitHook.FeeParam.selector);
        hook.setSurgeParams(40_000, 366 days); // half-life above the 365d overflow guard
    }

    /// A JIT reposition auto-arms the surge (the primary anti-sandwich moment). With the base ceiling
    /// held low, the post-JIT fee reflects the surge floor — proof the reposition armed it.
    function test_surge_autoArmsOnJitReposition() public {
        hook.setMaxFeePips(5_000);      // base can never exceed 0.5% (floor stays 3000 <= 5000)
        hook.setSurgeParams(40_000, 100); // 4% surge

        // Before any reposition the surge is unarmed -> fee is the base floor.
        assertEq(LPFeeLibrary.removeOverrideFlag(_probeFee()), 3000, "surge armed before any JIT");

        // A team->USDC swap fires JIT `_open` -> auto-arms the surge in the same block.
        _sellTeam(trader, 2_000 * ONE);
        assertGt(vault.jitBorrowed(), 0, "precondition: JIT did not fire");

        // Same timestamp -> full surge floors the (<=5000) base at 40_000.
        assertEq(LPFeeLibrary.removeOverrideFlag(_probeFee()), 40_000, "JIT reposition did not arm the surge");
    }

    // ── quadratic base fee (YPN MEV engine, Phase 1 increment 3) ────────────────────────────────

    /// The quadratic term is wired into `_dynamicFee`, lifts/clamps the fee at deviation, and its setter
    /// is owner-gated + bounded. Isolate it by zeroing the linear slope.
    function test_quadMultiplier_wiredIntoFee_ownerGated() public {
        hook.setBaseFeePips(3000);
        hook.setMaxFeePips(50_000);
        hook.setSlopePipsPerTick(0);  // isolate the quadratic term
        hook.setQuadMultiplier(0);

        // Warm the oracle, then drive a large deviation.
        _buyTeam(trader, 1_000 * ONE);
        vm.roll(block.number + 1);
        _buyTeam(trader, 3_000_000 * ONE);
        (int24 oTick, bool ready) = hook.oracleTick();
        assertTrue(ready, "oracle not ready");
        (, int24 spot,,) = pm.getSlot0(key.toId());
        uint256 dev = uint256(uint24(spot >= oTick ? spot - oTick : oTick - spot));
        assertGt(dev, 5, "deviation too small (vacuous)");

        // slope 0 + quad 0 -> the fee sits at the base floor even at a big deviation.
        assertEq(LPFeeLibrary.removeOverrideFlag(_probeFee()), 3000, "floor expected with slope+quad off");

        // Enable the quadratic term -> the same deviation now lifts the fee, clamped at the ceiling.
        hook.setQuadMultiplier(1_000_000); // quad*dev^2 >> ceiling -> clamps
        assertEq(LPFeeLibrary.removeOverrideFlag(_probeFee()), 50_000, "quad term not wired / not clamped");

        // Setter: owner-gated + bounded to MAX_LP_FEE.
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        hook.setQuadMultiplier(1);
        vm.expectRevert(MintwareTreasuryJitHook.FeeParam.selector);
        hook.setQuadMultiplier(1_000_001);
    }
}
