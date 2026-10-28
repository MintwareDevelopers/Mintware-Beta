// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IYieldAdapter} from "../vaults/IYieldAdapter.sol";

interface IRegisteredMemberDestination { function bufferOf(address member) external view returns (address); }

/// @notice Single-asset Earn vault. Illiquid redemptions pay available assets and burn only
///         shares backing the amount actually received; the unpaid shares remain with the holder.
contract MintwareYieldVault is ERC4626, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant VIRTUAL = 1_000;

    IYieldAdapter public immutable adapter;
    address public gateway;
    mapping(address => address) public destinationOf;

    error ZeroAddress();
    error ZeroAmount();
    error OnlyGateway();
    error InsufficientLiquidity();
    error InsufficientShares();
    error GatewayAlreadySet();
    error AdapterAssetMismatch();
    error DestinationNotRegistered();

    event GatewaySet(address indexed gateway);
    event DestinationSet(address indexed member, address indexed destination);

    constructor(address asset_, address adapter_, address owner_)
        ERC20("Mintware Earn Share", "mwEARN") ERC4626(IERC20(asset_)) Ownable(owner_)
    {
        if (asset_ == address(0) || adapter_ == address(0)) revert ZeroAddress();
        (bool ok, bytes memory data) = adapter_.staticcall(abi.encodeWithSignature("asset()"));
        if (!ok || data.length < 32 || abi.decode(data, (address)) != asset_) revert AdapterAssetMismatch();
        adapter = IYieldAdapter(adapter_);
    }

    function _decimalsOffset() internal pure override returns (uint8) { return 3; }
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + adapter.totalAssets();
    }
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function setGateway(address who) external onlyOwner {
        if (gateway != address(0)) revert GatewayAlreadySet();
        if (who == address(0) || who.code.length == 0) revert ZeroAddress();
        gateway = who;
        emit GatewaySet(who);
    }
    function registerDestination(address member, address destination) external onlyGateway {
        if (member == address(0) || destination == address(0)) revert ZeroAddress();
        if (IRegisteredMemberDestination(msg.sender).bufferOf(member) != destination) revert DestinationNotRegistered();
        destinationOf[member] = destination;
        emit DestinationSet(member, destination);
    }
    function shares(address member) external view returns (uint256) { return balanceOf(member); }
    function totalShares() external view returns (uint256) { return totalSupply(); }
    function idleBuffer() external view returns (uint256) {
        uint256 cash = IERC20(asset()).balanceOf(address(this));
        try adapter.maxWithdrawable() returns (uint256 source) { return cash + source; }
        catch { return cash; }
    }
    function maxDeposit(address) public view override returns (uint256) {
        return paused() ? 0 : type(uint256).max;
    }
    function maxMint(address) public view override returns (uint256) {
        return paused() ? 0 : type(uint256).max;
    }
    function maxWithdraw(address owner_) public view override returns (uint256) {
        uint256 claim = previewRedeem(balanceOf(owner_));
        uint256 cash = IERC20(asset()).balanceOf(address(this));
        uint256 source;
        try adapter.maxWithdrawable() returns (uint256 available) { source = available; } catch {}
        return claim < cash + source ? claim : cash + source;
    }
    function maxRedeem(address owner_) public view override returns (uint256) {
        uint256 bal = balanceOf(owner_);
        uint256 liquidShares = convertToShares(maxWithdraw(owner_));
        return bal < liquidShares ? bal : liquidShares;
    }
    function deposit(uint256 assets_, address receiver) public override whenNotPaused nonReentrant returns (uint256) {
        return super.deposit(assets_, receiver);
    }
    function mint(uint256 shares_, address receiver) public override whenNotPaused nonReentrant returns (uint256) {
        return super.mint(shares_, receiver);
    }
    function withdraw(uint256 assets_, address receiver, address owner_)
        public override nonReentrant returns (uint256 shares_)
    {
        if (assets_ > maxWithdraw(owner_)) revert InsufficientLiquidity();
        shares_ = previewWithdraw(assets_);
        _authorize(owner_, shares_);
        _burn(owner_, shares_);
        (uint256 paid,) = _pull(assets_);
        if (paid < assets_) revert InsufficientLiquidity();
        IERC20(asset()).safeTransfer(receiver, assets_);
        emit Withdraw(msg.sender, receiver, owner_, assets_, shares_);
    }
    function redeem(uint256 shares_, address receiver, address owner_)
        public override nonReentrant returns (uint256 assets_)
    {
        if (shares_ == 0) revert ZeroAmount();
        if (shares_ > balanceOf(owner_)) revert InsufficientShares();
        uint256 allowed = msg.sender == owner_ ? type(uint256).max : allowance(owner_, msg.sender);
        _authorize(owner_, shares_);
        uint256 claim = previewRedeem(shares_);
        uint256 available = maxWithdraw(owner_);
        uint256 target = claim < available ? claim : available;
        uint256 taBefore = totalAssets();
        (uint256 got, uint256 cost) = _pull(target);
        assets_ = got;
        uint256 burned = cost == 0 ? 0 : Math.mulDiv(cost, totalSupply() + VIRTUAL, taBefore + 1, Math.Rounding.Ceil);
        if (burned > shares_) burned = shares_;
        if (msg.sender != owner_ && allowed != type(uint256).max && burned < shares_) {
            _approve(owner_, msg.sender, allowed - burned);
        }
        if (burned != 0) {
            _burn(owner_, burned);
            IERC20(asset()).safeTransfer(receiver, assets_);
        }
        emit Withdraw(msg.sender, receiver, owner_, assets_, burned);
    }
    /// @notice Gateway may redeem only the member's shares; proceeds go to their self-registered destination.
    function gatewayRedeem(address member, uint256 shares_) external onlyGateway nonReentrant returns (uint256) {
        address destination = destinationOf[member];
        if (destination == address(0)) revert ZeroAddress();
        return _redeemFor(member, shares_, destination);
    }
    modifier onlyGateway() { if (msg.sender != gateway) revert OnlyGateway(); _; }
    function _redeemFor(address owner_, uint256 shares_, address receiver) internal returns (uint256 assets_) {
        if (shares_ == 0 || shares_ > balanceOf(owner_)) revert InsufficientShares();
        uint256 claim = previewRedeem(shares_);
        uint256 available = maxWithdraw(owner_);
        uint256 target = claim < available ? claim : available;
        uint256 taBefore = totalAssets();
        uint256 cost;
        (assets_, cost) = _pull(target);
        uint256 burned = cost == 0 ? 0 : Math.mulDiv(cost, totalSupply() + VIRTUAL, taBefore + 1, Math.Rounding.Ceil);
        if (burned > shares_) burned = shares_;
        if (burned != 0) { _burn(owner_, burned); IERC20(asset()).safeTransfer(receiver, assets_); }
        emit Withdraw(msg.sender, receiver, owner_, assets_, burned);
    }
    function _authorize(address owner_, uint256 shares_) internal {
        if (msg.sender != owner_) _spendAllowance(owner_, msg.sender, shares_);
    }
    function _pull(uint256 amount) internal returns (uint256 received, uint256 cost) {
        IERC20 token = IERC20(asset());
        uint256 cashBefore = token.balanceOf(address(this));
        uint256 cashUsed = cashBefore < amount ? cashBefore : amount;
        uint256 want = amount - cashUsed;
        uint256 sourceBefore = adapter.totalAssets();
        if (want != 0) try adapter.withdraw(want) returns (uint256) {} catch {}
        uint256 delta = token.balanceOf(address(this)) - cashBefore;
        received = cashUsed + delta;
        try adapter.totalAssets() returns (uint256 sourceAfter) {
            cost = cashUsed + (sourceBefore > sourceAfter ? sourceBefore - sourceAfter : 0);
        }
        catch { cost = cashUsed + want; }
        if (received > amount) received = amount;
    }
    function _deposit(address caller, address receiver, uint256 assets_, uint256 shares_)
        internal override whenNotPaused
    {
        super._deposit(caller, receiver, assets_, shares_);
        IERC20 token = IERC20(asset());
        uint256 supplyable;
        try adapter.maxSuppliable() returns (uint256 max) { supplyable = max; } catch { return; }
        uint256 amount = assets_ < supplyable ? assets_ : supplyable;
        if (amount != 0) {
            token.forceApprove(address(adapter), amount);
            try adapter.deposit(amount) {} catch {}
            token.forceApprove(address(adapter), 0);
        }
    }
}
