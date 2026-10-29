// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { MintwareYieldVault } from "../src/payments/MintwareYieldVault.sol";
import { MintwarePaymentGateway } from "../src/payments/MintwarePaymentGateway.sol";
import { MintwareIdleYieldAdapter } from "../src/vaults/MintwareIdleYieldAdapter.sol";
import { MintwareERC4626YieldAdapter } from "../src/vaults/MintwareERC4626YieldAdapter.sol";

/// @notice Base Sepolia Earn lane deployment. Use --broadcast only against a local rehearsal node
///         or when an explicitly authorized Sepolia deployment is intended. Reads no dotenv files.
contract DeployEarnSepolia is Script {
    uint256 constant DEFAULT_GLOBAL_CAP = 1_000_000_000;
    uint256 constant DEFAULT_USER_CAP = 1_000_000_000;
    uint256 constant MAX_CAP = 1_000_000_000_000;

    function run() external {
        require(block.chainid == 84532, "Base Sepolia only");
        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        address asset = vm.envAddress("EARN_ASSET");
        address admin = vm.envOr("EARN_ADMIN", deployer);
        address relayer = vm.envOr("EARN_RELAYER", admin);
        address pauser = vm.envOr("EARN_PAUSER", admin);
        address member = vm.envAddress("EARN_CAP_MEMBER");
        uint256 globalCap = vm.envOr("EARN_GLOBAL_REFILL_CAP", uint256(500_000_000));
        uint256 userCap = vm.envOr("EARN_USER_REFILL_CAP", uint256(100_000_000));
        require(
            asset != address(0) && admin != address(0) && relayer != address(0)
                && pauser != address(0),
            "zero config"
        );
        require(member != address(0), "EARN_CAP_MEMBER required");
        require(
            globalCap <= DEFAULT_GLOBAL_CAP && userCap <= DEFAULT_USER_CAP,
            "cap increase needs 48h timelock"
        );
        require(globalCap <= MAX_CAP && userCap <= MAX_CAP, "cap exceeds contract maximum");

        string memory mode = vm.envOr("EARN_ADAPTER_MODE", string("idle"));
        address adapter;
        MintwareYieldVault vault;
        MintwarePaymentGateway gateway;

        vm.startBroadcast(privateKey);
        if (keccak256(bytes(mode)) == keccak256("idle")) {
            uint256 idleCap = vm.envOr("EARN_IDLE_DEPOSIT_CAP", uint256(10_000_000_000));
            MintwareIdleYieldAdapter idle =
                new MintwareIdleYieldAdapter(asset, address(0), deployer, idleCap);
            adapter = address(idle);
            vault = new MintwareYieldVault(asset, adapter, deployer);
            idle.setVault(address(vault));
        } else if (keccak256(bytes(mode)) == keccak256("erc4626")) {
            address source = vm.envAddress("EARN_YIELD_SOURCE");
            MintwareERC4626YieldAdapter erc4626 =
                new MintwareERC4626YieldAdapter(asset, source, address(0), deployer);
            adapter = address(erc4626);
            vault = new MintwareYieldVault(asset, adapter, deployer);
            erc4626.setVault(address(vault));
        } else {
            revert("EARN_ADAPTER_MODE must be idle or erc4626");
        }

        gateway = new MintwarePaymentGateway(address(vault), admin);
        vault.setGateway(address(gateway));
        gateway.grantRole(gateway.RELAYER_ROLE(), relayer);
        gateway.grantRole(gateway.PAUSER_ROLE(), pauser);
        gateway.setGlobalCap(globalCap);
        gateway.setUserCap(member, userCap);
        vm.stopBroadcast();

        console2.log("EARN_DEPLOY_PASS");
        console2.log("asset", asset);
        console2.log("adapter_mode", mode);
        console2.log("adapter", adapter);
        console2.log("vault", address(vault));
        console2.log("gateway", address(gateway));
        console2.log("deployer_owner", deployer);
        console2.log("admin", admin);
        console2.log("relayer", relayer);
        console2.log("pauser", pauser);
        console2.log("cap_member", member);
        console2.log("global_cap", globalCap);
        console2.log("user_cap", userCap);
    }
}
