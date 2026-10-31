// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BaseAllowlistChecker} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/BaseAllowListChecker.sol";
import {PermissionFlag} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/libraries/PermissionFlags.sol";
import {PermissionedV4Router} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/PermissionedV4Router.sol";
import {IPermissionsAdapter} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/interfaces/IPermissionsAdapter.sol";
import {IPermissionsAdapterFactory} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/interfaces/IPermissionsAdapterFactory.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ReentrancyLock} from "@uniswap/v4-periphery-permissioned/src/base/ReentrancyLock.sol";

/// @dev Issuer fixture: native custody permissions are separate from swap/LP flags.
contract OwnedIssuerToken is ERC20 {
    uint8 private immutable precision;
    bool private immutable restricted;
    mapping(address => bool) public eligible;
    bool public taxed;
    error NativePermissionDenied();
    constructor(uint8 decimals_, bool restricted_) ERC20("Issuer fixture", "ISS") {
        precision = decimals_; restricted = restricted_;
    }
    function decimals() public view override returns (uint8) { return precision; }
    function setEligible(address who, bool yes) external { eligible[who] = yes; }
    function setTaxed(bool yes) external { taxed = yes; }
    function mint(address who, uint256 amount) external { _mint(who, amount); }
    function _update(address from, address to, uint256 amount) internal override {
        if (restricted && ((from != address(0) && !eligible[from]) || (to != address(0) && !eligible[to]))) {
            revert NativePermissionDenied();
        }
        uint256 fee = taxed && from != address(0) && to != address(0) ? amount / 100 : 0;
        super._update(from, to, amount - fee);
        if (fee != 0) super._update(from, address(0), fee);
    }
}

contract IssuerAllowlist is BaseAllowlistChecker {
    mapping(address => mapping(address => PermissionFlag)) public flags;
    bool public unavailable;
    function set(address account, address token, PermissionFlag permission) external { flags[account][token] = permission; }
    function setUnavailable(bool yes) external { unavailable = yes; }
    function checkAllowlist(address account, address token) public view override returns (PermissionFlag) {
        require(!unavailable, "issuer unavailable");
        return flags[account][token];
    }
}

/// @dev Concrete test entrypoint for the unmodified official abstract router. All action decoding,
/// swaps, allowlist checks, wrapping, settlement and takes execute the upstream implementation.
/// The only payment choice here is ERC20 allowance instead of Universal Router's Permit2.
contract PermissionedRoutingEntrypoint is PermissionedV4Router, ReentrancyLock {
    using SafeERC20 for IERC20;
    constructor(IPoolManager manager, IPermissionsAdapterFactory factory) PermissionedV4Router(manager, factory) {}
    function execute(bytes calldata actions) external isNotLocked { _executeActions(actions); }
    function msgSender() public view virtual override returns (address) { return _getLocker(); }
    function _payStandard(Currency currency, address payer, uint256 amount) internal override {
        IERC20(Currency.unwrap(currency)).safeTransferFrom(payer, address(poolManager), amount);
    }
    function _payPermissionedFromPayer(address payer, IPermissionsAdapter adapter, address token, uint256 amount)
        internal override
    {
        IERC20(token).safeTransferFrom(payer, address(adapter), amount);
        adapter.wrapToPoolManager(amount);
    }
}

contract ForgedPrincipalRouter is PermissionedRoutingEntrypoint {
    address private immutable victim;
    constructor(IPoolManager manager, IPermissionsAdapterFactory factory, address victim_)
        PermissionedRoutingEntrypoint(manager, factory) { victim = victim_; }
    function msgSender() public view override returns (address) { return victim; }
}
