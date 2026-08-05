// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {MintwareVRWA, TransferMode}   from "../src/rwa/MintwareVRWA.sol";
import {SPVBeneficiaryRegistry}       from "../src/rwa/SPVBeneficiaryRegistry.sol";

/// @notice WS1 enrollment for a **Reg D** RWA deal (three-role model). Points vRWA at the KYC
///         registry, enrolls the infra permitted holders (PoolManager / MWRouter / vault / issuer /
///         ULV), sets the KYC provider (oracle) on the registry, and PROPOSES the flip to
///         WHITELISTED. Because the transfer-mode change is behind a 48h timelock, run in two steps:
///
///           forge script script/RwaWhitelistEnroll.s.sol --sig "run()"     --broadcast   // enroll + propose
///           (wait 48h)
///           forge script script/RwaWhitelistEnroll.s.sol --sig "confirm()" --broadcast   // flip to WHITELISTED
///
///         Reg A+ deals need NONE of this — they run in the default PERMISSIONLESS mode.
///         See docs/developers/rwa-three-role-build-plan.md (WS1) + rwa-compliance-three-role-model.md.
///
///         ⚠ Enroll EVERY transient vRWA holder before confirm(), or pool interactions revert once
///         WHITELISTED. The PoolManager custodies pool inventory, so it MUST be enrolled.
///
/// ─── Required env ────────────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY — owner of vRWA + registry
///   VRWA                 — the deal's MintwareVRWA
///   SPV_REGISTRY         — the deal's SPVBeneficiaryRegistry
///   RWA_VAULT            — the deal's MintwareRWAVault4626
///   POOL_MANAGER         — Uniswap V4 PoolManager
/// ─── Optional env (enrolled only if set) ─────────────────────────────────────
///   MW_ROUTER · ISSUER · ULV_VAULT (the WS2 USDC-only LP vault, once it exists)
///   KYC_ORACLE           — backend signer that writes verifyBeneficiary (set as kycProvider)
contract RwaWhitelistEnroll is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        MintwareVRWA vrwa               = MintwareVRWA(vm.envAddress("VRWA"));
        SPVBeneficiaryRegistry registry = SPVBeneficiaryRegistry(vm.envAddress("SPV_REGISTRY"));
        address vault       = vm.envAddress("RWA_VAULT");
        address poolManager = vm.envAddress("POOL_MANAGER");
        address router      = vm.envOr("MW_ROUTER", address(0));
        address issuer      = vm.envOr("ISSUER", address(0));
        address ulv         = vm.envOr("ULV_VAULT", address(0));
        address oracle      = vm.envOr("KYC_ORACLE", address(0));

        vm.startBroadcast(pk);

        // 1) vRWA reads the registry for human-holder eligibility in WHITELISTED mode.
        vrwa.setRegistry(address(registry));

        // 2) The oracle backend is the only writer of KYC records.
        if (oracle != address(0)) registry.setKycProvider(oracle);

        // 3) Enroll infra permitted holders — they custody/route vRWA but are not "human" holders,
        //    so they pass via the allowlist rather than the registry.
        vrwa.setWhitelist(poolManager, true);
        vrwa.setWhitelist(vault, true);
        if (router != address(0)) vrwa.setWhitelist(router, true);
        if (issuer != address(0)) vrwa.setWhitelist(issuer, true);
        if (ulv    != address(0)) vrwa.setWhitelist(ulv, true);

        // 4) Propose the flip to WHITELISTED (Reg D). Finalize with confirm() after the 48h timelock.
        vrwa.proposeTransferMode(TransferMode.WHITELISTED);

        vm.stopBroadcast();

        console2.log("=== WS1 enroll + propose (Reg D) ===");
        console2.log("vRWA           ", address(vrwa));
        console2.log("registry       ", address(registry));
        console2.log("kycProvider    ", oracle);
        console2.log("poolManager    ", poolManager);
        console2.log("vault          ", vault);
        console2.log("router         ", router);
        console2.log("issuer         ", issuer);
        console2.log("ulv            ", ulv);
        console2.log("pendingModeEta ", vrwa.pendingModeEta());
        console2.log("=> run confirm() after the 48h timelock elapses");
    }

    /// @notice Step 2 (after the 48h timelock): finalize the flip to WHITELISTED. Reverts if the
    ///         timelock has not elapsed (the token's own guard).
    function confirm() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        MintwareVRWA vrwa = MintwareVRWA(vm.envAddress("VRWA"));

        vm.startBroadcast(pk);
        vrwa.confirmTransferMode();
        vm.stopBroadcast();

        require(vrwa.transferMode() == TransferMode.WHITELISTED, "mode not WHITELISTED");
        console2.log("=== WS1 confirm: vRWA now WHITELISTED (Reg D gate live) ===");
        console2.log("vRWA", address(vrwa));
    }
}
