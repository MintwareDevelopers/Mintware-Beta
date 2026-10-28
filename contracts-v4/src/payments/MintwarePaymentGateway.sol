// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IYieldVault} from "./IYieldVault.sol";
import {MWTimelockedRiskParams} from "../lib/MWTimelockedRiskParams.sol";

/// @notice Moves a member's Earn shares into that member's registered card buffer.
/// @dev Refill IDs are global and single-use. Caps use fixed UTC-day buckets and count delivered assets.
contract MintwarePaymentGateway is AccessControl, ReentrancyGuard, Pausable, MWTimelockedRiskParams {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 public constant WINDOW = 1 days;
    uint256 public constant DESTINATION_DELAY = 48 hours;
    uint256 public constant DEFAULT_REFILL_CAP = 1_000_000_000;
    uint256 public constant MAX_REFILL_CAP = 1_000_000_000_000;

    IYieldVault public immutable vault;
    mapping(address => address) public bufferOf;
    mapping(address => address) public proposedBuffer;
    mapping(address => uint256) public bufferEta;
    mapping(bytes32 => bool) public refillDone;
    mapping(address => mapping(uint256 => uint256)) public userRefilled;
    mapping(uint256 => uint256) public globalRefilled;
    mapping(address => uint256) public userCap;
    uint256 public globalCap;
    mapping(bytes32 => address) private capUser;
    mapping(bytes32 => bool) private capIsGlobal;

    error ZeroAddress();
    error ZeroAmount();
    error ZeroRefillId();
    error RefillAlreadyDone();
    error NoBuffer();
    error NoProposal();
    error DestinationDelayNotElapsed();
    error CapTooHigh();
    error RefillLimitExceeded();

    event BufferProposed(address indexed member, address indexed destination, uint256 eta);
    event BufferAccepted(address indexed member, address indexed destination);
    event BufferProposalCancelled(address indexed member, address indexed destination);
    event BufferRevoked(address indexed member, address indexed oldDestination);
    event Refilled(bytes32 indexed refillId, address indexed member, address indexed destination, uint256 assets, uint256 sharesBurned);
    event UserCapUpdated(address indexed member, uint256 cap);
    event GlobalCapUpdated(uint256 cap);

    constructor(address vault_, address admin_) {
        if (vault_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        vault = IYieldVault(vault_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(RELAYER_ROLE, admin_);
        _grantRole(PAUSER_ROLE, admin_);
    }

    function proposeBuffer(address destination) external {
        if (destination == address(0)) revert ZeroAddress();
        uint256 eta = block.timestamp + DESTINATION_DELAY;
        proposedBuffer[msg.sender] = destination;
        bufferEta[msg.sender] = eta;
        emit BufferProposed(msg.sender, destination, eta);
    }

    function acceptBuffer() external {
        uint256 eta = bufferEta[msg.sender];
        if (eta == 0) revert NoProposal();
        if (block.timestamp < eta) revert DestinationDelayNotElapsed();
        address destination = proposedBuffer[msg.sender];
        delete proposedBuffer[msg.sender];
        delete bufferEta[msg.sender];
        bufferOf[msg.sender] = destination;
        vault.registerDestination(msg.sender, destination);
        emit BufferAccepted(msg.sender, destination);
    }

    function cancelBufferProposal() external {
        address destination = proposedBuffer[msg.sender];
        if (bufferEta[msg.sender] == 0) revert NoProposal();
        delete proposedBuffer[msg.sender];
        delete bufferEta[msg.sender];
        emit BufferProposalCancelled(msg.sender, destination);
    }

    function revokeBuffer() external {
        address old = bufferOf[msg.sender];
        delete bufferOf[msg.sender];
        delete proposedBuffer[msg.sender];
        delete bufferEta[msg.sender];
        emit BufferRevoked(msg.sender, old);
    }

    function refill(bytes32 refillId, address member, uint256 shares)
        external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused returns (uint256 delivered)
    {
        if (refillId == bytes32(0)) revert ZeroRefillId();
        if (shares == 0) revert ZeroAmount();
        if (refillDone[refillId]) revert RefillAlreadyDone();
        address destination = bufferOf[member];
        if (destination == address(0)) revert NoBuffer();
        uint256 day = block.timestamp / WINDOW;
        uint256 userLimit = _effectiveUserCap(member);
        uint256 globalLimit = _effectiveGlobalCap();
        uint256 userUsed = userRefilled[member][day];
        uint256 globalUsed = globalRefilled[day];
        if (userUsed >= userLimit || globalUsed >= globalLimit) revert RefillLimitExceeded();
        uint256 remaining = userLimit - userUsed;
        if (globalLimit - globalUsed < remaining) remaining = globalLimit - globalUsed;
        uint256 maxShares = vault.previewWithdraw(remaining);
        if (shares > maxShares) shares = maxShares;
        if (shares == 0) revert RefillLimitExceeded();

        refillDone[refillId] = true;
        uint256 burned = shares;
        delivered = vault.gatewayRedeem(member, shares);
        if (delivered > remaining) revert RefillLimitExceeded();
        userRefilled[member][day] = userUsed + delivered;
        globalRefilled[day] = globalUsed + delivered;
        emit Refilled(refillId, member, destination, delivered, burned);
    }

    function setUserCap(address member, uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bytes32 param = keccak256(abi.encode("MW_USER_REFILL_CAP", member));
        capUser[param] = member;
        _changeRiskParam(param, cap, 0);
    }

    function confirmUserCap(address member) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _confirmRiskParam(keccak256(abi.encode("MW_USER_REFILL_CAP", member)));
    }

    function cancelUserCap(address member) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _cancelRiskParam(keccak256(abi.encode("MW_USER_REFILL_CAP", member)));
    }

    function setGlobalCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bytes32 param = keccak256("MW_GLOBAL_REFILL_CAP");
        capIsGlobal[param] = true;
        _changeRiskParam(param, cap, 0);
    }

    function confirmGlobalCap() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _confirmRiskParam(keccak256("MW_GLOBAL_REFILL_CAP"));
    }

    function cancelGlobalCap() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _cancelRiskParam(keccak256("MW_GLOBAL_REFILL_CAP"));
    }

    function _effectiveUserCap(address member) private view returns (uint256) {
        return userCap[member] == 0 ? DEFAULT_REFILL_CAP : userCap[member];
    }

    function _effectiveGlobalCap() private view returns (uint256) {
        return globalCap == 0 ? DEFAULT_REFILL_CAP : globalCap;
    }

    function _validateRiskParam(bytes32, uint256 value, uint256 value2) internal pure override {
        if (value > MAX_REFILL_CAP || value2 != 0) revert CapTooHigh();
    }

    function _writeRiskParam(bytes32 param, uint256 value, uint256) internal override {
        if (capIsGlobal[param]) {
            globalCap = value;
            emit GlobalCapUpdated(value);
        } else {
            address member = capUser[param];
            userCap[member] = value;
            emit UserCapUpdated(member, value);
        }
    }

    function _readRiskParam(bytes32 param) internal view override returns (uint256) {
        return capIsGlobal[param] ? globalCap : userCap[capUser[param]];
    }

    function _riskParamInstant(bytes32 param, uint256 value, uint256) internal view override returns (bool) {
        uint256 current = capIsGlobal[param] ? _effectiveGlobalCap() : _effectiveUserCap(capUser[param]);
        uint256 next = value == 0 ? DEFAULT_REFILL_CAP : value;
        return next <= current;
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }
}
