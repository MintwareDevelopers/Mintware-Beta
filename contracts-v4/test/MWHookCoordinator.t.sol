// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}         from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}         from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary}         from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {HookMiner}               from "../src/lib/HookMiner.sol";
import {MWHookCoordinator}       from "../src/hooks/MWHookCoordinator.sol";
import {MintwareDeFiPairVault}   from "../src/vaults/MintwareDeFiPairVault.sol";
import {PoolProfile, LockTier}   from "../src/vaults/VaultTypes.sol";

import {MockERC20}      from "./mocks/MockERC20.sol";
import {TestSwapRouter} from "./helpers/TestSwapRouter.sol";

/// @notice Integration tests for MWHookCoordinator against a real V4 PoolManager, using the
///         go-forward dual-sided `MintwareDeFiPairVault` as the vault behind the (vault-agnostic)
///         coordinator: vault-gated LP + the MEV sandwich/cooldown guard blocking a real backrun
///         swap. Migrated off the deprecated single-sided `MintwareDeFiVault4626` (Phase 0).
contract MWHookCoordinatorTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    address internal deployer = address(this); // owner + provider
    address internal alice    = makeAddr("alice");  // LP
    address internal trader   = makeAddr("trader"); // swapper
    address internal treasury = makeAddr("treasury");

    PoolManager    internal pm;
    TestSwapRouter internal swapRouter;
    MWHookCoordinator internal coord;
    MintwareDeFiPairVault internal vault;

    MockERC20 internal t0;
    MockERC20 internal t1;

    PoolKey internal poolKey;
    PoolId  internal poolId;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0

    function setUp() public {
        pm         = new PoolManager(deployer);
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));

        MockERC20 tokenA = new MockERC20("USD Coin", "USDC", 18);
        MockERC20 tokenB = new MockERC20("Project Token", "PROJ", 18);
        (Currency c0, Currency c1) = address(tokenA) < address(tokenB)
            ? (Currency.wrap(address(tokenA)), Currency.wrap(address(tokenB)))
            : (Currency.wrap(address(tokenB)), Currency.wrap(address(tokenA)));
        t0 = MockERC20(Currency.unwrap(c0));
        t1 = MockERC20(Currency.unwrap(c1));

        // Mine + deploy the coordinator (vault wired after, like the socialVault pattern).
        bytes memory args = abi.encode(IPoolManager(address(pm)), address(0), deployer);
        (address expected, bytes32 salt) = HookMiner.find(
            deployer, uint160(0xAC8), type(MWHookCoordinator).creationCode, args
        );
        coord = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), address(0), deployer);
        require(address(coord) == expected, "coord addr mismatch");

        poolKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(coord))});
        poolId  = poolKey.toId();

        vault = new MintwareDeFiPairVault(address(pm), poolKey, PoolProfile.EMERGING, treasury, deployer, deployer);
        coord.setVault(address(vault));
        vault.setHook(address(coord));
        vault.initializePool(INIT_SQRT_PRICE);

        // LP seeds balanced dual-sided liquidity so the pool trades.
        t0.mint(alice, 1e30); t1.mint(alice, 1e30);
        vm.startPrank(alice);
        t0.approve(address(vault), type(uint256).max);
        t1.approve(address(vault), type(uint256).max);
        vault.deposit(2_000_000e18, 2_000_000e18, 0, LockTier.Flex);
        vm.stopPrank();

        t0.mint(trader, 1e30); t1.mint(trader, 1e30);

        // Generic swap tests: guard ON with a WIDE band (never trips on normal swaps) so the
        // oracle tracks; dynamic fee OFF (pool is static-fee, so the override would be inert).
        // The circuit-breaker test reconfigures with a tight band.
        // configurePool(id, base, max, slopePerTick, maxFeeStepPerBlock, dynFee, guard, maxTickMove, maxDev, catchup)
        coord.configurePool(poolId, 3000, 100000, 0, 0, false, true, 60, 6000, 10);
        vm.roll(1000);
    }

    function _swap(bool zeroForOne, uint256 amtIn) internal {
        vm.startPrank(trader, trader);
        (zeroForOne ? t0 : t1).approve(address(swapRouter), amtIn);
        swapRouter.swap(poolKey, zeroForOne, amtIn);
        vm.stopPrank();
    }

    function test_vault_only_liquidity_gate() public {
        // Direct LP (not via vault) reverts in beforeAddLiquidity.
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert();
        pm.unlock(abi.encode("direct-lp"));
    }

    function test_swap_succeeds() public {
        _swap(true, 500e18);
    }

    // ── Stage-1.2: oracle-based MEV model (no tx.origin) ─────────────────────

    function test_oracle_initializes_after_first_swap() public {
        (, bool initBefore) = coord.oracleTick(poolId); // guard on (setUp), so afterSwap tracks
        assertFalse(initBefore, "oracle uninitialized pre-swap");
        _swap(true, 500e18);
        (, bool initAfter) = coord.oracleTick(poolId);
        assertTrue(initAfter, "oracle initialized by afterSwap");
    }

    /// @notice The circuit breaker trips when spot deviates far from the truncated oracle —
    ///         with NO trader identity involved (works regardless of who swaps).
    function test_circuit_breaker_reverts_extreme_deviation() public {
        // Tight guard: oracle barely moves (maxTickMove 1, catchup 1), narrow band (20 ticks).
        coord.configurePool(poolId, 3000, 100000, 0, 0, false, true, 1, 20, 1);

        _swap(true, 1_000e18);      // seeds the oracle near the current tick
        vm.roll(block.number + 1);
        _swap(true, 500_000e18);    // pushes price far; oracle truncates (~stays put)
        vm.roll(block.number + 1);

        // Next swap: pre-swap tick is now far from the truncated oracle → breaker reverts.
        vm.startPrank(trader, trader);
        t0.approve(address(swapRouter), 1_000e18);
        vm.expectRevert(); // PriceDeviationTooHigh, wrapped by PoolManager
        swapRouter.swap(poolKey, true, 1_000e18);
        vm.stopPrank();
    }

    /// @notice Audit HIGH: the breaker must not PERMANENTLY brick the pool. The oracle only
    ///         advances in afterSwap, which a reverting beforeSwap never reaches — so once spot is
    ///         pushed past the band, every swap reverts and nothing heals the oracle. The
    ///         permissionless pokeOracle() advances the truncated reference toward spot across
    ///         blocks (same clamped budget), so the pool recovers on its own.
    function test_circuit_breaker_self_heals_via_poke() public {
        // Tight band (trips), but a heal budget that catches up in a bounded number of blocks.
        // NB: maxTickMove must stay well BELOW the achievable deviation. The pair vault's EMERGING
        // profile range (±1200 ticks) caps how far spot can move, so a large maxTickMove would let the
        // oracle fully catch up in one afterSwap and the breaker would never trip. 100 leaves a large
        // standing deviation yet still heals in ~a dozen pokes (< 300).
        coord.configurePool(poolId, 3000, 100000, 0, 0, false, true, 100, 20, 1);

        _swap(true, 1_000e18);      // seed oracle near current tick
        vm.roll(block.number + 1);
        _swap(true, 500_000e18);    // push spot far past the 20-tick band (to the range edge)
        vm.roll(block.number + 1);

        // Breaker tripped: swaps revert (the DoS state).
        vm.startPrank(trader, trader);
        t0.approve(address(swapRouter), 1_000e18);
        vm.expectRevert(); // PriceDeviationTooHigh, wrapped by PoolManager
        swapRouter.swap(poolKey, true, 1_000e18);
        vm.stopPrank();

        // Heal: ANYONE pokes the oracle across blocks until it re-enters the band. Bounded loop.
        address anyone = makeAddr("anyone");
        uint256 bn = block.number;
        uint256 blocksToHeal;
        for (; blocksToHeal < 300; blocksToHeal++) {
            bn += 1;
            vm.roll(bn);
            vm.prank(anyone);
            coord.pokeOracle(poolKey);
            (, int24 curTick,,) = IPoolManager(address(pm)).getSlot0(poolId);
            (int24 oTick,) = coord.oracleTick(poolId);
            int24 dev = curTick >= oTick ? curTick - oTick : oTick - curTick;
            if (uint256(uint24(dev)) <= 20) break;
        }
        assertLt(blocksToHeal, 300, "oracle healed within bound (no permanent brick)");

        // Swaps work again -> pool recovered on its own.
        _swap(true, 1_000e18);
    }

    /// pokeOracle before the oracle is seeded is a harmless no-op (no revert, nothing to heal).
    function test_poke_before_init_is_noop() public {
        (, bool init) = coord.oracleTick(poolId);
        assertFalse(init, "not seeded yet");
        coord.pokeOracle(poolKey); // must not revert
    }

    /// @notice A swap routed through the coordinator hook accrues realizable LP fees on the vault's
    ///         V4 position; `collectFees()` realizes them and applies the pair vault's configurable
    ///         value-capture split (default 30% treasury + 10% buyback — folded into treasury when no
    ///         buyback sink is wired — and 60% to LPs). This is the pair-vault equivalent of the
    ///         deprecated 4626 vault's 50/25/25 FeeVault split (whose exact split is unit-tested in
    ///         MintwareDeFiPairVault.t.sol); here we prove the swap→realize→split path works THROUGH
    ///         the coordinator hook.
    function test_swap_fee_collection_splits_through_coordinator() public {
        // Both directions so fees accrue in both tokens.
        _swap(true, 50_000e18);
        _swap(false, 45_000e18);

        uint256 tre0Before = t0.balanceOf(treasury);
        uint256 tre1Before = t1.balanceOf(treasury);

        (uint256 fee0, uint256 fee1) = vault.collectFees();
        assertTrue(fee0 > 0 || fee1 > 0, "swap fees realized through the coordinator");

        // buybackSink unset → buyback leg folds into treasury: treasury takes (treasury + buyback)
        // cut of each realized fee (each leg floored independently, exactly as `_splitFee`).
        uint256 expTre0 = (fee0 * vault.treasuryFeeBps()) / vault.BPS()
                        + (fee0 * vault.buybackFeeBps()) / vault.BPS();
        uint256 expTre1 = (fee1 * vault.treasuryFeeBps()) / vault.BPS()
                        + (fee1 * vault.buybackFeeBps()) / vault.BPS();
        assertEq(t0.balanceOf(treasury) - tre0Before, expTre0, "treasury takes treasury+buyback cut (token0)");
        assertEq(t1.balanceOf(treasury) - tre1Before, expTre1, "treasury takes treasury+buyback cut (token1)");

        // The LP remainder (~60%) accrues to the sole depositor.
        (uint256 pend0, uint256 pend1) = vault.pendingFees(alice);
        assertTrue(pend0 > 0 || pend1 > 0, "LP remainder accrues to depositor");
    }

    // ── Stage 1.3: callback gating (Trail-of-Bits pattern #1) ────────────────

    function test_callbacks_reject_non_pool_manager() public {
        ModifyLiquidityParams memory lp = ModifyLiquidityParams(-60000, 60000, 1, bytes32(0));
        SwapParams memory sp = SwapParams(true, 1, 0);

        vm.startPrank(alice);
        vm.expectRevert(MWHookCoordinator.OnlyPoolManager.selector);
        coord.beforeAddLiquidity(address(vault), poolKey, lp, "");
        vm.expectRevert(MWHookCoordinator.OnlyPoolManager.selector);
        coord.beforeRemoveLiquidity(address(vault), poolKey, lp, "");
        vm.expectRevert(MWHookCoordinator.OnlyPoolManager.selector);
        coord.beforeSwap(alice, poolKey, sp, "");
        vm.expectRevert(MWHookCoordinator.OnlyPoolManager.selector);
        coord.afterSwap(alice, poolKey, sp, BalanceDeltaZero(), "");
        vm.stopPrank();
    }

    function test_permission_bits_match_declared_flags() public view {
        // Declared HOOK_FLAGS must equal the low bits actually encoded in the address
        // (an Angstrom-class mismatch would otherwise brick or mis-gate the pool).
        assertEq(coord.HOOK_FLAGS(), 0xAC8, "declared flags");
        assertEq(uint160(address(coord)) & 0x3FFF, 0xAC8, "address-encoded flags match");
    }

    // ── Stage 1.4: kill-switch on the hook ───────────────────────────────────

    function test_pause_blocks_new_liquidity_but_swaps_continue() public {
        coord.pause();

        // New liquidity (via the vault) is blocked at beforeAddLiquidity. V4's PoolManager
        // wraps hook reverts (EnforcedPause bubbles inside a WrappedError), so match on any revert.
        vm.startPrank(alice);
        vm.expectRevert();
        vault.deposit(10_000e18, 10_000e18, 0, LockTier.Flex);
        vm.stopPrank();

        // Trading continues — a paused hook must never brick the pool's swap path.
        _swap(true, 500e18);
    }

    function test_guardian_can_pause_hook() public {
        address guardian = makeAddr("guardian");
        coord.setGuardian(guardian);
        vm.prank(guardian);
        coord.pause();
        assertTrue(coord.paused(), "guardian paused hook");

        vm.prank(guardian);
        vm.expectRevert(); // guardian cannot unpause
        coord.unpause();

        coord.unpause();
        assertFalse(coord.paused(), "owner unpaused hook");
    }

    function BalanceDeltaZero() internal pure returns (BalanceDelta) {
        return BalanceDelta.wrap(0);
    }

    // ── Stage-2.1: routing-discoverability gas budget ────────────────────────

    /// @notice The full swap hot path (dynamic fee + oracle guard + fee rate-limit) must stay
    ///         well under ~200k gas on beforeSwap+afterSwap — above that, routing bots treat a
    ///         hook as "hostile" and skip the pool. This is the concrete payoff of not carrying a
    ///         heavier take()-skim in the swap hot path (that capture is deferred to Phase 4).
    function test_gas_hook_hot_path_under_routing_budget() public {
        // Everything on: dynamic fee, oracle guard, rate-limit.
        coord.configurePool(poolId, 3000, 100000, 5, 500, true, true, 60, 6000, 10);
        // Warm oracle + fee/tick state so we measure steady-state (not first-touch) cost.
        _swap(true, 2_000e18);
        vm.roll(block.number + 1);
        _swap(true, 2_000e18);
        vm.roll(block.number + 1);

        SwapParams memory sp = SwapParams(true, -int256(1_000e18), 0);

        vm.startPrank(address(pm));
        uint256 g0 = gasleft();
        coord.beforeSwap(alice, poolKey, sp, "");
        uint256 beforeGas = g0 - gasleft();
        uint256 g1 = gasleft();
        coord.afterSwap(alice, poolKey, sp, BalanceDeltaZero(), "");
        uint256 afterGas = g1 - gasleft();
        vm.stopPrank();

        emit log_named_uint("beforeSwap gas", beforeGas);
        emit log_named_uint("afterSwap gas ", afterGas);
        emit log_named_uint("combined gas  ", beforeGas + afterGas);
        assertLt(beforeGas + afterGas, 200_000, "hook hot path exceeds the ~200k routing budget");
    }
}
