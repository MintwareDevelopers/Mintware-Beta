// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IRwaIdentityRegistry} from "../interfaces/IRwaIdentityRegistry.sol";

/// @title  MockPermissionedPropertyToken
/// @notice TESTNET STAND-IN for a licensed issuer's tokenized property (ERC-3643-style transfer rules).
///         Every holder must be either an enrolled INFRA holder (the pool manager, the Mintware liquidity
///         vault, the issuer) or VERIFIED in the identity registry. Mint and transfer both check the
///         receiving side; transfers also check the sender. This is the three-role trader gate: a swap
///         that would deliver the token to an unverified wallet reverts inside the token, so a standard
///         Uniswap v4 pool stays compliant without knowing anything about identity.
/// @dev    NOT for production. In production the issuer's own token enforces this; Mintware only enrolls
///         its contracts as permitted holders. Ported from the shelved `MintwareVRWA._update` gate.
contract MockPermissionedPropertyToken is ERC20, Ownable2Step {
    IRwaIdentityRegistry public immutable registry;
    uint8 private immutable _decimals;

    /// @notice Enrolled infra holders (pool manager, liquidity vault, issuer treasury). Owner-set.
    mapping(address => bool) public permittedHolder;

    event PermittedHolderSet(address indexed account, bool allowed);

    error NotPermitted(address account);

    constructor(string memory name_, string memory symbol_, uint8 decimals_, IRwaIdentityRegistry registry_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        registry  = registry_;
        _decimals = decimals_;
        permittedHolder[owner_] = true;
        emit PermittedHolderSet(owner_, true);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function setPermittedHolder(address account, bool allowed) external onlyOwner {
        permittedHolder[account] = allowed;
        emit PermittedHolderSet(account, allowed);
    }

    /// @notice Issuer mints new property units to a permitted holder.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function isPermitted(address account) public view returns (bool) {
        return permittedHolder[account] || registry.isVerified(account);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && !isPermitted(from)) revert NotPermitted(from);
        if (to != address(0) && !isPermitted(to)) revert NotPermitted(to);
        super._update(from, to, value);
    }
}
