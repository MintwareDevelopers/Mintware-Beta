// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IRwaIdentityRegistry} from "../interfaces/IRwaIdentityRegistry.sol";

/// @title  MockRwaIdentityRegistry
/// @notice TESTNET STAND-IN for a licensed issuer's identity registry. An `agent` (the issuer's KYC
///         operator in production) marks wallets verified until an expiry. Mintware's production code only
///         ever reads `isVerified` through `IRwaIdentityRegistry` — this mock exists so the V2-RWAs demo
///         can show a verified trader succeeding and an unverified one being refused, on-chain.
/// @dev    NOT for production. A real deployment points the property token at the issuer's own registry.
contract MockRwaIdentityRegistry is IRwaIdentityRegistry, Ownable2Step {
    mapping(address => bool)   public isAgent;
    mapping(address => uint64) public verifiedUntil;

    event AgentSet(address indexed agent, bool allowed);
    event VerificationSet(address indexed wallet, uint64 until);

    error OnlyAgent();

    constructor(address owner_) Ownable(owner_) {}

    function setAgent(address agent, bool allowed) external onlyOwner {
        isAgent[agent] = allowed;
        emit AgentSet(agent, allowed);
    }

    /// @notice Verify `wallet` until `until` (unix seconds). `until = 0` revokes.
    function setVerified(address wallet, uint64 until) external {
        if (!isAgent[msg.sender] && msg.sender != owner()) revert OnlyAgent();
        verifiedUntil[wallet] = until;
        emit VerificationSet(wallet, until);
    }

    function isVerified(address wallet) external view returns (bool) {
        return verifiedUntil[wallet] >= block.timestamp;
    }
}
