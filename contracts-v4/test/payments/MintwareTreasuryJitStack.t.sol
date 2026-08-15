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
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {HookMiner}                 from "../../src/lib/HookMiner.sol";
import {MintwareTreasuryVault}     from "../../src/payments/MintwareTreasuryVault.sol";
import {MintwareV4LiquidityModule} from "../../src/payments/MintwareV4LiquidityModule.sol";
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
    MintwareV4LiquidityModule internal module;
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
        vault = new MintwareTreasuryVault(address(usdc), address(team), address(adapter), address(this), teamAddr);

        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));

        // Mirror DeployTreasuryV2: mine the hook, open the pool WITH it, wire the module + skip-sender.
        PoolKey memory ctorKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        bytes memory args = abi.encode(address(pm), ctorKey, address(usdc), address(vault), address(this));
        (address hookAddr, bytes32 salt) =
            HookMiner.find(address(this), uint160(0xC0), type(MintwareTreasuryJitHook).creationCode, args);
        hook = new MintwareTreasuryJitHook{salt: salt}(address(pm), ctorKey, address(usdc), address(vault), address(this));
        require(address(hook) == hookAddr, "hook addr");

        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(hookAddr)});
        pm.initialize(key, INIT_SQRT_PRICE);

        module = new MintwareV4LiquidityModule(address(pm), key, address(usdc), address(vault), address(this));
        vault.setLiquidityModule(address(module));
        vault.setJitHook(address(hook));
        hook.setJitSkipSender(address(module));

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
    }

    function _sellTeamZeroForOne() internal view returns (bool) {
        return address(team) < address(usdc);
    }

    function test_module_deploys_on_hooked_pool_and_skips_jit_on_its_own_swaps() public {
        // 1. The module deploys senior LP on the HOOKED pool — coexists with the hook.
        uint256 jt = vault.juniorTokens();
        vault.deployToLP(200 * ONE, jt);
        assertGt(vault.deployedFromSenior(), 0, "module could not deploy on the hooked pool");
        assertLe(vault.deployedFromSenior(), module.recoverableUSDC() + vault.juniorUsdcBuffer(), "invariant");

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
        uint256 rec0 = module.recoverableUSDC();

        // SAME block: a massive spot push (buy team hard) — a flash manipulation.
        vm.prank(trader);
        swapRouter.swap(key, !_sellTeamZeroForOne(), 2_000_000 * ONE);

        (int24 oTick1,) = hook.oracleTick();
        (, int24 spotAfter,,) = pm.getSlot0(key.toId());
        uint256 rec1 = module.recoverableUSDC();

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
        assertEq(hook.jitSkipSender(), address(module));
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        hook.setJitSkipSender(address(0xdead));
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
            assertLe(vault.deployedFromSenior(), module.recoverableUSDC() + vault.juniorUsdcBuffer() + 2, "module insolvent under JIT");
        }
        // (3) the junior buffer only ever absorbs (never gains from JIT).
        assertLe(vault.juniorUsdcBuffer(), bufBefore, "junior buffer grew from JIT");
        // (4) the senior is whole-or-up — any JIT close cost came out of the junior first.
        assertGe(vault.totalSeniorAssets() + 3, navBefore, "senior lost value the junior should have covered");
    }
}
