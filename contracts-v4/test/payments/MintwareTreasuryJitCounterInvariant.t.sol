// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test}         from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {PoolManager}           from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary}          from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {HookMiner}               from "../../src/lib/HookMiner.sol";
import {MintwareTreasuryVault}   from "../../src/payments/MintwareTreasuryVault.sol";
import {MintwareTreasuryJitHook} from "../../src/payments/MintwareTreasuryJitHook.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @dev A DELIBERATELY-BROKEN hook for the anti-vacuity teeth check: it NEUTERS the non-deferrable ETH
///      unwind (`_zeroCounterEthDebt` is a no-op), so the ETH owed on close is never realized/converted and
///      a nonzero ETH transient delta is left open. The hook's own `require("eth debt")` (and, failing that,
///      PoolManager's `CurrencyNotSettled`) then reverts the trader's swap — proving the synchronous unwind
///      is load-bearing, i.e. the clean run's delta-conservation is NOT vacuous.
contract LeakyTreasuryJitHook is MintwareTreasuryJitHook {
    constructor(address pm_, PoolKey memory key_, address usdc_, address vault_, address owner_)
        MintwareTreasuryJitHook(pm_, key_, usdc_, vault_, owner_) {}

    function _zeroCounterEthDebt(Currency) internal override {
        // leak: skip repaying the ETH flash debt → leaves a nonzero ETH delta open.
    }
}

