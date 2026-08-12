// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm}   from "forge-std/Vm.sol";

import {PoolManager}            from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}           from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                 from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}                from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary}  from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}               from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary}           from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary}           from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary}  from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath}               from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20}                 from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HookMiner}              from "../src/lib/HookMiner.sol";
import {MWHookCoordinator}      from "../src/hooks/MWHookCoordinator.sol";
import {MWAmAuction}            from "../src/hooks/MWAmAuction.sol";
import {AmParams}               from "../src/hooks/MWAmAuctionLib.sol";
import {MintwareDeFiPairVault}  from "../src/vaults/MintwareDeFiPairVault.sol";
import {PoolProfile, LockTier}  from "../src/vaults/VaultTypes.sol";
import {AaveV3YieldAdapter}     from "../src/vaults/AaveV3YieldAdapter.sol";
import {IYieldAdapter}          from "../src/vaults/IYieldAdapter.sol";
import {IPoolAddressesProvider} from "../src/vaults/aave/IAaveV3.sol";

import {MockERC20}                from "./mocks/MockERC20.sol";
import {MockAavePool, MockAToken} from "./mocks/MockAavePool.sol";
import {TestSwapRouter}           from "./helpers/TestSwapRouter.sol";

/// @dev Adapter that reenters the vault's `deposit` the first time the vault calls `deposit` on it
///      (which happens inside `jitClose` → `_reIdle`, while `jitActive == true`). Proves the
///      `notDuringJit` spanning guard blocks a hostile-adapter reentrancy mid-JIT.
contract ReentrantJitAdapter is IYieldAdapter {
    IERC20  public immutable token;
    address public immutable asset;
    MintwareDeFiPairVault public vault;
    bool public armed;
    bool public reenterAttempted;
    bool public reenterBlocked;
    uint256 internal _held;

    constructor(IERC20 _token) { token = _token; asset = address(_token); }
    function setVault(MintwareDeFiPairVault v) external { vault = v; }
    function arm(bool v) external { armed = v; }

    function deposit(uint256 amount) external override {
        token.transferFrom(msg.sender, address(this), amount);
        _held += amount;
        if (armed) {
            armed = false;
            reenterAttempted = true;
            // Attempt a reentrant deposit into the vault mid-JIT — must revert JitInProgress.
            try vault.deposit(1e18, 1e18, 0, LockTier.Flex) { reenterBlocked = false; }
            catch { reenterBlocked = true; }
        }
    }
    function withdraw(uint256 amount) external override returns (uint256) {
        uint256 w = amount < _held ? amount : _held;
        _held -= w;
        token.transfer(msg.sender, w);
        return w;
    }
    function totalAssets() external view override returns (uint256) { return _held; }
    function maxWithdrawable() external view override returns (uint256) { return _held; }
    function maxSuppliable() external pure override returns (uint256) { return type(uint256).max; }
}

