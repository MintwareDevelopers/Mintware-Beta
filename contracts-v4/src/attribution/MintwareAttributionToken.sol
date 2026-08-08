// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721}  from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712}  from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA}   from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MWTimelockedOracleSigner} from "../lib/MWTimelockedOracleSigner.sol";

/// @dev EIP-5192 minimal soulbound interface.
interface IERC5192 {
    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);
    function locked(uint256 tokenId) external view returns (bool);
}

/// @title  MintwareAttributionToken
/// @notice Soulbound (IERC5192) ERC-721 that MIRRORS a wallet's off-chain Attribution score
///         on-chain for verifiability + composability (Track C, decision D2). The off-chain
///         Worker remains the canonical scorer; the score is written here via an EIP-712
///         attestation signed by the Attribution oracle — the same oracle pattern used by
///         FeeVault / AIAttribution. One non-transferable token per wallet.
///
/// @dev    Stores the scalar `total` plus the economic/network/technical rollup so the vault
///         surfaces can weight it (DeFi 70/30/0, RWA 60/25/15). Per-wallet nonce prevents
///         replay; the oracle attests the CURRENT nonce.
contract MintwareAttributionToken is ERC721, Ownable, EIP712, IERC5192, MWTimelockedOracleSigner {
    struct Score {
        uint256 total;
        uint256 economic;
        uint256 network;
        uint256 technical;
        uint64  updatedAt;
    }

    bytes32 public constant ATTEST_TYPEHASH = keccak256(
        "AttributionAttestation(address wallet,uint256 total,uint256 economic,uint256 network,uint256 technical,uint256 nonce,uint256 deadline)"
    );

    // oracleSigner + 48h timelocked rotation live in MWTimelockedOracleSigner.
    uint256 public nextTokenId = 1;

    mapping(address => uint256) public tokenOf; // wallet => tokenId (0 = none)
    mapping(address => Score)   public scores;  // wallet => score
    mapping(address => uint256) public nonces;  // wallet => attest nonce

    event Attested(address indexed wallet, uint256 indexed tokenId, uint256 total);

    error Soulbound();
    error DeadlinePassed();
    error InvalidSignature();
    error TokenDoesNotExist();

    constructor(address owner_, address _oracleSigner)
        ERC721("Mintware Attribution", "mwATT")
        EIP712("MintwareAttribution", "1")
        Ownable(owner_)
    {
        _initOracleSigner(_oracleSigner);
    }

    /// @notice One-time wiring of the oracle signer; rotation goes through the 48h
    ///         timelock below (audit C7).
    function setOracleSigner(address signer) external onlyOwner {
        _initOracleSigner(signer);
    }

    function proposeOracleSigner(address proposed) external onlyOwner { _proposeOracleSigner(proposed); }
    function confirmOracleSigner() external onlyOwner { _confirmOracleSigner(); }
    function cancelOracleRotation() external onlyOwner { _cancelOracleRotation(); }

    // ── attestation ────────────────────────────────────────────────────────────

    /// @notice Mint (first time) or update `wallet`'s soulbound score from an oracle-signed
    ///         attestation. Anyone may relay a valid signature.
    function attest(
        address wallet,
        uint256 total,
        uint256 economic,
        uint256 network,
        uint256 technical,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert DeadlinePassed();

        bytes32 digest = attestationDigest(wallet, total, economic, network, technical, nonces[wallet], deadline);
        address signer = ECDSA.recover(digest, signature);
        if (signer != oracleSigner) revert InvalidSignature();

        nonces[wallet] += 1;
        scores[wallet] = Score(total, economic, network, technical, uint64(block.timestamp));

        uint256 tokenId = tokenOf[wallet];
        if (tokenId == 0) {
            tokenId = nextTokenId++;
            tokenOf[wallet] = tokenId;
            _safeMint(wallet, tokenId);
            emit Locked(tokenId); // IERC5192 — bound at mint
        }
        emit Attested(wallet, tokenId, total);
    }

    /// @notice Alias for `attest` — re-attest a wallet's current score (spec `recalculateFor`).
    function recalculateFor(
        address wallet,
        uint256 total,
        uint256 economic,
        uint256 network,
        uint256 technical,
        uint256 deadline,
        bytes calldata signature
    ) external {
        this.attest(wallet, total, economic, network, technical, deadline, signature);
    }

    // ── views ────────────────────────────────────────────────────────────────

    function scoreOf(address wallet) external view returns (Score memory) {
        return scores[wallet];
    }

    /// @notice True if `wallet`'s attested total meets `minThreshold`.
    function verifyAttributionThreshold(address wallet, uint256 minThreshold) external view returns (bool) {
        return scores[wallet].total >= minThreshold;
    }

    function attestationDigest(
        address wallet,
        uint256 total,
        uint256 economic,
        uint256 network,
        uint256 technical,
        uint256 nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(ATTEST_TYPEHASH, wallet, total, economic, network, technical, nonce, deadline))
        );
    }

    // ── IERC5192 soulbound ─────────────────────────────────────────────────────

    function locked(uint256 tokenId) external view override returns (bool) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        return true; // always soulbound
    }

    /// @dev Block transfers (allow mint from 0 and burn to 0).
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId);
    }
}
