// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Round-3 adversarial mocks for the exploit-replay integration pass (`ExploitReplayIntegration*.t.sol`).
///      Test-only. Every knob models a REAL external-counterparty behaviour the LP gateway can meet:
///        - `XRObserverERC20`   : an ERC-20 that calls an OBSERVER on every transfer (ERC-777 `tokensToSend`/
///                                `tokensReceived` shape, generalised to any party) + Paxos-style per-address
///                                freeze + global pause. The observer is the read-only-reentrancy probe.
///        - `XRKnob4626`        : a hand-rolled ERC-4626 (NOT OZ) so `asset()` can be swapped (upgradeable vault),
///                                with Morpho-shaped knobs: deposit cap (`maxDeposit == 0`), entry fee, redeem
///                                haircut (preview fine / redeem realises a loss), liquidity cap (`maxRedeem <
///                                balance`), redeem revert (`NotEnoughLiquidity`), lying return value, and a
///                                pre-state-change probe (the read-only reentrancy window).
///        - `XRRebasingERC20`   : index-rebasing balances (Ampleforth / aToken shape).
///      Contract names are `XR`-prefixed so they can never collide with `RedTeamOnchainTokens.sol` symbols.

interface IXRTransferObserver {
    function onXRTransfer(address token, address from, address to, uint256 value) external;
}

contract XRMintableERC20 is ERC20 {
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

/// Observer + freeze token. `observer` (if set) is called AFTER every balance update, for every transfer, with
/// a low-level call whose failure is swallowed (so a reverting probe never masks the real path). Freeze mirrors
/// Paxos USDG `isFrozen` (transfers to/from a frozen address revert) and a global pause.
contract XRObserverERC20 is XRMintableERC20 {
    address public observer;
    bool public paused;
    mapping(address => bool) public frozen;

    constructor(string memory n, string memory s, uint8 d) XRMintableERC20(n, s, d) {}

    function setObserver(address o) external {
        observer = o;
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
        address o = observer;
        if (o != address(0)) {
            // swallow failures — the observer is a probe, not a gate
            (bool ok,) = o.call(abi.encodeWithSelector(IXRTransferObserver.onXRTransfer.selector, address(this), from, to, value));
            ok;
        }
    }
}

/// Index-rebasing token: balance = shares * index / 1e18. `rebase(newIndex)` moves every balance at once.
contract XRRebasingERC20 {
    string public constant name = "Rebasing Quote";
    string public constant symbol = "rQ";
    uint8 public immutable decimals;
    uint256 public index = 1e18;
    uint256 internal _totalShares;
    mapping(address => uint256) internal _shares;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(uint8 d) {
        decimals = d;
    }

    function rebase(uint256 newIndex) external {
        index = newIndex;
    }

    function totalSupply() external view returns (uint256) {
        return (_totalShares * index) / 1e18;
    }

    function balanceOf(address a) public view returns (uint256) {
        return (_shares[a] * index) / 1e18;
    }

    function mint(address to, uint256 amt) external {
        uint256 sh = (amt * 1e18) / index;
        _shares[to] += sh;
        _totalShares += sh;
        emit Transfer(address(0), to, amt);
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        emit Approval(msg.sender, spender, amt);
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        _move(msg.sender, to, amt);
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= amt, "ALLOWANCE");
            allowance[from][msg.sender] = a - amt;
        }
        _move(from, to, amt);
        return true;
    }

    function _move(address from, address to, uint256 amt) internal {
        uint256 sh = Math.ceilDiv(amt * 1e18, index);
        if (sh > _shares[from] && sh - _shares[from] <= 2) sh = _shares[from]; // rounding tolerance on full-balance moves
        require(_shares[from] >= sh, "BALANCE");
        _shares[from] -= sh;
        _shares[to] += sh;
        emit Transfer(from, to, amt);
    }
}

