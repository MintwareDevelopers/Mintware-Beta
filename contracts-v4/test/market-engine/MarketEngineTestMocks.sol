// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMarketAdapterBinding} from "../../src/vaults/IMarketAdapterBinding.sol";
import {IMarketAssetMark} from "../../src/vaults/IMarketAssetMark.sol";

contract EngineTestToken is ERC20 {
    uint8 private immutable _decimals;
    uint16 public taxBps;
    constructor(string memory n, string memory s, uint8 d) ERC20(n,s) { _decimals=d; }
    function decimals() public view override returns(uint8) { return _decimals; }
    function mint(address to,uint256 amount) external { _mint(to,amount); }
    function setTax(uint16 bps) external { taxBps=bps; }
    function _update(address from,address to,uint256 amount) internal override {
        if (from != address(0) && to != address(0) && taxBps != 0) {
            uint256 fee=amount*taxBps/10_000;
            super._update(from,to,amount-fee);
            super._update(from,address(0),fee);
        } else super._update(from,to,amount);
    }
}

contract EngineTestAdapter is IMarketAdapterBinding {
    IERC20 public immutable asset;
    address public vault;
    uint256 public withdrawableCap=type(uint256).max;
    constructor(IERC20 a) { asset=a; }
    function bind(address v) external { require(vault==address(0)); vault=v; }
    function deposit(uint256 amount) external { require(msg.sender==vault); require(asset.transferFrom(vault,address(this),amount)); }
    function withdraw(uint256 amount) external returns(uint256 got) {
        require(msg.sender==vault); uint256 bal=asset.balanceOf(address(this)); got=amount<bal?amount:bal;
        if(got>withdrawableCap) got=withdrawableCap; if(got>0) require(asset.transfer(vault,got));
    }
    function totalAssets() external view returns(uint256) { return asset.balanceOf(address(this)); }
    function maxWithdrawable() external view returns(uint256 b) { b=asset.balanceOf(address(this)); if(b>withdrawableCap)b=withdrawableCap; }
    function maxSuppliable() external pure returns(uint256) { return type(uint256).max; }
    function setWithdrawableCap(uint256 cap) external { withdrawableCap=cap; }
    function accrue(uint256 amount) external { EngineTestToken(address(asset)).mint(address(this),amount); }
}

contract EngineTestMark is IMarketAssetMark {
    address public immutable asset;
    address public immutable quoteAsset;
    uint256 public price=1e18;
    uint64 public updatedAt=uint64(block.timestamp);
    constructor(address a,address q) { asset=a; quoteAsset=q; }
    function set(uint256 p,uint64 t) external { price=p; updatedAt=t; }
    function latestMark() external view returns(uint256,uint64) { return(price,updatedAt); }
}
