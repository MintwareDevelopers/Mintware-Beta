// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Red-team adversarial tokens + yield sources for the LP Gateway V1 on-chain red-team
///      (`RedTeamOnchain*.t.sol`). Test-only. Each models a REAL class of counterparty the gateway
///      may face: a meme token with a blacklist / pause, a hook-bearing (ERC777-style) token, a
///      fee-on-transfer token, and a 4626 source that misbehaves.

contract RTMintableERC20 is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/// Paxos-USDG / meme-with-blacklist shape: admin can freeze an address (transfers to/from revert) and
/// pause the whole token.
contract RTBlacklistERC20 is RTMintableERC20 {
    address public admin;
    bool public pausedAll;
    mapping(address => bool) public blacklisted;

    constructor(string memory n, string memory s, uint8 d) RTMintableERC20(n, s, d) {
        admin = msg.sender;
    }

    function setBlacklisted(address a, bool b) external {
        require(msg.sender == admin, "admin");
        blacklisted[a] = b;
    }

    function setPaused(bool p) external {
        require(msg.sender == admin, "admin");
        pausedAll = p;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!pausedAll, "TOKEN_PAUSED");
        require(!blacklisted[from] && !blacklisted[to], "BLACKLISTED");
        super._update(from, to, value);
    }
}

interface IRTTokenReceiver {
    function onRTTokenReceived(address from, uint256 amount) external;
}

/// ERC777-style token: a receiver that has opted in gets a callback AFTER every transfer to it.
contract RTHookERC20 is RTMintableERC20 {
    mapping(address => bool) public hooked;

    constructor(string memory n, string memory s, uint8 d) RTMintableERC20(n, s, d) {}

    function registerHook(bool on) external {
        hooked[msg.sender] = on;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (hooked[to]) IRTTokenReceiver(to).onRTTokenReceived(from, value);
    }
}

/// Fee-on-transfer token (fee skimmed to `sink` on every non-mint/burn transfer).
contract RTFeeOnTransferERC20 is RTMintableERC20 {
    uint256 public feeBps;
    address public sink;

    constructor(string memory n, string memory s, uint8 d, uint256 feeBps_) RTMintableERC20(n, s, d) {
        feeBps = feeBps_;
        sink = msg.sender;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && feeBps > 0) {
            uint256 fee = (value * feeBps) / 10_000;
            super._update(from, sink, fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

/// A 4626 source whose behaviour can be flipped at runtime: mutable exit fee (fee-net previewRedeem),
/// deposits disabled (maxDeposit == 0 + deposit reverts), previewRedeem reverting, and a reentrancy
/// probe fired from inside `redeem` at an arbitrary target/calldata.
contract RTFlaky4626 is ERC4626 {
    using Math for uint256;

    uint256 public exitFeeBps;
    bool public depositsDisabled;
    bool public revertPreview;
    address public reenterTarget;
    bytes public reenterData;
    bool public reenterSucceeded;
    bytes public reenterRevert;

    constructor(IERC20 asset_) ERC20("Flaky", "FLK") ERC4626(asset_) {}

    /// Raise assets-per-share by donating underlying (accrued yield), like MockERC4626.
    function simulateYield(uint256 amount) external {
        IERC20(asset()).transferFrom(msg.sender, address(this), amount);
    }

    function setExitFeeBps(uint256 bps) external {
        exitFeeBps = bps;
    }

    function setDepositsDisabled(bool d) external {
        depositsDisabled = d;
    }

    function setRevertPreview(bool r) external {
        revertPreview = r;
    }

    function setReenter(address target, bytes calldata data) external {
        reenterTarget = target;
        reenterData = data;
    }

    function maxDeposit(address) public view override returns (uint256) {
        return depositsDisabled ? 0 : type(uint256).max;
    }

    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        require(!depositsDisabled, "SUPPLY_CAP");
        return super.deposit(assets, receiver);
    }

    function previewRedeem(uint256 shares) public view override returns (uint256) {
        require(!revertPreview, "PREVIEW_DOWN");
        uint256 gross = super.previewRedeem(shares);
        return gross - gross.mulDiv(exitFeeBps, 10_000);
    }

    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        uint256 gross = assets.mulDiv(10_000, 10_000 - exitFeeBps, Math.Rounding.Ceil);
        return super.previewWithdraw(gross);
    }

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        if (reenterTarget != address(0)) {
            (bool ok, bytes memory ret) = reenterTarget.call(reenterData);
            reenterSucceeded = ok;
            reenterRevert = ret;
        }
        require(shares <= maxRedeem(owner), "redeem>max");
        uint256 net = previewRedeem(shares);
        _withdraw(_msgSender(), receiver, owner, net, shares);
        return net;
    }
}
