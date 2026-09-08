// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Round-3 invariant-fuzzing mocks. Self-contained copies (no import of a `.t.sol`) so the two
///         `Invariant*.t.sol` suites do not drag another test contract's setUp into their artifact set.

/// @dev Adversarial ERC-4626 yield source for the idle-only suite. Levers:
///        - `simulateYield(D)`      : donation → assets-per-share rises (accrued yield / inflation attack)
///        - `setFailWithdrawals`    : `withdraw`/`redeem` revert (paused Morpho) — adapter serves 0
///        - `setRevertPreview`      : `previewRedeem` reverts → adapter `totalAssets` reverts → PM `SourceUnavailable`
///        - `setExitFeeBps`         : fee-charging source (L-05 / scope invariant 5)
///        - `setSupplyCap`          : Morpho-style supply cap (`maxDeposit` shrinks to the headroom, 0 at the cap) —
///                                    the live RH-mainnet state (round-3 R3-2: leftover re-stage inside `deploy`
///                                    must NOT DoS the deploy → `RestageDeferred`); a PM deposit that overshoots
///                                    the cap reverts with the source's own `ERC4626ExceededMaxDeposit`.
///      `maxWithdraw` stays truthful while withdrawals fail so the adapter ATTEMPTS the redeem and hits the
///      try/catch (the best-effort path), not the `maxWithdrawable == 0` short-circuit.
contract Audit3FlakySource is ERC4626 {
    using Math for uint256;

    bool public failWithdrawals;
    bool public revertPreview;
    uint256 public exitFeeBps;
    uint256 public supplyCap; // 0 = uncapped; else max totalAssets the source accepts

    constructor(IERC20 asset_) ERC20("Audit3 Flaky Source", "A3FLK") ERC4626(asset_) {}

    function simulateYield(uint256 amount) external {
        SafeERC20.safeTransferFrom(IERC20(asset()), msg.sender, address(this), amount);
    }

    function setFailWithdrawals(bool f) external {
        failWithdrawals = f;
    }

    function setRevertPreview(bool r) external {
        revertPreview = r;
    }

    function setExitFeeBps(uint256 bps) external {
        require(bps < 10_000, "fee");
        exitFeeBps = bps;
    }

    function setSupplyCap(uint256 cap) external {
        supplyCap = cap;
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (supplyCap == 0) return type(uint256).max;
        uint256 ta = totalAssets();
        return ta >= supplyCap ? 0 : supplyCap - ta;
    }

    function previewRedeem(uint256 shares) public view override returns (uint256) {
        require(!revertPreview, "PREVIEW_DOWN");
        uint256 gross = super.previewRedeem(shares);
        return gross - gross.mulDiv(exitFeeBps, 10_000);
    }

    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        uint256 gross = exitFeeBps == 0 ? assets : assets.mulDiv(10_000, 10_000 - exitFeeBps, Math.Rounding.Ceil);
        return super.previewWithdraw(gross);
    }

    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256) {
        require(!failWithdrawals, "WITHDRAW_DOWN");
        return super.withdraw(assets, receiver, owner);
    }

    /// Fee-aware redeem: pays `previewRedeem(shares)` (net), burns `shares`. The fee stays in the source.
    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        require(!failWithdrawals, "WITHDRAW_DOWN");
        require(shares <= maxRedeem(owner), "redeem>max");
        uint256 net = previewRedeem(shares);
        _withdraw(_msgSender(), receiver, owner, net, shares);
        return net;
    }
}

/// @dev Real-token failure modes for the fork suite: issuer pause + per-address freeze (Paxos USDG `isFrozen`,
///      meme-token blacklist). Copy of the round-2 fork harness token.
contract Audit3FailableToken is ERC20 {
    uint8 private immutable _dec;
    bool public paused;
    mapping(address => bool) public frozen;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function setPaused(bool p) external {
        paused = p;
    }

    function setFrozen(address a, bool f) external {
        frozen[a] = f;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!paused, "TOKEN_PAUSED");
        require(!frozen[from] && !frozen[to], "ADDRESS_FROZEN");
        super._update(from, to, value);
    }
}

/// @dev Non-zero code at the v4 addresses for the idle-only rig (tokenId stays 0, so v4 is never called).
contract Audit3Stub {}
