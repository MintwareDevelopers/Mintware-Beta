// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IYieldAdapter} from "../vaults/IYieldAdapter.sol";

/// @title  MintwareLpGatewayStaging
/// @notice LP-gateway "stage and earn" reserve. Idle quote-asset supplied by the gateway position
///         manager earns in a single-asset yield source (Morpho on Robinhood Chain, via an ERC-4626
///         IYieldAdapter) from the moment it lands, until the owner deploys it as V4 liquidity.
/// @dev    Single-controller: the position manager is the only depositor, so per-user share accounting
///         lives there — this reserve holds and grows the aggregate idle balance only. The quote asset
///         is whatever the target pool quotes in (USDG here) and is never assumed to be USDC.
contract MintwareLpGatewayStaging is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable quoteAsset;
    IYieldAdapter public immutable adapter;
    // Set once at construction to the deployer (the factory). Only it may wire the controller, so a
    // front-runner can't claim the un-set controller seat between deploy and setController (finding M1).
    address public immutable deployer;
    address public controller;

    error NotController();
    error NotDeployer();
    error AlreadySet();
    error ZeroAddress();
    error ZeroAmount();

    event ControllerSet(address indexed controller);
    event Staged(uint256 amount);
    event Unstaged(uint256 requested, uint256 returned);

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    constructor(IERC20 quoteAsset_, IYieldAdapter adapter_) {
        if (address(quoteAsset_) == address(0) || address(adapter_) == address(0)) revert ZeroAddress();
        quoteAsset = quoteAsset_;
        adapter = adapter_;
        deployer = msg.sender;
    }

    function setController(address controller_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (controller != address(0)) revert AlreadySet();
        if (controller_ == address(0)) revert ZeroAddress();
        controller = controller_;
        emit ControllerSet(controller_);
    }

    function stage(uint256 amount) external onlyController nonReentrant {
        if (amount == 0) revert ZeroAmount();
        quoteAsset.safeTransferFrom(msg.sender, address(this), amount);
        quoteAsset.forceApprove(address(adapter), amount);
        adapter.deposit(amount);
        emit Staged(amount);
    }

    // Best-effort (IYieldAdapter contract): returns the amount actually pulled (<= amount), never
    // reverts for a liquidity reason, so a deploy/redemption caller can fall back.
    function unstage(uint256 amount) external onlyController nonReentrant returns (uint256 returned) {
        if (amount == 0) revert ZeroAmount();
        // Round-3 X-3: measure what actually landed instead of trusting the adapter's return value — a source that
        // over-reports by 1 wei would brick every withdraw here, one that under-reports would strand the difference
        // in this contract forever (outside `stagedAssets`, outside NAV, no sweep).
        uint256 before = quoteAsset.balanceOf(address(this));
        // Round-4 audit fix (Medium): `adapter.withdraw()` is documented (IYieldAdapter) to NEVER revert for a
        // liquidity/availability reason, and the production adapter now genuinely honors that (round-4 High
        // fix, MintwareERC4626YieldAdapter._withdrawCore). This wrapper is the belt to that suspenders — the
        // SAME defense-in-depth this codebase already applies one layer up (`_idle()`'s try/catch around
        // `stagedAssets()`) — so a misbehaving future/alternate adapter implementation can't propagate a revert
        // into `_withdraw()`'s idle-leg logic through this, the second (and only other) place that could.
        try adapter.withdraw(amount) {} catch {}
        returned = quoteAsset.balanceOf(address(this)) - before;
        if (returned > 0) quoteAsset.safeTransfer(controller, returned);
        emit Unstaged(amount, returned);
    }

    function stagedAssets() external view returns (uint256) {
        return adapter.totalAssets();
    }

    function maxUnstageable() external view returns (uint256) {
        return adapter.maxWithdrawable();
    }
}
