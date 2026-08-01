// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

// V4 core
import {PoolManager}         from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary}        from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

// Our contracts
import {FeeVault}            from "../src/FeeVault.sol";
import {SocialVault}         from "../src/SocialVault.sol";
import {MWSocialHook}        from "../src/MWSocialHook.sol";
import {MWRouter}            from "../src/MWRouter.sol";
import {HookMiner}           from "../src/lib/HookMiner.sol";

// Test helpers
import {MockERC20}           from "./mocks/MockERC20.sol";

/// @title  MWRouter tests — internal swap + router-fee skim against a real V4 pool
/// @notice Mirrors Integration.t.sol's harness (real PoolManager, mined hook, seeded
///         pool) and proves: exact fee accounting, best-execution floor, guards, admin,
///         and that the router fee coexists with the hook's MEV capture (two streams).
contract MWRouterTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

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
    SocialVault internal socialVault;
    MWSocialHook internal hook;
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

        bytes memory hookArgs = abi.encode(
            IPoolManager(address(pm)), address(usdc), address(feeVault),
            mevTreasury, address(0), address(0), deployer
        );
        (, bytes32 salt) = HookMiner.find(deployer, uint160(0x0AC4), type(MWSocialHook).creationCode, hookArgs);
        hook = new MWSocialHook{salt: salt}(
            IPoolManager(address(pm)), address(usdc), address(feeVault),
            mevTreasury, address(0), address(0), deployer
        );

        socialVault = new SocialVault(address(usdc), address(pm), address(feeVault));
        hook.setSocialVault(address(socialVault));
        feeVault.setSocialVault(address(socialVault));
        feeVault.setHook(address(hook));

        (Currency c0, Currency c1) = usdcIsToken0
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(proj)))
            : (Currency.wrap(address(proj)), Currency.wrap(address(usdc)));
        poolKey = PoolKey({ currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(hook)) });
        poolId  = poolKey.toId();

        // Router under test
        router = new MWRouter(IPoolManager(address(pm)), routerTreasury, FEE_BPS, routerOwner);

        // Fund
        proj.mint(deployer, 1_000_000e6); // owner seeds the pool
        usdc.mint(alice,    500_000e6);   // alice provides deep liquidity
        proj.mint(bob,      100_000e6);   // bob swaps PROJ → USDC

        // Seed + rebalance + deep liquidity so swaps have room
        proj.approve(address(socialVault), 100_000e6);
        socialVault.seedTeamTokens(VAULT_ID, address(proj), 100_000e6, poolKey, INIT_SQRT_PRICE);
        socialVault.rebalance(-60000, 60000);
        vm.startPrank(alice);
        usdc.approve(address(socialVault), 200_000e6);
        socialVault.deposit(200_000e6, SocialVault.LockTier.Flex);
        vm.stopPrank();
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
    // Two streams: hook MEV capture AND router fee on one swap
    // ─────────────────────────────────────────────────────────────────────────

    function test_router_fee_coexists_with_hook_mev_capture() public {
        // Configure the pool for MEV capture and set a reference price ~2% off so the
        // hook's afterSwap fires and routes USDC to the FeeVault.
        hook.configurePool(poolId, bytes32(0), 6, 6, 20, 50, 0);
        (uint160 currentSqrt,,,) = IPoolManager(address(pm)).getSlot0(poolId);
        hook.setReferencePrice(poolId, uint160(currentSqrt + currentSqrt / 50));

        uint256 feeVaultBefore  = usdc.balanceOf(address(feeVault));      // hook capture target
        uint256 treasuryBefore  = usdc.balanceOf(routerTreasury);         // router fee target
        uint256 recipBefore     = usdc.balanceOf(bob);

        uint256 userOut = _swap(bob, 1_000e6, 0, bob);

        uint256 hookCapture = usdc.balanceOf(address(feeVault)) - feeVaultBefore;
        uint256 routerFee   = usdc.balanceOf(routerTreasury) - treasuryBefore;
        uint256 recipDelta  = usdc.balanceOf(bob) - recipBefore;

        // Both streams paid, to distinct addresses.
        assertGt(hookCapture, 0, "FeeVault received hook MEV capture");
        assertGt(routerFee,   0, "treasury received router fee");
        assertEq(userOut, recipDelta, "user got the net output");

        // Router fee is 0.5% of the GROSS the router received — which is already net of
        // the hook's capture. So: grossToRouter = recipDelta + routerFee.
        uint256 grossToRouter = recipDelta + routerFee;
        assertEq(routerFee, (grossToRouter * FEE_BPS) / 10_000, "router fee = 0.5% of post-capture output");
        console2.log("hook capture (USDC):", hookCapture);
        console2.log("router fee   (USDC):", routerFee);
        console2.log("user out     (USDC):", userOut);
    }
}
