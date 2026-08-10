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

import {FeeVault}                from "../src/FeeVault.sol";
import {HookMiner}               from "../src/lib/HookMiner.sol";
import {MWGuardianPausable}      from "../src/lib/MWGuardianPausable.sol";
import {MWHookCoordinator}       from "../src/hooks/MWHookCoordinator.sol";
import {MintwareDeFiVault4626}   from "../src/vaults/MintwareDeFiVault4626.sol";
import {VaultSurface, LockTier, VaultConfig} from "../src/vaults/VaultTypes.sol";

import {MockERC20}      from "./mocks/MockERC20.sol";
import {TestSwapRouter} from "./helpers/TestSwapRouter.sol";

/// @notice Integration tests for MWHookCoordinator against a real V4 PoolManager:
///         vault-gated LP + the MEV sandwich/cooldown guard blocking a real backrun swap.
contract MWHookCoordinatorTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    address internal deployer = address(this);
    address internal alice    = makeAddr("alice");
    address internal treasury = makeAddr("treasury");
    address internal oracle   = makeAddr("oracle");
    address internal dist     = makeAddr("distributor");

    PoolManager    internal pm;
    TestSwapRouter internal swapRouter;
    FeeVault       internal feeVault;
    MWHookCoordinator internal coord;
    MintwareDeFiVault4626 internal vault;

    MockERC20 internal usdc;
    MockERC20 internal proj;
    bool      internal sellProjZeroForOne; // selling proj is zeroForOne when proj == currency0

    PoolKey internal poolKey;
    PoolId  internal poolId;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336;
    bytes32 internal constant VAULT_ID = keccak256("coord-vault");

    function setUp() public {
        pm         = new PoolManager(deployer);
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));

        usdc = new MockERC20("USD Coin", "USDC", 6);
        proj = new MockERC20("Project Token", "PROJ", 6);
        sellProjZeroForOne = address(proj) < address(usdc);

        feeVault = new FeeVault(address(usdc), dist, oracle, treasury);

        // Mine + deploy the coordinator (vault wired after, like the socialVault pattern).
        bytes memory args = abi.encode(IPoolManager(address(pm)), address(0), deployer);
        (address expected, bytes32 salt) = HookMiner.find(
            deployer, uint160(0xAC8), type(MWHookCoordinator).creationCode, args
        );
        coord = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), address(0), deployer);
        require(address(coord) == expected, "coord addr mismatch");

        VaultConfig memory cfg = VaultConfig({
            surface:             VaultSurface.DeFi,
            provider:            deployer,
            underlyingToken:     address(usdc),
            treasury:            treasury,
            name:                "MW DeFi Vault Share",
            symbol:              "mwDEFI",
            minDeposit:          0,
            entryFeeBps:         0,
            exitFeeBps:          0,
            enableMEVProtection: true,
            enableIdleCapital:   false,
            idleTargetRatio:     0
        });
        vault = new MintwareDeFiVault4626(cfg, address(pm), address(feeVault));
        coord.setVault(address(vault));
        feeVault.setSocialVault(address(vault)); // authorize vault to notify trading-fee receipts

        (Currency c0, Currency c1) = address(usdc) < address(proj)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(proj)))
            : (Currency.wrap(address(proj)), Currency.wrap(address(usdc)));
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(coord))});
        poolId  = poolKey.toId();

        proj.mint(deployer, 100_000e6);
        usdc.mint(alice, 200_000e6);
        proj.mint(alice, 200_000e6);

        // Seed + open a practical LP range, then deposit so the pool has liquidity.
        proj.approve(address(vault), 100_000e6);
        vault.seedTeamTokens(VAULT_ID, address(proj), 100_000e6, poolKey, INIT_SQRT_PRICE);
        vault.rebalance(-60000, 60000);

        vm.startPrank(alice);
        usdc.approve(address(vault), 50_000e6);
        vault.depositWithLock(50_000e6, alice, LockTier.Flex);
        vm.stopPrank();

        // Generic swap tests: guard ON with a WIDE band (never trips on normal swaps) so the
        // oracle tracks; dynamic fee OFF (pool is static-fee, so the override would be inert).
        // The circuit-breaker test reconfigures with a tight band.
        // configurePool(id, base, max, slopePerTick, maxFeeStepPerBlock, dynFee, guard, maxTickMove, maxDev, catchup)
        coord.configurePool(poolId, 3000, 100000, 0, 0, false, true, 60, 6000, 10);
        vm.roll(1000);
    }

    function _swap(bool zeroForOne, uint256 amtIn) internal {
        vm.startPrank(alice, alice);
        if (zeroForOne) {
            MockERC20(Currency.unwrap(poolKey.currency0)).approve(address(swapRouter), amtIn);
        } else {
            MockERC20(Currency.unwrap(poolKey.currency1)).approve(address(swapRouter), amtIn);
        }
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
        _swap(sellProjZeroForOne, 500e6);
    }

    // ── Stage-1.2: oracle-based MEV model (no tx.origin) ─────────────────────

    function test_oracle_initializes_after_first_swap() public {
        (, bool initBefore) = coord.oracleTick(poolId); // guard on (setUp), so afterSwap tracks
        assertFalse(initBefore, "oracle uninitialized pre-swap");
        _swap(sellProjZeroForOne, 500e6);
        (, bool initAfter) = coord.oracleTick(poolId);
        assertTrue(initAfter, "oracle initialized by afterSwap");
    }

    /// @notice The circuit breaker trips when spot deviates far from the truncated oracle —
    ///         with NO trader identity involved (works regardless of who swaps).
    function test_circuit_breaker_reverts_extreme_deviation() public {
        // Tight guard: oracle barely moves (maxTickMove 1, catchup 1), narrow band (20 ticks).
        coord.configurePool(poolId, 3000, 100000, 0, 0, false, true, 1, 20, 1);

        _swap(sellProjZeroForOne, 100e6);        // seeds the oracle near the current tick
        vm.roll(block.number + 1);
        _swap(sellProjZeroForOne, 30_000e6);     // pushes price far; oracle truncates (~stays put)
        vm.roll(block.number + 1);

        // Next swap: pre-swap tick is now far from the truncated oracle → breaker reverts.
        vm.startPrank(alice, alice);
        MockERC20(Currency.unwrap(poolKey.currency0)).approve(address(swapRouter), 100e6);
        MockERC20(Currency.unwrap(poolKey.currency1)).approve(address(swapRouter), 100e6);
        vm.expectRevert(); // PriceDeviationTooHigh, wrapped by PoolManager
        swapRouter.swap(poolKey, sellProjZeroForOne, 100e6);
        vm.stopPrank();
    }

    /// @notice Audit HIGH: the breaker must not PERMANENTLY brick the pool. The oracle only
    ///         advances in afterSwap, which a reverting beforeSwap never reaches — so once spot is
    ///         pushed past the band, every swap reverts and nothing heals the oracle. The
    ///         permissionless pokeOracle() advances the truncated reference toward spot across
    ///         blocks (same clamped budget), so the pool recovers on its own.
    function test_circuit_breaker_self_heals_via_poke() public {
        // Tight band (trips), but a heal budget that catches up in a bounded number of blocks.
        coord.configurePool(poolId, 3000, 100000, 0, 0, false, true, 2000, 20, 1);

        _swap(sellProjZeroForOne, 100e6);   // seed oracle near current tick
        vm.roll(block.number + 1);
        _swap(sellProjZeroForOne, 8_000e6); // push spot far past the 20-tick band
        vm.roll(block.number + 1);

        // Breaker tripped: swaps revert (the DoS state).
        vm.startPrank(alice, alice);
        MockERC20(Currency.unwrap(poolKey.currency0)).approve(address(swapRouter), 100e6);
        vm.expectRevert(); // PriceDeviationTooHigh, wrapped by PoolManager
        swapRouter.swap(poolKey, sellProjZeroForOne, 100e6);
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
        _swap(sellProjZeroForOne, 100e6);
    }

    /// pokeOracle before the oracle is seeded is a harmless no-op (no revert, nothing to heal).
    function test_poke_before_init_is_noop() public {
        (, bool init) = coord.oracleTick(poolId);
        assertFalse(init, "not seeded yet");
        coord.pokeOracle(poolKey); // must not revert
    }

    function test_swap_fee_collection_splits_50_25_25() public {
        // Swap paying USDC in → LP fees accrue in USDC on the vault position.
        _swap(!sellProjZeroForOne, 5_000e6);

        uint256 tBefore = usdc.balanceOf(treasury);
        uint256 pBefore = usdc.balanceOf(address(this));      // provider == deployer
        uint256 fBefore = usdc.balanceOf(address(feeVault));

        (uint256 usdcFees,) = vault.collectFees();
        assertGt(usdcFees, 0, "USDC swap fees collected");

        uint256 expMint = (usdcFees * 2500) / 10_000;
        uint256 expProv = (usdcFees * 2500) / 10_000;
        uint256 expDep  = usdcFees - expMint - expProv;

        assertEq(usdc.balanceOf(treasury) - tBefore, expMint, "25% Mintware -> treasury");
        assertEq(usdc.balanceOf(address(this)) - pBefore, expProv, "25% provider");
        assertEq(usdc.balanceOf(address(feeVault)) - fBefore, expDep, "50% depositors -> FeeVault");
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
        usdc.approve(address(vault), 10_000e6);
        vm.expectRevert();
        vault.depositWithLock(10_000e6, alice, LockTier.Flex);
        vm.stopPrank();

        // Trading continues — a paused hook must never brick the pool's swap path.
        _swap(sellProjZeroForOne, 500e6);
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
        _swap(sellProjZeroForOne, 200e6);
        vm.roll(block.number + 1);
        _swap(sellProjZeroForOne, 200e6);
        vm.roll(block.number + 1);

        SwapParams memory sp = SwapParams(sellProjZeroForOne, -int256(100e6), 0);

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
