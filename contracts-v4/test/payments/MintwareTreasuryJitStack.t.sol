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
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {HookMiner}                 from "../../src/lib/HookMiner.sol";
import {MintwareTreasuryVault}     from "../../src/payments/MintwareTreasuryVault.sol";
import {MintwareTreasuryJitHook}   from "../../src/payments/MintwareTreasuryJitHook.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @notice Increment 3 of #5: the JIT hook composed IN FRONT of the passive module on one pool (the
///         DeployTreasuryV2 hooked assembly). Proves the two coexist — the module deploys/recovers
///         liquidity on the hooked pool — and, critically, that the module's OWN recover swap does NOT
///         fire JIT (the skip-sender exemption), while a real trader's team→USDC swap does.
contract MintwareTreasuryJitStackTest is Test {
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

        // Mirror DeployTreasuryV2: the vault HOLDS the position itself (no module) and LPs into the
        // HOOKED pool, so its poolKey must carry the JIT hook. That is circular — the hook ctor takes the
        // vault address, and the vault's key needs the (mined) hook address. Break it by PREDICTING the
        // vault's CREATE address: the hook is deployed first (CREATE2, bumping our nonce by 1), so the
        // vault lands at computeCreateAddress(this, currentNonce + 1).
        PoolKey memory ctorKey = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(address(0))});
        address predictedVault = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        bytes memory args = abi.encode(address(pm), ctorKey, address(usdc), predictedVault, address(this));
        (address hookAddr, bytes32 salt) =
            HookMiner.find(address(this), uint160(0x20C0), type(MintwareTreasuryJitHook).creationCode, args);
        hook = new MintwareTreasuryJitHook{salt: salt}(address(pm), ctorKey, address(usdc), predictedVault, address(this));
        require(address(hook) == hookAddr, "hook addr");

        key = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(hookAddr)});
        vault = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), address(this), teamAddr);
        require(address(vault) == predictedVault, "vault addr prediction");

        pm.initialize(key, INIT_SQRT_PRICE);

        vault.setJitHook(address(hook));
        // Exempt the vault's OWN recover/collect swaps (sender = vault) from firing JIT.
        hook.setJitSkipSender(address(vault));

        // Team + community.
        team.mint(teamAddr, 1_000_000 * ONE);
        usdc.mint(teamAddr, 5_000 * ONE);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(1_000_000 * ONE, 5_000 * ONE, 365 days);
        vm.stopPrank();
        usdc.mint(user, 10_000 * ONE);
        vm.startPrank(user);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(10_000 * ONE, 0, user);
        vm.stopPrank();

        // Deep baseline liquidity on the hooked pool (hook has no liquidity-callback → adds freely).
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

        // Widen the truncated-oracle catch-up (bounded by the hook's own MAX_ORACLE_MOVE_TICKS/CATCHUP) so a
        // settling helper can walk the oracle to a crashed spot within a couple of rolled blocks — the R6
        // accounting probes below are about the redemption WATERFALL, not manipulation resistance (that is the
        // JitLeak PoC + `test_spotManipulation`, which both rely only on the per-block FREEZE, unaffected here).
        // Instant: set while the oracle is still un-initialized (pre-first-swap bootstrap).
        hook.setOracleParams(hook.MAX_ORACLE_MOVE_TICKS(), hook.MAX_ORACLE_CATCHUP());

        // FIX 2a: deployToLP now requires a READY oracle. The JIT hook's truncated oracle initializes on the
        // first swap through the hooked pool, so warm it here with ONE small buy-team swap (USDC in ⇒ no JIT,
        // no senior borrow). ~0.002% price move on the 5M-liquidity pool ⇒ negligible for the assertions below.
        team.mint(address(this), 200 * ONE);
        usdc.mint(address(this), 200 * ONE);
        usdc.approve(address(swapRouter), type(uint256).max);
        team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, !_sellTeamZeroForOne(), 100 * ONE);
        (, bool oReady) = hook.oracleTick();
        require(oReady, "harness: oracle warmup failed");

        // FIX 3: deployToLP now requires a non-zero coverage floor. Arm the smallest floor (1 bps); the
        // $5,000 junior USDC buffer covers every (≤ a few-thousand) deploy in the derived tests many times
        // over, so this does not change their economics. Tests that exercise the floor mechanics override it.
        vault.setMinCoverage(1);
    }

    function _sellTeamZeroForOne() internal view returns (bool) {
        return address(team) < address(usdc);
    }

    /// @dev Let the JIT hook's TRUNCATED oracle catch DOWN to the (post-crash) spot. FIX 2a makes the vault
    ///      require a ready oracle to have a live LP; the oracle then also BOUNDS the recover/seniority swap
    ///      (it will not sell into a price that is far below the lagging oracle — the anti-manipulation floor).
    ///      In the flash-crash block that means the recover realizes little, so a redemption in that exact
    ///      window is a LIVENESS (not solvency) shortfall. A realistic redemption happens AFTER the oracle has
    ///      settled. This walks the oracle to spot (roll past the catch-up window + observe the low price each
    ///      round; sweep any JIT the tiny observe-swap opens) so `recoverableUSDC()` (min(spot,oracle)) matches
    ///      what the bounded recover can realize — the condition the pro-rata (R6) waterfall is defined under.
    function _settleOracleToSpot() internal {
        for (uint256 i = 0; i < 12; i++) {
            (int24 oTick,) = hook.oracleTick();
            (, int24 spot,,) = pm.getSlot0(key.toId());
            int256 gap = int256(oTick) - int256(spot);
            if (gap < 0) gap = -gap;
            if (gap <= 500) break; // within the swap band ⇒ recover no longer clamped
            // Roll past the (widened) catch-up window so ONE observe-swap moves the oracle its maximal step
            // toward the current low spot; sweep any JIT the tiny observe-swap opens.
            vm.roll(block.number + uint256(uint32(hook.MAX_ORACLE_CATCHUP())) + 1);
            team.mint(address(this), 1 * ONE);
            team.approve(address(swapRouter), type(uint256).max);
            swapRouter.swap(key, _sellTeamZeroForOne(), 1 * ONE);
            hook.sweepJit();
        }
    }

    // AUDIT #7b: coverage-ratio floor gate. Junior USDC buffer = 5000; senior = 10000 (deploy capped at
    // 2000 by idle-first). The gate halts risk-increasing ops when the junior cushion thins below the floor.

    /// @notice FIX 3 — the coverage floor is now MANDATORY to deploy. The shipped default (0) no longer
    ///         permits an uncushioned deploy: `deployToLP` reverts `CoverageFloorUnset` while the floor is
    ///         off (the CoverageFloorUnset gate is also proven on a fresh vault in RedTeamTrancheInflationRecall).
    ///         The harness arms a 1-bps floor in setUp, under which a covered deploy proceeds normally.
    function test_coverage_floor_required_for_deploy() public {
        // The harness armed a (tiny) floor; the shipped-default 0 is what FIX 3 forbids.
        assertGt(vault.minCoverageBps(), 0, "harness arms the coverage floor (FIX 3: 0 would forbid deploy)");
        assertEq(vault.coverageBps(), type(uint256).max, "no at-risk senior -> max coverage");
        // A covered deploy proceeds (junior USDC buffer amply covers it at the armed floor).
        vault.deployToLP(2_000 * ONE, vault.juniorTokens());
        assertGt(vault.deployedFromSenior(), 0, "covered deploy proceeds under an armed floor");
    }

    function test_coverage_gate_halts_deploy_when_junior_thin() public {
        // Pick the floor from the ACTUAL junior buffer so the test is robust to the harness's exact numbers.
        uint256 buf = vault.juniorUsdcBuffer();
        uint256 jt = vault.juniorTokens(); // hoist: expectRevert must see deployToLP as the NEXT external call
        uint256 dep = 2_000 * ONE;                // the max the idle-first check allows
        uint256 covAtDep = (buf * 10_000) / dep;  // coverage bps this deploy would leave
        assertLe(covAtDep + 1, type(uint16).max, "floor fits uint16");

        // A floor JUST ABOVE that coverage must halt the deploy. RAISING the floor (safety) is instant.
        vault.setMinCoverage(uint16(covAtDep + 1));
        vm.expectRevert(MintwareTreasuryVault.CoverageTooLow.selector);
        vault.deployToLP(dep, jt);

        // LEGAL 48h TIMELOCK: lowering the coverage floor is RISK-INCREASING, so it no longer applies
        // instantly — propose → warp 48h → confirm. (The mock adapter has no time accrual, so the warp is
        // inert for the numbers below.) Then the same deploy goes through.
        vault.setMinCoverage(uint16(covAtDep));
        assertEq(vault.minCoverageBps(), covAtDep + 1, "lower must not apply before the delay");
        vm.warp(vm.getBlockTimestamp() + vault.RISK_PARAM_DELAY() + 1);
        vault.confirmRiskParam(vault.RP_MIN_COVERAGE());
        assertEq(vault.minCoverageBps(), covAtDep, "lower should apply after confirm");
        vault.deployToLP(dep, jt);
        assertGt(vault.deployedFromSenior(), 0, "a covered deploy still proceeds");
    }

    function test_coverageBps_view_tracks_deployed() public {
        assertEq(vault.coverageBps(), type(uint256).max);
        vault.deployToLP(1_000 * ONE, vault.juniorTokens());
        // coverage = juniorUsdcBuffer(5000) * 10000 / deployed(<=1000) >= 50_000 bps.
        assertGe(vault.coverageBps(), 50_000, "junior buffer covers the deployed senior multiple times");
    }

    function test_module_deploys_on_hooked_pool_and_skips_jit_on_its_own_swaps() public {
        // 1. The module deploys senior LP on the HOOKED pool — coexists with the hook.
        uint256 jt = vault.juniorTokens();
        vault.deployToLP(200 * ONE, jt);
        assertGt(vault.deployedFromSenior(), 0, "module could not deploy on the hooked pool");
        assertLe(vault.deployedFromSenior(), vault.recoverableUSDC() + vault.juniorUsdcBuffer(), "invariant");

        // 2. A real trader's team→USDC swap FIRES JIT.
        team.mint(trader, 1_000_000 * ONE);
        vm.startPrank(trader);
        team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, _sellTeamZeroForOne(), 3_000 * ONE);
        vm.stopPrank();
        assertGt(vault.jitBorrowed(), 0, "trader swap did not fire JIT");
        hook.sweepJit();
        assertEq(vault.jitBorrowed(), 0, "sweep did not clear JIT");

        // 3. The MODULE's OWN recover swap (team→USDC) must NOT fire JIT — the skip-sender exemption.
        uint256 deployedBefore = vault.deployedFromSenior();
        vault.recoverFromLP(50 * ONE); // owner → module.recover → team→USDC swap, sender = module
        assertEq(vault.jitBorrowed(), 0, "module's own recover swap must not fire JIT");
        assertLt(vault.deployedFromSenior(), deployedBefore, "recover did not unwind LP");
    }

    /// AUDIT #1 (Cork class): a swap on ANY pool that names this hook but is NOT the canonical pool must
    /// no-op — the hook must never borrow senior USDC to deploy into an attacker-controlled pool. Here the
    /// attacker opens a second pool with the same hook + tokens but a different fee (→ different PoolId).
    function test_nonCanonicalPool_doesNotFireJit() public {
        PoolKey memory evil = PoolKey({
            currency0: key.currency0, currency1: key.currency1, fee: 500, tickSpacing: SPACING, hooks: key.hooks
        });
        pm.initialize(evil, INIT_SQRT_PRICE);

        usdc.mint(address(this), 1_000_000 * ONE);
        team.mint(address(this), 1_000_000 * ONE);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            evil,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 200_000 * int256(uint256(ONE)), salt: bytes32(0)}),
            ""
        );

        // A team→USDC swap on the evil pool: must succeed (no revert = no pool brick) and NOT fire JIT.
        team.mint(trader, 1_000_000 * ONE);
        vm.startPrank(trader);
        team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(evil, _sellTeamZeroForOne(), 3_000 * ONE);
        vm.stopPrank();

        assertEq(vault.jitBorrowed(), 0, "hook fired JIT on a NON-canonical pool (Cork-class hole)");
    }

    /// AUDIT #7: an intra-block spot push must NOT inflate `recoverableUSDC()` (the solvency-invariant
    /// RHS). The truncated oracle is frozen within a block, and valuation is `min(spot, oracle)`, so a
    /// flash manipulation is ignored. Proves the fix at the exact exploit shape.
    function test_spotManipulation_doesNotInflateRecoverable() public {
        uint256 jt = vault.juniorTokens();
        vault.deployToLP(2_000 * ONE, jt);

        // Warm the oracle in a fresh block with a small USDC→team swap (buys team, no JIT). After this the
        // oracle is ready and its lastBlock == the current block, so the manipulation below can't move it.
        vm.roll(block.number + 1);
        team.mint(trader, 500_000_000 * ONE);
        usdc.mint(trader, 500_000_000 * ONE);
        vm.startPrank(trader);
        team.approve(address(swapRouter), type(uint256).max);
        usdc.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, !_sellTeamZeroForOne(), 100 * ONE);
        vm.stopPrank();

        (int24 oTick0, bool ready) = hook.oracleTick();
        assertTrue(ready, "oracle not ready after warmup");
        (, int24 spotBefore,,) = pm.getSlot0(key.toId());
        uint256 rec0 = vault.recoverableUSDC();

        // SAME block: a massive spot push (buy team hard) — a flash manipulation.
        vm.prank(trader);
        swapRouter.swap(key, !_sellTeamZeroForOne(), 2_000_000 * ONE);

        (int24 oTick1,) = hook.oracleTick();
        (, int24 spotAfter,,) = pm.getSlot0(key.toId());
        uint256 rec1 = vault.recoverableUSDC();

        // Sanity: the manipulation really moved spot a lot (either direction)...
        int256 spotMove = int256(spotAfter) - int256(spotBefore);
        uint256 spotMoveMag = spotMove < 0 ? uint256(-spotMove) : uint256(spotMove);
        assertGt(spotMoveMag, 200, "manipulation did not move spot (vacuous test)");
        // ...but the oracle stayed frozen intra-block...
        assertEq(oTick1, oTick0, "oracle moved within the block (freeze broken)");
        // ...so the invariant RHS did NOT inflate.
        assertLe(rec1, rec0 + ONE, "recoverableUSDC inflated by an intra-block spot push (#7 hole)");
    }

    function test_skipSender_is_owner_gated_and_settable() public {
        assertEq(hook.jitSkipSender(), address(vault));
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        hook.setJitSkipSender(address(0xdead));
    }

    /// AUDIT (pre-audit review): `deployToLP` must fund ONLY from senior sources and NEVER draw the junior
    /// USDC buffer. Simulate Aave illiquidity (aTokens exist → `totalAssets` full so the idle-first check
    /// passes, but nothing is withdrawable): the deploy must REVERT rather than convert junior first-loss
    /// capital into senior-counted `deployedFromSenior`. (Pre-fix, `deployToLP` reused the redemption
    /// `_pullUSDC` waterfall and would have silently drawn the junior buffer to fund the deploy.)
    /// AUDIT (pre-audit review): the hook's `beforeInitialize` gates pool init to the hook owner, so a
    /// stranger can't front-run `initialize` (with the mined salt/address visible) to grief the deploy.
    function test_beforeInitialize_gatesPoolInitToOwner() public {
        // A stranger cannot initialize any pool carrying this hook (the canonical pool is already init'd
        // in setUp by the owner; try a different-fee pool with the same hook).
        PoolKey memory other = PoolKey({
            currency0: key.currency0, currency1: key.currency1, fee: 500, tickSpacing: SPACING, hooks: key.hooks
        });
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(); // V4 wraps the hook's UnauthorizedInitializer() in WrappedError; any revert = blocked
        pm.initialize(other, INIT_SQRT_PRICE);
    }

    function test_deployToLP_neverDrawsJuniorBuffer_whenAaveIlliquid() public {
        uint256 jt        = vault.juniorTokens();
        uint256 bufBefore = vault.juniorUsdcBuffer();
        assertGt(bufBefore, 0, "precondition: junior USDC buffer funded");

        adapter.setWithdrawableCap(0); // Aave illiquid: totalAssets full, maxWithdrawable/withdraw = 0

        vm.expectRevert(MintwareTreasuryVault.InsufficientIdleLiquidity.selector);
        vault.deployToLP(200 * ONE, jt);

        assertEq(vault.juniorUsdcBuffer(), bufBefore, "junior buffer must be untouched by a reverted deploy");
        assertEq(vault.deployedFromSenior(), 0, "no senior deployed on a reverted deploy");
    }

    /// Increment 4: the solvency invariant re-proven with JIT LIVE. Across fuzzed swap sizes (and with
    /// the module's LP optionally deployed), a JIT round-trip + sweep leaves the borrow cleared, the
    /// module solvent, and the senior whole-or-up — the junior buffer backstops any JIT close cost.
    function testFuzz_jitLive_keepsSeniorSolvent(uint256 m1, uint256 m2, bool withModuleLp) public {
        if (withModuleLp) {
            uint256 jt = vault.juniorTokens();
            vault.deployToLP(200 * ONE, jt);
        }
        uint256 navBefore = vault.totalSeniorAssets();
        uint256 bufBefore = vault.juniorUsdcBuffer();

        // Bounded so each JIT slice (<=5% of $10k senior = $500) and its close cost stay well inside the
        // $5k junior buffer — i.e. JIT never overshoots the backstop in this regime.
        m1 = bound(m1, 100 * ONE, 40_000 * ONE);
        m2 = bound(m2, 100 * ONE, 40_000 * ONE);

        team.mint(trader, 200_000_000 * ONE);
        usdc.mint(trader, 200_000_000 * ONE);
        vm.startPrank(trader);
        team.approve(address(swapRouter), type(uint256).max);
        usdc.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, _sellTeamZeroForOne(), m1);  // team→USDC — fires JIT
        swapRouter.swap(key, !_sellTeamZeroForOne(), m2); // USDC→team — no JIT
        vm.stopPrank();

        hook.sweepJit();

        // (1) the borrow always reconciles to zero after a sweep.
        assertEq(vault.jitBorrowed(), 0, "JIT borrow not cleared");
        // (2) the module LP stays solvent (junior stack covers the deployed senior par).
        if (withModuleLp) {
            assertLe(vault.deployedFromSenior(), vault.recoverableUSDC() + vault.juniorUsdcBuffer() + 2, "module insolvent under JIT");
        }
        // (3) the junior buffer only ever absorbs (never gains from JIT).
        assertLe(vault.juniorUsdcBuffer(), bufBefore, "junior buffer grew from JIT");
        // (4) the senior is whole-or-up — any JIT close cost came out of the junior first.
        assertGe(vault.totalSeniorAssets() + 3, navBefore, "senior lost value the junior should have covered");
    }

    /// @dev Free SENIOR buffer = vault USDC on hand minus every junior/protocol earmark (mirrors the vault's
    ///      internal `_freeSeniorBuffer`), so the test can bound the redeem NAV from outside the contract.
    function _freeBuffer() internal view returns (uint256) {
        uint256 bal = usdc.balanceOf(address(vault));
        uint256 r = vault.reservedJuniorUSDC() + vault.juniorUsdcBuffer() + vault.reservedProtocolUSDC();
        return bal > r ? bal - r : 0;
    }

    /// AUDIT R5-L1: an outstanding/stranded JIT slice must NOT be counted at PAR in the REDEEM-side NAV.
    /// Deploy a senior LP slice, fire JIT and DELIBERATELY leave it un-swept, then dump team hard (an
    /// adverse move that drops the LP's recoverable USDC). Assert the deployed-at-risk legs — LP par PLUS
    /// the outstanding JIT par — never exceed what is actually recoverable (`recoverableUSDC()` = min(spot,
    /// oracle) LP MTM, which does NOT include the hook's JIT slice) plus the junior USDC first-loss buffer;
    /// and that `seniorRealizableAssets()` (the redeem NAV) is bounded by that recoverable backing. The main
    /// invariant suite runs with JIT off and always sweeps to `jitBorrowed == 0` before asserting, so it
    /// misses exactly this un-swept-slice-across-a-price-move window.
    function testFuzz_R5L1_jit_leg_not_par_in_redeem_nav(uint256 swapSeed, uint256 dumpSeed) public {
        // A live, price-sensitive LP leg so `recoverableUSDC()` moves with the mark.
        uint256 jt = vault.juniorTokens();
        vault.deployToLP(2_000 * ONE, jt);
        assertGt(vault.deployedFromSenior(), 0, "precondition: senior par deployed to the LP");

        // Fire JIT with a real trader team→USDC swap, then DO NOT sweep — the slice stays outstanding.
        uint256 m = bound(swapSeed, 1_000 * ONE, 20_000 * ONE);
        team.mint(trader, 400_000_000 * ONE);
        vm.startPrank(trader);
        team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, _sellTeamZeroForOne(), m); // fires JIT (usdc is the output)
        vm.stopPrank();
        assertGt(vault.jitBorrowed(), 0, "precondition: a JIT slice is outstanding (un-swept)");

        // Adverse move in a later block: dump team hard → the LP's recoverable USDC value falls. The H2
        // one-slice guard means this second team→USDC swap opens NO new slice (borrow no-ops), so the
        // original slice stays outstanding across the price move — exactly the missed window.
        vm.roll(block.number + 1);
        uint256 dump = bound(dumpSeed, 1_000 * ONE, 5_000_000 * ONE);
        team.mint(trader, dump);
        vm.prank(trader);
        swapRouter.swap(key, _sellTeamZeroForOne(), dump);

        // Extended solvency invariant — both at-risk legs bounded by the recoverable backing.
        assertLe(
            vault.deployedFromSenior() + vault.jitBorrowed(),
            vault.recoverableUSDC() + vault.juniorUsdcBuffer() + 2,
            "R5-L1: deployed+JIT par exceeds recoverable backing while a JIT slice is stranded"
        );
        // The redeem NAV must value the at-risk legs at what's recoverable — never adding the JIT leg at par.
        assertLe(
            vault.seniorRealizableAssets(),
            adapter.totalAssets() + _freeBuffer() + vault.recoverableUSDC() + vault.juniorUsdcBuffer() + 2,
            "R5-L1: redeem NAV exceeds recoverable backing (JIT leg still counted at par)"
        );
    }

    // ── AUDIT R2-H2: a stuck `jitBorrowed` (the strand) is recoverable ──────────────────────────────
    //
    // The strand: a fully-utilized JIT slice leaves `jitBorrowed` outstanding; if the keeper sweep can't
    // convert the team leg (oracle band) it never returns USDC, so `settleJitReturn` never runs and
    // `jitBorrowed` stays outstanding — disabling ALL future JIT (one-slice-at-a-time guard) and counting a
    // phantom slice at par in the senior NAV. The fix adds an owner `forceSettleJit()` escape hatch (and a
    // sweep that retries while physical remains). This proves the owner backstop recovers the strand.
    function test_R2H2_forceSettleJit_recovers_stuck_borrow() public {
        // Fire JIT with a real trader swap → jitBorrowed > 0.
        team.mint(trader, 1_000_000 * ONE);
        vm.startPrank(trader);
        team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, _sellTeamZeroForOne(), 3_000 * ONE);
        vm.stopPrank();
        uint256 stuck = vault.jitBorrowed();
        assertGt(stuck, 0, "precondition: a JIT slice is outstanding");

        // SIMULATE THE STRAND: do NOT sweep. While jitBorrowed is outstanding, all future JIT is disabled —
        // a second trader swap cannot borrow (one-slice-at-a-time), so the vault is stuck.
        vm.roll(block.number + 1);
        vm.startPrank(trader);
        swapRouter.swap(key, _sellTeamZeroForOne(), 3_000 * ONE);
        vm.stopPrank();
        assertEq(vault.jitBorrowed(), stuck, "stuck: future JIT stayed disabled while borrow outstanding");

        uint256 bufBefore = vault.juniorUsdcBuffer();

        // The owner force-settles the stuck slice — junior first-loss absorbs it, borrow clears.
        vault.forceSettleJit();
        assertEq(vault.jitBorrowed(), 0, "R2-H2: forceSettleJit did not clear the stuck borrow");
        assertLe(vault.juniorUsdcBuffer(), bufBefore, "junior should have absorbed (not gained)");
        assertApproxEqAbs(vault.juniorUsdcBuffer(), bufBefore - stuck, 1, "junior absorbed the outstanding slice");

        // RECOVERED: JIT re-enables — a fresh trader swap fires JIT again.
        vm.roll(block.number + 1);
        vm.startPrank(trader);
        swapRouter.swap(key, _sellTeamZeroForOne(), 3_000 * ONE);
        vm.stopPrank();
        assertGt(vault.jitBorrowed(), 0, "R2-H2: JIT did not re-enable after recovery");
    }

    /// forceSettleJit is owner-gated and a no-op when nothing is outstanding.
    function test_R2H2_forceSettleJit_onlyOwner_and_noop_when_clear() public {
        assertEq(vault.jitBorrowed(), 0, "nothing outstanding");
        vault.forceSettleJit(); // no-op, no revert
        assertEq(vault.jitBorrowed(), 0, "still nothing outstanding");

        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        vault.forceSettleJit();
    }
}
