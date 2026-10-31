// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {MarketEngineFixture,MarketEngineCoreHarness} from "../market-engine/MarketEngineCore.t.sol";
import {MintwareMarketEngineCore} from "../../src/vaults/MintwareMarketEngineCore.sol";
import {MintwareMarketLifecycleModule} from "../../src/vaults/MintwareMarketLifecycleModule.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {EngineTestAdapter} from "../market-engine/MarketEngineTestMocks.sol";
import {MockERC4626} from "../mocks/MockERC4626.sol";
contract RecallSurplusRegression is MarketEngineFixture {
 MockERC4626 source;
 MintwareERC4626YieldAdapter realAdapter;
 function _setupRealAdapter() internal {
  MintwareMarketLifecycleModule module=new MintwareMarketLifecycleModule();
  engine=new MarketEngineCoreHarness(_config(address(module)),address(module).codehash);
  source=new MockERC4626(token0);
  realAdapter=new MintwareERC4626YieldAdapter(address(token0),address(source),address(engine),address(this));
  adapter1=new EngineTestAdapter(token1);adapter1.bind(address(engine));
  engine.configureAdapters(address(realAdapter),address(adapter1));engine.activate();
  vm.startPrank(alice);token0.approve(address(engine),type(uint256).max);token1.approve(address(engine),type(uint256).max);vm.stopPrank();
  vm.startPrank(bob);token0.approve(address(engine),type(uint256).max);token1.approve(address(engine),type(uint256).max);vm.stopPrank();
  _deposit(alice,100e18,100e18);_deposit(bob,100e18,100e18);
  token0.mint(address(source),200e18);
 }
 function test_MW02_roundingSurplusRecallIsAccounted() public {
  _setupRealAdapter();
  uint256 want=100e18+2;
  uint256 redeemed=source.previewRedeem(source.previewWithdraw(want));
  emit log_named_uint("requested",want);emit log_named_uint("redeem pays",redeemed);
  assertGt(redeemed,want);
  uint256 navBefore=engine.totalNav();
  engine.recallIdle(want,0);
  assertEq(token0.balanceOf(address(engine)),redeemed);
  assertApproxEqAbs(engine.totalNav(),navBefore,2);
 }
 function test_MW02_roundingSurplusDoesNotBlockLiquidExit() public {
  _setupRealAdapter();
  uint256 shares=100e18+1;
  uint256 requested=realAdapter.totalAssets()*shares/engine.totalSupply();
  uint256 redeemed=source.previewRedeem(source.previewWithdraw(requested));
  emit log_named_uint("requested",requested);emit log_named_uint("redeem pays",redeemed);
  assertGt(redeemed,requested);
  uint256 bobBefore=engine.totalNav()*engine.balanceOf(bob)/engine.totalSupply();
  vm.prank(alice);
  (uint256 burned,uint256 out0,uint256 out1)=engine.withdraw(shares,alice,0,0);
  assertEq(burned,shares);
  assertEq(out0,requested);
  assertGt(out1,0);
  assertEq(token0.balanceOf(address(engine)),redeemed-requested);
  assertApproxEqAbs(engine.totalNav()*engine.balanceOf(bob)/engine.totalSupply(),bobBefore,2);
 }
}
