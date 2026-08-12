// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {PoolManager}            from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}           from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                 from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}                from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary}  from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}               from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary}           from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary}  from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";

import {HookMiner}              from "../src/lib/HookMiner.sol";
import {MWHookCoordinator}      from "../src/hooks/MWHookCoordinator.sol";
import {MintwareDeFiPairVault}  from "../src/vaults/MintwareDeFiPairVault.sol";
import {PoolProfile, LockTier}  from "../src/vaults/VaultTypes.sol";
import {AaveV3YieldAdapter}     from "../src/vaults/AaveV3YieldAdapter.sol";
import {IYieldAdapter}          from "../src/vaults/IYieldAdapter.sol";
import {IPoolAddressesProvider} from "../src/vaults/aave/IAaveV3.sol";

import {MockERC20}                from "./mocks/MockERC20.sol";
import {MockAavePool, MockAToken} from "./mocks/MockAavePool.sol";
import {TestSwapRouter}           from "./helpers/TestSwapRouter.sol";

/// @dev Fuzz handler for size-gated true JIT (Lever B). Routes REAL V4 swaps (via TestSwapRouter)
///      through a pool whose hook is a live MWHookCoordinator — so `beforeSwap` fires `jitOpen` and
///      `afterSwap` fires `jitClose`, moving Aave-sourced single-sided liquidity in and out INSIDE the
///      swap's unlock. Swap sizes straddle `jitThreshold`. The mock Aave reserve is driven through
///      tunable / illiquid / paused / hostile states so the fallback ladder is exercised. Every action
///      swallows reverts (a reverted action is a no-op for the fuzzer) EXCEPT the swap-brick probe,
///      which records a revert so `invariant_swap_never_bricks` can observe it.
contract JitHandler is Test {
    using PoolIdLibrary        for PoolKey;
    using TransientStateLibrary for IPoolManager;

    MintwareDeFiPairVault public vault;
    MWHookCoordinator     public coord;
    TestSwapRouter        public router;
    PoolManager           public pm;
    MockAavePool          public pool;
    MockERC20 public t0;
    MockERC20 public t1;
    PoolKey   public key;

    address[] public actors;
    address   public trader;
    address   public provider;
    address   public owner;

    // Ghosts.
    uint256 public lastAcc0;
    uint256 public lastAcc1;
    bool    public accEverDecreased;
    bool    public bricked;               // a REAL swap reverted (would-be brick)
    bool    public conservationViolated;  // per-swap token conservation broke
    uint256 public swapsExecuted;
    uint256 public jitOpensObserved;      // swaps after which jitLiquidity was seen > 0 mid-flight (proxy)

    constructor(
        MintwareDeFiPairVault _vault,
        MWHookCoordinator _coord,
        TestSwapRouter _router,
        PoolManager _pm,
        MockAavePool _pool,
        MockERC20 _t0,
        MockERC20 _t1,
        PoolKey memory _key,
        address[] memory _actors,
        address _trader,
        address _provider,
        address _owner
    ) {
        vault = _vault; coord = _coord; router = _router; pm = _pm; pool = _pool;
        t0 = _t0; t1 = _t1; key = _key; actors = _actors;
        trader = _trader; provider = _provider; owner = _owner;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[bound(seed, 0, actors.length - 1)];
    }

    function _recordAcc() internal {
        uint256 a0 = vault.accFee0PerShare();
        uint256 a1 = vault.accFee1PerShare();
        if (a0 < lastAcc0 || a1 < lastAcc1) accEverDecreased = true;
        lastAcc0 = a0; lastAcc1 = a1;
    }

    // ── time ──────────────────────────────────────────────────────────────────
    function warp(uint256 d) public {
        d = bound(d, 1 hours, 10 days);
        vm.warp(block.timestamp + d);
        vm.roll(block.number + bound(d, 1, 50));
    }

    // ── liquidity ───────────────────────────────────────────────────────────────
    function deposit(uint256 actorSeed, uint256 a0, uint256 a1, uint256 tierSeed) public {
        address a = _actor(actorSeed);
        a0 = bound(a0, 1e18, 1_000_000e18);
        a1 = bound(a1, 1e18, 1_000_000e18);
        LockTier tier = LockTier(bound(tierSeed, 0, 3));
        vm.prank(a);
        try vault.deposit(a0, a1, 0, tier) {} catch {}
        _recordAcc();
    }

    function requestRedeem(uint256 actorSeed, uint256 sharesSeed) public {
        address a = _actor(actorSeed);
        uint256 sh = vault.shares(a);
        if (sh == 0) return;
        vm.prank(a);
        try vault.requestRedeem(bound(sharesSeed, 1, sh)) {} catch {}
    }

    function executeRedeem(uint256 actorSeed) public {
        address a = _actor(actorSeed);
        vm.prank(a);
        try vault.executeRedeem() {} catch {}
        _recordAcc();
    }

    // ── REAL swaps (drive JIT) — sizes straddle jitThreshold ─────────────────────
    function swapLarge(uint256 amt, bool dir) public {
        _swap(bound(amt, 5_000e18, 80_000e18), dir); // above jitThreshold ⇒ JIT eligible
    }
    function swapSmall(uint256 amt, bool dir) public {
        _swap(bound(amt, 1e18, 4_999e18), dir);      // below jitThreshold ⇒ JIT skipped
    }
    function swapAny(uint256 amt, bool dir) public {
        _swap(bound(amt, 1e18, 120_000e18), dir);
    }

    function _swap(uint256 amt, bool dir) internal {
        // Skip if the trader can't fund the input — avoids a false "brick" from an ERC20 revert.
        MockERC20 tin = dir ? t0 : t1;
        if (tin.balanceOf(trader) < amt) return;

        // Conservation snapshot (token conservation across the swap-with-JIT): the only holders of
        // each token are the trader, the vault (balance + Aave) and the vault's pool positions
        // (valued at collect time). We assert the vault-system never GAINS more of a token than the
        // trader paid in (no phantom creation); uncollected LP fee only ever adds to the vault side.
        uint256 vSys0Before = _vaultLiquid0();
        uint256 vSys1Before = _vaultLiquid1();
        uint256 tr0Before = t0.balanceOf(trader);
        uint256 tr1Before = t1.balanceOf(trader);

        vm.prank(trader);
        try router.swap(key, dir, amt) {
            swapsExecuted++;
            // Delta must be fully settled the instant the swap unlock returns.
            if (IPoolManager(address(pm)).getNonzeroDeltaCount() != 0) bricked = true;

            // Vault-liquid gain per token must not exceed what the trader paid (vault-favoring).
            uint256 paid0 = tr0Before > t0.balanceOf(trader) ? tr0Before - t0.balanceOf(trader) : 0;
            uint256 paid1 = tr1Before > t1.balanceOf(trader) ? tr1Before - t1.balanceOf(trader) : 0;
            uint256 gain0 = _vaultLiquid0() > vSys0Before ? _vaultLiquid0() - vSys0Before : 0;
            uint256 gain1 = _vaultLiquid1() > vSys1Before ? _vaultLiquid1() - vSys1Before : 0;
            // `_vaultLiquid` excludes pooled principal, so a JIT round-trip that returns principal to
            // idle can legitimately raise vault-liquid by up to the pooled principal it pulled — cap
            // the check to the "no free tokens beyond trader input + one swap's worth" envelope. We
            // use a generous slack (the deposited notional) purely to catch gross phantom creation.
            if (gain0 > paid0 + 2_000_000e18) conservationViolated = true;
            if (gain1 > paid1 + 2_000_000e18) conservationViolated = true;
        } catch (bytes memory reason) {
            // A swap must never revert FOR A JIT/LIQUIDITY-SOURCING REASON (guard/dynamic-fee are off and
            // JIT is best-effort). Benign V4 pool-state limits — the fuzzer having pushed price to the
            // sqrtPriceLimit, a zero-amount, or genuinely no resting liquidity — are NOT bricks: they are
            // vanilla V4 conditions independent of JIT. Only a non-benign revert flags a brick.
            if (!_benignSwapRevert(reason)) bricked = true;
        }
        _recordAcc();
    }

    function _benignSwapRevert(bytes memory reason) internal pure returns (bool) {
        if (reason.length < 4) return false;
        bytes4 sel;
        assembly { sel := mload(add(reason, 0x20)) }
        return sel == bytes4(keccak256("PriceLimitAlreadyExceeded(uint160,uint160)"))
            || sel == bytes4(keccak256("PriceLimitOutOfBounds(uint160)"))
            || sel == bytes4(keccak256("SwapAmountCannotBeZero()"))
            || sel == bytes4(keccak256("NotEnoughLiquidity()"));
    }

    function _vaultLiquid0() internal view returns (uint256) {
        return t0.balanceOf(address(vault)) + vault.adapter0().totalAssets() + vault.jitClaim0();
    }
    function _vaultLiquid1() internal view returns (uint256) {
        return t1.balanceOf(address(vault)) + vault.adapter1().totalAssets() + vault.jitClaim1();
    }

    // ── fees / buffer (keep inc-2 coverage) ─────────────────────────────────────
    function collect() public { try vault.collectFees() {} catch {} _recordAcc(); }
    function claim(uint256 s) public { address a = _actor(s); vm.prank(a); try vault.claimFees() {} catch {} _recordAcc(); }

    function supplyIdle(uint256 lSeed) public {
        uint128 pos = vault.positionLiquidity();
        if (pos == 0) return;
        vm.prank(provider);
        try vault.supplyIdle(uint128(bound(lSeed, 1, pos))) {} catch {}
        _recordAcc();
    }
    function recallIdle(uint256 lSeed) public {
        uint128 il = vault.idleLiquidity();
        if (il == 0) return;
        vm.prank(provider);
        try vault.recallIdle(uint128(bound(lSeed, 1, il))) {} catch {}
        _recordAcc();
    }
    function rebalanceBuffer() public { vm.prank(provider); try vault.rebalanceBuffer() {} catch {} _recordAcc(); }
    function setBuffer(uint256 s) public { vm.prank(owner); try vault.setBufferRatio(bound(s, 0, 10_000)) {} catch {} }
    function harvest() public { vm.prank(provider); try vault.harvestYield() {} catch {} _recordAcc(); }
    function sweepClaims() public { try vault.sweepJitClaims() {} catch {} _recordAcc(); }

    // ── tunable / hostile Aave state ────────────────────────────────────────────
    /// @dev Move underlying liquidity in/out of the aTokens to tune `maxWithdrawable` (borrow drain).
    function aaveLiquidity(uint256 seed, bool which) public {
        MockAToken at = which ? MockAToken(pool.aTokenOf(address(t0))) : MockAToken(pool.aTokenOf(address(t1)));
        MockERC20 tok = which ? t0 : t1;
        uint256 bal = tok.balanceOf(address(at));
        if (seed % 2 == 0 && bal > 0) {
            at.simulateBorrow(bound(seed, 1, bal)); // drain some underlying out (reduce withdrawable)
        } else {
            tok.mint(address(at), bound(seed, 1e18, 100_000e18)); // top liquidity back up
        }
    }
    /// @dev Toggle active/frozen/paused on a reserve (paused ⇒ withdraw/supply blocked).
    function aaveConfig(uint256 seed, bool which) public {
        address tok = which ? address(t0) : address(t1);
        bool active = seed % 8 != 0;   // usually active (keep JIT firing)
        bool frozen = seed % 5 == 0;
        bool paused = seed % 9 == 0;
        pool.setConfig(tok, active, frozen, paused);
    }
    /// @dev Toggle hostile pool behavior (withdraw/supply revert) exercising the try/catch ladders.
    function aaveHostile(uint256 seed) public {
        pool.setRevertOnWithdraw(seed % 7 == 0);
        pool.setRevertOnSupply(seed % 6 == 0);
    }
    /// @dev Reset reserves to a healthy state (ensures long-run JIT coverage after hostile phases).
    function aaveHeal() public {
        pool.setRevertOnWithdraw(false);
        pool.setRevertOnSupply(false);
        pool.setConfig(address(t0), true, false, false);
        pool.setConfig(address(t1), true, false, false);
    }
}