/// @notice Adversarial handler for the Phase-2 counter-asset (ETH) JIT leg on the treasury-anchored ULV,
///         against a REAL Uniswap-V4 pool. Every `counterRound` fires the NEW `_openCounter`→swap→
///         `_closeCounter` path (a USDC->ETH->USDC round trip inside one swap unlock) and then sweeps; a
///         `singleRound` exercises the shipped single-sided leg alongside it (both share the one-slice
///         serialization). Ghosts witness that the round trip conserves USDC, never inflates senior NAV,
///         and lets the junior — never the senior — absorb the round-trip cost.
contract JitCounterHandler is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    MintwareTreasuryVault   public vault;
    MintwareTreasuryJitHook public hook;
    MockYieldAdapter        public adapter;
    MockERC20               public usdc;
    MockERC20               public team; // the counter asset (ETH stand-in), 6dp
    TestSwapRouter          public swapRouter;
    PoolKey                 public key;
    bool                    public teamIs0;
    address                 public owner;
    address[]               public actors;

    uint256 internal constant ONE = 1e6;
    uint256 internal constant WHOLE_TOL = 1_000; // 0.001 USDC — senior "whole-or-up" rounding slack

    // ── ghosts ──────────────────────────────────────────────────────────────────
    uint256 public counterFired;  // # rounds the COUNTER leg actually borrowed (non-vacuity witness)
    uint256 public singleFired;    // # rounds the single-sided leg borrowed
    uint256 public totalYieldMinted;
    bool    public juniorGrewFromJit; // set if the junior buffer ever GREW across a JIT round (breach)
    bool    public seniorDipped;      // set if senior NAV dropped past tol across a round (breach)

    constructor(
        MintwareTreasuryVault v, MintwareTreasuryJitHook h, MockYieldAdapter a,
        MockERC20 u, MockERC20 t, TestSwapRouter r, PoolKey memory k, bool t0,
        address o, address[] memory acts
    ) {
        vault = v; hook = h; adapter = a; usdc = u; team = t; swapRouter = r;
        key = k; teamIs0 = t0; owner = o; actors = acts;
        usdc.approve(address(swapRouter), type(uint256).max);
        team.approve(address(swapRouter), type(uint256).max);
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[bound(seed, 0, actors.length - 1)];
    }

    // ── the COUNTER leg: trader BUYS ETH (USDC in) → fires _openCounter → sweep ──────
    function counterRound(uint256 seed) public {
        uint256 amtIn = bound(seed, 100 * ONE, 5_000 * ONE);
        uint256 navBefore = vault.totalSeniorAssets();
        uint256 bufBefore = vault.juniorUsdcBuffer();
        bool zeroForOne = !teamIs0; // sell USDC = buy ETH(team)
        try swapRouter.swap(key, zeroForOne, amtIn) {
            if (vault.jitBorrowed() > 0) counterFired++;
        } catch {}
        try hook.sweepJit() returns (uint256) {} catch {}
        _postRoundGhosts(navBefore, bufBefore);
    }

    // ── the single-sided leg: trader SELLS ETH (ETH in) → fires _open → sweep ────────
    function singleRound(uint256 seed) public {
        uint256 amtIn = bound(seed, 100 * ONE, 5_000 * ONE);
        uint256 navBefore = vault.totalSeniorAssets();
        uint256 bufBefore = vault.juniorUsdcBuffer();
        bool zeroForOne = teamIs0; // sell ETH(team) = buy USDC
        try swapRouter.swap(key, zeroForOne, amtIn) {
            if (vault.jitBorrowed() > 0) singleFired++;
        } catch {}
        try hook.sweepJit() returns (uint256) {} catch {}
        _postRoundGhosts(navBefore, bufBefore);
    }

    function _postRoundGhosts(uint256 navBefore, uint256 bufBefore) internal {
        // The junior buffer only ever ABSORBS (a profit re-idles to the senior, not the buffer).
        if (vault.juniorUsdcBuffer() > bufBefore) juniorGrewFromJit = true;
        // The senior is whole-or-up after a full round — the junior covered any round-trip cost.
        if (vault.totalSeniorAssets() + WHOLE_TOL < navBefore) seniorDipped = true;
    }

    function seniorDeposit(uint256 aSeed, uint256 amtSeed) public {
        address a = _actor(aSeed);
        uint256 amt = bound(amtSeed, 1_000_000, 200_000_000_000); // $1 .. $200k
        vm.prank(a);
        try vault.depositUSDC(amt, 0, a) {} catch {}
    }

    function seniorRedeem(uint256 aSeed, uint256 shareSeed) public {
        address a = _actor(aSeed);
        uint256 bal = vault.seniorShares(a);
        if (bal == 0) return;
        uint256 s = bound(shareSeed, 1, bal);
        vm.prank(a);
        try vault.redeemSenior(s, 0) {} catch {}
    }

    function deployToLP(uint256 seed) public {
        uint256 base = vault.totalSeniorAssets();
        uint256 tgt = vault.idleBufferTargetBps();
        uint256 minIdle = (base * tgt + 10_000 - 1) / 10_000;
        uint256 deployed = vault.deployedFromSenior();
        if (base <= minIdle || deployed >= base - minIdle) return;
        uint256 room = base - minIdle - deployed;
        if (room < 1_000_000) return;
        uint256 amt = bound(seed, 1_000_000, room);
        vm.prank(owner);
        try vault.deployToLP(amt, vault.juniorTokens()) {} catch {}
    }

    function aaveYield(uint256 seed) public {
        uint256 amt = bound(seed, 1_000_000, 20_000_000_000);
        usdc.mint(address(adapter), amt);
        totalYieldMinted += amt;
    }

    function warp(uint256 seed) public {
        vm.warp(vm.getBlockTimestamp() + bound(seed, 1 hours, 1 days));
        vm.roll(block.number + 1); // fresh block so the per-block JIT cap resets (more rounds fire)
    }
}

