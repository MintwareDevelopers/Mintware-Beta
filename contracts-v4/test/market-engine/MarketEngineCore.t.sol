// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TestSwapRouter} from "../helpers/TestSwapRouter.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {MWV4PositionMath} from "../../src/lib/MWV4PositionMath.sol";
import {MintwareMarketEngineCore} from "../../src/vaults/MintwareMarketEngineCore.sol";
import {MintwareMarketLifecycleModule} from "../../src/vaults/MintwareMarketLifecycleModule.sol";
import {EngineTestToken,EngineTestAdapter,EngineTestMark} from "./MarketEngineTestMocks.sol";

contract MarketEngineCoreHarness is MintwareMarketEngineCore {
    constructor(MarketConfig memory config,bytes32 moduleHash) MintwareMarketEngineCore(config,false,moduleHash) {}
}

abstract contract MarketEngineFixture is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    PoolManager pm;
    PoolModifyLiquidityTest lpRouter;
    TestSwapRouter swapRouter;
    EngineTestToken tokenA;
    EngineTestToken tokenB;
    EngineTestToken token0;
    EngineTestToken token1;
    EngineTestMark mark;
    EngineTestAdapter adapter0;
    EngineTestAdapter adapter1;
    MarketEngineCoreHarness engine;
    PoolKey key;
    address alice=makeAddr("alice");
    address bob=makeAddr("bob");
    uint160 constant SQRT=79228162514264337593543950336;

    function setUp() public virtual {
        pm=new PoolManager(address(this));
        lpRouter=new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        swapRouter=new TestSwapRouter(IPoolManager(address(pm)));
        tokenA=new EngineTestToken("A","A",18);
        tokenB=new EngineTestToken("B","B",18);
        (Currency c0,Currency c1)=address(tokenA)<address(tokenB)
            ?(Currency.wrap(address(tokenA)),Currency.wrap(address(tokenB)))
            :(Currency.wrap(address(tokenB)),Currency.wrap(address(tokenA)));
        token0=EngineTestToken(Currency.unwrap(c0)); token1=EngineTestToken(Currency.unwrap(c1));
        key=PoolKey(c0,c1,3000,60,IHooks(address(0)));
        pm.initialize(key,SQRT);
        token0.mint(address(this),2_000_000e18); token1.mint(address(this),2_000_000e18);
        token0.approve(address(lpRouter),type(uint256).max); token1.approve(address(lpRouter),type(uint256).max);
        lpRouter.modifyLiquidity(key,ModifyLiquidityParams(-6000,6000,1_000_000e18,bytes32(0)),"");
        mark=new EngineTestMark(address(token1),address(token0));
        MintwareMarketLifecycleModule module=new MintwareMarketLifecycleModule();
        // Core checks the module runtime hash at construction; use this deployed test module's hash so
        // tests exercise the unchanged core while avoiding the production engine's separately pinned hash.
        engine=new MarketEngineCoreHarness(_config(address(module)),address(module).codehash);
        adapter0=new EngineTestAdapter(token0); adapter1=new EngineTestAdapter(token1);
        adapter0.bind(address(engine)); adapter1.bind(address(engine));
        engine.configureAdapters(address(adapter0),address(adapter1));
        engine.activate();
        for(uint256 i;i<2;++i) {
            address who=i==0?alice:bob;
            token0.mint(who,1_000_000e18); token1.mint(who,1_000_000e18);
            vm.startPrank(who); token0.approve(address(engine),type(uint256).max); token1.approve(address(engine),type(uint256).max); vm.stopPrank();
        }
    }

    function _config(address module) internal view returns(MintwareMarketEngineCore.MarketConfig memory c) {
        c.poolManager=address(pm); c.poolKey=key; c.quoteAsset=address(token0); c.nonQuoteMark=address(mark);
        c.lifecycleModule=module; c.initialOwner=address(this); c.tickLower=-600; c.tickUpper=600;
        c.maxMarkAge=1 days; c.maxSpotMarkDeviationBps=500; c.minInitialContribution=1e18;
        c.principalCap=1_000_000e18; c.maxPositionBps=8000; c.recenterEdgeTicks=120;
        c.maxRecenterTickMove=600; c.recenterCooldown=1 hours;
    }

    function _deposit(address who,uint256 a0,uint256 a1) internal returns(uint256) {
        vm.prank(who); return engine.deposit(a0,a1,1);
    }

    function _deployBand() internal {
        engine.recallIdle(adapter0.totalAssets(),adapter1.totalAssets());
        engine.deployLiquidity(0,0,false,0,0,0,1);
    }

    function _trade(bool zeroForOne,uint256 amount) internal {
        EngineTestToken input=zeroForOne?token0:token1;
        input.approve(address(swapRouter),amount);
        swapRouter.swap(key,zeroForOne,amount);
    }

    function _moveToTick(int24 target) internal {
        for(uint256 i;i<100;++i) {
            (,int24 tick,,)=IPoolManager(address(pm)).getSlot0(key.toId());
            if(tick<=target) return;
            _trade(true,1000e18);
        }
        (,int24 finalTick,,)=IPoolManager(address(pm)).getSlot0(key.toId());
        assertLe(finalTick,target,"swap helper did not reach target tick");
    }

    function _markAtSpot() internal {
        (uint160 spot,,,) = IPoolManager(address(pm)).getSlot0(key.toId());
        mark.set(MWV4PositionMath.quoteValue(1e18,spot,true),uint64(block.timestamp));
    }
}

