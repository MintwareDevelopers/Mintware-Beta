// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {MintwareTreasuryVault}   from "./MintwareTreasuryVault.sol";
import {MintwareTreasuryJitHook}  from "./MintwareTreasuryJitHook.sol";
import {MintwarePaymentGateway}   from "./MintwarePaymentGateway.sol";
import {HookMiner}                from "../lib/HookMiner.sol";

/// @dev Set-once factory binding shared by the deployer helpers. Deployed by the ops EOA (the `admin`),
///      which then points it at the factory once the factory address is known (the factory ctor takes the
///      deployer addresses, so the binding is necessarily two-phase).
abstract contract FactoryBound {
    address public immutable admin;
    address public factory;

    error NotAdmin();
    error NotFactory();
    error FactoryAlreadySet();
    error ZeroAddress();

    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
    }

    function setFactory(address factory_) external {
        if (msg.sender != admin) revert NotAdmin();
        if (factory != address(0)) revert FactoryAlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
    }

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }
}

/// @title  MintwareTreasuryJitHookDeployer
/// @notice Holds the `MintwareTreasuryJitHook` creation code so the orchestrating factory does not have to
///         embed it (which, together with the vault + gateway, would blow the 24,576-byte EIP-170 limit).
///         Deploys the hook via CREATE2 with a caller-supplied, off-chain-mined salt — so this deployer is
///         the CREATE2 deployer the salt must be mined against (`HookMiner.find(address(hookDeployer), …)`).
contract MintwareTreasuryJitHookDeployer is FactoryBound {
    constructor(address admin_) FactoryBound(admin_) {}

    function deploy(
        bytes32 salt,
        address poolManager_,
        PoolKey calldata key,
        address usdc,
        address vault,
        address owner_
    ) external onlyFactory returns (address) {
        MintwareTreasuryJitHook hook =
            new MintwareTreasuryJitHook{salt: salt}(poolManager_, key, usdc, vault, owner_);
        return address(hook);
    }

    /// @notice The address `deploy(salt, …)` would land the hook at — the factory asserts the mined
    ///         permission bits against this without embedding the hook creation code itself.
    function predictAddress(
        bytes32 salt,
        address poolManager_,
        PoolKey calldata key,
        address usdc,
        address vault,
        address owner_
    ) external view returns (address) {
        bytes32 initcodeHash = keccak256(
            abi.encodePacked(
                type(MintwareTreasuryJitHook).creationCode,
                abi.encode(poolManager_, key, usdc, vault, owner_)
            )
        );
        return HookMiner.computeAddress(address(this), salt, initcodeHash);
    }
}

/// @title  MintwareTreasuryGatewayDeployer
/// @notice Holds the `MintwarePaymentGateway` creation code, off the factory's own bytecode (EIP-170).
contract MintwareTreasuryGatewayDeployer is FactoryBound {
    constructor(address admin_) FactoryBound(admin_) {}

    function deploy(address vault, address usdc, address treasury, address admin_)
        external onlyFactory returns (address)
    {
        return address(new MintwarePaymentGateway(vault, usdc, treasury, admin_));
    }
}

/// @title  MintwareTreasuryVaultDeployer
/// @notice Holds the `MintwareTreasuryVault` creation code (~21.8 KB init) so the orchestrating factory
///         does not embed it — the change that keeps the factory under the 24,576-byte EIP-170 limit (the
///         vault + hook + gateway creation codes together far exceed it).
///
/// @dev    ── Load-bearing address determinism ──────────────────────────────────────────────────────────
///         The vault is this deployer's ONLY `CREATE` per `deploy` call, so a fresh instance's on-chain
///         nonce advances deterministically: the Nth vault lands at `computeCreateAddress(this, 1 + (N-1))`.
///         A newly deployed contract's nonce starts at 1, so with `deployCount` starting at 0 the FIRST
///         vault lands at `computeCreateAddress(this, 1)`. The off-chain hook-salt miner mines against
///         `predictNext()`, and the factory asserts `deployedVault == predictNext()` (`VaultAddressMismatch`)
///         — so this prediction is the anchor the whole vault↔hook wiring depends on. `deploy` is
///         `onlyFactory` so nothing else can consume a nonce and drift the prediction.
contract MintwareTreasuryVaultDeployer is FactoryBound {
    /// @notice Number of vaults deployed — equals this deployer's CREATE count, so the next vault lands at
    ///         `computeCreateAddress(this, 1 + deployCount)`.
    uint256 public deployCount;

    constructor(address admin_) FactoryBound(admin_) {}

    function deploy(
        address poolManager_,
        PoolKey calldata key,
        address usdc,
        address adapter,
        address owner_,
        address team
    ) external onlyFactory returns (address) {
        // Owner is passed THROUGH (the factory passes itself so its onlyOwner wiring stays callable); the
        // deployer is never the vault owner.
        MintwareTreasuryVault vault =
            new MintwareTreasuryVault(poolManager_, key, usdc, adapter, owner_, team);
        deployCount += 1;
        return address(vault);
    }

    /// @notice The address the NEXT `deploy(...)` will land the vault at. The off-chain miner mines the hook
    ///         salt against THIS, and the factory asserts the deployed vault matches it.
    function predictNext() external view returns (address) {
        return _computeCreateAddress(address(this), 1 + deployCount);
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
