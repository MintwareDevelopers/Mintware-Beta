// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {PoolManager}          from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}         from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}               from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}              from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}             from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary}         from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {MintwareDeFiPairVault} from "../src/vaults/MintwareDeFiPairVault.sol";
import {PoolProfile, LockTier} from "../src/vaults/VaultTypes.sol";
import {AaveV3YieldAdapter}    from "../src/vaults/AaveV3YieldAdapter.sol";
import {IYieldAdapter}         from "../src/vaults/IYieldAdapter.sol";
import {IPoolAddressesProvider} from "../src/vaults/aave/IAaveV3.sol";

import {MockERC20}                from "./mocks/MockERC20.sol";
import {MockAavePool, MockAToken} from "./mocks/MockAavePool.sol";
import {TestSwapRouter}           from "./helpers/TestSwapRouter.sol";

/// @dev Drives the buffered-rehypothecation pair vault through fuzzed sequences of deposit / redeem /
///      swap / collect / claim AND the new idle-capital paths (supplyIdle / recallIdle /
///      rebalanceBuffer) against a real AaveV3YieldAdapter over a MockAavePool. Every action swallows
///      reverts (a reverted action is a no-op for the fuzzer). No yield is simulated here, so idle
///      principal stays exact and the solvency assertions are tight.
contract PairVaultHandler is Test {
    using PoolIdLibrary for PoolKey;

    MintwareDeFiPairVault public vault;
    TestSwapRouter public router;
    MockERC20 public t0;
    MockERC20 public t1;
    PoolKey   public key;

    address[] public actors;
    address   public trader;
    address   public provider;
    address   public owner;

    // Ghosts for monotonicity + conservation checks.
    uint256 public lastAcc0;
    uint256 public lastAcc1;
    bool    public accEverDecreased;

    constructor(
        MintwareDeFiPairVault _vault,
        TestSwapRouter _router,
        MockERC20 _t0,
        MockERC20 _t1,
        PoolKey memory _key,
        address[] memory _actors,
        address _trader,
        address _provider,
        address _owner
    ) {
        vault = _vault;
        router = _router;
        t0 = _t0;
        t1 = _t1;
        key = _key;
        actors = _actors;
        trader = _trader;
        provider = _provider;
        owner = _owner;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[bound(seed, 0, actors.length - 1)];
    }

    function _recordAcc() internal {
        uint256 a0 = vault.accFee0PerShare();
        uint256 a1 = vault.accFee1PerShare();
        if (a0 < lastAcc0 || a1 < lastAcc1) accEverDecreased = true;
        lastAcc0 = a0;
        lastAcc1 = a1;
    }

    // ── time ──────────────────────────────────────────────────────────────────
    function warp(uint256 delta) public {
        delta = bound(delta, 1 hours, 10 days);
        vm.warp(block.timestamp + delta);
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
        uint256 s = bound(sharesSeed, 1, sh);
        vm.prank(a);
        try vault.requestRedeem(s) {} catch {}
    }

    function executeRedeem(uint256 actorSeed) public {
        address a = _actor(actorSeed);
        vm.prank(a);
        try vault.executeRedeem() {} catch {}
        _recordAcc();
    }

    // ── fees ──────────────────────────────────────────────────────────────────
    function genSwap(uint256 amt, bool dir) public {
        amt = bound(amt, 1e18, 40_000e18);
        vm.prank(trader);
        try router.swap(key, dir, amt) {} catch {}
    }

    function collect() public {
        try vault.collectFees() {} catch {}
        _recordAcc();
    }

    function claim(uint256 actorSeed) public {
        address a = _actor(actorSeed);
        vm.prank(a);
        try vault.claimFees() {} catch {}
        _recordAcc();
    }

    // ── idle / buffer ───────────────────────────────────────────────────────────
    function supplyIdle(uint256 lSeed) public {
        uint128 pos = vault.positionLiquidity();
        if (pos == 0) return;
        uint128 dl = uint128(bound(lSeed, 1, pos));
        vm.prank(provider);
        try vault.supplyIdle(dl) {} catch {}
        _recordAcc();
    }

    function recallIdle(uint256 lSeed) public {
        uint128 il = vault.idleLiquidity();
        if (il == 0) return;
        uint128 dl = uint128(bound(lSeed, 1, il));
        vm.prank(provider);
        try vault.recallIdle(dl) {} catch {}
        _recordAcc();
    }

    function rebalanceBuffer() public {
        vm.prank(provider);
        try vault.rebalanceBuffer() {} catch {}
        _recordAcc();
    }

    function setBuffer(uint256 bpsSeed) public {
        uint256 bps = bound(bpsSeed, 0, 10_000);
        vm.prank(owner);
        try vault.setBufferRatio(bps) {} catch {}
    }
}

