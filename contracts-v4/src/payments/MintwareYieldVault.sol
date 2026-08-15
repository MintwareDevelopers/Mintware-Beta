// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable}        from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math}            from "@openzeppelin/contracts/utils/math/Math.sol";

import {IYieldVault}   from "./IYieldVault.sol";
import {IYieldAdapter} from "../vaults/IYieldAdapter.sol";
import {SeniorSharesMath} from "../lib/SeniorSharesMath.sol";

/// @title  MintwareYieldVault
/// @notice YPN v1 settlement vault: a single-asset (USDC) ERC-4626-style vault whose idle capital sits
///         in Aave via an `IYieldAdapter`. It is the native implementation of `IYieldVault` — the
///         boundary `MintwarePaymentGateway` settles card charges against. NO oracle, NO price, NO JIT:
///         it holds exactly one asset, so it is price-free by construction and cannot be manipulated by
///         a price feed.
///
/// @dev    NAV = `totalAssets() / totalShares` where `totalAssets() = adapter.totalAssets() +
///         usdc.balanceOf(this)`. aTokens rebase inside the adapter, so yield accrues into `totalAssets`
///         with zero bookkeeping and NAV rises monotonically (absent a realized Aave loss).
///
/// @dev    INFLATION DEFENSE — symmetric virtual shares + virtual assets. Every conversion adds the same
///         constant `VIRTUAL = 1e3` to BOTH the share side and the asset side:
///           shares  = assets * (totalShares + VIRTUAL) / (totalAssets + VIRTUAL)   (mint, round DOWN)
///           assets  = shares * (totalAssets + VIRTUAL) / (totalShares + VIRTUAL)   (redeem, round DOWN)
///         The virtual ASSET term (`+VIRTUAL` on the denominator during mint) neutralizes the classic
///         first-depositor / donation inflation attack: to round a victim's mint to zero an attacker must
///         donate ~`VIRTUAL ×` the victim's deposit, which is economically nonviable. The virtual SHARE
///         term seeds a 1:1 genesis exchange rate. Because `VIRTUAL` is added SYMMETRICALLY it cancels in
///         the solvency algebra: it is an invariant that `totalShares <= totalAssets` (see the proof in
///         the README/handoff), which is exactly `totalAssets >= Σ shares·NAV` — the vault is solvent by
///         construction. No dead shares are minted (the offset is virtual, not a real burn).
///
/// @dev    ROUNDING — every division rounds toward the vault:
///           • deposit mint → DOWN  (user is credited no more shares than fair; vault never over-issues).
///           • previewWithdraw → UP (Gateway burns AT LEAST enough shares to cover `assets`, so the
///             subsequent burn redeems >= assets — the Gateway asserts `redeemed >= assets`).
///           • burnForPayment / redeem asset math → DOWN (vault pays out no more than fair).
contract MintwareYieldVault is IYieldVault, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    /// @notice Symmetric virtual offset (virtual shares == virtual assets). See contract NatSpec.
    uint256 public constant VIRTUAL = 1e3;

    IERC20        public immutable usdc;    // 6dp settlement asset
    IYieldAdapter public immutable adapter; // wraps aUSDC; holds the idle capital

    /// @notice The sole caller of `burnForPayment`. Set once (see `setGateway`).
    address public gateway;

    mapping(address => uint256) public shares;
    uint256 public totalShares;

    event GatewaySet(address indexed gateway);
    event Deposit(address indexed caller, address indexed to, uint256 assets, uint256 sharesMinted);
    event Redeem(address indexed owner, uint256 sharesBurned, uint256 assets);
    event PaymentBurn(address indexed user, address indexed receiver, uint256 sharesBurned, uint256 assetsRedeemed);

    error ZeroAddress();
    error ZeroAmount();
    error GatewayAlreadySet();
    error OnlyGateway();
    error InsufficientShares();
    error InsufficientIdleLiquidity();

    modifier onlyGateway() {
        if (msg.sender != gateway) revert OnlyGateway();
        _;
    }

    /// @param usdc_    The USDC token (settlement asset).
    /// @param adapter_ The yield adapter over Aave whose underlying is `usdc_`.
    /// @param owner_   Vault owner (can set the gateway once, pause/unpause).
    constructor(address usdc_, address adapter_, address owner_) Ownable(owner_) {
        if (usdc_ == address(0) || adapter_ == address(0)) revert ZeroAddress();
        usdc    = IERC20(usdc_);
        adapter = IYieldAdapter(adapter_);
    }

    // ── admin ────────────────────────────────────────────────────────────────────
    /// @notice Wire the Gateway ONCE. Set-once is safer than owner-updatable: the burn authority can
    ///         never be silently repointed at a malicious gateway after users have deposited.
    function setGateway(address gateway_) external onlyOwner {
        if (gateway != address(0)) revert GatewayAlreadySet();
        if (gateway_ == address(0)) revert ZeroAddress();
        gateway = gateway_;
        emit GatewaySet(gateway_);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── views / conversions ──────────────────────────────────────────────────────

    /// @notice Aave principal + accrued interest (via the adapter) plus any un-supplied USDC buffer.
    function totalAssets() public view returns (uint256) {
        return adapter.totalAssets() + usdc.balanceOf(address(this));
    }

    /// @notice Shares minted for a deposit of `assets` right now — rounds DOWN (favors the vault).
    function previewDeposit(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets, totalAssets(), Math.Rounding.Floor);
    }

    /// @inheritdoc IYieldVault
    /// @dev Shares that must be burned to redeem `assets` — rounds UP so a following `burnForPayment`
    ///      of the returned shares redeems >= `assets`.
    function previewWithdraw(uint256 assets) external view returns (uint256 shares_) {
        return _convertToShares(assets, totalAssets(), Math.Rounding.Ceil);
    }

    /// @notice Assets returned for burning `shares_` right now — rounds DOWN (favors the vault).
    function convertToAssets(uint256 shares_) public view returns (uint256) {
        return _convertToAssets(shares_, totalAssets(), totalShares, Math.Rounding.Floor);
    }

    /// @inheritdoc IYieldVault
    /// @dev USDC withdrawable from Aave right now (respects Aave availability). Deliberately does NOT
    ///      count the vault's own un-supplied buffer — the Gateway uses this as a conservative liquidity
    ///      gate; under-reporting only causes a settlement to be safely rejected, never a fund loss.
    function idleBuffer() external view returns (uint256) {
        uint256 principal = adapter.totalAssets();
        uint256 avail     = adapter.maxWithdrawable();
        return principal < avail ? principal : avail;
    }

    function _convertToShares(uint256 assets, uint256 ta, Math.Rounding rounding) internal view returns (uint256) {
        return SeniorSharesMath.toShares(assets, totalShares, ta, VIRTUAL, rounding);
    }

    function _convertToAssets(uint256 shares_, uint256 ta, uint256 ts, Math.Rounding rounding) internal pure returns (uint256) {
        return SeniorSharesMath.toAssets(shares_, ta, ts, VIRTUAL, rounding);
    }

    // ── deposit ────────────────────────────────────────────────────────────────────

    /// @notice Deposit `assets` USDC and credit shares to `to`. Idles the USDC into Aave.
    /// @dev Shares are computed from `totalAssets` measured BEFORE the incoming USDC is counted, so the
    ///      depositor cannot mint against their own inflow. Mint rounds DOWN.
    function deposit(uint256 assets, address to) external nonReentrant whenNotPaused returns (uint256 sharesMinted) {
        if (assets == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();

        uint256 taBefore = totalAssets();
        usdc.safeTransferFrom(msg.sender, address(this), assets);

        sharesMinted = _convertToShares(assets, taBefore, Math.Rounding.Floor);
        if (sharesMinted == 0) revert ZeroAmount(); // dust deposit that rounds to no shares

        // EFFECTS before the external adapter.deposit (CEI).
        shares[to]  += sharesMinted;
        totalShares += sharesMinted;

        _supplyToAdapter(assets);

        emit Deposit(msg.sender, to, assets, sharesMinted);
    }

    /// @dev Push idle USDC into Aave, best-effort. If the reserve can't take it (cap/paused/hostile),
    ///      the USDC simply stays in the vault buffer — still counted by `totalAssets()`, and pulled
    ///      back first on redeem/burn. Deposit is NOT a hot path, so degrading to buffer is acceptable.
    function _supplyToAdapter(uint256 amount) internal {
        uint256 suppliable = adapter.maxSuppliable();
        uint256 toSupply   = amount < suppliable ? amount : suppliable;
        if (toSupply == 0) return;
        usdc.forceApprove(address(adapter), toSupply);
        try adapter.deposit(toSupply) {}
        catch {
            usdc.forceApprove(address(adapter), 0); // clear the dangling allowance on failure
        }
    }

    // ── payment settlement (Gateway-only) ────────────────────────────────────────────

    /// @inheritdoc IYieldVault
    /// @dev onlyGateway: the Gateway is the sole authority (it verified the user's off-chain EIP-712
    ///      permit). CEI — the burn effects land BEFORE the external adapter withdraw + USDC transfer.
    ///      `assetsRedeemed` is computed from NAV using the PRE-burn `totalShares` (a pure read), then the
    ///      shares are burned, then the assets are pulled and sent straight to `receiver`.
    function burnForPayment(address user, uint256 sharesToBurn, address receiver)
        external
        onlyGateway
        nonReentrant
        whenNotPaused
        returns (uint256 assetsRedeemed)
    {
        if (receiver == address(0)) revert ZeroAddress();
        uint256 bal = shares[user];
        if (sharesToBurn == 0) revert ZeroAmount();
        if (sharesToBurn > bal) revert InsufficientShares();

        // NAV read against pre-burn totals (round DOWN — favors the vault).
        assetsRedeemed = convertToAssets(sharesToBurn);

        // EFFECTS (CEI): burn the user's shares before any external call.
        shares[user] = bal - sharesToBurn;
        totalShares -= sharesToBurn;

        // INTERACTIONS: best-effort pull of exactly `assetsRedeemed`, then assert sufficiency.
        _pullUSDC(assetsRedeemed);
        usdc.safeTransfer(receiver, assetsRedeemed);

        emit PaymentBurn(user, receiver, sharesToBurn, assetsRedeemed);
    }

    // ── depositor liquidity ──────────────────────────────────────────────────────────

    /// @notice A depositor redeems `sharesToBurn` of their OWN shares for USDC. Same NAV math as the
    ///         payment path; `msg.sender` only. Makes deposits honestly liquid.
    function redeem(uint256 sharesToBurn) external nonReentrant whenNotPaused returns (uint256 assetsOut) {
        uint256 bal = shares[msg.sender];
        if (sharesToBurn == 0) revert ZeroAmount();
        if (sharesToBurn > bal) revert InsufficientShares();

        assetsOut = convertToAssets(sharesToBurn);

        // EFFECTS before external (CEI).
        shares[msg.sender] = bal - sharesToBurn;
        totalShares -= sharesToBurn;

        _pullUSDC(assetsOut);
        usdc.safeTransfer(msg.sender, assetsOut);

        emit Redeem(msg.sender, sharesToBurn, assetsOut);
    }

    /// @dev Ensure the vault holds >= `need` USDC on-hand: use the un-supplied buffer first, then make a
    ///      best-effort adapter withdraw for the shortfall. Reverts `InsufficientIdleLiquidity` if the
    ///      adapter cannot cover it (the Gateway's `idleBuffer` pre-check makes this rare on the payment
    ///      path). This is a strengthening of "adapter.withdraw + require got >= assetsRedeemed": it
    ///      credits any pre-existing buffer so honestly-held USDC is never stranded, and the final
    ///      `require` is at least as strict as the spec's assertion.
    function _pullUSDC(uint256 need) internal {
        uint256 onHand = usdc.balanceOf(address(this));
        if (onHand < need) {
            adapter.withdraw(need - onHand); // best-effort; sends to this vault
        }
        if (usdc.balanceOf(address(this)) < need) revert InsufficientIdleLiquidity();
    }
}
