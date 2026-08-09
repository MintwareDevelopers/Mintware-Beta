// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}          from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}         from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}               from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}              from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}             from "@uniswap/v4-core/src/types/Currency.sol";

import {HookMiner}                     from "../src/lib/HookMiner.sol";
import {MWHookCoordinator}             from "../src/hooks/MWHookCoordinator.sol";
import {MintwareMatchedLiquidityVault} from "../src/vaults/MintwareMatchedLiquidityVault.sol";
import {PoolProfile}                   from "../src/vaults/VaultTypes.sol";

import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Deploy-path verification for DeployMatchedVault.s.sol: the launch vault is bound to a
///         canonical MWHookCoordinator (vault-only LP gate), commitTeam rejects any other hook, and
///         a full commit → fund → activate lifecycle deploys liquidity through the gated pool.
contract DeployMatchedVaultTest is Test {
    address internal deployer = address(this);
    address internal team     = makeAddr("team");
    address internal treasury = makeAddr("treasury");
    address internal a = makeAddr("a");
    address internal b = makeAddr("b");
    address internal c = makeAddr("c");

    PoolManager internal pm;
    MWHookCoordinator internal coord;
    MintwareMatchedLiquidityVault internal vault;
    MockERC20 internal proj;
    MockERC20 internal quote;

    PoolKey internal poolKey;
    uint160 constant INIT_SQRT_PRICE = 79228162514264337593543950336;
    uint256 constant T = 100_000e18;
    uint256 constant CAP = 100_000e18;

    // ── mirror of the DeployMatchedVault script assembly ─────────────────────
    function setUp() public {
        pm    = new PoolManager(deployer);
        proj  = new MockERC20("Project", "PEPE", 18);
        quote = new MockERC20("Quote", "USDC", 18);

        // 1. Vault
        vault = new MintwareMatchedLiquidityVault(
            address(pm), address(proj), address(quote), team, treasury, address(0),
            PoolProfile.MEME, deployer
        );
        // 2. Mine + deploy coordinator with the vault baked in.
        bytes memory args = abi.encode(IPoolManager(address(pm)), address(vault), deployer);
        (address expected, bytes32 salt) =
            HookMiner.find(deployer, uint160(0xAC8), type(MWHookCoordinator).creationCode, args);
        coord = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), address(vault), deployer);
        require(address(coord) == expected, "coord addr");
        // 3. Bind.
        vault.setExpectedHook(address(coord));

        (Currency c0, Currency c1) = address(proj) < address(quote)
            ? (Currency.wrap(address(proj)), Currency.wrap(address(quote)))
            : (Currency.wrap(address(quote)), Currency.wrap(address(proj)));
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(coord))});

        proj.mint(team, 1_000_000e18);
        quote.mint(a, 1_000_000e18);
        quote.mint(b, 1_000_000e18);
        quote.mint(c, 1_000_000e18);
    }

    function _deposit(address who, uint256 amt) internal {
        vm.startPrank(who);
        quote.approve(address(vault), amt);
        vault.depositCommunity(amt);
        vm.stopPrank();
    }

    function test_deploy_wiring_is_correct() public view {
        assertEq(vault.expectedHook(), address(coord), "vault bound to coordinator");
        assertEq(coord.vault(), address(vault), "coordinator LP-gates the vault");
        assertEq(uint160(address(coord)) & 0x3FFF, 0xAC8, "hook permission bits");
    }

    /// commitTeam with a non-canonical hook is rejected (audit HIGH: no unprotected launch pools).
    function test_commit_with_wrong_hook_reverts() public {
        PoolKey memory bad = poolKey;
        bad.hooks = IHooks(address(0));
        vm.startPrank(team);
        proj.approve(address(vault), T);
        vm.expectRevert(MintwareMatchedLiquidityVault.BadPoolHook.selector);
        vault.commitTeam(bad, INIT_SQRT_PRICE, T, CAP, 7 days, 5_000, 365 days);
        vm.stopPrank();
    }

    /// Full lifecycle through the gated pool: commit (coordinator key) → fund → activate.
    function test_full_lifecycle_through_gated_pool() public {
        vm.startPrank(team);
        proj.approve(address(vault), T);
        vault.commitTeam(poolKey, INIT_SQRT_PRICE, T, CAP, 7 days, 5_000, 365 days);
        vm.stopPrank();

        _deposit(a, 40_000e18);
        _deposit(b, 40_000e18);
        _deposit(c, 20_000e18);

        vault.activate(); // adds liquidity as `vault` → passes the coordinator's vault-only gate
        assertGt(vault.totalLiquidity(), 0, "liquidity deployed through the gated pool");
        assertGt(vault.teamLiquidity(), 0, "team half locked");
    }
}