/// @notice Stateful solvency+ invariants for buffered rehypothecation. Extends the pair-vault's
///         Bunni-safe, price-free share model with the Aave idle leg and proves that every share
///         stays fully backed across pooled liquidity AND idled principal.
contract MintwareDeFiPairVaultInvariantTest is StdInvariant, Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    PoolManager    internal pm;
    TestSwapRouter internal router;
    MintwareDeFiPairVault internal vault;
    PairVaultHandler internal handler;

    MockERC20 internal tokenA;
    MockERC20 internal tokenB;
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

    function setUp() public {
        pm     = new PoolManager(address(this));
        router = new TestSwapRouter(IPoolManager(address(pm)));

        tokenA = new MockERC20("Token A", "AAA", 18);
        tokenB = new MockERC20("Token B", "BBB", 18);
        (Currency c0, Currency c1) = address(tokenA) < address(tokenB)
            ? (Currency.wrap(address(tokenA)), Currency.wrap(address(tokenB)))
            : (Currency.wrap(address(tokenB)), Currency.wrap(address(tokenA)));
        t0 = MockERC20(Currency.unwrap(c0));
        t1 = MockERC20(Currency.unwrap(c1));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});

        vault = new MintwareDeFiPairVault(
            address(pm), key, PoolProfile.EMERGING, treasury, provider, address(this)
        );

        // ── Aave stand-in + one real adapter per token ──
        pool = new MockAavePool();
        MockAToken a0Tok = new MockAToken(address(t0), address(pool));
        MockAToken a1Tok = new MockAToken(address(t1), address(pool));
        pool.setAToken(address(t0), a0Tok);
        pool.setAToken(address(t1), a1Tok);
        pool.setConfig(address(t0), true, false, false);
        pool.setConfig(address(t1), true, false, false);

        adapter0 = new AaveV3YieldAdapter(
            IPoolAddressesProvider(address(pool)), address(t0), address(a0Tok), address(vault), address(this)
        );
        adapter1 = new AaveV3YieldAdapter(
            IPoolAddressesProvider(address(pool)), address(t1), address(a1Tok), address(vault), address(this)
        );
        vault.setAdapters(IYieldAdapter(address(adapter0)), IYieldAdapter(address(adapter1)));
        vault.setBufferRatio(6_000); // keep 60% pooled, idle 40%

        vm.prank(provider);
        vault.initializePool(INIT_SQRT_PRICE);

        // Seed liquidity from all three actors, then set up approvals for the handler's fuzzed calls.
        _fund(a);
        _fund(b);
        _fund(c);
        _seed(a, 200_000e18);
        _seed(b, 150_000e18);
        _seed(c, 100_000e18);

        // Trader for fee-generating swaps.
        t0.mint(trader, 1e30);
        t1.mint(trader, 1e30);
        vm.startPrank(trader);
        t0.approve(address(router), type(uint256).max);
        t1.approve(address(router), type(uint256).max);
        vm.stopPrank();

        address[] memory actors = new address[](3);
        actors[0] = a; actors[1] = b; actors[2] = c;
        handler = new PairVaultHandler(vault, router, t0, t1, key, actors, trader, provider, address(this));

        bytes4[] memory sels = new bytes4[](11);
        sels[0]  = PairVaultHandler.warp.selector;
        sels[1]  = PairVaultHandler.deposit.selector;
        sels[2]  = PairVaultHandler.requestRedeem.selector;
        sels[3]  = PairVaultHandler.executeRedeem.selector;
        sels[4]  = PairVaultHandler.genSwap.selector;
        sels[5]  = PairVaultHandler.collect.selector;
        sels[6]  = PairVaultHandler.claim.selector;
        sels[7]  = PairVaultHandler.supplyIdle.selector;
        sels[8]  = PairVaultHandler.recallIdle.selector;
        sels[9]  = PairVaultHandler.rebalanceBuffer.selector;
        sels[10] = PairVaultHandler.setBuffer.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        targetContract(address(handler));
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

    // ── invariants ───────────────────────────────────────────────────────────

    /// @notice SOLVENCY (pool leg): the real on-chain V4 position exactly backs the tracked pooled
    ///         units. If they drift, the pooled side is over/under-collateralized.
    function invariant_position_backs_pooled_units() public view {
        (uint128 onchain,,) = IPoolManager(address(pm)).getPositionInfo(
            key.toId(), address(vault), vault.tickLower(), vault.tickUpper(), bytes32(0)
        );
        assertEq(uint256(onchain), uint256(vault.positionLiquidity()), "on-chain position != positionLiquidity");
    }

    /// @notice SOLVENCY+ (Aave leg): the yield source holds AT LEAST the settled idle principal, per
    ///         token. This is the new Bunni-hardening core — the vault's `idleN` counter can never
    ///         exceed what is actually recoverable from Aave, so every redeemer's idle claim is backed.
    function invariant_aave_backs_idle() public view {
        assertGe(adapter0.totalAssets(), vault.idle0(), "adapter0 principal < idle0");
        assertGe(adapter1.totalAssets(), vault.idle1(), "adapter1 principal < idle1");
    }

    /// @notice SOLVENCY (fee leg): unclaimed accumulator fees are backed by vault-held tokens.
    function invariant_vault_backs_fee_reserve() public view {
        assertGe(t0.balanceOf(address(vault)), vault.feeReserve0(), "t0 balance < feeReserve0");
        assertGe(t1.balanceOf(address(vault)), vault.feeReserve1(), "t1 balance < feeReserve1");
    }

    /// @notice No phantom shares: the share supply equals the sum of every holder's balance (no dead
    ///         shares are minted — the inflation defense is a virtual offset, not a real burn).
    function invariant_shares_sum_equals_supply() public view {
        uint256 sum = vault.shares(a) + vault.shares(b) + vault.shares(c);
        assertEq(sum, uint256(vault.totalLiquidity()), "sum of shares != totalLiquidity");
    }

    /// @notice Fee accumulators are monotonic — no negative accrual / accounting corruption, even as
    ///         capital moves in and out of Aave (share-price never goes backwards on the fee leg).
    function invariant_fee_accumulators_monotonic() public view {
        assertFalse(handler.accEverDecreased(), "a fee accumulator decreased");
    }
}