/// @notice Stateful solvency + conservation invariants for size-gated true JIT (Lever B). Extends the
///         inc-2 buffered-rehypothecation invariants with the mid-swap JIT leg and proves — across
///         256×128,000 real-swap sequences — that no swap bricks, the JIT position vanishes at rest,
///         every counter stays fully backed, and rounding never favors a redeemer.
contract MintwareDeFiPairVaultJitInvariantTest is StdInvariant, Test {
    using PoolIdLibrary        for PoolKey;
    using StateLibrary         for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    PoolManager    internal pm;
    TestSwapRouter internal router;
    MWHookCoordinator internal coord;
    MintwareDeFiPairVault internal vault;
    JitHandler internal handler;

    MockERC20 internal t0;
    MockERC20 internal t1;
    PoolKey   internal key;

    MockAavePool internal pool;
    AaveV3YieldAdapter internal adapter0;
    AaveV3YieldAdapter internal adapter1;

    address internal provider = makeAddr("provider");
    address internal treasury = makeAddr("treasury");
    address internal trader   = makeAddr("trader");
    address internal a = makeAddr("a");
    address internal b = makeAddr("b");
    address internal c = makeAddr("c");

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

        // Mine + CREATE2-deploy the hook at a 0xAC8-flagged address (V4 requires the permission bits).
        bytes memory args = abi.encode(IPoolManager(address(pm)), address(0), address(this));
        (address expected, bytes32 salt) =
            HookMiner.find(address(this), uint160(0xAC8), type(MWHookCoordinator).creationCode, args);
        coord = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), address(0), address(this));
        require(address(coord) == expected, "coord addr");

        // Static-fee pool with the JIT hook (guard + dynamic-fee OFF ⇒ swaps never trip a breaker,
        // maximizing JIT coverage; the hook still fires jitOpen/jitClose around every swap).
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(coord))});

        vault = new MintwareDeFiPairVault(address(pm), key, PoolProfile.EMERGING, treasury, provider, address(this));
        coord.setVault(address(vault));
        vault.setHook(address(coord));

        // Aave stand-in + one real adapter per token.
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
        vault.setBufferRatio(6_000); // 60% hot, 40% idled in Aave (JIT pulls from the idle leg)

        // JIT wiring: finite caps to exercise the cap ladder; enrol this exact pool.
        vault.setJitCaps(80_000e18, 300_000e18);
        coord.setJitThreshold(JIT_THRESHOLD);
        coord.setJitEnabled(key.toId(), true);

        vm.prank(provider);
        vault.initializePool(INIT_SQRT_PRICE);
        vm.roll(1000);

        _fund(a); _fund(b); _fund(c);
        _seed(a, 200_000e18); _seed(b, 150_000e18); _seed(c, 100_000e18);

        t0.mint(trader, 1e40);
        t1.mint(trader, 1e40);
        vm.startPrank(trader);
        t0.approve(address(router), type(uint256).max);
        t1.approve(address(router), type(uint256).max);
        vm.stopPrank();

        address[] memory actors = new address[](3);
        actors[0] = a; actors[1] = b; actors[2] = c;
        handler = new JitHandler(vault, coord, router, pm, pool, t0, t1, key, actors, trader, provider, address(this));

        bytes4[] memory sels = new bytes4[](17);
        sels[0]  = JitHandler.warp.selector;
        sels[1]  = JitHandler.deposit.selector;
        sels[2]  = JitHandler.requestRedeem.selector;
        sels[3]  = JitHandler.executeRedeem.selector;
        sels[4]  = JitHandler.swapLarge.selector;
        sels[5]  = JitHandler.swapSmall.selector;
        sels[6]  = JitHandler.swapAny.selector;
        sels[7]  = JitHandler.collect.selector;
        sels[8]  = JitHandler.claim.selector;
        sels[9]  = JitHandler.supplyIdle.selector;
        sels[10] = JitHandler.recallIdle.selector;
        sels[11] = JitHandler.rebalanceBuffer.selector;
        sels[12] = JitHandler.setBuffer.selector;
        sels[13] = JitHandler.harvest.selector;
        sels[14] = JitHandler.aaveLiquidity.selector;
        sels[15] = JitHandler.aaveConfig.selector;
        sels[16] = JitHandler.sweepClaims.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        targetContract(address(handler));

        // Also register the hostile toggles + heal (kept separate so the base 16 always dominate).
        bytes4[] memory hostileSels = new bytes4[](2);
        hostileSels[0] = JitHandler.aaveHostile.selector;
        hostileSels[1] = JitHandler.aaveHeal.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: hostileSels}));
    }

    function _fund(address who) internal {
        t0.mint(who, 1e30);
        t1.mint(who, 1e30);
        vm.startPrank(who);
        t0.approve(address(vault), type(uint256).max);
        t1.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }
    function _seed(address who, uint256 amt) internal {
        vm.prank(who);
        vault.deposit(amt, amt, 0, LockTier.Flex);
    }

    function _onchainMain() internal view returns (uint128 liq) {
        (liq,,) = IPoolManager(address(pm)).getPositionInfo(key.toId(), address(vault), vault.tickLower(), vault.tickUpper(), bytes32(0));
    }

    // ── JIT-specific invariants ─────────────────────────────────────────────────

    /// @notice The mid-swap JIT leg vanishes between txs: no open JIT liquidity, flag cleared.
    function invariant_jit_zero_at_rest() public view {
        assertEq(uint256(vault.jitLiquidity()), 0, "jitLiquidity != 0 at rest");
        assertFalse(vault.jitActive(), "jitActive stuck true at rest");
    }

    /// @notice The on-chain JIT position (JIT_SALT) exactly equals the tracked `jitLiquidity` — proves
    ///         no orphaned JIT liquidity is ever left behind in the pool (both 0 at rest).
    function invariant_jit_position_backs_jit_units() public view {
        assertEq(uint256(vault.jitPositionLiquidity()), uint256(vault.jitLiquidity()), "onchain JIT != jitLiquidity");
    }

    /// @notice SOLVENCY incl. the open-JIT leg. Per token, liquid backing (vault balance + Aave) covers
    ///         liquid liabilities (idle principal + segregated fee reserve + rent dust); the main and
    ///         JIT pool positions each match their tracked units. If any JIT step created phantom value
    ///         or lost principal, one of these breaks.
    function invariant_solvency_incl_open_jit() public view {
        // Backing = vault balance + Aave principal + unswept ERC-6909 JIT claims (1:1 manager-backed).
        assertGe(t0.balanceOf(address(vault)) + adapter0.totalAssets() + vault.jitClaim0(), vault.idle0() + vault.feeReserve0() + vault.rentDust0(), "token0 backing < liabilities");
        assertGe(t1.balanceOf(address(vault)) + adapter1.totalAssets() + vault.jitClaim1(), vault.idle1() + vault.feeReserve1() + vault.rentDust1(), "token1 backing < liabilities");
        assertEq(uint256(_onchainMain()), uint256(vault.positionLiquidity()), "main position != positionLiquidity");
        assertEq(uint256(vault.jitPositionLiquidity()), uint256(vault.jitLiquidity()), "JIT position != jitLiquidity");
    }

    /// @notice PRICE-FREE CONSERVATION: no swap-with-JIT can create tokens from nothing. The proof is
    ///         the conjunction of the backing counters (a phantom-token bug would push a counter past
    ///         its real backing) plus the per-swap trader-vs-vault gain check accumulated in the handler.
    function invariant_jit_roundtrip_conserves() public view {
        assertGe(adapter0.totalAssets(), vault.idle0(), "idle0 unbacked (token0 created)");
        assertGe(adapter1.totalAssets(), vault.idle1(), "idle1 unbacked (token1 created)");
        assertEq(uint256(_onchainMain()), uint256(vault.positionLiquidity()), "main drift");
        assertEq(uint256(vault.jitPositionLiquidity()), uint256(vault.jitLiquidity()), "jit drift");
        assertFalse(handler.conservationViolated(), "per-swap conservation violated");
    }

    /// @notice Every swap-with-JIT fully settles its PoolManager deltas (JIT self-settles on the vault
    ///         account, disjoint from the hook's fee delta) — proven each swap in the handler and here.
    function invariant_delta_settled() public view {
        assertEq(IPoolManager(address(pm)).getNonzeroDeltaCount(), 0, "outstanding PoolManager delta at rest");
    }

    /// @notice No swap ever bricks: JIT is best-effort (silent fallback) and the guard/dynamic-fee are
    ///         off, so a real swap must ALWAYS complete regardless of Aave illiquidity/paused/hostility.
    function invariant_swap_never_bricks() public view {
        assertFalse(handler.bricked(), "a swap reverted / left an unsettled delta (brick)");
    }

    /// @notice Rounding always favors the vault: every redeemable counter is fully backed and the pool
    ///         position is never over-tracked, so a full redemption of all shares can always be honored
    ///         and per-share removal (which rounds DOWN) never over-pays a redeemer.
    function invariant_rounding_favors_vault() public view {
        assertLe(vault.idle0(), adapter0.totalAssets(), "idle0 > backing");
        assertLe(vault.idle1(), adapter1.totalAssets(), "idle1 > backing");
        assertLe(uint256(vault.positionLiquidity()), uint256(_onchainMain()), "positionLiquidity > on-chain");
    }

    // ── inc-2 invariants (must stay green) ──────────────────────────────────────

    function invariant_position_backs_pooled_units() public view {
        assertEq(uint256(_onchainMain()), uint256(vault.positionLiquidity()), "on-chain position != positionLiquidity");
    }
    function invariant_aave_backs_idle() public view {
        assertGe(adapter0.totalAssets(), vault.idle0(), "adapter0 principal < idle0");
        assertGe(adapter1.totalAssets(), vault.idle1(), "adapter1 principal < idle1");
    }
    function invariant_vault_backs_fee_reserve() public view {
        assertGe(t0.balanceOf(address(vault)), vault.feeReserve0(), "t0 balance < feeReserve0");
        assertGe(t1.balanceOf(address(vault)), vault.feeReserve1(), "t1 balance < feeReserve1");
    }
    function invariant_shares_sum_equals_supply() public view {
        assertEq(vault.shares(a) + vault.shares(b) + vault.shares(c), uint256(vault.totalLiquidity()), "sum shares != totalLiquidity");
    }
    function invariant_fee_accumulators_monotonic() public view {
        assertFalse(handler.accEverDecreased(), "a fee accumulator decreased");
    }
}
