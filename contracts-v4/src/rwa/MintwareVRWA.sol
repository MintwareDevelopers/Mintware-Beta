// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20}   from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Transfer regimes for the vRWA bearer instrument.
enum TransferMode {
    PERMISSIONLESS, // freely transferable (default — it is a bearer instrument)
    WHITELISTED,    // only transfers between whitelisted addresses
    FROZEN          // no transfers (emergency)
}

/// @title  MintwareVRWA
/// @notice ERC-20 vault-share instrument minted 1:1 with RWA vault shares (Track B). The default
///         PERMISSIONLESS mode suits Reg A+ assets; for Reg D assets governance moves it to
///         WHITELISTED via a 48h-timelocked mode change so transfers are gated to verified holders,
///         and a guardian can FREEZE instantly in an emergency. Mint/burn are restricted to the
///         vault (minter) and are always allowed regardless of mode.
///
/// @dev    In WHITELISTED mode (Reg D) transfer eligibility is enforced here in `_update` against
///         the whitelist (registry-driven per the three-role build plan) — i.e. KYC is enforced at
///         the trade/transfer boundary, not only at redemption. In PERMISSIONLESS mode (Reg A+) vRWA
///         trades openly and KYC applies at SPV redemption / dividend claims / governance only.
contract MintwareVRWA is ERC20, Ownable {
    uint8   private immutable _dec;
    uint256 public constant TRANSFER_MODE_TIMELOCK = 48 hours;

    address public minter;    // the RWA vault — mint on deposit, burn on redeem
    address public guardian;  // emergency freeze

    TransferMode public transferMode = TransferMode.PERMISSIONLESS;
    mapping(address => bool) public whitelisted;

    TransferMode public pendingMode;
    uint256 public pendingModeEta; // 0 = none pending

    event MinterSet(address indexed minter);
    event GuardianSet(address indexed guardian);
    event WhitelistSet(address indexed account, bool allowed);
    event TransferModeProposed(TransferMode mode, uint256 eta);
    event TransferModeConfirmed(TransferMode mode);
    event EmergencyFrozen();

    error OnlyMinter();
    error OnlyGuardian();
    error TransfersFrozen();
    error NotWhitelisted();
    error NoPendingMode();
    error TimelockNotElapsed();

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        _dec = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    // ── admin ────────────────────────────────────────────────────────────────

    function setMinter(address _minter) external onlyOwner {
        minter = _minter;
        emit MinterSet(_minter);
    }

    function setGuardian(address _guardian) external onlyOwner {
        guardian = _guardian;
        emit GuardianSet(_guardian);
    }

    function setWhitelist(address account, bool allowed) external onlyOwner {
        whitelisted[account] = allowed;
        emit WhitelistSet(account, allowed);
    }

    // ── mint / burn (vault only) ──────────────────────────────────────────────

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert OnlyMinter();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != minter) revert OnlyMinter();
        _burn(from, amount);
    }

    // ── transfer mode (48h timelock) + emergency freeze ───────────────────────

    function proposeTransferMode(TransferMode mode) external onlyOwner {
        pendingMode    = mode;
        pendingModeEta = block.timestamp + TRANSFER_MODE_TIMELOCK;
        emit TransferModeProposed(mode, pendingModeEta);
    }

    function confirmTransferMode() external onlyOwner {
        if (pendingModeEta == 0) revert NoPendingMode();
        if (block.timestamp < pendingModeEta) revert TimelockNotElapsed();
        transferMode   = pendingMode;
        pendingModeEta = 0;
        emit TransferModeConfirmed(transferMode);
    }

    /// @notice Guardian can freeze instantly (bypasses the timelock). Recovery out of
    ///         FROZEN goes through the normal timelocked propose/confirm.
    function emergencyFreeze() external {
        if (msg.sender != guardian) revert OnlyGuardian();
        transferMode = TransferMode.FROZEN;
        emit EmergencyFrozen();
    }

    // ── transfer enforcement ──────────────────────────────────────────────────

    function _update(address from, address to, uint256 value) internal override {
        // Mint (from == 0) and burn (to == 0) are always allowed.
        if (from != address(0) && to != address(0)) {
            if (transferMode == TransferMode.FROZEN) revert TransfersFrozen();
            if (transferMode == TransferMode.WHITELISTED && (!whitelisted[from] || !whitelisted[to])) {
                revert NotWhitelisted();
            }
        }
        super._update(from, to, value);
    }
}
