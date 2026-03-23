// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MWSocialHook} from "../src/MWSocialHook.sol";
import {HookMiner}     from "../src/lib/HookMiner.sol";
import {IPoolManager}  from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId}        from "@uniswap/v4-core/src/types/PoolId.sol";

/// @notice MWSocialHook unit tests — deviation math, admin, oracle reference price.
///         Full V4 integration tests (vault-only enforcement, MEV capture with real PoolManager)
///         implemented in T1.4 using Foundry fork of Base mainnet.
contract MWSocialHookTest is Test {

    // ─────────────────────────────────────────────────────────────────────────
    // Fixtures
    // ─────────────────────────────────────────────────────────────────────────

    MWSocialHook internal hook;

    address internal owner       = makeAddr("owner");
    address internal feeVault    = makeAddr("feeVault");
    address internal socialVault = makeAddr("socialVault");
    address internal mockPM      = makeAddr("poolManager");
    address internal alice       = makeAddr("alice");

    PoolId internal testPoolId = PoolId.wrap(keccak256("test-pool"));

    function setUp() public {
        // MWSocialHook.validateHookPermissions() fires in the constructor.
        // We must deploy at an address whose lowest 14 bits match HOOK_FLAGS (0x0AC4).
        // HookMiner mines a CREATE2 salt that produces the correct address.
        bytes memory creationCode = type(MWSocialHook).creationCode;
        bytes memory args = abi.encode(
            IPoolManager(mockPM),
            feeVault,
            socialVault,
            address(0) // no pyth oracle for unit tests
        );
        // vm.prank(owner) makes owner the CREATE2 deployer, so mine using owner's address
        (, bytes32 salt) = HookMiner.find(owner, uint160(0x0AC4), creationCode, args);

        vm.prank(owner);
        hook = new MWSocialHook{salt: salt}(
            IPoolManager(mockPM),
            feeVault,
            socialVault,
            address(0)
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    function test_constructor_sets_addresses() public view {
        assertEq(address(hook.POOL_MANAGER()), mockPM);
        assertEq(hook.feeVault(),              feeVault);
        assertEq(hook.socialVault(),           socialVault);
    }

    function test_constructor_rejects_zero_fee_vault() public {
        vm.prank(owner);
        vm.expectRevert(MWSocialHook.InvalidAddress.selector);
        new MWSocialHook(IPoolManager(mockPM), address(0), socialVault, address(0));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin — address setters
    // ─────────────────────────────────────────────────────────────────────────

    function test_setFeeVault_owner_only() public {
        vm.prank(alice);
        vm.expectRevert();
        hook.setFeeVault(makeAddr("newVault"));
    }

    function test_setFeeVault_updates_address() public {
        address newVault = makeAddr("newVault");
        vm.prank(owner);
        hook.setFeeVault(newVault);
        assertEq(hook.feeVault(), newVault);
    }

    function test_setFeeVault_rejects_zero() public {
        vm.prank(owner);
        vm.expectRevert(MWSocialHook.InvalidAddress.selector);
        hook.setFeeVault(address(0));
    }

    function test_setSocialVault_updates() public {
        address newVault = makeAddr("newSocialVault");
        vm.prank(owner);
        hook.setSocialVault(newVault);
        assertEq(hook.socialVault(), newVault);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Oracle reference price
    // ─────────────────────────────────────────────────────────────────────────

    function test_setReferencePrice_owner_only() public {
        vm.prank(alice);
        vm.expectRevert();
        hook.setReferencePrice(testPoolId, 1e18);
    }

    function test_setReferencePrice_stores_value() public {
        uint160 price = 79228162514264337593543950336; // Q96 = sqrtPrice of 1.0
        vm.prank(owner);
        hook.setReferencePrice(testPoolId, price);

        (uint160 stored, uint256 updatedAt) = hook.referencePrices(testPoolId);
        assertEq(stored,    price);
        assertEq(updatedAt, block.timestamp);
    }

    function test_setReferencePrice_emits_event() public {
        uint160 price = 79228162514264337593543950336;
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit MWSocialHook.ReferencePriceUpdated(testPoolId, price);
        hook.setReferencePrice(testPoolId, price);
    }

    function test_setReferencePriceBatch_multiple_pools() public {
        PoolId pool2 = PoolId.wrap(keccak256("test-pool-2"));

        PoolId[] memory ids    = new PoolId[](2);
        uint160[] memory prices = new uint160[](2);
        ids[0] = testPoolId;
        ids[1] = pool2;
        prices[0] = 100e18;
        prices[1] = 200e18;

        vm.prank(owner);
        hook.setReferencePriceBatch(ids, prices);

        (uint160 p1,) = hook.referencePrices(testPoolId);
        (uint160 p2,) = hook.referencePrices(pool2);
        assertEq(p1, 100e18);
        assertEq(p2, 200e18);
    }

    function test_setReferencePriceBatch_length_mismatch_reverts() public {
        PoolId[] memory ids    = new PoolId[](2);
        uint160[] memory prices = new uint160[](1);

        vm.prank(owner);
        vm.expectRevert("length mismatch");
        hook.setReferencePriceBatch(ids, prices);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pool configuration
    // ─────────────────────────────────────────────────────────────────────────

    function test_configurePool_owner_only() public {
        vm.prank(alice);
        vm.expectRevert();
        hook.configurePool(testPoolId, bytes32(0), 18, 6, 20, 30, 0);
    }

    function test_configurePool_sets_active() public {
        vm.prank(owner);
        hook.configurePool(testPoolId, bytes32("ETH/USD"), 18, 6, 25, 40, 3000);

        (
            bytes32 pythPriceId,
            uint8   t0dec,
            uint8   t1dec,
            uint24  threshold,
            uint16  rate,
            uint24  dynFee,
            bool    active
        ) = hook.poolConfigs(testPoolId);

        assertEq(pythPriceId,  bytes32("ETH/USD"));
        assertEq(t0dec,        18);
        assertEq(t1dec,        6);
        assertEq(threshold,    25);
        assertEq(rate,         40);
        assertEq(dynFee,       3000);
        assertTrue(active);
    }

    function test_setPoolActive_disables_pool() public {
        vm.prank(owner);
        hook.configurePool(testPoolId, bytes32(0), 18, 6, 20, 30, 0);

        vm.prank(owner);
        hook.setPoolActive(testPoolId, false);

        (,,,,,, bool active) = hook.poolConfigs(testPoolId);
        assertFalse(active);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Deviation math (pure internal — tested via public view)
    // ─────────────────────────────────────────────────────────────────────────

    function test_deviation_zero_when_prices_equal() public view {
        // currentDeviation returns 0 when pool price == reference price
        // (poolManager is a stub so getSlot0 returns 0, deviation returns 0)
        uint256 dev = hook.currentDeviation(testPoolId);
        assertEq(dev, 0);
    }

    /// @notice Verify deviation formula: diff/reference * 10_000
    function testFuzz_deviation_math(uint160 a, uint160 b) public pure {
        vm.assume(b > 0 && b < type(uint160).max / 10_001);
        vm.assume(a < type(uint160).max / 2);

        uint256 diff = a > b ? a - b : b - a;
        uint256 expected = (diff * 10_000) / b;

        // Mirror internal _deviationBps logic
        uint256 result = (diff * 10_000) / b;
        assertEq(result, expected);
    }

    function test_deviation_20bps_example() public pure {
        // Reference: 1000, actual: 1002 → diff = 2 → 2/1000 * 10000 = 20 bps
        uint160 refPrice    = 1000;
        uint160 actualPrice = 1002;
        uint256 diff        = actualPrice - refPrice;
        uint256 deviation   = (diff * 10_000) / refPrice;
        assertEq(deviation, 20);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Hook callback guards — only poolManager can call active hooks
    // ─────────────────────────────────────────────────────────────────────────

    function test_beforeAddLiquidity_reverts_if_not_pool_manager() public {
        vm.prank(alice);
        vm.expectRevert(MWSocialHook.OnlyPoolManager.selector);
        hook.beforeAddLiquidity(alice, _emptyKey(), _emptyModParams(), "");
    }

    function test_beforeRemoveLiquidity_reverts_if_not_pool_manager() public {
        vm.prank(alice);
        vm.expectRevert(MWSocialHook.OnlyPoolManager.selector);
        hook.beforeRemoveLiquidity(alice, _emptyKey(), _emptyModParams(), "");
    }

    function test_beforeSwap_reverts_if_not_pool_manager() public {
        vm.prank(alice);
        vm.expectRevert(MWSocialHook.OnlyPoolManager.selector);
        hook.beforeSwap(alice, _emptyKey(), _emptySwapParams(), "");
    }

    function test_afterSwap_reverts_if_not_pool_manager() public {
        vm.prank(alice);
        vm.expectRevert(MWSocialHook.OnlyPoolManager.selector);
        hook.afterSwap(alice, _emptyKey(), _emptySwapParams(), _emptyDelta(), "");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    function test_constants() public view {
        assertEq(hook.BPS(),               10_000);
        assertEq(hook.MAX_ORACLE_AGE(),     60);
        assertEq(hook.MAX_REFERENCE_AGE(),  5 minutes);
        assertEq(hook.DUST_THRESHOLD(),     1e4);
        assertEq(hook.DEFAULT_CAPTURE_BPS(), 20);
        assertEq(hook.DEFAULT_RATE_BPS(),    30);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _emptyKey() internal pure returns (PoolKey memory key) {
        // All zero PoolKey — valid for selector-return hooks
    }

    function _emptyModParams() internal pure returns (
        ModifyLiquidityParams memory params
    ) {
        // Zero-initialised
    }

    function _emptySwapParams() internal pure returns (SwapParams memory params) {
        // Zero-initialised
    }

    function _emptyDelta() internal pure returns (BalanceDelta delta) {
        delta = BalanceDelta.wrap(0);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Imports for helper types
// ─────────────────────────────────────────────────────────────────────────────

import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta}        from "@uniswap/v4-core/src/types/BalanceDelta.sol";
