// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

// V4 core
import {PoolManager}         from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";

// Our contracts
import {FeeVault}              from "../src/FeeVault.sol";
import {MWRouter}              from "../src/MWRouter.sol";
import {MWHookCoordinator}     from "../src/hooks/MWHookCoordinator.sol";
import {MintwareDeFiVault4626} from "../src/vaults/MintwareDeFiVault4626.sol";
import {VaultSurface, LockTier, VaultConfig} from "../src/vaults/VaultTypes.sol";
import {HookMiner}             from "../src/lib/HookMiner.sol";

// Test helpers
import {MockERC20}           from "./mocks/MockERC20.sol";

/// @title  MWRouter tests — internal swap + router-fee skim against a real V4 pool
/// @notice Real PoolManager + canonical MWHookCoordinator hook + DeFi-vault-seeded pool.
///         Proves: exact fee accounting, best-execution floor, guards, admin, and that the
///         router fee is skimmed exactly on swaps routed through the live coordinator hook.
contract MWRouterTest is Test {
    using PoolIdLibrary for PoolKey;

    // Actors
    address internal deployer      = address(this);
    address internal alice         = makeAddr("alice");        // LP
    address internal bob           = makeAddr("bob");          // swapper / payer
    address internal carol         = makeAddr("carol");        // distinct recipient
    address internal oracle        = makeAddr("oracle");
    address internal mevTreasury   = makeAddr("mevTreasury");  // hook's non-USDC staging
    address internal dist          = makeAddr("distributor");
    address internal routerOwner   = makeAddr("routerOwner");
    address internal routerTreasury = makeAddr("routerTreasury"); // router fee recipient (distinct)

    // V4 infra
    PoolManager internal pm;
    FeeVault    internal feeVault;
    MintwareDeFiVault4626 internal vault;
    MWHookCoordinator     internal coord;
    MWRouter    internal router;

    // Tokens + pool
    MockERC20 internal usdc;
    MockERC20 internal proj;
    PoolKey   internal poolKey;
    PoolId    internal poolId;
    bool      internal usdcIsToken0;
    bool      internal sellProjZeroForOne; // zeroForOne when selling PROJ for USDC

    uint16  internal constant FEE_BPS        = 50; // 0.5%
    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // price 1.0
    bytes32 internal constant VAULT_ID        = keccak256("router-test-vault");

    function setUp() public {
        vm.warp(10_000); // non-zero base time for deadline tests

        pm   = new PoolManager(deployer);
        usdc = new MockERC20("USD Coin",      "USDC", 6);
        proj = new MockERC20("Project Token", "PROJ", 6);
        usdcIsToken0 = address(usdc) < address(proj);
        sellProjZeroForOne = !usdcIsToken0; // selling PROJ = selling currency0 iff proj < usdc

        feeVault = new FeeVault(address(usdc), dist, oracle, mevTreasury);

        // Mine + deploy the canonical coordinator hook. MWSocialHook was retired in PR #40
        // (converged on MWHookCoordinator); vault is wired after, same as the old pattern.
        bytes memory hookArgs = abi.encode(IPoolManager(address(pm)), address(0), deployer);
        (address expected, bytes32 salt) = HookMiner.find(
            deployer, uint160(0xAC0), type(MWHookCoordinator).creationCode, hookArgs
        );
        coord = new MWHookCoordinator{salt: salt}(IPoolManager(address(pm)), address(0), deployer);
        require(address(coord) == expected, "coord addr mismatch");

        // DeFi vault seeds the pool's liquidity (replaces retired SocialVault).
        VaultConfig memory cfg = VaultConfig({
            surface:             VaultSurface.DeFi,
            provider:            deployer,
            underlyingToken:     address(usdc),
            treasury:            mevTreasury,
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

        (Currency c0, Currency c1) = usdcIsToken0
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(proj)))
            : (Currency.wrap(address(proj)), Currency.wrap(address(usdc)));
        poolKey = PoolKey({ currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(coord)) });
        poolId  = poolKey.toId();

        // Router under test
        router = new MWRouter(IPoolManager(address(pm)), routerTreasury, FEE_BPS, routerOwner);

        // Fund
        proj.mint(deployer, 1_000_000e6); // owner seeds the pool
        usdc.mint(alice,    500_000e6);   // alice provides deep USDC liquidity
        proj.mint(bob,      100_000e6);   // bob swaps PROJ → USDC

        // Seed team tokens + open a wide LP range, then deposit USDC so swaps have room.
        proj.approve(address(vault), 100_000e6);
        vault.seedTeamTokens(VAULT_ID, address(proj), 100_000e6, poolKey, INIT_SQRT_PRICE);
        vault.rebalance(-60000, 60000);
        vm.startPrank(alice);
        usdc.approve(address(vault), 200_000e6);
        vault.depositWithLock(200_000e6, alice, LockTier.Flex);
        vm.stopPrank();

        // Guard ON with a WIDE band so normal swaps never trip; dynamic fee OFF.
        // configurePool(id, base, max, slopePerTick, maxFeeStepPerBlock, dynFee, guard, maxTickMove, maxDev, catchup)
        coord.configurePool(poolId, 3000, 100000, 0, 0, false, true, 60, 6000, 10);
        vm.roll(1000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _params(uint256 amountIn, uint256 minOut, address recipient, uint256 deadline)
        internal view returns (MWRouter.ExactInputSingleParams memory)
    {
        return MWRouter.ExactInputSingleParams({
            key:              poolKey,
            zeroForOne:       sellProjZeroForOne,
            amountIn:         amountIn,
            amountOutMinimum: minOut,
            recipient:        recipient,
            deadline:         deadline,
            tag:              abi.encode("campaign-1", bob) // campaignId, referrer
        });
    }

    function _swap(address payer, uint256 amountIn, uint256 minOut, address recipient)
        internal returns (uint256 out)
    {
        vm.startPrank(payer);
        proj.approve(address(router), amountIn);
        out = router.swapExactInputSingle(_params(amountIn, minOut, recipient, block.timestamp + 1 hours));
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fee accounting
    // ─────────────────────────────────────────────────────────────────────────

    function test_swap_delivers_output_and_skims_fee() public {
        uint256 amountIn = 1_000e6;
        uint256 recipBefore    = usdc.balanceOf(bob);
        uint256 treasuryBefore = usdc.balanceOf(routerTreasury);

        uint256 userOut = _swap(bob, amountIn, 0, bob);

        uint256 recipDelta    = usdc.balanceOf(bob) - recipBefore;
        uint256 treasuryDelta = usdc.balanceOf(routerTreasury) - treasuryBefore;
        uint256 grossOut      = recipDelta + treasuryDelta;

        assertGt(grossOut, 0, "should produce output");
        assertEq(userOut, recipDelta, "return value == delivered output");
        // Fee is exactly routerFeeBps of gross (floor), and user gets the remainder.
        assertEq(treasuryDelta, (grossOut * FEE_BPS) / 10_000, "fee == 0.5% of gross (floor)");
        assertEq(recipDelta + treasuryDelta, grossOut, "user + fee == gross (no leakage)");
        assertEq(proj.balanceOf(address(router)), 0, "router holds no input dust");
        assertEq(usdc.balanceOf(address(router)), 0, "router holds no output dust");
    }

    function test_swap_to_distinct_recipient() public {
        uint256 amountIn = 1_000e6;
        uint256 carolBefore = usdc.balanceOf(carol);
        uint256 bobProjBefore = proj.balanceOf(bob);

        uint256 userOut = _swap(bob, amountIn, 0, carol);

        assertEq(usdc.balanceOf(carol) - carolBefore, userOut, "recipient (carol) receives output");
        assertEq(bobProjBefore - proj.balanceOf(bob), amountIn, "payer (bob) pays exact input");
        assertEq(usdc.balanceOf(bob), 0, "payer receives nothing when recipient differs");
    }

    function test_zero_fee_gives_user_the_whole_output() public {
        vm.prank(routerOwner);
        router.setRouterFeeBps(0);

        uint256 treasuryBefore = usdc.balanceOf(routerTreasury);
        uint256 recipBefore    = usdc.balanceOf(bob);

        uint256 userOut = _swap(bob, 1_000e6, 0, bob);

        assertEq(usdc.balanceOf(routerTreasury), treasuryBefore, "no fee taken at 0 bps");
        assertEq(usdc.balanceOf(bob) - recipBefore, userOut, "user gets full gross output");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Best-execution floor + guards
    // ─────────────────────────────────────────────────────────────────────────

    function test_reverts_when_output_below_minimum() public {
        // Demand far more output than the pool can give → revert, nothing settles.
        vm.startPrank(bob);
        proj.approve(address(router), 1_000e6);
        // InsufficientOutput carries args, so match on the selector only.
        vm.expectPartialRevert(MWRouter.InsufficientOutput.selector);
        router.swapExactInputSingle(_params(1_000e6, 1_000_000e6, bob, block.timestamp + 1 hours));
        vm.stopPrank();
    }

    function test_reverts_on_expired_deadline() public {
        vm.startPrank(bob);
        proj.approve(address(router), 1_000e6);
        vm.expectRevert(MWRouter.Expired.selector);
        router.swapExactInputSingle(_params(1_000e6, 0, bob, block.timestamp - 1));
        vm.stopPrank();
    }

    function test_reverts_on_zero_amount() public {
        vm.prank(bob);
        vm.expectRevert(MWRouter.ZeroAmount.selector);
        router.swapExactInputSingle(_params(0, 0, bob, block.timestamp + 1 hours));
    }

    function test_reverts_on_zero_recipient() public {
        vm.prank(bob);
        vm.expectRevert(MWRouter.InvalidRecipient.selector);
        router.swapExactInputSingle(_params(1_000e6, 0, address(0), block.timestamp + 1 hours));
    }

    function test_unlockCallback_only_pool_manager() public {
        vm.prank(bob);
        vm.expectRevert(MWRouter.OnlyPoolManager.selector);
        router.unlockCallback("");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────

    function test_setRouterFeeBps_owner_only() public {
        vm.prank(bob);
        vm.expectRevert();
        router.setRouterFeeBps(10);
    }

    function test_setRouterFeeBps_updates() public {
        vm.prank(routerOwner);
        router.setRouterFeeBps(25);
        assertEq(router.routerFeeBps(), 25);
    }

    function test_setRouterFeeBps_rejects_above_cap() public {
        // Read the cap first — evaluating it inside the call args would consume the prank.
        uint16 tooHigh = router.ROUTER_FEE_BPS_CAP() + 1;
        vm.prank(routerOwner);
        vm.expectRevert(MWRouter.FeeTooHigh.selector);
        router.setRouterFeeBps(tooHigh);
    }

    function test_constructor_rejects_zero_treasury() public {
        vm.expectRevert(MWRouter.InvalidAddress.selector);
        new MWRouter(IPoolManager(address(pm)), address(0), FEE_BPS, routerOwner);
    }

    function test_constructor_rejects_fee_above_cap() public {
        vm.expectRevert(MWRouter.FeeTooHigh.selector);
        new MWRouter(IPoolManager(address(pm)), routerTreasury, 101, routerOwner);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Router fee is skimmed exactly through the live coordinator hook
    // ─────────────────────────────────────────────────────────────────────────
    // The original test asserted MWSocialHook's "capture MEV → FeeVault" stream landing
    // alongside the router fee. That mechanism was retired in PR #40: MWHookCoordinator's
    // MEV protection is a sandwich/cooldown *guard*, not a FeeVault skim. The pool here is
    // already hooked with the live coordinator (guard active), so this pins that the router
    // fee accounting stays exact on a swap routed through the real hook.
    function test_router_fee_exact_through_live_coordinator_hook() public {
        uint256 treasuryBefore = usdc.balanceOf(routerTreasury); // router fee target
        uint256 recipBefore    = usdc.balanceOf(bob);

        uint256 userOut = _swap(bob, 1_000e6, 0, bob);

        uint256 routerFee  = usdc.balanceOf(routerTreasury) - treasuryBefore;
        uint256 recipDelta = usdc.balanceOf(bob) - recipBefore;
        uint256 grossOut   = recipDelta + routerFee;

        assertEq(userOut, recipDelta, "user got the net output");
        assertGt(routerFee, 0, "treasury received router fee through the hooked pool");
        assertEq(routerFee, (grossOut * FEE_BPS) / 10_000, "router fee = 0.5% of gross (guard active)");
        assertEq(usdc.balanceOf(address(router)), 0, "router holds no output dust");
    }
}
