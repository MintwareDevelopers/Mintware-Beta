// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable}      from "@openzeppelin/contracts/access/Ownable.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}       from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}      from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}     from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

import {MintwareTreasuryVault}          from "./MintwareTreasuryVault.sol";
import {MintwareTreasuryJitHook}        from "./MintwareTreasuryJitHook.sol";
import {MintwareTreasuryVaultRegistry}  from "./MintwareTreasuryVaultRegistry.sol";
import {
    MintwareTreasuryJitHookDeployer,
    MintwareTreasuryGatewayDeployer
} from "./MintwareTreasuryDeployers.sol";

/// @title  MintwareTreasuryVaultFactory
/// @notice Multi-tenant factory for the YPN treasury-vault stack. `createVault` atomically deploys +
///         wires + registers one team's vault + JIT hook + payment Gateway, reproducing the manual
///         `DeployTreasuryV2` assembly in a single transaction.
///
/// @dev    ── The V4 / EIP-170 constraint that shapes this ─────────────────────────────────────────────
///         A hooked vault needs its own JIT hook whose CREATE2 address encodes its permission bits (0xC0),
///         mineable only OFF-CHAIN, and the vault↔hook dependency is circular (the vault's pool key needs
///         the hook address; the hook ctor needs the vault address). We break it exactly as the deploy
///         script does — by PREDICTING the vault's CREATE address and mining the hook salt against it.
///
///         The vault + hook + gateway creation codes sum to ~35.8 KB, so a single `new`-based factory that
///         embeds all three would exceed the 24,576-byte runtime limit (the same trap that deferred the
///         4626 `createVault`). This factory therefore embeds ONLY the vault creation code (its own
///         `new`), and delegates the hook (CREATE2) and gateway (CREATE) to thin deployer helpers. Because
///         the vault is the factory's OWN — and only — CREATE per call, the vault lands at
///         `computeCreateAddress(factory, factoryNonce)` with `factoryNonce == 1 + deployCount`.
///
///         ── Ownership two-phase ───────────────────────────────────────────────────────────────────────
///         The wiring calls (`setJitHook`, `setGateway`, `setProtocolTreasury`, `setJitSkipSender`) are
///         `onlyOwner`, so the vault + hook are constructed with the FACTORY as owner, wired, and only THEN
///         is ownership transferred to the intended ops owner `p.owner` (NOT the team — the team is the
///         constructor-bound junior tenant via `commitTeam`, per the P2 M1 binding).
///
///         v1 access: `createVault` is `onlyOwner` (Mintware-curated / whitelisted teams).
contract MintwareTreasuryVaultFactory is Ownable {
    /// @dev The JIT hook's required permission bits: beforeInitialize | beforeSwap | afterSwap.
    ///      No `beforeSwapReturnDelta` — the hook returns ZERO delta always (am-AMM skim shelved off it).
    uint160 internal constant JIT_HOOK_FLAGS = 0x20C0; // beforeInitialize | beforeSwap | afterSwap
    /// @dev All 14 V4 permission bits.
    uint160 internal constant ALL_HOOK_MASK = uint160((1 << 14) - 1);

    IPoolManager                         public immutable poolManager;
    MintwareTreasuryVaultRegistry        public immutable registry;
    MintwareTreasuryJitHookDeployer      public immutable hookDeployer;
    MintwareTreasuryGatewayDeployer      public immutable gatewayDeployer;

    /// @notice Number of vaults created — equals the factory's CREATE count, so the next vault lands at
    ///         `computeCreateAddress(factory, 1 + deployCount)`.
    uint256 public deployCount;

    struct CreateParams {
        address usdc;
        address teamToken;
        address adapter;
        address team;          // constructor-bound junior tenant
        address owner;         // intended ops owner of the vault + hook after wiring
        address treasury;      // protocol treasury + Gateway card rail
        uint24  poolFee;       // the hook's BASE (floor) fee in pips — the pool itself is DYNAMIC_FEE_FLAG
        int24   tickSpacing;
        uint160 initSqrtPrice;
        address gatewayAdmin;  // DEFAULT_ADMIN/RELAYER/EDGE holder on the Gateway
    }

    event VaultCreated(
        uint256 indexed id,
        address indexed vault,
        address indexed team,
        address hook,
        address gateway,
        address teamToken
    );

    error IdenticalTokens();
    error ZeroAddress();
    error HookFlagsMismatch();
    error VaultAddressMismatch();
    error HookAddressMismatch();

    constructor(
        address poolManager_,
        address registry_,
        address hookDeployer_,
        address gatewayDeployer_,
        address initialOwner
    ) Ownable(initialOwner) {
        if (
            poolManager_ == address(0) || registry_ == address(0) ||
            hookDeployer_ == address(0) || gatewayDeployer_ == address(0)
        ) revert ZeroAddress();
        poolManager     = IPoolManager(poolManager_);
        registry        = MintwareTreasuryVaultRegistry(registry_);
        hookDeployer    = MintwareTreasuryJitHookDeployer(hookDeployer_);
        gatewayDeployer = MintwareTreasuryGatewayDeployer(gatewayDeployer_);
    }

    /// @notice The address the NEXT `createVault` will deploy the vault at. The off-chain miner mines the
    ///         hook salt against THIS (via `hookDeployer.predictAddress`).
    function predictNextVault() public view returns (address) {
        return _computeCreateAddress(address(this), 1 + deployCount);
    }

    function createVault(CreateParams calldata p, bytes32 hookSalt)
        external
        onlyOwner
        returns (address vaultAddr, address hookAddr, address gatewayAddr)
    {
        if (p.usdc == p.teamToken) revert IdenticalTokens();
        if (
            p.usdc == address(0) || p.teamToken == address(0) || p.adapter == address(0) ||
            p.team == address(0) || p.owner == address(0) || p.treasury == address(0) ||
            p.gatewayAdmin == address(0)
        ) revert ZeroAddress();

        address predictedVault = predictNextVault();

        (address c0, address c1) = p.usdc < p.teamToken ? (p.usdc, p.teamToken) : (p.teamToken, p.usdc);

        // Placeholder-hooks key: the hook ctor ignores key.hooks, and the salt was mined against this.
        // The pool is a DYNAMIC-FEE pool so the hook can override the LP fee per swap (Phase-1 MEV lever);
        // `p.poolFee` is applied as the hook's BASE fee below, not as the static pool fee.
        PoolKey memory ctorKey = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: p.tickSpacing,
            hooks: IHooks(address(0))
        });

        // 1. Resolve the hook address from the caller's (off-chain-mined) salt WITHOUT embedding the hook
        //    creation code here (the deployer holds it), and assert its permission bits.
        hookAddr = hookDeployer.predictAddress(hookSalt, address(poolManager), ctorKey, p.usdc, predictedVault, address(this));
        if (uint160(hookAddr) & ALL_HOOK_MASK != JIT_HOOK_FLAGS) revert HookFlagsMismatch();

        // The hooked pool key the vault LPs into (DYNAMIC_FEE_FLAG → the hook drives the per-swap fee).
        PoolKey memory hookedKey = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: p.tickSpacing,
            hooks: IHooks(hookAddr)
        });

        // 2. Vault — the factory's own (and only) CREATE this call, so it lands at `predictedVault`.
        //    Owner = factory so the wiring below (onlyOwner) is callable; transferred to p.owner at the end.
        MintwareTreasuryVault vault =
            new MintwareTreasuryVault(address(poolManager), hookedKey, p.usdc, p.adapter, address(this), p.team);
        vaultAddr = address(vault);
        if (vaultAddr != predictedVault) revert VaultAddressMismatch();

        // 3. JIT hook via the deployer (CREATE2; mined bits must hold). Owner = factory for wiring.
        address deployedHook =
            hookDeployer.deploy(hookSalt, address(poolManager), ctorKey, p.usdc, vaultAddr, address(this));
        if (deployedHook != hookAddr) revert HookAddressMismatch();

        // 4. Open the hooked V4 pool.
        poolManager.initialize(hookedKey, p.initSqrtPrice);

        // 5. Wire the JIT seam + gateway (factory is still owner). Set the dynamic-fee floor to p.poolFee
        //    (the hook's ceiling/slope keep their in-code defaults; ops can retune post-transfer).
        vault.setJitHook(hookAddr);
        MintwareTreasuryJitHook(hookAddr).setJitSkipSender(vaultAddr);
        MintwareTreasuryJitHook(hookAddr).setBaseFeePips(p.poolFee);
        gatewayAddr = gatewayDeployer.deploy(vaultAddr, p.usdc, p.treasury, p.gatewayAdmin);
        vault.setGateway(gatewayAddr);
        vault.setProtocolTreasury(p.treasury);

        // AUDIT (coverage floor default-0, Med): arm the coverage floor at creation so a curated vault can
        // never deploy senior into the LP with the junior USDC first-loss cushion OFF. Default = par (100%);
        // ops can TIGHTEN to Tier-C (e.g. 18_000) instantly, or loosen via the 48h timelock. Set while the
        // vault is pre-activation (factory is still owner) so it applies instantly (first-set-immediate).
        vault.setMinCoverage(10_000);

        // 6. Two-phase ownership: hand the wired vault + hook to the intended ops owner.
        vault.transferOwnership(p.owner);
        MintwareTreasuryJitHook(hookAddr).transferOwnership(p.owner);

        // 7. Register + count.
        uint256 id = registry.register(vaultAddr, hookAddr, gatewayAddr, p.team, p.teamToken, p.usdc);
        deployCount += 1;

        emit VaultCreated(id, vaultAddr, p.team, hookAddr, gatewayAddr, p.teamToken);
    }

    /// @dev CREATE address = keccak256(rlp([deployer, nonce]))[12:]. Handles nonces up to uint32, far
    ///      beyond any realistic `1 + deployCount`. Mirrors forge-std's `computeCreateAddress`.
    function _computeCreateAddress(address deployer, uint256 nonce) internal pure returns (address) {
        bytes memory data;
        if (nonce == 0x00) {
            data = abi.encodePacked(bytes1(0xd6), bytes1(0x94), deployer, bytes1(0x80));
        } else if (nonce <= 0x7f) {
            data = abi.encodePacked(bytes1(0xd6), bytes1(0x94), deployer, uint8(nonce));
        } else if (nonce <= 0xff) {
            data = abi.encodePacked(bytes1(0xd7), bytes1(0x94), deployer, bytes1(0x81), uint8(nonce));
        } else if (nonce <= 0xffff) {
            data = abi.encodePacked(bytes1(0xd8), bytes1(0x94), deployer, bytes1(0x82), uint16(nonce));
        } else if (nonce <= 0xffffff) {
            data = abi.encodePacked(bytes1(0xd9), bytes1(0x94), deployer, bytes1(0x83), uint24(nonce));
        } else {
            data = abi.encodePacked(bytes1(0xda), bytes1(0x94), deployer, bytes1(0x84), uint32(nonce));
        }
        return address(uint160(uint256(keccak256(data))));
    }
}
