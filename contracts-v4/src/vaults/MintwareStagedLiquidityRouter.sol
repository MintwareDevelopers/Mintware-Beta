// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IYieldAdapter} from "./IYieldAdapter.sol";
import {SeniorSharesMath} from "../lib/SeniorSharesMath.sol";
import {LockTier} from "./VaultTypes.sol";

/// @dev Minimal view of a Mintware dual-sided pair vault this router forms liquidity into.
///      `depositFor` is the exact seam that lets the router pay both sides and mint the LP shares
///      straight to the staged owner (shares are a non-transferable internal mapping, so crediting
///      at mint time is the only way to hand them over — same reason the v3→v4 migrator uses it).
interface IPairVaultLike {
    function token0() external view returns (IERC20);
    function token1() external view returns (IERC20);
    function depositFor(
        address recipient,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 minShares,
        LockTier tier
    ) external returns (uint256 sharesMinted);
}

/// @title  MintwareStagedLiquidityRouter
/// @notice The **staged-buffer pairing router** — the capital-constrained liquidity path. A team that
///         holds only ONE side of a pair *stages* it here: the staged token is supplied to a yield
///         adapter and **earns from day one**, and it pairs into a `MintwareDeFiPairVault` only when the
///         owner completes the pair with the other side. Pairing is **opt-in, never automatic**: staged
///         capital just sits and earns until the owner calls `pair()` (or pulls out with `unstage()`).
///         "Never idle, never locked, always yours," for a single-sided team.
///
/// @dev    **Compose, don't re-invent (option B).** This is a *thin* router over two primitives that
///         already ship: a single-asset `IYieldAdapter` (the earn buffer) and `IPairVaultLike.depositFor`
///         (the atomic LP formation). It holds no pricing logic and no V4 code of its own.
///
///         **Boundary vs `MintwareMatchedLiquidityVault`.** The matched vault is the *two-party* launch
///         primitive — a team commits its token and the *community* funds the quote, sharing the pool.
///         This router is the *one-party deferral* primitive — the owner parks one side to earn, then
///         brings the other side themselves when ready. It does **not** split the LP between two
///         economic parties (the pair vault credits a single recipient), so `pair()` is owner-only and
///         the minted shares + any dust all go to the staged owner. Permissionless two-sided matching is
///         the matched vault's job, not this router's.
///
///         **Yield accounting.** Each adapter gets an internal ERC-4626-style share pool (the same
///         symmetric virtual-offset defense as the payment vaults, via `SeniorSharesMath`) so every
///         stage earns its exact pro-rata share of that adapter's accrued yield — including time, not
///         just principal. **Invariant the deployer must uphold:** an adapter instance passed here is
///         **dedicated to this router** and denominated in the staged token; `adapter.totalAssets()` is
///         read as the whole pool's asset base, which is only true if nothing else deposits into it.
contract MintwareStagedLiquidityRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Symmetric virtual shares/assets offset for the per-adapter pool. AUDIT L-8: raised 1e3 → 1e6 to
    ///      match the payment vaults' (`MintwareTreasuryVault`) offset. Shares price against the live,
    ///      donation-inflatable `adapter.totalAssets()`, so the larger offset forces a would-be donation
    ///      griefer to move ~1e6× a victim's deposit — economically irrational — instead of ~1e3×.
    uint256 private constant VIRTUAL = 1e6;

    struct Stage {
        address owner;          // who staged; the only address that can pair or unstage
        IPairVaultLike vault;   // target pair vault this stage forms liquidity into
        IYieldAdapter adapter;  // where the staged side earns
        IERC20 token;           // the staged token (== vault.token0 or vault.token1)
        bool stagedIsToken0;    // which side of the pair the staged token is
        bool active;            // false once paired or unstaged
        uint256 shares;         // this stage's balance in the adapter's internal yield pool
    }

    /// @notice stageId → stage record.
    mapping(uint256 => Stage) public stages;
    /// @notice adapter → total router shares in that adapter's yield pool.
    mapping(address => uint256) public poolShares;
    /// @notice Monotonic stage id counter (first id is 0).
    uint256 public nextStageId;

    event Staged(
        uint256 indexed stageId, address indexed owner, address indexed vault,
        address token, bool stagedIsToken0, uint256 amount, uint256 shares
    );
    event Paired(
        uint256 indexed stageId, address indexed owner,
        uint256 stagedReturned, uint256 counterpartyAmount, uint256 lpSharesMinted
    );
    event Unstaged(uint256 indexed stageId, address indexed owner, uint256 amount);

    error ZeroAmount();
    error ZeroShares();
    error NotOwner();
    error StageInactive();
    error AdapterAtCapacity();
    error AdapterIlliquid();
    error TokenNotInPair();

    /// @notice Stage a single side. Pulls `amount` of the pair's token0/token1 from you and supplies it
    ///         to `adapter` to start earning. Returns the new stageId. Nothing is locked — `unstage()`
    ///         pulls it back (with yield) anytime; `pair()` forms the LP when you bring the other side.
    /// @param  vault           the pair vault this stage will eventually form liquidity into.
    /// @param  stagedIsToken0  true if you're staging the vault's token0 side, false for token1.
    /// @param  amount          amount of the staged token to park.
    /// @param  adapter         the yield adapter (dedicated to this router, denominated in the staged token).
    function stage(IPairVaultLike vault, bool stagedIsToken0, uint256 amount, IYieldAdapter adapter)
        external
        nonReentrant
        returns (uint256 stageId)
    {
        if (amount == 0) revert ZeroAmount();
        IERC20 token = stagedIsToken0 ? vault.token0() : vault.token1();
        if (address(token) == address(0)) revert TokenNotInPair();
        if (adapter.maxSuppliable() < amount) revert AdapterAtCapacity();

        // Mint pool shares against the CURRENT pool state (before this deposit lands), so existing
        // stages keep the yield they've already accrued and this stage buys in at the live NAV.
        uint256 ts = poolShares[address(adapter)];
        uint256 ta = adapter.totalAssets();
        uint256 sh = SeniorSharesMath.toShares(amount, ts, ta, VIRTUAL, Math.Rounding.Floor);
        if (sh == 0) revert ZeroShares();

        token.safeTransferFrom(msg.sender, address(this), amount);
        token.forceApprove(address(adapter), amount);
        adapter.deposit(amount);

        poolShares[address(adapter)] = ts + sh;
        stageId = nextStageId++;
        stages[stageId] = Stage({
            owner: msg.sender, vault: vault, adapter: adapter, token: token,
            stagedIsToken0: stagedIsToken0, active: true, shares: sh
        });

        emit Staged(stageId, msg.sender, address(vault), address(token), stagedIsToken0, amount, sh);
    }

    /// @notice Current redeemable value of a stage (principal + its pro-rata accrued yield).
    function stagedAssets(uint256 stageId) public view returns (uint256) {
        Stage storage s = stages[stageId];
        if (!s.active) return 0;
        return SeniorSharesMath.toAssets(
            s.shares, s.adapter.totalAssets(), poolShares[address(s.adapter)], VIRTUAL, Math.Rounding.Floor
        );
    }

    /// @notice Complete the pair: bring `counterpartyAmount` of the OTHER side and atomically form the
    ///         LP. The staged side (with its earned yield) is pulled back from the adapter, both sides go
    ///         into the pair vault, and the LP shares + any returned dust are credited to you. Owner-only
    ///         and opt-in by design — nothing pairs until you call this.
    /// @param  minShares  slippage floor on LP shares minted (forwarded to the vault).
    /// @param  tier       lock tier for the formed position.
    function pair(uint256 stageId, uint256 counterpartyAmount, uint256 minShares, LockTier tier)
        external
        nonReentrant
        returns (uint256 lpSharesMinted)
    {
        Stage storage s = stages[stageId];
        if (!s.active) revert StageInactive();
        if (msg.sender != s.owner) revert NotOwner();
        if (counterpartyAmount == 0) revert ZeroAmount();

        // Pull the staged side (principal + yield) back. This is a deliberate action, not a swap hot
        // path, so we require full liquidity and revert if the source can't cover it (retry later or
        // unstage) — unlike the best-effort JIT withdraw the adapter is otherwise built for.
        uint256 assets = stagedAssets(stageId);
        if (s.adapter.maxWithdrawable() < assets) revert AdapterIlliquid();

        // Burn the stage's shares BEFORE external calls (checks-effects-interactions).
        poolShares[address(s.adapter)] -= s.shares;
        s.active = false;

        uint256 got = s.adapter.withdraw(assets); // returns actual (<= assets); pool is now debited by `assets`

        // Pull the counterparty side from the owner and form the balanced LP.
        IPairVaultLike vault = s.vault;
        IERC20 other = s.stagedIsToken0 ? vault.token1() : vault.token0();
        other.safeTransferFrom(msg.sender, address(this), counterpartyAmount);

        (IERC20 t0, IERC20 t1) = (vault.token0(), vault.token1());
        uint256 amount0 = s.stagedIsToken0 ? got : counterpartyAmount;
        uint256 amount1 = s.stagedIsToken0 ? counterpartyAmount : got;
        t0.forceApprove(address(vault), amount0);
        t1.forceApprove(address(vault), amount1);

        // depositFor: router pays both sides; the owner receives the LP shares, lock, and any dust.
        lpSharesMinted = vault.depositFor(s.owner, amount0, amount1, minShares, tier);

        // Clear any residual approval (the vault uses balance-diff accounting and may leave dust).
        t0.forceApprove(address(vault), 0);
        t1.forceApprove(address(vault), 0);

        emit Paired(stageId, s.owner, got, counterpartyAmount, lpSharesMinted);
    }

    /// @notice Cancel a stage and pull the staged side (principal + yield) back to you. Owner-only.
    function unstage(uint256 stageId) external nonReentrant returns (uint256 returned) {
        Stage storage s = stages[stageId];
        if (!s.active) revert StageInactive();
        if (msg.sender != s.owner) revert NotOwner();

        uint256 assets = stagedAssets(stageId);
        if (s.adapter.maxWithdrawable() < assets) revert AdapterIlliquid();

        poolShares[address(s.adapter)] -= s.shares;
        s.active = false;

        returned = s.adapter.withdraw(assets);
        s.token.safeTransfer(s.owner, returned);

        emit Unstaged(stageId, s.owner, returned);
    }
}
