// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  HookMiner
/// @notice Mines a CREATE2 salt so that the resulting contract address encodes
///         the desired V4 hook permission bits in its lowest 14 bits.
///
/// @dev    V4 permission flag layout (Hooks.sol):
///
///           bit 13  BEFORE_INITIALIZE_FLAG
///           bit 12  AFTER_INITIALIZE_FLAG
///           bit 11  BEFORE_ADD_LIQUIDITY_FLAG
///           bit 10  AFTER_ADD_LIQUIDITY_FLAG
///           bit  9  BEFORE_REMOVE_LIQUIDITY_FLAG
///           bit  8  AFTER_REMOVE_LIQUIDITY_FLAG
///           bit  7  BEFORE_SWAP_FLAG
///           bit  6  AFTER_SWAP_FLAG
///           bit  5  BEFORE_DONATE_FLAG
///           bit  4  AFTER_DONATE_FLAG
///           bit  3  BEFORE_SWAP_RETURNS_DELTA_FLAG
///           bit  2  AFTER_SWAP_RETURNS_DELTA_FLAG
///           bit  1  AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG
///           bit  0  AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG
///
///         MWHookCoordinator requires flags: 0xAC0 (bits 11, 9, 7, 6)
///           beforeAddLiquidity + beforeRemoveLiquidity + beforeSwap + afterSwap
///
/// @dev    Usage in Foundry scripts / tests:
///
///           bytes memory creationCode = type(MWHookCoordinator).creationCode;
///           bytes memory constructorArgs = abi.encode(poolManager, vault, owner);
///           (address hookAddr, bytes32 salt) = HookMiner.find(
///               deployer,
///               MWHookCoordinator.HOOK_FLAGS, // 0xAC0
///               creationCode,
///               constructorArgs
///           );
///           MWHookCoordinator hook = new MWHookCoordinator{salt: salt}(poolManager, vault, owner);
///           require(address(hook) == hookAddr, "HookMiner: deploy address mismatch");
library HookMiner {

    /// @dev All 14 permission bits
    uint160 internal constant ALL_HOOK_MASK = uint160((1 << 14) - 1);

    /// @dev Max iterations before reverting (prevents unbounded gas in tests)
    uint256 internal constant MAX_LOOP = 160_000;

    /// @notice Find a CREATE2 salt such that the resulting address has `flags`
    ///         in its lowest 14 bits.
    ///
    /// @param deployer       Address that will call `new ContractName{salt: salt}(...)`.
    ///                       In scripts this is `msg.sender` inside `vm.startBroadcast`.
    ///                       In tests this is the test contract itself, or use `vm.addr(key)`.
    /// @param flags          Required permission bits (e.g. 0xAC0 for MWHookCoordinator).
    /// @param creationCode   `type(Contract).creationCode`
    /// @param constructorArgs `abi.encode(arg1, arg2, ...)` — constructor arguments
    ///
    /// @return hookAddress   The expected address after CREATE2 deploy
    /// @return salt          The bytes32 salt to pass to `new Contract{salt: salt}(...)`
    function find(
        address deployer,
        uint160 flags,
        bytes memory creationCode,
        bytes memory constructorArgs
    ) internal pure returns (address hookAddress, bytes32 salt) {
        // Pre-compute the initcode hash (doesn't change between iterations)
        bytes32 initcodeHash = keccak256(abi.encodePacked(creationCode, constructorArgs));

        for (uint256 nonce = 0; nonce < MAX_LOOP; ++nonce) {
            salt = bytes32(nonce);
            hookAddress = computeAddress(deployer, salt, initcodeHash);
            if (uint160(hookAddress) & ALL_HOOK_MASK == flags & ALL_HOOK_MASK) {
                return (hookAddress, salt);
            }
        }
        revert("HookMiner: could not find salt within MAX_LOOP iterations");
    }

    /// @notice Compute the CREATE2 address given deployer, salt, and initcode hash.
    /// @dev    Formula: keccak256(0xff ++ deployer ++ salt ++ keccak256(initcode))[12:]
    function computeAddress(
        address deployer,
        bytes32 salt,
        bytes32 initcodeHash
    ) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            deployer,
            salt,
            initcodeHash
        )))));
    }
}