/// Hand-rolled ERC-4626-shaped yield source with runtime knobs. Share price = (totalAssets+1)/(totalSupply+1)
/// (OZ-style virtual offset, decimalsOffset 0). `asset()` is MUTABLE (`swapAsset`) to model an upgradeable
/// vault whose underlying changes after the adapter verified it once at construction.
contract XRKnob4626 {
    using SafeERC20 for IERC20;

    string public constant name = "Knob Vault";
    string public constant symbol = "kV";
    uint8 public constant decimals = 18;

    IERC20 internal _asset;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ── knobs ──
    uint256 public maxDepositOverride = type(uint256).max; // Morpho supply cap reached => 0
    uint256 public entryFeeBps; // previewDeposit(assets) < convert(assets)
    address public feeSink;
    uint256 public redeemHaircutBps; // preview fine, redeem realises a loss
    uint256 public maxRedeemShares; // 0 = unlimited (Morpho liquidity cap: maxRedeem < balance)
    bool public revertOnRedeem; // Morpho `NotEnoughLiquidity`
    int256 public returnBias; // reported assets = paid + bias (a lying return value)
    address public probeTarget; // low-level probe fired inside redeem BEFORE any state change
    bytes public probeData;
    bool public probeOk;
    bytes public probeRet;
    uint256 public probeCount;

    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event Transfer(address indexed from, address indexed to, uint256 value);

    error NotEnoughLiquidity();
    error ExceededMaxDeposit();
    error ExceededMaxRedeem();

    constructor(IERC20 asset_) {
        _asset = asset_;
        feeSink = msg.sender;
    }

    // ── knob setters ──
    function swapAsset(IERC20 a) external {
        _asset = a;
    }

    function setMaxDeposit(uint256 m) external {
        maxDepositOverride = m;
    }

    function setEntryFeeBps(uint256 b) external {
        entryFeeBps = b;
    }

    function setRedeemHaircutBps(uint256 b) external {
        redeemHaircutBps = b;
    }

    function setMaxRedeemShares(uint256 s) external {
        maxRedeemShares = s;
    }

    function setRevertOnRedeem(bool r) external {
        revertOnRedeem = r;
    }

    function setReturnBias(int256 b) external {
        returnBias = b;
    }

    function setProbe(address target, bytes calldata data) external {
        probeTarget = target;
        probeData = data;
    }

    /// Donate underlying (accrued yield).
    function simulateYield(uint256 amount) external {
        _asset.safeTransferFrom(msg.sender, address(this), amount);
    }

    // ── ERC-4626 surface used by MintwareERC4626YieldAdapter ──
    function asset() external view returns (address) {
        return address(_asset);
    }

    function totalAssets() public view returns (uint256) {
        return _asset.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return Math.mulDiv(assets, totalSupply + 1, totalAssets() + 1, Math.Rounding.Floor);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return Math.mulDiv(shares, totalAssets() + 1, totalSupply + 1, Math.Rounding.Floor);
    }

    function maxDeposit(address) external view returns (uint256) {
        return maxDepositOverride;
    }

    function maxMint(address) external view returns (uint256) {
        return maxDepositOverride;
    }

    function maxRedeem(address owner) public view returns (uint256) {
        uint256 b = balanceOf[owner];
        if (maxRedeemShares != 0 && b > maxRedeemShares) return maxRedeemShares;
        return b;
    }

    function maxWithdraw(address owner) external view returns (uint256) {
        return previewRedeem(maxRedeem(owner));
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        uint256 fee = Math.mulDiv(assets, entryFeeBps, 10_000);
        return convertToShares(assets - fee);
    }

    function previewMint(uint256 shares) external view returns (uint256) {
        return Math.mulDiv(shares, totalAssets() + 1, totalSupply + 1, Math.Rounding.Ceil);
    }

    /// Preview is "fine": it never reflects `redeemHaircutBps` — that loss is realised only on `redeem`.
    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return Math.mulDiv(assets, totalSupply + 1, totalAssets() + 1, Math.Rounding.Ceil);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        if (assets > maxDepositOverride) revert ExceededMaxDeposit();
        shares = previewDeposit(assets);
        uint256 fee = Math.mulDiv(assets, entryFeeBps, 10_000);
        _asset.safeTransferFrom(msg.sender, address(this), assets);
        if (fee > 0) _asset.safeTransfer(feeSink, fee);
        totalSupply += shares;
        balanceOf[receiver] += shares;
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) external returns (uint256 assets) {
        assets = Math.mulDiv(shares, totalAssets() + 1, totalSupply + 1, Math.Rounding.Ceil);
        _asset.safeTransferFrom(msg.sender, address(this), assets);
        totalSupply += shares;
        balanceOf[receiver] += shares;
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        shares = previewWithdraw(assets);
        _redeem(shares, receiver, owner, assets);
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 reported) {
        // Probe fires BEFORE any state change: the classic read-only-reentrancy window (Curve/Sturdy/Sentiment).
        if (probeTarget != address(0)) {
            probeCount++;
            (bool ok, bytes memory ret) = probeTarget.call(probeData);
            probeOk = ok;
            probeRet = ret;
        }
        if (revertOnRedeem) revert NotEnoughLiquidity();
        if (shares > maxRedeem(owner)) revert ExceededMaxRedeem();
        uint256 assets = previewRedeem(shares);
        uint256 paid = _redeem(shares, receiver, owner, assets);
        int256 r = int256(paid) + returnBias;
        reported = r < 0 ? 0 : uint256(r);
    }

    function _redeem(uint256 shares, address receiver, address owner, uint256 assets) internal returns (uint256 paid) {
        if (msg.sender != owner) {
            uint256 a = allowance[owner][msg.sender];
            if (a != type(uint256).max) {
                require(a >= shares, "ALLOWANCE");
                allowance[owner][msg.sender] = a - shares;
            }
        }
        require(balanceOf[owner] >= shares, "SHARES");
        balanceOf[owner] -= shares;
        totalSupply -= shares;
        uint256 haircut = Math.mulDiv(assets, redeemHaircutBps, 10_000);
        paid = assets - haircut;
        if (haircut > 0) _asset.safeTransfer(feeSink, haircut); // the "loss" leaves the vault (realised)
        _asset.safeTransfer(receiver, paid);
        emit Withdraw(msg.sender, receiver, owner, paid, shares);
    }

    // minimal ERC-20 for the share token (the adapter only reads balanceOf)
    function transfer(address to, uint256 amt) external returns (bool) {
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        emit Transfer(msg.sender, to, amt);
        return true;
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }
}
