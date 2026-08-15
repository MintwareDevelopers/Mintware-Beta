// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

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
