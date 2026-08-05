// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev KYC tiers for SPV beneficiaries.
enum KYCLevel {
    NONE,
    BASIC,
    ACCREDITED,
    INSTITUTIONAL
}

/// @title  SPVBeneficiaryRegistry
/// @notice KYC/beneficiary registry for the RWA surface (Track B). A KYC provider records
///         verification; for Reg D assets the vRWA token's WHITELISTED transfer gate reads this
///         registry, so KYC is enforced at the trade/transfer boundary as well as at redemption.
///         (Reg A+ assets trade openly; the registry then gates redemption only.)
///
/// @dev    Under the three-role model this registry is the on-chain source of truth for who may
///         hold/receive a Reg D vRWA: the token's `_update` gate and the redemption / SPV
///         distribution / governance flows all check it. See rwa-compliance-three-role-model.md.
contract SPVBeneficiaryRegistry is Ownable {
    struct KYCRecord {
        KYCLevel level;
        uint64   verifiedAt;
        uint64   expiresAt;
        bytes32  providerHash; // hash of the off-chain KYC provider reference (Sumsub/Onfido)
        bytes2   countryCode;  // ISO 3166-1 alpha-2
        bool     isActive;
        bool     isRestricted; // sanctioned / restricted jurisdiction
    }

    /// @notice Address permitted to write KYC records (the KYC provider integration).
    address public kycProvider;

    mapping(address => KYCRecord) public records;

    event KycProviderSet(address indexed provider);
    event BeneficiaryVerified(address indexed account, KYCLevel level, bytes2 countryCode, uint64 expiresAt);
    event BeneficiaryRevoked(address indexed account);

    error OnlyKycProvider();
    error ZeroAddress();

    constructor(address owner_) Ownable(owner_) {}

    modifier onlyKycProvider() {
        if (msg.sender != kycProvider) revert OnlyKycProvider();
        _;
    }

    function setKycProvider(address provider) external onlyOwner {
        if (provider == address(0)) revert ZeroAddress();
        kycProvider = provider;
        emit KycProviderSet(provider);
    }

    function verifyBeneficiary(
        address account,
        KYCLevel level,
        bytes32 providerHash,
        bytes2 countryCode,
        uint64 expiresAt,
        bool isRestricted
    ) external onlyKycProvider {
        records[account] = KYCRecord({
            level:        level,
            verifiedAt:   uint64(block.timestamp),
            expiresAt:    expiresAt,
            providerHash: providerHash,
            countryCode:  countryCode,
            isActive:     true,
            isRestricted: isRestricted
        });
        emit BeneficiaryVerified(account, level, countryCode, expiresAt);
    }

    function revokeBeneficiary(address account) external onlyKycProvider {
        records[account].isActive = false;
        emit BeneficiaryRevoked(account);
    }

    /// @notice A beneficiary is verified iff active, not restricted, not expired, level > NONE.
    function checkBeneficiary(address account) public view returns (bool verified, KYCLevel level) {
        KYCRecord storage r = records[account];
        level = r.level;
        verified =
            r.isActive &&
            !r.isRestricted &&
            r.level != KYCLevel.NONE &&
            (r.expiresAt == 0 || r.expiresAt > block.timestamp);
    }

    /// @notice Revert unless `account` clears KYC at the required minimum level.
    function requireBeneficiary(address account, KYCLevel minLevel) external view {
        (bool verified, KYCLevel level) = checkBeneficiary(account);
        require(verified && uint8(level) >= uint8(minLevel), "SPV: KYC required");
    }
}
