// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {MintwareMarketEngineCore} from "../../src/vaults/MintwareMarketEngineCore.sol";
import {MintwareMarketLifecycleModule} from "../../src/vaults/MintwareMarketLifecycleModule.sol";
import {EngineTestToken,EngineTestAdapter,EngineTestMark} from "./MarketEngineTestMocks.sol";

contract MarketEngineCoreHarness is MintwareMarketEngineCore {
    constructor(MarketConfig memory config,bytes32 moduleHash) MintwareMarketEngineCore(config,false,moduleHash) {}
}

contract MarketEngineCoreTest is Test {
    PoolManager pm;
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

    function setUp() public {
        pm=new PoolManager(address(this));
        tokenA=new EngineTestToken("A","A",18);
        tokenB=new EngineTestToken("B","B",18);
        (Currency c0,Currency c1)=address(tokenA)<address(tokenB)
            ?(Currency.wrap(address(tokenA)),Currency.wrap(address(tokenB)))
            :(Currency.wrap(address(tokenB)),Currency.wrap(address(tokenA)));
        token0=EngineTestToken(Currency.unwrap(c0)); token1=EngineTestToken(Currency.unwrap(c1));
        key=PoolKey(c0,c1,3000,60,IHooks(address(0)));
        pm.initialize(key,SQRT);
        mark=new EngineTestMark(address(token1),address(token0));
        MintwareMarketLifecycleModule module=new MintwareMarketLifecycleModule();
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

    function test_I1_exit_fairness_remaining_holder_claim_does_not_fall() public {
        _deposit(alice,100e18,100e18); _deposit(bob,100e18,100e18);
        uint256 b0=engine.balanceOf(bob); uint256 nav0=engine.totalNav();
        uint256 claim0=nav0*b0/engine.totalSupply();
        uint256 exitShares=engine.balanceOf(alice)/3;
        vm.prank(alice); engine.withdraw(exitShares,alice,0,0);
        uint256 nav1=engine.totalNav(); uint256 claim1=nav1*b0/engine.totalSupply();
        assertGe(claim1+1,claim0);
    }

    function test_I2_deposit_does_not_reduce_existing_nav_per_share() public {
        _deposit(alice,100e18,100e18); uint256 beforeNav=engine.totalNav(); uint256 beforeSupply=engine.totalSupply();
        _deposit(bob,30e18,70e18);
        assertGe(engine.totalNav()*beforeSupply, beforeNav*engine.totalSupply());
    }

    function test_I3_measured_mint_rejects_fee_on_transfer_token() public {
        _deposit(alice,100e18,100e18); token0.setTax(100);
        vm.startPrank(bob); vm.expectRevert(); engine.deposit(10e18,10e18,1); vm.stopPrank();
        assertEq(engine.balanceOf(bob),0);
    }

    function test_I4_withdraw_works_while_paused() public {
        _deposit(alice,100e18,100e18); engine.pause();
        uint256 exitShares=engine.balanceOf(alice)/2;
        vm.prank(alice); (uint256 burned,,)=engine.withdraw(exitShares,alice,0,0);
        assertGt(burned,0);
    }

    function test_I4_withdraw_best_effort_when_adapter_shortfalls() public {
        _deposit(alice,100e18,100e18); adapter0.setWithdrawableCap(1e18);
        uint256 exitShares=engine.balanceOf(alice)/2;
        vm.prank(alice); (uint256 burned,,uint256 out1)=engine.withdraw(exitShares,alice,0,0);
        assertGt(burned,0); assertGt(out1,0);
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

    function test_I6_claims_are_backed_by_raw_and_adapter_assets() public {
        _deposit(alice,100e18,100e18); _deposit(bob,25e18,75e18);
        uint256 held0=token0.balanceOf(address(engine))+token0.balanceOf(address(adapter0));
        uint256 held1=token1.balanceOf(address(engine))+token1.balanceOf(address(adapter1));
        assertLe(engine.totalNav(),held0+held1);
        assertLe(engine.totalSupply(),engine.totalNav());
    }
}
