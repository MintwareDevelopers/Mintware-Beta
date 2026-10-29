// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { MintwareYieldVault } from "../src/payments/MintwareYieldVault.sol";
import { MintwarePaymentGateway } from "../src/payments/MintwarePaymentGateway.sol";

/// @notice Read-only Earn lane verifier. All checks are eth_call reads; no broadcast or signer needed.
contract VerifyEarnSepolia is Script {
    function run() external view {
        address asset = vm.envAddress("EARN_ASSET");
        address adapter = vm.envAddress("EARN_ADAPTER");
        address vaultAddress = vm.envAddress("EARN_VAULT");
        address gatewayAddress = vm.envAddress("EARN_GATEWAY");
        address admin = vm.envAddress("EARN_ADMIN");
        address relayer = vm.envAddress("EARN_RELAYER");
        address pauser = vm.envAddress("EARN_PAUSER");
        address member = vm.envAddress("EARN_CAP_MEMBER");
        uint256 globalCap = vm.envOr("EARN_GLOBAL_REFILL_CAP", uint256(500_000_000));
        uint256 userCap = vm.envOr("EARN_USER_REFILL_CAP", uint256(100_000_000));

        MintwareYieldVault vault = MintwareYieldVault(vaultAddress);
        MintwarePaymentGateway gateway = MintwarePaymentGateway(gatewayAddress);
        bool all = true;
        all = _check("Base Sepolia chain id", block.chainid == 84532) && all;
        all = _check("adapter code", adapter.code.length > 0) && all;
        all = _check("vault code", vaultAddress.code.length > 0) && all;
        all = _check("gateway code", gatewayAddress.code.length > 0) && all;
        all = _check("vault asset", address(vault.asset()) == asset) && all;
        all = _check("vault adapter", address(vault.adapter()) == adapter) && all;
        all = _check("adapter vault", _addressRead(adapter, "vault()") == vaultAddress) && all;
        all = _check("gateway vault", address(gateway.vault()) == vaultAddress) && all;
        all = _check("vault gateway", vault.gateway() == gatewayAddress) && all;
        all = _check("admin role", gateway.hasRole(gateway.DEFAULT_ADMIN_ROLE(), admin)) && all;
        all = _check("relayer role", gateway.hasRole(gateway.RELAYER_ROLE(), relayer)) && all;
        all = _check("pauser role", gateway.hasRole(gateway.PAUSER_ROLE(), pauser)) && all;
        all = _check("global refill cap", gateway.globalCap() == globalCap) && all;
        all = _check("member refill cap", gateway.userCap(member) == userCap) && all;
        console2.log(all ? "EARN_VERIFY_PASS" : "EARN_VERIFY_FAIL");
        require(all, "Earn lane verification failed");
    }

    function _addressRead(address target, string memory signature)
        private
        view
        returns (address value)
    {
        (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSignature(signature));
        if (!ok || data.length < 32) return address(0);
        value = abi.decode(data, (address));
    }

    function _check(string memory label, bool passed) private pure returns (bool) {
        console2.log(passed ? "PASS" : "FAIL", label);
        return passed;
    }
}
