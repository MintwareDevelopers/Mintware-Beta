// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MintwareYieldVault}           from "../src/payments/MintwareYieldVault.sol";
import {MintwarePaymentGateway}       from "../src/payments/MintwarePaymentGateway.sol";
import {MintwareERC4626YieldAdapter}  from "../src/vaults/MintwareERC4626YieldAdapter.sol";
import {MintwareCctpDepositRouter}    from "../src/payments/MintwareCctpDepositRouter.sol";
import {MockERC20}   from "../test/mocks/MockERC20.sol";
import {MockERC4626} from "../test/mocks/MockERC4626.sol";
import {MockMessageTransmitter} from "../test/mocks/MockMessageTransmitter.sol";

/// @notice Deploy the YPN USDC SPEND STACK — the Arc-native settlement side. Same contracts that run on
///         Base, wired for Arc: a single-asset USDC `MintwareYieldVault` idling into an ERC-4626 yield
///         source via `MintwareERC4626YieldAdapter` (Arc's yield primitive slots in as the 4626), fronted
///         by `MintwarePaymentGateway` (settleSpend → burnForPayment → USDC to the CPN treasury).
///
///         Parameterized so it DRY-RUNS anywhere today and BROADCASTS to Arc when it's up:
///           - `ARC_USDC`         — real USDC on Arc (else deploys a mock 6dp USDC)
///           - `ARC_YIELD_SOURCE` — Arc's yield-primitive 4626 over USDC (else deploys a mock 4626).
///                                  CONFIRMED = XyloNet XyloVault 0x240Eb85458CD41361bd8C3773253a1D78054f747
///                                  (verified on-chain 2026-08-18: asset=Arc USDC, symbol xyUSDC). Setting
///                                  this + re-running is the one-line switch from mock yield to real yield.
///           - `ARC_CPN_TREASURY` — Circle Payments Network settlement address (else the deployer)
///         Arc chain id is 5042002 (documented; the contracts are chain-agnostic — EIP-712 reads
///         block.chainid — so no address is hardcoded). After deploy, point the edge at Arc with
///         EDGE_CHAIN_ID=5042002 + EDGE_GATEWAY_ADDRESS=<gateway>, and the relayer RPC at Arc.
///
///   Run (dry):  forge script contracts-v4/script/DeployArcSpendStack.s.sol
///   Broadcast:  forge script contracts-v4/script/DeployArcSpendStack.s.sol --rpc-url arc --broadcast --slow
contract DeployArcSpendStack is Script {
    uint256 constant ARC_CHAIN_ID = 5042002;
    // Public Arc TESTNET addresses (docs.arc.io + Circle CCTP docs) — used automatically when broadcasting
    // to Arc, so the deploy needs no env for the real USDC + CCTP wiring.
    address constant ARC_USDC_TESTNET = 0x3600000000000000000000000000000000000000;
    address constant ARC_CCTP_MT_TESTNET = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275; // MessageTransmitter v2

    function run() external {
        uint256 deployerKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0xA11CE));
        address deployer = vm.addr(deployerKey);
        address treasury = vm.envOr("ARC_CPN_TREASURY", deployer);

        vm.startBroadcast(deployerKey);

        // USDC — env override, else the real Arc testnet USDC when on Arc, else a mock (local dry-run).
        address usdc = vm.envOr("ARC_USDC", address(0));
        if (usdc == address(0)) {
            if (block.chainid == ARC_CHAIN_ID) {
                usdc = ARC_USDC_TESTNET;
                console.log("USDC = Arc testnet USDC (real)");
            } else {
                usdc = address(new MockERC20("USD Coin", "USDC", 6));
                console.log("USDC (mock 6dp) deployed");
            }
        }

        // Yield source — Arc's yield primitive as a 4626, else a mock over USDC.
        address yieldSource = vm.envOr("ARC_YIELD_SOURCE", address(0));
        if (yieldSource == address(0)) {
            yieldSource = address(new MockERC4626(IERC20(usdc)));
            console.log("Yield source (mock 4626) deployed");
        }

        // Adapter (vault set after the vault exists) -> vault -> wire -> gateway -> wire.
        MintwareERC4626YieldAdapter adapter =
            new MintwareERC4626YieldAdapter(usdc, yieldSource, address(0), deployer);
        MintwareYieldVault vault = new MintwareYieldVault(usdc, address(adapter), deployer);
        adapter.setVault(address(vault));
        MintwarePaymentGateway gateway =
            new MintwarePaymentGateway(address(vault), usdc, treasury, deployer);
        vault.setGateway(address(gateway));

        // CCTP bridge-and-deposit router. Real MessageTransmitter on Arc, else a mock so the script is
        // self-contained. Relayer = deployer for the testnet stack (rotate for a real relayer).
        address transmitter = vm.envOr("ARC_CCTP_MESSAGE_TRANSMITTER", address(0));
        if (transmitter == address(0)) {
            if (block.chainid == ARC_CHAIN_ID) {
                transmitter = ARC_CCTP_MT_TESTNET;
                console.log("CCTP MessageTransmitter = Arc testnet (real)");
            } else {
                transmitter = address(new MockMessageTransmitter());
                console.log("CCTP MessageTransmitter (mock) deployed");
            }
        }
        MintwareCctpDepositRouter cctpRouter =
            new MintwareCctpDepositRouter(transmitter, usdc, address(vault), deployer, deployer);

        vm.stopBroadcast();

        console.log("=== YPN Arc spend stack ===");
        console.log("chainId (this run):", block.chainid, block.chainid == ARC_CHAIN_ID ? "(Arc)" : "(NOT Arc)");
        console.log("deployer:  ", deployer);
        console.log("USDC:      ", usdc);
        console.log("yieldSource:", yieldSource);
        console.log("adapter:   ", address(adapter));
        console.log("vault:     ", address(vault));
        console.log("gateway:   ", address(gateway));
        console.log("cctpRouter:", address(cctpRouter));
        console.log("cpnTreasury:", treasury);
        console.log("");
        console.log("Point the edge at Arc: EDGE_CHAIN_ID=5042002");
        console.log("  EDGE_GATEWAY_ADDRESS =", address(gateway));
        console.log("  EDGE_VAULT_ADDRESS   =", address(vault));
    }
}
