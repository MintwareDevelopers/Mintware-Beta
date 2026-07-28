// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PoolManager}  from "@uniswap/v4-core/src/PoolManager.sol";

import {FeeVault}                  from "../src/FeeVault.sol";
import {VaultSurface, VaultConfig} from "../src/vaults/VaultTypes.sol";
import {MintwareRWAVault4626}      from "../src/rwa/MintwareRWAVault4626.sol";
import {MintwareVRWA}              from "../src/rwa/MintwareVRWA.sol";
import {SPVBeneficiaryRegistry}    from "../src/rwa/SPVBeneficiaryRegistry.sol";
import {MockERC20}                 from "../test/mocks/MockERC20.sol";

/// @notice ONE-SHOT testnet demo. Deploys a self-contained RWA vault stack
///         (test USDC → FeeVault → SPV registry → vRWA → RWA 4626 vault), wires
///         it, then seeds TWO holders with real vault-share balances so the
///         hold-snapshot cron (RWA Incentive Layer · R4) has live balances to read.
///
///         The RWA vault is reserve-only in v1 (USDC held in the vault, no V4 pool),
///         so this needs no hook mining and no faucet — the deployer only needs Base
///         Sepolia ETH for gas. This proves the hold-credit loop end-to-end; the
///         vRWA/USDC oracle-banded pool (for R1 volume/LP) is a separate, later add.
///
///         Permissionless by construction: deposits are open; the SPV registry's KYC
///         check is enforced ONLY at the redemption boundary (confirmSettlement) — the
///         gate lives in the asset, never in the incentive layer.
///
/// ─── Required env ────────────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY  — funded with Base Sepolia ETH (plays issuer + payer)
///
/// ─── Run ─────────────────────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY=0x… pnpm forge:rwa-vault-demo:base-sepolia
///
/// After it runs, set the printed VAULT address as social_vaults.contract_address
/// for the seeded deal you want the hold-snapshot cron to credit.
contract DeployRwaVaultDemo is Script {
    uint256 constant HOLDER_A_DEPOSIT = 10_000e6; // deployer holds these shares
    uint256 constant HOLDER_B_DEPOSIT = 5_000e6;  // a second demo holder

    function run() external {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address me  = vm.addr(key);
        address holderB = vm.addr(uint256(keccak256("mw-rwa-demo-holder-b")));

        console.log("=== Mintware RWA Vault Demo ===");
        console.log("Chain:      ", block.chainid);
        console.log("Issuer/me:  ", me);
        console.log("Holder B:   ", holderB);

        vm.startBroadcast(key);

        // 1) Self-contained deps — fresh test USDC + PoolManager (unused by reserve-only vault)
        MockERC20 usdc = new MockERC20("Test USDC", "tUSDC", 6);
        PoolManager pm = new PoolManager(me);

        // 2) FeeVault(usdc, distributor, oracleSigner, treasury) — deployer plays all roles
        FeeVault feeVault = new FeeVault(address(usdc), me, me, me);

        // 3) SPV KYC registry (owner) + vRWA bearer token (owner)
        SPVBeneficiaryRegistry registry = new SPVBeneficiaryRegistry(me);
        MintwareVRWA vrwa = new MintwareVRWA("Mintware vRWA Demo", "vRWA", 6, me);

        // 4) RWA 4626 vault
        MintwareRWAVault4626 vault = new MintwareRWAVault4626(
            _cfg(address(usdc), me),
            address(pm),
            address(feeVault),
            address(vrwa),
            address(registry),
            me                       // issuer
        );

        // 5) Wire: vault is the sole vRWA minter; FeeVault points at the vault
        vrwa.setMinter(address(vault));
        feeVault.setSocialVault(address(vault));

        // 6) Seed two holders with real share balances (deployer pays USDC, shares go to receiver).
        //    deposit() mints ERC-4626 shares AND vRWA 1:1 to the receiver — permissionless.
        usdc.mint(me, HOLDER_A_DEPOSIT + HOLDER_B_DEPOSIT);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(HOLDER_A_DEPOSIT, me);
        vault.deposit(HOLDER_B_DEPOSIT, holderB);

        vm.stopBroadcast();

        uint256 sharesA = vault.balanceOf(me);
        uint256 sharesB = vault.balanceOf(holderB);

        console.log("--- addresses ---");
        console.log("tUSDC:       ", address(usdc));
        console.log("PoolManager: ", address(pm));
        console.log("FeeVault:    ", address(feeVault));
        console.log("Registry:    ", address(registry));
        console.log("vRWA:        ", address(vrwa));
        console.log("VAULT:       ", address(vault), "<- set as social_vaults.contract_address");
        console.log("--- seeded holdings (what the hold-snapshot cron reads) ---");
        console.log("holder A shares:", sharesA);
        console.log("holder B shares:", sharesB);
    }

    function _cfg(address usdc, address provider) internal pure returns (VaultConfig memory) {
        return VaultConfig({
            surface:             VaultSurface.RWA,
            provider:            provider,     // issuer
            underlyingToken:     usdc,
            treasury:            provider,
            name:                "Mintware RWA Demo Share",
            symbol:              "mwRWA",
            minDeposit:          0,
            entryFeeBps:         0,
            exitFeeBps:          0,
            enableMEVProtection: false,        // RWA surface — no V4 MEV path
            enableIdleCapital:   false,
            idleTargetRatio:     0
        });
    }
}