/// @notice THE COUNTER-LEG GATE — the delta-conservation proof for the Phase-2 ETH leg at 256×128,000, 0
///         reverts, against a REAL Uniswap-V4 pool. Proves across fuzzed USDC->ETH->USDC round trips (mixed
///         with the single-sided leg, senior deposits/redeems, LP deploys, and Aave yield):
///           (a) senior NAV is never inflated by the round trip (the price-free accounting identity holds);
///           (b) USDC is conserved (no value fabricated by the two internal swaps);
///           (c) the junior buffer — never the senior — absorbs any shortfall (par-covered + whole-or-up);
///           (d) the borrow always reconciles to zero after the sweep.
///         `afterInvariant` asserts the counter leg ACTUALLY fired (non-vacuity), and `LeakyTreasuryJitHook`
///         (below) proves the synchronous unwind is load-bearing — neuter it and the round reverts.
contract MintwareTreasuryJitCounterInvariantTest is StdInvariant, Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    PoolManager             internal pm;
    TestSwapRouter          internal swapRouter;
    PoolModifyLiquidityTest internal lpRouter;

    MintwareTreasuryVault   internal vault;
    MintwareTreasuryJitHook internal hook;
    MockYieldAdapter        internal adapter;
    MockERC20               internal usdc;
    MockERC20               internal team;
    JitCounterHandler       internal handler;
    PoolKey                 internal key;
    bool                    internal teamIs0;

    address   internal owner = makeAddr("owner");
    address   internal teamAddr = makeAddr("team");
    address[] internal actors;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant ONE = 1e6;
    uint256 internal constant JUNIOR_USDC_SEED = 50_000_000_000; // $50k first-loss buffer
    uint256 internal constant DUST = 100_000; // 0.1 USDC coverage rounding slack

    uint256 internal initialUsdcMinted;

    function _mintUsdc(address to, uint256 amt) internal { usdc.mint(to, amt); initialUsdcMinted += amt; }

    function setUp() public {
        pm         = new PoolManager(address(this));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));

        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Wrapped ETH", "ETH", 6); // counter asset, 6dp for a clean 1:1 pool
        teamIs0 = address(team) < address(usdc);
        adapter = new MockYieldAdapter(address(usdc));

        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));

        PoolKey memory ctorKey = PoolKey({
            currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: SPACING, hooks: IHooks(address(0))
        });
        address predictedVault = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        bytes memory hookArgs = abi.encode(address(pm), ctorKey, address(usdc), predictedVault, address(this));
        (address hookAddr, bytes32 hookSalt) =
            HookMiner.find(address(this), uint160(0x20C8), type(MintwareTreasuryJitHook).creationCode, hookArgs);
        hook = new MintwareTreasuryJitHook{salt: hookSalt}(address(pm), ctorKey, address(usdc), predictedVault, address(this));
        require(address(hook) == hookAddr, "hook addr");

        key = PoolKey({
            currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: SPACING, hooks: IHooks(hookAddr)
        });
        vault = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, teamAddr);
        require(address(vault) == predictedVault, "vault addr prediction");

        pm.initialize(key, INIT_SQRT_PRICE);

        // Wire JIT + ENABLE the counter leg (the Phase-2 gate). Both legs live: single-sided fires on the
        // sell-ETH direction, the counter leg on buy-ETH. Thresholds 0 so every fuzzed swap can fire.
        vm.prank(owner);
        vault.setJitHook(address(hook));
        vm.prank(owner);
        vault.setJitCounterEnabled(true);

        // team commits the junior first-loss reserve (team ETH + a stable USDC buffer) and opens the vault.
        team.mint(teamAddr, 5_000_000 * ONE);
        _mintUsdc(teamAddr, JUNIOR_USDC_SEED);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(5_000_000 * ONE, JUNIOR_USDC_SEED, 365 days);
        vm.stopPrank();

        // Deep baseline pool liquidity so the internal seed/unwind swaps + the trader's swap all settle.
        _mintUsdc(address(this), 50_000_000 * ONE);
        team.mint(address(this), 50_000_000 * ONE);
        usdc.approve(address(lpRouter), type(uint256).max);
        team.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 40_000_000 * int256(uint256(ONE)), salt: bytes32(0)}),
            ""
        );

        actors = new address[](3);
        for (uint256 i = 0; i < 3; i++) {
            address a = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors[i] = a;
            _mintUsdc(a, 1e30);
            vm.prank(a);
            usdc.approve(address(vault), type(uint256).max);
        }
        // seed senior capital so there is Aave idle to lend to the JIT legs from block 0.
        for (uint256 i = 0; i < 2; i++) {
            vm.prank(actors[i]);
            vault.depositUSDC(100_000_000_000, 0, actors[i]); // $100k each
        }

        handler = new JitCounterHandler(vault, hook, adapter, usdc, team, swapRouter, key, teamIs0, owner, actors);
        _mintUsdc(address(handler), 1_000_000_000 * ONE);
        team.mint(address(handler), 1_000_000_000 * ONE);

        bytes4[] memory sels = new bytes4[](7);
        sels[0] = JitCounterHandler.counterRound.selector;
        sels[1] = JitCounterHandler.singleRound.selector;
        sels[2] = JitCounterHandler.seniorDeposit.selector;
        sels[3] = JitCounterHandler.seniorRedeem.selector;
        sels[4] = JitCounterHandler.deployToLP.selector;
        sels[5] = JitCounterHandler.aaveYield.selector;
        sels[6] = JitCounterHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        targetContract(address(handler));
    }

    function _freeBuffer() internal view returns (uint256) {
        uint256 bal = usdc.balanceOf(address(vault));
        uint256 r = vault.reservedJuniorUSDC() + vault.juniorUsdcBuffer() + vault.reservedProtocolUSDC();
        return bal > r ? bal - r : 0;
    }

    /// @notice NON-VACUITY: the fuzz actually fired the counter leg (and the single-sided one) — otherwise
    ///         the conservation proof below would be trivially true against a dormant path.
    function afterInvariant() public view {
        assertGt(handler.counterFired(), 0, "counter (ETH) leg never fired - proof is vacuous");
        assertGt(handler.singleFired(), 0, "single-sided leg never fired");
    }

    // (a) senior NAV is the price-free accounting identity — no ETH / round-trip value can leak into it.
    function invariant_counter_price_free() public view {
        assertEq(
            vault.totalSeniorAssets(),
            adapter.totalAssets() + _freeBuffer() + vault.deployedFromSenior() + vault.jitBorrowed(),
            "senior NAV identity broke (round-trip value leaked into senior NAV)"
        );
    }

    // (b) USDC is conserved — the two internal swaps + the deferred claim never fabricate or destroy value.
    function invariant_counter_usdc_conserved() public view {
        assertEq(
            usdc.totalSupply(),
            initialUsdcMinted + handler.totalYieldMinted(),
            "USDC conservation broke across the USDC->ETH->USDC round trip"
        );
    }

    // (c) the junior stack (recoverable LP USDC + first-loss buffer) always covers the deployed senior par.
    function invariant_counter_senior_par_covered() public view {
        assertLe(
            vault.deployedFromSenior(),
            vault.recoverableUSDC() + vault.juniorUsdcBuffer() + DUST,
            "deployed senior par exceeds the junior stack under the counter leg"
        );
    }

    // (c) the junior — never the senior — absorbs the round-trip cost.
    function invariant_counter_junior_absorbs() public view {
        assertFalse(handler.juniorGrewFromJit(), "junior buffer grew from a JIT round (accounting error)");
        assertFalse(handler.seniorDipped(), "senior NAV dipped - the junior should have absorbed the cost");
    }

    // no share inflation (the solvency-by-construction crux carries over unchanged).
    function invariant_counter_no_share_inflation() public view {
        assertLe(vault.totalSeniorShares(), vault.totalSeniorAssets(), "shares > assets");
        uint256 sum;
        for (uint256 i = 0; i < actors.length; i++) sum += vault.seniorShares(actors[i]);
        assertEq(sum, vault.totalSeniorShares(), "phantom shares");
    }

    // (d) each round sweeps in-call, so the borrow always reconciles to zero between calls.
    function invariant_counter_jit_reconciles() public view {
        assertEq(vault.jitBorrowed(), 0, "jitBorrowed not reconciled to zero after the round + sweep");
    }
}

