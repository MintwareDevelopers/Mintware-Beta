// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {MarketEngineFixture} from "../market-engine/MarketEngineCore.t.sol";
contract StaleMarkRegression is MarketEngineFixture {
 function test_MW05_fullExitSucceedsWithStaleMark() public {
  _deposit(alice,100e18,100e18);
  uint256 shares=engine.balanceOf(alice);
  vm.warp(block.timestamp+2 days);
  vm.expectRevert();engine.totalNav();
  vm.prank(alice);(uint256 burned,uint256 amount0,uint256 amount1)=engine.withdraw(shares,alice,0,0);
  assertEq(burned,shares);assertEq(amount0,100e18);assertEq(amount1,100e18);
 }
}
