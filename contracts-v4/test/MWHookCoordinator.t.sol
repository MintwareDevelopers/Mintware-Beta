// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}         from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";

import {FeeVault}                from "../src/FeeVault.sol";
import {HookMiner}               from "../src/lib/HookMiner.sol";
import {MWHookCoordinator}       from "../src/hooks/MWHookCoordinator.sol";
import {MintwareDeFiVault4626}   from "../src/vaults/MintwareDeFiVault4626.sol";
import {VaultSurface, LockTier, VaultConfig} from "../src/vaults/VaultTypes.sol";

import {MockERC20}      from "./mocks/MockERC20.sol";
import {TestSwapRouter} from "./helpers/TestSwapRouter.sol";

/// @notice Integration tests for MWHookCoordinator against a real V4 PoolManager:
///         vault-gated LP + the MEV sandwich/cooldown guard blocking a real backrun swap.
contract MWHookCoordinatorTest is Test {
    using PoolIdLibrary for PoolKey;

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
            deployer, uint160(0xAC0), type(MWHookCoordinator).creationCode, args
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

        // MEV on, deviation guard off (isolate the cooldown behavior), static fee.
        coord.configurePool(poolId, 3000, 0, 0, false, true, 3, 0, 2000);
        vm.roll(1000);
    }

    function _swap(bool zeroForOne, uint256 amtIn) internal {
        // prank sets both msg.sender and tx.origin to alice (coordinator keys on tx.origin)
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

    function test_first_swap_succeeds_and_records() public {
        _swap(sellProjZeroForOne, 500e6); // no prior swap → allowed
    }

    function test_sandwich_backrun_blocked_same_block() public {
        _swap(sellProjZeroForOne, 500e6);          // frontrun leg
        vm.startPrank(alice, alice);               // backrun, opposite dir, same block
        MockERC20 tokenIn = sellProjZeroForOne
            ? MockERC20(Currency.unwrap(poolKey.currency1))
            : MockERC20(Currency.unwrap(poolKey.currency0));
        tokenIn.approve(address(swapRouter), 500e6);
        vm.expectRevert(); // MEV cooldown blocks the backrun
        swapRouter.swap(poolKey, !sellProjZeroForOne, 500e6);
        vm.stopPrank();
    }

    function test_same_direction_second_swap_allowed() public {
        _swap(sellProjZeroForOne, 300e6);
        _swap(sellProjZeroForOne, 300e6); // same direction → not a sandwich → allowed
    }

    function test_backrun_allowed_after_cooldown() public {
        _swap(sellProjZeroForOne, 500e6);
        vm.roll(block.number + 3); // past cooldownBlocks
        _swap(!sellProjZeroForOne, 500e6); // opposite dir now allowed
    }
}
