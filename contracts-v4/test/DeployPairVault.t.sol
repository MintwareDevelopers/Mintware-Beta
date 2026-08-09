// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}          from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}         from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}               from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}              from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}             from "@uniswap/v4-core/src/types/Currency.sol";

import {HookMiner}                from "../src/lib/HookMiner.sol";
import {MWHookCoordinator}        from "../src/hooks/MWHookCoordinator.sol";
import {MintwareDeFiPairVault}    from "../src/vaults/MintwareDeFiPairVault.sol";
import {MintwareVaultRegistry}    from "../src/vaults/MintwareVaultRegistry.sol";
import {VaultSurface, PoolProfile, LockTier} from "../src/vaults/VaultTypes.sol";

import {MockERC20}      from "./mocks/MockERC20.sol";
import {TestSwapRouter} from "./helpers/TestSwapRouter.sol";

/// @notice Deploy-path verification for DeployPairVault.s.sol: replicates its exact assembly
///         (mine coordinator → PoolKey with hook → pair vault → hook.setVault → registry →
///         initializePool) against a real V4 PoolManager, then drives a full deposit → swap →
///         collect → async-redeem lifecycle.
///
/// @dev    The point of this suite is to prove the SOLVENCY property the single-sided
///         MintwareDeFiVault4626 lacked: a share is a real V4 liquidity unit, so redemption
///         returns BOTH tokens at their true post-trade value — never par principal paid
///         first-come-first-served out of one side. If the pool has moved, redeemers get their
///         actual share of both reserves, not a fictional par claim.
contract DeployPairVaultTest is Test {
    using PoolIdLibrary for PoolKey;

    address internal deployer = address(this); // owner + provider (matches script broadcaster)
    address internal treasury = makeAddr("treasury");
    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal trader   = makeAddr("trader");

    PoolManager    internal pm;
    TestSwapRouter internal swapRouter;
    MWHookCoordinator internal hook;
    MintwareDeFiPairVault internal vault;
    MintwareVaultRegistry internal registry;

    MockERC20 internal tokenA;
    MockERC20 internal tokenB;
    PoolKey   internal poolKey;
    PoolId    internal poolId;
    bytes32   internal vaultId;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0

    // ── mirror of the DeployPairVault script assembly ────────────────────────
    function _deployAsScriptWould() internal {
        pm         = new PoolManager(deployer);
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));

        tokenA = new MockERC20("Token A", "AAA", 18);
        tokenB = new MockERC20("Token B", "BBB", 18);
        (Currency c0, Currency c1) = address(tokenA) < address(tokenB)
            ? (Currency.wrap(address(tokenA)), Currency.wrap(address(tokenB)))
            : (Currency.wrap(address(tokenB)), Currency.wrap(address(tokenA)));

        // 1. Mine coordinator (vault wired post-deploy → vault == address(0))
        bytes memory hookArgs = abi.encode(IPoolManager(address(pm)), address(0), deployer);
        (address expected, bytes32 salt) =
            HookMiner.find(deployer, uint160(0xAC0), type(MWHookCoordinator).creationCode, hookArgs);

        // 2. PoolKey with the mined hook
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(expected)});
        poolId  = poolKey.toId();

        // 3. Pair vault
        vault = new MintwareDeFiPairVault(
            address(pm), poolKey, PoolProfile.EMERGING, treasury, deployer, deployer
        );

        // 4. Hook at the mined address + wire the vault-only LP gate
        hook = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), address(0), deployer);
        require(address(hook) == expected, "hook address mismatch");
        hook.setVault(address(vault));

        // 5. Registry — pair vault has no FeeVault (feeVault == address(0))
        registry = new MintwareVaultRegistry();
        vaultId  = keccak256(abi.encode(block.chainid, address(vault)));
        registry.registerVault(
            vaultId, VaultSurface.DeFi, address(vault), address(0), address(hook), address(0), deployer
        );

        // 6. Open the pool + profile range
        vault.initializePool(INIT_SQRT_PRICE);
    }

    function setUp() public {
        _deployAsScriptWould();
        for (uint256 i; i < 3; i++) {
            address who = [alice, bob, trader][i];
            _t0().mint(who, 10_000_000e18);
            _t1().mint(who, 10_000_000e18);
        }
    }

    function _t0() internal view returns (MockERC20) { return MockERC20(Currency.unwrap(poolKey.currency0)); }
    function _t1() internal view returns (MockERC20) { return MockERC20(Currency.unwrap(poolKey.currency1)); }

    function _deposit(address who, uint256 a0, uint256 a1, LockTier tier) internal returns (uint256 s) {
        vm.startPrank(who);
        _t0().approve(address(vault), a0);
        _t1().approve(address(vault), a1);
        s = vault.deposit(a0, a1, 0, tier);
        vm.stopPrank();
    }

    // ── the deploy produced a correctly-wired stack ──────────────────────────

    function test_deploy_wiring_is_correct() public view {
        assertEq(hook.vault(), address(vault), "hook.vault -> vault");
        assertEq(uint160(address(hook)) & 0x3FFF, 0xAC0, "hook permission bits");
        assertEq(registry.getVault(vaultId).vault, address(vault), "registry has the vault");
        assertEq(registry.getVault(vaultId).feeVault, address(0), "pair vault has no FeeVault");
        assertEq(address(vault.token0()), Currency.unwrap(poolKey.currency0), "token0 wired");
        assertEq(address(vault.token1()), Currency.unwrap(poolKey.currency1), "token1 wired");
    }

    // ── SOLVENCY: a share is a claim on BOTH tokens; redemption is not par ────

    function test_full_lifecycle_deposit_swap_collect_redeem_returns_both_tokens() public {
        // deposit balanced → shares == liquidity units
        uint256 s = _deposit(alice, 100_000e18, 100_000e18, LockTier.Flex);
        assertGt(s, 0, "shares minted");
        assertEq(vault.shares(alice), s, "share balance == liquidity");
        assertEq(vault.totalLiquidity(), s, "total liquidity == shares");

        // move the pool with real swaps through the coordinator hot path
        vm.startPrank(trader, trader);
        _t0().approve(address(swapRouter), type(uint256).max);
        _t1().approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(poolKey, true, 20_000e18);   // t0 -> t1
        swapRouter.swap(poolKey, false, 18_000e18);  // t1 -> t0
        vm.stopPrank();

        // realize accrued swap fees on-chain (both tokens)
        vault.collectFees();

        // async redeem: past min-hold → request → past notice → execute
        vm.warp(block.timestamp + 25 hours);
        vm.prank(alice);
        vault.requestRedeem(s);
        vm.warp(block.timestamp + 7 days + 1);

        uint256 a0Before = _t0().balanceOf(alice);
        uint256 a1Before = _t1().balanceOf(alice);
        vm.prank(alice);
        (uint256 out0, uint256 out1) = vault.executeRedeem();

        // The core solvency assertion: redemption returns BOTH tokens at real value.
        // After a swap that converted t0→t1 (net), the position holds more of one side —
        // the redeemer receives their true share of BOTH reserves, not par on one token.
        assertGt(out0, 0, "token0 returned");
        assertGt(out1, 0, "token1 returned");
        // Balance delta == redemption principal (out) PLUS any fee share paid by the internal
        // _claimFees during executeRedeem — so it is at least `out`, and strictly positive.
        assertGe(_t0().balanceOf(alice) - a0Before, out0, "token0 principal transferred");
        assertGe(_t1().balanceOf(alice) - a1Before, out1, "token1 principal transferred");
        assertEq(vault.shares(alice), 0, "shares burned");
        assertEq(vault.totalLiquidity(), 0, "liquidity fully removed");
    }
}
