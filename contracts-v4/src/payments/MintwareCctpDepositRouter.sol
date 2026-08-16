// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Minimal view of Circle's CCTP MessageTransmitter — the destination-chain half. `receiveMessage`
///      verifies Circle's attestation over the burn message and MINTS the bridged USDC to the message's
///      `mintRecipient`. Signature is stable across CCTP v1/v2.
interface IMessageTransmitter {
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool success);
}

/// @dev The vault deposit surface — `MintwareYieldVault.deposit` mints shares to `to`, pulling USDC from
///      `msg.sender` (this router).
interface IYieldVaultDeposit {
    function deposit(uint256 assets, address to) external returns (uint256 sharesMinted);
}

/// @title  MintwareCctpDepositRouter
/// @notice Arc-side "bridge-and-deposit": completes a Circle CCTP transfer (USDC burned on Base) and, in
///         the same tx, deposits the freshly-minted USDC into the YPN `MintwareYieldVault`, crediting the
///         end user. This is how USDC earned on the Base side (or brought from anywhere) lands productive on
///         Arc without the user doing two transactions.
///
/// @dev    The burn on the source chain sets the CCTP `mintRecipient` to THIS router, so `receiveMessage`
///         mints the USDC here; the router then deposits it to `recipient`.
///
///         RECIPIENT BINDING (the one thing to get right): CCTP attestations are public once Circle signs,
///         and whoever calls `receiveMessage` for a router-recipient burn decides where the USDC goes. So a
///         permissionless `receiveAndDeposit(recipient)` would let anyone redirect a victim's bridged USDC.
///         We therefore gate it to the **relayer** — the same trusted role that settles — which supplies the
///         `recipient` it tracked from the user's burn intent. A future CCTP-v2 variant can make this
///         permissionless by carrying `recipient` in the burn's `hookData` (bound to the burn); until then,
///         relayer-gated is the safe, simple choice. Balance-diff accounting throughout (Bunni-safe).
contract MintwareCctpDepositRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IMessageTransmitter public immutable messageTransmitter;
    IERC20              public immutable usdc;
    IYieldVaultDeposit  public immutable vault;

    /// @notice The only address allowed to complete a bridge-and-deposit (supplies the tracked recipient).
    address public relayer;

    event RelayerSet(address indexed relayer);
    event BridgedAndDeposited(address indexed recipient, uint256 usdcMinted, uint256 sharesMinted);

    error ZeroAddress();
    error OnlyRelayer();
    error ReceiveFailed();
    error NothingMinted();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert OnlyRelayer();
        _;
    }

    constructor(address messageTransmitter_, address usdc_, address vault_, address owner_, address relayer_)
        Ownable(owner_)
    {
        if (messageTransmitter_ == address(0) || usdc_ == address(0) || vault_ == address(0) || relayer_ == address(0)) {
            revert ZeroAddress();
        }
        messageTransmitter = IMessageTransmitter(messageTransmitter_);
        usdc               = IERC20(usdc_);
        vault              = IYieldVaultDeposit(vault_);
        relayer            = relayer_;
        emit RelayerSet(relayer_);
    }

    function setRelayer(address relayer_) external onlyOwner {
        if (relayer_ == address(0)) revert ZeroAddress();
        relayer = relayer_;
        emit RelayerSet(relayer_);
    }

    /// @notice Complete a CCTP transfer (mints USDC to this router) and deposit it into the vault for
    ///         `recipient`. Idempotent at the CCTP layer — `receiveMessage` reverts on a replayed/consumed
    ///         message, so a message can only be deposited once.
    /// @param message     The CCTP burn message.
    /// @param attestation Circle's attestation over `message`.
    /// @param recipient   Who to credit the vault shares to (the user who initiated the burn).
    /// @return sharesMinted Shares credited to `recipient`.
    function receiveAndDeposit(bytes calldata message, bytes calldata attestation, address recipient)
        external
        onlyRelayer
        nonReentrant
        returns (uint256 sharesMinted)
    {
        if (recipient == address(0)) revert ZeroAddress();

        uint256 before = usdc.balanceOf(address(this));
        if (!messageTransmitter.receiveMessage(message, attestation)) revert ReceiveFailed();
        uint256 minted = usdc.balanceOf(address(this)) - before; // balance-diff: exactly what CCTP minted
        if (minted == 0) revert NothingMinted();

        usdc.forceApprove(address(vault), minted);
        sharesMinted = vault.deposit(minted, recipient); // pulls `minted` from this router, mints to recipient
        usdc.forceApprove(address(vault), 0); // clear any residual allowance (defense-in-depth)

        emit BridgedAndDeposited(recipient, minted, sharesMinted);
    }
}
