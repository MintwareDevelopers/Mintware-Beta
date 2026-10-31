// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {DeployRwaOwnedPool} from "./DeployRwaOwnedPool.s.sol";
import {OwnedIssuerToken, IssuerAllowlist} from "../test/rwa/OwnedPoolFixtures.sol";
/// @dev Offline simulation harness only: fixture state at Base Sepolia addresses; no RPC or keys.
contract RehearseRwaOwnedPool is DeployRwaOwnedPool {
    function run() external override {
        vm.chainId(84532); vm.warp(10 days);
        _deployAt("PoolManager.sol:PoolManager",abi.encode(address(0x1234)),MANAGER);
        _deployAt("OwnedPoolFixtures.sol:OwnedIssuerToken",abi.encode(uint8(6),false),USDC);
        OwnedIssuerToken property = new OwnedIssuerToken(18,false);
        IssuerAllowlist checker = new IssuerAllowlist();
        address owner=address(0x1234); property.mint(owner,1);
        address module = _deploy("MintwareMarketLifecycleModule.sol:MintwareMarketLifecycleModule","");
        address factory = _deploy("PermissionsAdapterFactory.sol:PermissionsAdapterFactory",abi.encode(MANAGER));
        int24 tick = vm.computeCreateAddress(factory,1) < USDC ? int24(-230280) : int24(230280);
        install(Install(owner,owner,owner,address(property),address(checker),factory,address(0),module,tick,uint64(block.timestamp),keccak256("rehearsal report")));
    }
    function _deploy(string memory artifact,bytes memory args) private returns (address deployed) {
        bytes memory code=abi.encodePacked(vm.getCode(artifact),args);
        assembly ("memory-safe") { deployed := create(0,add(code,32),mload(code)) }
        require(deployed!=address(0),"fixture deployment");
    }
    function _deployAt(string memory artifact,bytes memory args,address target) private {
        vm.etch(target,abi.encodePacked(vm.getCode(artifact),args));
        (bool ok,bytes memory runtime)=target.call(""); require(ok,"fixture constructor");
        vm.etch(target,runtime);
    }
}
