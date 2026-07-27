// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}      from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}   from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}     from "@openzeppelin/contracts/access/Ownable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import {SPVBeneficiaryRegistry, KYCLevel} from "./SPVBeneficiaryRegistry.sol";

/// @title  PVDistributionEscrow
/// @notice Holds RWA dividend / SPV distributions and releases them to beneficiaries,
///         KYC-gated (Track B). A verified provider funds a distribution with a Merkle root
///         of (beneficiary, amount) leaves; beneficiaries claim with a proof, but ONLY after
///         clearing KYC in the SPVBeneficiaryRegistry.
///
/// @dev    Leaf encoding matches MintwareDistributor: keccak256(bytes.concat(keccak256(
///         abi.encode(account, amount)))). KYC is checked at claim — the redemption boundary.
contract PVDistributionEscrow is Ownable {
    using SafeERC20 for IERC20;

    struct Distribution {
        address provider;
        IERC20  token;
        bytes32 merkleRoot;
        uint256 total;
        uint256 claimed;
        bool    active;
    }

    SPVBeneficiaryRegistry public immutable registry;
    KYCLevel public constant MIN_KYC = KYCLevel.BASIC;

    mapping(bytes32 => Distribution) public distributions;
    mapping(bytes32 => mapping(address => bool)) public hasClaimed;

    event DistributionCreated(bytes32 indexed id, address indexed provider, address token, uint256 total);
    event DistributionClaimed(bytes32 indexed id, address indexed beneficiary, uint256 amount);

    error DistributionExists();
    error UnknownDistribution();
    error AlreadyClaimed();
    error InvalidProof();
    error ExceedsTotal();

    constructor(address _registry, address owner_) Ownable(owner_) {
        registry = SPVBeneficiaryRegistry(_registry);
    }

    /// @notice Fund + commit a distribution (issuer pulls `total` of `token` into escrow).
    function createDistribution(bytes32 id, address token, bytes32 merkleRoot, uint256 total) external {
        if (distributions[id].active) revert DistributionExists();
        distributions[id] = Distribution({
            provider:   msg.sender,
            token:      IERC20(token),
            merkleRoot: merkleRoot,
            total:      total,
            claimed:    0,
            active:     true
        });
        IERC20(token).safeTransferFrom(msg.sender, address(this), total);
        emit DistributionCreated(id, msg.sender, token, total);
    }

    /// @notice Claim a distribution allocation — requires a valid proof AND KYC clearance.
    function claim(bytes32 id, uint256 amount, bytes32[] calldata proof) external {
        Distribution storage d = distributions[id];
        if (!d.active) revert UnknownDistribution();
        if (hasClaimed[id][msg.sender]) revert AlreadyClaimed();

        // KYC gate at the distribution/redemption boundary.
        registry.requireBeneficiary(msg.sender, MIN_KYC);

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));
        if (!MerkleProof.verify(proof, d.merkleRoot, leaf)) revert InvalidProof();
        if (d.claimed + amount > d.total) revert ExceedsTotal();

        hasClaimed[id][msg.sender] = true;
        d.claimed += amount;
        d.token.safeTransfer(msg.sender, amount);
        emit DistributionClaimed(id, msg.sender, amount);
    }
}
