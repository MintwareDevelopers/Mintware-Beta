// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IYieldAdapter} from "../../vaults/IYieldAdapter.sol";
import {DemoUSD} from "./DemoUSD.sol";

/// @title  DemoLendingAdapter
/// @notice TESTNET ONLY — a simulated lending venue behind the production `IYieldAdapter` seam, so the
///         V2-RWAs demo shows idle liquidity genuinely accruing on-chain. Interest accrues continuously at a
///         fixed `aprBps` on the adapter's balance and is MINTED in `DemoUSD` when realised (`accrue`, any
///         deposit or withdraw). Only the bound vault may deposit or withdraw.
/// @dev    The yield is SIMULATED and the token is valueless; the UI must label it that way. A production
///         unit points the vault at `AaveV3YieldAdapter` / `MintwareMultiVenueYieldAdapter` instead —
///         same interface, so nothing else changes.
contract DemoLendingAdapter is IYieldAdapter, Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant BPS  = 10_000;
    uint256 public constant YEAR = 365 days;

    DemoUSD public immutable underlying;
    uint256 public immutable aprBps;

    address public vault;
    uint64  public lastAccrual;
    uint256 public totalInterestMinted;

    event VaultSet(address indexed vault);
    event Accrued(uint256 interest, uint256 balanceAfter);

    error OnlyVault();
    error AlreadySet();
    error BadApr();

    constructor(DemoUSD underlying_, uint256 aprBps_, address owner_) Ownable(owner_) {
        if (aprBps_ == 0 || aprBps_ > 2_000) revert BadApr(); // ≤ 20% — it's a demo, keep it believable
        underlying  = underlying_;
        aprBps      = aprBps_;
        lastAccrual = uint64(block.timestamp);
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    function setVault(address vault_) external onlyOwner {
        if (vault != address(0)) revert AlreadySet();
        vault = vault_;
        emit VaultSet(vault_);
    }

    function pendingInterest() public view returns (uint256) {
        uint256 bal = underlying.balanceOf(address(this));
        return (bal * aprBps * (block.timestamp - lastAccrual)) / (BPS * YEAR);
    }

    /// @notice Realise accrued interest (mints it into this adapter). Permissionless — it only ever adds.
    function accrue() public {
        uint256 i = pendingInterest();
        lastAccrual = uint64(block.timestamp);
        if (i > 0) {
            underlying.mint(address(this), i);
            totalInterestMinted += i;
            emit Accrued(i, underlying.balanceOf(address(this)));
        }
    }

    function deposit(uint256 amount) external override onlyVault {
        accrue();
        IERC20(address(underlying)).safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 amount) external override onlyVault returns (uint256 withdrawn) {
        accrue();
        uint256 bal = underlying.balanceOf(address(this));
        withdrawn = amount < bal ? amount : bal;
        if (withdrawn > 0) IERC20(address(underlying)).safeTransfer(msg.sender, withdrawn);
    }

    function totalAssets() external view override returns (uint256) {
        return underlying.balanceOf(address(this)) + pendingInterest();
    }

    function maxWithdrawable() external view override returns (uint256) {
        return underlying.balanceOf(address(this)) + pendingInterest();
    }

    function maxSuppliable() external pure override returns (uint256) {
        return type(uint256).max;
    }
}