contract MarketEngineCoreTest is MarketEngineFixture {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    function test_I1_exit_fairness_remaining_holder_claim_does_not_fall() public {
        _deposit(alice,100e18,100e18); _deposit(bob,100e18,100e18);
        _deployBand();
        uint256 b0=engine.balanceOf(bob); uint256 nav0=engine.totalNav();
        uint256 claim0=nav0*b0/engine.totalSupply();
        uint256 exitShares=engine.balanceOf(alice)/3;
        vm.prank(alice); engine.withdraw(exitShares,alice,0,0);
        uint256 nav1=engine.totalNav(); uint256 claim1=nav1*b0/engine.totalSupply();
        assertGe(claim1+1,claim0);
    }

    function test_I2_deposit_does_not_reduce_existing_nav_per_share() public {
        _deposit(alice,100e18,100e18); uint256 beforeNav=engine.totalNav(); uint256 beforeSupply=engine.totalSupply();
        _deployBand(); beforeNav=engine.totalNav(); beforeSupply=engine.totalSupply();
        _deposit(bob,30e18,70e18);
        assertGe(engine.totalNav()*beforeSupply, beforeNav*engine.totalSupply());
    }

    function test_I3_measured_mint_rejects_fee_on_transfer_token() public {
        _deposit(alice,100e18,100e18); token0.setTax(100);
        vm.startPrank(bob); vm.expectRevert(); engine.deposit(10e18,10e18,1); vm.stopPrank();
        assertEq(engine.balanceOf(bob),0);
    }

    function test_I4_withdraw_works_while_paused() public {
        _deposit(alice,100e18,100e18); _deployBand(); engine.pause();
        uint256 exitShares=engine.balanceOf(alice)/2;
        vm.prank(alice); (uint256 burned,,)=engine.withdraw(exitShares,alice,0,0);
        assertGt(burned,0);
    }

    function test_I4_withdraw_best_effort_when_adapter_shortfalls() public {
        _deposit(alice,100e18,100e18); adapter0.setWithdrawableCap(1e18);
        _deployBand();
        uint256 exitShares=engine.balanceOf(alice)/2;
        vm.prank(alice); (uint256 burned,,uint256 out1)=engine.withdraw(exitShares,alice,0,0);
        assertGt(burned,0); assertGt(out1,0);
    }

    function test_I1_incomplete_full_holder_exit_preserves_other_holder_token_claims() public {
        _deposit(alice,200e18,0);
        _deposit(bob,100e18,100e18);
        adapter1.setWithdrawableCap(1e18);
        uint256 shares = engine.balanceOf(bob);
        uint256 supply = engine.totalSupply();
        uint256 aShares = engine.balanceOf(alice);
        (uint256 assets0,uint256 assets1) = _heldAssets();
        uint256 claim0 = assets0 * aShares / supply;
        uint256 claim1 = assets1 * aShares / supply;
        vm.prank(bob);
        (uint256 burned,,) = engine.withdraw(shares,bob,0,0);
        assertLt(burned,shares);
        uint256 nextSupply = engine.totalSupply();
        (assets0,assets1) = _heldAssets();
        uint256 nextClaim0 = assets0 * aShares / nextSupply;
        uint256 nextClaim1 = assets1 * aShares / nextSupply;
        assertGe(nextClaim0 + 1,claim0);
        assertGe(nextClaim1 + 1,claim1);
    }

    function test_withdraw_isolates_frozen_recipient_token_and_burns_only_delivered_value() public {
        _deposit(alice,100e18,100e18);
        _deposit(bob,100e18,100e18);
        token1.freezeRecipient(bob);
        uint256 shares = engine.balanceOf(bob);
        uint256 supply = engine.totalSupply();
        uint256 aShares = engine.balanceOf(alice);
        (uint256 assets0,uint256 assets1) = _heldAssets();
        uint256 claim0 = assets0 * aShares / supply;
        uint256 claim1 = assets1 * aShares / supply;
        vm.prank(bob);
        (uint256 burned,uint256 out0,uint256 out1) = engine.withdraw(shares,bob,0,0);
        assertGt(out0,0);
        assertEq(out1,0);
        assertGt(burned,0);
        assertLt(burned,shares);
        uint256 nextSupply = engine.totalSupply();
        (assets0,assets1) = _heldAssets();
        assertGe(assets0 * aShares / nextSupply + 1,claim0);
        assertGe(assets1 * aShares / nextSupply + 1,claim1);
        assertEq(engine.balanceOf(bob),shares-burned);
    }

    function _heldAssets() internal view returns (uint256 assets0,uint256 assets1) {
        assets0 = token0.balanceOf(address(engine)) + adapter0.totalAssets();
        assets1 = token1.balanceOf(address(engine)) + adapter1.totalAssets();
        uint128 liquidity = engine.positionLiquidity();
        if (liquidity != 0) {
            (uint160 spot,,,) = IPoolManager(address(pm)).getSlot0(key.toId());
            (uint256 lp0,uint256 lp1) = MWV4PositionMath.amountsForLiquidity(
                spot,TickMath.getSqrtPriceAtTick(engine.tickLower()),TickMath.getSqrtPriceAtTick(engine.tickUpper()),liquidity
            );
            assets0 += lp0;
            assets1 += lp1;
        }
    }

    function test_dust_repeated_partial_withdrawals_do_not_revert_or_overdraw() public {
        _deposit(alice,100e18,100e18); _deposit(bob,100e18,100e18);
        for(uint256 i;i<24;++i) {
            uint256 shares=engine.balanceOf(alice)/1000; if(shares==0) break;
            vm.prank(alice); engine.withdraw(shares,alice,0,0);
            assertLe(engine.totalSupply(),engine.totalNav()*1e18/1e18+1);
        }
    }

    function test_fuzz_single_sided_deposit_preserves_existing_nav(uint96 amount) public {
        _deposit(alice,100e18,100e18); amount=uint96(bound(amount,1e15,10e18));
        uint256 n=engine.totalNav(); uint256 s=engine.totalSupply();
        _deposit(bob,amount,0);
        assertGe(engine.totalNav()*s,n*engine.totalSupply());
    }

    function test_MARK_update_accrued_yield_counts_in_nav() public {
        _deposit(alice,100e18,100e18); uint256 beforeNav=engine.totalNav();
        adapter0.accrue(5e18); assertGt(engine.totalNav(),beforeNav);
        mark.set(1e18,uint64(block.timestamp)); (uint256 price,)=mark.latestMark(); assertEq(price,1e18);
    }

    function test_I6_claims_are_covered_by_deployed_and_idle_assets() public {
        _deposit(alice,100e18,100e18); _deposit(bob,25e18,75e18);
        _deployBand();
        uint256 held0=token0.balanceOf(address(engine))+token0.balanceOf(address(adapter0));
        uint256 held1=token1.balanceOf(address(engine))+token1.balanceOf(address(adapter1));
        (uint160 spot,,,) = IPoolManager(address(pm)).getSlot0(key.toId());
        (uint256 pos0,uint256 pos1)=MWV4PositionMath.amountsForLiquidity(
            spot,TickMath.getSqrtPriceAtTick(engine.tickLower()),TickMath.getSqrtPriceAtTick(engine.tickUpper()),engine.positionLiquidity()
        );
        held0+=pos0; held1+=pos1;
        (uint256 price,)=mark.latestMark();
        uint256 markedAssets=held0+held1*price/1e18;
        assertLe(engine.totalNav(),markedAssets);
    }

    function test_I5_recenter_reverts_inside_edge_margin() public {
        _deposit(alice,100e18,100e18); _deployBand();
        vm.warp(block.timestamp+1 hours);
        vm.expectRevert(MintwareMarketEngineCore.RecenterNotDue.selector); engine.recenter(1);
    }

    function test_I5_recenter_reverts_before_cooldown() public {
        _deposit(alice,100e18,100e18); _deployBand(); _moveToTick(-480); _markAtSpot(); vm.warp(block.timestamp+1 hours);
        engine.recenter(1);
        vm.expectRevert(MintwareMarketEngineCore.RecenterNotDue.selector); engine.recenter(1);
    }

    function test_I5_recenter_reverts_beyond_max_tick_move() public {
        _deposit(alice,100e18,100e18); _deployBand(); _moveToTick(-660); _markAtSpot(); vm.warp(block.timestamp+1 hours);
        vm.expectRevert(MintwareMarketEngineCore.RecenterMoveExceeded.selector); engine.recenter(1);
    }

    function test_I5_recenter_reverts_when_spot_deviates_from_mark() public {
        _deposit(alice,100e18,100e18); _deployBand(); _moveToTick(-1200); vm.warp(block.timestamp+1 hours);
        vm.expectRevert(MintwareMarketEngineCore.PoolMarkDeviationExceeded.selector); engine.recenter(1);
    }

    function test_I5_recenter_succeeds_when_all_guards_pass() public {
        _deposit(alice,100e18,100e18); _deployBand(); _moveToTick(-480); _markAtSpot(); vm.warp(block.timestamp+1 hours);
        int24 oldLower=engine.tickLower(); engine.recenter(1);
        assertTrue(engine.tickLower()!=oldLower); assertGt(engine.positionLiquidity(),0);
    }
}
