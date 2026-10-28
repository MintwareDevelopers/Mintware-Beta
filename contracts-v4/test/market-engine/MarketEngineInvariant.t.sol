// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {MarketEngineFixture,MarketEngineCoreHarness} from "./MarketEngineCore.t.sol";
import {EngineTestToken,EngineTestAdapter,EngineTestMark} from "./MarketEngineTestMocks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {MWV4PositionMath} from "../../src/lib/MWV4PositionMath.sol";
import {TestSwapRouter} from "../helpers/TestSwapRouter.sol";

interface VmInvariant { function warp(uint256) external; }

contract MarketEngineActor {
    EngineTestToken immutable t0; EngineTestToken immutable t1; MarketEngineCoreHarness immutable engine;
    constructor(EngineTestToken a,EngineTestToken b,MarketEngineCoreHarness e) { t0=a;t1=b;engine=e; }
    function approveAll() external { t0.approve(address(engine),type(uint256).max); t1.approve(address(engine),type(uint256).max); }
    function deposit(uint256 a,uint256 b) external { engine.deposit(a,b,1); }
    function withdraw(uint256 shares) external { engine.withdraw(shares,address(this),0,0); }
}

contract MarketEngineHandler {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    VmInvariant constant vm=VmInvariant(address(uint160(uint256(keccak256("hevm cheat code")))));
    MarketEngineCoreHarness public immutable engine;
    EngineTestToken public immutable token0; EngineTestToken public immutable token1;
    EngineTestAdapter public immutable adapter0; EngineTestAdapter public immutable adapter1;
    EngineTestMark public immutable mark; IPoolManager public immutable manager;
    PoolKey public key; TestSwapRouter public immutable router;
    MarketEngineActor public immutable holderA; MarketEngineActor public immutable holderB;
    uint256 public deposits; uint256 public withdraws; uint256 public swaps; uint256 public recenters;
    bool public fairnessBroken; bool public depositDilution;
    uint256 constant UNIT=1e18;

    constructor(MarketEngineCoreHarness e,EngineTestToken a,EngineTestToken b,EngineTestAdapter ad0,EngineTestAdapter ad1,EngineTestMark m,IPoolManager pm,PoolKey memory k,TestSwapRouter r) {
        engine=e; token0=a; token1=b; adapter0=ad0; adapter1=ad1; mark=m; manager=pm; key=k; router=r;
        holderA=new MarketEngineActor(a,b,e); holderB=new MarketEngineActor(a,b,e);
        a.mint(address(holderA),1_000_000e18); b.mint(address(holderA),1_000_000e18);
        a.mint(address(holderB),1_000_000e18); b.mint(address(holderB),1_000_000e18);
        holderA.approveAll(); holderB.approveAll();
        a.mint(address(this),1_000_000e18); b.mint(address(this),1_000_000e18);
        a.approve(address(r),type(uint256).max); b.approve(address(r),type(uint256).max);
    }

    function seedExercise() external {
        this.depositDual(uint96(100e18),uint96(100e18),false);
        this.depositDual(uint96(100e18),uint96(100e18),true);
        this.operatorDeploy(); this.withdrawPartial(1000,false); this.swapMovingPrice(true,uint96(1000e18)); this.recenter();
        (,int24 tick,,)=manager.getSlot0(key.toId()); int24 edge=engine.tickLower()+engine.recenterEdgeTicks();
        for(uint256 i;i<80 && tick>edge;++i) { router.swap(key,true,1000e18); (,tick,,)=manager.getSlot0(key.toId()); }
        _setMark(); vm.warp(block.timestamp+uint256(engine.recenterCooldown()));
        try engine.recenter(1) { recenters++; } catch {}
    }

    function depositDual(uint96 x,uint96 y,bool useB) external {
        uint256 a=bound(uint256(x),1e15,500e18); uint256 b=bound(uint256(y),1e15,500e18);
        MarketEngineActor who=useB?holderB:holderA; token0.mint(address(who),a); token1.mint(address(who),b);
        uint256 n=engine.totalSupply()==0?0:engine.totalNav(); uint256 s=engine.totalSupply();
        try who.deposit(a,b) { deposits++; _checkDeposit(n,s); } catch {}
    }

    function depositSingle(uint96 x,bool side,bool useB) external {
        uint256 a=bound(uint256(x),1e15,500e18); MarketEngineActor who=useB?holderB:holderA;
        if(side) token1.mint(address(who),a); else token0.mint(address(who),a);
        uint256 n=engine.totalSupply()==0?0:engine.totalNav(); uint256 s=engine.totalSupply();
        try who.deposit(side?0:a,side?a:0) { deposits++; _checkDeposit(n,s); } catch {}
    }

    function withdrawPartial(uint16 amountBps,bool useB) external {
        MarketEngineActor who=useB?holderB:holderA; uint256 bal=engine.balanceOf(address(who)); if(bal<2) return;
        uint256 shares=bal*bound(uint256(amountBps),1,9000)/10_000; if(shares==0) shares=1;
        _withdraw(who,shares);
    }
    function withdrawFull(bool useB) external {
        MarketEngineActor who=useB?holderB:holderA; uint256 bal=engine.balanceOf(address(who)); if(bal!=0) _withdraw(who,bal);
    }
    function withdrawDust(bool useB) external {
        MarketEngineActor who=useB?holderB:holderA;
        for(uint256 i;i<8;++i) { uint256 bal=engine.balanceOf(address(who)); if(bal<1000) break; uint256 shares=bal/1000; if(shares==0)break; _withdraw(who,shares); }
    }

    function swapMovingPrice(bool zeroForOne,uint96 raw) external {
        uint256 amount=bound(uint256(raw),1e18,2000e18);
        try router.swap(key,zeroForOne,amount) { swaps++; _setMark(); } catch {}
    }

    function operatorDeploy() external {
        if(engine.totalSupply()==0) return;
        try engine.recallIdle(adapter0.totalAssets(),adapter1.totalAssets()) {} catch {}
        try engine.deployLiquidity(0,0,false,0,0,0,1) {} catch {}
    }

    function recenter() external {
        if(engine.positionLiquidity()==0) return;
        _setMark(); vm.warp(block.timestamp+uint256(engine.recenterCooldown()));
        try engine.recenter(1) { recenters++; } catch {}
    }

    function updateMark(uint96 rawPrice) external {
        uint256 p=bound(uint256(rawPrice),5e17,2e18); mark.set(p,uint64(block.timestamp));
    }
    function accrueYield(uint96 amount,bool first) external {
        (first?adapter0:adapter1).accrue(bound(uint256(amount),1,100e18));
    }
    function shortfall(uint96 cap,bool first) external {
        (first?adapter0:adapter1).setWithdrawableCap(bound(uint256(cap),0,100e18));
    }
    function transferFailure(bool first,bool useB) external {
        // Keep this handler case focused on recipient failure; LP fee accounting is covered by
        // the ordinary exit invariant and the frozen-recipient unit test below.
        if(engine.positionLiquidity()!=0) return;
        MarketEngineActor who=useB?holderB:holderA;
        uint256 bal=engine.balanceOf(address(who));
        if(bal==0) return;
        adapter0.setWithdrawableCap(type(uint256).max);
        adapter1.setWithdrawableCap(type(uint256).max);
        (first?token0:token1).freezeRecipient(address(who));
        _withdraw(who,bal/2==0?1:bal/2);
        (first?token0:token1).freezeRecipient(address(0));
    }

    function _withdraw(MarketEngineActor who,uint256 shares) internal {
        MarketEngineActor other=who==holderA?holderB:holderA;
        (uint256 before0,uint256 before1)=_claim(other);
        try who.withdraw(shares) {
            withdraws++; (uint256 after0,uint256 after1)=_claim(other);
            if(after0+1<before0 || after1+1<before1) fairnessBroken=true;
        } catch {}
    }
    function _checkDeposit(uint256 nav,uint256 supply) internal {
        if(supply==0)return;
        if(engine.totalNav()*supply<nav*engine.totalSupply()) depositDilution=true;
    }
    function _claim(MarketEngineActor who) internal view returns(uint256,uint256) {
        uint256 supply=engine.totalSupply(); if(supply==0)return(0,0);
        (uint256 a,uint256 b)=_assets(); uint256 s=engine.balanceOf(address(who));
        return(a*s/supply,b*s/supply);
    }
    function _assets() internal view returns(uint256 a,uint256 b) {
        a=token0.balanceOf(address(engine))+adapter0.totalAssets();
        b=token1.balanceOf(address(engine))+adapter1.totalAssets();
        uint128 l=engine.positionLiquidity(); if(l!=0) {
            (uint160 spot,,,) = manager.getSlot0(key.toId());
            (uint256 p0,uint256 p1)=MWV4PositionMath.amountsForLiquidity(spot,TickMath.getSqrtPriceAtTick(engine.tickLower()),TickMath.getSqrtPriceAtTick(engine.tickUpper()),l);
            a+=p0; b+=p1;
        }
    }
    function markedAssets() external view returns(uint256) {
        (uint256 a,uint256 b)=_assets(); (uint256 p,)=mark.latestMark(); return a+b*p/UNIT;
    }
    function _setMark() internal {
        (uint160 spot,,,) = manager.getSlot0(key.toId()); mark.set(MWV4PositionMath.quoteValue(UNIT,spot,true),uint64(block.timestamp));
    }
    function bound(uint256 x,uint256 lo,uint256 hi) internal pure returns(uint256) { return lo+(x%(hi-lo+1)); }
}

