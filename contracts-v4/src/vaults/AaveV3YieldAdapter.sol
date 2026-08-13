// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {
    IPoolAddressesProvider, IPool, IAToken, ReserveConfigurationMap, ReserveFlags
} from "./aave/IAaveV3.sol";
import {IYieldAdapter} from "./IYieldAdapter.sol";

/// @title  AaveV3YieldAdapter
/// @notice Single-asset idle-capital sink over Aave v3 for ULV buffered rehypothecation. Supplies
///         the vault's idle token to Aave (earning supply yield) and returns it on demand. A
///         dual-sided vault deploys one adapter per token.
///
/// @dev    Design (from the ULV engine research, `docs/developers/ulv-engine-design.md`):
///           • Direct `IPool.supply/withdraw` — NOT Aave's ERC-4626 wrapper (no 4626-in-4626).
///           • `totalAssets()` = `aToken.balanceOf(this)` — aTokens rebase, so yield accrues with
///             zero bookkeeping.
///           • **Supply-only ⇒ no borrow, no collateral, no liquidation risk.** The only loss vector
///             is Aave protocol insolvency, which is out of our control.
///           • **Withdraw is BEST-EFFORT and can never revert** — it is called on a swap hot path,
///             and a bricked swap is the failure mode we design against. It returns the actual amount
///             so the caller falls back to its own hot reserves.
///           • **Per-block withdraw cap** bounds how much inventory can leave Aave in one block —
///             a hard ceiling on drain during toxic one-sided flow (independent of the vault's own
///             caps; belt-and-suspenders).
///           • The aToken is verified against the asset + pool in the constructor so a
///             mis-configured / swapped aToken can't be wired in (a Bunni-class attack vector).
contract AaveV3YieldAdapter is IYieldAdapter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ReserveFlags for ReserveConfigurationMap;

    IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
    IERC20  public immutable asset;
    IAToken public immutable aToken;

    /// @notice The only address allowed to supply/withdraw. Owner-settable to break the deploy
    ///         chicken-and-egg (deploy adapter → deploy/point vault → setVault).
    address public vault;

    /// @notice Max underlying that may be withdrawn per block (0 = unlimited). Bounds drain.
    uint256 public perBlockWithdrawCap;
    uint256 private _lastWithdrawBlock;
    uint256 private _withdrawnThisBlock;

    event VaultSet(address indexed vault);
    event PerBlockWithdrawCapSet(uint256 cap);
    event Supplied(uint256 amount);
    event Withdrawn(uint256 requested, uint256 withdrawn);

    error OnlyVault();
    error ZeroAddress();
    error ATokenMismatch();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    /// @param _provider Aave PoolAddressesProvider (stable anchor; pool resolved live).
    /// @param _asset    The underlying token this adapter idles (e.g. USDC or WETH).
    /// @param _aToken   The Aave aToken for `_asset` — VERIFIED here against asset + pool.
    /// @param _vault    Initial authorized vault (may be zero and set later via setVault).
    constructor(
        IPoolAddressesProvider _provider,
        address _asset,
        address _aToken,
        address _vault,
        address _owner
    ) Ownable(_owner) {
        if (address(_provider) == address(0) || _asset == address(0) || _aToken == address(0)) {
            revert ZeroAddress();
        }
        // Verify the aToken really represents `_asset` in this Aave deployment — guards against a
        // wrong/attacker-supplied aToken silently mis-accounting funds.
        if (
            IAToken(_aToken).UNDERLYING_ASSET_ADDRESS() != _asset ||
            IAToken(_aToken).POOL() != _provider.getPool()
        ) revert ATokenMismatch();

        ADDRESSES_PROVIDER = _provider;
        asset  = IERC20(_asset);
        aToken = IAToken(_aToken);
        vault  = _vault; // zero allowed; setVault later
    }

    // ── admin ────────────────────────────────────────────────────────────────
    function setVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert ZeroAddress();
        vault = _vault;
        emit VaultSet(_vault);
    }

    function setPerBlockWithdrawCap(uint256 cap) external onlyOwner {
        perBlockWithdrawCap = cap;
        emit PerBlockWithdrawCapSet(cap);
    }

    // ── IYieldAdapter ──────────────────────────────────────────────────────────

    /// @inheritdoc IYieldAdapter
    function deposit(uint256 amount) external override onlyVault nonReentrant {
        if (amount == 0) return;
        address pool = ADDRESSES_PROVIDER.getPool();
        asset.safeTransferFrom(vault, address(this), amount);
        asset.forceApprove(pool, amount);
        IPool(pool).supply(address(asset), amount, address(this), 0);
        emit Supplied(amount);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Best-effort: clamps to Aave headroom + the per-block cap, wraps the withdraw in try/catch,
    ///      and returns the actual amount. Sends withdrawn tokens straight to the vault. Never reverts
    ///      for an availability reason.
    function withdraw(uint256 amount) external override onlyVault nonReentrant returns (uint256 withdrawn) {
        uint256 want = amount < maxWithdrawable() ? amount : maxWithdrawable();
        if (want == 0) return 0;
        address pool = ADDRESSES_PROVIDER.getPool();
        try IPool(pool).withdraw(address(asset), want, vault) returns (uint256 w) {
            withdrawn = w;
        } catch {
            return 0;
        }
        // Per-block accounting (after the external call; nonReentrant makes ordering safe).
        if (block.number != _lastWithdrawBlock) {
            _lastWithdrawBlock = block.number;
            _withdrawnThisBlock = 0;
        }
        _withdrawnThisBlock += withdrawn;
        emit Withdrawn(amount, withdrawn);
    }

    /// @inheritdoc IYieldAdapter
    function totalAssets() external view override returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    /// @inheritdoc IYieldAdapter
    /// @dev min(our aToken balance, Aave's on-hand liquidity, per-block remaining). 0 if the reserve
    ///      is inactive or paused (frozen still permits withdraw).
    function maxWithdrawable() public view override returns (uint256) {
        ReserveConfigurationMap memory cfg = IPool(ADDRESSES_PROVIDER.getPool()).getConfiguration(address(asset));
        if (!cfg.isActive() || cfg.isPaused()) return 0;
        uint256 bal   = aToken.balanceOf(address(this));
        uint256 avail = asset.balanceOf(address(aToken)); // unborrowed liquidity backing the aToken
        uint256 cap   = _blockRemaining();
        uint256 m = bal < avail ? bal : avail;
        return m < cap ? m : cap;
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Active/frozen/paused-gated. NOTE: does not yet compute Aave supply-cap headroom — a full
    ///      reserve will make `deposit`'s supply revert. Supply-cap awareness lands with the vault-side
    ///      buffer logic (Phase 1a increment 2). Deposit is not a hot path, so a rare revert is tolerable.
    function maxSuppliable() external view override returns (uint256) {
        ReserveConfigurationMap memory cfg = IPool(ADDRESSES_PROVIDER.getPool()).getConfiguration(address(asset));
        if (!cfg.isActive() || cfg.isPaused() || cfg.isFrozen()) return 0;
        // Model Aave's supply cap so the vault's `maxSuppliable()==0` idle guard degrades gracefully
        // (no-op) against a caps-full reserve instead of reverting `SupplyCapExceeded` (found by the
        // live Base-Sepolia fork test — the WETH market was at cap). `getSupplyCap()==0` ⇒ uncapped.
        uint256 cap = cfg.getSupplyCap();
        if (cap == 0) return type(uint256).max;
        uint256 capScaled = cap * (10 ** cfg.getDecimals());
        uint256 current = aToken.totalSupply(); // index-applied ≈ Aave's counted current supply
        return current >= capScaled ? 0 : capScaled - current;
    }

    function _blockRemaining() internal view returns (uint256) {
        if (perBlockWithdrawCap == 0) return type(uint256).max;
        if (block.number != _lastWithdrawBlock) return perBlockWithdrawCap;
        return perBlockWithdrawCap > _withdrawnThisBlock ? perBlockWithdrawCap - _withdrawnThisBlock : 0;
    }
}