/// @notice Focused (non-fuzz) coverage of the counter leg: a clean round reconciles + keeps the senior
///         whole, and the ANTI-VACUITY TEETH — neutering the non-deferrable ETH unwind (`LeakyTreasuryJitHook`)
///         reverts the trader's swap, proving the invariant suite's clean pass is not vacuous.
contract MintwareTreasuryJitCounterTeethTest is Test {
    using PoolIdLibrary for PoolKey;

    PoolManager             internal pm;
    TestSwapRouter          internal swapRouter;
    PoolModifyLiquidityTest internal lpRouter;
    MockERC20               internal usdc;
    MockERC20               internal team;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336;
    int24   internal constant SPACING = 60;
    uint256 internal constant ONE = 1e6;

    address internal teamAddr = makeAddr("team");
    address internal userA    = makeAddr("userA");
    address internal trader   = makeAddr("trader");

    function _tokensAndPool() internal returns (Currency c0, Currency c1) {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Wrapped ETH", "ETH", 6);
        (c0, c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
    }

    /// @dev Stand up a wired treasury vault + counter-enabled hook. `useLeaky` swaps in the broken hook.
    function _stand(bool useLeaky)
        internal
        returns (MintwareTreasuryVault vault, MintwareTreasuryJitHook hook, PoolKey memory key, bool teamIs0)
    {
        pm         = new PoolManager(address(this));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        (Currency c0, Currency c1) = _tokensAndPool();
        teamIs0 = address(team) < address(usdc);
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));

        PoolKey memory ctorKey = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(address(0))});
        address predictedVault = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        bytes memory args = abi.encode(address(pm), ctorKey, address(usdc), predictedVault, address(this));
        bytes memory code = useLeaky ? type(LeakyTreasuryJitHook).creationCode : type(MintwareTreasuryJitHook).creationCode;
        (address hookAddr, bytes32 salt) = HookMiner.find(address(this), uint160(0x20C8), code, args);
        hook = useLeaky
            ? MintwareTreasuryJitHook(payable(address(new LeakyTreasuryJitHook{salt: salt}(address(pm), ctorKey, address(usdc), predictedVault, address(this)))))
            : new MintwareTreasuryJitHook{salt: salt}(address(pm), ctorKey, address(usdc), predictedVault, address(this));
        require(address(hook) == hookAddr, "hook addr");

        key = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: SPACING, hooks: IHooks(hookAddr)});
        vault = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), address(this), teamAddr);
        require(address(vault) == predictedVault, "vault addr");
        pm.initialize(key, INIT_SQRT_PRICE);

        vault.setJitHook(address(hook));
        vault.setJitCounterEnabled(true);

        team.mint(teamAddr, 1_000_000 * ONE);
        usdc.mint(teamAddr, 50_000 * ONE);
        vm.startPrank(teamAddr);
        team.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vault.commitTeam(1_000_000 * ONE, 50_000 * ONE, 365 days);
        vm.stopPrank();

        usdc.mint(userA, 100_000 * ONE);
        vm.startPrank(userA);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(100_000 * ONE, 0, userA);
        vm.stopPrank();

        usdc.mint(address(this), 50_000_000 * ONE);
        team.mint(address(this), 50_000_000 * ONE);
        usdc.approve(address(lpRouter), type(uint256).max);
        team.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(key, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 5_000_000 * int256(uint256(ONE)), salt: bytes32(0)}), "");
    }

    /// buy ETH = sell USDC. zeroForOne is true iff USDC is currency0 (i.e. team is NOT currency0).
    function _buyEth(bool teamIs0, PoolKey memory key, uint256 amtIn) internal {
        usdc.mint(trader, amtIn);
        vm.startPrank(trader);
        usdc.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, !teamIs0, amtIn);
        vm.stopPrank();
    }

    /// A clean counter round: the leg fires, the ETH is unwound synchronously, and after the sweep the
    /// borrow is reconciled and the senior is whole-or-up (the junior absorbed any round-trip cost).
    function test_counterRound_firesAndReconciles() public {
        (MintwareTreasuryVault vault, MintwareTreasuryJitHook hook, PoolKey memory key, bool teamIs0) = _stand(false);
        uint256 navBefore = vault.totalSeniorAssets();
        uint256 bufBefore = vault.juniorUsdcBuffer();

        _buyEth(teamIs0, key, 2_000 * ONE);
        assertGt(vault.jitBorrowed(), 0, "counter leg did not fire on a buy-ETH swap");
        // NAV preserved through the open (the borrow is counted at par).
        assertApproxEqAbs(vault.totalSeniorAssets(), navBefore, 2, "senior NAV moved while the counter leg was open");

        hook.sweepJit();
        assertEq(vault.jitBorrowed(), 0, "borrow not reconciled after sweep");
        assertLe(vault.juniorUsdcBuffer(), bufBefore, "junior buffer grew from a JIT round");
        assertGe(vault.totalSeniorAssets() + 1_000, navBefore, "senior not made whole");
        // No ETH stranded in the hook — the unwind converted it all back to USDC.
        assertEq(team.balanceOf(address(hook)), 0, "ETH stranded in the hook after the round");
    }

    /// A swap that BUYS USDC (sells ETH) still takes the shipped single-sided leg (output = USDC), even with
    /// the counter leg enabled — the counter branch is gated to `!usdcIsOutput`. Both legs coexist and each
    /// reconciles. Proves the branch selection + no single-sided regression under a counter-enabled vault.
    function test_sellEth_takesSingleSidedNotCounter() public {
        (MintwareTreasuryVault vault, MintwareTreasuryJitHook hook, PoolKey memory key, bool teamIs0) = _stand(false);
        team.mint(trader, 2_000 * ONE);
        vm.startPrank(trader);
        team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, teamIs0, 2_000 * ONE); // sell ETH → output USDC → single-sided leg
        vm.stopPrank();
        assertGt(vault.jitBorrowed(), 0, "single-sided leg did not fire");
        assertGt(hook.usdcClaim() + hook.teamClaim(), 0, "single-sided path minted no claim");
        hook.sweepJit();
        assertEq(vault.jitBorrowed(), 0, "not reconciled");
    }

    /// TEETH: with the ETH unwind neutered (`LeakyTreasuryJitHook`), the ETH flash debt is left open, so the
    /// hook's own `require("eth debt")` / PoolManager's `CurrencyNotSettled` REVERTS the trader's swap. This
    /// proves the synchronous unwind + delta-conservation is load-bearing — the clean fuzz pass is not vacuous.
    function test_teeth_neuteredUnwind_revertsTheSwap() public {
        (, , PoolKey memory key, bool teamIs0) = _stand(true); // leaky hook
        usdc.mint(trader, 2_000 * ONE);
        vm.startPrank(trader);
        usdc.approve(address(swapRouter), type(uint256).max);
        vm.expectRevert(); // wrapped hook revert (eth debt) or CurrencyNotSettled — any revert = teeth bite
        swapRouter.swap(key, !teamIs0, 2_000 * ONE);
        vm.stopPrank();
    }

    /// CONTROL for the teeth: the SAME swap on the correct hook succeeds (fires + reconciles). Confirms the
    /// teeth failure above is caused by the neutered unwind, not by the swap itself being infeasible.
    function test_teeth_control_correctHookDoesNotRevert() public {
        (MintwareTreasuryVault vault, MintwareTreasuryJitHook hook, PoolKey memory key, bool teamIs0) = _stand(false);
        _buyEth(teamIs0, key, 2_000 * ONE);
        assertGt(vault.jitBorrowed(), 0, "counter leg should have fired on the correct hook");
        hook.sweepJit();
        assertEq(vault.jitBorrowed(), 0, "reconciled");
    }
}
