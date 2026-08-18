// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title  MintwareTreasuryVaultRegistry
/// @notice The multi-tenant on-chain index for the YPN (`MintwareTreasuryVault`) family — one record
///         per team's vault + JIT hook + payment Gateway. This is the source of truth Supabase indexes
///         (rather than being the index itself). It is YPN-shaped on purpose: the DeFi/4626-flavoured
///         `MintwareVaultRegistry` (`feeVault`/`vRWA`/`provider`) does not fit a treasury vault cleanly,
///         so this carries the fields that matter for a treasury tenant (`team`, `teamToken`, `usdc`).
///
/// @dev    `register` is callable only by the wired `factory` (set-once) or the owner; `deactivate`
///         retires an instance (record kept for provenance). See
///         docs/developers/vault-phase3-factory-blueprint.md.
contract MintwareTreasuryVaultRegistry is Ownable {
    struct TreasuryVaultRecord {
        address vault;
        address hook;
        address gateway;
        address team;
        address teamToken;
        address usdc;
        uint64  createdAt;
        bool    active;
    }

    /// @notice The `MintwareTreasuryVaultFactory` allowed to `register` (set-once).
    address public factory;

    TreasuryVaultRecord[] private _records;
    /// @dev vault => id + 1 (0 sentinel = unknown), so `isActive`/dup-guard are O(1).
    mapping(address => uint256) private _idxByVault;
    /// @dev team => ids (a team can, in principle, run more than one tenant).
    mapping(address => uint256[]) private _idsByTeam;

    event FactorySet(address indexed factory);
    event TreasuryVaultRegistered(
        uint256 indexed id,
        address indexed vault,
        address indexed team,
        address hook,
        address gateway,
        address teamToken,
        address usdc
    );
    event TreasuryVaultDeactivated(uint256 indexed id);

    error NotFactoryOrOwner();
    error FactoryAlreadySet();
    error ZeroAddress();
    error UnknownId();
    error VaultAlreadyRegistered();

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Wire the factory that may register vaults. Set-once, owner-gated.
    function setFactory(address factory_) external onlyOwner {
        if (factory != address(0)) revert FactoryAlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    /// @notice Record a deployed + wired treasury vault. Only the factory or the owner may call.
    function register(
        address vault,
        address hook,
        address gateway,
        address team,
        address teamToken,
        address usdc
    ) external returns (uint256 id) {
        if (msg.sender != factory && msg.sender != owner()) revert NotFactoryOrOwner();
        if (vault == address(0) || team == address(0)) revert ZeroAddress();
        if (_idxByVault[vault] != 0) revert VaultAlreadyRegistered();

        _records.push(TreasuryVaultRecord({
            vault:     vault,
            hook:      hook,
            gateway:   gateway,
            team:      team,
            teamToken: teamToken,
            usdc:      usdc,
            createdAt: uint64(block.timestamp),
            active:    true
        }));
        id = _records.length - 1;
        _idxByVault[vault] = id + 1;
        _idsByTeam[team].push(id);

        emit TreasuryVaultRegistered(id, vault, team, hook, gateway, teamToken, usdc);
    }

    /// @notice Retire a registered instance. Record kept; `active` flips false so indexers/front-ends
    ///         stop surfacing it. Owner/guardian action.
    function deactivate(uint256 id) external onlyOwner {
        if (id >= _records.length) revert UnknownId();
        _records[id].active = false;
        emit TreasuryVaultDeactivated(id);
    }

    // ── views ────────────────────────────────────────────────────────────────

    function get(uint256 id) external view returns (TreasuryVaultRecord memory) {
        if (id >= _records.length) revert UnknownId();
        return _records[id];
    }

    function count() external view returns (uint256) {
        return _records.length;
    }

    function byTeam(address team) external view returns (uint256[] memory) {
        return _idsByTeam[team];
    }

    /// @notice Whether a vault address is a registered, still-active instance.
    ///         False for unknown or retired vaults.
    function isActive(address vault) external view returns (bool) {
        uint256 idx = _idxByVault[vault];
        if (idx == 0) return false;
        return _records[idx - 1].active;
    }
}