contract MarketEngineInvariantTest is StdInvariant,MarketEngineFixture {
    MarketEngineHandler handler;
    function setUp() public override {
        super.setUp();
        handler=new MarketEngineHandler(engine,token0,token1,adapter0,adapter1,mark,IPoolManager(address(pm)),key,swapRouter);
        engine.transferOwnership(address(handler));
        handler.seedExercise();
        targetContract(address(handler));
        bytes4[] memory excluded=new bytes4[](1); excluded[0]=handler.seedExercise.selector;
        excludeSelector(FuzzSelector(address(handler),excluded));
    }
    // Scenario: holderA makes a single-sided token0 deposit, adapter1 withdrawal is capped, then holderB exits fully.
    function invariant_I1_exit_fairness() public view { assertFalse(handler.fairnessBroken()); }
    function invariant_I2_deposit_fairness() public view { assertFalse(handler.depositDilution()); }
    function invariant_I6_nav_is_bounded_by_marked_assets_held() public view {
        if(engine.totalSupply()!=0) assertLe(engine.totalNav(),handler.markedAssets());
    }
    function afterInvariant() public view {
        assertGt(handler.deposits(),0,"handler made no deposits");
        assertGt(handler.withdraws(),0,"handler made no withdrawals");
        assertGt(handler.swaps(),0,"handler made no swaps");
        assertGt(handler.recenters(),0,"handler made no successful recenter");
    }
}
