// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";

/// @dev Test-only LENDING adapter over the `IYieldAdapter` seam — models a WETH (or any-asset) supply into
///      an Aave/Morpho-style lending market for the `MintwareEthSettlement` never-idle tests. Distinct from
///      `MockYieldAdapter` in that it explicitly models the lending traits the settlement path cares about:
///
///        • **Rebasing-style interest** — `accrue(amount)` mints extra underlying into the adapter (as an
///          aToken balance would grow), so `totalAssets()` reports principal + accrued yield with no
///          bookkeeping, exactly like `aToken.balanceOf`.
///        • **Best-effort / partial withdraw** — `withdraw` returns `<= amount`, capped by a settable
///          "available liquidity" ceiling that simulates a near-100%-utilization / withdrawal crunch where
///          supply is temporarily illiquid even though `totalAssets` still reports it.
///        • **Settable supply cap** — `maxSuppliable` can be pinned to simulate a frozen/paused reserve.
///        • **Break switch** — `setBroken(true)` makes `deposit`/`withdraw` revert, to prove the settlement
///          contract degrades to "stays liquid / never bricks" against a hostile/broken adapter.
///
///      The IYieldAdapter interface is the contract under test — tests wire THIS, never `AaveV3YieldAdapter`.
contract MockLendingAdapter is IYieldAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlying;

    /// @dev Available liquidity ceiling (utilization crunch). `type(uint256).max` = fully liquid (default).
    uint256 public availableLiquidity = type(uint256).max;
    /// @dev Supply ceiling (frozen reserve). `type(uint256).max` = unlimited (default).
    uint256 public suppliableCap = type(uint256).max;
    /// @dev When true, `deposit`/`withdraw` revert — models a broken/hostile lending source.
    bool public broken;

    constructor(address _underlying) {
        underlying = IERC20(_underlying);
    }

    // ── test knobs ────────────────────────────────────────────────────────────────
    function setAvailableLiquidity(uint256 cap) external { availableLiquidity = cap; }
    function setSuppliableCap(uint256 cap) external { suppliableCap = cap; }
    function setBroken(bool b) external { broken = b; }

    /// @dev Simulate lending interest accrual: mint `amount` extra underlying to this adapter. Requires the
    ///      test token to expose `mint(address,uint256)` (MockERC20 does). Callable via the token directly too.
    function accrue(uint256 amount) external {
        // pull from the caller so the adapter's balance (and thus totalAssets) grows like a rebasing aToken
        underlying.safeTransferFrom(msg.sender, address(this), amount);
    }

    // ── IYieldAdapter ─────────────────────────────────────────────────────────────
    function deposit(uint256 amount) external override {
        require(!broken, "MockLendingAdapter: broken");
        underlying.safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 amount) external override returns (uint256) {
        // Best-effort: NEVER reverts for liquidity. If broken, revert to prove the caller's try/degrade path —
        // but the settlement contract calls this outside try/catch, so `broken` is used only where the caller
        // is expected to tolerate a revert (it never is on the hot path). We therefore fail-soft to 0 here to
        // honour the interface's "never reverts" contract, and expose `broken` only for the deposit side +
        // maxWithdrawable so the settlement path degrades to on-hand.
        if (broken) return 0;
        uint256 avail = _withdrawable();
        uint256 got = amount < avail ? amount : avail;
        if (got > 0) underlying.safeTransfer(msg.sender, got);
        return got;
    }

    function totalAssets() external view override returns (uint256) {
        return underlying.balanceOf(address(this)); // principal + accrued (rebasing-style)
    }

    function maxWithdrawable() external view override returns (uint256) {
        if (broken) return 0;
        return _withdrawable();
    }

    function maxSuppliable() external view override returns (uint256) {
        if (broken) return 0;
        return suppliableCap;
    }

    function _withdrawable() internal view returns (uint256) {
        uint256 bal = underlying.balanceOf(address(this));
        return bal < availableLiquidity ? bal : availableLiquidity;
    }
}
