// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PermissionsAdapterFactory} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/PermissionsAdapterFactory.sol";
import {IPermissionsAdapter} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/interfaces/IPermissionsAdapter.sol";
import {IAllowlistChecker} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/interfaces/IAllowlistChecker.sol";
import {MintwareRwaAppraisalHook} from "../src/rwa/MintwareRwaAppraisalHook.sol";
import {MintwareOwnedPoolMarketEngine} from "../src/vaults/MintwareOwnedPoolMarketEngine.sol";
import {MintwareMarketEngineCore} from "../src/vaults/MintwareMarketEngineCore.sol";
import {MintwareIdleYieldAdapter} from "../src/vaults/MintwareIdleYieldAdapter.sol";

/// @notice Base Sepolia only; unsigned simulation unless an operator separately elects to broadcast.
/// @dev Separate from the hookless installer because adapter verification and hook pin/init/bind precede activation.
contract DeployRwaOwnedPool is Script {
    address public constant MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address public constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    struct Install {
        address owner; address keeper; address guardian; address property; address checker;
        address factory; address adapter; address module;
        int24 appraisalTick; uint64 observedAt; bytes32 reportHash;
    }
    function run() external virtual {
        int256 tick = vm.envInt("RWA_APPRAISAL_TICK");
        uint256 observed = vm.envUint("RWA_OBSERVED_AT");
        require(tick >= TickMath.MIN_TICK+600 && tick <= TickMath.MAX_TICK-600 && tick % 60 == 0, "tick range/spacing");
        require(observed <= type(uint64).max, "observation range");
        install(Install(vm.envAddress("RWA_OWNER"),vm.envAddress("RWA_KEEPER"),vm.envAddress("RWA_GUARDIAN"),
            vm.envAddress("RWA_PROPERTY"),vm.envAddress("RWA_CHECKER"),vm.envOr("RWA_FACTORY",address(0)),
            vm.envOr("RWA_ADAPTER",address(0)),vm.envAddress("MARKET_LIFECYCLE_MODULE"),int24(tick),uint64(observed),vm.envBytes32("RWA_REPORT_HASH")));
    }
    function install(Install memory p) public returns (MintwareOwnedPoolMarketEngine engine, MintwareRwaAppraisalHook hook) {
        require(block.chainid == 84532 && MANAGER.code.length != 0 && USDC.code.length != 0, "Base Sepolia only");
        require(p.owner != address(0) && p.property != USDC && p.property.code.length != 0 && p.checker.code.length != 0, "issuer configuration");
        require(p.module.codehash == 0x8dc8c9b181f9dc54d50a53e9cbe3d68cda78f54ffe3add11e9ea6113166b8d5d, "lifecycle hash");
        require(p.appraisalTick % 60 == 0 && p.appraisalTick >= TickMath.MIN_TICK+600 && p.appraisalTick <= TickMath.MAX_TICK-600, "tick range/spacing");
        if (p.factory != address(0)) {
            address referenceFactory = vm.deployCode("PermissionsAdapterFactory.sol:PermissionsAdapterFactory",abi.encode(MANAGER));
            require(p.factory.codehash == referenceFactory.codehash,"official factory runtime");
        }
        vm.startBroadcast(p.owner);
        PermissionsAdapterFactory factory = p.factory == address(0) ? new PermissionsAdapterFactory(MANAGER) : PermissionsAdapterFactory(p.factory);
        require(factory.POOL_MANAGER() == MANAGER, "factory manager");
        IPermissionsAdapter adapter = IPermissionsAdapter(p.adapter == address(0)
            ? factory.createPermissionsAdapter(IERC20(p.property),p.owner,IAllowlistChecker(p.checker)) : p.adapter);
        require(factory.permissionsAdapterOf(address(adapter)) == p.property && adapter.POOL_MANAGER() == MANAGER
            && address(adapter.PERMISSIONED_TOKEN()) == p.property && adapter.owner() == p.owner
            && address(adapter.allowListChecker()) == p.checker, "adapter binding");
        if (factory.verifiedPermissionsAdapterOf(address(adapter)) == address(0)) {
            // Issuer must permit this adapter's native custody before the seed transfer.
            require(IERC20(p.property).transfer(address(adapter),1), "verification seed");
            factory.verifyPermissionsAdapter(address(adapter));
        }
        require(factory.verifiedPermissionsAdapterOf(address(adapter)) == p.property, "verified mapping");
        MintwareRwaAppraisalHook.Config memory cfg = MintwareRwaAppraisalHook.Config(500,1500,1000,1 hours,30 days,3000,10000,2000,7 days);
        bytes memory args = abi.encode(IPoolManager(MANAGER),p.owner,p.keeper,p.guardian,cfg);
        bytes memory code = abi.encodePacked(vm.getCode("MintwareRwaAppraisalHook.sol:MintwareRwaAppraisalHook"),args);
        bytes32 hash = keccak256(code); bytes32 salt; address predicted;
        for (uint256 i; ; ++i) {
            salt=bytes32(i);
            predicted=address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff),CREATE2_FACTORY,salt,hash)))));
            if (uint160(predicted) & 0x3fff == 0x2ac0 && predicted.code.length == 0) break;
        }
        require(CREATE2_FACTORY.code.length != 0,"CREATE2 factory unavailable");
        (bool deployed,) = CREATE2_FACTORY.call(abi.encodePacked(salt,code));
        require(deployed && predicted.code.length != 0,"CREATE2 deployment");
        hook = MintwareRwaAppraisalHook(predicted);
        PoolKey memory key = address(adapter)<USDC
            ? PoolKey(Currency.wrap(address(adapter)),Currency.wrap(USDC),0x800000,60,IHooks(hook))
            : PoolKey(Currency.wrap(USDC),Currency.wrap(address(adapter)),0x800000,60,IHooks(hook));
        hook.pinPoolKey(key,factory,USDC);
        hook.initAppraisal(p.appraisalTick,p.observedAt,p.reportHash);
        IPoolManager(MANAGER).initialize(key,TickMath.getSqrtPriceAtTick(p.appraisalTick));
        MintwareMarketEngineCore.MarketConfig memory c = MintwareMarketEngineCore.MarketConfig(MANAGER,key,USDC,address(hook),p.module,p.owner,
            p.appraisalTick-600,p.appraisalTick+600,30 days,2500,1e6,10_000_000e6,8000,120,600,1 hours);
        engine = new MintwareOwnedPoolMarketEngine(c);
        hook.setVault(address(engine));
        MintwareIdleYieldAdapter a = new MintwareIdleYieldAdapter(address(engine.token0()),address(engine),p.owner,type(uint256).max);
        MintwareIdleYieldAdapter b = new MintwareIdleYieldAdapter(address(engine.token1()),address(engine),p.owner,type(uint256).max);
        engine.configureAdapters(address(a),address(b)); engine.setGuardian(p.guardian);
        adapter.updateAllowedWrapper(address(engine),true);
        require(!engine.activated() && hook.vault() == address(engine), "inactive binding");
        vm.stopBroadcast();
        console2.log("engine (inactive)",address(engine)); console2.log("hook",address(hook));
        console2.log("factory",address(factory)); console2.log("permissions adapter",address(adapter));
        console2.log("idle0",address(a)); console2.log("idle1",address(b));
        console2.log("Before activation: issuer custody and LP permissions; qualified contributors; trusted Universal Router and swap switch.");
    }
}
