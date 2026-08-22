// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console}          from "forge-std/Script.sol";
import {MintwareTreasuryVault}    from "../src/payments/MintwareTreasuryVault.sol";
import {MintwareTreasuryJitHook}  from "../src/payments/MintwareTreasuryJitHook.sol";
import {MintwarePaymentGateway}   from "../src/payments/MintwarePaymentGateway.sol";
import {MintwareEthSettlement}    from "../src/payments/MintwareEthSettlement.sol";
import {HookMiner}                from "../src/lib/HookMiner.sol";
import {MockERC20}                from "../test/mocks/MockERC20.sol";
import {MockYieldAdapter}         from "../test/mocks/MockYieldAdapter.sol";
import {IPoolManager}             from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                   from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}                  from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}                 from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary}             from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

/// @notice SELF-CONTAINED Base Sepolia testnet demo of the audit-hardened YPN "ETH senior tranche"
///         stack. Everything a live deploy needs is mocked in ONE broadcast so the whole thing stands
///         up with no external prerequisites: mock USDC / team / WETH tokens, a passthrough yield
///         adapter, the treasury USDC/team V4 pool + its mined JIT hook, the payment gateway, and the
///         ETH->USDC settlement contract with its own WETH/USDC pool.
///
///         ⚠ TESTNET + MOCK + UNAUDITED. Mock tokens have no value; the adapter is an identity
///         passthrough; settlement's live ETH->USDC swap is left un-exercised (deployed + configured,
///         oracle-gate relaxed) because it needs a funded WETH/USDC pool a mock rig can't provide.
///         Do NOT put real value on any of this.
///
/// ─── Assembly (reuses DeployTreasuryV2's exact CREATE2 salt-mining + circular-dep break) ──────────
///   The vault LPs into the HOOKED pool, so its PoolKey needs the mined hook address — but the hook
///   ctor needs the vault address. Broken by PREDICTING the vault's CREATE address: after the mock
///   tokens + adapter are deployed (which advance the deployer nonce), the vault is the NEXT deployer
///   CREATE, and the hook is deployed via the CREATE2 factory (no deployer-nonce consumption), so the
///   vault lands at computeCreateAddress(deployer, nonce-at-that-point).
///
/// ─── Run ──────────────────────────────────────────────────────────────────────
///   Dry-run (fork sim, NO broadcast):
///     forge script contracts-v4/script/DeployEthSeniorStackDemo.s.sol --rpc-url base_sepolia -vvvv
///   Broadcast:
///     forge script contracts-v4/script/DeployEthSeniorStackDemo.s.sol --rpc-url base_sepolia --broadcast --slow -vvvv
contract DeployEthSeniorStackDemo is Script {
    /// Live Base Sepolia V4 PoolManager (matches config/treasury.ts + testnet_deploy_env).
    address constant POOL_MANAGER  = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    /// Deterministic CREATE2 factory (Arachnid) — deploys the hook without consuming the deployer nonce.
    address constant C2_FACTORY    = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    /// JIT hook permission bits: beforeInitialize | beforeSwap | afterSwap.
    uint160 constant JIT_HOOK_FLAGS = 0x20C8;
    // 1:1 at tick 0. Right for the 6dp/6dp USDC/team pool; a coarse placeholder for the 6dp/18dp
    // WETH/USDC settlement pool (fine — the mock demo never runs a live settlement swap).
    uint160 constant INIT_SQRT_PRICE = 79228162514264337593543950336;
    uint24  constant BASE_FEE_PIPS   = 3000; // 0.30% JIT-hook dynamic-fee floor
    int24   constant TICK_SPACING    = 60;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        console.log("=== YPN ETH-senior-tranche stack DEMO (Base Sepolia, TESTNET + MOCK) ===");
        console.log("Chain:       ", block.chainid);
        console.log("Deployer:    ", deployer);
        console.log("PoolManager: ", POOL_MANAGER);

        vm.startBroadcast(deployerKey);

        // 1. Mock tokens (USDC 6dp, team 6dp, WETH 18dp) + supply to the deployer.
        MockERC20 usdc = new MockERC20("USD Coin (mock)",      "mUSDC", 6);
        MockERC20 team = new MockERC20("Team Token (mock)",    "mTEAM", 6);
        MockERC20 weth = new MockERC20("Wrapped Ether (mock)", "mWETH", 18);
        usdc.mint(deployer, 1_000_000e6);
        team.mint(deployer, 1_000_000e6);
        weth.mint(deployer, 1_000e18);

        // 2. Yield adapter over USDC (identity passthrough: holds USDC, totalAssets = held balance).
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));

        // Sort the treasury pool currencies (USDC, team).
        (address tc0, address tc1) =
            address(usdc) < address(team) ? (address(usdc), address(team)) : (address(team), address(usdc));

        // Placeholder-hooks key for the hook ctor + mining (the hook ctor ignores key.hooks). DYNAMIC-FEE
        // pool: the JIT hook overrides the LP fee per swap; BASE_FEE_PIPS is applied as its floor post-deploy.
        PoolKey memory ctorKey = PoolKey({
            currency0: Currency.wrap(tc0),
            currency1: Currency.wrap(tc1),
            fee:       LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks:     IHooks(address(0))
        });

        // Predict the vault's CREATE address: after the 4 deploys above, it is the NEXT deployer CREATE.
        address predictedVault = vm.computeCreateAddress(deployer, vm.getNonce(deployer));

        // Mine the JIT hook (pure computation) against the PREDICTED vault address.
        bytes memory hookArgs = abi.encode(POOL_MANAGER, ctorKey, address(usdc), predictedVault, deployer);
        (address hookAddr, bytes32 hookSalt) =
            HookMiner.find(C2_FACTORY, JIT_HOOK_FLAGS, type(MintwareTreasuryJitHook).creationCode, hookArgs);

        // The hooked treasury pool key.
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(tc0), currency1: Currency.wrap(tc1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: TICK_SPACING, hooks: IHooks(hookAddr)
        });

        // 3. Treasury vault (senior = community USDC; junior = team token). owner == team == deployer for
        //    the demo. Deployer's next CREATE -> lands at predictedVault.
        MintwareTreasuryVault vault =
            new MintwareTreasuryVault(POOL_MANAGER, key, address(usdc), address(adapter), deployer, deployer);
        require(address(vault) == predictedVault, "vault address mismatch");
        console.log("TreasuryVault:   ", address(vault));

        // 4. JIT hook via CREATE2 (mined permission bits hold; no deployer-nonce use).
        MintwareTreasuryJitHook hook =
            new MintwareTreasuryJitHook{salt: hookSalt}(POOL_MANAGER, ctorKey, address(usdc), address(vault), deployer);
        require(address(hook) == hookAddr, "hook address mismatch");
        console.log("JitHook:         ", address(hook));

        // 5. Open the hooked treasury pool + wire the JIT seam (exempt the vault's own recover swaps).
        IPoolManager(POOL_MANAGER).initialize(key, INIT_SQRT_PRICE);
        vault.setJitHook(address(hook));
        hook.setJitSkipSender(address(vault));
        hook.setBaseFeePips(BASE_FEE_PIPS);

        // 6. Payment Gateway (card rail; circleTreasury == admin == deployer for the demo).
        MintwarePaymentGateway gateway =
            new MintwarePaymentGateway(address(vault), address(usdc), deployer, deployer);
        vault.setGateway(address(gateway));
        vault.setProtocolTreasury(deployer);
        console.log("PaymentGateway:  ", address(gateway));

        // 7. Grant RELAYER_ROLE to the deployer (the oracle-signer stand-in) so settleSpend works. The ctor
        //    already grants it to admin (== deployer); this is the explicit, idempotent belt-and-suspenders.
        gateway.grantRole(gateway.RELAYER_ROLE(), deployer);

        // (Adapter: MockYieldAdapter does not gate on a vault, so there is no adapter.setVault() to call.)

        // 8. ETH->USDC settlement + its own WETH/USDC pool (a SEPARATE hookless pool). The mock rig can't
        //    fund a real settlement swap, so we deploy + configure + relax the oracle gate and note that
        //    a live settlement needs a funded WETH/USDC pool + a ready oracle source.
        (address wc0, address wc1) =
            address(weth) < address(usdc) ? (address(weth), address(usdc)) : (address(usdc), address(weth));
        PoolKey memory wethKey = PoolKey({
            currency0: Currency.wrap(wc0), currency1: Currency.wrap(wc1),
            fee: 3000, tickSpacing: TICK_SPACING, hooks: IHooks(address(0))
        });
        IPoolManager(POOL_MANAGER).initialize(wethKey, INIT_SQRT_PRICE);

        MintwareEthSettlement settlement =
            new MintwareEthSettlement(IPoolManager(POOL_MANAGER), wethKey, address(usdc), address(weth), deployer, deployer);
        // AUDIT R4-H1: configure the fail-closed gate BEFORE pinning the rail — while pre-armed, risk-param
        // changes (and the oracle source) apply instantly; once the rail is pinned the oracle source is frozen
        // and loosening the gate is 48h-timelocked. The mock rig has no oracle source, so it stays the
        // constructor default (address(0)) — we no longer call setOracleSource(address(0)) (which now reverts).
        settlement.setRequireReadyOracle(false);   // relax the fail-closed gate for the demo ONLY (pre-arming).
        settlement.setSettlementRail(deployer);    // AUDIT H4: pin the sole settlement destination (goes live).
        console.log("EthSettlement:   ", address(settlement));

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployed addresses (TESTNET + MOCK + UNAUDITED) ===");
        console.log("mUSDC (6dp):     ", address(usdc));
        console.log("mTEAM (6dp):     ", address(team));
        console.log("mWETH (18dp):    ", address(weth));
        console.log("YieldAdapter:    ", address(adapter));
        console.log("TreasuryVault:   ", address(vault));
        console.log("JitHook:         ", address(hook));
        console.log("PaymentGateway:  ", address(gateway));
        console.log("EthSettlement:   ", address(settlement));
        console.log("");
        console.log("Notes: settlement is deployed + railed + oracle-gate relaxed, but its live ETH->USDC");
        console.log("swap needs a funded WETH/USDC pool + a ready oracle source (not provided by this mock).");
        console.log("Team commits junior via vault.commitTeam(...) separately (not a deployer action).");
    }
}