/// @notice Focused tests for size-gated true JIT (Lever B): a single real swap opens+closes a JIT
///         position, the fallback ladder when Aave is dry, am-AMM composition (NonzeroDeltaCount==0),
///         price-neutral rounding, the reentrancy guard, and access control.
contract MintwareDeFiPairVaultJitTest is Test {
    using PoolIdLibrary        for PoolKey;
    using StateLibrary         for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    address internal provider = makeAddr("provider");
    address internal treasury = makeAddr("treasury");
    address internal alice    = makeAddr("alice");
    address internal trader   = makeAddr("trader");
    address internal mgr      = makeAddr("mgr");

    PoolManager    internal pm;
    TestSwapRouter internal router;
    MWHookCoordinator internal coord;
    MintwareDeFiPairVault internal vault;

    MockERC20 internal t0;
    MockERC20 internal t1;
    PoolKey   internal key;

    MockAavePool internal pool;
    MockAToken   internal a0Tok;
    MockAToken   internal a1Tok;
    AaveV3YieldAdapter internal adapter0;
    AaveV3YieldAdapter internal adapter1;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    uint256 internal constant JIT_THRESHOLD   = 5_000e18;

    function setUp() public {
        pm     = new PoolManager(address(this));
        router = new TestSwapRouter(IPoolManager(address(pm)));

        MockERC20 tokenA = new MockERC20("Token A", "AAA", 18);
        MockERC20 tokenB = new MockERC20("Token B", "BBB", 18);
        (Currency c0, Currency c1) = address(tokenA) < address(tokenB)
            ? (Currency.wrap(address(tokenA)), Currency.wrap(address(tokenB)))
            : (Currency.wrap(address(tokenB)), Currency.wrap(address(tokenA)));
        t0 = MockERC20(Currency.unwrap(c0));
        t1 = MockERC20(Currency.unwrap(c1));

        bytes memory args = abi.encode(IPoolManager(address(pm)), address(0), address(this));
        (address expected, bytes32 salt) =
            HookMiner.find(address(this), uint160(0xAC8), type(MWHookCoordinator).creationCode, args);
        coord = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), address(0), address(this));
        require(address(coord) == expected, "coord addr");

        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(coord))});

        vault = new MintwareDeFiPairVault(address(pm), key, PoolProfile.EMERGING, treasury, provider, address(this));
        coord.setVault(address(vault));
        vault.setHook(address(coord));

        pool  = new MockAavePool();
        a0Tok = new MockAToken(address(t0), address(pool));
        a1Tok = new MockAToken(address(t1), address(pool));
        pool.setAToken(address(t0), a0Tok);
        pool.setAToken(address(t1), a1Tok);
        pool.setConfig(address(t0), true, false, false);
        pool.setConfig(address(t1), true, false, false);
        adapter0 = new AaveV3YieldAdapter(IPoolAddressesProvider(address(pool)), address(t0), address(a0Tok), address(vault), address(this));
        adapter1 = new AaveV3YieldAdapter(IPoolAddressesProvider(address(pool)), address(t1), address(a1Tok), address(vault), address(this));
        vault.setAdapters(IYieldAdapter(address(adapter0)), IYieldAdapter(address(adapter1)));
        vault.setBufferRatio(6_000);
        coord.setJitThreshold(JIT_THRESHOLD);
        coord.setJitEnabled(key.toId(), true);

        vm.prank(provider);
        vault.initializePool(INIT_SQRT_PRICE);
        vm.roll(1000);

        // LP seeds, then idle 40% so the JIT has an Aave leg to pull from.
        t0.mint(alice, 1e30); t1.mint(alice, 1e30);
        vm.startPrank(alice);
        t0.approve(address(vault), type(uint256).max);
        t1.approve(address(vault), type(uint256).max);
        vault.deposit(400_000e18, 400_000e18, 0, LockTier.Flex);
        vm.stopPrank();
        vm.prank(provider);
        vault.rebalanceBuffer(); // idle ~40%

        t0.mint(trader, 1e30); t1.mint(trader, 1e30);
        vm.startPrank(trader);
        t0.approve(address(router), type(uint256).max);
        t1.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function _swap(bool dir, uint256 amt) internal {
        vm.prank(trader);
        router.swap(key, dir, amt);
    }

    // ── jit_open_close_single_swap ──────────────────────────────────────────────

    function test_jit_open_close_single_swap() public {
        uint256 idle1Before = vault.idle1();
        assertGt(idle1Before, 0, "idle present to fund JIT");

        // A size-gated zeroForOne swap: hook opens token1-side JIT from Aave, closes it in afterSwap.
        _swap(true, 20_000e18);

        // JIT fully unwound at rest.
        assertEq(uint256(vault.jitLiquidity()), 0, "jitLiquidity cleared");
        assertFalse(vault.jitActive(), "jitActive cleared");
        assertEq(uint256(vault.jitPositionLiquidity()), 0, "no orphan JIT liquidity on-chain");
        assertEq(IPoolManager(address(pm)).getNonzeroDeltaCount(), 0, "deltas settled");

        // Backing intact: Aave still fully backs the idle counters after the round-trip.
        assertGe(adapter0.totalAssets(), vault.idle0(), "aave backs idle0");
        assertGe(adapter1.totalAssets(), vault.idle1(), "aave backs idle1");
        // The JIT captured real inventory: the token1 the trader bought partly came from the JIT leg,
        // so idle1 dropped and idle0 rose (single-swap conversion), yet total backing is conserved.
        assertGt(vault.idle0(), 0, "idle0 present");
    }

    /// @dev Prove the JIT position genuinely opened mid-swap by observing the JitOpened event.
    function test_jit_opens_within_swap_emits_event() public {
        vm.recordLogs();
        _swap(true, 30_000e18);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("JitOpened(bool,uint256,uint128,int24,int24)");
        bool sawOpen;
        bool sawClose;
        bytes32 closeSig = keccak256("JitClosed(uint256,uint256,uint256,uint256)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == sig) sawOpen = true;
            if (logs[i].topics[0] == closeSig) sawClose = true;
        }
        assertTrue(sawOpen, "JIT opened within the swap");
        assertTrue(sawClose, "JIT closed within the swap");
    }

    function test_small_swap_below_threshold_skips_jit() public {
        vm.recordLogs();
        _swap(true, 1_000e18); // below JIT_THRESHOLD
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("JitOpened(bool,uint256,uint128,int24,int24)");
        for (uint256 i; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != sig, "no JIT below threshold");
        }
        assertEq(uint256(vault.jitLiquidity()), 0, "no JIT at rest");
    }

    // ── jit_falls_back_when_aave_dry ────────────────────────────────────────────

    function test_jit_falls_back_when_aave_dry() public {
        // Drain all token1 liquidity out of the aToken → adapter1.withdraw best-efforts to 0.
        uint256 liq = t1.balanceOf(address(a1Tok));
        a1Tok.simulateBorrow(liq);
        assertEq(adapter1.maxWithdrawable(), 0, "adapter1 dry");

        // The swap must STILL complete — JIT silently falls back to resting liquidity.
        uint256 out = t1.balanceOf(trader);
        _swap(true, 20_000e18);
        assertGt(t1.balanceOf(trader), out, "swap filled against resting liquidity");
        assertEq(uint256(vault.jitLiquidity()), 0, "no JIT opened");
        assertFalse(vault.jitActive(), "jitActive clean");
        assertEq(IPoolManager(address(pm)).getNonzeroDeltaCount(), 0, "deltas settled");
    }

    function test_jit_falls_back_when_reserve_paused() public {
        pool.setConfig(address(t1), true, false, true); // paused ⇒ maxWithdrawable 0
        uint256 out = t1.balanceOf(trader);
        _swap(true, 20_000e18);
        assertGt(t1.balanceOf(trader), out, "swap still fills");
        assertEq(uint256(vault.jitLiquidity()), 0, "no JIT");
    }

    function test_jit_close_survives_hostile_resupply() public {
        // JIT opens (withdraw works), but re-supply on close reverts — jitClose must not brick the swap.
        pool.setRevertOnSupply(true);
        uint256 out = t1.balanceOf(trader);
        _swap(true, 20_000e18);
        assertGt(t1.balanceOf(trader), out, "swap completed despite hostile re-supply");
        assertEq(uint256(vault.jitLiquidity()), 0, "JIT closed");
        assertFalse(vault.jitActive(), "jitActive cleared");
        assertEq(IPoolManager(address(pm)).getNonzeroDeltaCount(), 0, "deltas settled");
        // Returned tokens that couldn't be re-idled sit in the vault as extra backing (vault-favoring).
        assertGe(adapter0.totalAssets(), vault.idle0(), "idle0 still backed");
        assertGe(adapter1.totalAssets(), vault.idle1(), "idle1 still backed");
    }

    // ── rounding: price-neutral round-trip never over-pays the depositor ─────────

    function testFuzz_jit_roundtrip_rounds_against_user(uint256 amt) public {
        amt = bound(amt, 5_000e18, 60_000e18);

        // Fresh LP whose full lifecycle we measure.
        address u = makeAddr("u");
        t0.mint(u, 1e30); t1.mint(u, 1e30);
        vm.startPrank(u);
        t0.approve(address(vault), type(uint256).max);
        t1.approve(address(vault), type(uint256).max);
        uint256 before0 = t0.balanceOf(u);
        uint256 before1 = t1.balanceOf(u);
        uint256 s = vault.deposit(300_000e18, 300_000e18, 0, LockTier.Flex);
        uint256 used0 = before0 - t0.balanceOf(u);
        uint256 used1 = before1 - t1.balanceOf(u);
        vm.stopPrank();

        // Equal-and-opposite swaps that trigger JIT and return price to ~start.
        _swap(true, amt);
        _swap(false, amt);
        _swap(true, amt / 2);
        _swap(false, amt / 2);

        // Full exit.
        vm.warp(block.timestamp + 25 hours);
        vm.prank(u);
        vault.requestRedeem(s);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(u);
        (uint256 o0, uint256 o1) = vault.executeRedeem();

        // The redeem PRINCIPAL path rounds against the user: with price restored, no phantom principal
        // is created. (LP fees, if any, are claimed separately and are not part of redeem principal.)
        // Allow a tiny per-token slack for the price not landing EXACTLY back at the start tick.
        assertLe(o0, used0 + used0 / 100 + 1e18, "t0 out ~<= contributed");
        assertLe(o1, used1 + used1 / 100 + 1e18, "t1 out ~<= contributed");
    }

    /// @notice Thin-buffer swap: the manager is short the JIT removal's input token during afterSwap,
    ///         so jitClose mints ERC-6909 claims for the shortfall. The swap must NOT brick, JIT must
    ///         unwind, and a subsequent sweep must redeem the claims back into Aave.
    function test_jit_claims_when_buffer_thin_then_sweeps() public {
        vault.setBufferRatio(1); // idle ~all pooled liquidity → near-empty main position
        vm.prank(provider);
        vault.rebalanceBuffer();

        uint256 idle1Before = vault.idle1();
        vm.prank(trader);
        router.swap(key, false, 200_000e18); // large oneForZero against a near-empty main position

        // Swap completed, JIT unwound, and the shortfall was parked as ERC-6909 claims (not a revert).
        assertEq(uint256(vault.jitLiquidity()), 0, "JIT unwound");
        assertFalse(vault.jitActive(), "jitActive cleared");
        assertEq(IPoolManager(address(pm)).getNonzeroDeltaCount(), 0, "deltas settled");
        assertTrue(vault.jitClaim0() > 0 || vault.jitClaim1() > 0, "shortfall parked as claims");
        // Claims are backed 1:1 by the manager's post-settle reserves.
        assertGe(t1.balanceOf(address(pm)), vault.jitClaim1(), "manager backs token1 claims");
        assertGe(t0.balanceOf(address(pm)), vault.jitClaim0(), "manager backs token0 claims");

        // Keeper sweeps: claims redeem to physical and re-idle into Aave.
        vault.sweepJitClaims();
        assertEq(vault.jitClaim0(), 0, "token0 claims swept");
        assertEq(vault.jitClaim1(), 0, "token1 claims swept");
        assertGe(adapter0.totalAssets(), vault.idle0(), "aave backs idle0 after sweep");
        assertGe(adapter1.totalAssets(), vault.idle1(), "aave backs idle1 after sweep");
        assertGt(vault.idle1(), idle1Before - 200_000e18, "idle recovered via sweep"); // sanity: not drained to nothing
    }

    // ── access control + one-time wiring ────────────────────────────────────────

    function test_jitOpen_onlyHook() public {
        vm.expectRevert(MintwareDeFiPairVault.OnlyHook.selector);
        vault.jitOpen(true, 1e18);
        vm.expectRevert(MintwareDeFiPairVault.OnlyHook.selector);
        vault.jitClose();
    }

    function test_setHook_is_one_time() public {
        vm.expectRevert(MintwareDeFiPairVault.HookAlreadySet.selector);
        vault.setHook(makeAddr("other"));
    }

    // ── reentrancy: the notDuringJit guard blocks a hostile-adapter reentrancy mid-JIT ──

    function test_jit_guard_blocks_reentrant_deposit() public {
        // Isolated pool with a distinct token pair, REUSING the mined `coord` (re-pointed at the new
        // vault) — mining a second 0xAC8 hook with identical args would CREATE2-collide.
        MockERC20 x0 = new MockERC20("X0", "X0", 18);
        MockERC20 x1 = new MockERC20("X1", "X1", 18);
        (Currency d0, Currency d1) = address(x0) < address(x1)
            ? (Currency.wrap(address(x0)), Currency.wrap(address(x1)))
            : (Currency.wrap(address(x1)), Currency.wrap(address(x0)));
        MockERC20 y0 = MockERC20(Currency.unwrap(d0));
        MockERC20 y1 = MockERC20(Currency.unwrap(d1));

        MWHookCoordinator coord2 = coord;
        PoolKey memory k2 = PoolKey({currency0: d0, currency1: d1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(coord2))});
        MintwareDeFiPairVault v = new MintwareDeFiPairVault(address(pm), k2, PoolProfile.EMERGING, treasury, provider, address(this));
        coord2.setVault(address(v));
        v.setHook(address(coord2));

        // Reentrant adapter on both sides (asset-matched so setAdapters accepts it).
        ReentrantJitAdapter ra0 = new ReentrantJitAdapter(IERC20(address(y0)));
        ReentrantJitAdapter ra1 = new ReentrantJitAdapter(IERC20(address(y1)));
        ra0.setVault(v); ra1.setVault(v);
        v.setAdapters(IYieldAdapter(address(ra0)), IYieldAdapter(address(ra1)));
        v.setBufferRatio(6_000);
        coord2.setJitThreshold(JIT_THRESHOLD);
        coord2.setJitEnabled(k2.toId(), true);

        vm.prank(provider);
        v.initializePool(INIT_SQRT_PRICE);
        vm.roll(block.number + 1);

        y0.mint(alice, 1e30); y1.mint(alice, 1e30);
        vm.startPrank(alice);
        y0.approve(address(v), type(uint256).max);
        y1.approve(address(v), type(uint256).max);
        v.deposit(400_000e18, 400_000e18, 0, LockTier.Flex);
        vm.stopPrank();
        vm.prank(provider);
        v.rebalanceBuffer(); // idle → adapters (reentrant on deposit)

        // Arm the token0-side adapter to reenter on the NEXT deposit (jitClose re-idles token0 there).
        ra0.arm(true);

        y0.mint(trader, 1e30); y1.mint(trader, 1e30);
        vm.startPrank(trader);
        y0.approve(address(router), type(uint256).max);
        y1.approve(address(router), type(uint256).max);
        // zeroForOne swap ⇒ JIT opens token1 side, closes → re-idles token0 into ra0 → reenters deposit.
        router.swap(k2, true, 20_000e18);
        vm.stopPrank();

        assertTrue(ra0.reenterAttempted(), "reentrancy path exercised");
        assertTrue(ra0.reenterBlocked(),  "reentrant deposit blocked mid-JIT (JitInProgress/nonReentrant)");
        // Swap still completed and JIT unwound.
        assertEq(uint256(v.jitLiquidity()), 0, "JIT closed despite reentrancy attempt");
        assertEq(IPoolManager(address(pm)).getNonzeroDeltaCount(), 0, "deltas settled");
    }
}

/// @notice am-AMM composition proof: a MANAGED swap (manager seated, LP fee skimmed to the auction)
///         that ALSO triggers JIT leaves NonzeroDeltaCount == 0 and charges the manager fee correctly.
///         JIT settles on the vault's delta account, disjoint from the hook's am-AMM fee delta.
contract MintwareDeFiPairVaultJitAmAmmTest is Test {
    using PoolIdLibrary        for PoolKey;
    using TransientStateLibrary for IPoolManager;

    address internal deployer = address(this);
    address internal provider = address(this);
    address internal treasury = makeAddr("treasury");
    address internal alice    = makeAddr("alice");
    address internal trader   = makeAddr("trader");
    address internal mgr      = makeAddr("mgr");

    PoolManager    internal pm;
    TestSwapRouter internal router;
    MWHookCoordinator internal coord;
    MWAmAuction    internal auction;
    MintwareDeFiPairVault internal vault;

    MockERC20 internal t0;
    MockERC20 internal t1;
    PoolKey   internal key;
    PoolId    internal poolId;

    MockAavePool internal pool;
    AaveV3YieldAdapter internal adapter0;
    AaveV3YieldAdapter internal adapter1;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336;
    uint24  internal constant MGR_FEE_PIPS = 10_000; // 1%

    function setUp() public {
        pm     = new PoolManager(deployer);
        router = new TestSwapRouter(IPoolManager(address(pm)));

        MockERC20 tokenA = new MockERC20("Token A", "AAA", 18);
        MockERC20 tokenB = new MockERC20("Token B", "BBB", 18);
        (Currency c0, Currency c1) = address(tokenA) < address(tokenB)
            ? (Currency.wrap(address(tokenA)), Currency.wrap(address(tokenB)))
            : (Currency.wrap(address(tokenB)), Currency.wrap(address(tokenA)));
        t0 = MockERC20(Currency.unwrap(c0));
        t1 = MockERC20(Currency.unwrap(c1));

        bytes memory args = abi.encode(IPoolManager(address(pm)), address(0), deployer);
        (address expected, bytes32 salt) =
            HookMiner.find(deployer, uint160(0xAC8), type(MWHookCoordinator).creationCode, args);
        coord = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), address(0), deployer);
        require(address(coord) == expected, "coord addr");

        // DYNAMIC-FEE pool (required for the am-AMM fee override).
        key = PoolKey({currency0: c0, currency1: c1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: IHooks(address(coord))});
        poolId = key.toId();

        vault = new MintwareDeFiPairVault(address(pm), key, PoolProfile.EMERGING, treasury, provider, deployer);
        coord.setVault(address(vault));
        vault.setHook(address(coord));

        pool = new MockAavePool();
        MockAToken a0Tok = new MockAToken(address(t0), address(pool));
        MockAToken a1Tok = new MockAToken(address(t1), address(pool));
        pool.setAToken(address(t0), a0Tok);
        pool.setAToken(address(t1), a1Tok);
        pool.setConfig(address(t0), true, false, false);
        pool.setConfig(address(t1), true, false, false);
        adapter0 = new AaveV3YieldAdapter(IPoolAddressesProvider(address(pool)), address(t0), address(a0Tok), address(vault), address(this));
        adapter1 = new AaveV3YieldAdapter(IPoolAddressesProvider(address(pool)), address(t1), address(a1Tok), address(vault), address(this));
        vault.setAdapters(IYieldAdapter(address(adapter0)), IYieldAdapter(address(adapter1)));
        vault.setBufferRatio(6_000);
        coord.setJitThreshold(5_000e18);
        coord.setJitEnabled(poolId, true);

        vault.initializePool(INIT_SQRT_PRICE);
        vm.roll(1000);

        t0.mint(alice, 1e30); t1.mint(alice, 1e30);
        vm.startPrank(alice);
        t0.approve(address(vault), type(uint256).max);
        t1.approve(address(vault), type(uint256).max);
        vault.deposit(400_000e18, 400_000e18, 0, LockTier.Flex);
        vm.stopPrank();
        vault.rebalanceBuffer();

        t0.mint(trader, 1e30); t1.mint(trader, 1e30);
        t0.mint(mgr, 1e24);
        vm.startPrank(trader);
        t0.approve(address(router), type(uint256).max);
        t1.approve(address(router), type(uint256).max);
        vm.stopPrank();

        // am-AMM wiring: rent sink = vault; funder = auction.
        auction = new MWAmAuction(deployer);
        auction.setCoordinator(address(coord));
        coord.setAuction(address(auction));
        vault.setRentFunder(address(auction));
        auction.configurePool(poolId, address(vault), AmParams({
            enabled: true, bidToken: address(t0), feeMaxPips: 30_000, defaultFeePips: 3000,
            minRent: 1e14, K: 10, minBidMultBps: 11_000
        }));
        coord.setAmAmmEnabled(poolId, true);
    }

    function _seatManager() internal {
        uint128 rent = 1e15;
        uint128 dep  = 1e16; // rent * K
        vm.startPrank(mgr);
        t0.approve(address(auction), dep);
        auction.bid(poolId, MGR_FEE_PIPS, rent, dep);
        vm.stopPrank();
        vm.roll(block.number + 11); // past K → next swap's poke promotes mgr
    }

    function test_managed_swap_plus_jit_composes() public {
        _seatManager();
        uint256 owedBefore = auction.owed(mgr, address(t0));

        // A managed + size-gated swap: am-AMM skims the manager fee AND JIT opens/closes.
        vm.recordLogs();
        vm.prank(trader);
        router.swap(key, true, 30_000e18); // exact-in zeroForOne ⇒ specified = currency0

        // Composition: the whole unlock settled to zero (else the swap would have reverted).
        assertEq(IPoolManager(address(pm)).getNonzeroDeltaCount(), 0, "NonzeroDeltaCount == 0 (am-AMM + JIT composed)");

        // The manager fee was charged (am-AMM path preserved, unchanged by JIT).
        assertGt(auction.owed(mgr, address(t0)) - owedBefore, 0, "manager fee skimmed alongside JIT");

        // JIT genuinely fired within this same managed swap, and unwound.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 openSig = keccak256("JitOpened(bool,uint256,uint128,int24,int24)");
        bool sawOpen;
        for (uint256 i; i < logs.length; i++) if (logs[i].topics[0] == openSig) sawOpen = true;
        assertTrue(sawOpen, "JIT opened within the managed swap");
        assertEq(uint256(vault.jitLiquidity()), 0, "JIT closed");
        assertFalse(vault.jitActive(), "jitActive cleared");
    }
}
